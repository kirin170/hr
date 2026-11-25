import { BadRequestException } from '@nestjs/common';
import { AiRunStatus, AiRunType, DataScope } from '@prisma/client';
import { deflateRawSync } from 'node:zlib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiConfigService } from './ai-config.service.js';
import { AiProviderChainError, AiProviderRouter } from './ai-provider.router.js';
import {
  AiContractError,
  validateInterviewEval,
  validateResumeEval,
  validateResumeParse,
} from './ai.contract.js';
import { AiRunService } from './ai-run.service.js';
import type { AiUsage, ResumeContent } from './ai.types.js';
import type { AuthorizationService } from '../auth/authorization.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import type { AiEvalQueueService } from './eval.queue.js';
import { AI_ERROR_CODES, AiProviderError, type ModelProvider, type ProviderEndpointConfig } from './model-provider.js';
import { extractDocxText, extractPdfText, ResumeContentLoader } from './resume-content.loader.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { StorageService } from '../storage/storage.service.js';
import type { TimelineService } from '../timeline/timeline.service.js';

const hr: AuthenticatedUser = {
  id: 'hr-1',
  displayName: '招聘 HR',
  departmentId: null,
  departmentIds: [],
  groupIds: [],
  roles: [
    {
      code: 'hr',
      name: '招聘 HR',
      dataScope: DataScope.ALL,
      permissions: ['ai:read', 'ai:confirm'],
    },
  ],
};

const usage: AiUsage = {
  provider: 'mock',
  model: 'mock-ai-v1',
  latencyMs: 5,
  promptTokens: 100,
  completionTokens: 50,
  costMicros: 0,
};

function endpoint(label: string, overrides: Partial<ProviderEndpointConfig> = {}): ProviderEndpointConfig {
  return {
    kind: 'OPENAI_COMPATIBLE',
    label,
    baseUrl: 'https://example.invalid/v1',
    model: `${label}-model`,
    apiKeyEnv: 'AI_TEST_KEY',
    timeoutMs: 1000,
    maxOutputTokens: 256,
    inputMicrosPer1kTokens: 0,
    outputMicrosPer1kTokens: 0,
    supportsVision: true,
    enabled: true,
    ...overrides,
  };
}

function stubProvider(name: string, options: { fail?: Error; image?: boolean } = {}): ModelProvider {
  const failure = options.fail;
  const run = async () => {
    if (failure) throw failure;
    return { output: {} as never, confidence: {}, usage };
  };
  return {
    name,
    kind: 'OPENAI_COMPATIBLE',
    capabilities: { text: true, image: options.image ?? true, structuredOutput: true },
    parseResume: run as ModelProvider['parseResume'],
    evaluateResume: run as ModelProvider['evaluateResume'],
    evaluateInterview: run as ModelProvider['evaluateInterview'],
  };
}

describe('AiProviderRouter 主选/兜底链路（ATS-021）', () => {
  const config = {
    resolveEndpoints: vi.fn(),
    assertSceneEnabled: vi.fn(),
  } as unknown as AiConfigService;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AI_PROVIDER_MODE = 'live';
  });

  it('主选失败时自动兜底到外部模型', async () => {
    (config.resolveEndpoints as ReturnType<typeof vi.fn>).mockResolvedValue([
      endpoint('qwen'),
      endpoint('external'),
    ]);
    const primary = stubProvider('qwen', {
      fail: new AiProviderError(AI_ERROR_CODES.TIMEOUT, 'qwen 超时', { retryable: true }),
    });
    const fallback = stubProvider('external');
    const router = new AiProviderRouter(config, (item) => (item.label === 'qwen' ? primary : fallback));

    const { provider } = await router.run('RESUME_EVAL', { needsImage: false }, (item) =>
      item.evaluateResume({} as never),
    );

    expect(provider.name).toBe('external');
  });

  it('主选与兜底均失败时抛出带尝试明细的错误，供上层降级人工', async () => {
    (config.resolveEndpoints as ReturnType<typeof vi.fn>).mockResolvedValue([
      endpoint('qwen'),
      endpoint('external'),
    ]);
    const router = new AiProviderRouter(
      config,
      (item) =>
        stubProvider(item.label, {
          fail: new AiProviderError(AI_ERROR_CODES.HTTP_ERROR, `${item.label} 500`, { retryable: true }),
        }),
    );

    const error = await router
      .run('RESUME_EVAL', { needsImage: false }, (item) => item.evaluateResume({} as never))
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AiProviderChainError);
    expect((error as AiProviderChainError).code).toBe(AI_ERROR_CODES.ALL_FAILED);
    expect((error as AiProviderChainError).attempts.map((attempt) => attempt.provider)).toEqual([
      'qwen',
      'external',
    ]);
  });

  it('图片简历跳过不支持视觉的模型并留痕', async () => {
    (config.resolveEndpoints as ReturnType<typeof vi.fn>).mockResolvedValue([endpoint('qwen')]);
    const router = new AiProviderRouter(config, (item) => stubProvider(item.label, { image: false }));

    const error = await router
      .run('RESUME_PARSE', { needsImage: true }, (item) => item.parseResume({} as never))
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AiProviderChainError);
    expect((error as AiProviderChainError).attempts[0].code).toBe(AI_ERROR_CODES.CAPABILITY_UNSUPPORTED);
  });
});

describe('AI 输出契约校验（ATS-021）', () => {
  it('解析结果格式异常的字段降低置信度并给出告警', () => {
    const { output, warnings } = validateResumeParse({
      name: { value: '张三', confidence: 0.9 },
      phone: { value: '不是电话', confidence: 0.9 },
      email: { value: 'zhangsan@example.com', confidence: 0.9 },
      education: { value: '本科', confidence: 0.6 },
      school: { value: '示例大学', confidence: 0.6 },
      experiences: [{ company: '示例公司', title: '招聘专员' }],
      skills: ['TypeScript'],
    });

    expect(output.phone.confidence).toBeLessThanOrEqual(0.3);
    expect(warnings.some((warning) => warning.path === 'phone')).toBe(true);
  });

  it('解析结果缺少必填结构时拒绝，不写入半成品', () => {
    expect(() => validateResumeParse({ name: { value: '张三', confidence: 0.9 } })).toThrow(AiContractError);
  });

  it('评估结果分数越界时拒绝', () => {
    expect(() =>
      validateResumeEval({ verdict: '符合', score: 0, rationale: '依据', missingPoints: [] }),
    ).toThrow(AiContractError);
  });

  it('面试依据必须可回原文，引用未知定位时拒绝', () => {
    expect(() =>
      validateInterviewEval(
        {
          suggestion: '待定',
          rationale: '依据',
          evidence: [{ quote: '原文片段', sourceRef: 'segment:99' }],
          missingPoints: [],
        },
        ['dingtalk-minutes:abc#ffff', 'segment:0'],
      ),
    ).toThrow(AiContractError);
  });
});

describe('AiRunService 人工复核边界（ATS-021）', () => {
  const makeService = (overrides: Record<string, unknown> = {}) => {
    const prisma = {
      aIRun: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'run-new', type: AiRunType.RESUME_EVAL, status: AiRunStatus.PENDING }),
        update: vi.fn().mockResolvedValue({}),
      },
      candidate: {
        findFirst: vi.fn().mockResolvedValue({ id: 'cand-1', name: '张三', jobId: 'job-1' }),
        update: vi.fn().mockResolvedValue({}),
      },
      job: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'job-1',
          title: '后端工程师',
          requirements: '五年以上 Node.js 经验',
          aiEvalEnabled: true,
        }),
      },
      resumeIntake: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'intake-1',
          candidateId: 'cand-1',
          jobId: 'job-1',
          resumeFileId: 'file-1',
          resumeFile: { id: 'file-1', fileName: '张三.pdf', mimeType: 'application/pdf', size: 1024, sha256: 'a'.repeat(64) },
        }),
        findUnique: vi.fn().mockResolvedValue({ id: 'intake-1', candidateId: 'cand-1', jobId: 'job-1', airRunId: 'run-1', status: 'PARSING' }),
        update: vi.fn().mockResolvedValue({}),
      },
      resumeFile: { findUnique: vi.fn().mockResolvedValue(null) },
      interviewTranscriptMaterial: { findUnique: vi.fn().mockResolvedValue(null) },
      $transaction: vi.fn(async (operations: unknown) =>
        Array.isArray(operations) ? Promise.all(operations) : (operations as () => Promise<unknown>)()),
      ...overrides,
    };
    const timeline = { record: vi.fn().mockResolvedValue(undefined) };
    const authorization = {
      candidateWhere: vi.fn().mockReturnValue({}),
      canAccessCandidate: vi.fn().mockResolvedValue(true),
      canAccessJob: vi.fn().mockResolvedValue(true),
      canAccessSensitiveField: vi.fn().mockResolvedValue(false),
      assertSensitiveFieldAccess: vi.fn().mockResolvedValue(undefined),
    };
    const config = {
      getConfig: vi.fn().mockResolvedValue({
        scenes: {
          RESUME_PARSE: { templateVersion: 'resume-parse.v1' },
          RESUME_EVAL: { templateVersion: 'resume-eval.v1' },
          INTERVIEW_EVAL: { templateVersion: 'interview-eval.v1' },
        },
      }),
      assertSceneEnabled: vi.fn().mockResolvedValue(undefined),
    };
    const router = { run: vi.fn() };
    const loader = { load: vi.fn() };
    const evalQueue = { enqueue: vi.fn().mockResolvedValue(true) };
    const service = new AiRunService(
      prisma as unknown as PrismaService,
      timeline as unknown as TimelineService,
      authorization as unknown as AuthorizationService,
      config as unknown as AiConfigService,
      router as unknown as never,
      loader as unknown as never,
      evalQueue as unknown as AiEvalQueueService,
    );
    return { service, prisma, timeline, authorization, config, router, loader, evalQueue };
  };

  it('职位未填写招聘要求时禁止发起评估（AI-5）', async () => {
    const { service, prisma } = makeService();
    prisma.job.findUnique.mockResolvedValue({
      id: 'job-1',
      title: '后端工程师',
      requirements: '   ',
      aiEvalEnabled: true,
    });

    await expect(service.requestResumeEval('cand-1', hr)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.aIRun.create).not.toHaveBeenCalled();
  });

  it('职位级开关关闭时禁止发起评估（AI-3）', async () => {
    const { service, prisma } = makeService();
    prisma.job.findUnique.mockResolvedValue({
      id: 'job-1',
      title: '后端工程师',
      requirements: '五年以上 Node.js 经验',
      aiEvalEnabled: false,
    });

    await expect(service.requestResumeEval('cand-1', hr)).rejects.toThrow('该职位已关闭 AI 评估');
  });

  it('相同目标重复发起时复用已有任务，不重复调用与计费', async () => {
    const { service, prisma, evalQueue } = makeService();
    prisma.aIRun.findFirst.mockResolvedValue({
      id: 'run-existing',
      type: AiRunType.RESUME_EVAL,
      status: AiRunStatus.SUCCESS,
    });

    const result = await service.requestResumeEval('cand-1', hr);

    expect(result).toMatchObject({ deduped: true, queued: false });
    expect(prisma.aIRun.create).not.toHaveBeenCalled();
    expect(evalQueue.enqueue).not.toHaveBeenCalled();
  });

  it('确认评估草稿只标记采纳，不推进候选人阶段（AI-6）', async () => {
    const { service, prisma, timeline } = makeService();
    const run = {
      id: 'run-1',
      type: AiRunType.RESUME_EVAL,
      status: AiRunStatus.SUCCESS,
      isDraft: true,
      interviewId: null,
      output: JSON.stringify({ verdict: '符合', score: 4, rationale: '依据', missingPoints: [] }),
      inputRefs: JSON.stringify({ candidate: { id: 'cand-1' }, job: { id: 'job-1' } }),
    };
    prisma.aIRun.findUnique.mockResolvedValue(run);
    prisma.aIRun.update.mockResolvedValue({ ...run, isDraft: false });

    await service.confirmRun('run-1', hr);

    expect(prisma.aIRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isDraft: false }) }),
    );
    expect(prisma.candidate.update).not.toHaveBeenCalled();
    expect(timeline.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'candidate.ai_eval_confirmed' }),
    );
  });

  it('人工改坏草稿时按请求错误返回 400 并给出逐项问题（AI-1）', async () => {
    const { service, prisma } = makeService();
    prisma.aIRun.findUnique.mockResolvedValue({
      id: 'run-1',
      type: AiRunType.RESUME_EVAL,
      status: AiRunStatus.SUCCESS,
      isDraft: true,
      interviewId: null,
      output: JSON.stringify({ verdict: '符合', score: 4, rationale: '依据', missingPoints: [] }),
      inputRefs: JSON.stringify({ candidate: { id: 'cand-1' } }),
    });

    const error = await service
      .editRun('run-1', { verdict: '说不清', score: 9, rationale: '', missingPoints: [] }, hr)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BadRequestException);
    const response = (error as BadRequestException).getResponse() as { issues: Array<{ path: string }> };
    expect(response.issues.map((issue) => issue.path)).toEqual(
      expect.arrayContaining(['verdict', 'score', 'rationale']),
    );
    expect(prisma.aIRun.update).not.toHaveBeenCalled();
  });

  it('无联系人字段权限时对解析草稿脱敏', async () => {
    const { service, prisma } = makeService();
    prisma.aIRun.findUnique.mockResolvedValue({
      id: 'run-1',
      type: AiRunType.RESUME_PARSE,
      status: AiRunStatus.SUCCESS,
      isDraft: true,
      interviewId: null,
      output: JSON.stringify({
        name: { value: '张三', confidence: 0.9 },
        phone: { value: '13800000000', confidence: 0.8 },
        email: { value: 'zhangsan@example.com', confidence: 0.9 },
      }),
      inputRefs: JSON.stringify({ fileName: '张三.pdf' }),
    });

    const detail = (await service.getRun('run-1', hr)) as {
      output: { name: { value: string }; phone: { value: string | null }; email: { value: string | null } };
    };

    expect(detail.output.name.value).toBe('张三');
    expect(detail.output.phone.value).toBeNull();
    expect(detail.output.email.value).toBeNull();
  });

  it('场景被关闭时解析任务降级为人工处理并留痕（AI-4）', async () => {
    const { service, prisma, timeline, config } = makeService();
    (config.assertSceneEnabled as ReturnType<typeof vi.fn>).mockRejectedValue(
      new AiProviderError(AI_ERROR_CODES.DISABLED, 'AI 能力已被系统管理员关闭', { retryable: false }),
    );
    prisma.aIRun.findUnique.mockResolvedValue({
      id: 'run-1',
      type: AiRunType.RESUME_PARSE,
      status: AiRunStatus.RUNNING,
      inputRefs: JSON.stringify({ intakeId: 'intake-1', resumeFileId: 'file-1' }),
    });

    await service.processParseTask('intake-1');

    expect(prisma.resumeIntake.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'NEEDS_MANUAL' }) }),
    );
    expect(timeline.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'intake.parse_degraded' }),
    );
  });

  it('重试耗尽的评估任务记录降级事件但不改阶段', async () => {
    const { service, prisma, timeline } = makeService();
    prisma.aIRun.findUnique.mockResolvedValue({
      id: 'run-1',
      type: AiRunType.RESUME_EVAL,
      status: AiRunStatus.RUNNING,
      interviewId: null,
      inputRefs: JSON.stringify({ candidate: { id: 'cand-1' } }),
    });

    await service.markEvalFailed('run-1', new AiProviderError(AI_ERROR_CODES.TIMEOUT, '超时'));

    expect(prisma.aIRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: AiRunStatus.FAILED, errorCode: AI_ERROR_CODES.TIMEOUT }) }),
    );
    expect(timeline.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'ai_run.degraded' }));
    expect(prisma.candidate.update).not.toHaveBeenCalled();
  });
});

describe('简历内容装载（ATS-021）', () => {
  function buildZip(entryName: string, content: Buffer): Buffer {
    const name = Buffer.from(entryName, 'utf8');
    const compressed = deflateRawSync(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(name.length, 26);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(0, 42);

    const centralOffset = local.length + name.length + compressed.length;
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(1, 8);
    eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(central.length + name.length, 12);
    eocd.writeUInt32LE(centralOffset, 16);

    return Buffer.concat([local, name, compressed, central, name, eocd]);
  }

  it('从 DOCX 的 document.xml 抽取正文', () => {
    const xml = Buffer.from(
      '<w:document><w:body><w:p><w:r><w:t>张三 五年后端经验</w:t></w:r></w:p></w:body></w:document>',
      'utf8',
    );
    expect(extractDocxText(buildZip('word/document.xml', xml))).toContain('张三 五年后端经验');
  });

  it('从文本型 PDF 内容流抽取文本', () => {
    const pdf = Buffer.concat([
      Buffer.from('%PDF-1.4\n1 0 obj << /Length 60 >>\nstream\nBT /F1 12 Tf (', 'latin1'),
      Buffer.from('张三 五年后端经验', 'utf8'),
      Buffer.from(') Tj ET\nendstream\nendobj\ntrailer\n', 'latin1'),
    ]);
    expect(extractPdfText(pdf)).toContain('五年后端经验');
  });

  it('图片简历走多模态直读，不伪造文本', async () => {
    const storage = { readObject: vi.fn().mockResolvedValue(Buffer.from('fake-image')) };
    const loader = new ResumeContentLoader(storage as unknown as StorageService);
    const content: ResumeContent = await loader.load({
      storageKey: 'resume/1.png',
      fileName: '1.png',
      mimeType: 'image/png',
      size: 10,
    });

    expect(content.text).toBeNull();
    expect(content.imageDataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it('不支持的格式明确失败并降级人工', async () => {
    const storage = { readObject: vi.fn().mockResolvedValue(Buffer.from('{\\rtf1}')) };
    const loader = new ResumeContentLoader(storage as unknown as StorageService);

    await expect(
      loader.load({ storageKey: 'resume/1.rtf', fileName: '1.rtf', mimeType: 'application/rtf', size: 10 }),
    ).rejects.toMatchObject({ code: AI_ERROR_CODES.CONTENT_UNSUPPORTED });
  });
});

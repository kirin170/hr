import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DataScope } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AiRunService } from '../ai/ai-run.service.js';
import type { AuthorizationService } from '../auth/authorization.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import type { MinutesSource } from '../dingtalk/dingtalk-minutes.client.js';
import { MinutesSourceError } from '../dingtalk/dingtalk-minutes.client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { TimelineService } from '../timeline/timeline.service.js';
import { InterviewTranscriptsService } from './interview-transcripts.service.js';

const actor: AuthenticatedUser = {
  id: 'hr-1',
  displayName: '招聘 HR',
  departmentId: null,
  departmentIds: [],
  groupIds: [],
  roles: [{ code: 'hr', name: '招聘 HR', dataScope: DataScope.ALL, permissions: ['candidate:read', 'candidate:stage:update'] }],
};

const interview = {
  id: 'interview-1',
  candidateId: 'candidate-1',
  jobId: 'job-1',
  round: 2,
  mode: 'VIDEO',
  time: new Date('2026-11-24T02:00:00.000Z'),
  endTime: new Date('2026-11-24T03:00:00.000Z'),
  interviewerIds: '|i-1|i-2|',
};

const link = {
  id: 'link-1',
  interviewId: interview.id,
  candidateId: interview.candidateId,
  jobId: interview.jobId,
  round: 2,
  url: 'https://shanji.dingtalk.com/app/transcribes/a1b2c3d4e5f60718',
  source: 'DINGTALK',
  minutesId: null as string | null,
  createdAt: new Date('2026-11-24T03:10:00.000Z'),
};

const material = {
  id: 'material-1',
  linkId: link.id,
  interviewId: interview.id,
  candidateId: interview.candidateId,
  jobId: interview.jobId,
  round: 2,
  source: 'DINGTALK',
  minutesId: 'a1b2c3d4e5f60718',
  title: '一面听记',
  summary: '候选人介绍了项目经历',
  originalText: '面试官：请介绍项目',
  segments: [{ index: 0, startMs: 0, endMs: 1000, speaker: '面试官', text: '请介绍项目' }],
  contentHash: 'f'.repeat(64),
  sourceRef: 'dingtalk-minutes:a1b2c3d4e5f60718#ffffffffffff',
  fetchedBy: actor.id,
  fetchedAt: new Date('2026-11-24T03:20:00.000Z'),
};

const makeService = (overrides: Partial<MinutesSource> = {}) => {
  const prisma = {
    interview: { findUnique: vi.fn().mockResolvedValue(interview) },
    interviewTranscriptLink: { findUnique: vi.fn().mockResolvedValue(link), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    interviewTranscriptMaterial: {
      findUnique: vi.fn().mockResolvedValue(null),
      findUniqueOrThrow: vi.fn().mockResolvedValue(material),
      findFirst: vi.fn().mockResolvedValue(material),
      findMany: vi.fn().mockResolvedValue([material]),
      create: vi.fn().mockResolvedValue(material),
    },

    job: { findUnique: vi.fn().mockResolvedValue({ requirements: '五年以上 Java 经验' }) },
    interviewFeedback: { findMany: vi.fn().mockResolvedValue([{ interviewerId: 'i-1', conclusion: 'PASS', content: '基础扎实' }]) },
    aIRun: {
      create: vi.fn().mockResolvedValue({ id: 'run-1', type: 'INTERVIEW_EVAL', status: 'PENDING', isDraft: true, createdAt: new Date() }),
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
    },
  };
  const auth = {
    scopesFor: vi.fn().mockReturnValue([DataScope.ALL]),
    canAccessCandidate: vi.fn().mockResolvedValue(true),
  };
  const timeline = { record: vi.fn().mockResolvedValue(undefined) };
  const aiRuns = {
    assertEvalAllowed: vi.fn().mockResolvedValue(undefined),
    enqueueEvalRun: vi.fn().mockResolvedValue(true),
  };
  const fetchMock = vi.fn().mockResolvedValue({
    minutesId: 'a1b2c3d4e5f60718',
    title: '一面听记',
    summary: '候选人介绍了项目经历',
    originalText: '面试官：请介绍项目',
    segments: [{ index: 0, startMs: 0, endMs: 1000, speaker: '面试官', text: '请介绍项目' }],
  });
  const capabilityMock = vi.fn().mockResolvedValue({ state: 'AVAILABLE', configured: true, checkedAt: new Date().toISOString(), code: null });
  const minutes: MinutesSource = {
    capability: capabilityMock,
    fetch: fetchMock,
    ...overrides,
  };
  return {
    service: new InterviewTranscriptsService(
      prisma as unknown as PrismaService,
      auth as unknown as AuthorizationService,
      timeline as unknown as TimelineService,
      minutes,
      aiRuns as unknown as AiRunService,
    ),
    mocks: { prisma, auth, timeline, minutes, aiRuns, fetchMock, capabilityMock },
  };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('听记素材按权限读取（ATS-020）', () => {
  it('数据范围外的面试按不存在处理，不触发钉钉读取', async () => {
    const { service, mocks } = makeService();
    mocks.auth.canAccessCandidate.mockResolvedValue(false);
    await expect(service.fetchMaterial(interview.id, link.id, actor)).rejects.toBeInstanceOf(NotFoundException);
    expect(mocks.fetchMock).not.toHaveBeenCalled();
  });

  it('服务账号读取：操作者无需绑定钉钉身份，操作者仅作审计归属', async () => {
    const { service, mocks } = makeService();
    const result = await service.fetchMaterial(interview.id, link.id, actor);
    expect(result.deduplicated).toBe(false);
    expect(mocks.fetchMock).toHaveBeenCalledWith('a1b2c3d4e5f60718', actor.id);
  });

  it('钉钉拒绝越权读取时返回 403，记录错误码且不写入素材', async () => {
    const { service, mocks } = makeService({
      fetch: vi.fn().mockRejectedValue(new MinutesSourceError('DENIED', 'MINUTES_HTTP_403')),
    });
    await expect(service.fetchMaterial(interview.id, link.id, actor)).rejects.toBeInstanceOf(ForbiddenException);
    expect(mocks.prisma.interviewTranscriptMaterial.create).not.toHaveBeenCalled();
    expect(mocks.timeline.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'interview.transcript.material_failed',
        payload: expect.objectContaining({ code: 'MINUTES_HTTP_403', kind: 'DENIED' }),
      }),
    );
  });

  it('租户未开通听记能力时降级提示人工录入', async () => {
    const { service } = makeService({
      fetch: vi.fn().mockRejectedValue(new MinutesSourceError('UNSUPPORTED', 'MINUTES_CLI_NOT_CONFIGURED')),
    });
    await expect(service.fetchMaterial(interview.id, link.id, actor)).rejects.toMatchObject({ status: 503 });
  });

  it('读取成功后按轮次留存素材并补齐听记来源', async () => {
    const { service, mocks } = makeService();
    const result = await service.fetchMaterial(interview.id, link.id, actor);
    expect(result.deduplicated).toBe(false);
    expect(mocks.prisma.interviewTranscriptMaterial.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          linkId: link.id,
          round: 2,
          source: 'DINGTALK',
          minutesId: 'a1b2c3d4e5f60718',
          sourceRef: expect.stringMatching(/^dingtalk-minutes:a1b2c3d4e5f60718#[0-9a-f]{12}$/),
        }),
      }),
    );
    expect(mocks.prisma.interviewTranscriptLink.updateMany).toHaveBeenCalledWith({
      where: { id: link.id, minutesId: null },
      data: { minutesId: 'a1b2c3d4e5f60718', source: 'DINGTALK' },
    });
  });

  it('重复读取同一素材不新增记录，也不覆盖既有链接', async () => {
    const { service, mocks } = makeService();
    mocks.prisma.interviewTranscriptMaterial.findUnique.mockResolvedValue(material);
    const result = await service.fetchMaterial(interview.id, link.id, actor);
    expect(result.deduplicated).toBe(true);
    expect(mocks.prisma.interviewTranscriptMaterial.create).not.toHaveBeenCalled();
    expect(mocks.prisma.interviewTranscriptLink.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ url: expect.anything() }) }),
    );
  });

  it('人工录入要求摘要或原文至少一项，并标记 MANUAL_ENTRY', async () => {
    const { service, mocks } = makeService();
    await expect(service.addManualMaterial(interview.id, link.id, {}, actor)).rejects.toBeInstanceOf(BadRequestException);
    await service.addManualMaterial(interview.id, link.id, { originalText: '面试官：请介绍项目' }, actor);
    expect(mocks.prisma.interviewTranscriptMaterial.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ source: 'MANUAL_ENTRY', originalText: '面试官：请介绍项目' }) }),
    );
  });
});

describe('素材交付统一 INTERVIEW_EVAL 契约', () => {
  it('职位没有招聘要求时不发起评估（AI-5）', async () => {
    const { service, mocks } = makeService();
    mocks.prisma.job.findUnique.mockResolvedValue({ requirements: '  ' });
    await expect(service.deliverToInterviewEval(interview.id, link.id, {}, actor)).rejects.toBeInstanceOf(BadRequestException);
    expect(mocks.prisma.aIRun.create).not.toHaveBeenCalled();
  });

  it('按契约生成 INTERVIEW_EVAL 草稿任务，不重复存原文、不用内置纪要作结论', async () => {
    const { service, mocks } = makeService();
    const result = await service.deliverToInterviewEval(interview.id, link.id, {}, actor);
    const create = mocks.prisma.aIRun.create.mock.calls[0][0];
    expect(create.data).toMatchObject({
      type: 'INTERVIEW_EVAL',
      status: 'PENDING',
      isDraft: true,
      interviewId: interview.id,
    });
    const input = JSON.parse(create.data.inputRefs as string);
    expect(input).toMatchObject({
      schema: 'interview-eval.v1',
      scenario: 'INTERVIEW_EVAL',
      interview: { id: interview.id, round: 2, interviewerIds: ['i-1', 'i-2'] },
      jobRequirements: { jobId: 'job-1', text: '五年以上 Java 经验', truncated: false },
      feedback: [{ interviewerId: 'i-1', conclusion: 'PASS', content: '基础扎实', truncated: false }],
      transcript: {
        materialId: 'material-1',
        linkId: link.id,
        minutesId: 'a1b2c3d4e5f60718',
        source: 'DINGTALK',
        textRef: 'interview_transcript_materials.originalText',
        hasOriginalText: true,
        segmentCount: 1,
      },
      boundaries: {
        builtinMinutesSummaryUsedAsConclusion: false,
        aiOutputIsDraft: true,
        requiresManualConfirmation: true,
      },
    });
    expect(create.data.inputRefs).not.toContain('面试官：请介绍项目');
    expect(result.airRun).toMatchObject({ id: 'run-1', type: 'INTERVIEW_EVAL', isDraft: true });
  });

  it('没有素材时拒绝交付', async () => {
    const { service, mocks } = makeService();
    mocks.prisma.interviewTranscriptMaterial.findFirst.mockResolvedValue(null);
    await expect(service.deliverToInterviewEval(interview.id, link.id, {}, actor)).rejects.toBeInstanceOf(BadRequestException);
  });
});

import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  AiProviderError,
  AI_ERROR_CODES,
  type InterviewEvalRequest,
  type InterviewEvalResult,
  type ModelProvider,
  type ProviderCapabilities,
  type ResumeEvalRequest,
  type ResumeEvalResult,
  type ResumeParseRequest,
} from './model-provider.js';
import type {
  ParsedField,
  ResumeParseResult,
} from './ai.types.js';

const SKILL_POOL = [
  'TypeScript',
  'NestJS',
  'React',
  'MySQL',
  'Redis',
  '项目管理',
  '招聘运营',
];

const MISSING_POOL = [
  '简历未体现该岗位的核心项目规模',
  '缺少可核实的任职周期',
  '未说明团队管理与协作范围',
  '缺少与招聘要求对应的量化结果',
];

const INTERVIEW_MISSING_POOL = [
  '面试记录未覆盖岗位核心能力的追问',
  '部分评价缺少具体事实支撑',
  '候选人动机与稳定性未充分验证',
];

/**
 * 开发/测试默认模型实现（技术设计 §0.3）。
 *
 * 结果可复现：相同输入得到相同草稿；文件名含 "fail"、显式 mockOutcome=FAIL
 * 或构造时 forceOutcome=FAIL 时抛错，用于验证失败降级与重试链路。
 * Mock 不是正式模型验收证据，正式调用需配置真实 provider。
 */
@Injectable()
export class MockModelProvider implements ModelProvider {
  readonly name = 'mock';
  readonly kind = 'MOCK' as const;
  readonly capabilities: ProviderCapabilities = {
    text: true,
    image: true,
    structuredOutput: true,
  };

  constructor(private readonly forceOutcome: 'SUCCESS' | 'FAIL' = 'SUCCESS') {}

  async parseResume(request: ResumeParseRequest): Promise<ResumeParseResult> {
    const { input } = request;
    const forcedFailure =
      this.forceOutcome === 'FAIL' ||
      input.mockOutcome === 'FAIL' ||
      (input.mockOutcome === undefined && /fail|失败/i.test(input.fileName));
    if (forcedFailure) {
      throw new AiProviderError(
        'PARSE_FAILED',
        `Mock provider could not parse ${input.fileName}`,
        { provider: this.name },
      );
    }

    const seed = this.seed(`${input.resumeFileId ?? input.intakeId}:${input.fileName}`);
    const name = this.deriveName(input.fileName);
    const email = input.contactEmail?.trim().toLowerCase() ?? null;
    const phone = this.derivePhone(seed);
    const skills = [
      SKILL_POOL[parseInt(seed.slice(0, 2), 16) % SKILL_POOL.length],
      SKILL_POOL[parseInt(seed.slice(2, 4), 16) % SKILL_POOL.length],
    ].filter((skill, index, list) => list.indexOf(skill) === index);

    const output = {
      name: this.field(name, 0.92),
      phone: this.field(phone, 0.68),
      email: this.field(email, email ? 0.95 : 0.2),
      education: this.field(this.deriveEducation(seed), 0.55),
      school: this.field('示例大学', 0.5),
      experiences: [
        {
          company: '示例科技有限公司',
          title: '招聘专员',
          period: '2022-2024',
        },
      ],
      skills,
    };

    return {
      output,
      confidence: {
        name: output.name.confidence,
        phone: output.phone.confidence,
        email: output.email.confidence,
      },
      usage: this.usage(request.content.text, 120),
    };
  }

  async evaluateResume(request: ResumeEvalRequest): Promise<ResumeEvalResult> {
    this.assertNotForcedFailure('RESUME_EVAL');
    const seed = this.seed(
      `${request.input.candidate.id}:${request.input.job.id}:${request.input.resume.textHash}`,
    );
    const matched = parseInt(seed.slice(0, 2), 16) % 2 === 0;
    const score = (matched ? 3 + (parseInt(seed.slice(2, 3), 16) % 3) : 1 + (parseInt(seed.slice(2, 3), 16) % 2)) as
      | 1
      | 2
      | 3
      | 4
      | 5;
    const quote = (request.content.text ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);

    return {
      output: {
        verdict: matched ? '符合' : '不符合',
        score,
        rationale: matched
          ? `简历中的经历与“${request.input.job.title}”的招聘要求存在可核对的重合，匹配分为参考信号，需人工复核。`
          : `简历未覆盖“${request.input.job.title}”招聘要求中的关键条件，建议人工核对缺失项后再判断。`,
        missingPoints: matched
          ? []
          : [MISSING_POOL[parseInt(seed.slice(3, 5), 16) % MISSING_POOL.length]],
        ...(quote ? { evidence: [{ quote, sourceRef: `resume:${request.input.resume.fileId}` }] } : {}),
        confidence: 0.72,
      },
      confidence: { verdict: 0.72, score: 0.65 },
      usage: this.usage(request.content.text, 200),
    };
  }

  async evaluateInterview(request: InterviewEvalRequest): Promise<InterviewEvalResult> {
    this.assertNotForcedFailure('INTERVIEW_EVAL');
    const seed = this.seed(
      `${request.input.interview.id}:${request.input.transcript.materialId}:${request.input.transcript.textHash}`,
    );
    const options = ['建议录用', '不建议', '待定'] as const;
    const suggestion = options[parseInt(seed.slice(0, 2), 16) % options.length];
    const sourceRef = request.allowedSourceRefs[0] ?? '';
    const quote = request.transcriptText.replace(/\s+/g, ' ').trim().slice(0, 120);

    return {
      output: {
        suggestion,
        rationale:
          '依据听记转写与面试评价上下文给出参考建议；钉钉听记内置智能纪要未作为评估结论，最终结论由人工确认。',
        evidence: sourceRef && quote ? [{ quote, sourceRef }] : [],
        missingPoints: [INTERVIEW_MISSING_POOL[parseInt(seed.slice(2, 4), 16) % INTERVIEW_MISSING_POOL.length]],
        confidence: 0.6,
      },
      confidence: { suggestion: 0.6 },
      usage: this.usage(request.transcriptText, 260),
    };
  }

  private assertNotForcedFailure(scene: string): void {
    if (this.forceOutcome === 'FAIL') {
      throw new AiProviderError(
        'AI_MOCK_FORCED_FAILURE',
        `Mock provider forced failure for ${scene}`,
        { provider: this.name },
      );
    }
  }

  private usage(text: string | null, completionTokens: number) {
    return {
      provider: this.name,
      model: 'mock-ai-v1',
      latencyMs: 1,
      promptTokens: Math.ceil((text?.length ?? 0) / 4),
      completionTokens,
      costMicros: 0,
    };
  }

  private seed(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private field<T>(value: T | null, confidence: number): ParsedField<T> {
    return { value, confidence };
  }

  private deriveName(fileName: string): string {
    const base = fileName
      .replace(/\.[^.]+$/, '')
      .replace(/(简历|resume|cv|附件)/gi, ' ')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return base.length > 0 ? base : '待解析候选人';
  }

  private derivePhone(seed: string): string {
    const digits = BigInt(`0x${seed.slice(0, 12)}`)
      .toString()
      .slice(0, 8)
      .padStart(8, '0');
    return `138${digits}`;
  }

  private deriveEducation(seed: string): string {
    const options = ['本科', '硕士', '大专'];
    return options[parseInt(seed.slice(4, 6), 16) % options.length];
  }
}

export const mockProviderErrorCodes = AI_ERROR_CODES;

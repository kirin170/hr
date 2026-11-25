import type {
  AiUsage,
  ParseResumeInput,
  ResumeContent,
  ResumeParseResult,
} from './ai.types.js';
import type {
  AiValidationWarning,
  InterviewEvalInputLike,
  InterviewEvalOutput,
  ResumeEvalInput,
  ResumeEvalOutput,
} from './ai.contract.js';

export const MODEL_PROVIDER = Symbol('MODEL_PROVIDER');

export type AiProviderKind = 'MOCK' | 'DASHSCOPE_QWEN' | 'OPENAI_COMPATIBLE';

export interface ProviderCapabilities {
  text: boolean;
  image: boolean;
  structuredOutput: boolean;
}

/** 单个 provider 端点配置：密钥只引用环境变量名，配置与响应不返回明文。 */
export interface ProviderEndpointConfig {
  kind: AiProviderKind;
  label: string;
  baseUrl: string;
  model: string;
  apiKeyEnv: string;
  timeoutMs: number;
  maxOutputTokens: number;
  inputMicrosPer1kTokens: number;
  outputMicrosPer1kTokens: number;
  supportsVision: boolean;
  enabled: boolean;
}

export interface ResumeParseRequest {
  input: ParseResumeInput;
  content: ResumeContent;
}

export interface ResumeEvalRequest {
  input: ResumeEvalInput;
  content: ResumeContent;
}

export interface InterviewEvalRequest {
  input: InterviewEvalInputLike;
  transcriptText: string;
  /** 允许被 evidence 引用的原文定位（素材 sourceRef + segment:<index>） */
  allowedSourceRefs: string[];
}

export interface ResumeEvalResult {
  output: ResumeEvalOutput;
  confidence: Record<string, number>;
  warnings?: AiValidationWarning[];
  usage?: AiUsage;
}

export interface InterviewEvalResult {
  output: InterviewEvalOutput;
  confidence: Record<string, number>;
  warnings?: AiValidationWarning[];
  usage?: AiUsage;
}

/** 可替换的模型适配层（技术设计 §0.3 / §8.2），换模型不影响主流程 */
export interface ModelProvider {
  readonly name: string;
  readonly kind: AiProviderKind;
  readonly capabilities: ProviderCapabilities;
  parseResume(request: ResumeParseRequest): Promise<ResumeParseResult>;
  evaluateResume(request: ResumeEvalRequest): Promise<ResumeEvalResult>;
  evaluateInterview(request: InterviewEvalRequest): Promise<InterviewEvalResult>;
}

/** 一次 provider 尝试的失败明细（主选/兜底链路留痕） */
export interface AiProviderAttempt {
  provider: string;
  code: string;
  message: string;
  retryable: boolean;
  latencyMs: number;
}

/** 错误码统一带 AI_ 前缀，便于降级策略与后台展示区分失败原因。 */
export class AiProviderError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly options: { retryable?: boolean; status?: number; provider?: string } = {},
  ) {
    super(message);
    this.name = 'AiProviderError';
  }

  get retryable(): boolean {
    return this.options.retryable ?? true;
  }
}

export const AI_ERROR_CODES = {
  DISABLED: 'AI_DISABLED',
  REQUIREMENTS_MISSING: 'AI_REQUIREMENTS_MISSING',
  JOB_DISABLED: 'AI_JOB_DISABLED',
  CONTENT_UNSUPPORTED: 'AI_CONTENT_UNSUPPORTED',
  NOT_CONFIGURED: 'AI_PROVIDER_NOT_CONFIGURED',
  CAPABILITY_UNSUPPORTED: 'AI_CAPABILITY_UNSUPPORTED',
  TIMEOUT: 'AI_PROVIDER_TIMEOUT',
  HTTP_ERROR: 'AI_PROVIDER_HTTP_ERROR',
  BAD_RESPONSE: 'AI_PROVIDER_BAD_RESPONSE',
  ALL_FAILED: 'AI_ALL_PROVIDERS_FAILED',
  OUTPUT_INVALID: 'AI_OUTPUT_INVALID',
  INTERNAL: 'AI_INTERNAL_ERROR',
} as const;

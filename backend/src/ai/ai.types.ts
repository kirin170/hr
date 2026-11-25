/** AI 任务场景（PRD §6.2） */
export type AiTaskType = 'RESUME_PARSE' | 'RESUME_EVAL' | 'INTERVIEW_EVAL';

/** Mock 场景下显式指定结果，便于演示成功/失败两条链路 */
export type MockOutcome = 'SUCCESS' | 'FAIL';

export interface ParsedField<T> {
  value: T | null;
  confidence: number;
}

export interface ParsedExperience {
  company: string;
  title: string;
  period?: string;
}

/** RESUME_PARSE 输出契约（PRD §6.2） */
export interface ParsedResume {
  name: ParsedField<string>;
  phone: ParsedField<string>;
  email: ParsedField<string>;
  education: ParsedField<string>;
  school: ParsedField<string>;
  experiences: ParsedExperience[];
  skills: string[];
}

export interface ParseResumeInput {
  schema?: string;
  intakeId: string;
  resumeFileId: string | null;
  fileName: string;
  mimeType?: string | null;
  jobId?: string | null;
  contactEmail?: string | null;
  mockOutcome?: MockOutcome;
}

/**
 * 简历内容：文本（PDF/Word/纯文本抽取）或多模态图片。
 * 图片走 provider 的 vision 能力；无 OCR 时不落文本，避免伪造解析结果。
 */
export interface ResumeContent {
  text: string | null;
  imageDataUrl: string | null;
  mimeType: string;
  sourceRef: string;
  truncated: boolean;
  textHash: string;
}

/** 一次调用的成本/延迟/能力记录（ATS-021 据实记录） */
export interface AiUsage {
  provider: string;
  model: string;
  latencyMs: number;
  promptTokens: number | null;
  completionTokens: number | null;
  costMicros: number | null;
}

export interface ResumeParseResult {
  output: ParsedResume;
  confidence: Record<string, number>;
  warnings?: { path: string; code: string; message: string }[];
  usage?: AiUsage;
}

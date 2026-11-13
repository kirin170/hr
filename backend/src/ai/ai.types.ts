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
  intakeId: string;
  resumeFileId: string | null;
  fileName: string;
  mimeType?: string | null;
  jobId?: string | null;
  contactEmail?: string | null;
  mockOutcome?: MockOutcome;
}

export interface ResumeParseResult {
  output: ParsedResume;
  confidence: Record<string, number>;
}

/**
 * INTERVIEW_EVAL 统一输入契约（PRD §6.2 / DT-4）。
 *
 * 听记素材只作为评估输入：摘要与原文都按轮次留存在 `InterviewTranscriptMaterial`，
 * `inputRefs` 只保存素材引用与来源标识，避免同一份原文重复落库或进入日志。
 * 钉钉听记内置智能纪要不得作为评估结论：`boundaries` 显式写死，AI 输出仍为草稿。
 */

export const INTERVIEW_EVAL_SCHEMA = 'interview-eval.v1';
const MAX_REQUIREMENTS_CHARS = 16_000;
const MAX_FEEDBACK_ITEMS = 20;
const MAX_FEEDBACK_CHARS = 4_000;

export type InterviewEvalTranscriptSource = 'DINGTALK' | 'MANUAL_ENTRY';

export interface InterviewEvalInterviewRef {
  id: string;
  candidateId: string;
  jobId: string;
  round: number;
  mode: string;
  startAt: string;
  endAt: string | null;
  interviewerIds: string[];
}

export interface InterviewEvalMaterialRef {
  materialId: string;
  linkId: string;
  minutesId: string | null;
  source: InterviewEvalTranscriptSource;
  sourceRef: string;
  title: string | null;
  fetchedAt: string;
  /** 原文/摘要正文存于 InterviewTranscriptMaterial，AI 任务按 materialId 回读 */
  textRef: 'interview_transcript_materials.originalText';
  hasOriginalText: boolean;
  hasSummary: boolean;
  textLength: number;
  textHash: string;
  segmentCount: number;
}

export interface InterviewEvalInput {
  schema: typeof INTERVIEW_EVAL_SCHEMA;
  scenario: 'INTERVIEW_EVAL';
  interview: InterviewEvalInterviewRef;
  jobRequirements: { jobId: string; text: string; truncated: boolean };
  feedback: { interviewerId: string; conclusion: string | null; content: string; truncated: boolean }[];
  transcript: InterviewEvalMaterialRef;
  boundaries: {
    builtinMinutesSummaryUsedAsConclusion: false;
    aiOutputIsDraft: true;
    requiresManualConfirmation: true;
  };
}

export interface InterviewEvalMaterialSnapshot {
  id: string;
  linkId: string;
  minutesId: string | null;
  source: InterviewEvalTranscriptSource;
  sourceRef: string;
  title: string | null;
  fetchedAt: Date;
  summary: string | null;
  originalText: string | null;
  contentHash: string;
  segmentCount: number;
}

export function buildInterviewEvalInput(params: {
  interview: InterviewEvalInterviewRef;
  requirements: string | null;
  feedback: { interviewerId: string; conclusion: string | null; content: string }[];
  material: InterviewEvalMaterialSnapshot;
}): InterviewEvalInput {
  const requirements = clip(params.requirements ?? '', MAX_REQUIREMENTS_CHARS);
  const feedback = params.feedback.slice(0, MAX_FEEDBACK_ITEMS).map((item) => {
    const content = clip(item.content, MAX_FEEDBACK_CHARS);
    return {
      interviewerId: item.interviewerId,
      conclusion: item.conclusion,
      content: content.text,
      truncated: content.truncated,
    };
  });
  const textLength = (params.material.originalText ?? params.material.summary ?? '').length;
  return {
    schema: INTERVIEW_EVAL_SCHEMA,
    scenario: 'INTERVIEW_EVAL',
    interview: params.interview,
    jobRequirements: {
      jobId: params.interview.jobId,
      text: requirements.text,
      truncated: requirements.truncated,
    },
    feedback,
    transcript: {
      materialId: params.material.id,
      linkId: params.material.linkId,
      minutesId: params.material.minutesId,
      source: params.material.source,
      sourceRef: params.material.sourceRef,
      title: params.material.title,
      fetchedAt: params.material.fetchedAt.toISOString(),
      textRef: 'interview_transcript_materials.originalText',
      hasOriginalText: Boolean(params.material.originalText),
      hasSummary: Boolean(params.material.summary),
      textLength,
      textHash: params.material.contentHash,
      segmentCount: params.material.segmentCount,
    },
    boundaries: {
      builtinMinutesSummaryUsedAsConclusion: false,
      aiOutputIsDraft: true,
      requiresManualConfirmation: true,
    },
  };
}

function clip(value: string, max: number): { text: string; truncated: boolean } {
  if (value.length <= max) return { text: value, truncated: false };
  return { text: value.slice(0, max), truncated: true };
}

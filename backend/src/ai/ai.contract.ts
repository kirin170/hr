import type { ParsedResume } from './ai.types.js';

/**
 * AI 三场景统一契约（PRD §6.2 / 功能需求 §4.12）。
 *
 * - 所有场景输出均为草稿，必须人工显式确认（AI-1/AI-6）；
 * - 评估类输出必须包含依据与缺失项（AI-3/AI-8），面试依据需可回原文；
 * - 契约版本随输入一起留存，便于回溯与灰度升级模板。
 */
export const AI_CONTRACT_VERSION = 'ai-contract.v1';
export const RESUME_PARSE_SCHEMA = 'resume-parse.v1';
export const RESUME_EVAL_SCHEMA = 'resume-eval.v1';
export const INTERVIEW_EVAL_SCHEMA = 'interview-eval.v1';

export const AI_BOUNDARIES = {
  aiOutputIsDraft: true,
  requiresManualConfirmation: true,
  noAutoStageChange: true,
  noOaConclusion: true,
  noAutoHireDecision: true,
} as const;

export type AiScene = 'RESUME_PARSE' | 'RESUME_EVAL' | 'INTERVIEW_EVAL';

export interface AiValidationWarning {
  path: string;
  code: string;
  message: string;
}

export class AiContractError extends Error {
  readonly code = 'AI_OUTPUT_INVALID';

  constructor(
    readonly scene: AiScene,
    readonly issues: AiValidationWarning[],
  ) {
    super(
      `AI ${scene} output rejected: ${issues
        .slice(0, 3)
        .map((issue) => `${issue.path} ${issue.message}`)
        .join('; ')}`,
    );
    this.name = 'AiContractError';
  }
}

export interface EvidenceRef {
  /** 原文引用片段，用于人工核对 */
  quote: string;
  /** 可回原文的定位：听记素材 sourceRef 或 segment:<index> */
  sourceRef: string;
}

export interface ResumeEvalOutput {
  verdict: '符合' | '不符合';
  score: 1 | 2 | 3 | 4 | 5;
  rationale: string;
  missingPoints: string[];
  evidence?: EvidenceRef[];
  /** 判断置信度，仅辅助核对，不参与自动转正式 */
  confidence?: number;
}

export interface InterviewEvalOutput {
  suggestion: '建议录用' | '不建议' | '待定';
  rationale: string;
  evidence: EvidenceRef[];
  missingPoints: string[];
  confidence?: number;
}

export interface ResumeEvalInput {
  schema: typeof RESUME_EVAL_SCHEMA;
  contractVersion: typeof AI_CONTRACT_VERSION;
  scenario: 'RESUME_EVAL';
  candidate: { id: string; name: string | null };
  job: { id: string; title: string; requirements: string; requirementsTruncated: boolean };
  resume: {
    fileId: string;
    fileName: string;
    mimeType: string;
    textRef: 'resume_files.storageKey';
    textLength: number;
    textHash: string;
    textTruncated: boolean;
  };
  boundaries: typeof AI_BOUNDARIES;
}

/** 听记评估契约的结构化视图（由 ATS-020 的 interview-eval.contract 构建后落库） */
export interface InterviewEvalInputLike {
  schema: string;
  scenario: 'INTERVIEW_EVAL';
  interview: {
    id: string;
    candidateId: string;
    jobId: string;
    round: number;
    mode: string;
    startAt: string;
    endAt: string | null;
    interviewerIds: string[];
  };
  jobRequirements: { jobId: string; text: string; truncated: boolean };
  feedback: { interviewerId: string; conclusion: string | null; content: string; truncated: boolean }[];
  transcript: {
    materialId: string;
    linkId: string;
    minutesId: string | null;
    source: string;
    sourceRef: string;
    title: string | null;
    fetchedAt: string;
    textRef: string;
    hasOriginalText: boolean;
    hasSummary: boolean;
    textLength: number;
    textHash: string;
    segmentCount: number;
  };
  boundaries: Record<string, boolean>;
}

const MAX_REQUIREMENTS_CHARS = 16_000;
const MAX_RATIONALE_CHARS = 4_000;
const MAX_POINTS = 20;
const MAX_QUOTE_CHARS = 500;
const MAX_SOURCE_REF_CHARS = 300;
const PHONE_PATTERN = /^(\+?\d[\d\s-]{5,19})$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 校验 RESUME_PARSE 输出，返回规范化结果与字段级告警（电话/邮箱格式）。 */
export function validateResumeParse(value: unknown): {
  output: ParsedResume;
  warnings: AiValidationWarning[];
} {
  const issues: AiValidationWarning[] = [];
  const root = asRecord(value, 'output', issues);
  const warnings: AiValidationWarning[] = [];
  const field = <T>(name: string, normalize: (v: string) => T): { value: T | null; confidence: number } => {
    const raw = asRecord(root[name], name, issues);
    const rawValue = raw.value;
    if (rawValue !== null && typeof rawValue !== 'string') {
      issues.push({ path: `${name}.value`, code: 'TYPE', message: '必须为文本或 null' });
    }
    const confidence = numberInRange(raw.confidence, `${name}.confidence`, 0, 1, issues);
    let parsed: T | null = null;
    if (typeof rawValue === 'string' && rawValue.trim()) {
      parsed = normalize(rawValue.trim());
    }
    return { value: parsed, confidence: confidence ?? 0 };
  };

  const name = field('name', (v) => v.slice(0, 80));
  const phone = field('phone', (v) => v.slice(0, 40));
  const email = field('email', (v) => v.slice(0, 160).toLowerCase());
  const education = field('education', (v) => v.slice(0, 40));
  const school = field('school', (v) => v.slice(0, 120));

  if (phone.value && !PHONE_PATTERN.test(phone.value)) {
    warnings.push({ path: 'phone', code: 'FORMAT', message: '电话格式不符合常见格式，已降低置信度待人工核对' });
    phone.confidence = Math.min(phone.confidence, 0.3);
  }
  if (email.value && !EMAIL_PATTERN.test(email.value)) {
    warnings.push({ path: 'email', code: 'FORMAT', message: '邮箱格式不符合常见格式，已降低置信度待人工核对' });
    email.confidence = Math.min(email.confidence, 0.3);
  }

  const experiencesRaw = root.experiences;
  if (!Array.isArray(experiencesRaw) || experiencesRaw.length > 30) {
    issues.push({ path: 'experiences', code: 'TYPE', message: '必须为不超过 30 项的数组' });
  }
  const experiences = (Array.isArray(experiencesRaw) ? experiencesRaw : [])
    .map((item, index) => {
      const record = asRecord(item, `experiences[${index}]`, issues);
      const company = requiredText(record.company, `experiences[${index}].company`, issues, 120);
      const title = requiredText(record.title, `experiences[${index}].title`, issues, 120);
      const period =
        typeof record.period === 'string' && record.period.trim()
          ? record.period.trim().slice(0, 60)
          : undefined;
      return { company: company ?? '', title: title ?? '', ...(period ? { period } : {}) };
    })
    .filter((item) => item.company && item.title);

  const skillsRaw = root.skills;
  if (!Array.isArray(skillsRaw) || skillsRaw.length > 50) {
    issues.push({ path: 'skills', code: 'TYPE', message: '必须为不超过 50 项的数组' });
  }
  const skills = Array.from(
    new Set(
      (Array.isArray(skillsRaw) ? skillsRaw : [])
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim().slice(0, 60))
        .filter(Boolean),
    ),
  );

  if (issues.length > 0) throw new AiContractError('RESUME_PARSE', issues);

  return {
    output: {
      name,
      phone,
      email,
      education,
      school,
      experiences,
      skills,
    },
    warnings,
  };
}

/** 校验 RESUME_EVAL 输出：verdict/score/rationale/missingPoints 必填，evidence 可选。 */
export function validateResumeEval(value: unknown): {
  output: ResumeEvalOutput;
  warnings: AiValidationWarning[];
} {
  const issues: AiValidationWarning[] = [];
  const warnings: AiValidationWarning[] = [];
  const root = asRecord(value, 'output', issues);

  const verdict = root.verdict;
  if (verdict !== '符合' && verdict !== '不符合') {
    issues.push({ path: 'verdict', code: 'ENUM', message: '必须为“符合”或“不符合”' });
  }
  const score = root.score;
  if (typeof score !== 'number' || !Number.isInteger(score) || score < 1 || score > 5) {
    issues.push({ path: 'score', code: 'RANGE', message: '必须为 1–5 的整数' });
  }
  const rationale = requiredText(root.rationale, 'rationale', issues, MAX_RATIONALE_CHARS);
  const missingPoints = textList(root.missingPoints, 'missingPoints', issues);
  const evidence = optionalEvidence(root.evidence, issues);
  const confidence = optionalConfidence(root.confidence, issues);

  if (issues.length > 0) throw new AiContractError('RESUME_EVAL', issues);

  if (verdict === '不符合' && missingPoints.length === 0) {
    warnings.push({ path: 'missingPoints', code: 'EMPTY', message: '判定不符合但未列出缺失项，需人工补充核对' });
  }
  if (verdict === '符合' && score === 1) {
    warnings.push({ path: 'score', code: 'INCONSISTENT', message: '判定符合但匹配分仅 1 分，需人工核对' });
  }

  return {
    output: {
      verdict: verdict as ResumeEvalOutput['verdict'],
      score: score as ResumeEvalOutput['score'],
      rationale: rationale ?? '',
      missingPoints,
      ...(evidence ? { evidence } : {}),
      ...(confidence === null ? {} : { confidence }),
    },
    warnings,
  };
}

/**
 * 校验 INTERVIEW_EVAL 输出。
 * evidence 必须可回原文：sourceRef 只能取素材 sourceRef 或 `segment:<index>`。
 */
export function validateInterviewEval(
  value: unknown,
  allowedSourceRefs: string[],
): {
  output: InterviewEvalOutput;
  warnings: AiValidationWarning[];
} {
  const issues: AiValidationWarning[] = [];
  const warnings: AiValidationWarning[] = [];
  const root = asRecord(value, 'output', issues);

  const suggestion = root.suggestion;
  if (suggestion !== '建议录用' && suggestion !== '不建议' && suggestion !== '待定') {
    issues.push({ path: 'suggestion', code: 'ENUM', message: '必须为“建议录用”“不建议”或“待定”' });
  }
  const rationale = requiredText(root.rationale, 'rationale', issues, MAX_RATIONALE_CHARS);
  const missingPoints = textList(root.missingPoints, 'missingPoints', issues);
  const evidence = requiredEvidence(root.evidence, issues, allowedSourceRefs);
  const confidence = optionalConfidence(root.confidence, issues);

  if (issues.length > 0) throw new AiContractError('INTERVIEW_EVAL', issues);

  if (evidence.length === 0) {
    warnings.push({ path: 'evidence', code: 'EMPTY', message: '未给出可回原文的依据，需人工补充核对' });
  }
  if (suggestion !== '待定' && missingPoints.length === 0) {
    warnings.push({ path: 'missingPoints', code: 'EMPTY', message: '未列出缺失项，需人工核对信息完整性' });
  }

  return {
    output: {
      suggestion: suggestion as InterviewEvalOutput['suggestion'],
      rationale: rationale ?? '',
      evidence,
      missingPoints,
      ...(confidence === null ? {} : { confidence }),
    },
    warnings,
  };
}

export function buildResumeEvalInput(params: {
  candidate: { id: string; name: string | null };
  job: { id: string; title: string; requirements: string | null };
  resume: {
    fileId: string;
    fileName: string;
    mimeType: string;
    textLength: number;
    textHash: string;
    textTruncated: boolean;
  };
}): ResumeEvalInput {
  const clipped = clip(params.job.requirements ?? '', MAX_REQUIREMENTS_CHARS);
  return {
    schema: RESUME_EVAL_SCHEMA,
    contractVersion: AI_CONTRACT_VERSION,
    scenario: 'RESUME_EVAL',
    candidate: params.candidate,
    job: {
      id: params.job.id,
      title: params.job.title,
      requirements: clipped.text,
      requirementsTruncated: clipped.truncated,
    },
    resume: {
      fileId: params.resume.fileId,
      fileName: params.resume.fileName,
      mimeType: params.resume.mimeType,
      textRef: 'resume_files.storageKey',
      textLength: params.resume.textLength,
      textHash: params.resume.textHash,
      textTruncated: params.resume.textTruncated,
    },
    boundaries: AI_BOUNDARIES,
  };
}

export function clip(value: string, max: number): { text: string; truncated: boolean } {
  if (value.length <= max) return { text: value, truncated: false };
  return { text: value.slice(0, max), truncated: true };
}

function asRecord(value: unknown, path: string, issues: AiValidationWarning[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    issues.push({ path, code: 'TYPE', message: '必须为对象' });
    return {};
  }
  return value as Record<string, unknown>;
}

function numberInRange(
  value: unknown,
  path: string,
  min: number,
  max: number,
  issues: AiValidationWarning[],
): number | null {
  if (typeof value !== 'number' || Number.isNaN(value) || value < min || value > max) {
    issues.push({ path, code: 'RANGE', message: `必须为 ${min}–${max} 的数字` });
    return null;
  }
  return value;
}

function requiredText(
  value: unknown,
  path: string,
  issues: AiValidationWarning[],
  max: number,
): string | null {
  if (typeof value !== 'string' || !value.trim()) {
    issues.push({ path, code: 'REQUIRED', message: '必须为非空文本' });
    return null;
  }
  if (value.length > max) {
    issues.push({ path, code: 'LENGTH', message: `不能超过 ${max} 个字符` });
    return null;
  }
  return value.trim();
}

function textList(value: unknown, path: string, issues: AiValidationWarning[]): string[] {
  if (!Array.isArray(value) || value.length > MAX_POINTS) {
    issues.push({ path, code: 'TYPE', message: `必须为不超过 ${MAX_POINTS} 项的数组` });
    return [];
  }
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().slice(0, 300))
    .filter(Boolean);
}

function optionalEvidence(
  value: unknown,
  issues: AiValidationWarning[],
): EvidenceRef[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > MAX_POINTS) {
    issues.push({ path: 'evidence', code: 'TYPE', message: `必须为不超过 ${MAX_POINTS} 项的数组` });
    return undefined;
  }
  return value.map((item, index) => {
    const record = asRecord(item, `evidence[${index}]`, issues);
    return {
      quote: requiredText(record.quote, `evidence[${index}].quote`, issues, MAX_QUOTE_CHARS) ?? '',
      sourceRef:
        requiredText(record.sourceRef, `evidence[${index}].sourceRef`, issues, MAX_SOURCE_REF_CHARS) ?? '',
    };
  });
}

function requiredEvidence(
  value: unknown,
  issues: AiValidationWarning[],
  allowedSourceRefs: string[],
): EvidenceRef[] {
  const evidence = optionalEvidence(value, issues) ?? [];
  if (value === undefined) {
    issues.push({ path: 'evidence', code: 'REQUIRED', message: '必须提供可回原文的依据' });
  }
  const allowed = new Set(allowedSourceRefs);
  evidence.forEach((item, index) => {
    if (item.sourceRef && allowed.size > 0 && !allowed.has(item.sourceRef)) {
      issues.push({
        path: `evidence[${index}].sourceRef`,
        code: 'UNTRACEABLE',
        message: '必须指向本次听记素材或 segment:<index>',
      });
    }
  });
  return evidence;
}

function optionalConfidence(value: unknown, issues: AiValidationWarning[]): number | null {
  if (value === undefined) return null;
  return numberInRange(value, 'confidence', 0, 1, issues);
}

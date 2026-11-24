/**
 * ATS-023 报表指标口径的纯函数。
 *
 * 与数据库无关，便于单测复算：同一份原始数据，报表接口与测试用例必须得到同一组数字。
 */

/** 漏斗环节顺序：只统计流程内阶段，已归档、待分配池不计入漏斗。 */
export const FUNNEL_STAGES = [
  'RECOMMENDED',
  'HR_SCREENING',
  'DEPT_SCREENING',
  'INTERVIEWING',
  'OFFERING',
  'PENDING_ONBOARD',
  'ONBOARDED',
  'PROBATION',
  'ENDED',
] as const;

export const FUNNEL_LABELS: Record<(typeof FUNNEL_STAGES)[number], string> = {
  RECOMMENDED: '新简历',
  HR_SCREENING: 'HR 初筛',
  DEPT_SCREENING: '部门筛选',
  INTERVIEWING: '面试中',
  OFFERING: 'Offer 中',
  PENDING_ONBOARD: '待入职',
  ONBOARDED: '已入职',
  PROBATION: '试用期',
  ENDED: '已结束',
};

const STAGE_RANK = new Map<string, number>(FUNNEL_STAGES.map((stage, index) => [stage, index]));

/** 阶段推进程度；不在流程内的阶段（归档、待分配池）返回 -1。 */
export function stageRank(stage: string | null | undefined): number {
  if (!stage) return -1;
  return STAGE_RANK.get(stage) ?? -1;
}

/** 中位数：偶数个取中间两个的均值，空数组返回 null。 */
export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export type CycleSummary = {
  count: number;
  /** 均值保留一位小数，与页面展示一致 */
  average: number | null;
  median: number | null;
  max: number | null;
  min: number | null;
};

/** 周期汇总：均值/中位数/最长/最短，空集合全部为 null 而不是 0。 */
export function summarize(days: number[]): CycleSummary {
  if (!days.length) return { count: 0, average: null, median: null, max: null, min: null };
  const total = days.reduce((sum, value) => sum + value, 0);
  return {
    count: days.length,
    average: Math.round((total / days.length) * 10) / 10,
    median: median(days),
    max: Math.max(...days),
    min: Math.min(...days),
  };
}

/** 百分比：分母为 0 时返回 null，避免展示 0% 误导。 */
export function percentage(numerator: number, denominator: number): number | null {
  if (!denominator) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

/** 月维度键：按 UTC 口径输出 YYYY-MM。 */
export function monthKey(value: Date): string {
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}`;
}

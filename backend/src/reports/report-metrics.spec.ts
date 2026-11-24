import { describe, expect, it } from 'vitest';
import { calculateCycleDays, isClosedBeforeStart, parseDateOnly } from '../requisitions/requisition-cycle.js';
import {
  FUNNEL_STAGES,
  median,
  monthKey,
  percentage,
  stageRank,
  summarize,
} from './report-metrics.js';

const day = (value: string) => parseDateOnly(value)!;

/**
 * ATS-023 可复算基线样本。
 *
 * 需求周期原始样本（开始招聘 → 关闭）：
 *   需求 A 2026-11-01 → 2026-11-02 = 1 天
 *   需求 B 2026-11-01 → 2026-11-16 = 15 天
 *   需求 C 2026-01-31 → 2026-03-01 = 29 天
 *   需求 D 2025-12-20 → 2026-01-05 = 16 天
 * 期望：条数 4、均值 15.3、中位数 15.5、最长 29、最短 1。
 * 该数字同时出现在 docs/verification/ats023-report.json，避免报表与文档口径漂移。
 */
const CYCLE_SAMPLE = [
  ['2026-11-01', '2026-11-02'],
  ['2026-11-01', '2026-11-16'],
  ['2026-01-31', '2026-03-01'],
  ['2025-12-20', '2026-01-05'],
] as const;

describe('ATS-023 指标口径', () => {
  it('周期基线与可复算样本一致', () => {
    const days = CYCLE_SAMPLE.map(([start, closed]) => calculateCycleDays(day(start), day(closed)));
    expect(days).toEqual([1, 15, 29, 16]);
    expect(summarize(days)).toEqual({ count: 4, average: 15.3, median: 15.5, max: 29, min: 1 });
  });

  it('空集合的均值/中位数/最长/最短为 null，不虚报 0', () => {
    expect(summarize([])).toEqual({ count: 0, average: null, median: null, max: null, min: null });
  });

  it('中位数奇数取中间值，偶数取中间两个的均值', () => {
    expect(median([5])).toBe(5);
    expect(median([1, 3, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
  });

  it('百分比分母为 0 返回 null，保留一位小数', () => {
    expect(percentage(1, 0)).toBeNull();
    expect(percentage(5, 8)).toBe(62.5);
    expect(percentage(1, 3)).toBe(33.3);
  });

  it('漏斗按当前阶段回填累计到达人数', () => {
    // 5 个流程内候选人：新简历 1、HR 初筛 1、部门筛选 1、面试中 1、已入职 1
    const stages = ['RECOMMENDED', 'HR_SCREENING', 'DEPT_SCREENING', 'INTERVIEWING', 'ONBOARDED'];
    const rankCounts = new Map<number, number>();
    for (const stage of stages) {
      for (let index = 0; index <= stageRank(stage); index += 1) {
        rankCounts.set(index, (rankCounts.get(index) ?? 0) + 1);
      }
    }
    expect(FUNNEL_STAGES.map((_, index) => rankCounts.get(index) ?? 0)).toEqual([5, 4, 3, 2, 1, 1, 1, 0, 0]);
    expect(percentage(1, 5)).toBe(20);
  });

  it('归档与待分配池不计入漏斗', () => {
    expect(stageRank('ARCHIVED')).toBe(-1);
    expect(stageRank('UNASSIGNED')).toBe(-1);
    expect(stageRank('VIRTUAL_POOL')).toBe(-1);
    expect(stageRank(null)).toBe(-1);
    expect(stageRank('INTERVIEWING')).toBe(3);
  });

  it('关闭早于开始的需求不进入周期统计', () => {
    expect(isClosedBeforeStart(day('2026-11-16'), day('2026-11-15'))).toBe(true);
    expect(isClosedBeforeStart(day('2026-11-16'), day('2026-11-16'))).toBe(false);
  });

  it('时间段维度按 UTC 月份归组', () => {
    expect(monthKey(day('2026-01-31'))).toBe('2026-01');
    expect(monthKey(day('2026-12-01'))).toBe('2026-12');
  });
});

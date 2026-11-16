import { describe, expect, it } from 'vitest';
import {
  calculateCycleDays,
  calculateInProgressDays,
  isClosedBeforeStart,
  parseDateOnly,
  parseDateValue,
  toDateOnly,
} from './requisition-cycle.js';

const day = (value: string) => parseDateOnly(value)!;

describe('招聘需求周期计算（FR-REQ-5 / REQ-0）', () => {
  it('同日关闭计 1 天', () => {
    expect(calculateCycleDays(day('2026-11-16'), day('2026-11-16'))).toBe(1);
  });

  it('多日按自然日差不额外累加首尾日', () => {
    expect(calculateCycleDays(day('2026-11-01'), day('2026-11-16'))).toBe(15);
    expect(calculateCycleDays(day('2026-11-01'), day('2026-11-02'))).toBe(1);
  });

  it('跨月与跨年按日期差计算', () => {
    expect(calculateCycleDays(day('2026-01-31'), day('2026-03-01'))).toBe(29);
    expect(calculateCycleDays(day('2025-12-20'), day('2026-01-05'))).toBe(16);
  });

  it('关闭时间早于开始招聘时间属于非法日期', () => {
    expect(isClosedBeforeStart(day('2026-11-16'), day('2026-11-15'))).toBe(true);
    expect(isClosedBeforeStart(day('2026-11-16'), day('2026-11-16'))).toBe(false);
  });

  it('进行中天数按当天减开始招聘时间，不计入周期', () => {
    expect(calculateInProgressDays(day('2026-11-10'), day('2026-11-16'))).toBe(6);
    expect(calculateInProgressDays(day('2026-11-16'), day('2026-11-16'))).toBe(0);
  });

  it('非法日期与非法格式被拒绝', () => {
    expect(parseDateOnly('2026-02-30')).toBeNull();
    expect(parseDateOnly('2026-13-01')).toBeNull();
    expect(parseDateOnly('2026/11/16')).toBeNull();
    expect(parseDateOnly('')).toBeNull();
    expect(parseDateOnly(20261116)).toBeNull();
    expect(parseDateOnly('2026-11-16')).toEqual(new Date(Date.UTC(2026, 10, 16)));
    expect(parseDateValue('2026-02-30')).toBeNull();
  });

  it('ISO 时间字符串归一化到当日，日期输出保持 YYYY-MM-DD', () => {
    const parsed = parseDateValue('2026-11-16T08:30:00.000Z');
    expect(toDateOnly(parsed)).toBe('2026-11-16');
    expect(toDateOnly(parseDateValue('2026-11-16'))).toBe('2026-11-16');
    expect(toDateOnly(null)).toBeNull();
  });
});

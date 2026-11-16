/**
 * 招聘需求周期计算规则（FR-REQ-5 / REQ-0～4）。
 * 周期是需求级指标：自然日、精确到日，同日关闭计 1 天，多日按日期差且不额外累加首尾日。
 * 需求提报时间只读、不参与计算，也不作兜底起点。
 */
export const DAY_MS = 86_400_000;

export const CYCLE_FORMULA = 'max(1, 关闭日期 - 开始招聘日期)';

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 严格解析 YYYY-MM-DD；非法日期（如 2026-02-30）返回 null。 */
export function parseDateOnly(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const match = DATE_ONLY.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

/** 接受 YYYY-MM-DD 或 ISO 时间字符串，统一归一化到 UTC 当日零点。 */
export function parseDateValue(value: unknown): Date | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const text = value.trim();
  // 纯日期格式必须严格校验，避免 Date 解析器把 2026-02-30 顺延成 3 月 2 日。
  if (DATE_ONLY.test(text)) return parseDateOnly(text);
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(
    Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()),
  );
}

export function toDateOnly(value: Date | null | undefined): string | null {
  if (!value) return null;
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, '0');
  const day = String(value.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** 以 UTC 日序号计算自然日差，避免时区与夏令时影响。 */
export function dayDifference(from: Date, to: Date): number {
  const fromIndex = Math.floor(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()) / DAY_MS,
  );
  const toIndex = Math.floor(
    Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()) / DAY_MS,
  );
  return toIndex - fromIndex;
}

/** 招聘周期：同日计 1 天，多日按日期差，不累加首尾日。 */
export function calculateCycleDays(recruitmentStartDate: Date, closedAt: Date): number {
  return Math.max(1, dayDifference(recruitmentStartDate, closedAt));
}

/** 进行中天数：当天 - 开始招聘时间；同日为 0 天，不计入周期汇总。 */
export function calculateInProgressDays(
  recruitmentStartDate: Date,
  today: Date = new Date(),
): number {
  return Math.max(0, dayDifference(recruitmentStartDate, today));
}

/** 关闭时间不得早于开始招聘时间（按日比较）。 */
export function isClosedBeforeStart(recruitmentStartDate: Date, closedAt: Date): boolean {
  return dayDifference(recruitmentStartDate, closedAt) < 0;
}

export function todayDateOnly(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Fixed event, configurable lead; invalid configuration falls back to one hour. */
export function interviewReminderMinutes(): number {
  const value = Number(process.env.DINGTALK_INTERVIEW_REMINDER_MINUTES ?? 60);
  return Number.isInteger(value) && value >= 1 && value <= 10_080 ? value : 60;
}

/** Resume inactivity threshold; defaults to three days when not configured. */
export function resumeTimeoutHours(): number {
  const value = Number(process.env.DINGTALK_RESUME_TIMEOUT_HOURS ?? 72);
  return Number.isInteger(value) && value >= 1 && value <= 8_760 ? value : 72;
}

export const RESUME_TIMEOUT_STAGES = ['UNASSIGNED', 'VIRTUAL_POOL', 'RECOMMENDED', 'HR_SCREENING'] as const;

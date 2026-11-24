import { describe, expect, it } from 'vitest';
import { reminderDueAt } from './onboarding-reminders.service.js';
describe('保温周期', () => {
 it('anchors weekly periods to the Shanghai onboarding day and stops after it', () => {
  const onboard = new Date('2027-02-01T00:00:00Z');
  expect(reminderDueAt(onboard,new Date('2027-01-20T02:00:00Z'))?.toISOString()).toBe('2027-01-17T16:00:00.000Z');
  expect(reminderDueAt(onboard,new Date('2027-01-27T02:00:00Z'))?.toISOString()).toBe('2027-01-24T16:00:00.000Z');
  expect(reminderDueAt(onboard,new Date('2027-02-02T00:00:00Z'))).toBeNull();
 });
});

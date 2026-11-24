import { describe, expect, it, vi } from 'vitest';
import type { AuthorizationService } from '../auth/authorization.service.js';
import type { OnboardingRemindersService } from '../candidates/onboarding-reminders.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { NotificationPreferenceService } from '../settings/notification-preference.service.js';
import type { NotificationOutboxService } from './notification-outbox.service.js';
import { OnboardingNotificationScanner } from './onboarding-notification-scanner.js';

describe('onboarding notification scanner', () => {
  it('reuses the authorized ATS-016 reminder and suppresses a muted recipient', async () => {
    const now = new Date('2027-01-27T02:00:00Z');
    const dueAt = new Date('2027-01-24T16:00:00Z');
    const db = { onboardingReminder: { findMany: vi.fn().mockResolvedValue([{ id: 'r1', recipientId: 'hr' }]) } };
    const auth = { loadUserContext: vi.fn().mockResolvedValue({ id: 'hr' }) };
    const reminders = { current: vi.fn().mockResolvedValue({ id: 'r1', onboardDate: new Date('2027-02-01T00:00:00Z'), dueAt }) };
    const prefs = { get: vi.fn().mockResolvedValueOnce({ muted: ['onboarding.REMINDER'] }).mockResolvedValueOnce({ muted: [] }) };
    const outbox = { enqueue: vi.fn() };
    const scanner = new OnboardingNotificationScanner(db as unknown as PrismaService, auth as unknown as AuthorizationService, reminders as unknown as OnboardingRemindersService, prefs as unknown as NotificationPreferenceService, outbox as unknown as NotificationOutboxService);
    await scanner.scan(now);
    expect(outbox.enqueue).not.toHaveBeenCalled();
    await scanner.scan(now);
    expect(outbox.enqueue).toHaveBeenCalledWith('onboarding.REMINDER', 'r1', 'hr', dueAt);
    expect(reminders.current).toHaveBeenCalledWith('r1', { id: 'hr' });
  });
});

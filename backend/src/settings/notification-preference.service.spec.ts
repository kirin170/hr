import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service.js';
import { NotificationPreferenceService } from './notification-preference.service.js';

describe('notification preferences', () => {
  it('persists and reads low priority preferences while rejecting required events', async () => {
    let value: string | undefined;
    const db = { systemSetting: {
      findUnique: vi.fn(async () => value ? { value } : null),
      upsert: vi.fn(async ({ create }: { create: { value: string } }) => { value = create.value; }),
    } };
    const service = new NotificationPreferenceService(db as unknown as PrismaService);
    expect((await service.update('hr', { muted: ['onboarding.REMINDER'] })).muted).toEqual(['onboarding.REMINDER']);
    expect((await service.get('hr')).muted).toEqual(['onboarding.REMINDER']);
    await expect(service.update('hr', { muted: ['interview.FEEDBACK_REMINDER'] })).rejects.toThrow();
  });
});

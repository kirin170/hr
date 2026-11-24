import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { DingTalkApiClient } from './dingtalk-api.client.js';
import { DingTalkCalendarIdentities } from './dingtalk-calendar-identities.js';

describe('calendar identity resolution', () => {
  it('uses active directory links and resolves unionIds through the directory', async () => {
    const findMany = vi.fn().mockResolvedValue([{ userId: 'ats-1', subject: 'ding-1' }]);
    const getUser = vi.fn().mockResolvedValue({ userid: 'ding-1', unionid: 'union-1' });
    const service = new DingTalkCalendarIdentities({ identityLink: { findMany } } as unknown as PrismaService, { getUser } as unknown as DingTalkApiClient);
    expect(await service.resolve(['ats-1', 'ats-1'])).toEqual(new Map([['ats-1', 'union-1']]));
    expect(findMany.mock.calls[0][0].where.user.status).toBe('ACTIVE');
    expect(getUser).toHaveBeenCalledWith('ding-1');
  });
  it('fails closed if a user is not mapped or has no unionId', async () => {
    const findMany = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{ userId: 'ats-1', subject: 'ding-1' }]);
    const getUser = vi.fn().mockResolvedValue({ userid: 'ding-1' });
    const service = new DingTalkCalendarIdentities({ identityLink: { findMany } } as unknown as PrismaService, { getUser } as unknown as DingTalkApiClient);
    await expect(service.resolve(['ats-1'])).rejects.toMatchObject({ code: 'identity_not_mapped' });
    await expect(service.resolve(['ats-1'])).rejects.toMatchObject({ code: 'invalid_directory_identity' });
  });
});

import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service.js';
import { NotificationOutboxService } from './notification-outbox.service.js';
import { WorkNoticeError } from './dingtalk-work-notice.client.js';

describe('notification outbox', () => {
  it('claims a due item only once, without sending during enqueue or claim', async () => {
    const execute = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    const service = new NotificationOutboxService({ $executeRaw: execute } as unknown as PrismaService);
    await service.enqueue('interview.FEEDBACK_REMINDER', 'interview-1', 'user-1', new Date());
    expect(await service.claim('delivery-1')).toBe(true);
    expect(await service.claim('delivery-1')).toBe(false);
    expect(execute).toHaveBeenCalledTimes(3);
    expect(execute.mock.calls[0][0].join('')).toContain('ON DUPLICATE KEY UPDATE');
    expect(execute.mock.calls[1][0].join('')).toContain("status = 'PENDING'");
  });
  it('retries a confirmed rate limit but quarantines an ambiguous submit', async () => {
    const execute = vi.fn().mockResolvedValue(1);
    const service = new NotificationOutboxService({ $executeRaw: execute } as unknown as PrismaService);
    await service.failure('one', new WorkNoticeError('88', 'RETRYABLE'));
    await service.failure('two', new WorkNoticeError('network_error', 'UNKNOWN'));
    expect(execute.mock.calls[0][0].join('')).toContain("IF(attempts >= 5, 'FAILED', 'PENDING')");
    expect(execute.mock.calls[1]).toContain('UNKNOWN');
    await service.markAbandonedUnknown(new Date());
    expect(execute.mock.calls[2][0].join('')).toContain("status = 'UNKNOWN'");
  });
});

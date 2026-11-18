import { describe, expect, it, vi } from 'vitest';
import { UnauthorizedException } from '@nestjs/common';
import { DingTalkCallbackController } from './dingtalk-callback.controller.js';
import type { DingTalkCallbackCrypto } from './dingtalk-callback-crypto.js';
import type { DingTalkSyncService } from './dingtalk-sync.service.js';

const query = { msg_signature: 'signature', timestamp: '1234', nonce: 'nonce' };

describe('DingTalkCallbackController', () => {
  it('acknowledges DingTalk URL verification with an encrypted challenge', () => {
    const crypto = {
      verify: vi.fn().mockReturnValue(true),
      decrypt: vi.fn().mockReturnValue({ message: 'challenge-1', ownerKey: 'app-key' }),
      encryptReply: vi.fn().mockReturnValue({ encrypt: 'reply' }),
    };
    const sync = { acceptCallback: vi.fn() };
    const response = { setHeader: vi.fn(), json: vi.fn((body) => body) };
    const controller = new DingTalkCallbackController(
      crypto as unknown as DingTalkCallbackCrypto,
      sync as unknown as DingTalkSyncService,
    );

    expect(controller.verifyUrl({ ...query, encrypt: 'ciphertext' }, response as never)).toEqual({ encrypt: 'reply' });
    expect(crypto.encryptReply).toHaveBeenCalledWith('challenge-1', '1234', 'nonce');
    expect(sync.acceptCallback).not.toHaveBeenCalled();
  });

  it('acks the encrypted connection probe without creating a business event', async () => {
    const crypto = {
      verify: vi.fn().mockReturnValue(true),
      decrypt: vi.fn().mockReturnValue({ message: 'success', ownerKey: 'app-key' }),
      encryptReply: vi.fn().mockReturnValue({ encrypt: 'success-ack' }),
    };
    const sync = { acceptCallback: vi.fn() };
    const response = { setHeader: vi.fn(), json: vi.fn((body) => body) };
    const controller = new DingTalkCallbackController(
      crypto as unknown as DingTalkCallbackCrypto,
      sync as unknown as DingTalkSyncService,
    );

    await expect(controller.receive(query, { encrypt: 'ciphertext' }, response as never))
      .resolves.toEqual({ encrypt: 'success-ack' });
    expect(sync.acceptCallback).not.toHaveBeenCalled();
    expect(crypto.encryptReply).toHaveBeenCalledWith('success', '1234', 'nonce');
  });

  it('stores a valid event before returning its encrypted success acknowledgement', async () => {
    const payload = { EventId: 'event-1', EventType: 'user_modify_org', UserId: 'dt-user-1' };
    const crypto = {
      verify: vi.fn().mockReturnValue(true),
      decrypt: vi.fn().mockReturnValue({ message: JSON.stringify(payload), ownerKey: 'app-key' }),
      encryptReply: vi.fn().mockReturnValue({ encrypt: 'event-ack' }),
    };
    const sync = { acceptCallback: vi.fn().mockResolvedValue({ accepted: true }) };
    const response = { setHeader: vi.fn(), json: vi.fn((body) => body) };
    const controller = new DingTalkCallbackController(
      crypto as unknown as DingTalkCallbackCrypto,
      sync as unknown as DingTalkSyncService,
    );

    await expect(controller.receive(query, { encrypt: 'ciphertext' }, response as never))
      .resolves.toEqual({ encrypt: 'event-ack' });
    expect(sync.acceptCallback).toHaveBeenCalledWith(payload);
    expect(crypto.encryptReply).toHaveBeenCalledWith('success', '1234', 'nonce');
  });

  it('rejects invalid signatures before decrypting callback data', async () => {
    const crypto = { verify: vi.fn().mockReturnValue(false), decrypt: vi.fn(), encryptReply: vi.fn() };
    const sync = { acceptCallback: vi.fn() };
    const response = { setHeader: vi.fn(), json: vi.fn() };
    const controller = new DingTalkCallbackController(
      crypto as unknown as DingTalkCallbackCrypto,
      sync as unknown as DingTalkSyncService,
    );

    await expect(controller.receive(query, { encrypt: 'ciphertext' }, response as never))
      .rejects.toBeInstanceOf(UnauthorizedException);
    expect(crypto.decrypt).not.toHaveBeenCalled();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { DingTalkCallbackCrypto } from './dingtalk-callback-crypto.js';

const configure = () => {
  vi.stubEnv('DINGTALK_CALLBACK_TOKEN', 'callback-token');
  vi.stubEnv('DINGTALK_CALLBACK_AES_KEY', randomBytes(32).toString('base64').replace(/=+$/, ''));
  vi.stubEnv('DINGTALK_CLIENT_ID', 'app-key');
  vi.stubEnv('DINGTALK_CORP_ID', 'corp-1');
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('DingTalkCallbackCrypto', () => {
  it('signs, encrypts, decrypts and verifies the configured owner key', () => {
    configure();
    const crypto = new DingTalkCallbackCrypto();
    const reply = crypto.encryptReply('{"challenge":"ok"}', '1795000000', 'nonce-1');

    expect(crypto.verify({
      timestamp: reply.timeStamp,
      nonce: reply.nonce,
      encrypted: reply.encrypt,
      signature: reply.msg_signature,
    })).toBe(true);
    expect(crypto.decrypt(reply.encrypt)).toEqual({
      message: '{"challenge":"ok"}',
      ownerKey: 'app-key',
    });
  });

  it('rejects tampered signatures and a ciphertext for a different owner key', () => {
    configure();
    const crypto = new DingTalkCallbackCrypto();
    const reply = crypto.encryptReply('success', '1795000000', 'nonce-1');
    expect(crypto.verify({
      timestamp: reply.timeStamp,
      nonce: reply.nonce,
      encrypted: reply.encrypt,
      signature: `${reply.msg_signature.slice(0, -1)}0`,
    })).toBe(false);

    vi.stubEnv('DINGTALK_CALLBACK_OWNER_KEY', 'wrong-app');
    expect(() => crypto.decrypt(reply.encrypt)).toThrow(BadRequestException);
  });

  it('allows an explicitly configured owner key when the callback mode requires it', () => {
    configure();
    vi.stubEnv('DINGTALK_CALLBACK_OWNER_KEY', 'corp-1');
    const crypto = new DingTalkCallbackCrypto();
    const reply = crypto.encryptReply('success', '1795000000', 'nonce-2');

    expect(crypto.decrypt(reply.encrypt)).toEqual({
      message: 'success',
      ownerKey: 'corp-1',
    });
  });
});

import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { IntakeService } from '../intake/intake.service.js';
import { withImapClient as withImapClientImport } from './imap.client.js';
import type { MailConfigService } from './mail-config.service.js';
import { MailPollService } from './mail-poll.service.js';
import type { MailSystemActorService } from './mail-system-actor.service.js';

vi.mock('./imap.client.js', () => ({
  withImapClient: vi.fn(),
  describeMailError: () => 'mock_mail_error',
  resolveMailCa: () => undefined,
  createImapClient: vi.fn(),
}));

const PDF_BASE64 = 'JVBERi0xLjQK';

function buildMail(options: {
  messageId?: string;
  attachments?: Array<{ name: string; type: string; base64: string }>;
}): Buffer {
  const boundary = 'BOUNDARY-POLL';
  const parts = (options.attachments ?? []).map(
    (item) =>
      `--${boundary}\r\nContent-Type: ${item.type}; name="${item.name}"\r\nContent-Disposition: attachment; filename="${item.name}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${item.base64}\r\n`,
  );
  return Buffer.from(
    [
      'From: hr@example.com',
      'To: ats@example.com',
      'Subject: 简历投递',
      `Message-ID: <${options.messageId ?? 'msg-1@example.com'}>`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      '',
      '--' + boundary,
      'Content-Type: text/plain',
      '',
      'body',
      ...parts,
      `--${boundary}--`,
      '',
    ].join('\r\n'),
    'utf8',
  );
}

type FakeMessage = { uid: number; envelope: Record<string, unknown>; source: Buffer };

function fakeClient(message: FakeMessage, uidValidity: bigint, exists = 1) {
  return {
    mailbox: { exists, uidValidity },
    getMailboxLock: async () => ({ release: () => {} }),
    fetch: async function* () {
      yield message;
    },
  };
}

const baseConfig = {
  id: 'cfg-1',
  address: 'hr@example.com',
  provider: 'IMAP',
  active: true,
  host: 'imap.example.com',
  port: 993,
  secure: true,
  username: 'hr@example.com',
  secretCipher: 'cipher',
  folder: 'INBOX',
  pollIntervalSeconds: 300,
  lastUidValidity: '100',
  lastUid: null,
  lastPolledAt: null,
  lastPollStatus: null,
  lastError: null,
  lastErrorAt: null,
  consecutiveFailures: 0,
  lastFetchedCount: 0,
  lastCreatedCount: 0,
  lastDuplicateCount: 0,
  lastSkippedCount: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('邮箱轮询（ATS-022 / FR-ENT-1）', () => {
  let prisma: {
    mailMessageLog: { create: Mock; update: Mock; findMany: Mock };
    mailInboxConfig: { update: Mock };
  };
  let configs: {
    requireConfig: Mock;
    toConnection: Mock;
    listDue: Mock;
    list: Mock;
    get: Mock;
  };
  let intake: { ingestEmailAttachments: Mock };
  let systemActor: { ensureActorId: Mock };
  let withImapClient: Mock;

  beforeEach(() => {
    prisma = {
      mailMessageLog: {
        create: vi.fn().mockResolvedValue({}),
        update: vi.fn().mockResolvedValue({}),
        findMany: vi.fn().mockResolvedValue([]),
      },
      mailInboxConfig: { update: vi.fn().mockResolvedValue({}) },
    };
    configs = {
      requireConfig: vi.fn().mockResolvedValue({ ...baseConfig }),
      toConnection: vi.fn().mockReturnValue({
        host: 'imap.example.com',
        port: 993,
        secure: true,
        user: 'hr@example.com',
        password: 'secret',
      }),
      listDue: vi.fn().mockResolvedValue([]),
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn(),
    };
    intake = { ingestEmailAttachments: vi.fn().mockResolvedValue([]) };
    systemActor = { ensureActorId: vi.fn().mockResolvedValue('actor-1') };

    withImapClient = withImapClientImport as unknown as Mock;
    withImapClient.mockReset();
  });

  function buildService() {
    return new MailPollService(
      prisma as unknown as PrismaService,
      configs as unknown as MailConfigService,
      intake as unknown as IntakeService,
      systemActor as unknown as MailSystemActorService,
    );
  }

  it('无附件邮件不建简历，只记台账', async () => {
    withImapClient.mockImplementation(async (_connection, handler) =>
      handler(fakeClient({ uid: 5, envelope: {}, source: buildMail({}) }, 100n)),
    );
    const service = buildService();
    const result = await service.pollOne('cfg-1');

    expect(result.ok).toBe(true);
    expect(result.created).toBe(0);
    expect(intake.ingestEmailAttachments).not.toHaveBeenCalled();
    expect(prisma.mailMessageLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ outcome: 'NO_ATTACHMENT' }),
      }),
    );
  });

  it('PDF 附件走统一入库链路，并以待分配池方式建档', async () => {
    intake.ingestEmailAttachments.mockResolvedValue([
      { intakeId: 'i1', candidateId: 'c1', airRunId: 'a1', status: 'RECEIVED', duplicate: false, parseQueued: true },
    ]);
    withImapClient.mockImplementation(async (_connection, handler) =>
      handler(
        fakeClient(
          {
            uid: 7,
            envelope: {},
            source: buildMail({
              attachments: [{ name: 'resume.pdf', type: 'application/pdf', base64: PDF_BASE64 }],
            }),
          },
          100n,
        ),
      ),
    );
    const service = buildService();
    const result = await service.pollOne('cfg-1');

    expect(result.created).toBe(1);
    const call = intake.ingestEmailAttachments.mock.calls[0][0] as Record<string, unknown>;
    expect(call.actorId).toBe('actor-1');
    expect(call.jobId).toBeUndefined();
    expect((call.files as Array<{ fileName: string }>).map((item) => item.fileName)).toEqual([
      'resume.pdf',
    ]);
    expect(prisma.mailMessageLog.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ outcome: 'INGESTED', intakeCount: 1 }),
      }),
    );
  });

  it('同一 Message-ID 重复出现时跳过，不重复建档', async () => {
    prisma.mailMessageLog.create.mockRejectedValueOnce({ code: 'P2002' });
    withImapClient.mockImplementation(async (_connection, handler) =>
      handler(fakeClient({ uid: 8, envelope: {}, source: buildMail({}) }, 100n)),
    );
    const service = buildService();
    const result = await service.pollOne('cfg-1');

    expect(result.skipped).toBe(1);
    expect(intake.ingestEmailAttachments).not.toHaveBeenCalled();
  });

  it('UIDVALIDITY 变化时重置游标，从头回看避免漏抓', async () => {
    const fetchSpy = vi.fn(async function* () {
      // 无新邮件
    });
    withImapClient.mockImplementation(async (_connection, handler) =>
      handler({
        mailbox: { exists: 3, uidValidity: 200n },
        getMailboxLock: async () => ({ release: () => {} }),
        fetch: fetchSpy,
      }),
    );
    const service = buildService();
    await service.pollOne('cfg-1');

    // lastUidValidity=100 与服务器 200 不一致 → 走序号区间且 uid=false
    expect(fetchSpy).toHaveBeenCalledWith('1:*', expect.anything(), { uid: false });
  });

  it('MOCK 配置不参与真实轮询', async () => {
    configs.requireConfig.mockResolvedValue({ ...baseConfig, provider: 'MOCK' });
    const service = buildService();
    const result = await service.pollOne('cfg-1');

    expect(result.ok).toBe(false);
    expect(result.error).toContain('MOCK');
    expect(withImapClient).not.toHaveBeenCalled();
  });

  it('抓取失败时记录脱敏错误并累加连续失败次数', async () => {
    withImapClient.mockRejectedValueOnce(new Error('auth failed'));
    const service = buildService();
    const result = await service.pollOne('cfg-1');

    expect(result.ok).toBe(false);
    expect(result.error).toBe('mock_mail_error');
    expect(prisma.mailInboxConfig.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lastPollStatus: 'FAILED',
          consecutiveFailures: { increment: 1 },
        }),
      }),
    );
  });
});

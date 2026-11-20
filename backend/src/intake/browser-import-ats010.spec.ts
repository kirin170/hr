import { BadRequestException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import type { AuthorizationService } from '../auth/authorization.service.js';
import type { SystemTokenService } from '../auth/system-token.service.js';
import type { ParseQueueService } from '../ai/parse.queue.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { StorageService } from '../storage/storage.service.js';
import type { TimelineService } from '../timeline/timeline.service.js';
import { BrowserImportService } from './browser-import.service.js';
import {
  BROWSER_IMPORT_ERROR,
  BROWSER_IMPORT_STAGE,
  containsCredentialField,
  pickPagePayload,
  sanitizeSourcePageUrl,
} from './browser-import.contract.js';
import type { UploadedResumeFile } from './intake.service.js';

const actor: AuthenticatedUser = {
  id: 'user-hr-1',
  displayName: '招聘 HR',
  departmentId: null,
  departmentIds: [],
  groupIds: [],
  roles: [],
};

const otherActor: AuthenticatedUser = { ...actor, id: 'user-hr-2', displayName: '另一位 HR' };

function resumeFile(overrides: Partial<UploadedResumeFile> = {}): UploadedResumeFile {
  // PDF 魔数开头，确保统一上传校验通过
  const buffer = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(256, 0x20)]);
  return {
    originalname: '张伟-简历.pdf',
    mimetype: 'application/pdf',
    size: buffer.length,
    buffer,
    ...overrides,
  } as UploadedResumeFile;
}

interface Harness {
  service: BrowserImportService;
  prisma: {
    browserImportTask: {
      findUnique: ReturnType<typeof vi.fn>;
      findUniqueOrThrow: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      count: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    candidate: { findFirst: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
    resumeFile: { findUnique: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
    resumeIntake: { create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
    aIRun: { create: ReturnType<typeof vi.fn> };
    systemToken: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  };
  storage: { putObject: ReturnType<typeof vi.fn>; driverName: string };
  queue: { enqueue: ReturnType<typeof vi.fn> };
  timeline: { record: ReturnType<typeof vi.fn> };
  authorization: { canAccessJob: ReturnType<typeof vi.fn>; loadUserContext: ReturnType<typeof vi.fn> };
  systemTokens: { issue: ReturnType<typeof vi.fn>; authenticate: ReturnType<typeof vi.fn> };
}

function buildHarness(taskRow: Record<string, unknown> | null = null): Harness {
  const prisma = {
    browserImportTask: {
      findUnique: vi.fn().mockResolvedValue(taskRow),
      findUniqueOrThrow: vi.fn().mockImplementation(async () => ({
        ...baseTask(),
        status: 'PARSING',
        resumeFileId: 'file-1',
        candidateId: 'cand-new',
      })),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
        ...baseTask(),
        ...data,
        id: 'task-1',
        createdAt: new Date('2026-11-20T02:00:00Z'),
        completedAt: data.completedAt ?? null,
      })),
      update: vi.fn().mockResolvedValue({}),
    },
    candidate: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'cand-new' }),
      update: vi.fn().mockResolvedValue({}),
    },
    resumeFile: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'file-1' }),
    },
    resumeIntake: {
      create: vi.fn().mockResolvedValue({ id: 'intake-1' }),
      update: vi.fn().mockResolvedValue({}),
    },
    aIRun: { create: vi.fn().mockResolvedValue({ id: 'run-1' }) },
    systemToken: {
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
    },
  };
  const storage = { putObject: vi.fn().mockResolvedValue(undefined), driverName: 'local' };
  const queue = { enqueue: vi.fn().mockResolvedValue(undefined) };
  const timeline = { record: vi.fn().mockResolvedValue(undefined) };
  const authorization = {
    canAccessJob: vi.fn().mockResolvedValue(true),
    loadUserContext: vi.fn().mockResolvedValue(actor),
  };
  const systemTokens = {
    issue: vi.fn().mockResolvedValue({ token: 'tok', expiresAt: '2026-11-20T02:30:00.000Z' }),
    authenticate: vi.fn().mockResolvedValue(actor),
  };
  const service = new BrowserImportService(
    prisma as unknown as PrismaService,
    timeline as unknown as TimelineService,
    storage as unknown as StorageService,
    queue as unknown as ParseQueueService,
    authorization as unknown as AuthorizationService,
    systemTokens as unknown as SystemTokenService,
  );
  return { service, prisma, storage, queue, timeline, authorization, systemTokens };
}

function baseTask() {
  return {
    id: 'task-1',
    requestId: 'req-0001',
    operatorId: actor.id,
    sourceSite: 'BOSS_ZHIPIN',
    sourceCandidateId: 'geek-abc',
    sourcePageUrl: null,
    sourcePageHost: 'https://www.zhipin.com',
    targetJobId: null,
    pagePayload: { name: '张伟' },
    resumeFileId: null,
    fileName: null,
    fileHash: null,
    status: 'RECEIVED',
    candidateId: null,
    errorCode: null,
    errorMessage: null,
    errorStage: null,
    createdAt: new Date('2026-11-20T02:00:00Z'),
    completedAt: null,
  };
}

describe('浏览器导入契约：URL 脱敏与凭据过滤（ATS-010 / NFR-12）', () => {
  it('来源页面 URL 只保留协议与主机，路径、查询串与片段全部丢弃', () => {
    const { host, invalid } = sanitizeSourcePageUrl(
      'https://www.zhipin.com/web/geek/resume?id=792&token=secret#/detail',
    );
    expect(invalid).toBe(false);
    expect(host).toBe('https://www.zhipin.com');
    expect(host).not.toContain('token');
    expect(host).not.toContain('/web/geek');
  });

  it('非 http(s) 协议与非法 URL 标记为无效，缺失 URL 视为有效且无主机', () => {
    expect(sanitizeSourcePageUrl('javascript:alert(1)').invalid).toBe(true);
    expect(sanitizeSourcePageUrl('file:///c:/secret.pdf').invalid).toBe(true);
    expect(sanitizeSourcePageUrl('not a url').invalid).toBe(true);
    expect(sanitizeSourcePageUrl(undefined)).toEqual({ host: null, invalid: false });
  });

  it('检测请求体任意深度的凭据字段（cookie / authorization / csrf / password）', () => {
    expect(containsCredentialField({ Cookie: 'x' })).toBe(true);
    expect(containsCredentialField({ headers: { Authorization: 'Bearer x' } })).toBe(true);
    expect(containsCredentialField({ pagePayload: { xsrf_token: 't' } })).toBe(true);
    expect(containsCredentialField({ nested: [{ refreshToken: 'r' }] })).toBe(true);
    expect(containsCredentialField({ pagePayload: { name: '张伟', email: 'a@b.com' } })).toBe(false);
  });

  it('页面结构化数据只保留白名单字段并截断超长文本', () => {
    const picked = pickPagePayload({
      name: '张伟',
      phone: '13800138000',
      platformId: 'geek-abc',
      rawHtml: '<html/>',
      secret: 'x',
    });
    expect(picked).toEqual({ name: '张伟', phone: '13800138000' });
    const long = pickPagePayload({ name: 'x'.repeat(900) }, 100);
    expect(long.name).toHaveLength(100);
  });
});

describe('BrowserImportService 导入任务（ATS-010）', () => {
  let h: Harness;
  beforeEach(() => {
    h = buildHarness();
  });

  it('创建任务返回任务资源并投递统一解析管道', async () => {
    const result = await h.service.createImportTask(
      {
        requestId: 'req-0001',
        sourceSite: 'BOSS_ZHIPIN',
        sourceCandidateId: 'geek-abc',
        sourcePageUrl: 'https://www.zhipin.com/web/geek/resume?id=1&token=abc',
        pagePayload: { name: '张伟' },
      },
      resumeFile(),
      actor,
    );
    expect(result.duplicateOfExistingRequest).toBe(false);
    expect(result.task.taskId).toBe('task-1');
    // 页面 URL 不入库，只留主机
    const createdData = h.prisma.browserImportTask.create.mock.calls[0][0].data;
    expect(createdData.sourcePageUrl).toBeNull();
    expect(createdData.sourcePageHost).toBe('https://www.zhipin.com');
    expect(JSON.stringify(createdData)).not.toContain('token=abc');
    expect(h.storage.putObject).toHaveBeenCalledTimes(1);
    expect(h.queue.enqueue).toHaveBeenCalledWith('intake-1', 'run-1');
    expect(h.prisma.candidate.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ sourcePlatformId: 'geek-abc' }) }),
    );
  });

  it('同操作者同 requestId 重放返回同一任务，不重复建任务', async () => {
    const existing = { ...baseTask(), id: 'task-existing' };
    h.prisma.browserImportTask.findUnique.mockResolvedValue(existing);
    const result = await h.service.createImportTask(
      { requestId: 'req-0001', sourceSite: 'BOSS_ZHIPIN', pagePayload: { name: '张伟' } },
      undefined,
      actor,
    );
    expect(result.duplicateOfExistingRequest).toBe(true);
    expect(result.task.taskId).toBe('task-existing');
    expect(h.prisma.browserImportTask.create).not.toHaveBeenCalled();
    // 幂等键按 操作者 + requestId 组合查询
    expect(h.prisma.browserImportTask.findUnique).toHaveBeenCalledWith({
      where: { requestId_operatorId: { requestId: 'req-0001', operatorId: actor.id } },
    });
  });

  it('缺少或非法 requestId 拒绝', async () => {
    for (const requestId of [undefined, '', 'short', 'bad id with spaces']) {
      await expect(
        h.service.createImportTask({ requestId, sourceSite: 'BOSS_ZHIPIN' }, undefined, actor),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('不支持来源站点与非法来源 URL 分别返回明确错误码', async () => {
    await expect(
      h.service.createImportTask({ requestId: 'req-0001', sourceSite: 'LINKEDIN' }, undefined, actor),
    ).rejects.toMatchObject({ response: expect.objectContaining({ message: BROWSER_IMPORT_ERROR.SOURCE_SITE_UNSUPPORTED }) });

    await expect(
      h.service.createImportTask(
        { requestId: 'req-0001', sourceSite: 'BOSS_ZHIPIN', sourcePageUrl: 'ftp://x.com/a' },
        undefined,
        actor,
      ),
    ).rejects.toMatchObject({ response: expect.objectContaining({ message: BROWSER_IMPORT_ERROR.SOURCE_URL_INVALID }) });
  });

  it('请求携带第三方平台凭据时拒绝，且不落库', async () => {
    await expect(
      h.service.createImportTask(
        {
          requestId: 'req-0001',
          sourceSite: 'BOSS_ZHIPIN',
          pagePayload: { name: '张伟' },
          cookies: 'sessionid=abc',
        } as never,
        resumeFile(),
        actor,
      ),
    ).rejects.toMatchObject({ response: expect.objectContaining({ message: BROWSER_IMPORT_ERROR.THIRD_PARTY_CREDENTIAL_REJECTED }) });
    expect(h.prisma.browserImportTask.create).not.toHaveBeenCalled();
    expect(h.timeline.record).not.toHaveBeenCalled();

    await expect(
      h.service.createImportTask(
        {
          requestId: 'req-0002',
          sourceSite: 'BOSS_ZHIPIN',
          pagePayload: { name: '张伟', Authorization: 'Bearer x' },
        },
        undefined,
        actor,
      ),
    ).rejects.toMatchObject({ response: expect.objectContaining({ message: BROWSER_IMPORT_ERROR.THIRD_PARTY_CREDENTIAL_REJECTED }) });
  });

  it('既无附件字节也无页面数据时拒绝', async () => {
    await expect(
      h.service.createImportTask({ requestId: 'req-0001', sourceSite: 'BOSS_ZHIPIN' }, undefined, actor),
    ).rejects.toMatchObject({ response: expect.objectContaining({ message: BROWSER_IMPORT_ERROR.PAYLOAD_REQUIRED }) });
  });

  it('附件不可用：非简历格式拒绝，任务不创建', async () => {
    await expect(
      h.service.createImportTask(
        { requestId: 'req-0001', sourceSite: 'BOSS_ZHIPIN' },
        resumeFile({ originalname: 'payload.exe', mimetype: 'application/octet-stream' }),
        actor,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: BROWSER_IMPORT_ERROR.ATTACHMENT_INVALID }),
    });
    expect(h.prisma.browserImportTask.create).not.toHaveBeenCalled();
  });

  it('附件上传失败时任务置 FAILED 并带失败阶段与明确错误码', async () => {
    h.storage.putObject.mockRejectedValue(new Error('network reset while uploading'));
    const result = await h.service.createImportTask(
      { requestId: 'req-0001', sourceSite: 'BOSS_ZHIPIN', pagePayload: { name: '张伟' } },
      resumeFile(),
      actor,
    );
    expect(result.task.taskId).toBe('task-1');
    const failedUpdate = h.prisma.browserImportTask.update.mock.calls.find(
      (call) => call[0].data.status === 'FAILED',
    );
    expect(failedUpdate).toBeDefined();
    expect(failedUpdate![0].data).toMatchObject({
      errorCode: BROWSER_IMPORT_ERROR.ATTACHMENT_UNAVAILABLE,
      errorStage: BROWSER_IMPORT_STAGE.UPLOAD,
    });
    expect(h.timeline.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'import.failed' }),
    );
  });

  it('平台 ID 查重命中时任务落 DUPLICATE 待人工选择，不自动建候选人', async () => {
    h.prisma.candidate.findFirst.mockResolvedValueOnce({ id: 'cand-existing' });
    const result = await h.service.createImportTask(
      {
        requestId: 'req-0002',
        sourceSite: 'BOSS_ZHIPIN',
        sourceCandidateId: 'geek-abc',
        pagePayload: { name: '张伟' },
      },
      resumeFile(),
      actor,
    );
    expect(result.task.status).toBe('DUPLICATE');
    expect(result.task.duplicateOfCandidateId).toBe('cand-existing');
    expect(h.prisma.candidate.create).not.toHaveBeenCalled();
    expect(h.queue.enqueue).not.toHaveBeenCalled();
    expect(h.timeline.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'import.duplicate',
        payload: expect.objectContaining({ duplicateDimensions: ['PLATFORM_ID'] }),
      }),
    );
  });

  it('附件哈希查重命中时进入 DUPLICATE', async () => {
    h.prisma.resumeFile.findUnique.mockResolvedValue({
      id: 'file-old',
      intakes: [{ candidateId: 'cand-by-hash' }],
    });
    const result = await h.service.createImportTask(
      { requestId: 'req-0003', sourceSite: 'LIEPIN', pagePayload: { name: '张伟' } },
      resumeFile(),
      actor,
    );
    expect(result.task.status).toBe('DUPLICATE');
    expect(result.task.duplicateOfCandidateId).toBe('cand-by-hash');
    expect(h.timeline.record.mock.calls[0][0].payload.duplicateDimensions).toEqual(['FILE_HASH']);
  });

  it('联系方式查重命中时进入 DUPLICATE（手机号按归一化后比对）', async () => {
    h.prisma.candidate.findFirst.mockResolvedValue({ id: 'cand-by-phone' });
    const result = await h.service.createImportTask(
      {
        requestId: 'req-0004',
        sourceSite: 'LIEPIN',
        pagePayload: { name: '张伟', phone: '+86 138-0013-8000' },
      },
      undefined,
      actor,
    );
    expect(result.task.status).toBe('DUPLICATE');
    expect(result.task.duplicateOfCandidateId).toBe('cand-by-phone');
    expect(h.prisma.candidate.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { OR: [{ phone: '13800138000' }] } }),
    );
  });

  it('任务所有者可查询，其他人查询返回 NOT_FOUND 避免探测', async () => {
    h.prisma.browserImportTask.findUnique.mockResolvedValue(baseTask());
    const own = await h.service.getTask('task-1', actor);
    expect(own.taskId).toBe('task-1');

    await expect(h.service.getTask('task-1', otherActor)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(h.service.getTask('task-1', otherActor)).rejects.toMatchObject({
      response: expect.objectContaining({ message: BROWSER_IMPORT_ERROR.TASK_NOT_FOUND }) });
  });

  it('无权访问目标职位时按 JOB_NOT_FOUND 拒绝', async () => {
    h.authorization.canAccessJob.mockResolvedValue(false);
    await expect(
      h.service.createImportTask(
        { requestId: 'req-0005', sourceSite: 'BOSS_ZHIPIN', targetJobId: 'job-9', pagePayload: { name: '张伟' } },
        undefined,
        actor,
      ),
    ).rejects.toMatchObject({ response: expect.objectContaining({ message: BROWSER_IMPORT_ERROR.JOB_NOT_FOUND }) });
  });

  it('任务列表只返回当前操作者的任务，非法状态拒绝', async () => {
    await h.service.listTasks(actor, { page: 2, pageSize: 500 });
    expect(h.prisma.browserImportTask.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { AND: [{ operatorId: actor.id }] }, skip: 100, take: 100 }),
    );
    await expect(h.service.listTasks(actor, { status: 'UNKNOWN' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('SystemTokenService 短期系统令牌（ATS-010 / NFR-9）', () => {
  const PEPPER = 'x'.repeat(48);

  beforeEach(() => {
    vi.resetModules();
    process.env.SYSTEM_TOKEN_PEPPER = PEPPER;
  });

  it('签发的令牌只返回明文一次，库中只存哈希且带有效期限', async () => {
    const { SystemTokenService } = await import('../auth/system-token.service.js');
    const create = vi.fn().mockResolvedValue({});
    const service = new SystemTokenService(
      { systemToken: { create } } as unknown as PrismaService,
      { loadUserContext: vi.fn() } as unknown as AuthorizationService,
    );
    const issued = await service.issue(actor.id);
    expect(issued.token.length).toBeGreaterThanOrEqual(43);
    expect(issued.token).not.toMatch(/[+/=]/); // base64url
    const stored = create.mock.calls[0][0].data;
    expect(stored.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(stored.tokenHash).not.toContain(issued.token);
    expect(stored.operatorId).toBe(actor.id);
    const ttlMs = new Date(issued.expiresAt).getTime() - Date.now();
    expect(ttlMs).toBeGreaterThan(29 * 60 * 1000);
    expect(ttlMs).toBeLessThanOrEqual(30 * 60 * 1000);
  });

  it('未知令牌、已过期令牌、已吊销令牌一律 401', async () => {
    const { SystemTokenService } = await import('../auth/system-token.service.js');
    const findUnique = vi.fn().mockResolvedValueOnce(null);
    const service = new SystemTokenService(
      { systemToken: { findUnique, update: vi.fn() } } as unknown as PrismaService,
      { loadUserContext: vi.fn() } as unknown as AuthorizationService,
    );
    await expect(service.authenticate('unknown')).rejects.toBeInstanceOf(UnauthorizedException);

    findUnique.mockResolvedValueOnce({
      id: 't1',
      operatorId: actor.id,
      revokedAt: null,
      expiresAt: new Date(Date.now() - 1000),
    });
    await expect(service.authenticate('expired')).rejects.toBeInstanceOf(UnauthorizedException);

    findUnique.mockResolvedValueOnce({
      id: 't2',
      operatorId: actor.id,
      revokedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    });
    await expect(service.authenticate('revoked')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('令牌有效期非法配置时拒绝签发（上下限 60 秒～24 小时）', async () => {
    const { SystemTokenService } = await import('../auth/system-token.service.js');
    const service = new SystemTokenService(
      { systemToken: { create: vi.fn() } } as unknown as PrismaService,
      { loadUserContext: vi.fn() } as unknown as AuthorizationService,
    );
    for (const ttl of ['30', '90000', 'abc']) {
      process.env.SYSTEM_TOKEN_TTL = ttl;
      await expect(service.issue(actor.id)).rejects.toThrow(/SYSTEM_TOKEN_TTL/);
    }
    delete process.env.SYSTEM_TOKEN_TTL;
  });
});

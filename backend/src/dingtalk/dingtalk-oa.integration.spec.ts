import { DataScope } from '@prisma/client';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AccessTokenService } from '../auth/access-token.service.js';
import { AuthModule } from '../auth/auth.module.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { AuthorizationModule } from '../auth/authorization.module.js';
import { AuthorizationService } from '../auth/authorization.service.js';
import { AuditModule } from '../audit/audit.module.js';
import { OffersModule } from '../offers/offers.module.js';
import { OffersService } from '../offers/offers.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RequisitionsModule } from '../requisitions/requisitions.module.js';
import { RequisitionsService } from '../requisitions/requisitions.service.js';
import { StorageModule } from '../storage/storage.module.js';
import { StorageService } from '../storage/storage.service.js';
import { DingTalkApiClient } from './dingtalk-api.client.js';
import { DingTalkCallbackCrypto } from './dingtalk-callback-crypto.js';
import { DingTalkModule } from './dingtalk.module.js';
import { DingTalkOaClient } from './dingtalk-oa.client.js';
import { DingTalkOaService } from './dingtalk-oa.service.js';
import { dingtalkDepartmentCode } from './dingtalk-department-code.js';
import { DingTalkSyncQueueService } from './dingtalk-sync.queue.js';
import { DingTalkSyncService } from './dingtalk-sync.service.js';
import { DingTalkSyncWorker } from './dingtalk-sync.worker.js';

const isolated =
  process.env.ATS019_ISOLATED_TEST === '1' &&
  /^ats019_tmp_[a-z0-9]+$/.test(new URL(process.env.DATABASE_URL || 'mysql://invalid/invalid').pathname.slice(1));

const CORP_ID = 'corp-ats019';
const INSTANCE_A = 'ad253df6-e175caf-aaaa000000000001';
const INSTANCE_B = 'ad253df6-e175caf-bbbb000000000002';
const OFFER_INSTANCE = 'oa-offer-instance-00000001';

const field = (name: string, value: string) => ({ name, value, id: `TextField-${name}`, componentType: 'TextField', bizAlias: '' });

const instanceA = {
  title: '张三提交的招聘需求',
  status: 'COMPLETED',
  result: 'agree',
  createTime: '2026-11-01T17:30Z',
  finishTime: '2026-11-02T10:00Z',
  originatorUserId: 'manager1',
  originatorDeptId: '100',
  originatorDeptName: '研发部',
  businessId: 'BILL-2026-0001',
  formComponentValues: [
    field('需求名称', '高级后端工程师'),
    field('需求部门', '[100]'),
    field('招聘人数', '3'),
    field('开始招聘时间', '2026-11-05 00:00'),
    field('招聘负责人', '["dt-recruiter"]'),
    field('职级', 'P6'),
    field('备注', '紧急'),
  ],
};
const instanceB = { ...instanceA, businessId: 'BILL-2026-0002', formComponentValues: instanceA.formComponentValues.filter((item) => item.name !== '开始招聘时间') };

describe.skipIf(!isolated)('ATS-019 isolated MySQL', () => {
  const db = new PrismaService();
  const auth = new AuthorizationService(db);
  const queue = { dispatch: vi.fn().mockResolvedValue(undefined), retryFailed: vi.fn().mockResolvedValue({ id: 'x', status: 'RECEIVED' }) };
  const storage = {
    driverName: 'test',
    putObject: vi.fn(),
    deleteObject: vi.fn(),
    createReadUrl: vi.fn().mockResolvedValue({ url: 'https://example.test/private', expiresAt: new Date('2030-01-01') }),
  } as unknown as StorageService;
  // 钉钉开放接口桩：只替换 HTTP 层，令牌缓存、请求组装、响应归一和错误分类都走真实代码。
  const fake = { starts: [] as Record<string, unknown>[], reads: [] as string[] };
  const instances = new Map<string, Record<string, unknown>>([
    [INSTANCE_A, instanceA],
    [INSTANCE_B, instanceB],
    [OFFER_INSTANCE, { title: '候选人录用审批', status: 'RUNNING', result: '', createTime: '2026-11-10T01:00Z' }],
  ]);
  const api = new DingTalkApiClient();
  const offers = new OffersService(db, auth);
  const oa = new DingTalkOaService(
    db,
    new DingTalkOaClient(api),
    new RequisitionsService(db, auth),
    offers,
    queue as unknown as DingTalkSyncQueueService,
  );
  const sync = new DingTalkSyncService(db, api, queue as unknown as DingTalkSyncQueueService, oa);
  const hr: AuthenticatedUser = {
    id: 'ats019_hr',
    displayName: 'HR',
    departmentId: 'dept-100',
    departmentIds: ['dept-100'],
    groupIds: [],
    roles: [
      {
        code: 'ats019_hr_role',
        name: 'HR',
        dataScope: DataScope.ALL,
        permissions: ['candidate:read', 'candidate:stage:update', 'requisition:read', 'requisition:sync'],
      },
    ],
  };
  let app: INestApplication;
  let token = '';
  let readerToken = '';
  const callbackCrypto = new DingTalkCallbackCrypto();
  const envBackup = new Map<string, string | undefined>();
  /** vi.stubEnv 在 beforeAll 中的值到测试执行时会被恢复，这里直接写 process.env 并在 afterAll 还原。 */
  const setEnv = (key: string, value: string) => {
    if (!envBackup.has(key)) envBackup.set(key, process.env[key]);
    process.env[key] = value;
  };

  beforeAll(async () => {
    setEnv('DINGTALK_CLIENT_ID', 'ats019-app-key');
    setEnv('DINGTALK_CLIENT_SECRET', 'ats019-app-secret');
    setEnv('DINGTALK_CORP_ID', CORP_ID);
    setEnv('DINGTALK_CALLBACK_TOKEN', 'ats019-callback-token');
    setEnv('DINGTALK_CALLBACK_AES_KEY', randomBytes(32).toString('base64').slice(0, 43));
    setEnv('DINGTALK_CALLBACK_OWNER_KEY', 'ats019-app-key');
    setEnv('DINGTALK_OA_REQUISITION_PROCESS_CODE', 'PROC-REQ');
    setEnv('DINGTALK_OA_OFFER_PROCESS_CODE', 'PROC-OFFER');
    setEnv('DINGTALK_OA_OFFER_APPROVERS_LEVEL_1', 'mgr-a,mgr-b');
    setEnv('DINGTALK_OA_OFFER_APPROVERS_LEVEL_2', 'dir-a');
    setEnv('JWT_ACCESS_SECRET', 'ats019-isolated-test-secret-at-least-32-bytes');
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === '/v1.0/oauth2/accessToken') return Response.json({ accessToken: 'app-token', expireIn: 7_200 });
      if (url.pathname !== '/v1.0/workflow/processInstances') throw new Error(`unexpected request ${url.pathname}`);
      if (init?.method === 'POST') {
        const body = typeof init.body === 'string' ? init.body : '';
        fake.starts.push(JSON.parse(body) as Record<string, unknown>);
        return Response.json({ id: OFFER_INSTANCE });
      }
      const id = url.searchParams.get('processInstanceId') ?? '';
      fake.reads.push(id);
      return instances.has(id) ? Response.json(instances.get(id)) : new Response('not found', { status: 404 });
    }));

    await db.$connect();
    await db.department.create({ data: { id: 'dept-100', code: dingtalkDepartmentCode(CORP_ID, 100), name: '研发部' } });
    await db.user.createMany({ data: [
      { id: hr.id, displayName: 'HR', departmentId: 'dept-100' },
      { id: 'ats019_recruiter', displayName: '招聘负责人' },
      { id: 'ats019_reader', displayName: '只读' },
    ] });
    await db.identityLink.createMany({ data: [
      { provider: 'DINGTALK', subject: 'dt-hr-1', userId: hr.id },
      { provider: 'DINGTALK', subject: 'dt-recruiter', userId: 'ats019_recruiter' },
    ] });
    await db.job.create({ data: { id: 'ats019_j', code: 'ats019_j', title: '后端工程师', departmentId: 'dept-100' } });
    await db.candidate.createMany({ data: [
      { id: 'ats019_c', name: '候选人', jobId: 'ats019_j', stage: 'OFFERING', phone: '13900000000', workHistory: [{ company: 'A 公司', title: '工程师', period: '2020-2024', salary: 'secret-salary' }] },
      { id: 'ats019_manual', name: '人工单号候选人', jobId: 'ats019_j', stage: 'OFFERING' },
    ] });
    await db.interviewRegistrationTemplate.create({ data: { id: 'ats019_t', fields: [], createdBy: hr.id } });
    await db.interviewRegistrationForm.create({ data: {
      candidateId: 'ats019_c', jobId: 'ats019_j', templateId: 'ats019_t',
      fields: [{ key: 'address', label: '地址' }, { key: 'salary', label: '期望薪资' }, { key: 'ai', label: 'AI建议' }],
      values: { address: '上海', salary: 'secret-salary', ai: 'secret-ai' }, submittedBy: hr.id,
    } });

    const permissions = await Promise.all(['candidate:read', 'candidate:stage:update', 'requisition:read', 'requisition:sync']
      .map((code) => db.permission.create({ data: { code, description: 'test' } })));
    const hrRole = await db.role.create({ data: { code: 'ats019_http_hr', name: 'test', dataScope: 'ALL', permissions: { create: permissions.map((permission) => ({ permissionId: permission.id })) } } });
    const readerRole = await db.role.create({ data: { code: 'ats019_http_reader', name: 'test', dataScope: 'ALL', permissions: { create: [{ permissionId: permissions[0]!.id }, { permissionId: permissions[2]!.id }] } } });
    await db.userRole.createMany({ data: [{ userId: hr.id, roleId: hrRole.id }, { userId: 'ats019_reader', roleId: readerRole.id }] });

    const module = await Test.createTestingModule({
      imports: [PrismaModule, AuditModule, AuthorizationModule, AuthModule, StorageModule, OffersModule, RequisitionsModule, DingTalkModule],
    })
      .overrideProvider(StorageService).useValue(storage)
      .overrideProvider(DingTalkSyncQueueService).useValue(queue)
      .overrideProvider(DingTalkSyncWorker).useValue({})
      .compile();
    app = module.createNestApplication();
    await app.init();
    token = app.get(AccessTokenService).issue(hr.id).token;
    readerToken = app.get(AccessTokenService).issue('ats019_reader').token;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await db.$disconnect();
    for (const [key, value] of envBackup) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  /** 用与钉钉相同的签名与 AES 规范封装修改后的事件；仅 signature 可被替换以模拟伪造。 */
  const post = (payload: unknown, signature?: string) => {
    const sealed = callbackCrypto.encryptReply(JSON.stringify(payload), String(Date.now()), randomBytes(4).toString('hex'));
    return request(app.getHttpServer())
      .post('/api/v1/dingtalk/events')
      .query({ msg_signature: signature ?? sealed.msg_signature, timestamp: sealed.timeStamp, nonce: sealed.nonce })
      .send({ encrypt: sealed.encrypt });
  };
  const callbackA = { EventType: 'bpms_instance_change', corpId: CORP_ID, processInstanceId: INSTANCE_A, type: 'finish', result: 'agree', processCode: 'PROC-REQ', finishTime: '1762058400000' };
  const approvalEvents = () => db.dingTalkSyncEvent.findMany({ where: { eventType: { startsWith: 'bpms_instance_change:' } }, orderBy: { receivedAt: 'asc' } });

  it('rejects forged or foreign callbacks before anything is written', async () => {
    await post(callbackA, '0'.repeat(40)).expect(401);
    await post({ ...callbackA, corpId: 'corp-other' }).expect(400);
    // 其他审批模板、缺少 processCode 的事件：确认收到但不落库、不处理。
    await post({ ...callbackA, processCode: 'PROC-EXPENSE' }).expect(201);
    const withoutCode: Record<string, unknown> = { ...callbackA };
    delete withoutCode.processCode;
    await post(withoutCode).expect(201);
    expect(await approvalEvents()).toHaveLength(0);
    expect(await db.jobRequisition.count()).toBe(0);
    expect(fake.reads).toHaveLength(0);
  }, 30_000);

  it('turns concurrent duplicate callbacks into one event and exactly one requisition', async () => {
    await Promise.all(Array.from({ length: 16 }, () => post(callbackA).expect(201)));

    const events = await approvalEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ eventType: 'bpms_instance_change:finish:requisition', subjectId: INSTANCE_A, status: 'RECEIVED', corpId: CORP_ID });
    expect(queue.dispatch).toHaveBeenCalled();

    // 模拟 Worker 对同一事件并发重试，以及同一实例的重复投递。
    await Promise.all(Array.from({ length: 8 }, () => sync.processEvent(events[0]!.id)));
    await Promise.all(Array.from({ length: 12 }, () => oa.processApprovalEvent({ id: 'direct', eventType: 'bpms_instance_change:finish:requisition', subjectId: INSTANCE_A })));

    const requisitions = await db.jobRequisition.findMany({ where: { oaApprovalId: INSTANCE_A } });
    expect(requisitions).toHaveLength(1);
    expect(requisitions[0]).toMatchObject({
      oaApprovalTitle: '张三提交的招聘需求',
      oaBusinessId: 'BILL-2026-0001',
      title: '高级后端工程师',
      departmentId: 'dept-100',
      headcount: 3,
      jobLevel: 'P6',
      recruiterId: 'ats019_recruiter',
      note: '紧急',
      recruitmentStartDate: new Date('2026-11-05T00:00:00.000Z'),
      submittedAt: new Date('2026-11-02T00:00:00.000Z'),
    });
    const timeline = await db.timelineEvent.findMany({ where: { entityType: 'JobRequisition', entityId: requisitions[0]!.id, action: 'requisition.created_from_oa' } });
    expect(timeline).toHaveLength(1);
    expect(timeline[0]).toMatchObject({ actorId: 'system:dingtalk-oa', payload: { trigger: 'callback', processCodeVerified: true, oaBusinessId: 'BILL-2026-0001' } });
    expect((await db.dingTalkSyncEvent.findUniqueOrThrow({ where: { id: events[0]!.id } })).status).toBe('PROCESSED');
  }, 60_000);

  it('keeps manual sync idempotent and confines start-date completion to the manual path', async () => {
    const url = '/api/v1/requisitions/sync-from-oa';
    const again = await request(app.getHttpServer()).post(url).set('Authorization', `Bearer ${token}`).send({ processInstanceId: INSTANCE_A }).expect(200);
    expect(again.body).toMatchObject({ created: false, oa: { businessId: 'BILL-2026-0001' } });

    // 请求体直传需求字段的旧 Mock 契约不再被信任：只取实例标识回读钉钉，钉钉中不存在的单号不会生成需求。
    const raw = await request(app.getHttpServer()).post('/api/v1/requisitions/oa-sync').set('Authorization', `Bearer ${token}`)
      .send({ oaApprovalId: 'OA-2026-0001', title: '伪造需求', departmentId: 'dept-100', headcount: 1, submittedAt: '2026-01-01', recruitmentStartDate: '2026-01-01' }).expect(404);
    expect(raw.body).toMatchObject({ code: 'OA_INSTANCE_NOT_FOUND' });
    expect(await db.jobRequisition.count({ where: { title: '伪造需求' } })).toBe(0);

    // OA 表单缺少开始招聘时间：回调无法补录，事件置 FAILED 并给出可定位的错误码。
    await post({ ...callbackA, processInstanceId: INSTANCE_B }).expect(201);
    const eventB = (await approvalEvents()).find((event) => event.subjectId === INSTANCE_B)!;
    // 业务数据缺失属于永久失败：事件置 FAILED 并抛出 UnrecoverableError，等待管理员补录后重试。
    await expect(sync.processEvent(eventB.id)).rejects.toThrow('钉钉同步需要管理员处理');
    expect(await db.dingTalkSyncEvent.findUniqueOrThrow({ where: { id: eventB.id } })).toMatchObject({ status: 'FAILED', lastError: 'OA_RECRUITMENT_START_DATE_MISSING' });
    const missing = await request(app.getHttpServer()).post(url).set('Authorization', `Bearer ${token}`).send({ processInstanceId: INSTANCE_B }).expect(400);
    expect(missing.body).toMatchObject({ code: 'OA_RECRUITMENT_START_DATE_MISSING' });
    expect(await db.jobRequisition.count({ where: { oaApprovalId: INSTANCE_B } })).toBe(0);

    const completed = await request(app.getHttpServer()).post(url).set('Authorization', `Bearer ${token}`)
      .send({ processInstanceId: INSTANCE_B, recruitmentStartDate: '2026-11-20' }).expect(200);
    expect(completed.body).toMatchObject({ created: true, requisition: { recruitmentStartDate: expect.stringContaining('2026-11-20') } });
    expect(await db.jobRequisition.count({ where: { oaApprovalId: INSTANCE_B } })).toBe(1);
    const manualTimeline = await db.timelineEvent.findMany({ where: { entityId: completed.body.requisition.id, action: 'requisition.created_from_oa' } });
    expect(manualTimeline).toHaveLength(1);
    expect(manualTimeline[0]).toMatchObject({ actorId: hr.id, payload: { trigger: 'manual', processCodeVerified: false } });

    await request(app.getHttpServer()).post(url).set('Authorization', `Bearer ${readerToken}`).send({ processInstanceId: INSTANCE_A }).expect(403);
    await request(app.getHttpServer()).post(url).send({ processInstanceId: INSTANCE_A }).expect(401);

    const list = await request(app.getHttpServer()).get('/api/v1/requisitions/oa-sync/events').set('Authorization', `Bearer ${token}`).expect(200);
    expect(list.body.map((event: { id: string }) => event.id)).toEqual(expect.arrayContaining([eventB.id]));
    queue.retryFailed.mockResolvedValue({ id: eventB.id, status: 'RECEIVED' } as never);
    await request(app.getHttpServer()).post(`/api/v1/requisitions/oa-sync/events/${eventB.id}/retry`).set('Authorization', `Bearer ${token}`).expect(202);
    expect(queue.retryFailed).toHaveBeenCalledWith(eventB.id);
    await request(app.getHttpServer()).get('/api/v1/requisitions/oa-sync/capability').set('Authorization', `Bearer ${readerToken}`).expect(200);
  }, 60_000);

  it('starts exactly one OA offer approval with the three materials and two approver levels', async () => {
    const url = '/api/v1/candidates/ats019_c/offer/oa';
    await request(app.getHttpServer()).post(url).expect(401);
    await request(app.getHttpServer()).post(url).set('Authorization', `Bearer ${readerToken}`).expect(403);

    const created = await offers.create('ats019_c', hr);
    await offers.update('ats019_c', { action: 'DETAILS', version: created.workflowVersion, hireLevel: 'P6' }, hr);

    const results = await Promise.all(Array.from({ length: 6 }, () => request(app.getHttpServer()).post(url).set('Authorization', `Bearer ${token}`)));
    expect(results.map((result) => result.status).sort((a, b) => a - b)).toEqual([200, 409, 409, 409, 409, 409]);
    expect(fake.starts).toHaveLength(1);

    const sent = fake.starts[0]!;
    expect(sent.processCode).toBe('PROC-OFFER');
    expect(sent.originatorUserId).toBe('dt-hr-1');
    expect(sent.deptId).toBe(100);
    expect(sent.approvers).toEqual([
      { actionType: 'AND', userIds: ['mgr-a', 'mgr-b'] },
      { actionType: 'NONE', userIds: ['dir-a'] },
    ]);
    const materials: { name: string; value: string }[] = sent.formComponentValues as never;
    expect(materials.map((item) => item.name)).toEqual(['候选人', '申请职位', '简历信息', '面试登记表', '录用职级']);
    expect(JSON.stringify(sent)).not.toMatch(/13900000000|secret|salary|AI建议/i);
    expect(JSON.stringify(sent)).not.toContain('app-token');

    const offer = await db.offerRecord.findUniqueOrThrow({ where: { candidateId: 'ats019_c' } });
    expect(offer).toMatchObject({ oaInstanceId: OFFER_INSTANCE, oaApprovalId: OFFER_INSTANCE, oaInstanceStatus: 'RUNNING', oaSource: 'DINGTALK', stageStatus: 'PENDING' });
    expect(await db.timelineEvent.count({ where: { entityId: 'ats019_c', action: 'offer.oa_submitted' } })).toBe(1);

    // 系统发起后 OA 单号不可手工改写。
    const current = await offers.read('ats019_c', hr);
    const edit = await request(app.getHttpServer()).patch('/api/v1/candidates/ats019_c/offer').set('Authorization', `Bearer ${token}`)
      .send({ action: 'DETAILS', version: current!.workflowVersion, oaApprovalId: 'MANUAL-1' }).expect(409);
    expect(JSON.stringify(edit.body)).toContain('不可手工修改');
  }, 60_000);

  it('shows the OA result without driving the Offer stage result', async () => {
    instances.set(OFFER_INSTANCE, { title: '候选人录用审批', status: 'COMPLETED', result: 'agree', createTime: '2026-11-10T01:00Z', finishTime: '2026-11-12T09:00Z' });
    const refreshed = await request(app.getHttpServer()).post('/api/v1/candidates/ats019_c/offer/oa/refresh').set('Authorization', `Bearer ${token}`).expect(200);
    expect(refreshed.body).toMatchObject({ changed: true, status: 'COMPLETED', result: 'agree', offer: { oaInstanceStatus: 'COMPLETED', oaInstanceResult: 'agree', stageStatus: 'PENDING' } });

    // 审批被拒绝的回调同样只更新展示字段。
    instances.set(OFFER_INSTANCE, { status: 'COMPLETED', result: 'refuse', createTime: '2026-11-10T01:00Z' });
    await post({ ...callbackA, processInstanceId: OFFER_INSTANCE, processCode: 'PROC-OFFER' }).expect(201);
    const offerEvent = (await approvalEvents()).find((event) => event.subjectId === OFFER_INSTANCE)!;
    await sync.processEvent(offerEvent.id);
    const offer = await db.offerRecord.findUniqueOrThrow({ where: { candidateId: 'ats019_c' } });
    expect(offer).toMatchObject({ oaInstanceStatus: 'COMPLETED', oaInstanceResult: 'refuse', stageStatus: 'PENDING' });
    expect((await db.candidate.findUniqueOrThrow({ where: { id: 'ats019_c' } })).stage).toBe('OFFERING');

    // 人工回填的 OA 单号没有系统实例，不能刷新。
    const manual = await offers.create('ats019_manual', hr);
    await offers.update('ats019_manual', { action: 'DETAILS', version: manual.workflowVersion, hireLevel: 'P5', oaApprovalId: 'MANUAL-9' }, hr);
    await request(app.getHttpServer()).post('/api/v1/candidates/ats019_manual/offer/oa/refresh').set('Authorization', `Bearer ${token}`).expect(409);
    expect(await db.offerRecord.findUnique({ where: { candidateId: 'ats019_manual' } })).toMatchObject({ oaSource: 'MANUAL', oaInstanceId: null });
  }, 60_000);
});

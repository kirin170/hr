import { ConflictException, NotFoundException } from '@nestjs/common';
import { IdentityProvider } from '@prisma/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import type { OffersService } from '../offers/offers.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { RequisitionsService } from '../requisitions/requisitions.service.js';
import { DingTalkOaClient, DingTalkOaError, type DingTalkApprovalInstance } from './dingtalk-oa.client.js';
import { loadOaConfig } from './dingtalk-oa.config.js';
import { dingtalkDepartmentCode } from './dingtalk-department-code.js';
import { OaSyncError } from './dingtalk-oa.errors.js';
import { DingTalkOaService } from './dingtalk-oa.service.js';
import type { DingTalkSyncQueueService } from './dingtalk-sync.queue.js';

const INSTANCE = 'ad253df6-e175caf-xxxxxxxxxxxx';
const actor: AuthenticatedUser = {
  id: 'hr-1',
  displayName: '招聘 HR',
  departmentId: 'dept-100',
  departmentIds: ['dept-100'],
  groupIds: [],
  roles: [],
};

const field = (id: string, name: string, value: string) => ({
  id,
  name,
  value,
  componentType: 'TextField',
  bizAlias: null,
  extValue: null,
});

const approval = (overrides: Partial<DingTalkApprovalInstance> = {}): DingTalkApprovalInstance => ({
  processInstanceId: INSTANCE,
  title: '张三提交的招聘需求',
  status: 'COMPLETED',
  result: 'agree',
  // 北京时间 2026-11-02 01:30：按 UTC 取日会差一天
  createTime: new Date('2026-11-01T17:30:00Z'),
  finishTime: new Date('2026-11-02T10:00:00Z'),
  originatorUserId: 'manager1',
  originatorDeptId: 100,
  originatorDeptName: '研发部',
  businessId: 'BILL-001',
  form: [
    field('TextField-1', '需求名称', '高级后端工程师'),
    field('DDDepartmentField-2', '需求部门', '[100]'),
    field('DDNumberField-3', '招聘人数', '3'),
    field('DDDateField-4', '开始招聘时间', '2026-11-05 00:00'),
    field('DDMultiSelectField-5', '招聘负责人', '["dt-recruiter"]'),
    field('TextField-6', '职级', 'P6'),
    field('TextareaField-7', '备注', '紧急'),
  ],
  ...overrides,
});

const offer = (overrides: Record<string, unknown> = {}) => ({
  id: 'offer-1',
  candidateId: 'c-1',
  jobId: 'job-1',
  workflowStage: 'OA_APPROVAL',
  stageStatus: 'PENDING',
  workflowVersion: 3,
  hireLevel: 'P6',
  oaApprovalId: null,
  oaInstanceId: null,
  oaInstanceStatus: null,
  oaInstanceResult: null,
  ...overrides,
});

const preview = {
  resume: {
    name: '张三',
    experience: '5 年',
    education: '本科',
    school: '某大学',
    currentCompany: 'A 公司',
    currentTitle: '工程师',
    workHistory: [{ company: 'A 公司', title: '工程师', period: '2020-2024' }],
    phone: '13900000000',
    email: 'zhangsan@example.com',
  },
  registration: {
    fields: [{ key: 'address', label: '地址' }, { key: 'expectSalary', label: '期望薪资' }, { key: 'ai', label: 'AI建议' }],
    values: { address: '上海', expectSalary: '30k', ai: '强烈建议录用' },
  },
  hireLevel: 'P6',
};

function configure() {
  vi.stubEnv('DINGTALK_CORP_ID', 'corp-1');
  vi.stubEnv('DINGTALK_OA_REQUISITION_PROCESS_CODE', 'PROC-REQ');
  vi.stubEnv('DINGTALK_OA_OFFER_PROCESS_CODE', 'PROC-OFFER');
  vi.stubEnv('DINGTALK_OA_OFFER_APPROVERS_LEVEL_1', 'mgr-a,mgr-b');
  vi.stubEnv('DINGTALK_OA_OFFER_APPROVERS_LEVEL_2', 'dir-a');
}

type Mocked = ReturnType<typeof makeService>;

function makeService() {
  const prisma = {
    department: {
      findFirst: vi.fn().mockResolvedValue({ id: 'dept-100' }),
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue({ code: dingtalkDepartmentCode('corp-1', 100) }),
    },
    identityLink: {
      findUnique: vi.fn().mockImplementation(async (args: { where: Record<string, unknown> }) =>
        'provider_userId' in args.where ? { subject: 'dt-hr-1' } : { userId: 'user-recruiter' },
      ),
    },
    offerRecord: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    job: { findUnique: vi.fn().mockResolvedValue({ title: '后端工程师' }) },
    timelineEvent: { create: vi.fn().mockResolvedValue({}) },
    dingTalkSyncEvent: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn().mockResolvedValue(null) },
  };
  const client = {
    getInstance: vi.fn().mockResolvedValue(approval()),
    startInstance: vi.fn().mockResolvedValue({ id: 'offer-instance-0001' }),
  };
  const requisitions = {
    syncFromOa: vi.fn().mockResolvedValue({ created: true, requisition: { id: 'req-1' } }),
  };
  const offers = {
    assertOfferCandidate: vi.fn().mockResolvedValue({ id: 'c-1', jobId: 'job-1', stage: 'OFFERING' }),
    preview: vi.fn().mockResolvedValue(preview),
    read: vi.fn().mockResolvedValue({ id: 'offer-1' }),
  };
  const queue = { retryFailed: vi.fn().mockResolvedValue({ id: 'evt-1', status: 'RECEIVED' }) };
  const service = new DingTalkOaService(
    prisma as unknown as PrismaService,
    client as unknown as DingTalkOaClient,
    requisitions as unknown as RequisitionsService,
    offers as unknown as OffersService,
    queue as unknown as DingTalkSyncQueueService,
  );
  return { service, prisma, client, requisitions, offers, queue };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('loadOaConfig', () => {
  it('applies defaults and lets a deployment override or disable fields explicitly', () => {
    configure();
    vi.stubEnv('DINGTALK_OA_REQUISITION_FIELD_MAP', JSON.stringify({ title: '岗位需求名称', requirements: null }));

    const config = loadOaConfig();

    expect(config.valid).toBe(true);
    expect(config.requisition.fieldMap.title).toBe('岗位需求名称');
    expect(config.requisition.fieldMap.requirements).toBeNull();
    expect(config.requisition.fieldMap.headcount).toBe('招聘人数');
    expect(config.offer.approverLevels).toEqual([['mgr-a', 'mgr-b'], ['dir-a']]);
  });

  it('rejects malformed field maps, unknown keys and half-configured approver levels', () => {
    configure();
    vi.stubEnv('DINGTALK_OA_REQUISITION_FIELD_MAP', '{not json');
    expect(loadOaConfig()).toMatchObject({ valid: false, code: 'OA_REQUISITION_FIELD_MAP_INVALID' });

    vi.stubEnv('DINGTALK_OA_REQUISITION_FIELD_MAP', JSON.stringify({ salary: '薪资' }));
    expect(loadOaConfig()).toMatchObject({ valid: false, code: 'OA_REQUISITION_FIELD_MAP_INVALID' });

    vi.stubEnv('DINGTALK_OA_REQUISITION_FIELD_MAP', '');
    vi.stubEnv('DINGTALK_OA_OFFER_APPROVERS_LEVEL_2', '');
    expect(loadOaConfig()).toMatchObject({ valid: false, code: 'OA_APPROVERS_INCOMPLETE' });

    vi.stubEnv('DINGTALK_OA_OFFER_APPROVERS_LEVEL_1', '');
    expect(loadOaConfig().offer.approverLevels).toEqual([]);
  });
});

describe('DingTalkOaService.inspectApprovalCallback', () => {
  it('accepts only events of the configured templates', () => {
    configure();
    const { service } = makeService();

    expect(
      service.inspectApprovalCallback({ EventType: 'bpms_instance_change', processInstanceId: INSTANCE, type: 'finish', processCode: 'PROC-REQ' }),
    ).toEqual({ kind: 'finish', template: 'requisition', processInstanceId: INSTANCE });
    expect(
      service.inspectApprovalCallback({ EventType: 'bpms_instance_change', processInstanceId: INSTANCE, type: 'terminate', processCode: 'PROC-OFFER' }),
    ).toEqual({ kind: 'terminate', template: 'offer', processInstanceId: INSTANCE });
  });

  it('ignores other templates, missing process codes, unknown types and malformed instance ids', () => {
    configure();
    const { service } = makeService();
    const base = { EventType: 'bpms_instance_change', processInstanceId: INSTANCE, type: 'finish' };

    expect(service.inspectApprovalCallback({ ...base, processCode: 'PROC-EXPENSE' })).toBeNull();
    expect(service.inspectApprovalCallback(base)).toBeNull();
    expect(service.inspectApprovalCallback({ ...base, processCode: 'PROC-REQ', type: 'redirect' })).toBeNull();
    expect(service.inspectApprovalCallback({ ...base, processCode: 'PROC-REQ', processInstanceId: '../../v1.0/oauth2/accessToken' })).toBeNull();
  });

  it('ignores approval events while the OA configuration is invalid', () => {
    configure();
    vi.stubEnv('DINGTALK_OA_OFFER_FIELD_MAP', '{broken');
    const { service } = makeService();

    expect(service.inspectApprovalCallback({ processInstanceId: INSTANCE, type: 'finish', processCode: 'PROC-REQ' })).toBeNull();
    expect(service.capability()).toMatchObject({ valid: false, requisition: { configured: false }, offer: { configured: false } });
  });
});

describe('DingTalkOaService.syncRequisition（人工触发）', () => {
  it('maps the approved OA form into a requisition through the idempotent writer', async () => {
    configure();
    const { service, prisma, requisitions }: Mocked = makeService();

    const result = await service.syncRequisition({ processInstanceId: INSTANCE }, actor);

    expect(prisma.department.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { code: dingtalkDepartmentCode('corp-1', 100), isActive: true } }),
    );
    expect(prisma.identityLink.findUnique).toHaveBeenCalledWith({
      where: { provider_subject: { provider: IdentityProvider.DINGTALK, subject: 'dt-recruiter' } },
      select: { userId: true },
    });
    expect(requisitions.syncFromOa).toHaveBeenCalledWith(
      {
        oaApprovalId: INSTANCE,
        oaApprovalTitle: '张三提交的招聘需求',
        oaBusinessId: 'BILL-001',
        title: '高级后端工程师',
        departmentId: 'dept-100',
        headcount: 3,
        submittedAt: '2026-11-02',
        recruitmentStartDate: '2026-11-05',
        jobLevel: 'P6',
        recruiterId: 'user-recruiter',
        note: '紧急',
        requirements: null,
      },
      actor,
      { trigger: 'manual', processCodeVerified: false },
    );
    expect(result).toMatchObject({ created: true, oa: { businessId: 'BILL-001', status: 'COMPLETED', result: 'agree' } });
  });

  it('accepts a DingTalk detail link, an explicit start date and a text department matched by unique name', async () => {
    configure();
    const { service, prisma, client, requisitions }: Mocked = makeService();
    client.getInstance.mockResolvedValue(
      approval({ form: [field('TextField-1', '需求名称', '测试'), field('DDDepartmentField-2', '需求部门', '["质量部"]'), field('DDNumberField-3', '招聘人数', '1')] }),
    );
    prisma.department.findMany.mockResolvedValue([{ id: 'dept-qa' }]);

    await service.syncRequisition(
      { processInstanceId: `https://aflow.dingtalk.com/dingtalk/mobile/homepage.htm?procInstId=${INSTANCE}`, recruitmentStartDate: '2026-11-10' },
      actor,
    );

    expect(client.getInstance).toHaveBeenCalledWith(INSTANCE);
    expect(prisma.department.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { name: { in: ['质量部'] }, isActive: true } }),
    );
    expect(prisma.identityLink.findUnique).not.toHaveBeenCalled();
    expect(requisitions.syncFromOa.mock.calls.at(-1)?.[0]).toEqual(
      expect.objectContaining({ departmentId: 'dept-qa', recruitmentStartDate: '2026-11-10', recruiterId: null }),
    );
  });

  it('does not guess between same-named departments', async () => {
    configure();
    const { service, prisma }: Mocked = makeService();
    prisma.department.findFirst.mockResolvedValue(null);
    prisma.department.findMany.mockResolvedValue([{ id: 'dept-a' }, { id: 'dept-b' }]);

    await expect(service.syncRequisition({ processInstanceId: INSTANCE, recruitmentStartDate: '2026-11-10' }, actor)).rejects.toMatchObject({
      status: 409,
      response: { code: 'OA_DEPARTMENT_UNMAPPED' },
    });
  });
});

describe('DingTalkOaService 同步拒绝路径', () => {
  it('refuses approvals that are not completed-and-agreed', async () => {
    configure();
    const { service, client, requisitions }: Mocked = makeService();
    client.getInstance.mockResolvedValueOnce(approval({ status: 'RUNNING', result: null }));

    await expect(service.syncRequisition({ processInstanceId: INSTANCE }, actor)).rejects.toMatchObject({
      status: 409,
      response: { code: 'OA_APPROVAL_NOT_APPROVED' },
    });

    client.getInstance.mockResolvedValueOnce(approval({ result: 'refuse' }));
    await expect(service.syncRequisition({ processInstanceId: INSTANCE }, actor)).rejects.toMatchObject({
      response: { code: 'OA_APPROVAL_NOT_APPROVED' },
    });
    expect(requisitions.syncFromOa).not.toHaveBeenCalled();
  });

  it('requires title, department, a positive headcount, a mapped department and the start date', async () => {
    configure();
    const { service, client, requisitions, prisma }: Mocked = makeService();
    const title = field('TextField-1', '需求名称', 'x');
    const department = field('DDDepartmentField-2', '需求部门', '[100]');
    const headcount = (value: string) => field('DDNumberField-3', '招聘人数', value);

    client.getInstance.mockResolvedValueOnce(approval({ form: [headcount('3')] }));
    await expect(service.syncRequisition({ processInstanceId: INSTANCE }, actor)).rejects.toMatchObject({ response: { code: 'OA_FIELD_MISSING_TITLE' } });

    client.getInstance.mockResolvedValueOnce(approval({ form: [title, headcount('3')] }));
    await expect(service.syncRequisition({ processInstanceId: INSTANCE }, actor)).rejects.toMatchObject({ response: { code: 'OA_FIELD_MISSING_DEPARTMENT' } });

    client.getInstance.mockResolvedValueOnce(approval({ form: [title, department, headcount('')] }));
    await expect(service.syncRequisition({ processInstanceId: INSTANCE }, actor)).rejects.toMatchObject({ response: { code: 'OA_FIELD_MISSING_HEADCOUNT' } });

    client.getInstance.mockResolvedValueOnce(approval({ form: [title, department, headcount('两')] }));
    await expect(service.syncRequisition({ processInstanceId: INSTANCE }, actor)).rejects.toMatchObject({ response: { code: 'OA_HEADCOUNT_INVALID' } });

    client.getInstance.mockResolvedValueOnce(approval({ form: [title, department, headcount('0')] }));
    await expect(service.syncRequisition({ processInstanceId: INSTANCE }, actor)).rejects.toMatchObject({ response: { code: 'OA_HEADCOUNT_INVALID' } });

    client.getInstance.mockResolvedValueOnce(approval({ form: [title, field('DDDepartmentField-2', '需求部门', '[999]'), headcount('1')] }));
    prisma.department.findFirst.mockResolvedValueOnce(null);
    prisma.department.findMany.mockResolvedValueOnce([]);
    await expect(service.syncRequisition({ processInstanceId: INSTANCE }, actor)).rejects.toMatchObject({ response: { code: 'OA_DEPARTMENT_UNMAPPED' } });

    client.getInstance.mockResolvedValueOnce(approval({ form: [title, department, headcount('1')] }));
    await expect(service.syncRequisition({ processInstanceId: INSTANCE }, actor)).rejects.toMatchObject({
      status: 400,
      response: { code: 'OA_RECRUITMENT_START_DATE_MISSING' },
    });
    expect(requisitions.syncFromOa).not.toHaveBeenCalled();
  });

  it('rejects an invalid reference or a bad override date before calling DingTalk', async () => {
    configure();
    const { service, client }: Mocked = makeService();

    // 旧式 OA 单号与实例 ID 字符集相同，无法在入口区分；会被当作实例 ID 回读并由钉钉判定不存在。
    await expect(service.syncRequisition({ oaApprovalId: '../../v1.0/oauth2/accessToken' }, actor)).rejects.toMatchObject({
      status: 400,
      response: { code: 'OA_INSTANCE_ID_REQUIRED' },
    });
    await expect(service.syncRequisition({ processInstanceId: INSTANCE, recruitmentStartDate: '2026-02-30' }, actor)).rejects.toMatchObject({
      response: { code: 'OA_START_DATE_INVALID' },
    });
    expect(client.getInstance).not.toHaveBeenCalled();
  });

  it('does not call DingTalk while the template is unconfigured or the configuration is invalid', async () => {
    configure();
    vi.stubEnv('DINGTALK_OA_REQUISITION_PROCESS_CODE', '');
    const { service, client }: Mocked = makeService();
    await expect(service.syncRequisition({ processInstanceId: INSTANCE }, actor)).rejects.toMatchObject({
      status: 503,
      response: { code: 'OA_REQUISITION_TEMPLATE_NOT_CONFIGURED' },
    });

    vi.stubEnv('DINGTALK_OA_REQUISITION_PROCESS_CODE', 'PROC-REQ');
    vi.stubEnv('DINGTALK_OA_OFFER_FIELD_MAP', '{broken');
    await expect(service.syncRequisition({ processInstanceId: INSTANCE }, actor)).rejects.toMatchObject({ response: { code: 'OA_OFFER_FIELD_MAP_INVALID' } });
    expect(client.getInstance).not.toHaveBeenCalled();
  });

  it('maps platform permission, not-found and unconfigured errors to HTTP statuses', async () => {
    configure();
    const { service, client }: Mocked = makeService();

    client.getInstance.mockRejectedValueOnce(new DingTalkOaError('DENIED', 'Forbidden.AccessDenied'));
    await expect(service.syncRequisition({ processInstanceId: INSTANCE }, actor)).rejects.toMatchObject({ status: 403 });
    client.getInstance.mockRejectedValueOnce(new DingTalkOaError('INVALID', 'invalidParameter'));
    await expect(service.syncRequisition({ processInstanceId: INSTANCE }, actor)).rejects.toMatchObject({ status: 404 });
    client.getInstance.mockRejectedValueOnce(new DingTalkOaError('NOT_CONFIGURED', 'OA_NOT_CONFIGURED'));
    await expect(service.syncRequisition({ processInstanceId: INSTANCE }, actor)).rejects.toMatchObject({ status: 503 });
  });
});

describe('DingTalkOaService.processApprovalEvent（回调处理）', () => {
  it('creates the requisition as the system actor with the template verified by the signed callback', async () => {
    configure();
    const { service, requisitions }: Mocked = makeService();

    await service.processApprovalEvent({ id: 'evt-1', eventType: 'bpms_instance_change:finish:requisition', subjectId: INSTANCE });

    expect(requisitions.syncFromOa).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'system:dingtalk-oa' }),
      { trigger: 'callback', processCodeVerified: true },
    );
  });

  it('ignores instance start and terminate events for requisitions', async () => {
    configure();
    const { service, client, requisitions }: Mocked = makeService();

    await service.processApprovalEvent({ id: 'evt-1', eventType: 'bpms_instance_change:start:requisition', subjectId: INSTANCE });
    await service.processApprovalEvent({ id: 'evt-2', eventType: 'bpms_instance_change:terminate:requisition', subjectId: INSTANCE });

    expect(client.getInstance).not.toHaveBeenCalled();
    expect(requisitions.syncFromOa).not.toHaveBeenCalled();
  });

  it('fails permanently with a code when the callback form lacks the start date', async () => {
    configure();
    const { service, client }: Mocked = makeService();
    client.getInstance.mockResolvedValue(
      approval({ form: [field('TextField-1', '需求名称', 'x'), field('DDDepartmentField-2', '需求部门', '[100]'), field('DDNumberField-3', '招聘人数', '1')] }),
    );

    await expect(
      service.processApprovalEvent({ id: 'evt-1', eventType: 'bpms_instance_change:finish:requisition', subjectId: INSTANCE }),
    ).rejects.toMatchObject({ code: 'OA_RECRUITMENT_START_DATE_MISSING' });
  });

  it('keeps platform unavailability retryable instead of turning it into a permanent failure', async () => {
    configure();
    const { service, client }: Mocked = makeService();
    client.getInstance.mockRejectedValue(new DingTalkOaError('UNAVAILABLE', 'Throttling'));

    const error: unknown = await service
      .processApprovalEvent({ id: 'evt-1', eventType: 'bpms_instance_change:finish:requisition', subjectId: INSTANCE })
      .catch((value: unknown) => value);

    expect(error).toBeInstanceOf(DingTalkOaError);
    expect(error).not.toBeInstanceOf(OaSyncError);
  });

  it('refreshes the linked Offer on finish or terminate without touching stage results', async () => {
    configure();
    const { service, prisma, client }: Mocked = makeService();
    prisma.offerRecord.findFirst.mockResolvedValue(offer({ oaInstanceId: INSTANCE, oaInstanceStatus: 'RUNNING', oaInstanceResult: null }));
    client.getInstance.mockResolvedValue(approval({ result: 'refuse' }));

    await service.processApprovalEvent({ id: 'evt-1', eventType: 'bpms_instance_change:finish:offer', subjectId: INSTANCE });

    expect(prisma.offerRecord.findFirst).toHaveBeenCalledWith({ where: { oaInstanceId: INSTANCE } });
    expect(prisma.offerRecord.updateMany).toHaveBeenCalledWith({
      where: { id: 'offer-1', oaInstanceId: INSTANCE },
      data: expect.objectContaining({ oaInstanceStatus: 'COMPLETED', oaInstanceResult: 'refuse' }),
    });
    expect(prisma.timelineEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'offer.oa_synced', actorId: 'system:dingtalk-oa' }) }),
    );

    prisma.offerRecord.updateMany.mockClear();
    await service.processApprovalEvent({ id: 'evt-2', eventType: 'bpms_instance_change:start:offer', subjectId: INSTANCE });
    expect(prisma.offerRecord.updateMany).not.toHaveBeenCalled();
  });

  it('leaves approvals that belong to no system-started Offer alone', async () => {
    configure();
    const { service, prisma }: Mocked = makeService();

    await service.processApprovalEvent({ id: 'evt-1', eventType: 'bpms_instance_change:finish:offer', subjectId: INSTANCE });

    expect(prisma.offerRecord.updateMany).not.toHaveBeenCalled();
  });
});

describe('DingTalkOaService.submitOfferApproval', () => {
  it('starts one approval with the three materials and two approver levels, then records the instance', async () => {
    configure();
    const { service, client, prisma }: Mocked = makeService();
    prisma.offerRecord.findUnique.mockResolvedValue(offer());

    const result = await service.submitOfferApproval('c-1', actor);

    expect(client.startInstance).toHaveBeenCalledTimes(1);
    const input = client.startInstance.mock.calls[0]?.[0] as {
      processCode: string;
      originatorUserId: string;
      deptId: number;
      formComponentValues: { name: string; value: string }[];
      approvers: unknown[];
    };
    expect(input.processCode).toBe('PROC-OFFER');
    expect(input.originatorUserId).toBe('dt-hr-1');
    expect(input.deptId).toBe(100);
    expect(input.approvers).toEqual([
      { actionType: 'AND', userIds: ['mgr-a', 'mgr-b'] },
      { actionType: 'NONE', userIds: ['dir-a'] },
    ]);
    // 材料只有三项，外加候选人/职位两个辅助字段；不含面试评价、AI 建议、薪资与联系方式。
    const materials = Object.fromEntries(input.formComponentValues.map((item) => [item.name, item.value]));
    expect(Object.keys(materials)).toEqual(['候选人', '申请职位', '简历信息', '面试登记表', '录用职级']);
    expect(materials['简历信息']).toContain('姓名：张三');
    expect(materials['简历信息']).toContain('工作经历：\n- A 公司 / 工程师 / 2020-2024');
    expect(materials['面试登记表']).toBe('地址：上海');
    expect(materials['录用职级']).toBe('P6');
    expect(JSON.stringify(materials)).not.toMatch(/13900000000|zhangsan@example\.com|30k|强烈建议录用/);

    // 先占用再调用钉钉，最后回写实例 ID。
    expect(prisma.offerRecord.updateMany.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ data: { oaInstanceStatus: 'SUBMITTING' } }),
    );
    expect(prisma.offerRecord.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'offer-1', oaInstanceStatus: 'SUBMITTING' },
      data: {
        oaInstanceId: 'offer-instance-0001',
        oaApprovalId: 'offer-instance-0001',
        oaInstanceStatus: 'RUNNING',
        oaInstanceResult: null,
        oaSyncedAt: expect.any(Date),
        oaSource: 'DINGTALK',
      },
    });
    expect(prisma.timelineEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'offer.oa_submitted',
          actorId: 'hr-1',
          payload: expect.objectContaining({ instanceId: 'offer-instance-0001', approverLevelSizes: [2, 1] }),
        }),
      }),
    );
    expect(result).toEqual({ offer: { id: 'offer-1' } });
  });

  it('claims the offer before calling DingTalk so concurrent launches cannot both proceed', async () => {
    configure();
    const { service, client, prisma }: Mocked = makeService();
    prisma.offerRecord.findUnique.mockResolvedValue(offer());
    prisma.offerRecord.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.submitOfferApproval('c-1', actor)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.offerRecord.updateMany.mock.calls[0]?.[0].where).toMatchObject({
      id: 'offer-1',
      oaInstanceId: null,
      workflowVersion: 3,
    });
    // 材料预览是纯读取，可以先做；占用失败后绝不调用钉钉。
    expect(client.startInstance).not.toHaveBeenCalled();
  });

  it('refuses to start when the offer is not ready or the operator has no DingTalk identity', async () => {
    configure();
    const { service, client, prisma }: Mocked = makeService();

    prisma.offerRecord.findUnique.mockResolvedValue(offer({ oaInstanceId: 'existing-instance-1' }));
    await expect(service.submitOfferApproval('c-1', actor)).rejects.toThrow('请勿重复发起');

    prisma.offerRecord.findUnique.mockResolvedValue(offer({ hireLevel: '  ' }));
    await expect(service.submitOfferApproval('c-1', actor)).rejects.toThrow('录用职级');

    prisma.offerRecord.findUnique.mockResolvedValue(offer({ stageStatus: 'NOT_PASSED' }));
    await expect(service.submitOfferApproval('c-1', actor)).rejects.toThrow('仅在录用审批资料或 OA 审批阶段');

    prisma.offerRecord.findUnique.mockResolvedValue(offer({ workflowStage: 'ORAL_OFFER', stageStatus: 'PENDING' }));
    await expect(service.submitOfferApproval('c-1', actor)).rejects.toThrow('仅在录用审批资料或 OA 审批阶段');

    prisma.offerRecord.findUnique.mockResolvedValue(offer());
    prisma.identityLink.findUnique.mockResolvedValueOnce(null);
    await expect(service.submitOfferApproval('c-1', actor)).rejects.toThrow('未绑定钉钉身份');
    expect(prisma.offerRecord.updateMany).not.toHaveBeenCalled();
    expect(client.startInstance).not.toHaveBeenCalled();
  });

  it('releases the claim on an explicit platform rejection but keeps it when the outcome is unknown', async () => {
    configure();
    const { service, client, prisma }: Mocked = makeService();
    prisma.offerRecord.findUnique.mockResolvedValue(offer());
    client.startInstance.mockRejectedValueOnce(new DingTalkOaError('DENIED', 'Forbidden.AccessDenied'));

    await expect(service.submitOfferApproval('c-1', actor)).rejects.toMatchObject({ status: 403, response: { code: 'OA_PERMISSION_DENIED' } });
    expect(prisma.offerRecord.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'offer-1', oaInstanceStatus: 'SUBMITTING' },
      data: { oaInstanceStatus: null },
    });
    expect(prisma.timelineEvent.create).not.toHaveBeenCalled();

    client.startInstance.mockRejectedValueOnce(new DingTalkOaError('UNAVAILABLE', 'network_error'));
    await expect(service.submitOfferApproval('c-1', actor)).rejects.toMatchObject({ status: 503 });
    // 第二轮只有“占用”一次写入：结果未知时不释放，避免重复发起。
    expect(prisma.offerRecord.updateMany).toHaveBeenCalledTimes(3);
  });

  it('does not call DingTalk while the offer template is unconfigured', async () => {
    configure();
    vi.stubEnv('DINGTALK_OA_OFFER_PROCESS_CODE', '');
    const { service, client, offers }: Mocked = makeService();

    await expect(service.submitOfferApproval('c-1', actor)).rejects.toMatchObject({
      status: 503,
      response: { code: 'OA_OFFER_TEMPLATE_NOT_CONFIGURED' },
    });
    expect(offers.assertOfferCandidate).not.toHaveBeenCalled();
    expect(client.startInstance).not.toHaveBeenCalled();
  });
});

describe('DingTalkOaService.refreshOfferApproval 与事件管理', () => {
  it('refreshes only system-started approvals and never changes the stage result', async () => {
    configure();
    const { service, prisma, client, offers }: Mocked = makeService();
    prisma.offerRecord.findUnique.mockResolvedValue(offer({ oaApprovalId: 'MANUAL-1', oaSource: 'MANUAL' }));

    await expect(service.refreshOfferApproval('c-1', actor)).rejects.toThrow('人工回填');
    expect(client.getInstance).not.toHaveBeenCalled();

    prisma.offerRecord.findUnique.mockResolvedValue(offer({ oaInstanceId: INSTANCE, oaInstanceStatus: 'RUNNING' }));
    prisma.offerRecord.findFirst.mockResolvedValue(offer({ oaInstanceId: INSTANCE, oaInstanceStatus: 'RUNNING', oaInstanceResult: null }));

    const result = await service.refreshOfferApproval('c-1', actor);

    expect(result).toMatchObject({ matched: true, changed: true, status: 'COMPLETED', result: 'agree' });
    expect(prisma.offerRecord.updateMany).toHaveBeenCalledWith({
      where: { id: 'offer-1', oaInstanceId: INSTANCE },
      data: expect.objectContaining({ oaInstanceStatus: 'COMPLETED', oaInstanceResult: 'agree' }),
    });
    expect(prisma.timelineEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'offer.oa_synced', actorId: null, payload: expect.objectContaining({ trigger: 'manual' }) }),
      }),
    );
    expect(offers.read).toHaveBeenCalledWith('c-1', actor);

    // 状态未变化时只更新同步时间，不重复写时间线。
    prisma.timelineEvent.create.mockClear();
    prisma.offerRecord.findFirst.mockResolvedValue(offer({ oaInstanceId: INSTANCE, oaInstanceStatus: 'COMPLETED', oaInstanceResult: 'agree' }));
    const again = await service.refreshOfferApproval('c-1', actor);
    expect(again).toMatchObject({ changed: false });
    expect(prisma.timelineEvent.create).not.toHaveBeenCalled();
  });

  it('lists only approval events and refuses to retry organization events', async () => {
    configure();
    const { service, prisma, queue }: Mocked = makeService();

    await service.listApprovalEvents();
    expect(prisma.dingTalkSyncEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { eventType: { startsWith: 'bpms_instance_change:' } } }),
    );

    await expect(service.retryApprovalEvent('evt-org')).rejects.toBeInstanceOf(NotFoundException);
    expect(queue.retryFailed).not.toHaveBeenCalled();

    prisma.dingTalkSyncEvent.findUnique.mockResolvedValue({ id: 'evt-oa', eventType: 'user_leave_org' });
    await expect(service.retryApprovalEvent('evt-oa')).rejects.toBeInstanceOf(NotFoundException);

    prisma.dingTalkSyncEvent.findUnique.mockResolvedValue({ id: 'evt-oa', eventType: 'bpms_instance_change:finish:requisition' });
    await service.retryApprovalEvent('evt-oa');
    expect(queue.retryFailed).toHaveBeenCalledWith('evt-oa');
  });
});

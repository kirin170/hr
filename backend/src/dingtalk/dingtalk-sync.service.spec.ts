import { afterEach, describe, expect, it, vi } from 'vitest';
import { Prisma, UserStatus } from '@prisma/client';
import { UnrecoverableError } from 'bullmq';
import { createHash } from 'node:crypto';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { DingTalkApiClient } from './dingtalk-api.client.js';
import { DingTalkApiError } from './dingtalk-api.client.js';
import type { DingTalkSyncQueueService } from './dingtalk-sync.queue.js';
import { DingTalkOaError } from './dingtalk-oa.client.js';
import { OaSyncError } from './dingtalk-oa.errors.js';
import type { DingTalkOaService } from './dingtalk-oa.service.js';
import { DingTalkSyncService } from './dingtalk-sync.service.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

const departmentCode = (corpId: string, departmentId: number) => {
  const digest = createHash('sha256').update(corpId).digest('hex').slice(0, 12);
  return `DINGTALK_${digest}_${departmentId}`;
};

describe('DingTalkSyncService', () => {
  it('saves and queues an idempotent callback event without calling DingTalk inline', async () => {
    vi.stubEnv('DINGTALK_CORP_ID', 'corp-1');
    const saved = { id: 'event-1', status: 'RECEIVED' };
    const create = vi.fn()
      .mockResolvedValueOnce(saved)
      .mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: 'test',
      }));
    const prisma = {
      dingTalkSyncEvent: {
        create,
        findUnique: vi.fn().mockResolvedValue(saved),
      },
    } as unknown as PrismaService;
    const api = {
      getUser: vi.fn(),
      listChildDepartments: vi.fn(),
      listDepartmentUsers: vi.fn(),
    } as unknown as DingTalkApiClient;
    const queue = { dispatch: vi.fn().mockResolvedValue(undefined) } as unknown as DingTalkSyncQueueService;
    const service = new DingTalkSyncService(prisma, api, queue);
    const event = { EventId: 'ding-event-1', EventType: 'user_modify_org', UserId: 'dt-user-1' };

    await expect(service.acceptCallback(event)).resolves.toEqual({ eventId: 'event-1', accepted: true });
    await expect(service.acceptCallback(event)).resolves.toEqual({ eventId: 'event-1', accepted: true });
    await Promise.resolve();

    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0]?.[0].data.eventId).toBe(create.mock.calls[1]?.[0].data.eventId);
    expect(queue.dispatch.mock.calls).toHaveLength(2);
    expect(api.getUser.mock.calls).toHaveLength(0);
  });

  it('creates a separate idempotent work item for every user ID in a batch callback', async () => {
    vi.stubEnv('DINGTALK_CORP_ID', 'corp-1');
    const create = vi.fn()
      .mockResolvedValueOnce({ id: 'event-1', status: 'RECEIVED' })
      .mockResolvedValueOnce({ id: 'event-2', status: 'RECEIVED' });
    const prisma = {
      dingTalkSyncEvent: { create },
    } as unknown as PrismaService;
    const queue = { dispatch: vi.fn().mockResolvedValue(undefined) } as unknown as DingTalkSyncQueueService;
    const service = new DingTalkSyncService(prisma, {} as DingTalkApiClient, queue);

    await expect(service.acceptCallback({
      eventId: 'batch-event-1',
      eventType: 'user_modify_org',
      corpId: 'corp-1',
      userId: ['dt-user-1', 'dt-user-2'],
    })).resolves.toEqual({ eventId: 'event-1', accepted: true });
    await Promise.resolve();

    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls.map(([input]) => input.data.subjectId)).toEqual(['dt-user-1', 'dt-user-2']);
    expect(create.mock.calls[0]?.[0].data.eventId).not.toBe(create.mock.calls[1]?.[0].data.eventId);
    expect(queue.dispatch.mock.calls.map(([eventId]) => eventId)).toEqual(['event-1', 'event-2']);
  });

  it('updates all user departments and primary department on a transfer event', async () => {
    vi.stubEnv('DINGTALK_CORP_ID', 'corp-1');
    const event = {
      id: 'event-2',
      eventType: 'user_modify_org',
      subjectId: 'dt-user-2',
      status: 'QUEUED',
    };
    const identityUser = {
      id: 'ats-user-2',
      displayName: '旧姓名',
      employeeNo: null,
      email: null,
      status: UserStatus.ACTIVE,
      departmentId: 'dept-20',
      departmentMemberships: [{ departmentId: 'dept-20' }],
    };
    const tx = {
      identityLink: { findUnique: vi.fn().mockResolvedValue({ userId: identityUser.id, user: identityUser }) },
      user: { update: vi.fn().mockResolvedValue({ id: identityUser.id }) },
      userDepartment: {
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
        createMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      dingTalkSyncEvent: {
        findUnique: vi.fn().mockResolvedValue(event),
        update: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      department: {
        count: vi.fn().mockResolvedValue(2),
        findMany: vi.fn().mockResolvedValue([
          { id: 'dept-20', code: departmentCode('corp-1', 20) },
          { id: 'dept-30', code: departmentCode('corp-1', 30) },
        ]),
      },
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
    } as unknown as PrismaService;
    const api = {
      getUser: vi.fn().mockResolvedValue({
        userid: 'dt-user-2',
        name: '新姓名',
        dept_id_list: [20, 30],
      }),
    } as unknown as DingTalkApiClient;
    const queue = {} as DingTalkSyncQueueService;
    const service = new DingTalkSyncService(prisma, api, queue);

    await service.processEvent(event.id);

    expect(tx.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: identityUser.id },
      data: expect.objectContaining({
        displayName: '新姓名',
        departmentId: 'dept-20',
        status: UserStatus.ACTIVE,
      }),
    }));
    expect(tx.userDepartment.createMany).toHaveBeenCalledWith({
      data: [
        { userId: identityUser.id, departmentId: 'dept-20', isPrimary: true },
        { userId: identityUser.id, departmentId: 'dept-30', isPrimary: false },
      ],
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'dingtalk.user.synced', resourceId: identityUser.id }),
    }));
    expect(prisma.dingTalkSyncEvent.update.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({
      data: expect.objectContaining({ status: 'PROCESSED' }),
    }));
  });

  it('deactivates a departed user and revokes authorization grants and refresh sessions', async () => {
    const event = { id: 'event-3', eventType: 'user_leave_org', subjectId: 'dt-user-3', status: 'QUEUED' };
    const identity = {
      userId: 'ats-user-3',
      user: { id: 'ats-user-3', status: UserStatus.ACTIVE, departmentId: 'dept-20' },
    };
    const tx = {
      user: { update: vi.fn().mockResolvedValue({}) },
      userDepartment: { deleteMany: vi.fn().mockResolvedValue({}) },
      userRole: { deleteMany: vi.fn().mockResolvedValue({}) },
      userGroupMember: { deleteMany: vi.fn().mockResolvedValue({}) },
      fieldAccessGrant: { deleteMany: vi.fn().mockResolvedValue({}) },
      refreshSession: { updateMany: vi.fn().mockResolvedValue({}) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      dingTalkSyncEvent: {
        findUnique: vi.fn().mockResolvedValue(event),
        update: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      identityLink: { findUnique: vi.fn().mockResolvedValue(identity) },
      $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
    } as unknown as PrismaService;
    const service = new DingTalkSyncService(
      prisma,
      {} as DingTalkApiClient,
      {} as DingTalkSyncQueueService,
    );

    await service.processEvent(event.id);

    expect(tx.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: identity.userId },
      data: { status: UserStatus.INACTIVE, departmentId: null },
    }));
    expect(tx.userRole.deleteMany).toHaveBeenCalledWith({ where: { userId: identity.userId } });
    expect(tx.userGroupMember.deleteMany).toHaveBeenCalledWith({ where: { userId: identity.userId } });
    expect(tx.fieldAccessGrant.deleteMany).toHaveBeenCalledWith({ where: { userId: identity.userId } });
    expect(tx.refreshSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: identity.userId, revokedAt: null },
    }));
  });

  it('leaves transient API failures queued for the worker retry policy', async () => {
    const event = { id: 'event-4', eventType: 'user_modify_org', subjectId: 'dt-user-4', status: 'QUEUED' };
    const rateLimit = new DingTalkApiError('90002', true);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      dingTalkSyncEvent: {
        findUnique: vi.fn().mockResolvedValue(event),
        update: vi.fn().mockResolvedValue({}),
        updateMany,
      },
    } as unknown as PrismaService;
    const api = { getUser: vi.fn().mockRejectedValue(rateLimit) } as unknown as DingTalkApiClient;
    const service = new DingTalkSyncService(
      prisma,
      api,
      {} as DingTalkSyncQueueService,
    );

    await expect(service.processEvent(event.id)).rejects.toBe(rateLimit);
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: 'QUEUED', lastError: '90002' },
    }));
  });

  it('marks unsupported event payloads as failed without burning retry attempts', async () => {
    const event = { id: 'event-5', eventType: 'unknown_event', subjectId: null, status: 'QUEUED' };
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      dingTalkSyncEvent: {
        findUnique: vi.fn().mockResolvedValue(event),
        update: vi.fn().mockResolvedValue({}),
        updateMany,
      },
    } as unknown as PrismaService;
    const service = new DingTalkSyncService(
      prisma,
      {} as DingTalkApiClient,
      {} as DingTalkSyncQueueService,
    );

    await expect(service.processEvent(event.id)).rejects.toBeInstanceOf(UnrecoverableError);
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: 'FAILED', lastError: 'invalid_event' },
    }));
  });
});

describe('DingTalkSyncService 审批回调入口（ATS-019）', () => {
  const INSTANCE = 'ad253df6-e175caf-xxxxxxxxxxxx';
  const callback = {
    EventType: 'bpms_instance_change',
    CorpId: 'corp-1',
    processInstanceId: INSTANCE,
    type: 'finish',
    processCode: 'PROC-REQ',
    finishTime: '1762058400000',
  };
  const inspected = { kind: 'finish', template: 'requisition', processInstanceId: INSTANCE };

  function configure() {
    vi.stubEnv('DINGTALK_CORP_ID', 'corp-1');
    vi.stubEnv('DINGTALK_OA_REQUISITION_PROCESS_CODE', 'PROC-REQ');
    vi.stubEnv('DINGTALK_OA_OFFER_PROCESS_CODE', 'PROC-OFFER');
  }

  function build(oaOverrides: Partial<Record<string, unknown>> = {}) {
    const create = vi.fn().mockResolvedValue({ id: 'evt-1', status: 'RECEIVED' });
    const findUnique = vi.fn();
    const update = vi.fn().mockResolvedValue({});
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const dispatch = vi.fn().mockResolvedValue(undefined);
    const prisma = {
      dingTalkSyncEvent: { create, findUnique, update, updateMany },
    } as unknown as PrismaService;
    const oa = {
      inspectApprovalCallback: vi.fn().mockReturnValue(inspected),
      processApprovalEvent: vi.fn().mockResolvedValue(undefined),
      ...oaOverrides,
    };
    const service = new DingTalkSyncService(
      prisma,
      {} as DingTalkApiClient,
      { dispatch } as unknown as DingTalkSyncQueueService,
      oa as unknown as DingTalkOaService,
    );
    return { service, oa, create, findUnique, update, updateMany, dispatch };
  }

  it('stores only the instance id of a verified approval callback and dispatches it without calling DingTalk', async () => {
    configure();
    const { service, create, dispatch } = build();

    await expect(service.acceptCallback(callback)).resolves.toEqual({ eventId: 'evt-1', accepted: true });

    expect(create).toHaveBeenCalledWith({
      data: {
        eventId: expect.stringMatching(/^callback:[0-9a-f]{64}$/),
        eventType: 'bpms_instance_change:finish:requisition',
        subjectId: INSTANCE,
        corpId: 'corp-1',
        status: 'RECEIVED',
      },
      select: { id: true, status: true },
    });
    expect(dispatch).toHaveBeenCalledWith('evt-1');
  });

  it('deduplicates DingTalk retries of the same approval event', async () => {
    configure();
    const { service, create, findUnique, dispatch } = build();
    create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: 'test' }));
    findUnique.mockResolvedValue({ id: 'evt-1', status: 'PROCESSED' });

    await expect(service.acceptCallback({ ...callback, finishTime: '1762058400000' })).resolves.toEqual({ eventId: 'evt-1', accepted: true });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('ignores callbacks for templates the system did not configure and never stores them', async () => {
    configure();
    const { service, create } = build({ inspectApprovalCallback: vi.fn().mockReturnValue(null) });

    await expect(service.acceptCallback({ ...callback, processCode: 'PROC-EXPENSE' })).resolves.toEqual({ accepted: false });
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects approval callbacks that belong to another organization', async () => {
    configure();
    const { service, create } = build();

    await expect(service.acceptCallback({ ...callback, CorpId: 'corp-other' })).rejects.toMatchObject({ status: 400 });
    expect(create).not.toHaveBeenCalled();
  });

  it('does not persist approval callbacks while the OA integration is disabled', async () => {
    configure();
    const prisma = { dingTalkSyncEvent: { create: vi.fn() } } as unknown as PrismaService;
    const service = new DingTalkSyncService(prisma, {} as DingTalkApiClient, {} as DingTalkSyncQueueService);

    await expect(service.acceptCallback(callback)).resolves.toEqual({ accepted: false });
    expect((prisma as unknown as { dingTalkSyncEvent: { create: unknown } }).dingTalkSyncEvent.create).not.toHaveBeenCalled();
  });

  it('routes approval events to the OA handler inside the worker pipeline', async () => {
    configure();
    const event = { id: 'evt-1', eventType: 'bpms_instance_change:finish:requisition', subjectId: INSTANCE, status: 'QUEUED' };
    const { service, oa, findUnique, update } = build();
    findUnique.mockResolvedValue(event);

    await service.processEvent(event.id);

    expect(oa.processApprovalEvent).toHaveBeenCalledWith(event);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'PROCESSED' }) }));
  });

  it('marks OA business failures as permanently failed with their code and keeps transient ones queued', async () => {
    configure();
    const event = { id: 'evt-1', eventType: 'bpms_instance_change:finish:requisition', subjectId: INSTANCE, status: 'QUEUED' };

    const permanent = build({ processApprovalEvent: vi.fn().mockRejectedValue(new OaSyncError('OA_FIELD_MISSING_TITLE', '缺少字段', 400)) });
    permanent.findUnique.mockResolvedValue(event);
    await expect(permanent.service.processEvent(event.id)).rejects.toBeInstanceOf(UnrecoverableError);
    expect(permanent.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: 'FAILED', lastError: 'OA_FIELD_MISSING_TITLE' },
    }));

    const transient = build({ processApprovalEvent: vi.fn().mockRejectedValue(new DingTalkOaError('UNAVAILABLE', 'Throttling')) });
    transient.findUnique.mockResolvedValue(event);
    await expect(transient.service.processEvent(event.id)).rejects.toBeInstanceOf(DingTalkOaError);
    expect(transient.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: 'QUEUED', lastError: 'Throttling' },
    }));
  });
});

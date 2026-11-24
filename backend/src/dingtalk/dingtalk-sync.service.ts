import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { IdentityProvider, Prisma, UserStatus } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { UnrecoverableError } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  DingTalkApiClient,
  DingTalkApiError,
  type DingTalkDepartmentRecord,
  type DingTalkUserRecord,
} from './dingtalk-api.client.js';
import { DingTalkSyncQueueService } from './dingtalk-sync.queue.js';
import { dingtalkDepartmentCode } from './dingtalk-department-code.js';
import { DingTalkOaService } from './dingtalk-oa.service.js';
import { OaSyncError, oaErrorCode } from './dingtalk-oa.errors.js';
import { APPROVAL_EVENT_TYPE } from './dingtalk-oa.client.js';

const ROOT_DEPARTMENT_ID = 1;
const ACCESS_LIMIT_DEPARTMENT_ID = -7;
const SUPPORTED_EVENTS = new Set([
  'user_add_org',
  'user_modify_org',
  'user_leave_org',
  'org_dept_create',
  'org_dept_modify',
  'org_dept_remove',
]);

type OrganizationSnapshot = {
  departments: DingTalkDepartmentRecord[];
  users: DingTalkUserRecord[];
};

@Injectable()
export class DingTalkSyncService {
  private readonly logger = new Logger(DingTalkSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly api: DingTalkApiClient,
    private readonly queue: DingTalkSyncQueueService,
    @Optional() private readonly oa?: DingTalkOaService,
  ) {}

  async acceptCallback(value: unknown): Promise<{ eventId?: string; accepted: boolean }> {
    const payload = this.record(value);
    const eventType = this.text(payload.EventType ?? payload.eventType)?.toLowerCase();
    if (!eventType) return { accepted: false };
    if (eventType === APPROVAL_EVENT_TYPE) return this.acceptApprovalCallback(payload);
    if (!SUPPORTED_EVENTS.has(eventType)) return { accepted: false };

    const subjectIds = this.subjectIds(eventType, payload);
    if (!subjectIds.length) throw new BadRequestException('钉钉事件缺少用户或部门标识');
    const corpId = this.assertCallbackCorp(payload);
    const nativeId = this.text(payload.EventId ?? payload.eventId ?? payload.BizId ?? payload.biz_id);
    const eventTime = this.text(payload.EventTime ?? payload.eventTime ?? payload.timeStamp);
    let firstEventId: string | undefined;
    for (const subjectId of subjectIds) {
      const eventBasis = nativeId
        ? `${corpId}:${nativeId}:${subjectId}`
        : `${corpId}:${eventType}:${subjectId}:${JSON.stringify(payload)}:${eventTime ?? ''}`;
      const eventId = `callback:${createHash('sha256').update(eventBasis).digest('hex')}`;

      let event;
      try {
        event = await this.prisma.dingTalkSyncEvent.create({
          data: { eventId, eventType, subjectId, corpId, status: 'RECEIVED' },
          select: { id: true, status: true },
        });
      } catch (error) {
        if (!this.isUniqueViolation(error)) throw error;
        event = await this.prisma.dingTalkSyncEvent.findUnique({
          where: { eventId },
          select: { id: true, status: true },
        });
        if (!event) throw error;
      }

      firstEventId ??= event.id;
      if (event.status === 'RECEIVED' || event.status === 'QUEUED') {
        void this.queue.dispatch(event.id).catch((error: unknown) => {
          this.logger.warn(`DingTalk callback event ${event.id} awaits outbox retry: ${this.safeError(error)}`);
        });
      }
    }
    return { eventId: firstEventId, accepted: true };
  }

  /**
   * OA 审批实例变更回调：签名与 AES 已在控制器校验，这里再核对企业与审批模板来源。
   * 只保存最小元数据并异步入队，不在 HTTP 回调内调用钉钉 OA 接口。
   */
  private async acceptApprovalCallback(
    payload: Record<string, unknown>,
  ): Promise<{ eventId?: string; accepted: boolean }> {
    if (!this.oa) return { accepted: false };
    const inspected = this.oa.inspectApprovalCallback(payload);
    // 非本系统配置的审批模板、缺 processCode 或实例 ID 非法：不落库、不处理。
    if (!inspected) return { accepted: false };
    const corpId = this.assertCallbackCorp(payload);

    // 钉钉重推同一事件时 processInstanceId + 变更类型 + 结束时间不变，据此生成稳定的事件 ID 去重。
    const eventBasis = `${corpId}:${APPROVAL_EVENT_TYPE}:${inspected.processInstanceId}:${inspected.kind}:${this.text(payload.finishTime) ?? ''}`;
    const eventId = `callback:${createHash('sha256').update(eventBasis).digest('hex')}`;
    const eventType = `${APPROVAL_EVENT_TYPE}:${inspected.kind}:${inspected.template}`;

    let event;
    try {
      event = await this.prisma.dingTalkSyncEvent.create({
        data: { eventId, eventType, subjectId: inspected.processInstanceId, corpId, status: 'RECEIVED' },
        select: { id: true, status: true },
      });
    } catch (error) {
      if (!this.isUniqueViolation(error)) throw error;
      event = await this.prisma.dingTalkSyncEvent.findUnique({
        where: { eventId },
        select: { id: true, status: true },
      });
      if (!event) throw error;
    }

    if (event.status === 'RECEIVED' || event.status === 'QUEUED') {
      void this.queue.dispatch(event.id).catch((error: unknown) => {
        this.logger.warn(`DingTalk approval event ${event.id} awaits outbox retry: ${this.safeError(error)}`);
      });
    }
    return { eventId: event.id, accepted: true };
  }

  private assertCallbackCorp(payload: Record<string, unknown>): string {
    const corpId = this.corpId();
    const callbackCorpId = this.text(payload.CorpId ?? payload.corpId);
    if (callbackCorpId && callbackCorpId !== corpId) {
      throw new BadRequestException('钉钉回调组织不匹配');
    }
    return corpId;
  }

  async enqueueManualSync(departmentId?: number) {
    const rootDepartmentId = this.syncRootDepartmentId(departmentId);
    const event = await this.prisma.dingTalkSyncEvent.create({
      data: {
        eventId: `manual:${randomUUID()}`,
        eventType: 'MANUAL_FULL_SYNC',
        subjectId: String(rootDepartmentId),
        corpId: this.corpId(),
      },
      select: { id: true, subjectId: true, status: true, receivedAt: true },
    });
    void this.queue.dispatch(event.id).catch((error: unknown) => {
      this.logger.warn(`Manual DingTalk sync ${event.id} awaits outbox retry: ${this.safeError(error)}`);
    });
    return event;
  }

  async listEvents(limit = 50) {
    return this.prisma.dingTalkSyncEvent.findMany({
      orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
      take: Math.min(Math.max(limit, 1), 100),
      select: {
        id: true,
        eventType: true,
        subjectId: true,
        status: true,
        attempts: true,
        receivedAt: true,
        processedAt: true,
        lastError: true,
      },
    });
  }

  async processEvent(eventId: string): Promise<void> {
    const event = await this.prisma.dingTalkSyncEvent.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException('钉钉同步事件不存在');
    if (event.status === 'PROCESSED') return;
    await this.prisma.dingTalkSyncEvent.update({
      where: { id: eventId },
      data: { status: 'PROCESSING', attempts: { increment: 1 }, lastError: null },
    });

    try {
      if (event.eventType.startsWith(`${APPROVAL_EVENT_TYPE}:`)) {
        if (!this.oa) throw new ServiceUnavailableException('钉钉 OA 对接未启用');
        await this.oa.processApprovalEvent(event);
      } else switch (event.eventType) {
        case 'MANUAL_FULL_SYNC':
          await this.fullSync(
            event.id,
            this.syncRootDepartmentId(this.parseDepartmentId(event.subjectId)),
          );
          break;
        case 'org_dept_create':
        case 'org_dept_modify':
          await this.fullSync(event.id, this.syncRootDepartmentId());
          break;
        case 'org_dept_remove':
          await this.removeDepartment(event.subjectId!, event.id);
          break;
        case 'user_leave_org':
          await this.deactivateUser(event.subjectId!, event.id);
          break;
        case 'user_add_org':
        case 'user_modify_org': {
          const record = await this.api.getUser(event.subjectId!);
          const departmentIds = new Set(record.dept_id_list);
          const known = await this.prisma.department.count({
            where: { code: { in: [...departmentIds].map((id) => this.departmentCode(id)) } },
          });
          const rootDepartmentId = this.syncRootDepartmentId();
          if (known < departmentIds.size) {
            await this.syncDepartmentsOnly(event.id, rootDepartmentId);
          }
          const scopedSync = rootDepartmentId !== ROOT_DEPARTMENT_ID;
          const departments = await this.departmentMap(record.dept_id_list, scopedSync);
          await this.syncUser(record, departments, event.id, scopedSync);
          break;
        }
        default:
          throw new BadRequestException('不支持的钉钉同步事件类型');
      }
      await this.prisma.dingTalkSyncEvent.update({
        where: { id: eventId },
        data: { status: 'PROCESSED', processedAt: new Date(), lastError: null },
      });
    } catch (error) {
      const permanent = this.isPermanentError(error);
      await this.prisma.dingTalkSyncEvent.updateMany({
        where: { id: eventId, status: 'PROCESSING' },
        data: { status: permanent ? 'FAILED' : 'QUEUED', lastError: this.safeError(error) },
      });
      if (permanent) throw new UnrecoverableError('钉钉同步需要管理员处理');
      throw error;
    }
  }

  async markFailed(eventId: string, error: unknown): Promise<void> {
    await this.prisma.dingTalkSyncEvent.updateMany({
      where: { id: eventId, status: { in: ['PROCESSING', 'QUEUED'] } },
      data: { status: 'FAILED', lastError: this.safeError(error) },
    });
  }

  private async fullSync(eventId: string, rootDepartmentId: number) {
    const scopedSync = rootDepartmentId !== ROOT_DEPARTMENT_ID;
    const snapshot = await this.loadSnapshot(rootDepartmentId);
    const departments = await this.syncDepartments(
      snapshot.departments,
      eventId,
      rootDepartmentId,
    );
    let usersSynced = 0;
    for (const user of snapshot.users) {
      await this.syncUser(user, departments, eventId, scopedSync);
      usersSynced += 1;
    }

    if (!scopedSync && process.env.DINGTALK_SYNC_DEACTIVATE_MISSING === 'true') {
      const seenUserIds = snapshot.users.map(({ userid }) => userid);
      if (seenUserIds.length) {
        const missingLinks = await this.prisma.identityLink.findMany({
          where: {
            provider: IdentityProvider.DINGTALK,
            subject: { notIn: seenUserIds },
          },
          select: { subject: true },
        });
        for (const { subject } of missingLinks) await this.deactivateUser(subject, eventId);
      }
    }
    return { departmentCount: snapshot.departments.length, usersSynced };
  }

  private async syncDepartmentsOnly(
    eventId: string,
    rootDepartmentId = this.syncRootDepartmentId(),
  ) {
    const departments = await this.loadDepartments(rootDepartmentId);
    return this.syncDepartments(departments, eventId, rootDepartmentId);
  }

  private async loadSnapshot(rootDepartmentId: number): Promise<OrganizationSnapshot> {
    const departments = await this.loadDepartments(rootDepartmentId);
    const usersById = new Map<string, DingTalkUserRecord>();
    for (const department of departments) {
      for (const user of await this.api.listDepartmentUsers(department.dept_id)) {
        const previous = usersById.get(user.userid);
        const deptIds = new Set([
          ...(previous?.dept_id_list ?? []),
          ...(user.dept_id_list ?? []),
          department.dept_id,
        ]);
        usersById.set(user.userid, {
          ...previous,
          ...user,
          dept_id_list: [...deptIds],
        });
      }
    }
    const scopedDepartmentIds = new Set(departments.map(({ dept_id }) => dept_id));
    const users = [...usersById.values()].map((user) => ({
      ...user,
      dept_id_list: user.dept_id_list.filter((id) => scopedDepartmentIds.has(id)),
    }));
    return { departments, users };
  }

  private async loadDepartments(rootDepartmentId: number): Promise<DingTalkDepartmentRecord[]> {
    const root: DingTalkDepartmentRecord = rootDepartmentId === ROOT_DEPARTMENT_ID
      ? {
          dept_id: ROOT_DEPARTMENT_ID,
          name: process.env.DINGTALK_ROOT_DEPARTMENT_NAME?.trim() || '企业根部门',
          parent_id: 0,
        }
      : await this.api.getDepartment(rootDepartmentId);
    const departments = [root];
    const seen = new Set<number>([rootDepartmentId]);
    const pending = [rootDepartmentId];
    while (pending.length) {
      const parentId = pending.shift()!;
      const children = await this.api.listChildDepartments(parentId);
      for (const child of children) {
        if (
          child.dept_id === ACCESS_LIMIT_DEPARTMENT_ID ||
          child.dept_id === rootDepartmentId ||
          seen.has(child.dept_id)
        ) {
          continue;
        }
        if (child.parent_id !== parentId) {
          throw new ConflictException('钉钉部门树返回了不一致的上级关系');
        }
        seen.add(child.dept_id);
        departments.push(child);
        pending.push(child.dept_id);
      }
    }
    return departments;
  }

  private async syncDepartments(
    departments: DingTalkDepartmentRecord[],
    eventId: string,
    rootDepartmentId: number,
  ): Promise<Map<number, string>> {
    const prefix = this.departmentPrefix();
    const idMap = new Map<number, string>();
    for (const department of departments) {
      const code = this.departmentCode(department.dept_id);
      let parentId = department.dept_id === rootDepartmentId
        ? null
        : idMap.get(department.parent_id) ?? null;
      if (department.dept_id === rootDepartmentId && department.parent_id > 0) {
        const existingParent = await this.prisma.department.findFirst({
          where: {
            code: this.departmentCode(department.parent_id),
            isActive: true,
          },
          select: { id: true },
        });
        parentId = existingParent?.id ?? null;
      }
      if (department.dept_id !== rootDepartmentId && !parentId) {
        throw new ConflictException('钉钉部门上级未同步');
      }
      const saved = await this.prisma.department.upsert({
        where: { code },
        create: { code, name: department.name, parentId, isActive: true },
        update: { name: department.name, parentId, isActive: true },
        select: { id: true },
      });
      idMap.set(department.dept_id, saved.id);
    }

    if (
      rootDepartmentId === ROOT_DEPARTMENT_ID &&
      process.env.DINGTALK_SYNC_DEACTIVATE_MISSING === 'true'
    ) {
      const codes = departments.map(({ dept_id }) => this.departmentCode(dept_id));
      const stale = await this.prisma.department.findMany({
        where: { code: { startsWith: prefix, notIn: codes } },
        select: { id: true },
      });
      if (stale.length && departments.length === 1) {
        throw new ConflictException('仅同步到钉钉根部门，拒绝停用其余本地部门');
      }
      if (stale.length) {
        await this.deactivateDepartments(stale.map(({ id }) => id), eventId);
      }
    }
    return idMap;
  }

  private async departmentMap(
    externalIds: number[],
    allowMissing = false,
  ): Promise<Map<number, string>> {
    const ids = [...new Set(externalIds)].filter((id) => id !== ACCESS_LIMIT_DEPARTMENT_ID);
    const rows = await this.prisma.department.findMany({
      where: { code: { in: ids.map((id) => this.departmentCode(id)) }, isActive: true },
      select: { id: true, code: true },
    });
    const reverse = new Map(rows.map(({ id, code }) => [Number(code.slice(code.lastIndexOf('_') + 1)), id]));
    for (const id of ids) {
      if (!allowMissing && !reverse.has(id)) {
        throw new ConflictException('钉钉用户引用了尚未同步的部门');
      }
    }
    return reverse;
  }

  private async syncUser(
    record: DingTalkUserRecord,
    departmentMap: Map<number, string>,
    eventId: string,
    preserveOutOfScopeDepartments = false,
  ): Promise<void> {
    const name = record.name.trim();
    const userId = record.userid.trim();
    if (!name || !userId) throw new ConflictException('钉钉用户缺少必填字段');

    const externalDepartments = [...new Set(record.dept_id_list ?? [])]
      .filter((id) => id !== ACCESS_LIMIT_DEPARTMENT_ID);
    const scopedLocalDepartmentIds = new Set(departmentMap.values());
    const employeeNo = this.optionalText(record.job_number);
    const email = this.optionalText(record.email)?.toLowerCase() ?? null;

    await this.prisma.$transaction(async (tx) => {
      const identity = await tx.identityLink.findUnique({
        where: {
          provider_subject: { provider: IdentityProvider.DINGTALK, subject: userId },
        },
        include: { user: { include: { departmentMemberships: true } } },
      });
      let user = identity?.user ?? null;
      if (!user && employeeNo) {
        user = await tx.user.findUnique({
          where: { employeeNo },
          include: { departmentMemberships: true },
        });
      }

      const missing = externalDepartments.filter((id) => !departmentMap.has(id));
      if (missing.length && !preserveOutOfScopeDepartments) {
        throw new ConflictException('钉钉用户引用了尚未同步的部门');
      }
      const syncedLocalDepartments = externalDepartments
        .flatMap((id) => {
          const localId = departmentMap.get(id);
          return localId ? [localId] : [];
        })
        .filter((id, index, all) => all.indexOf(id) === index);
      const retainedLocalDepartments = preserveOutOfScopeDepartments
        ? [...new Set([
            ...(user?.departmentMemberships
              .map(({ departmentId }) => departmentId)
              .filter((departmentId) => !scopedLocalDepartmentIds.has(departmentId)) ?? []),
            ...(user?.departmentId && !scopedLocalDepartmentIds.has(user.departmentId)
              ? [user.departmentId]
              : []),
          ])]
        : [];
      const preservedPrimaryDepartmentId = preserveOutOfScopeDepartments &&
        user?.departmentId &&
        !scopedLocalDepartmentIds.has(user.departmentId)
        ? user.departmentId
        : null;
      const primaryDepartmentId = preservedPrimaryDepartmentId ??
        syncedLocalDepartments[0] ?? retainedLocalDepartments[0] ?? null;
      const localDepartments = [...new Set([
        ...(primaryDepartmentId ? [primaryDepartmentId] : []),
        ...syncedLocalDepartments,
        ...retainedLocalDepartments,
      ])];

      const beforeDepartmentIds = user?.departmentMemberships
        .map(({ departmentId }) => departmentId)
        .sort() ?? [];
      const beforeStatus = user?.status;
      const beforeDisplayName = user?.displayName;
      const beforePrimaryDepartmentId = user?.departmentId;
      let currentUserId: string;
      if (user) {
        const employeeNoOwner = employeeNo
          ? await tx.user.findUnique({ where: { employeeNo }, select: { id: true } })
          : null;
        if (employeeNoOwner && employeeNoOwner.id !== user.id) {
          throw new ConflictException('钉钉工号与另一位 ATS 用户冲突，需管理员处理');
        }
        const updated = await tx.user.update({
          where: { id: user.id },
          data: {
            displayName: name,
            employeeNo: employeeNo ?? user.employeeNo,
            email: email ?? user.email,
            status: UserStatus.ACTIVE,
            departmentId: primaryDepartmentId,
          },
          select: { id: true, status: true, departmentId: true },
        });
        currentUserId = updated.id;
        if (!identity) {
          await tx.identityLink.create({
            data: { provider: IdentityProvider.DINGTALK, subject: userId, userId: updated.id },
          });
        }
      } else {
        const created = await tx.user.create({
          data: {
            employeeNo: employeeNo ?? undefined,
            displayName: name,
            email: email ?? undefined,
            status: UserStatus.ACTIVE,
            departmentId: primaryDepartmentId,
          },
          select: { id: true, status: true, departmentId: true },
        });
        currentUserId = created.id;
        await tx.identityLink.create({
          data: { provider: IdentityProvider.DINGTALK, subject: userId, userId: created.id },
        });
      }

      await tx.userDepartment.deleteMany({ where: { userId: currentUserId } });
      if (localDepartments.length) {
        await tx.userDepartment.createMany({
          data: localDepartments.map((departmentId) => ({
            userId: currentUserId,
            departmentId,
            isPrimary: departmentId === primaryDepartmentId,
          })),
        });
      }

      const departmentsChanged =
        beforeDepartmentIds.length !== localDepartments.length ||
        beforeDepartmentIds.some((id, index) => id !== [...localDepartments].sort()[index]);
      if (
        !identity ||
        beforeStatus !== UserStatus.ACTIVE ||
        beforeDisplayName !== name ||
        beforePrimaryDepartmentId !== primaryDepartmentId ||
        departmentsChanged
      ) {
        await tx.auditLog.create({
          data: {
            action: 'dingtalk.user.synced',
            resourceType: 'User',
            resourceId: currentUserId,
            requestId: this.requestId(eventId),
            beforeSummary: user
              ? {
                  status: user.status,
                  departmentId: user.departmentId,
                  departmentIds: beforeDepartmentIds,
                }
              : undefined,
            afterSummary: {
              status: UserStatus.ACTIVE,
              departmentId: primaryDepartmentId,
              departmentIds: [...localDepartments].sort(),
            },
          },
        });
      }
    }, { timeout: 15_000 });
  }

  private async deactivateUser(userId: string, eventId: string): Promise<void> {
    const identity = await this.prisma.identityLink.findUnique({
      where: {
        provider_subject: { provider: IdentityProvider.DINGTALK, subject: userId },
      },
      include: { user: true },
    });
    if (!identity || identity.user.status === UserStatus.INACTIVE) return;

    await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      await tx.user.update({
        where: { id: identity.userId },
        data: { status: UserStatus.INACTIVE, departmentId: null },
      });
      await Promise.all([
        tx.userDepartment.deleteMany({ where: { userId: identity.userId } }),
        tx.userRole.deleteMany({ where: { userId: identity.userId } }),
        tx.userGroupMember.deleteMany({ where: { userId: identity.userId } }),
        tx.fieldAccessGrant.deleteMany({ where: { userId: identity.userId } }),
        tx.refreshSession.updateMany({
          where: { userId: identity.userId, revokedAt: null },
          data: { revokedAt: now },
        }),
      ]);
      await tx.auditLog.create({
        data: {
          action: 'dingtalk.user.deactivated',
          resourceType: 'User',
          resourceId: identity.userId,
          requestId: this.requestId(eventId),
          beforeSummary: { status: identity.user.status, departmentId: identity.user.departmentId },
          afterSummary: { status: UserStatus.INACTIVE, accessRevoked: true },
        },
      });
    });
  }

  private async removeDepartment(externalId: string, eventId: string): Promise<void> {
    const numericId = Number(externalId);
    if (!Number.isInteger(numericId) || numericId === ROOT_DEPARTMENT_ID) {
      throw new BadRequestException('钉钉部门标识无效');
    }
    const department = await this.prisma.department.findUnique({
      where: { code: this.departmentCode(numericId) },
      select: { id: true, isActive: true },
    });
    if (!department || !department.isActive) return;

    const memberships = await this.prisma.userDepartment.findMany({
      where: { departmentId: department.id },
      select: { userId: true },
    });
    await this.prisma.$transaction(async (tx) => {
      await tx.department.update({ where: { id: department.id }, data: { isActive: false } });
      await tx.userDepartment.deleteMany({ where: { departmentId: department.id } });
      const affectedUserIds = [...new Set(memberships.map(({ userId }) => userId))];
      for (const userId of affectedUserIds) {
        const next = await tx.userDepartment.findFirst({
          where: { userId, department: { isActive: true } },
          orderBy: [{ isPrimary: 'desc' }, { departmentId: 'asc' }],
          select: { departmentId: true },
        });
        await tx.user.updateMany({
          where: { id: userId, departmentId: department.id },
          data: { departmentId: next?.departmentId ?? null },
        });
        await tx.userDepartment.updateMany({ where: { userId }, data: { isPrimary: false } });
        if (next) {
          await tx.userDepartment.update({
            where: { userId_departmentId: { userId, departmentId: next.departmentId } },
            data: { isPrimary: true },
          });
        }
      }
      await tx.auditLog.create({
        data: {
          action: 'dingtalk.department.deactivated',
          resourceType: 'Department',
          resourceId: department.id,
          requestId: this.requestId(eventId),
          afterSummary: { isActive: false },
        },
      });
    });
  }

  private async deactivateDepartments(ids: string[], eventId: string): Promise<void> {
    const affected = await this.prisma.userDepartment.findMany({
      where: { departmentId: { in: ids } },
      select: { userId: true },
    });
    await this.prisma.$transaction(async (tx) => {
      await tx.department.updateMany({ where: { id: { in: ids } }, data: { isActive: false } });
      await tx.userDepartment.deleteMany({ where: { departmentId: { in: ids } } });
      const users = [...new Set(affected.map(({ userId }) => userId))];
      for (const userId of users) {
        const next = await tx.userDepartment.findFirst({
          where: { userId, department: { isActive: true } },
          orderBy: [{ isPrimary: 'desc' }, { departmentId: 'asc' }],
          select: { departmentId: true },
        });
        await tx.user.updateMany({
          where: { id: userId, departmentId: { in: ids } },
          data: { departmentId: next?.departmentId ?? null },
        });
        await tx.userDepartment.updateMany({ where: { userId }, data: { isPrimary: false } });
        if (next) {
          await tx.userDepartment.update({
            where: { userId_departmentId: { userId, departmentId: next.departmentId } },
            data: { isPrimary: true },
          });
        }
      }
      await tx.auditLog.createMany({
        data: ids.map((id) => ({
          action: 'dingtalk.department.deactivated',
          resourceType: 'Department',
          resourceId: id,
          requestId: this.requestId(eventId),
          afterSummary: { isActive: false },
        })),
      });
    });
  }

  private subjectIds(eventType: string, payload: Record<string, unknown>): string[] {
    const value = eventType.startsWith('user_')
      ? payload.UserId ?? payload.userId ?? payload.userid
      : payload.DeptId ?? payload.deptId ?? payload.dept_id ?? payload.Id ?? payload.id;
    const values = Array.isArray(value) ? value : [value];
    return [...new Set(values.flatMap((item) => {
      const text = this.text(item);
      return text ? [text] : [];
    }))];
  }

  private departmentCode(departmentId: number): string {
    return dingtalkDepartmentCode(this.corpId(), departmentId);
  }

  private departmentPrefix(): string {
    const digest = createHash('sha256').update(this.corpId()).digest('hex').slice(0, 12);
    return `DINGTALK_${digest}_`;
  }

  private syncRootDepartmentId(departmentId?: number): number {
    if (departmentId !== undefined) {
      if (!Number.isSafeInteger(departmentId) || departmentId < 1) {
        throw new BadRequestException('departmentId 必须为正整数');
      }
      return departmentId;
    }

    const configured = process.env.DINGTALK_SYNC_ROOT_DEPARTMENT_ID?.trim();
    if (!configured) return ROOT_DEPARTMENT_ID;
    if (!/^[1-9]\d*$/.test(configured)) {
      throw new ServiceUnavailableException(
        'DINGTALK_SYNC_ROOT_DEPARTMENT_ID 必须为正整数',
      );
    }
    const parsed = Number(configured);
    if (!Number.isSafeInteger(parsed)) {
      throw new ServiceUnavailableException(
        'DINGTALK_SYNC_ROOT_DEPARTMENT_ID 必须为正整数',
      );
    }
    return parsed;
  }

  private parseDepartmentId(value: string | null): number | undefined {
    if (value === null) return undefined;
    if (!/^[1-9]\d*$/.test(value)) {
      throw new BadRequestException('同步事件中的部门标识无效');
    }
    const departmentId = Number(value);
    if (!Number.isSafeInteger(departmentId)) {
      throw new BadRequestException('同步事件中的部门标识无效');
    }
    return departmentId;
  }

  private corpId(): string {
    const corpId = process.env.DINGTALK_CORP_ID?.trim();
    if (!corpId) throw new ServiceUnavailableException('钉钉正式接入尚未配置');
    return corpId;
  }

  private record(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new BadRequestException('钉钉事件格式无效');
    }
    return value as Record<string, unknown>;
  }

  private text(value: unknown): string | undefined {
    return typeof value === 'string' || typeof value === 'number'
      ? String(value).trim() || undefined
      : undefined;
  }

  private optionalText(value: unknown): string | undefined {
    const text = this.text(value);
    return text?.trim() || undefined;
  }

  private requestId(eventId: string): string {
    return `dingtalk:${eventId}`.slice(0, 128);
  }

  private isUniqueViolation(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }

  private isPermanentError(error: unknown): boolean {
    return (
      error instanceof BadRequestException ||
      error instanceof ConflictException ||
      error instanceof ServiceUnavailableException ||
      (error instanceof DingTalkApiError && !error.retryable) ||
      (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') ||
      // OA 业务失败（字段缺失、审批未通过等）重试也不会成功，直接置 FAILED 等人工处理。
      error instanceof OaSyncError
    );
  }

  private safeError(error: unknown): string {
    if (error instanceof OaSyncError) return oaErrorCode(error);
    if (error instanceof ConflictException) return 'data_conflict';
    if (error instanceof BadRequestException) return 'invalid_event';
    if (error instanceof ServiceUnavailableException) return 'configuration_missing';
    if (error && typeof error === 'object' && 'code' in error) {
      return String((error as { code: unknown }).code).slice(0, 80);
    }
    return 'sync_failed';
  }
}

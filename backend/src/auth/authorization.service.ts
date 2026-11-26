import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { DataScope, IdentityProvider, Prisma, SensitiveField, UserStatus } from '@prisma/client';
import type { AuthenticatedUser, SensitiveAction } from './auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';

export type UserQueryFilter = {
  q?: string;
  departmentId?: string;
  includeChildren?: boolean;
  roleCode?: string;
};

const USER_LIST_SELECT = {
  id: true,
  employeeNo: true,
  displayName: true,
  email: true,
  status: true,
  departmentId: true,
  roleAssignments: { select: { role: { select: { code: true, name: true } } } },
} satisfies Prisma.UserSelect;

@Injectable()
export class AuthorizationService {
  constructor(private readonly prisma: PrismaService) {}

  async loadUserContext(userId: string): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        roleAssignments: {
          include: {
            role: {
              include: {
                permissions: { include: { permission: true } },
              },
            },
          },
        },
        groupMemberships: { select: { groupId: true } },
        departmentMemberships: {
          where: { department: { isActive: true } },
          select: { departmentId: true },
        },
      },
    });
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('用户不存在或已停用');
    }

    const rootDepartmentIds = user.departmentMemberships.map(
      ({ departmentId }) => departmentId,
    );
    if (!rootDepartmentIds.length && user.departmentId) {
      rootDepartmentIds.push(user.departmentId);
    }
    const departmentIds = await this.departmentTree(rootDepartmentIds);
    return {
      id: user.id,
      displayName: user.displayName,
      departmentId: user.departmentId,
      departmentIds,
      groupIds: user.groupMemberships.map((membership) => membership.groupId),
      roles: user.roleAssignments.map(({ role, scopeOverride }) => ({
        code: role.code,
        name: role.name,
        dataScope: scopeOverride ?? role.dataScope,
        permissions: role.permissions.map(({ permission }) => permission.code),
      })),
    };
  }

  scopesFor(actor: AuthenticatedUser, permission: string): DataScope[] {
    const scopes = actor.roles
      .filter((role) => role.permissions.includes(permission))
      .map((role) => role.dataScope);
    if (scopes.length === 0) throw new ForbiddenException('当前角色没有此操作权限');
    return [...new Set(scopes)];
  }

  candidateWhere(actor: AuthenticatedUser, permission: string): Prisma.CandidateWhereInput {
    const scopes = this.scopesFor(actor, permission);
    if (scopes.includes(DataScope.ALL)) return {};

    const clauses: Prisma.CandidateWhereInput[] = [];
    for (const scope of scopes) {
      switch (scope) {
        case DataScope.SELF:
          clauses.push({ createdById: actor.id });
          break;
        case DataScope.DEPARTMENT:
          if (actor.departmentIds.length) {
            clauses.push({ job: { is: { departmentId: { in: actor.departmentIds } } } });
          }
          break;
        case DataScope.OWN_JOBS:
          clauses.push({
            OR: [
              { createdById: actor.id },
              { job: { is: { recruiterId: actor.id } } },
            ],
          });
          break;
        case DataScope.PARTICIPATING:
          clauses.push({
            interviews: { some: { interviewerIds: { contains: `|${actor.id}|` } } },
          });
          break;
        case DataScope.DEPARTMENT_AND_PARTICIPATING:
          if (actor.departmentIds.length) {
            clauses.push({ job: { is: { departmentId: { in: actor.departmentIds } } } });
          }
          clauses.push({
            interviews: { some: { interviewerIds: { contains: `|${actor.id}|` } } },
          });
          break;
        case DataScope.ALL:
          return {};
      }
    }
    return clauses.length ? { OR: clauses } : { id: '__no_access__' };
  }

  jobWhere(actor: AuthenticatedUser, permission: string): Prisma.JobWhereInput {
    const scopes = this.scopesFor(actor, permission);
    if (scopes.includes(DataScope.ALL)) return {};

    const clauses: Prisma.JobWhereInput[] = [];
    for (const scope of scopes) {
      switch (scope) {
        case DataScope.SELF:
        case DataScope.OWN_JOBS:
          clauses.push({ recruiterId: actor.id });
          break;
        case DataScope.PARTICIPATING:
          clauses.push({
            candidates: {
              some: {
                interviews: {
                  some: { interviewerIds: { contains: `|${actor.id}|` } },
                },
              },
            },
          });
          break;
        case DataScope.DEPARTMENT:
          if (actor.departmentIds.length) {
            clauses.push({ departmentId: { in: actor.departmentIds } });
          }
          break;
        case DataScope.DEPARTMENT_AND_PARTICIPATING:
          if (actor.departmentIds.length) {
            clauses.push({ departmentId: { in: actor.departmentIds } });
          }
          clauses.push({ recruiterId: actor.id });
          clauses.push({
            candidates: {
              some: {
                interviews: {
                  some: { interviewerIds: { contains: `|${actor.id}|` } },
                },
              },
            },
          });
          break;
        case DataScope.ALL:
          return {};
      }
    }
    return clauses.length ? { OR: clauses } : { id: '__no_access__' };
  }

  requisitionWhere(
    actor: AuthenticatedUser,
    permission: string,
  ): Prisma.JobRequisitionWhereInput {
    const scopes = this.scopesFor(actor, permission);
    if (scopes.includes(DataScope.ALL)) return {};

    const clauses: Prisma.JobRequisitionWhereInput[] = [];
    for (const scope of scopes) {
      switch (scope) {
        case DataScope.SELF:
        case DataScope.OWN_JOBS:
        case DataScope.PARTICIPATING:
          clauses.push({ recruiterId: actor.id });
          break;
        case DataScope.DEPARTMENT:
          if (actor.departmentIds.length) {
            clauses.push({ departmentId: { in: actor.departmentIds } });
          }
          break;
        case DataScope.DEPARTMENT_AND_PARTICIPATING:
          if (actor.departmentIds.length) {
            clauses.push({ departmentId: { in: actor.departmentIds } });
          }
          clauses.push({ recruiterId: actor.id });
          break;
        case DataScope.ALL:
          return {};
      }
    }
    return clauses.length ? { OR: clauses } : { id: '__no_access__' };
  }

  async canAccessCandidate(
    actor: AuthenticatedUser,
    permission: string,
    candidateId: string,
  ): Promise<boolean> {
    return Boolean(
      await this.prisma.candidate.findFirst({
        where: {
          AND: [{ id: candidateId }, this.candidateWhere(actor, permission)],
        },
        select: { id: true },
      }),
    );
  }

  async canAccessJob(
    actor: AuthenticatedUser,
    permission: string,
    jobId: string,
  ): Promise<boolean> {
    return Boolean(
      await this.prisma.job.findFirst({
        where: { AND: [{ id: jobId }, this.jobWhere(actor, permission)] },
        select: { id: true },
      }),
    );
  }

  /**
   * 入场记录的数据范围判定，供简历入场与附件访问共用（ATS-004/ATS-005）。
   * 调用方已通过权限守卫校验 permission，这里只判定具体记录是否在范围内。
   */
  async canAccessIntake(
    actor: AuthenticatedUser,
    permission: string,
    intake: {
      candidateId: string | null;
      duplicateOfCandidateId: string | null;
      jobId: string | null;
      createdById: string | null;
    },
  ): Promise<boolean> {
    const scopes = this.scopesFor(actor, permission);
    if (scopes.includes(DataScope.ALL)) return true;

    if (
      intake.createdById === actor.id &&
      (scopes.includes(DataScope.SELF) || scopes.includes(DataScope.OWN_JOBS))
    ) {
      return true;
    }
    for (const candidateId of [intake.candidateId, intake.duplicateOfCandidateId]) {
      if (
        candidateId &&
        (await this.canAccessCandidate(actor, permission, candidateId))
      ) {
        return true;
      }
    }
    if (
      intake.jobId &&
      (await this.canAccessJob(actor, permission, intake.jobId))
    ) {
      return true;
    }
    return false;
  }

  async canAccessSensitiveField(
    actor: AuthenticatedUser,
    field: SensitiveField,
    action: SensitiveAction,
  ): Promise<boolean> {
    const grants = await this.prisma.fieldAccessGrant.findMany({
      where: {
        field,
        OR: [
          { userId: actor.id },
          ...(actor.groupIds.length ? [{ userGroupId: { in: actor.groupIds } }] : []),
        ],
        AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }],
      },
      select: { canRead: true, canWrite: true },
    });
    return grants.some((grant) => (action === 'READ' ? grant.canRead : grant.canWrite));
  }

  async assertSensitiveFieldAccess(
    actor: AuthenticatedUser,
    field: SensitiveField,
    action: SensitiveAction,
  ): Promise<void> {
    if (!(await this.canAccessSensitiveField(actor, field, action))) {
      throw new ForbiddenException('缺少该敏感字段的独立授权');
    }
  }

  async assignRoles(
    actor: AuthenticatedUser,
    userId: string,
    assignments: Array<{ roleCode: string; scopeOverride?: DataScope }>,
  ) {
    if (userId === actor.id && !assignments.some((item) => item.roleCode === 'ADMIN')) {
      throw new ForbiddenException('不能移除自己的管理员角色');
    }
    const uniqueCodes = new Set(assignments.map((item) => item.roleCode));
    if (uniqueCodes.size !== assignments.length) {
      throw new BadRequestException('角色列表不能包含重复项');
    }
    const roles = await this.prisma.role.findMany({
      where: { code: { in: [...uniqueCodes] } },
      select: { id: true, code: true },
    });
    if (roles.length !== uniqueCodes.size) throw new BadRequestException('存在未知角色');
    const roleIds = new Map(roles.map((role) => [role.code, role.id]));

    await this.prisma.$transaction(async (tx) => {
      const target = await tx.user.findUnique({ where: { id: userId }, select: { id: true } });
      if (!target) throw new NotFoundException('用户不存在');
      await tx.userRole.deleteMany({ where: { userId } });
      if (assignments.length) {
        await tx.userRole.createMany({
          data: assignments.map((assignment) => ({
            userId,
            roleId: roleIds.get(assignment.roleCode)!,
            scopeOverride: assignment.scopeOverride,
            assignedById: actor.id,
          })),
        });
      }
    });
    return { userId, roles: assignments };
  }

  async addGroupMember(groupId: string, userId: string) {
    const [group, user] = await Promise.all([
      this.prisma.userGroup.findUnique({ where: { id: groupId }, select: { id: true } }),
      this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } }),
    ]);
    if (!group || !user) throw new NotFoundException('用户或用户组不存在');
    await this.prisma.userGroupMember.upsert({
      where: { userId_groupId: { userId, groupId } },
      create: { userId, groupId },
      update: {},
    });
    return { groupId, userId };
  }

  async createGroup(input: { code: string; name: string; description?: string }) {
    if (!input.code.trim() || !input.name.trim()) {
      throw new BadRequestException('用户组 code 和 name 为必填项');
    }
    try {
      return await this.prisma.userGroup.create({
        data: {
          code: input.code.trim(),
          name: input.name.trim(),
          description: input.description?.trim() || undefined,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('用户组编码已存在');
      }
      throw error;
    }
  }

  async createDepartment(input: {
    code: string;
    name: string;
    parentId?: string;
  }) {
    if (!input.code.trim() || !input.name.trim()) {
      throw new BadRequestException('部门 code 和 name 为必填项');
    }
    if (
      input.parentId &&
      !(await this.prisma.department.findFirst({
        where: { id: input.parentId, isActive: true },
        select: { id: true },
      }))
    ) {
      throw new NotFoundException('上级部门不存在');
    }
    try {
      return await this.prisma.department.create({
        data: {
          code: input.code.trim(),
          name: input.name.trim(),
          parentId: input.parentId,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('部门编码已存在');
      }
      throw error;
    }
  }

  async createUser(input: {
    employeeNo?: string;
    displayName: string;
    email?: string;
    departmentId?: string;
    identityProvider: IdentityProvider;
    identitySubject: string;
  }) {
    if (
      !input.displayName.trim() ||
      !input.identitySubject.trim() ||
      !Object.values(IdentityProvider).includes(input.identityProvider)
    ) {
      throw new BadRequestException('用户姓名、身份来源和外部身份标识为必填项');
    }
    if (
      input.departmentId &&
      !(await this.prisma.department.findFirst({
        where: { id: input.departmentId, isActive: true },
        select: { id: true },
      }))
    ) {
      throw new NotFoundException('部门不存在');
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            employeeNo: input.employeeNo?.trim() || undefined,
            displayName: input.displayName.trim(),
            email: input.email?.trim() || undefined,
            departmentId: input.departmentId,
            status: UserStatus.ACTIVE,
            ...(input.departmentId
              ? {
                  departmentMemberships: {
                    create: { departmentId: input.departmentId, isPrimary: true },
                  },
                }
              : {}),
          },
          select: { id: true, employeeNo: true, displayName: true, email: true, departmentId: true, status: true },
        });
        await tx.identityLink.create({
          data: {
            provider: input.identityProvider,
            subject: input.identitySubject.trim(),
            userId: user.id,
            verifiedAt: input.identityProvider === IdentityProvider.LOCAL ? new Date() : undefined,
          },
        });
        return user;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('用户工号、邮箱或外部身份标识已存在');
      }
      throw error;
    }
  }

  private async buildUserWhere(filter?: UserQueryFilter): Promise<Prisma.UserWhereInput> {
    const conditions: Prisma.UserWhereInput[] = [];
    const q = filter?.q?.trim();
    if (q) {
      conditions.push({
        OR: [
          { displayName: { contains: q } },
          { employeeNo: { contains: q } },
          { email: { contains: q } },
        ],
      });
    }
    const departmentId = filter?.departmentId?.trim();
    if (departmentId) {
      if (filter?.includeChildren) {
        const treeIds = await this.departmentTree([departmentId]);
        const targetIds = treeIds.length ? treeIds : [departmentId];
        conditions.push({
          OR: [
            { departmentId: { in: targetIds } },
            { departmentMemberships: { some: { departmentId: { in: targetIds } } } },
          ],
        });
      } else {
        conditions.push({ departmentId });
      }
    }
    const roleCode = filter?.roleCode?.trim();
    if (roleCode) {
      conditions.push({ roleAssignments: { some: { role: { code: roleCode } } } });
    }
    return conditions.length ? { AND: conditions } : {};
  }

  async listUsers(limit = 100, filter?: UserQueryFilter) {
    return this.prisma.user.findMany({
      where: await this.buildUserWhere(filter),
      orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
      take: limit,
      select: USER_LIST_SELECT,
    });
  }

  async listUsersPage(input: UserQueryFilter & { page?: number; pageSize?: number } = {}) {
    const page = Number.isInteger(input.page) && (input.page ?? 0) >= 1 ? input.page! : 1;
    const pageSize = Number.isInteger(input.pageSize)
      ? Math.min(200, Math.max(1, input.pageSize!))
      : 50;
    const where = await this.buildUserWhere(input);
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: USER_LIST_SELECT,
      }),
      this.prisma.user.count({ where }),
    ]);
    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async createFieldGrant(
    actor: AuthenticatedUser,
    input: {
      field: SensitiveField;
      userId?: string;
      userGroupId?: string;
      canRead: boolean;
      canWrite: boolean;
      expiresAt?: Date;
    },
  ) {
    if (Boolean(input.userId) === Boolean(input.userGroupId)) {
      throw new BadRequestException('必须且只能指定一个用户或用户组');
    }
    if (!input.canRead && !input.canWrite) {
      throw new BadRequestException('至少需要授予读取或写入权限');
    }
    if (input.userId && !(await this.prisma.user.findUnique({ where: { id: input.userId }, select: { id: true } }))) {
      throw new NotFoundException('用户不存在');
    }
    if (input.userGroupId && !(await this.prisma.userGroup.findUnique({ where: { id: input.userGroupId }, select: { id: true } }))) {
      throw new NotFoundException('用户组不存在');
    }
    return this.prisma.fieldAccessGrant.create({
      data: {
        field: input.field,
        userId: input.userId,
        userGroupId: input.userGroupId,
        canRead: input.canRead,
        canWrite: input.canWrite,
        expiresAt: input.expiresAt,
        grantedById: actor.id,
      },
      select: {
        id: true,
        field: true,
        userId: true,
        userGroupId: true,
        canRead: true,
        canWrite: true,
        expiresAt: true,
      },
    });
  }

  async revokeFieldGrant(id: string) {
    const grant = await this.prisma.fieldAccessGrant.findUnique({
      where: { id },
      select: {
        id: true,
        field: true,
        userId: true,
        userGroupId: true,
        canRead: true,
        canWrite: true,
        expiresAt: true,
      },
    });
    if (!grant) throw new NotFoundException('授权不存在');
    const result = await this.prisma.fieldAccessGrant.deleteMany({ where: { id } });
    if (!result.count) throw new NotFoundException('授权不存在');
    return { ...grant, revoked: true };
  }

  listRoles() {
    return this.prisma.role.findMany({
      orderBy: { name: 'asc' },
      include: {
        permissions: { include: { permission: { select: { code: true, description: true } } } },
      },
    });
  }

  listGroups() {
    return this.prisma.userGroup.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { members: true } } },
    });
  }

  listDepartments() {
    return this.prisma.department.findMany({
      where: { isActive: true },
      orderBy: [{ parentId: 'asc' }, { name: 'asc' }, { id: 'asc' }],
      select: { id: true, code: true, name: true, parentId: true },
    });
  }

  /** 业务协作基础目录：供普通登录用户选择部门与招聘负责人，不包含账号凭据或角色信息 */
  async directory() {
    const [departments, users] = await Promise.all([
      this.listDepartments(),
      this.prisma.user.findMany({
        where: { status: UserStatus.ACTIVE },
        orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
        select: { id: true, displayName: true, departmentId: true },
      }),
    ]);
    return { departments, users };
  }

  listFieldGrants() {
    return this.prisma.fieldAccessGrant.findMany({
      orderBy: [{ field: 'asc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        field: true,
        userId: true,
        userGroupId: true,
        canRead: true,
        canWrite: true,
        grantedById: true,
        expiresAt: true,
        createdAt: true,
      },
    });
  }

  private async departmentTree(rootIds: string[]): Promise<string[]> {
    const roots = await this.prisma.department.findMany({
      where: { id: { in: [...new Set(rootIds)] }, isActive: true },
      select: { id: true },
    });
    const ids = new Set(roots.map(({ id }) => id));
    let frontier = [...ids];
    while (frontier.length) {
      const children = await this.prisma.department.findMany({
        where: { parentId: { in: frontier }, isActive: true },
        select: { id: true },
      });
      frontier = children.map(({ id }) => id).filter((id) => !ids.has(id));
      frontier.forEach((id) => ids.add(id));
    }
    return [...ids];
  }
}

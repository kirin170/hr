import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { DataScope, IdentityProvider, SensitiveField } from '@prisma/client';
import {
  AuditAction,
  CurrentUser,
  RequirePermission,
} from './auth.decorators.js';
import { AuthorizationService } from './authorization.service.js';
import type { AuthenticatedUser } from './auth.types.js';

@Controller('api/v1/authz')
export class AuthorizationController {
  constructor(private readonly authorization: AuthorizationService) {}

  @Get('me')
  @AuditAction('authz.me', 'User')
  me(@CurrentUser() actor: AuthenticatedUser) {
    return actor;
  }

  /**
   * 业务协作基础目录（仅返回在用部门与在职人员最小展示字段，面向所有已登录业务用户）：
   * 供新建职位选部门/负责人、个人菜单展示所属部门等使用，无需 authz:read 管理权限。
   */
  @Get('directory')
  @AuditAction('authz.directory.read', 'Department')
  directory() {
    return this.authorization.directory();
  }

  @Get('roles')
  @RequirePermission('authz:read')
  @AuditAction('authz.roles.read', 'Role')
  listRoles() {
    return this.authorization.listRoles();
  }

  @Get('groups')
  @RequirePermission('authz:read')
  @AuditAction('authz.groups.read', 'UserGroup')
  listGroups() {
    return this.authorization.listGroups();
  }

  @Post('groups')
  @RequirePermission('authz:admin')
  @AuditAction('authz.group.create', 'UserGroup')
  createGroup(@Body() body: Record<string, unknown> = {}) {
    return this.authorization.createGroup({
      code: this.requiredText(body.code, 'code 为必填项'),
      name: this.requiredText(body.name, 'name 为必填项'),
      description: this.optionalText(body.description),
    });
  }

  @Get('departments')
  @RequirePermission('authz:read')
  @AuditAction('authz.departments.read', 'Department')
  listDepartments() {
    return this.authorization.listDepartments();
  }

  @Post('departments')
  @RequirePermission('authz:admin')
  @AuditAction('authz.department.create', 'Department')
  createDepartment(@Body() body: Record<string, unknown> = {}) {
    return this.authorization.createDepartment({
      code: this.requiredText(body.code, 'code 为必填项'),
      name: this.requiredText(body.name, 'name 为必填项'),
      parentId: this.optionalText(body.parentId),
    });
  }

  @Get('users')
  @RequirePermission('authz:read')
  @AuditAction('authz.users.read', 'User')
  listUsers(
    @Query('limit') limit?: string,
    @Query('q') q?: string,
    @Query('departmentId') departmentId?: string,
    @Query('includeChildren') includeChildren?: string,
    @Query('roleCode') roleCode?: string,
  ) {
    const parsed = this.parseBoundedInt(limit, 100, 1, 5000, 'limit 必须为 1 至 5000 的整数');
    return this.authorization.listUsers(parsed, {
      q,
      departmentId,
      includeChildren: includeChildren === 'true',
      roleCode,
    });
  }

  @Get('users/page')
  @RequirePermission('authz:read')
  @AuditAction('authz.users.read', 'User')
  listUsersPage(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('q') q?: string,
    @Query('departmentId') departmentId?: string,
    @Query('includeChildren') includeChildren?: string,
    @Query('roleCode') roleCode?: string,
  ) {
    return this.authorization.listUsersPage({
      page: this.parseBoundedInt(page, 1, 1, 100_000, 'page 必须为正整数'),
      pageSize: this.parseBoundedInt(pageSize, 50, 1, 200, 'pageSize 必须为 1 至 200 的整数'),
      q,
      departmentId,
      includeChildren: includeChildren === 'true',
      roleCode,
    });
  }

  @Post('users')
  @RequirePermission('authz:admin')
  @AuditAction('authz.user.create', 'User')
  createUser(
    @Body() body: Record<string, unknown> = {},
  ) {
    const provider = body.identityProvider;
    if (typeof provider !== 'string' || !Object.values(IdentityProvider).includes(provider as IdentityProvider)) {
      throw new BadRequestException('identityProvider 必须为 LOCAL 或 DINGTALK');
    }
    return this.authorization.createUser({
      employeeNo: this.optionalText(body.employeeNo),
      displayName: this.requiredText(body.displayName, 'displayName 为必填项'),
      email: this.optionalText(body.email),
      departmentId: this.optionalText(body.departmentId),
      identityProvider: provider as IdentityProvider,
      identitySubject: this.requiredText(body.identitySubject, 'identitySubject 为必填项'),
    });
  }

  @Put('users/:userId/roles')
  @RequirePermission('authz:admin')
  @AuditAction('authz.user.roles.update', 'User')
  assignRoles(
    @Param('userId') userId: string,
    @Body() body: { roles?: unknown },
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    if (!Array.isArray(body?.roles)) throw new BadRequestException('roles 必须是数组');
    const assignments = body.roles.map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new BadRequestException('roles 项格式不正确');
      }
      const item = entry as Record<string, unknown>;
      const roleCode = this.requiredText(item.roleCode, 'roleCode 为必填项');
      let scopeOverride: DataScope | undefined;
      if (item.scopeOverride !== undefined) {
        if (typeof item.scopeOverride !== 'string' || !Object.values(DataScope).includes(item.scopeOverride as DataScope)) {
          throw new BadRequestException('scopeOverride 值无效');
        }
        scopeOverride = item.scopeOverride as DataScope;
      }
      return { roleCode, scopeOverride };
    });
    return this.authorization.assignRoles(actor, userId, assignments);
  }

  @Post('groups/:groupId/members/:userId')
  @RequirePermission('authz:admin')
  @AuditAction('authz.group.member.add', 'UserGroup')
  addGroupMember(@Param('groupId') groupId: string, @Param('userId') userId: string) {
    return this.authorization.addGroupMember(groupId, userId);
  }

  @Post('field-grants')
  @RequirePermission('authz:field-grant:manage')
  @AuditAction('authz.field-grant.create', 'FieldAccessGrant')
  createFieldGrant(
    @Body() body: Record<string, unknown> = {},
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    if (typeof body.field !== 'string' || !Object.values(SensitiveField).includes(body.field as SensitiveField)) {
      throw new BadRequestException('field 值无效');
    }
    const expiresAt = this.optionalText(body.expiresAt);
    let parsedExpiry: Date | undefined;
    if (expiresAt) {
      parsedExpiry = new Date(expiresAt);
      if (!Number.isFinite(parsedExpiry.getTime()) || parsedExpiry <= new Date()) {
        throw new BadRequestException('expiresAt 必须是未来的有效日期');
      }
    }
    return this.authorization.createFieldGrant(actor, {
      field: body.field as SensitiveField,
      userId: this.optionalText(body.userId),
      userGroupId: this.optionalText(body.userGroupId),
      canRead: body.canRead === true,
      canWrite: body.canWrite === true,
      expiresAt: parsedExpiry,
    });
  }

  @Get('field-grants')
  @RequirePermission('authz:field-grant:manage')
  @AuditAction('authz.field-grants.read', 'FieldAccessGrant')
  listFieldGrants() {
    return this.authorization.listFieldGrants();
  }

  @Delete('field-grants/:id')
  @RequirePermission('authz:field-grant:manage')
  @AuditAction('authz.field-grant.revoke', 'FieldAccessGrant')
  revokeFieldGrant(@Param('id') id: string) {
    return this.authorization.revokeFieldGrant(id);
  }

  private requiredText(value: unknown, message: string): string {
    if (typeof value !== 'string' || !value.trim()) throw new BadRequestException(message);
    return value.trim();
  }

  private optionalText(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const text = value.trim();
    return text || undefined;
  }

  private parseBoundedInt(
    value: string | undefined,
    fallback: number,
    min: number,
    max: number,
    message: string,
  ): number {
    if (value === undefined) return fallback;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
      throw new BadRequestException(message);
    }
    return parsed;
  }
}

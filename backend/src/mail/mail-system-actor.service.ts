import { Injectable } from '@nestjs/common';
import { DataScope, UserStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  MAIL_SYSTEM_EMPLOYEE_NO,
  MAIL_SYSTEM_PERMISSIONS,
  MAIL_SYSTEM_ROLE_CODE,
  MAIL_SYSTEM_ROLE_NAME,
} from './mail.constants.js';

/**
 * 自动抓取没有登录用户，但入场记录、时间线与审计必须可追溯。
 * 这里幂等维护一个不可登录的系统身份（无 IdentityLink），首次轮询时自动创建。
 */
@Injectable()
export class MailSystemActorService {
  private cachedId: string | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async ensureActorId(): Promise<string> {
    if (this.cachedId) return this.cachedId;

    const role = await this.prisma.role.upsert({
      where: { code: MAIL_SYSTEM_ROLE_CODE },
      create: {
        code: MAIL_SYSTEM_ROLE_CODE,
        name: MAIL_SYSTEM_ROLE_NAME,
        dataScope: DataScope.ALL,
      },
      update: { name: MAIL_SYSTEM_ROLE_NAME, dataScope: DataScope.ALL },
      select: { id: true },
    });

    const permissions = await this.prisma.permission.findMany({
      where: { code: { in: [...MAIL_SYSTEM_PERMISSIONS] } },
      select: { id: true },
    });
    await this.prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    if (permissions.length) {
      await this.prisma.rolePermission.createMany({
        data: permissions.map((permission) => ({
          roleId: role.id,
          permissionId: permission.id,
        })),
      });
    }

    const user = await this.prisma.user.upsert({
      where: { employeeNo: MAIL_SYSTEM_EMPLOYEE_NO },
      create: {
        employeeNo: MAIL_SYSTEM_EMPLOYEE_NO,
        displayName: MAIL_SYSTEM_ROLE_NAME,
        status: UserStatus.ACTIVE,
      },
      update: { displayName: MAIL_SYSTEM_ROLE_NAME, status: UserStatus.ACTIVE },
      select: { id: true },
    });

    await this.prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: role.id } },
      create: { userId: user.id, roleId: role.id },
      update: {},
    });

    this.cachedId = user.id;
    return user.id;
  }
}

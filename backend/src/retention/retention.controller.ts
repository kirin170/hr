import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { CurrentUser, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthenticatedRequest, AuthenticatedUser } from '../auth/auth.types.js';
import { RetentionService } from './retention.service.js';

@Controller('api/v1/retention')
export class RetentionController {
  constructor(
    private readonly retention: RetentionService,
    private readonly audit: AuditService,
  ) {}

  /** 当前生效的保留期限，供上线前与业务确认。 */
  @Get('policy')
  @RequirePermission('retention:manage')
  policy() {
    const policy = this.retention.policy();
    return {
      resumeDays: policy.resumeDays,
      sensitiveDays: policy.sensitiveDays,
      batchSize: policy.batchSize,
      note: '具体保留期限待业务确认，通过 RETENTION_RESUME_DAYS / RETENTION_SENSITIVE_DAYS 配置',
    };
  }

  /** 触发到期清理；dryRun=true 只统计不删除。 */
  @Post('purge')
  @RequirePermission('retention:manage')
  purge(
    @Body() body: { dryRun?: boolean } = {},
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.retention.purgeExpired({
      actorId: actor.id,
      dryRun: body?.dryRun === true,
      requestId: this.audit.requestId(request),
    });
  }
}

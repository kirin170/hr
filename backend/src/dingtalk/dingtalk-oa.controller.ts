import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { AuditAction, CurrentUser, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { DingTalkOaService } from './dingtalk-oa.service.js';

/**
 * 钉钉 OA 对接入口（DT-5 / DT-6）。
 * 回调入口复用 /api/v1/dingtalk/events（签名 + AES 校验），这里只放需要登录与业务权限的人工操作。
 */
@Controller('api/v1')
export class DingTalkOaController {
  constructor(private readonly oa: DingTalkOaService) {}

  @Get('requisitions/oa-sync/capability')
  @RequirePermission('requisition:read')
  @AuditAction('requisition.oa_capability.read', 'JobRequisition')
  capability() {
    return this.oa.capability();
  }

  @Post('requisitions/sync-from-oa')
  @HttpCode(200)
  @RequirePermission('requisition:sync')
  @AuditAction('requisition.manual_sync', 'JobRequisition')
  sync(@Body() body: unknown, @CurrentUser() actor: AuthenticatedUser) {
    return this.oa.syncRequisition(body, actor);
  }

  /** 与 sync-from-oa 等价，保留旧路径；请求体只接受审批实例 ID（或详情链接）和可选的开始招聘时间。 */
  @Post('requisitions/oa-sync')
  @HttpCode(200)
  @RequirePermission('requisition:sync')
  @AuditAction('requisition.oa_sync', 'JobRequisition')
  legacySync(@Body() body: unknown, @CurrentUser() actor: AuthenticatedUser) {
    return this.oa.syncRequisition(body, actor);
  }

  @Get('requisitions/oa-sync/events')
  @RequirePermission('requisition:sync')
  @AuditAction('requisition.oa_events.read', 'JobRequisition')
  events() {
    return this.oa.listApprovalEvents();
  }

  @Post('requisitions/oa-sync/events/:id/retry')
  @HttpCode(202)
  @RequirePermission('requisition:sync')
  @AuditAction('requisition.oa_event.retry', 'JobRequisition')
  retryEvent(@Param('id') id: string) {
    return this.oa.retryApprovalEvent(id);
  }

  @Post('candidates/:id/offer/oa')
  @HttpCode(200)
  @RequirePermission('candidate:stage:update')
  @AuditAction('offer.oa_submit', 'Candidate')
  submitOfferApproval(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.oa.submitOfferApproval(id, actor);
  }

  @Post('candidates/:id/offer/oa/refresh')
  @HttpCode(200)
  @RequirePermission('candidate:stage:update')
  @AuditAction('offer.oa_refresh', 'Candidate')
  refreshOfferApproval(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.oa.refreshOfferApproval(id, actor);
  }
}

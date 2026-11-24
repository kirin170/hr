import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { AuditAction, CurrentUser, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { RequisitionsService, type RequisitionListQuery } from './requisitions.service.js';

@Controller('requisitions')
export class RequisitionsController {
  constructor(private readonly requisitions: RequisitionsService) {}

  @Get()
  @RequirePermission('requisition:read')
  @AuditAction('requisition.list', 'JobRequisition')
  list(@CurrentUser() actor: AuthenticatedUser, @Query() query: RequisitionListQuery) {
    return this.requisitions.list(actor, query);
  }

  @Get('in-progress')
  @RequirePermission('requisition:read')
  @AuditAction('requisition.in_progress', 'JobRequisition')
  inProgress(@CurrentUser() actor: AuthenticatedUser, @Query('sort') sort?: string) {
    return this.requisitions.inProgress(actor, sort);
  }

  @Get('stats/cycle')
  @RequirePermission('requisition:read')
  @AuditAction('requisition.cycle_stats', 'JobRequisition')
  cycleStats(@CurrentUser() actor: AuthenticatedUser) {
    return this.requisitions.cycleStats(actor);
  }

  // OA 需求同步（POST requisitions/sync-from-oa、requisitions/oa-sync）已由钉钉 OA 对接控制器接管：
  // 只接受审批实例 ID 并回读钉钉核实，不再接收请求体直传的需求字段。

  @Get(':id/timeline')
  @RequirePermission('requisition:read')
  @AuditAction('requisition.timeline.read', 'JobRequisition')
  timeline(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.requisitions.timeline(id, actor);
  }

  @Get(':id')
  @RequirePermission('requisition:read')
  @AuditAction('requisition.read', 'JobRequisition')
  get(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.requisitions.get(id, actor);
  }

  @Patch(':id/start-date')
  @RequirePermission('requisition:manage')
  @AuditAction('requisition.start_date.update', 'JobRequisition')
  changeStartDate(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.requisitions.changeStartDate(id, body, actor);
  }

  @Post(':id/close')
  @RequirePermission('requisition:manage')
  @AuditAction('requisition.close', 'JobRequisition')
  close(@Param('id') id: string, @Body() body: unknown, @CurrentUser() actor: AuthenticatedUser) {
    return this.requisitions.close(id, body, actor);
  }

  @Post(':id/revert')
  @RequirePermission('requisition:manage')
  @AuditAction('requisition.revert', 'JobRequisition')
  revert(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.requisitions.revert(id, actor);
  }

  @Patch(':id')
  @RequirePermission('requisition:manage')
  @AuditAction('requisition.update', 'JobRequisition')
  update(@Param('id') id: string, @Body() body: unknown, @CurrentUser() actor: AuthenticatedUser) {
    return this.requisitions.update(id, body, actor);
  }
}

import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import { AuditAction, CurrentUser, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthenticatedRequest, AuthenticatedUser } from '../auth/auth.types.js';
import { DictSettingsService } from './dict-settings.service.js';
import { FieldConfigService } from './field-config.service.js';
import { NotificationPreferenceService } from './notification-preference.service.js';
import { OperationsService } from './operations.service.js';
import { ReasonSettingsService } from './reason-settings.service.js';
import { NotificationOutboxService } from '../dingtalk/notification-outbox.service.js';
import { InterviewCalendarSyncService } from '../dingtalk/interview-calendar-sync.service.js';
import { FIXED_RULES, NOTIFICATION_EVENTS, type AuditContext } from './settings-shared.js';

function objectBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestException('请求体必须是 JSON 对象');
  }
  return body as Record<string, unknown>;
}

/**
 * 业务设置（ATS-024 / PRD §9.2 FR-ADM-1～5）。
 *
 * - 读配置要求 setting:read，写配置要求 setting:manage；两枚权限默认只授予系统管理员。
 * - 接入模块的凭据维护、重试与清理仍走各领域接口并按领域权限校验，这里不代理。
 * - effective 与个人通知偏好面向已登录用户，只返回表单所需的标记与启用选项。
 */
@Controller('api/v1/admin/settings')
export class SettingsController {
  constructor(
    private readonly reasons: ReasonSettingsService,
    private readonly dicts: DictSettingsService,
    private readonly fields: FieldConfigService,
    private readonly preferences: NotificationPreferenceService,
    private readonly operations: OperationsService,
    private readonly deliveries: NotificationOutboxService,
    private readonly calendarSync: InterviewCalendarSyncService,
  ) {}

  private ctx(request: AuthenticatedRequest): AuditContext {
    const headerId = request.headers['x-request-id'];
    const headerRequestId = Array.isArray(headerId) ? headerId[0] : headerId;
    return {
      requestId: request.requestId ?? headerRequestId ?? 'unknown',
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    };
  }

  @Get('effective')
  effective() {
    return this.fields.effective();
  }

  @Get('me/notification-preferences')
  myNotificationPreferences(@CurrentUser() actor: AuthenticatedUser) {
    return this.preferences.get(actor.id);
  }

  @Put('me/notification-preferences')
  myNotificationPreferencesUpdate(@CurrentUser() actor: AuthenticatedUser, @Body() body: unknown = {}) {
    return this.preferences.update(actor.id, objectBody(body));
  }

  @Get('rules')
  @RequirePermission('setting:read')
  rules() {
    return { items: FIXED_RULES };
  }

  @Get('overview')
  @RequirePermission('setting:read')
  async overview() {
    const [reasons, dicts, fieldGroups, plans] = await Promise.all([
      this.reasons.list(),
      this.dicts.list(),
      this.fields.listFields(),
      this.fields.listPlans(),
    ]);
    return { reasons, dicts, fields: fieldGroups, interviewPlans: plans, rules: FIXED_RULES };
  }

  @Get('reasons')
  @RequirePermission('setting:read')
  listReasons() {
    return this.reasons.list();
  }

  @Post('reasons')
  @RequirePermission('setting:manage')
  createReason(@Body() body: unknown = {}, @CurrentUser() actor: AuthenticatedUser, @Req() request: AuthenticatedRequest) {
    return this.reasons.create(objectBody(body), actor, this.ctx(request));
  }

  @Post('reasons/reorder')
  @HttpCode(200)
  @RequirePermission('setting:manage')
  reorderReasons(@Body() body: unknown = {}, @CurrentUser() actor: AuthenticatedUser, @Req() request: AuthenticatedRequest) {
    return this.reasons.reorder(objectBody(body), actor, this.ctx(request));
  }

  @Patch('reasons/:id')
  @RequirePermission('setting:manage')
  updateReason(
    @Param('id') id: string,
    @Body() body: unknown = {},
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.reasons.update(id, objectBody(body), actor, this.ctx(request));
  }

  @Get('dicts')
  @RequirePermission('setting:read')
  listDicts() {
    return this.dicts.list();
  }

  @Post('dicts')
  @RequirePermission('setting:manage')
  createDict(@Body() body: unknown = {}, @CurrentUser() actor: AuthenticatedUser, @Req() request: AuthenticatedRequest) {
    return this.dicts.create(objectBody(body), actor, this.ctx(request));
  }

  @Post('dicts/reorder')
  @HttpCode(200)
  @RequirePermission('setting:manage')
  reorderDicts(@Body() body: unknown = {}, @CurrentUser() actor: AuthenticatedUser, @Req() request: AuthenticatedRequest) {
    return this.dicts.reorder(objectBody(body), actor, this.ctx(request));
  }

  @Patch('dicts/:id')
  @RequirePermission('setting:manage')
  updateDict(
    @Param('id') id: string,
    @Body() body: unknown = {},
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.dicts.update(id, objectBody(body), actor, this.ctx(request));
  }

  @Get('fields')
  @RequirePermission('setting:read')
  async listFields() {
    // listFields 是异步的：不 await 会把 Promise 序列化成 {}，接口静默返回空配置。
    return { groups: await this.fields.listFields() };
  }

  @Patch('fields/:id')
  @RequirePermission('setting:manage')
  updateField(
    @Param('id') id: string,
    @Body() body: unknown = {},
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.fields.updateField(id, objectBody(body), actor, this.ctx(request));
  }

  @Get('interview-plans')
  @RequirePermission('setting:read')
  listPlans() {
    return this.fields.listPlans();
  }

  @Post('interview-plans')
  @RequirePermission('setting:manage')
  createPlan(@Body() body: unknown = {}, @CurrentUser() actor: AuthenticatedUser, @Req() request: AuthenticatedRequest) {
    return this.fields.createPlan(objectBody(body), actor, this.ctx(request));
  }

  @Patch('interview-plans/:id')
  @RequirePermission('setting:manage')
  updatePlan(
    @Param('id') id: string,
    @Body() body: unknown = {},
    @CurrentUser() actor: AuthenticatedUser,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.fields.updatePlan(id, objectBody(body), actor, this.ctx(request));
  }

  @Get('notifications')
  @RequirePermission('setting:read')
  notifications() {
    return {
      channel: 'MOCK',
      integrated: false,
      note: '正式通知发送通道未接入（ATS-018）；当前事件经面试模块 Mock 通道记录，接收角色由业务规则确定。',
      events: NOTIFICATION_EVENTS,
    };
  }

  @Get('notifications/deliveries')
  @RequirePermission('setting:read')
  @AuditAction('setting.notification.deliveries.read', 'NotificationDelivery')
  notificationDeliveries() { return this.deliveries.recent(); }

  @Post('notifications/deliveries/:id/retry')
  @RequirePermission('setting:manage')
  @AuditAction('setting.notification.deliveries.retry', 'NotificationDelivery')
  retryNotification(@Param('id') id: string) { return this.deliveries.retryFailed(id); }

  /** 日历同步失败的人工补偿入口；结果未知（UNKNOWN）的同步不允许重发，避免重复建日程。 */
  @Post('calendar-sync/:interviewId/retry')
  @RequirePermission('setting:manage')
  @AuditAction('setting.calendar.sync.retry', 'InterviewCalendarSync')
  async retryCalendarSync(@Param('interviewId') interviewId: string) {
    const ok = await this.calendarSync.retryFailed(interviewId);
    if (!ok) throw new ConflictException('仅明确失败的日历同步可以重试；结果未知的同步不能自动重发');
    return { ok: true };
  }

  @Get('operations')
  @RequirePermission('setting:read')
  @AuditAction('setting.operations.read', 'Operations')
  operationsSnapshot() {
    return this.operations.snapshot();
  }
}

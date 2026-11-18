import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { AuditAction, RequirePermission } from '../auth/auth.decorators.js';
import { DingTalkSyncQueueService } from './dingtalk-sync.queue.js';
import { DingTalkSyncService } from './dingtalk-sync.service.js';

@Controller('api/v1/admin/organization/dingtalk')
@RequirePermission('organization:sync')
export class DingTalkSyncController {
  constructor(
    private readonly sync: DingTalkSyncService,
    private readonly queue: DingTalkSyncQueueService,
  ) {}

  @Post('sync')
  @HttpCode(HttpStatus.ACCEPTED)
  @AuditAction('dingtalk.organization.sync.queued', 'DingTalkOrganization')
  enqueueFullSync(@Body() body: unknown = {}) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('请求体必须是 JSON 对象');
    }
    const value = (body as Record<string, unknown>).departmentId;
    if (value === undefined) return this.sync.enqueueManualSync();

    const departmentId = typeof value === 'number'
      ? value
      : typeof value === 'string' && /^[1-9]\d*$/.test(value)
        ? Number(value)
        : Number.NaN;
    if (!Number.isSafeInteger(departmentId) || departmentId < 1) {
      throw new BadRequestException('departmentId 必须为正整数');
    }
    return this.sync.enqueueManualSync(departmentId);
  }

  @Get('events')
  @AuditAction('dingtalk.sync_events.read', 'DingTalkSyncEvent')
  listEvents(@Query('limit') limit?: string) {
    if (limit !== undefined && (!/^\d+$/.test(limit) || Number(limit) < 1)) {
      throw new BadRequestException('limit 必须是正整数');
    }
    return this.sync.listEvents(limit === undefined ? 50 : Number(limit));
  }

  @Post('events/:id/retry')
  @HttpCode(HttpStatus.ACCEPTED)
  @AuditAction('dingtalk.sync_event.retry', 'DingTalkSyncEvent')
  retry(@Param('id') id: string) {
    return this.queue.retryFailed(id);
  }
}

import {
  BadRequestException,
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
  enqueueFullSync() {
    return this.sync.enqueueManualSync();
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

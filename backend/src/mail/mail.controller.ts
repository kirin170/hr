import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { AuditAction, RequirePermission } from '../auth/auth.decorators.js';
import { MailConfigService, type MailInboxInput } from './mail-config.service.js';
import { MailPollService } from './mail-poll.service.js';

/**
 * 招聘邮箱关联、连接测试与抓取状态（FR-ENT-1 / FR-ADM-6）。
 * 管理后台统一入口由 ATS-024 承接，这里提供可复用的领域接口。
 */
@Controller('api/v1/mail/mailboxes')
export class MailController {
  constructor(
    private readonly configs: MailConfigService,
    private readonly poll: MailPollService,
  ) {}

  @Get()
  @RequirePermission('intake:read')
  async list() {
    return { items: await this.configs.list() };
  }

  @Get(':id')
  @RequirePermission('intake:read')
  async detail(@Param('id') id: string) {
    return this.configs.get(id);
  }

  @Post()
  @RequirePermission('intake:manage')
  @AuditAction('mail.mailbox_create', 'MailInboxConfig')
  async create(@Body() body: MailInboxInput = {}) {
    return this.configs.create(body);
  }

  @Patch(':id')
  @RequirePermission('intake:manage')
  @AuditAction('mail.mailbox_update', 'MailInboxConfig')
  async update(@Param('id') id: string, @Body() body: MailInboxInput = {}) {
    return this.configs.update(id, body);
  }

  @Delete(':id')
  @RequirePermission('intake:manage')
  @AuditAction('mail.mailbox_delete', 'MailInboxConfig')
  async remove(@Param('id') id: string) {
    return this.configs.remove(id);
  }

  /** 连接测试：只读打开收件箱，不拉取邮件、不推进游标 */
  @Post(':id/test-connection')
  @RequirePermission('intake:manage')
  @AuditAction('mail.mailbox_test', 'MailInboxConfig')
  async testConnection(@Param('id') id: string) {
    return this.configs.testConnection(id);
  }

  /** 手动触发一次抓取；与定时轮询共用同一幂等链路 */
  @Post(':id/poll')
  @RequirePermission('intake:manage')
  @AuditAction('mail.mailbox_poll', 'MailInboxConfig')
  async pollNow(@Param('id') id: string) {
    return this.poll.pollOne(id);
  }

  /** 抓取监控：该邮箱最近处理记录与失败归因（FR-ENT-8） */
  @Get(':id/messages')
  @RequirePermission('intake:read')
  async messages(@Param('id') id: string, @Query('limit') limit?: string) {
    return { items: await this.poll.listMessages(id, Number(limit) || 20) };
  }
}

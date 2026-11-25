import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  Req,
} from '@nestjs/common';
import { AuditAction, CurrentUser, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthenticatedRequest, AuthenticatedUser } from '../auth/auth.types.js';
import type { AuditContext } from '../settings/settings-shared.js';
import { AiConfigService } from './ai-config.service.js';

function objectBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestException('请求体必须是 JSON 对象');
  }
  return body as Record<string, unknown>;
}

/**
 * AI 管理（PRD §6 / ATS-021，页面由 ATS-024 承载）。
 *
 * - 配置读写要求 setting:read / setting:manage；
 * - 密钥只在部署环境注入，这里只展示是否已配置；
 * - 调用记录只含元数据，不含简历/听记原文。
 */
@Controller('api/v1/admin/ai-settings')
export class AiSettingsController {
  constructor(private readonly config: AiConfigService) {}

  private ctx(request: AuthenticatedRequest): AuditContext {
    const headerId = request.headers['x-request-id'];
    const headerRequestId = Array.isArray(headerId) ? headerId[0] : headerId;
    return {
      requestId: request.requestId ?? headerRequestId ?? 'unknown',
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    };
  }

  @Get()
  @RequirePermission('setting:read')
  async read() {
    return this.config.getAdminConfig();
  }

  @Patch()
  @RequirePermission('setting:manage')
  @AuditAction('ai.config.update', 'AiConfig')
  async update(
    @Req() request: AuthenticatedRequest,
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: unknown = {},
  ) {
    return this.config.updateConfig(objectBody(body), actor, this.ctx(request));
  }

  @Get('usage')
  @RequirePermission('setting:read')
  async usage(@Query('days') days?: string) {
    return this.config.usageSummary(Number(days) || 7);
  }

  @Get('runs')
  @RequirePermission('setting:read')
  async runs(
    @Query('type') type?: string,
    @Query('status') status?: string,
    @Query('take') take?: string,
  ) {
    return this.config.recentRuns({ type, status, take: Number(take) || undefined });
  }

  @Get('jobs')
  @RequirePermission('setting:read')
  async jobs(@Query('keyword') keyword?: string, @Query('take') take?: string) {
    return this.config.listJobSwitches({ keyword, take: Number(take) || undefined });
  }

  @Patch('jobs/:id')
  @RequirePermission('setting:manage')
  @AuditAction('job.ai_eval_switch', 'Job')
  async updateJob(
    @Req() request: AuthenticatedRequest,
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: unknown = {},
  ) {
    return this.config.updateJobSwitch(id, objectBody(body), actor, this.ctx(request));
  }
}

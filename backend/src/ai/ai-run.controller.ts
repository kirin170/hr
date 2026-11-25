import { BadRequestException, Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { AuditAction, CurrentUser, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { AiRunService } from './ai-run.service.js';

function objectBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestException('请求体必须是 JSON 对象');
  }
  return body as Record<string, unknown>;
}

@Controller('api/v1/ai-runs')
export class AiRunController {
  constructor(private readonly aiRuns: AiRunService) {}

  /** 发起简历评估（AI-5：无招聘要求、职位/系统关闭时拒绝）。 */
  @Post('resume-eval')
  @RequirePermission('ai:read')
  @AuditAction('ai_run.request', 'AIRun')
  async requestResumeEval(@CurrentUser() actor: AuthenticatedUser, @Body() body: unknown = {}) {
    const payload = objectBody(body);
    const candidateId = typeof payload.candidateId === 'string' ? payload.candidateId.trim() : '';
    if (!candidateId) throw new BadRequestException('candidateId 为必填项');
    return this.aiRuns.requestResumeEval(candidateId, actor, { force: payload.force === true });
  }

  @Get(':id')
  @RequirePermission('ai:read')
  @AuditAction('ai_run.read', 'AIRun')
  async detail(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.aiRuns.getRun(id, actor);
  }

  /** 人工编辑草稿（AI-1）：编辑后仍是草稿，必须再确认。 */
  @Patch(':id')
  @RequirePermission('ai:confirm')
  @AuditAction('ai_run.edit', 'AIRun')
  async edit(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser, @Body() body: unknown = {}) {
    return this.aiRuns.editRun(id, objectBody(body), actor);
  }

  @Post(':id/confirm')
  @RequirePermission('ai:confirm')
  @AuditAction('ai_run.confirm', 'AIRun')
  async confirm(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.aiRuns.confirmRun(id, actor);
  }
}

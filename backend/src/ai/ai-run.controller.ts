import { Controller, Get, Param, Post } from '@nestjs/common';
import { AiRunService } from './ai-run.service.js';
import { AuditAction, CurrentUser, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';

@Controller('api/v1/ai-runs')
export class AiRunController {
  constructor(private readonly aiRuns: AiRunService) {}

  @Get(':id')
  @RequirePermission('ai:read')
  @AuditAction('ai_run.read', 'AIRun')
  async detail(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.aiRuns.getRun(id, actor);
  }

  @Post(':id/confirm')
  @RequirePermission('ai:confirm')
  @AuditAction('ai_run.confirm', 'AIRun')
  async confirm(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.aiRuns.confirmRun(id, actor);
  }
}

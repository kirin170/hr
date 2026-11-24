import { BadRequestException, Body, Controller, Get, Post, Query } from '@nestjs/common';
import { CurrentUser, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { DashboardService } from './dashboard.service.js';

@Controller('api/v1/dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('summary')
  @RequirePermission('candidate:read')
  summary(@CurrentUser() actor: AuthenticatedUser) {
    return this.dashboard.summary(actor);
  }

  @Get('jobs')
  @RequirePermission('job:read')
  jobs(@CurrentUser() actor: AuthenticatedUser) {
    return this.dashboard.jobs(actor);
  }

  @Get('job-360')
  @RequirePermission('job:read')
  job360(@CurrentUser() actor: AuthenticatedUser, @Query('jobId') jobId?: string) {
    if (!jobId?.trim()) throw new BadRequestException('缺少职位参数');
    return this.dashboard.job360(actor, jobId.trim());
  }

  @Get('notifications')
  @RequirePermission('candidate:read')
  notifications(@CurrentUser() actor: AuthenticatedUser) {
    return this.dashboard.notifications(actor);
  }

  @Post('notifications/read')
  @RequirePermission('candidate:read')
  markRead(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: { ids?: string[]; all?: boolean },
  ) {
    return this.dashboard.markNotificationsRead(actor, {
      ids: Array.isArray(body?.ids) ? body.ids.filter((id) => typeof id === 'string') : [],
      all: body?.all === true,
    });
  }
}

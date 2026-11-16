import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { AuditAction, CurrentUser, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { JobsService, type JobListQuery } from './jobs.service.js';

@Controller('jobs')
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Get()
  @RequirePermission('job:read')
  @AuditAction('job.list', 'Job')
  list(@CurrentUser() actor: AuthenticatedUser, @Query() query: JobListQuery) {
    return this.jobs.list(actor, query);
  }

  @Get('virtual')
  @RequirePermission('job:read')
  @AuditAction('job.virtual.list', 'Job')
  listVirtual(@CurrentUser() actor: AuthenticatedUser) {
    return this.jobs.listVirtual(actor);
  }

  @Get(':id/timeline')
  @RequirePermission('job:read')
  @AuditAction('job.timeline.read', 'Job')
  timeline(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.jobs.timeline(id, actor);
  }

  @Get(':id')
  @RequirePermission('job:read')
  @AuditAction('job.read', 'Job')
  get(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.jobs.get(id, actor);
  }

  @Post()
  @RequirePermission('job:create')
  @AuditAction('job.create', 'Job')
  create(@Body() body: unknown, @CurrentUser() actor: AuthenticatedUser) {
    return this.jobs.create(body, actor);
  }

  @Post(':id/close')
  @RequirePermission('job:close')
  @AuditAction('job.close', 'Job')
  close(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.jobs.close(id, actor);
  }

  @Patch(':id')
  @RequirePermission('job:update')
  @AuditAction('job.update', 'Job')
  update(@Param('id') id: string, @Body() body: unknown, @CurrentUser() actor: AuthenticatedUser) {
    return this.jobs.update(id, body, actor);
  }
}

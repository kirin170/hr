import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { AuditAction, CurrentUser, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CandidatesService } from './candidates.service.js';

@Controller()
export class CandidatesController {
  constructor(private readonly candidates: CandidatesService) {}

  @Get('candidates')
  @RequirePermission('candidate:read')
  @AuditAction('candidate.list', 'Candidate')
  list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query('page', new ParseIntPipe({ optional: true })) page?: number,
    @Query('pageSize', new ParseIntPipe({ optional: true })) pageSize?: number,
  ) {
    return this.candidates.list(actor, page, pageSize);
  }

  @Get('candidates/:id/timeline')
  @RequirePermission('candidate:read')
  @AuditAction('candidate.timeline.read', 'Candidate')
  timeline(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.candidates.timeline(id, actor);
  }

  @Get('candidates/:id')
  @RequirePermission('candidate:read')
  @AuditAction('candidate.read', 'Candidate')
  get(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.candidates.get(id, actor);
  }

  @Post('candidates')
  @RequirePermission('candidate:create')
  @AuditAction('candidate.create', 'Candidate')
  create(@Body() body: unknown, @CurrentUser() actor: AuthenticatedUser) {
    return this.candidates.create(body, actor);
  }

  @Patch('candidates/:id/stage')
  @RequirePermission('candidate:stage:update')
  @AuditAction('candidate.stage.update', 'Candidate')
  updateStage(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.candidates.updateStage(id, body, actor);
  }

  @Get('jobs')
  @RequirePermission('job:read')
  @AuditAction('job.list', 'Job')
  listJobs(@CurrentUser() actor: AuthenticatedUser) {
    return this.candidates.listJobs(actor);
  }
}

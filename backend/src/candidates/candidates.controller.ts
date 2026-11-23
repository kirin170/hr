import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
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
    @Query('stage') stage?: string,
    @Query('keyword') keyword?: string,
    @Query('departmentId') departmentId?: string,
    @Query('jobId') jobId?: string,
    @Query('company') company?: string,
    @Query('channel') channel?: string,
    @Query('source') source?: string,
    @Query('tag') tag?: string,
    @Query('lockedState') lockedState?: string,
    @Query('updatedBefore') updatedBefore?: string,
    @Query('poolType') poolType?: string,
  ) {
    return this.candidates.listFiltered(actor, page, pageSize, {
      stage, keyword, departmentId, jobId, company, channel, source, tag, lockedState, updatedBefore, poolType,
    });
  }

  @Get('candidates/filters')
  @RequirePermission('candidate:read')
  @AuditAction('candidate.filters.read', 'Candidate')
  listFilters(@CurrentUser() actor: AuthenticatedUser) {
    return this.candidates.listSavedFilters(actor);
  }

  @Post('candidates/filters')
  @RequirePermission('candidate:read')
  @AuditAction('candidate.filters.save', 'Candidate')
  saveFilter(@Body() body: unknown, @CurrentUser() actor: AuthenticatedUser) {
    return this.candidates.saveFilter(body, actor);
  }

  @Post('candidates/batch/stage')
  @RequirePermission('candidate:stage:update')
  @AuditAction('candidate.stage.batch', 'Candidate')
  batchStage(@Body() body: unknown, @CurrentUser() actor: AuthenticatedUser) {
    return this.candidates.batchUpdateStage(body, actor);
  }

  @Post('candidates/batch/department-screening')
  @RequirePermission('candidate:stage:update')
  @AuditAction('candidate.department-screening.batch', 'Candidate')
  batchDepartmentScreening(@Body() body: unknown, @CurrentUser() actor: AuthenticatedUser) {
    return this.candidates.batchRecordDepartmentScreening(body, actor);
  }

  @Post('candidates/batch/tags')
  @RequirePermission('candidate:stage:update')
  @AuditAction('candidate.tags.batch', 'Candidate')
  batchTags(@Body() body: unknown, @CurrentUser() actor: AuthenticatedUser) {
    return this.candidates.batchUpdateTags(body, actor);
  }

  @Get('candidates/:id/timeline')
  @RequirePermission('candidate:read')
  @AuditAction('candidate.timeline.read', 'Candidate')
  timeline(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.candidates.timeline(id, actor);
  }

  @Get('candidates/:id/pool-history')
  @RequirePermission('candidate:read')
  @AuditAction('candidate.pool.history.read', 'Candidate')
  poolHistory(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.candidates.listPoolHistory(id, actor);
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

  @Post('candidates/:id/assign-job')
  @RequirePermission('candidate:stage:update')
  @AuditAction('candidate.job.assign', 'Candidate')
  assignJob(@Param('id') id: string, @Body() body: unknown, @CurrentUser() actor: AuthenticatedUser) {
    return this.candidates.assignJob(id, body, actor);
  }

  @Post('candidates/:id/activate')
  @RequirePermission('candidate:stage:update')
  @AuditAction('candidate.pool.activate', 'Candidate')
  activate(@Param('id') id: string, @Body() body: unknown, @CurrentUser() actor: AuthenticatedUser) {
    return this.candidates.activateFromPool(id, body, actor);
  }

  @Post('candidates/:id/department-screening')
  @RequirePermission('candidate:stage:update')
  @AuditAction('candidate.department-screening.record', 'Candidate')
  recordDepartmentScreening(@Param('id') id: string, @Body() body: unknown, @CurrentUser() actor: AuthenticatedUser) {
    return this.candidates.recordDepartmentScreening(id, body, actor);
  }

  @Patch('candidates/:id/lock')
  @RequirePermission('candidate:stage:update')
  @AuditAction('candidate.lock.update', 'Candidate')
  setLockedState(@Param('id') id: string, @Body() body: unknown, @CurrentUser() actor: AuthenticatedUser) {
    return this.candidates.setLockedState(id, body, actor);
  }

  @Post('candidates/:id/stage/undo')
  @RequirePermission('candidate:stage:update')
  @AuditAction('candidate.stage.undo', 'Candidate')
  undoStage(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.candidates.undoLatestStageChange(id, actor);
  }

  @Delete('candidates/filters/:id')
  @RequirePermission('candidate:read')
  @AuditAction('candidate.filters.delete', 'Candidate')
  deleteFilter(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.candidates.deleteSavedFilter(id, actor);
  }
}

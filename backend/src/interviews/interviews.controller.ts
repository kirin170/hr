import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { AuditAction, CurrentUser, PublicRoute, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { InterviewsService } from './interviews.service.js';

@Controller('interviews')
export class InterviewsController {
  constructor(private readonly service: InterviewsService) {}
  @Get() @RequirePermission('candidate:read') @AuditAction('interview.list', 'Interview')
  list(@CurrentUser() actor: AuthenticatedUser, @Query() query: { candidateId?: string; jobId?: string; status?: string; keyword?: string }) { return this.service.list(actor, query); }
  @Get('registration/template') @RequirePermission('candidate:read') @AuditAction('interview.registration.template.read', 'Interview')
  template(@CurrentUser() actor: AuthenticatedUser) { return this.service.registrationTemplate(actor); }
  @Post('registration/template') @RequirePermission('candidate:stage:update') @AuditAction('interview.registration.template.write', 'Interview')
  saveTemplate(@Body() body: unknown, @CurrentUser() actor: AuthenticatedUser) { return this.service.saveRegistrationTemplate(body, actor); }
  @Get('interviewers') @RequirePermission('candidate:stage:update') @AuditAction('interview.interviewers', 'User')
  interviewers(@CurrentUser() actor: AuthenticatedUser) { return this.service.interviewers(actor); }
  @Get('availability/:candidateId') @RequirePermission('candidate:read') @AuditAction('interview.availability', 'Candidate')
  availability(@Param('candidateId') id: string, @CurrentUser() actor: AuthenticatedUser) { return this.service.availability(id, actor); }
  @Post() @RequirePermission('candidate:stage:update') @AuditAction('interview.create', 'Interview')
  create(@Body() body: unknown, @CurrentUser() actor: AuthenticatedUser) { return this.service.create(body, actor); }
  @Get(':id/history') @RequirePermission('candidate:read') @AuditAction('interview.history', 'Interview')
  history(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) { return this.service.history(id, actor); }
  @Get(':id/mock-notifications') @RequirePermission('candidate:stage:update') @AuditAction('interview.mock.notifications', 'Interview')
  mockNotifications(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) { return this.service.mockNotifications(id, actor); }
  @Post(':id/change') @RequirePermission('candidate:stage:update') @AuditAction('interview.change', 'Interview')
  change(@Param('id') id: string, @Body() body: unknown, @CurrentUser() actor: AuthenticatedUser) { return this.service.change(id, body, actor); }
  @Post(':id/response') @RequirePermission('candidate:read') @AuditAction('interview.response', 'Interview')
  response(@Param('id') id: string, @Body() body: unknown, @CurrentUser() actor: AuthenticatedUser) { return this.service.respond(id, body, actor); }
  @Get(':id/feedback') @RequirePermission('candidate:read') @AuditAction('interview.feedback.list', 'Interview')
  feedback(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) { return this.service.feedback(id, actor); }
  @Post(':id/feedback') @RequirePermission('candidate:read') @AuditAction('interview.feedback.create', 'Interview')
  addFeedback(@Param('id') id: string, @Body() body: unknown, @CurrentUser() actor: AuthenticatedUser) { return this.service.addFeedback(id, body, actor); }
  @Get(':id/transcripts') @RequirePermission('candidate:read') @AuditAction('interview.transcripts.list', 'Interview')
  transcripts(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) { return this.service.transcripts(id, actor); }
  @Post(':id/transcripts') @RequirePermission('candidate:stage:update') @AuditAction('interview.transcripts.create', 'Interview')
  addTranscript(@Param('id') id: string, @Body() body: unknown, @CurrentUser() actor: AuthenticatedUser) { return this.service.addTranscript(id, body, actor); }
  @Get(':id/registration') @RequirePermission('candidate:read') @AuditAction('interview.registration.list', 'Interview')
  registration(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) { return this.service.registration(id, actor); }
  @Post(':id/registration') @RequirePermission('candidate:stage:update') @AuditAction('interview.registration.create', 'Interview')
  submitRegistration(@Param('id') id: string, @Body() body: unknown, @CurrentUser() actor: AuthenticatedUser) { return this.service.submitRegistration(id, body, actor); }

  @Post(':id/registration-invite') @RequirePermission('candidate:stage:update') @AuditAction('interview.registration.invite', 'Interview')
  invite(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) { return this.service.inviteRegistration(id, actor); }
  }

@Controller('interview-registration')
export class InterviewRegistrationController {
  constructor(private readonly service: InterviewsService) {}
  @Post('open') @PublicRoute()
  publicRegistration(@Body() body: { token?: string }) { return this.service.publicRegistration(body?.token ?? ''); }
  @Post('submit') @PublicRoute()
  publicSubmit(@Body() body: { token?: string; values?: unknown }) { return this.service.publicSubmitRegistration(body?.token ?? '', body); }
}

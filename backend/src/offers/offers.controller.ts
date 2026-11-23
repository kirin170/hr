import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { AuditAction, CurrentUser, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { OffersService } from './offers.service.js';
@Controller('api/v1')
export class OffersController {
  constructor(private readonly offers: OffersService) {}
  @Get('offer-reasons') @RequirePermission('candidate:stage:update') reasons(@CurrentUser() actor: AuthenticatedUser) { return this.offers.reasons(actor); }
  @Get('candidates/:id/offer') @RequirePermission('candidate:stage:update') async read(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) { return { offer: await this.offers.read(id, actor) }; }
  @Get('candidates/:id/offer/preview') @RequirePermission('candidate:stage:update') preview(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) { return this.offers.preview(id, actor); }
  @Post('candidates/:id/offer') @RequirePermission('candidate:stage:update') @AuditAction('offer.create', 'Candidate') create(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) { return this.offers.create(id, actor); }
  @Patch('candidates/:id/offer') @RequirePermission('candidate:stage:update') @AuditAction('offer.update', 'Candidate') update(@Param('id') id: string, @Body() body: unknown, @CurrentUser() actor: AuthenticatedUser) { return this.offers.update(id, body, actor); }
}

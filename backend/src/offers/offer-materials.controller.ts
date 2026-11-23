import { Body, Controller, Get, Param, Post, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuditAction, CurrentUser, RequirePermission } from '../auth/auth.decorators.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedRequest, AuthenticatedUser } from '../auth/auth.types.js';
import { resumeMaxBytes } from '../storage/upload-validation.js';
import { OfferMaterialsService, type UploadedOfferMaterial } from './offer-materials.service.js';
@Controller('api/v1/candidates/:id/offer/materials')
export class OfferMaterialsController {
  constructor(private readonly materials: OfferMaterialsService, private readonly audit: AuditService) {}
  @Get() @RequirePermission('candidate:read') list(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) { return this.materials.list(id, actor); }
  @Post() @RequirePermission('candidate:stage:update') @AuditAction('offer.material_upload', 'Candidate') @UseInterceptors(FileInterceptor('file', { limits: { fileSize: resumeMaxBytes() } }))
  upload(@Param('id') id: string, @Body('category') category: string, @UploadedFile() file: UploadedOfferMaterial | undefined, @CurrentUser() actor: AuthenticatedUser) { return this.materials.upload(id, category, file, actor); }
  @Get(':fileId/read-url') @RequirePermission('candidate:read') read(@Param('id') id: string, @Param('fileId') fileId: string, @CurrentUser() actor: AuthenticatedUser, @Req() req: AuthenticatedRequest) { return this.materials.readUrl(id, fileId, actor, { requestId: this.audit.requestId(req), ip: req.ip, userAgent: req.headers['user-agent'] }); }
}

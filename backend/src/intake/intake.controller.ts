import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { AuditAction, CurrentUser, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { FilesInterceptor } from '@nestjs/platform-express';
import { resumeMaxBytes } from '../storage/upload-validation.js';
import { IntakeService } from './intake.service.js';
import type {
  EmailIntakeBody,
  ManualIntakeBody,
  UploadIntakeBody,
  UploadedResumeFile,
} from './intake.service.js';

/** 传输层保护（进程环境变量在模块加载时读取）；业务侧限制由统一上传校验按配置再校验一次。 */
const MAX_RESUME_BYTES = resumeMaxBytes();

@Controller('api/v1/intake')
export class IntakeController {
  constructor(private readonly intake: IntakeService) {}

  @Post('upload')
  @RequirePermission('intake:manage')
  @AuditAction('intake.upload', 'ResumeIntake')
  @UseInterceptors(
    FilesInterceptor('files', 20, { limits: { fileSize: MAX_RESUME_BYTES } }),
  )
  async upload(
    @UploadedFiles() files: UploadedResumeFile[],
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: UploadIntakeBody = {},
  ) {
    return this.intake.ingestUploads(files ?? [], { ...body, actorId: actor.id });
  }

  @Post('manual')
  @RequirePermission('intake:manage')
  @AuditAction('intake.manual', 'ResumeIntake')
  async manual(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: ManualIntakeBody = {},
  ) {
    return this.intake.ingestManual({ ...body, actorId: actor.id });
  }

  @Post('email/mock')
  @RequirePermission('intake:manage')
  @AuditAction('intake.email_mock', 'ResumeIntake')
  async emailMock(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: EmailIntakeBody = {},
  ) {
    return this.intake.ingestEmailMock({ ...body, actorId: actor.id });
  }

  @Post(':id/assign-job')
  @RequirePermission('intake:manage')
  @AuditAction('intake.assign_job', 'ResumeIntake')
  async assignJob(
    @Param('id') id: string,
    @Body() body: { jobId?: string },
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.intake.assignJob(id, body?.jobId ?? '', actor.id);
  }

  @Post(':id/retry')
  @RequirePermission('intake:manage')
  @AuditAction('intake.retry', 'ResumeIntake')
  async retry(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: { mockOutcome?: 'SUCCESS' | 'FAIL' } = {},
  ) {
    return this.intake.retry(id, actor.id, body?.mockOutcome);
  }

  @Get()
  @RequirePermission('intake:read')
  @AuditAction('intake.list', 'ResumeIntake')
  async list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query('status') status?: string,
    @Query('entryMode') entryMode?: string,
    @Query('limit') limit?: string,
  ) {
    return this.intake.list({ status, entryMode, limit: Number(limit ?? 20) }, actor);
  }

  @Get(':id')
  @RequirePermission('intake:read')
  @AuditAction('intake.read', 'ResumeIntake')
  async detail(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.intake.get(id, actor);
  }
}

import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  AuditAction,
  CurrentUser,
  PublicRoute,
  RequirePermission,
} from '../auth/auth.decorators.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { resumeMaxBytes } from '../storage/upload-validation.js';
import { IntakeService } from './intake.service.js';
import type { CampusApplyBody, UploadedResumeFile } from './intake.service.js';

/** 门户附件传输层上限，业务侧由统一上传校验再校验一次 */
const MAX_RESUME_BYTES = resumeMaxBytes();

/**
 * 校园招聘投递门户（功能需求 §4.9）。
 * 职位列表与投递为公开路由，HR 查询与批量人工分配需要入场权限。
 */
@Controller('api/v1/campus')
export class CampusController {
  constructor(private readonly intake: IntakeService) {}

  @Get('jobs')
  @PublicRoute()
  @AuditAction('campus.jobs', 'Job')
  async jobs() {
    return this.intake.listCampusJobs();
  }

  @Post('applications')
  @PublicRoute()
  @AuditAction('campus.apply', 'CampusApplication')
  @UseInterceptors(FileInterceptor('resume', { limits: { fileSize: MAX_RESUME_BYTES } }))
  async apply(
    @Body() body: CampusApplyBody = {},
    @UploadedFile() file?: UploadedResumeFile,
  ) {
    return this.intake.campusApply(body, file);
  }

  @Get('applications')
  @RequirePermission('intake:read')
  @AuditAction('campus.applications', 'CampusApplication')
  async list(
    @CurrentUser() actor: AuthenticatedUser,
    @Query('status') status?: string,
    @Query('jobId') jobId?: string,
    @Query('keyword') keyword?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.intake.listCampusApplications(
      {
        status,
        jobId,
        keyword,
        page: Number(page ?? 1),
        pageSize: Number(pageSize ?? 20),
      },
      actor,
    );
  }

  @Post('applications/batch-assign')
  @RequirePermission('intake:manage')
  @AuditAction('campus.batch_assign', 'CampusApplication')
  async batchAssign(
    @Body() body: { applicationIds?: string[]; jobId?: string },
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.intake.assignCampusApplications(
      body?.applicationIds ?? [],
      body?.jobId ?? '',
      actor.id,
    );
  }
}

import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuditAction, CurrentUser, RequirePermission } from '../auth/auth.decorators.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { resumeMaxBytes } from '../storage/upload-validation.js';
import { IntakeService } from './intake.service.js';
import type {
  EmailIntakeBody,
  ManualIntakeBody,
  SourceInputBody,
  UploadIntakeBody,
  UploadedResumeFile,
} from './intake.service.js';

/** 传输层保护（进程环境变量在模块加载时读取）；业务侧限制由统一上传校验按配置再校验一次。 */
const MAX_RESUME_BYTES = resumeMaxBytes();
/** Excel 批量导入文件上限，与行数上限一起防止超大文件占用内存 */
const MAX_EXCEL_BYTES = 10 * 1024 * 1024;

const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

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
    const appEnv = (process.env.APP_ENV ?? '').trim().toLowerCase();
    const isAllowed =
      appEnv === 'local' || appEnv === 'test' || (!appEnv && process.env.NODE_ENV === 'test');
    if (!isAllowed) {
      throw new ForbiddenException('仅本地或测试环境允许使用模拟邮箱入场');
    }
    return this.intake.ingestEmailMock({ ...body, actorId: actor.id });
  }

  // ---------- Excel 批量导入（独立表格导入，不进入 AI 解析管道） ----------

  @Get('excel/template')
  @RequirePermission('intake:read')
  @AuditAction('intake.excel_template', 'ResumeIntake')
  async excelTemplate(@Res({ passthrough: true }) res: Response) {
    const buffer = await this.intake.excelTemplate();
    res.set({
      'Content-Type': XLSX_MIME,
      'Content-Disposition': 'attachment; filename="resume-import-template.xlsx"',
    });
    return new StreamableFile(buffer);
  }

  @Post('excel/import')
  @RequirePermission('intake:manage')
  @AuditAction('intake.excel_import', 'ResumeIntake')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_EXCEL_BYTES } }))
  async excelImport(
    @UploadedFile() file: UploadedResumeFile | undefined,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.intake.importExcel(file, actor.id);
  }

  @Get('excel/batches/:batchId')
  @RequirePermission('intake:read')
  @AuditAction('intake.excel_batch', 'ResumeIntake')
  async excelBatch(
    @Param('batchId') batchId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.intake.getExcelBatch(batchId, actor);
  }

  @Get('excel/batches/:batchId/failed-rows')
  @RequirePermission('intake:read')
  @AuditAction('intake.excel_failed_export', 'ResumeIntake')
  async excelFailedRows(
    @Param('batchId') batchId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    const buffer = await this.intake.exportExcelFailedRows(batchId, actor);
    res.set({
      'Content-Type': XLSX_MIME,
      'Content-Disposition': `attachment; filename="resume-import-failed-${batchId}.xlsx"`,
    });
    return new StreamableFile(buffer);
  }

  // ---------- 待分配池与监控 ----------

  @Get('monitor')
  @RequirePermission('intake:read')
  @AuditAction('intake.monitor', 'ResumeIntake')
  async monitor(
    @CurrentUser() actor: AuthenticatedUser,
    @Query('jobId') jobId?: string,
    @Query('mailbox') mailbox?: string,
    @Query('entryMode') entryMode?: string,
    @Query('source') source?: string,
    @Query('receivedFrom') receivedFrom?: string,
    @Query('receivedTo') receivedTo?: string,
  ) {
    return this.intake.monitor(
      { jobId, mailbox, entryMode, source, receivedFrom, receivedTo },
      actor,
    );
  }

  @Get('pool')
  @RequirePermission('intake:read')
  @AuditAction('intake.pool', 'ResumeIntake')
  async pool(
    @CurrentUser() actor: AuthenticatedUser,
    @Query('keyword') keyword?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.intake.listPool(
      { keyword, page: Number(page ?? 1), pageSize: Number(pageSize ?? 20) },
      actor,
    );
  }

  @Get('duplicates')
  @RequirePermission('intake:read')
  @AuditAction('intake.duplicates', 'ResumeIntake')
  async duplicates(
    @CurrentUser() actor: AuthenticatedUser,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.intake.listDuplicates(
      { page: Number(page ?? 1), pageSize: Number(pageSize ?? 20) },
      actor,
    );
  }

  @Get('mailboxes')
  @RequirePermission('intake:read')
  @AuditAction('intake.mailboxes', 'MailInboxConfig')
  async mailboxes() {
    return this.intake.listMailboxes();
  }

  // ---------- 来源记录（FR-REF-1～3） ----------

  @Get('sources')
  @RequirePermission('intake:read')
  @AuditAction('intake.sources', 'CandidateSourceRecord')
  async sources(
    @CurrentUser() actor: AuthenticatedUser,
    @Query('source') source?: string,
    @Query('referrer') referrer?: string,
    @Query('candidateId') candidateId?: string,
    @Query('jobId') jobId?: string,
    @Query('createdFrom') createdFrom?: string,
    @Query('createdTo') createdTo?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.intake.listSources(
      {
        source,
        referrer,
        candidateId,
        jobId,
        createdFrom,
        createdTo,
        page: Number(page ?? 1),
        pageSize: Number(pageSize ?? 20),
      },
      actor,
    );
  }

  @Patch('sources/:id')
  @RequirePermission('intake:manage')
  @AuditAction('intake.source_update', 'CandidateSourceRecord')
  async updateSource(
    @Param('id') id: string,
    @Body() body: SourceInputBody = {},
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.intake.updateSourceRecord(id, body, actor);
  }

  @Post('batch-assign-job')
  @RequirePermission('intake:manage')
  @AuditAction('intake.batch_assign_job', 'ResumeIntake')
  async batchAssignJob(
    @Body() body: { intakeIds?: string[]; jobId?: string },
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.intake.assignJobs(body?.intakeIds ?? [], body?.jobId ?? '', actor.id);
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

  @Post(':id/merge')
  @RequirePermission('intake:manage')
  @AuditAction('intake.merge_duplicate', 'ResumeIntake')
  async mergeDuplicate(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.intake.mergeDuplicate(id, actor.id);
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
    @Query('source') source?: string,
    @Query('jobId') jobId?: string,
    @Query('mailbox') mailbox?: string,
    @Query('createdFrom') createdFrom?: string,
    @Query('createdTo') createdTo?: string,
    @Query('receivedFrom') receivedFrom?: string,
    @Query('receivedTo') receivedTo?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('limit') limit?: string,
  ) {
    return this.intake.list(
      {
        status,
        entryMode,
        source,
        jobId,
        mailbox,
        createdFrom,
        createdTo,
        receivedFrom,
        receivedTo,
        page: Number(page ?? 1),
        pageSize: Number(pageSize ?? limit ?? 20),
      },
      actor,
    );
  }

  @Get(':id')
  @RequirePermission('intake:read')
  @AuditAction('intake.read', 'ResumeIntake')
  async detail(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.intake.get(id, actor);
  }
}

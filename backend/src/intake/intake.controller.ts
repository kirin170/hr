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
import { FilesInterceptor } from '@nestjs/platform-express';
import { IntakeService } from './intake.service.js';
import type {
  EmailIntakeBody,
  ManualIntakeBody,
  UploadIntakeBody,
  UploadedResumeFile,
} from './intake.service.js';

const MAX_RESUME_BYTES = Number(process.env.RESUME_MAX_MB ?? 20) * 1024 * 1024;

@Controller('api/v1/intake')
export class IntakeController {
  constructor(private readonly intake: IntakeService) {}

  @Post('upload')
  @UseInterceptors(
    FilesInterceptor('files', 20, { limits: { fileSize: MAX_RESUME_BYTES } }),
  )
  async upload(
    @UploadedFiles() files: UploadedResumeFile[],
    @Body() body: UploadIntakeBody,
  ) {
    return this.intake.ingestUploads(files ?? [], body ?? {});
  }

  @Post('manual')
  async manual(@Body() body: ManualIntakeBody) {
    return this.intake.ingestManual(body ?? {});
  }

  @Post('email/mock')
  async emailMock(@Body() body: EmailIntakeBody) {
    return this.intake.ingestEmailMock(body ?? {});
  }

  @Post(':id/assign-job')
  async assignJob(
    @Param('id') id: string,
    @Body() body: { jobId?: string; actorId?: string },
  ) {
    return this.intake.assignJob(id, body?.jobId ?? '', body?.actorId);
  }

  @Post(':id/retry')
  async retry(
    @Param('id') id: string,
    @Body() body: { actorId?: string; mockOutcome?: 'SUCCESS' | 'FAIL' } = {},
  ) {
    return this.intake.retry(id, body?.actorId, body?.mockOutcome);
  }

  @Get()
  async list(
    @Query('status') status?: string,
    @Query('entryMode') entryMode?: string,
    @Query('limit') limit?: string,
  ) {
    return this.intake.list({ status, entryMode, limit: Number(limit ?? 20) });
  }

  @Get(':id')
  async detail(@Param('id') id: string) {
    return this.intake.get(id);
  }
}

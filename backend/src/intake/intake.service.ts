import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AiRunStatus,
  AiRunType,
  CandidateStage,
  IntakeStatus,
  PoolType,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import type { MockOutcome } from '../ai/ai.types.js';
import { ParseQueueService } from '../ai/parse.queue.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { LocalStorageService } from '../storage/local-storage.service.js';
import { TimelineService } from '../timeline/timeline.service.js';
import {
  isSupportedResumeFile,
  normalizeEmail,
  normalizePhone,
} from './dedup.util.js';
import {
  ALLOWED_ENTRY_MODES,
  ALLOWED_SOURCES,
  ENTRY_MODE,
  INTAKE_SOURCE,
} from './intake.constants.js';

export interface UploadedResumeFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

export interface UploadIntakeBody {
  jobId?: string;
  intentId?: string;
  source?: string;
  entryMode?: string;
  mockOutcome?: MockOutcome;
  actorId?: string;
}

export interface ManualIntakeBody {
  name?: string;
  phone?: string;
  email?: string;
  jobId?: string;
  intentId?: string;
  source?: string;
  actorId?: string;
}

export interface EmailAttachmentBody {
  fileName?: string;
  mimeType?: string;
  contentBase64?: string;
}

export interface EmailIntakeBody {
  mailboxAddress?: string;
  from?: string;
  subject?: string;
  receivedAt?: string;
  jobId?: string;
  mockOutcome?: MockOutcome;
  attachments?: EmailAttachmentBody[];
  actorId?: string;
}

export interface IntakeResult {
  intakeId: string;
  candidateId: string | null;
  airRunId: string | null;
  status: IntakeStatus;
  duplicate: boolean;
  parseQueued: boolean;
}

@Injectable()
export class IntakeService {
  private readonly logger = new Logger(IntakeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly timeline: TimelineService,
    private readonly storage: LocalStorageService,
    private readonly queue: ParseQueueService,
  ) {}

  /** 批量上传 / 单个上传（FR-ENT-3） */
  async ingestUploads(
    files: UploadedResumeFile[],
    body: UploadIntakeBody,
  ): Promise<IntakeResult[]> {
    if (!files || files.length === 0) {
      throw new BadRequestException('At least one resume file is required');
    }

    const entryMode =
      body.entryMode ??
      (files.length > 1 ? ENTRY_MODE.BATCH_UPLOAD : ENTRY_MODE.SINGLE_UPLOAD);
    this.assertEntryMode(entryMode);
    const source = body.source ?? INTAKE_SOURCE.UPLOAD;
    this.assertSource(source);
    const jobId = body.jobId?.trim() || null;
    if (jobId) {
      await this.assertJobExists(jobId);
    }

    const results: IntakeResult[] = [];
    for (const file of files) {
      if (!isSupportedResumeFile(file.originalname)) {
        results.push(
          await this.recordRejectedFile(file, {
            source,
            entryMode,
            jobId,
            errorCode: 'UNSUPPORTED_FORMAT',
            errorMessage: `Unsupported resume format: ${file.originalname}`,
          }),
        );
        continue;
      }

      const sha256 = createHash('sha256').update(file.buffer).digest('hex');
      results.push(
        await this.createFileIntake({
          file,
          sha256,
          source,
          entryMode,
          jobId,
          intentId: body.intentId ?? null,
          mockOutcome: body.mockOutcome,
        }),
      );
    }

    return results;
  }

  /** 手工录入（FR-ENT-3）：直接产生候选人或待分配池记录 */
  async ingestManual(body: ManualIntakeBody): Promise<IntakeResult> {
    const name = body.name?.trim();
    if (!name) {
      throw new BadRequestException('name is required');
    }

    const phone = normalizePhone(body.phone);
    const email = normalizeEmail(body.email);
    if (!phone && !email) {
      throw new BadRequestException('phone or email is required for dedup');
    }

    const source = body.source ?? INTAKE_SOURCE.MANUAL;
    this.assertSource(source);
    const jobId = body.jobId?.trim() || null;
    if (jobId) {
      await this.assertJobExists(jobId);
    }

    const duplicate = await this.findDuplicateCandidate(phone, email);
    if (duplicate) {
      const intake = await this.prisma.resumeIntake.create({
        data: {
          source,
          entryMode: ENTRY_MODE.MANUAL,
          status: IntakeStatus.DUPLICATE,
          duplicateOfCandidateId: duplicate.id,
          jobId,
          intentId: body.intentId ?? null,
        },
      });
      await this.timeline.record({
        entityType: 'ResumeIntake',
        entityId: intake.id,
        action: 'intake.duplicate',
        actorId: body.actorId ?? null,
        payload: { candidateId: duplicate.id, entryMode: ENTRY_MODE.MANUAL },
      });
      return {
        intakeId: intake.id,
        candidateId: duplicate.id,
        airRunId: null,
        status: intake.status,
        duplicate: true,
        parseQueued: false,
      };
    }

    const candidate = await this.prisma.candidate.create({
      data: {
        name,
        phone,
        email,
        jobId,
        poolType: jobId ? PoolType.NONE : PoolType.UNASSIGNED,
        stage: jobId ? CandidateStage.RECOMMENDED : CandidateStage.UNASSIGNED,
        source,
        entryMode: ENTRY_MODE.MANUAL,
        intentId: body.intentId ?? null,
        appliedAt: new Date(),
      },
    });

    const intake = await this.prisma.resumeIntake.create({
      data: {
        source,
        entryMode: ENTRY_MODE.MANUAL,
        status: IntakeStatus.PARSED,
        candidateId: candidate.id,
        jobId,
        intentId: body.intentId ?? null,
      },
    });

    await this.timeline.record({
      entityType: 'Candidate',
      entityId: candidate.id,
      action: 'candidate.entered',
      actorId: body.actorId ?? null,
      payload: {
        intakeId: intake.id,
        source,
        entryMode: ENTRY_MODE.MANUAL,
        jobId,
      },
    });

    return {
      intakeId: intake.id,
      candidateId: candidate.id,
      airRunId: null,
      status: intake.status,
      duplicate: false,
      parseQueued: false,
    };
  }

  /** 邮箱自动获取（Mock）：附件入库 → 默认待分配池 → 触发解析（FR-ENT-1/FR-ENT-10） */
  async ingestEmailMock(body: EmailIntakeBody): Promise<IntakeResult[]> {
    const attachments = body.attachments ?? [];
    if (attachments.length === 0) {
      throw new BadRequestException('At least one attachment is required');
    }

    if (body.mailboxAddress?.trim()) {
      await this.prisma.mailInboxConfig.upsert({
        where: { address: body.mailboxAddress.trim().toLowerCase() },
        create: {
          address: body.mailboxAddress.trim().toLowerCase(),
          provider: 'MOCK',
          lastPolledAt: new Date(),
        },
        update: { lastPolledAt: new Date() },
      });
    }

    const jobId = body.jobId?.trim() || null;
    if (jobId) {
      await this.assertJobExists(jobId);
    }
    const receivedAt = body.receivedAt ? new Date(body.receivedAt) : new Date();
    if (Number.isNaN(receivedAt.getTime())) {
      throw new BadRequestException('receivedAt is invalid');
    }

    const results: IntakeResult[] = [];
    for (const attachment of attachments) {
      const fileName = attachment.fileName?.trim();
      if (!fileName || !attachment.contentBase64) {
        throw new BadRequestException(
          'attachment.fileName and attachment.contentBase64 are required',
        );
      }

      const buffer = Buffer.from(attachment.contentBase64, 'base64');
      if (buffer.length === 0) {
        throw new BadRequestException(`Attachment ${fileName} is empty`);
      }

      const file: UploadedResumeFile = {
        originalname: fileName,
        mimetype: attachment.mimeType ?? 'application/octet-stream',
        size: buffer.length,
        buffer,
      };

      if (!isSupportedResumeFile(fileName)) {
        results.push(
          await this.recordRejectedFile(file, {
            source: INTAKE_SOURCE.EMAIL,
            entryMode: ENTRY_MODE.EMAIL_AUTO,
            jobId,
            errorCode: 'UNSUPPORTED_FORMAT',
            errorMessage: `Unsupported resume format: ${fileName}`,
            mailFrom: body.from ?? null,
            mailSubject: body.subject ?? null,
            receivedAt,
          }),
        );
        continue;
      }

      const sha256 = createHash('sha256').update(buffer).digest('hex');
      results.push(
        await this.createFileIntake({
          file,
          sha256,
          source: INTAKE_SOURCE.EMAIL,
          entryMode: ENTRY_MODE.EMAIL_AUTO,
          jobId,
          intentId: null,
          mockOutcome: body.mockOutcome,
          mail: {
            from: body.from ?? null,
            subject: body.subject ?? null,
            receivedAt,
          },
        }),
      );
    }

    return results;
  }

  /** 分配职位：只选职位，负责人由职位带出（FR-ENT-5） */
  async assignJob(intakeId: string, jobId: string, actorId?: string) {
    const targetJobId = jobId?.trim();
    if (!targetJobId) {
      throw new BadRequestException('jobId is required');
    }
    await this.assertJobExists(targetJobId);

    const intake = await this.prisma.resumeIntake.findUnique({
      where: { id: intakeId },
    });
    if (!intake) {
      throw new NotFoundException(`Intake ${intakeId} not found`);
    }
    if (!intake.candidateId) {
      throw new BadRequestException(`Intake ${intakeId} has no candidate`);
    }

    const [candidate] = await this.prisma.$transaction([
      this.prisma.candidate.update({
        where: { id: intake.candidateId },
        data: {
          jobId: targetJobId,
          poolType: PoolType.NONE,
          stage: CandidateStage.RECOMMENDED,
        },
      }),
      this.prisma.resumeIntake.update({
        where: { id: intake.id },
        data: { jobId: targetJobId },
      }),
    ]);

    await this.timeline.record({
      entityType: 'Candidate',
      entityId: candidate.id,
      action: 'candidate.job_assigned',
      actorId: actorId ?? null,
      payload: { intakeId: intake.id, jobId: targetJobId },
    });

    return { intakeId: intake.id, candidateId: candidate.id, jobId: targetJobId };
  }

  /** 解析失败后重试（可 Mock 成功/失败，重试不产生重复候选人） */
  async retry(intakeId: string, actorId?: string, mockOutcome?: MockOutcome) {
    const intake = await this.prisma.resumeIntake.findUnique({
      where: { id: intakeId },
    });
    if (!intake) {
      throw new NotFoundException(`Intake ${intakeId} not found`);
    }
    if (!intake.airRunId) {
      throw new BadRequestException(`Intake ${intakeId} has no AI run`);
    }
    if (intake.status === IntakeStatus.PARSED) {
      throw new BadRequestException(`Intake ${intakeId} is already parsed`);
    }

    const run = await this.prisma.aIRun.findUnique({
      where: { id: intake.airRunId },
    });
    if (!run) {
      throw new NotFoundException(`AI run ${intake.airRunId} not found`);
    }

    let inputRefs = run.inputRefs;
    if (mockOutcome) {
      const input = JSON.parse(run.inputRefs ?? '{}') as Record<string, unknown>;
      input.mockOutcome = mockOutcome;
      inputRefs = JSON.stringify(input);
    }

    await this.prisma.$transaction([
      this.prisma.aIRun.update({
        where: { id: intake.airRunId },
        data: {
          status: AiRunStatus.PENDING,
          attempts: 0,
          errorCode: null,
          errorMessage: null,
          inputRefs,
        },
      }),
      this.prisma.resumeIntake.update({
        where: { id: intake.id },
        data: {
          status: IntakeStatus.RECEIVED,
          attempts: 0,
          errorCode: null,
          errorMessage: null,
        },
      }),
    ]);

    const parseQueued = await this.queue.enqueue(intake.id, intake.airRunId, {
      retry: true,
    });

    await this.timeline.record({
      entityType: 'ResumeIntake',
      entityId: intake.id,
      action: 'intake.retry_requested',
      actorId: actorId ?? null,
      payload: { airRunId: intake.airRunId, parseQueued, mockOutcome },
    });

    return { intakeId: intake.id, airRunId: intake.airRunId, parseQueued };
  }

  async list(query: {
    status?: string;
    entryMode?: string;
    limit?: number;
  }) {
    const limit = Math.min(Math.max(Number(query.limit ?? 20), 1), 100);
    return this.prisma.resumeIntake.findMany({
      where: {
        status: query.status
          ? (query.status as IntakeStatus)
          : undefined,
        entryMode: query.entryMode || undefined,
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async get(intakeId: string) {
    const intake = await this.prisma.resumeIntake.findUnique({
      where: { id: intakeId },
      include: { resumeFile: true },
    });
    if (!intake) {
      throw new NotFoundException(`Intake ${intakeId} not found`);
    }
    const [candidate, airRun] = await Promise.all([
      intake.candidateId
        ? this.prisma.candidate.findUnique({ where: { id: intake.candidateId } })
        : null,
      intake.airRunId
        ? this.prisma.aIRun.findUnique({ where: { id: intake.airRunId } })
        : null,
    ]);
    return { intake, candidate, airRun };
  }

  private async createFileIntake(params: {
    file: UploadedResumeFile;
    sha256: string;
    source: string;
    entryMode: string;
    jobId: string | null;
    intentId: string | null;
    mockOutcome?: MockOutcome;
    mail?: { from: string | null; subject: string | null; receivedAt: Date };
  }): Promise<IntakeResult> {
    const { file, sha256, source, entryMode, jobId, intentId } = params;

    const existingFile = await this.prisma.resumeFile.findUnique({
      where: { sha256 },
      include: {
        intakes: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });

    if (existingFile) {
      const previous = existingFile.intakes[0] ?? null;
      const intake = await this.prisma.resumeIntake.create({
        data: {
          source,
          entryMode,
          status: IntakeStatus.DUPLICATE,
          resumeFileId: existingFile.id,
          duplicateOfCandidateId: previous?.candidateId ?? null,
          jobId,
          intentId,
          mailFrom: params.mail?.from ?? null,
          mailSubject: params.mail?.subject ?? null,
          receivedAt: params.mail?.receivedAt ?? null,
        },
      });
      await this.timeline.record({
        entityType: 'ResumeIntake',
        entityId: intake.id,
        action: 'intake.duplicate',
        payload: {
          sha256,
          resumeFileId: existingFile.id,
          candidateId: previous?.candidateId ?? null,
          entryMode,
        },
      });
      return {
        intakeId: intake.id,
        candidateId: previous?.candidateId ?? null,
        airRunId: null,
        status: intake.status,
        duplicate: true,
        parseQueued: false,
      };
    }

    const storageKey = await this.storage.putObject(
      sha256,
      file.originalname,
      file.buffer,
    );

    const created = await this.prisma.$transaction(async (tx) => {
      const resumeFile = await tx.resumeFile.create({
        data: {
          sha256,
          fileName: file.originalname,
          mimeType: file.mimetype,
          size: file.size,
          storageKey,
        },
      });

      const candidate = await tx.candidate.create({
        data: {
          name: '待解析候选人',
          jobId,
          poolType: jobId ? PoolType.NONE : PoolType.UNASSIGNED,
          stage: jobId ? CandidateStage.RECOMMENDED : CandidateStage.UNASSIGNED,
          source,
          entryMode,
          intentId,
          appliedAt: new Date(),
        },
      });

      const intake = await tx.resumeIntake.create({
        data: {
          source,
          entryMode,
          status: IntakeStatus.RECEIVED,
          candidateId: candidate.id,
          jobId,
          intentId,
          resumeFileId: resumeFile.id,
          mailFrom: params.mail?.from ?? null,
          mailSubject: params.mail?.subject ?? null,
          receivedAt: params.mail?.receivedAt ?? null,
        },
      });

      const airRun = await tx.aIRun.create({
        data: {
          type: AiRunType.RESUME_PARSE,
          status: AiRunStatus.PENDING,
          isDraft: true,
          inputRefs: JSON.stringify({
            intakeId: intake.id,
            resumeFileId: resumeFile.id,
            fileName: file.originalname,
            mimeType: file.mimetype,
            jobId,
            mockOutcome: params.mockOutcome,
          }),
        },
      });

      const updatedIntake = await tx.resumeIntake.update({
        where: { id: intake.id },
        data: { airRunId: airRun.id },
      });

      return { intake: updatedIntake, candidate, airRun };
    });

    const parseQueued = await this.queue.enqueue(
      created.intake.id,
      created.airRun.id,
    );

    await this.timeline.record({
      entityType: 'Candidate',
      entityId: created.candidate.id,
      action: 'candidate.entered',
      payload: {
        intakeId: created.intake.id,
        airRunId: created.airRun.id,
        source,
        entryMode,
        jobId,
        parseQueued,
      },
    });

    return {
      intakeId: created.intake.id,
      candidateId: created.candidate.id,
      airRunId: created.airRun.id,
      status: created.intake.status,
      duplicate: false,
      parseQueued,
    };
  }

  private async recordRejectedFile(
    file: UploadedResumeFile,
    params: {
      source: string;
      entryMode: string;
      jobId: string | null;
      errorCode: string;
      errorMessage: string;
      mailFrom?: string | null;
      mailSubject?: string | null;
      receivedAt?: Date;
    },
  ): Promise<IntakeResult> {
    const intake = await this.prisma.resumeIntake.create({
      data: {
        source: params.source,
        entryMode: params.entryMode,
        status: IntakeStatus.FAILED,
        jobId: params.jobId,
        errorCode: params.errorCode,
        errorMessage: params.errorMessage,
        mailFrom: params.mailFrom ?? null,
        mailSubject: params.mailSubject ?? null,
        receivedAt: params.receivedAt ?? null,
      },
    });

    this.logger.warn(
      `Rejected resume ${file.originalname}: ${params.errorMessage}`,
    );

    await this.timeline.record({
      entityType: 'ResumeIntake',
      entityId: intake.id,
      action: 'intake.rejected',
      payload: {
        fileName: file.originalname,
        errorCode: params.errorCode,
        entryMode: params.entryMode,
      },
    });

    return {
      intakeId: intake.id,
      candidateId: null,
      airRunId: null,
      status: intake.status,
      duplicate: false,
      parseQueued: false,
    };
  }

  private async findDuplicateCandidate(
    phone: string | null,
    email: string | null,
  ) {
    const conditions = [];
    if (phone) {
      conditions.push({ phone });
    }
    if (email) {
      conditions.push({ email });
    }
    if (conditions.length === 0) {
      return null;
    }
    return this.prisma.candidate.findFirst({
      where: { OR: conditions },
      orderBy: { createdAt: 'asc' },
    });
  }

  private async assertJobExists(jobId: string): Promise<void> {
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job) {
      throw new BadRequestException(`Job ${jobId} not found`);
    }
  }

  private assertSource(source: string): void {
    if (!ALLOWED_SOURCES.has(source)) {
      throw new BadRequestException(`Unsupported source: ${source}`);
    }
  }

  private assertEntryMode(entryMode: string): void {
    if (!ALLOWED_ENTRY_MODES.has(entryMode)) {
      throw new BadRequestException(`Unsupported entryMode: ${entryMode}`);
    }
  }
}

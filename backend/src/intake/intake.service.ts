import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  AiRunStatus,
  AiRunType,
  CandidateStage,
  DataScope,
  IntakeStatus,
  PoolType,
  SensitiveField,
} from '@prisma/client';
import type { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import type { MockOutcome } from '../ai/ai.types.js';
import { ParseQueueService } from '../ai/parse.queue.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthorizationService } from '../auth/authorization.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
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
    private readonly authorization: AuthorizationService,
  ) {}

  /** 批量上传 / 单个上传（FR-ENT-3） */
  async ingestUploads(
    files: UploadedResumeFile[],
    body: UploadIntakeBody,
  ): Promise<IntakeResult[]> {
    const actor = await this.requireActor(body.actorId);
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
      await this.assertJobAccessible(jobId, actor, 'intake:manage');
    }

    const results: IntakeResult[] = [];
    for (const file of files) {
      if (!isSupportedResumeFile(file.originalname)) {
        results.push(
          await this.recordRejectedFile(file, {
            source,
            entryMode,
            jobId,
            actorId: actor.id,
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
          actor,
          mockOutcome: body.mockOutcome,
        }),
      );
    }

    return results;
  }

  /** 手工录入（FR-ENT-3）：直接产生候选人或待分配池记录 */
  async ingestManual(body: ManualIntakeBody): Promise<IntakeResult> {
    const actor = await this.requireActor(body.actorId);
    const name = body.name?.trim();
    if (!name) {
      throw new BadRequestException('name is required');
    }

    const phone = normalizePhone(body.phone);
    const email = normalizeEmail(body.email);
    if (!phone && !email) {
      throw new BadRequestException('phone or email is required for dedup');
    }
    await this.authorization.assertSensitiveFieldAccess(
      actor,
      SensitiveField.CANDIDATE_CONTACT,
      'WRITE',
    );

    const source = body.source ?? INTAKE_SOURCE.MANUAL;
    this.assertSource(source);
    const jobId = body.jobId?.trim() || null;
    if (jobId) {
      await this.assertJobAccessible(jobId, actor, 'intake:manage');
    }

    const duplicate = await this.findDuplicateCandidate(phone, email);
    if (duplicate) {
      const duplicateCandidateId =
        (await this.authorization.canAccessCandidate(
          actor,
          'intake:manage',
          duplicate.id,
        ))
          ? duplicate.id
          : null;
      const intake = await this.prisma.resumeIntake.create({
        data: {
          source,
          entryMode: ENTRY_MODE.MANUAL,
          status: IntakeStatus.DUPLICATE,
          duplicateOfCandidateId: duplicateCandidateId,
          createdById: actor.id,
          jobId,
          intentId: body.intentId ?? null,
        },
      });
      await this.timeline.record({
        entityType: 'ResumeIntake',
        entityId: intake.id,
        action: 'intake.duplicate',
        actorId: actor.id,
        payload: {
          ...(duplicateCandidateId ? { candidateId: duplicateCandidateId } : {}),
          entryMode: ENTRY_MODE.MANUAL,
          duplicate: true,
        },
      });
      return {
        intakeId: intake.id,
        candidateId: duplicateCandidateId,
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
        createdById: actor.id,
        appliedAt: new Date(),
      },
    });

    const intake = await this.prisma.resumeIntake.create({
      data: {
        source,
        entryMode: ENTRY_MODE.MANUAL,
        status: IntakeStatus.PARSED,
        candidateId: candidate.id,
        createdById: actor.id,
        jobId,
        intentId: body.intentId ?? null,
      },
    });

    await this.timeline.record({
      entityType: 'Candidate',
      entityId: candidate.id,
      action: 'candidate.entered',
      actorId: actor.id,
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
    const actor = await this.requireActor(body.actorId);
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
      await this.assertJobAccessible(jobId, actor, 'intake:manage');
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
            actorId: actor.id,
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
          actor,
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
    const actor = await this.requireActor(actorId);
    const targetJobId = jobId?.trim();
    if (!targetJobId) {
      throw new BadRequestException('jobId is required');
    }
    await this.assertJobAccessible(targetJobId, actor, 'intake:manage');

    const intake = await this.prisma.resumeIntake.findUnique({
      where: { id: intakeId },
    });
    if (!intake) {
      throw new NotFoundException(`Intake ${intakeId} not found`);
    }
    await this.assertIntakeAccessible(intake, actor, 'intake:manage');
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
      actorId: actor.id,
      payload: { intakeId: intake.id, jobId: targetJobId },
    });

    return { intakeId: intake.id, candidateId: candidate.id, jobId: targetJobId };
  }

  /** 解析失败后重试（可 Mock 成功/失败，重试不产生重复候选人） */
  async retry(intakeId: string, actorId?: string, mockOutcome?: MockOutcome) {
    const actor = await this.requireActor(actorId);
    const intake = await this.prisma.resumeIntake.findUnique({
      where: { id: intakeId },
    });
    if (!intake) {
      throw new NotFoundException(`Intake ${intakeId} not found`);
    }
    await this.assertIntakeAccessible(intake, actor, 'intake:manage');
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
      actorId: actor.id,
      payload: { airRunId: intake.airRunId, parseQueued, mockOutcome },
    });

    return { intakeId: intake.id, airRunId: intake.airRunId, parseQueued };
  }

  async list(query: {
    status?: string;
    entryMode?: string;
    limit?: number;
  }, actor: AuthenticatedUser) {
    const limit = Math.min(Math.max(Number(query.limit ?? 20), 1), 100);
    const scopes = this.authorization.scopesFor(actor, 'intake:read');
    const where: Prisma.ResumeIntakeWhereInput = {
      status: query.status ? (query.status as IntakeStatus) : undefined,
      entryMode: query.entryMode || undefined,
    };
    if (!scopes.includes(DataScope.ALL)) {
      const [candidates, jobs] = await Promise.all([
        this.prisma.candidate.findMany({
          where: this.authorization.candidateWhere(actor, 'intake:read'),
          select: { id: true },
        }),
        this.prisma.job.findMany({
          where: this.authorization.jobWhere(actor, 'intake:read'),
          select: { id: true },
        }),
      ]);
      const clauses: Prisma.ResumeIntakeWhereInput[] = [];
      if (
        scopes.includes(DataScope.SELF) ||
        scopes.includes(DataScope.OWN_JOBS)
      ) {
        clauses.push({ createdById: actor.id });
      }
      if (candidates.length) {
        const candidateIds = candidates.map(({ id }) => id);
        clauses.push(
          { candidateId: { in: candidateIds } },
          { duplicateOfCandidateId: { in: candidateIds } },
        );
      }
      if (jobs.length) clauses.push({ jobId: { in: jobs.map(({ id }) => id) } });
      where.AND = [{ OR: clauses.length ? clauses : [{ id: '__no_access__' }] }];
    }
    const items = await this.prisma.resumeIntake.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    const canReadContacts = await this.authorization.canAccessSensitiveField(
      actor,
      SensitiveField.CANDIDATE_CONTACT,
      'READ',
    );
    return canReadContacts
      ? items
      : items.map((intake) => ({ ...intake, mailFrom: null }));
  }

  async get(intakeId: string, actor: AuthenticatedUser) {
    const intake = await this.prisma.resumeIntake.findUnique({
      where: { id: intakeId },
      include: {
        resumeFile: {
          select: { id: true, fileName: true, mimeType: true, size: true, createdAt: true },
        },
      },
    });
    if (!intake) {
      throw new NotFoundException(`Intake ${intakeId} not found`);
    }
    await this.assertIntakeAccessible(intake, actor, 'intake:read');
    const canReadContacts = await this.authorization.canAccessSensitiveField(
      actor,
      SensitiveField.CANDIDATE_CONTACT,
      'READ',
    );
    const [candidate, rawAirRun] = await Promise.all([
      intake.candidateId
        ? this.prisma.candidate.findFirst({
            where: {
              AND: [
                { id: intake.candidateId },
                this.authorization.candidateWhere(actor, 'intake:read'),
              ],
            },
          })
        : null,
      intake.airRunId
        ? this.prisma.aIRun.findUnique({ where: { id: intake.airRunId } })
        : null,
    ]);
    const airRun = intake.candidateId && !candidate ? null : rawAirRun;
    return {
      intake: {
        ...intake,
        mailFrom: canReadContacts ? intake.mailFrom : null,
      },
      candidate:
        candidate && !canReadContacts
          ? { ...candidate, phone: null, email: null }
          : candidate,
      airRun: airRun
        ? {
            ...airRun,
            inputRefs: this.filterSensitiveOutput(airRun.inputRefs, canReadContacts),
            output: this.filterSensitiveOutput(airRun.output, canReadContacts),
          }
        : null,
    };
  }

  private async createFileIntake(params: {
    file: UploadedResumeFile;
    sha256: string;
    source: string;
    entryMode: string;
    jobId: string | null;
    intentId: string | null;
    actor: AuthenticatedUser;
    mockOutcome?: MockOutcome;
    mail?: { from: string | null; subject: string | null; receivedAt: Date };
  }): Promise<IntakeResult> {
    const { file, sha256, source, entryMode, jobId, intentId, actor } = params;
    const actorId = actor.id;

    const existingFile = await this.prisma.resumeFile.findUnique({
      where: { sha256 },
      include: {
        intakes: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });

    if (existingFile) {
      const previous = existingFile.intakes[0] ?? null;
      const duplicateCandidateId = previous?.candidateId &&
        (await this.authorization.canAccessCandidate(
          actor,
          'intake:manage',
          previous.candidateId,
        ))
        ? previous.candidateId
        : null;
      const intake = await this.prisma.resumeIntake.create({
        data: {
          source,
          entryMode,
          status: IntakeStatus.DUPLICATE,
          resumeFileId: existingFile.id,
          duplicateOfCandidateId: duplicateCandidateId,
          createdById: actorId,
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
        actorId,
        payload: {
          sha256,
          resumeFileId: existingFile.id,
          candidateId: duplicateCandidateId,
          entryMode,
        },
      });
      return {
        intakeId: intake.id,
        candidateId: duplicateCandidateId,
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
          createdById: actorId,
          appliedAt: new Date(),
        },
      });

      const intake = await tx.resumeIntake.create({
        data: {
          source,
          entryMode,
          status: IntakeStatus.RECEIVED,
          candidateId: candidate.id,
          createdById: actorId,
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
      actorId,
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
      actorId: string;
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
        createdById: params.actorId,
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
      actorId: params.actorId,
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

  private async requireActor(actorId?: string): Promise<AuthenticatedUser> {
    if (!actorId) throw new UnauthorizedException('需要登录后继续');
    return this.authorization.loadUserContext(actorId);
  }

  private async assertJobAccessible(
    jobId: string,
    actor: AuthenticatedUser,
    permission: string,
  ): Promise<void> {
    if (!(await this.authorization.canAccessJob(actor, permission, jobId))) {
      throw new NotFoundException('职位不存在');
    }
  }

  private async assertIntakeAccessible(
    intake: {
      candidateId: string | null;
      duplicateOfCandidateId: string | null;
      jobId: string | null;
      createdById: string | null;
    },
    actor: AuthenticatedUser,
    permission: string,
  ): Promise<void> {
    const scopes = this.authorization.scopesFor(actor, permission);
    if (scopes.includes(DataScope.ALL)) return;

    if (
      intake.createdById === actor.id &&
      (scopes.includes(DataScope.SELF) || scopes.includes(DataScope.OWN_JOBS))
    ) {
      return;
    }
    for (const candidateId of [intake.candidateId, intake.duplicateOfCandidateId]) {
      if (
        candidateId &&
        (await this.authorization.canAccessCandidate(actor, permission, candidateId))
      ) {
        return;
      }
    }
    if (
      intake.jobId &&
      (await this.authorization.canAccessJob(actor, permission, intake.jobId))
    ) {
      return;
    }
    throw new NotFoundException('简历入场记录不存在');
  }

  private filterSensitiveOutput(
    output: string | null,
    canReadContacts: boolean,
  ): string | null {
    if (canReadContacts || !output) return output;
    try {
      const value: unknown = JSON.parse(output);
      if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
      const profile = value as Record<string, unknown>;
      for (const field of ['phone', 'email', 'contactEmail']) {
        const contact = profile[field];
        if (typeof contact === 'string') {
          profile[field] = null;
        } else if (contact && typeof contact === 'object' && !Array.isArray(contact)) {
          (contact as Record<string, unknown>).value = null;
        }
      }
      return JSON.stringify(profile);
    } catch {
      return null;
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

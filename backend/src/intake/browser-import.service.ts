import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import {
  AiRunStatus,
  AiRunType,
  BrowserImportStatus,
  CandidateStage,
  IntakeStatus,
  PoolType,
} from '@prisma/client';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TimelineService } from '../timeline/timeline.service.js';
import { StorageService } from '../storage/storage.service.js';
import { buildResumeStorageKey } from '../storage/storage.types.js';
import {
  resumeMaxBytes,
  validateUpload,
  type UploadValidationResult,
} from '../storage/upload-validation.js';
import { ParseQueueService } from '../ai/parse.queue.js';
import { AuthorizationService } from '../auth/authorization.service.js';
import { SystemTokenService, type IssuedSystemToken } from '../auth/system-token.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { ALLOWED_RESUME_EXTENSIONS, ENTRY_MODE, INTAKE_SOURCE } from './intake.constants.js';
import {
  DUPLICATE_DIMENSION,
  type DuplicateDimension,
  type UploadedResumeFile,
} from './intake.service.js';
import { normalizeEmail, normalizePhone } from './dedup.util.js';
import {
  ALLOWED_PAGE_FIELDS,
  BROWSER_IMPORT_ERROR,
  BROWSER_IMPORT_STAGE,
  SUPPORTED_SOURCE_SITES,
  containsCredentialField,
  pickPagePayload,
  sanitizeSourcePageUrl,
} from './browser-import.contract.js';

const REQUEST_ID_PATTERN = /^[\w.-]{8,64}$/;

export interface BrowserImportBody {
  requestId?: string;
  sourceSite?: string;
  sourceCandidateId?: string;
  sourcePageUrl?: string;
  targetJobId?: string;
  pagePayload?: Record<string, unknown>;
  actorId?: string;
}

export interface BrowserImportTaskView {
  taskId: string;
  requestId: string;
  status: string;
  sourceSite: string;
  sourceCandidateId: string | null;
  sourcePageHost: string | null;
  targetJobId: string | null;
  fileName: string | null;
  fileHash: string | null;
  candidateId: string | null;
  duplicateOfCandidateId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  errorStage: string | null;
  createdAt: string;
  completedAt: string | null;
}

@Injectable()
export class BrowserImportService {
  private readonly logger = new Logger(BrowserImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly timeline: TimelineService,
    private readonly storage: StorageService,
    private readonly queue: ParseQueueService,
    private readonly authorization: AuthorizationService,
    private readonly systemTokens: SystemTokenService,
  ) {}

  // ---------- 短期系统令牌 ----------

  /** 给已登录操作者签发短期系统令牌（只返回明文一次，库里只存哈希） */
  async issueToken(actor: AuthenticatedUser): Promise<IssuedSystemToken> {
    return this.systemTokens.issue(actor.id, 'BROWSER_IMPORT');
  }

  /** 吊销操作者名下全部有效令牌（换密码/离岗场景） */
  async revokeTokens(operatorId: string): Promise<number> {
    return this.systemTokens.revokeAll(operatorId);
  }

  // ---------- 导入任务 ----------

  /**
   * 创建浏览器导入任务（FR-EXT-6）：
   * 校验令牌与请求体 → 幂等查重（requestId + operatorId）→ 平台 ID / 附件哈希预查重
   * → 落任务 RECEIVED → 走统一解析管道。
   * 契约：成功返回 202 语义的任务视图；重放返回同一任务。
   */
  async createImportTask(
    body: BrowserImportBody,
    file: UploadedResumeFile | undefined,
    actor: AuthenticatedUser,
  ): Promise<{ duplicateOfExistingRequest: boolean; task: BrowserImportTaskView }> {
    this.assertCredentialFree(body);
    const requestId = body.requestId?.trim();
    if (!requestId || !REQUEST_ID_PATTERN.test(requestId)) {
      throw new BadRequestException(BROWSER_IMPORT_ERROR.REQUEST_ID_REQUIRED);
    }
    const sourceSite = body.sourceSite?.trim() ?? '';
    if (!SUPPORTED_SOURCE_SITES.has(sourceSite)) {
      throw new BadRequestException(BROWSER_IMPORT_ERROR.SOURCE_SITE_UNSUPPORTED);
    }

    const sanitized = sanitizeSourcePageUrl(body.sourcePageUrl);
    if (sanitized.invalid) {
      throw new BadRequestException(BROWSER_IMPORT_ERROR.SOURCE_URL_INVALID);
    }
    const sourcePageHost = sanitized.host;
    // 页面 URL 一律不落库，只保留主机；查串中的敏感参数一并丢弃
    const pagePayload = this.assertCredentialFreePagePayload(body.pagePayload);
    const sourceCandidateId = body.sourceCandidateId?.trim().slice(0, 191) || null;
    const targetJobId = body.targetJobId?.trim() || null;
    if (targetJobId) {
      await this.assertJobAccessible(targetJobId, actor);
    }

    // 幂等：同操作者同 requestId 直接返回已有任务
    const existing = await this.prisma.browserImportTask.findUnique({
      where: { requestId_operatorId: { requestId, operatorId: actor.id } },
    });
    if (existing) {
      return { duplicateOfExistingRequest: true, task: this.toView(existing) };
    }

    // 附件必须走字节上传；URL 拉取不进入服务端
    let sha256: string | null = null;
    let validated: UploadValidationResult | null = null;
    let fileName: string | null = null;
    if (file) {
      fileName = file.originalname?.slice(0, 191) ?? null;
      validated = validateUpload(
        {
          fileName: file.originalname,
          mimeType: file.mimetype,
          size: file.size,
          buffer: file.buffer,
        },
        { maxBytes: resumeMaxBytes(), allowedExtensions: ALLOWED_RESUME_EXTENSIONS },
      );
      if (!validated.ok) {
        throw new BadRequestException({
          code: BROWSER_IMPORT_ERROR.ATTACHMENT_INVALID,
          detail: validated.code,
          message: validated.message,
        });
      }
      sha256 = createHash('sha256').update(file.buffer).digest('hex');
    } else if (!Object.keys(pagePayload).length && !sourceCandidateId) {
      throw new BadRequestException(BROWSER_IMPORT_ERROR.PAYLOAD_REQUIRED);
    }

    // 三维预查重（任务创建时即给出提示，命中进 DUPLICATE 待人工选择）
    const duplicateHit = await this.findDuplicate({
      sourceSite,
      sourceCandidateId,
      fileHash: sha256,
      pagePayload,
    });

    const task = await this.prisma.browserImportTask.create({
      data: {
        requestId,
        operatorId: actor.id,
        sourceSite,
        sourceCandidateId,
        // sourcePageUrl 保持 null：路径与查询串不落库（NFR-12 URL 脱敏）
        sourcePageUrl: null,
        sourcePageHost,
        targetJobId,
        pagePayload: Object.keys(pagePayload).length
          ? (pagePayload as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        fileName,
        fileHash: sha256,
        status: duplicateHit
          ? BrowserImportStatus.DUPLICATE
          : BrowserImportStatus.RECEIVED,
        completedAt: duplicateHit ? new Date() : null,
      },
    });

    await this.timeline.record({
      entityType: 'BrowserImportTask',
      entityId: task.id,
      action: duplicateHit ? 'import.duplicate' : 'import.received',
      actorId: actor.id,
      payload: {
        requestId,
        sourceSite,
        sourceCandidateId,
        fileHash: sha256,
        duplicateDimensions: duplicateHit?.dimensions ?? [],
      },
    });

    if (duplicateHit) {
      // 命中查重：保持 DUPLICATE 待人工选择，不自动建候选人
      return { duplicateOfExistingRequest: false, task: this.toView(task, duplicateHit.candidateId) };
    }

    if (file && validated?.ok) {
      await this.startParsing(
        task.id,
        file,
        validated,
        sha256!,
        pagePayload,
        targetJobId,
        actor,
        sourceCandidateId,
      );
    }

    const fresh = await this.prisma.browserImportTask.findUniqueOrThrow({
      where: { id: task.id },
    });
    return { duplicateOfExistingRequest: false, task: this.toView(fresh) };
  }

  /** 任务查询（FR-EXT-7）：只允许任务所有者读取 */
  async getTask(taskId: string, actor: AuthenticatedUser): Promise<BrowserImportTaskView> {
    const task = await this.prisma.browserImportTask.findUnique({ where: { id: taskId } });
    if (!task || task.operatorId !== actor.id) {
      throw new NotFoundException(BROWSER_IMPORT_ERROR.TASK_NOT_FOUND);
    }
    return this.toView(task);
  }

  /** 操作者的任务列表（审计视图） */
  async listTasks(
    actor: AuthenticatedUser,
    query: { status?: string; page?: number; pageSize?: number },
  ) {
    const pageSize = Math.min(Math.max(query.pageSize ?? 20, 1), 100);
    const page = Math.max(query.page ?? 1, 1);
    const conditions: Prisma.BrowserImportTaskWhereInput[] = [{ operatorId: actor.id }];
    if (query.status) {
      const status = query.status.toUpperCase();
      if (!(status in BrowserImportStatus)) {
        throw new BadRequestException(`Unsupported status: ${query.status}`);
      }
      conditions.push({ status: status as BrowserImportStatus });
    }
    const where: Prisma.BrowserImportTaskWhereInput = { AND: conditions };
    const [items, total] = await Promise.all([
      this.prisma.browserImportTask.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.browserImportTask.count({ where }),
    ]);
    return {
      total,
      page,
      pageSize,
      items: items.map((task) => this.toView(task)),
    };
  }

  // ---------- 内部实现 ----------

  private async startParsing(
    taskId: string,
    file: UploadedResumeFile,
    validated: Extract<UploadValidationResult, { ok: true }>,
    sha256: string,
    pagePayload: Record<string, string>,
    targetJobId: string | null,
    actor: AuthenticatedUser,
    sourceCandidateId: string | null,
  ): Promise<void> {
    await this.prisma.browserImportTask.update({
      where: { id: taskId },
      data: { status: BrowserImportStatus.PARSING },
    });
    try {
      const intake = await this.createIntakeFromTask({
        file,
        validated,
        sha256,
        pagePayload,
        sourceCandidateId,
        targetJobId,
        actor,
        taskId,
      });
      await this.prisma.browserImportTask.update({
        where: { id: taskId },
        data: {
          status: BrowserImportStatus.PARSING,
          resumeFileId: intake.resumeFileId,
          candidateId: intake.candidateId,
        },
      });
    } catch (error) {
      const message = (error as Error).message ?? 'unknown';
      this.logger.warn(`Browser import ${taskId} failed at UPLOAD/PARSE: ${message}`);
      await this.prisma.browserImportTask.update({
        where: { id: taskId },
        data: {
          status: BrowserImportStatus.FAILED,
          errorCode: BROWSER_IMPORT_ERROR.ATTACHMENT_UNAVAILABLE,
          errorMessage: message.slice(0, 500),
          errorStage: BROWSER_IMPORT_STAGE.UPLOAD,
          completedAt: new Date(),
        },
      });
      await this.timeline.record({
        entityType: 'BrowserImportTask',
        entityId: taskId,
        action: 'import.failed',
        actorId: actor.id,
        payload: { stage: BROWSER_IMPORT_STAGE.UPLOAD, message: message.slice(0, 300) },
      });
    }
  }

  /** 复用统一入场管道：建 ResumeFile + Candidate + ResumeIntake + AIRun，并入解析队列 */
  private async createIntakeFromTask(params: {
    file: UploadedResumeFile;
    validated: Extract<UploadValidationResult, { ok: true }>;
    sha256: string;
    pagePayload: Record<string, string>;
    sourceCandidateId: string | null;
    targetJobId: string | null;
    actor: AuthenticatedUser;
    taskId: string;
  }) {
    const { file, validated, sha256, pagePayload, sourceCandidateId, targetJobId, actor, taskId } =
      params;
    const existingFile = await this.prisma.resumeFile.findUnique({ where: { sha256 } });
    const storageKey = buildResumeStorageKey(sha256, validated.extension);
    if (!existingFile) {
      await this.storage.putObject({
        key: storageKey,
        body: file.buffer,
        contentType: validated.mimeType,
      });
    }
    const resumeFile =
      existingFile ??
      (await this.prisma.resumeFile.create({
        data: {
          sha256,
          fileName: file.originalname,
          mimeType: validated.mimeType,
          size: validated.size,
          storageKey,
          storageDriver: this.storage.driverName,
        },
      }));

    const candidate = await this.prisma.candidate.create({
      data: {
        name: pagePayload.name ?? '待解析候选人',
        jobId: targetJobId,
        poolType: targetJobId ? PoolType.NONE : PoolType.UNASSIGNED,
        stage: targetJobId ? CandidateStage.RECOMMENDED : CandidateStage.UNASSIGNED,
        source: INTAKE_SOURCE.JOB_BOARD,
        entryMode: ENTRY_MODE.BROWSER_EXTENSION,
        sourcePlatformId: sourceCandidateId ?? null,
        createdById: actor.id,
        appliedAt: new Date(),
      },
    });

    const intake = await this.prisma.resumeIntake.create({
      data: {
        source: INTAKE_SOURCE.JOB_BOARD,
        entryMode: ENTRY_MODE.BROWSER_EXTENSION,
        status: IntakeStatus.RECEIVED,
        candidateId: candidate.id,
        createdById: actor.id,
        jobId: targetJobId,
        resumeFileId: resumeFile.id,
        sourceNote: this.describePagePayload(pagePayload),
        receivedAt: new Date(),
      },
    });

    const airRun = await this.prisma.aIRun.create({
      data: {
        type: AiRunType.RESUME_PARSE,
        status: AiRunStatus.PENDING,
        isDraft: true,
        inputRefs: JSON.stringify({
          intakeId: intake.id,
          resumeFileId: resumeFile.id,
          fileName: file.originalname,
          browserImportTaskId: taskId,
        }),
      },
    });
    await this.prisma.resumeIntake.update({
      where: { id: intake.id },
      data: { airRunId: airRun.id },
    });
    await this.prisma.candidate.update({
      where: { id: candidate.id },
      data: { browserImportTaskId: taskId },
    });
    await this.queue.enqueue(intake.id, airRun.id);
    return { resumeFileId: resumeFile.id, candidateId: candidate.id, intakeId: intake.id };
  }

  /** 任务创建时三维查重：平台 ID / 附件哈希 / 联系方式（页面字段） */
  private async findDuplicate(input: {
    sourceSite: string;
    sourceCandidateId: string | null;
    fileHash: string | null;
    pagePayload: Record<string, string>;
  }): Promise<{ candidateId: string; dimensions: DuplicateDimension[] } | null> {
    const dimensions: DuplicateDimension[] = [];
    let hitCandidateId: string | null = null;

    if (input.sourceCandidateId) {
      const hit = await this.prisma.candidate.findFirst({
        where: { sourcePlatformId: input.sourceCandidateId },
        orderBy: { createdAt: 'asc' },
      });
      if (hit) {
        dimensions.push(DUPLICATE_DIMENSION.PLATFORM_ID);
        hitCandidateId = hit.id;
      }
    }
    if (input.fileHash) {
      const hit = await this.prisma.resumeFile.findUnique({
        where: { sha256: input.fileHash },
        include: { intakes: { orderBy: { createdAt: 'desc' }, take: 1 } },
      });
      const candidateId = hit?.intakes[0]?.candidateId ?? null;
      if (candidateId) {
        dimensions.push(DUPLICATE_DIMENSION.FILE_HASH);
        hitCandidateId = hitCandidateId ?? candidateId;
      }
    }
    const phone = normalizePhone(input.pagePayload.phone);
    const email = normalizeEmail(input.pagePayload.email);
    const conditions: Prisma.CandidateWhereInput[] = [];
    if (phone) conditions.push({ phone });
    if (email) conditions.push({ email });
    if (conditions.length) {
      const hit = await this.prisma.candidate.findFirst({
        where: { OR: conditions },
        orderBy: { createdAt: 'asc' },
      });
      if (hit) {
        dimensions.push(DUPLICATE_DIMENSION.CONTACT);
        hitCandidateId = hitCandidateId ?? hit.id;
      }
    }
    if (!hitCandidateId || dimensions.length === 0) return null;
    return { candidateId: hitCandidateId, dimensions };
  }

  /** 请求体里出现凭据字段名（如 cookie / authorization）即拒绝，且不落库 */
  private assertCredentialFree(body: BrowserImportBody): void {
    if (containsCredentialField(body)) {
      throw new BadRequestException(BROWSER_IMPORT_ERROR.THIRD_PARTY_CREDENTIAL_REJECTED);
    }
  }

  private assertCredentialFreePagePayload(
    payload: Record<string, unknown> | undefined,
  ): Record<string, string> {
    if (payload && containsCredentialField(payload)) {
      throw new BadRequestException(BROWSER_IMPORT_ERROR.THIRD_PARTY_CREDENTIAL_REJECTED);
    }
    return pickPagePayload(payload);
  }

  private describePagePayload(pagePayload: Record<string, string>): string | null {
    const keys = Object.keys(pagePayload).filter((key) => ALLOWED_PAGE_FIELDS.has(key));
    if (!keys.length) return null;
    return `browser-extension fields: ${keys.join(',')}`;
  }

  private async assertJobAccessible(jobId: string, actor: AuthenticatedUser): Promise<void> {
    if (!(await this.authorization.canAccessJob(actor, 'intake:manage', jobId))) {
      throw new NotFoundException(BROWSER_IMPORT_ERROR.JOB_NOT_FOUND);
    }
  }

  /** 读取入口补上 duplicateOfCandidateId（创建返回时已带） */
  private toView(task: {
    id: string;
    requestId: string;
    status: BrowserImportStatus;
    sourceSite: string;
    sourceCandidateId: string | null;
    sourcePageHost: string | null;
    targetJobId: string | null;
    fileName: string | null;
    fileHash: string | null;
    candidateId: string | null;
    errorCode: string | null;
    errorMessage: string | null;
    errorStage: string | null;
    createdAt: Date;
    completedAt: Date | null;
  }, duplicateOfCandidateId?: string | null): BrowserImportTaskView {
    return {
      taskId: task.id,
      requestId: task.requestId,
      status: task.status,
      sourceSite: task.sourceSite,
      sourceCandidateId: task.sourceCandidateId,
      sourcePageHost: task.sourcePageHost,
      targetJobId: task.targetJobId,
      fileName: task.fileName,
      fileHash: task.fileHash,
      candidateId: task.candidateId,
      duplicateOfCandidateId: duplicateOfCandidateId ?? null,
      errorCode: task.errorCode,
      errorMessage: task.errorMessage,
      errorStage: task.errorStage,
      createdAt: task.createdAt.toISOString(),
      completedAt: task.completedAt?.toISOString() ?? null,
    };
  }
}

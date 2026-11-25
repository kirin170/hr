import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AiRunStatus,
  AiRunType,
  IntakeStatus,
  Prisma,
  SensitiveField,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthorizationService } from '../auth/authorization.service.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { TimelineService } from '../timeline/timeline.service.js';
import { AiConfigService } from './ai-config.service.js';
import { AiProviderRouter } from './ai-provider.router.js';
import {
  AiContractError,
  INTERVIEW_EVAL_SCHEMA,
  RESUME_EVAL_SCHEMA,
  buildResumeEvalInput,
  validateInterviewEval,
  validateResumeEval,
  validateResumeParse,
  type AiScene,
  type InterviewEvalInputLike,
  type ResumeEvalInput,
} from './ai.contract.js';
import type { ParseResumeInput, ParsedResume } from './ai.types.js';
import { AiEvalQueueService } from './eval.queue.js';
import { ResumeContentLoader } from './resume-content.loader.js';
import type { AiUsage } from './ai.types.js';
import { AI_ERROR_CODES, AiProviderError } from './model-provider.js';

const MAX_ERROR_MESSAGE = 300;
type ContractWarning = { path: string; code: string; message: string };

/** AI 三场景执行与人工复核（ATS-021）。 */
@Injectable()
export class AiRunService {
  private readonly logger = new Logger(AiRunService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly timeline: TimelineService,
    private readonly authorization: AuthorizationService,
    private readonly config: AiConfigService,
    private readonly router: AiProviderRouter,
    private readonly loader: ResumeContentLoader,
    private readonly evalQueue: AiEvalQueueService,
  ) {}

  async createParseRun(input: ParseResumeInput) {
    return this.prisma.aIRun.create({
      data: {
        type: AiRunType.RESUME_PARSE,
        status: AiRunStatus.PENDING,
        isDraft: true,
        inputRefs: JSON.stringify(input),
      },
    });
  }

  async getRun(id: string, actor: AuthenticatedUser, permission = 'ai:read') {
    const { run } = await this.loadRunInScope(id, actor, permission);
    const canReadContacts = await this.authorization.canAccessSensitiveField(
      actor,
      SensitiveField.CANDIDATE_CONTACT,
      'READ',
    );
    return {
      ...run,
      inputRefs: this.filterSensitiveJson(run.inputRefs, canReadContacts),
      output: this.filterSensitiveOutput(run.type, run.output, canReadContacts),
    };
  }

  /** Worker 消费入口：幂等处理一次解析任务 */
  async processParseTask(intakeId: string): Promise<void> {
    const intake = await this.prisma.resumeIntake.findUnique({ where: { id: intakeId } });
    if (!intake || !intake.airRunId) {
      this.logger.warn(`Skip parse task: intake ${intakeId} not found`);
      return;
    }
    if (intake.status === IntakeStatus.DUPLICATE) return;

    const run = await this.prisma.aIRun.findUnique({ where: { id: intake.airRunId } });
    if (!run || run.status === AiRunStatus.SUCCESS) return;

    try {
      await this.config.assertSceneEnabled('RESUME_PARSE');
    } catch (error) {
      await this.degradeParse(intake.id, run.id, error);
      return;
    }

    const input = this.parseInput(run.inputRefs, intake.id);

    await this.prisma.$transaction([
      this.prisma.aIRun.update({
        where: { id: run.id },
        data: {
          status: AiRunStatus.RUNNING,
          attempts: { increment: 1 },
          errorCode: null,
          errorMessage: null,
        },
      }),
      this.prisma.resumeIntake.update({
        where: { id: intake.id },
        data: { status: IntakeStatus.PARSING, attempts: { increment: 1 } },
      }),
    ]);

    try {
      const resumeFile = input.resumeFileId
        ? await this.prisma.resumeFile.findUnique({ where: { id: input.resumeFileId } })
        : null;
      if (!resumeFile) {
        throw new AiProviderError(AI_ERROR_CODES.CONTENT_UNSUPPORTED, '未找到简历文件，无法解析', {
          retryable: false,
        });
      }
      const content = await this.loader.load({
        storageKey: resumeFile.storageKey,
        fileName: resumeFile.fileName,
        mimeType: resumeFile.mimeType,
        size: resumeFile.size,
      });
      const { result, provider } = await this.router.run(
        'RESUME_PARSE',
        { needsImage: !content.text },
        (candidate) => candidate.parseResume({ input, content }),
      );
      await this.persistParseSuccess(run.id, intake.id, result, provider.name);
    } catch (error) {
      const retryable = error instanceof AiProviderError ? error.retryable : true;
      const code = errorCodeOf(error);
      await this.prisma.$transaction([
        this.prisma.aIRun.update({
          where: { id: run.id },
          data: {
            status: AiRunStatus.FAILED,
            errorCode: code,
            errorMessage: truncate((error as Error).message, MAX_ERROR_MESSAGE),
            ...this.failureValidation(error),
          },
        }),
        this.prisma.resumeIntake.update({
          where: { id: intake.id },
          data: {
            status: retryable ? IntakeStatus.PARSING : IntakeStatus.NEEDS_MANUAL,
            errorCode: code,
            errorMessage: truncate((error as Error).message, MAX_ERROR_MESSAGE),
          },
        }),
      ]);
      if (!retryable) {
        await this.recordIntakeDegrade(intake.id, run.id, code);
        return;
      }
      throw error;
    }
  }

  /** 重试耗尽后的最终失败：降级人工录入，不阻断主流程（AI-4） */
  async markParseFailed(intakeId: string, error: Error): Promise<void> {
    const intake = await this.prisma.resumeIntake.findUnique({ where: { id: intakeId } });
    if (!intake || !intake.airRunId) return;

    const run = await this.prisma.aIRun.findUnique({ where: { id: intake.airRunId } });
    if (run?.status === AiRunStatus.SUCCESS) return;

    const code = errorCodeOf(error);
    await this.prisma.$transaction([
      this.prisma.aIRun.update({
        where: { id: intake.airRunId },
        data: {
          status: AiRunStatus.FAILED,
          errorCode: code,
          errorMessage: truncate(error.message, MAX_ERROR_MESSAGE),
        },
      }),
      this.prisma.resumeIntake.update({
        where: { id: intake.id },
        data: {
          status: IntakeStatus.NEEDS_MANUAL,
          errorCode: code,
          errorMessage: truncate(error.message, MAX_ERROR_MESSAGE),
        },
      }),
    ]);

    await this.recordIntakeDegrade(intake.id, intake.airRunId, code);
  }

  /** 发起简历评估（RESUME_EVAL）：AI-5 无招聘要求禁发，职位/系统开关关闭禁发。 */
  async requestResumeEval(
    candidateId: string,
    actor: AuthenticatedUser,
    options: { force?: boolean } = {},
  ) {
    const candidate = await this.prisma.candidate.findFirst({
      where: { AND: [{ id: candidateId }, this.authorization.candidateWhere(actor, 'ai:read')] },
      select: { id: true, name: true, jobId: true },
    });
    if (!candidate) throw new NotFoundException('候选人不存在');
    if (!candidate.jobId) throw new BadRequestException('未分配职位的候选人不能发起简历评估');

    const job = await this.prisma.job.findUnique({
      where: { id: candidate.jobId },
      select: { id: true, title: true, requirements: true, aiEvalEnabled: true },
    });
    if (!job) throw new BadRequestException('候选人所属职位不存在');
    await this.assertEvalAllowed(job.id, 'RESUME_EVAL');

    const intake = await this.prisma.resumeIntake.findFirst({
      where: { candidateId, resumeFileId: { not: null } },
      orderBy: { createdAt: 'desc' },
      include: { resumeFile: true },
    });
    if (!intake?.resumeFile) {
      throw new BadRequestException('该候选人没有可评估的简历文件，请先上传简历或人工评估');
    }

    const dedupeKey = `RESUME_EVAL:${candidate.id}:${intake.resumeFile.id}:${job.id}`;
    const existing = await this.findReusableRun(dedupeKey, Boolean(options.force));
    if (existing) return { run: existing, deduped: true, queued: false };

    const input = buildResumeEvalInput({
      candidate: { id: candidate.id, name: candidate.name },
      job: { id: job.id, title: job.title, requirements: job.requirements },
      resume: {
        fileId: intake.resumeFile.id,
        fileName: intake.resumeFile.fileName,
        mimeType: intake.resumeFile.mimeType,
        textLength: intake.resumeFile.size,
        textHash: intake.resumeFile.sha256,
        textTruncated: false,
      },
    });

    const templateVersion = (await this.config.getConfig()).scenes.RESUME_EVAL.templateVersion;
    const run = await this.prisma.aIRun.create({
      data: {
        type: AiRunType.RESUME_EVAL,
        status: AiRunStatus.PENDING,
        isDraft: true,
        dedupeKey,
        templateVersion,
        inputRefs: JSON.stringify(input),
      },
    });

    await this.timeline.record({
      entityType: 'Candidate',
      entityId: candidate.id,
      action: 'candidate.ai_eval_requested',
      actorId: actor.id,
      payload: { airRunId: run.id, jobId: job.id, scenario: 'RESUME_EVAL' },
    });

    const queued = await this.evalQueue.enqueue(run.id);
    if (!queued) {
      this.logger.warn(`AI eval run ${run.id} created but enqueue failed; manual retry required`);
    }
    return { run, deduped: false, queued };
  }

  /** ATS-020 等调用方在创建评估任务前统一校验开关与招聘要求。 */
  async assertEvalAllowed(jobId: string | null | undefined, scene: AiScene): Promise<void> {
    try {
      await this.config.assertSceneEnabled(scene);
    } catch (error) {
      if (error instanceof AiProviderError) throw new BadRequestException(error.message);
      throw error;
    }
    if (!jobId) throw new BadRequestException('缺少职位信息，无法发起 AI 评估');
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      select: { requirements: true, aiEvalEnabled: true },
    });
    if (!job) throw new BadRequestException('职位不存在，无法发起 AI 评估');
    if (!job.aiEvalEnabled) throw new BadRequestException('该职位已关闭 AI 评估');
    if (!job.requirements?.trim()) {
      throw new BadRequestException('职位未填写招聘要求，无法发起 AI 评估（AI-5）');
    }
  }

  async enqueueEvalRun(runId: string): Promise<boolean> {
    return this.evalQueue.enqueue(runId);
  }

  /** Worker 消费入口：执行一次评估任务；可重试错误抛出由队列重试。 */
  async processEvalTask(runId: string): Promise<void> {
    const run = await this.prisma.aIRun.findUnique({ where: { id: runId } });
    if (!run || run.status === AiRunStatus.SUCCESS || run.type === AiRunType.RESUME_PARSE) return;

    await this.assertRunAllowed(run.type, run.inputRefs);

    await this.prisma.aIRun.update({
      where: { id: run.id },
      data: {
        status: AiRunStatus.RUNNING,
        attempts: { increment: 1 },
        errorCode: null,
        errorMessage: null,
      },
    });

    try {
      if (run.type === AiRunType.RESUME_EVAL) {
        await this.executeResumeEval(run.id, run.inputRefs);
      } else if (run.type === AiRunType.INTERVIEW_EVAL) {
        await this.executeInterviewEval(run.id, run.inputRefs);
      } else {
        throw new AiProviderError(AI_ERROR_CODES.INTERNAL, `不支持的 AI 任务类型 ${String(run.type)}`, {
          retryable: false,
        });
      }
    } catch (error) {
      const retryable = error instanceof AiProviderError ? error.retryable : true;
      await this.persistEvalFailure(run.id, error);
      if (!retryable) {
        await this.recordEvalDegrade(run, errorCodeOf(error));
        return;
      }
      throw error;
    }
  }

  /** 重试耗尽后的最终失败：记录降级原因，候选人阶段与 OA 结论不受影响（AI-4/AI-6）。 */
  async markEvalFailed(runId: string, error: Error): Promise<void> {
    const run = await this.prisma.aIRun.findUnique({ where: { id: runId } });
    if (!run || run.status === AiRunStatus.SUCCESS) return;
    const code = errorCodeOf(error);
    await this.prisma.aIRun.update({
      where: { id: run.id },
      data: {
        status: AiRunStatus.FAILED,
        errorCode: code,
        errorMessage: truncate(error.message, MAX_ERROR_MESSAGE),
      },
    });
    await this.recordEvalDegrade(run, code);
  }

  /** 人工编辑草稿（AI-1）：只改草稿内容，不改候选人阶段/面试结论。 */
  async editRun(runId: string, value: unknown, actor: AuthenticatedUser) {
    const { run } = await this.loadRunInScope(runId, actor, 'ai:confirm');
    if (run.status !== AiRunStatus.SUCCESS || !run.output) {
      throw new BadRequestException('只有成功生成的草稿可以编辑');
    }
    if (!run.isDraft) throw new BadRequestException('已确认的 AI 结果不能再编辑');

    const body = (value ?? {}) as Record<string, unknown>;
    const draft = body.output ?? body;
    let normalized: unknown;
    try {
      if (run.type === AiRunType.RESUME_PARSE) {
        normalized = validateResumeParse(draft).output;
      } else if (run.type === AiRunType.RESUME_EVAL) {
        normalized = validateResumeEval(draft).output;
      } else if (run.type === AiRunType.INTERVIEW_EVAL) {
        normalized = validateInterviewEval(draft, await this.interviewAllowedRefs(run.inputRefs)).output;
      } else {
        throw new BadRequestException('该 AI 任务类型不支持编辑');
      }
    } catch (error) {
      // 人工改坏了草稿属于请求错误，应返回 400 与逐项问题，便于前端就地提示（AI-1）
      if (error instanceof AiContractError) {
        throw new BadRequestException({
          message: 'AI 草稿内容不满足契约，请按提示修正后重试',
          scene: error.scene,
          issues: error.issues,
        });
      }
      throw error;
    }

    await this.prisma.aIRun.update({
      where: { id: run.id },
      data: {
        output: JSON.stringify(normalized),
        editedBy: actor.id,
        editedAt: new Date(),
      },
    });

    await this.timeline.record({
      entityType: run.interviewId ? 'Interview' : 'Candidate',
      entityId: await this.entityIdForRun(run),
      action: 'ai_run.draft_edited',
      actorId: actor.id,
      payload: { airRunId: run.id, scenario: run.type },
    });

    return this.getRun(runId, actor, 'ai:confirm');
  }

  /** 人工确认草稿（AI-1/AI-6）：仅解析结果写档案；评估结果只标记采纳，不自动流转。 */
  async confirmRun(runId: string, actor: AuthenticatedUser) {
    const { run, intake } = await this.loadRunInScope(runId, actor, 'ai:confirm');
    if (run.status !== AiRunStatus.SUCCESS || !run.output) {
      throw new BadRequestException(`AI run ${runId} has no successful draft to confirm`);
    }

    if (run.type === AiRunType.RESUME_PARSE) {
      return this.confirmParseRun(run, intake, actor);
    }

    if (!run.isDraft) return this.getRun(runId, actor, 'ai:confirm');

    await this.prisma.aIRun.update({
      where: { id: run.id },
      data: { isDraft: false, confirmedBy: actor.id, confirmedAt: new Date() },
    });

    await this.timeline.record({
      entityType: run.type === AiRunType.INTERVIEW_EVAL ? 'Interview' : 'Candidate',
      entityId: await this.entityIdForRun(run),
      action:
        run.type === AiRunType.INTERVIEW_EVAL
          ? 'interview.ai_eval_confirmed'
          : 'candidate.ai_eval_confirmed',
      actorId: actor.id,
      payload: { airRunId: run.id, scenario: run.type },
    });

    // 显式边界：AI 评估确认不推进候选人阶段、不写 OA 结论、不产生录用决定（AI-6）
    return this.getRun(runId, actor, 'ai:confirm');
  }

  private async confirmParseRun(
    run: { id: string; output: string | null },
    intake: { id: string; candidateId: string | null } | null,
    actor: AuthenticatedUser,
  ) {
    if (!intake?.candidateId) {
      throw new BadRequestException(`AI run ${run.id} is not linked to a candidate`);
    }

    const draft = JSON.parse(run.output ?? '{}') as ParsedResume;
    if (draft.phone?.value || draft.email?.value) {
      await this.authorization.assertSensitiveFieldAccess(
        actor,
        SensitiveField.CANDIDATE_CONTACT,
        'WRITE',
      );
    }

    const candidateId = intake.candidateId;
    await this.prisma.$transaction(async (tx) => {
      const candidate = await tx.candidate.findFirst({
        where: {
          AND: [{ id: candidateId }, this.authorization.candidateWhere(actor, 'ai:confirm')],
        },
      });
      if (!candidate) throw new NotFoundException('候选人不存在');
      await tx.candidate.update({
        where: { id: candidate.id },
        data: {
          name: draft.name?.value ?? candidate.name,
          phone: draft.phone?.value ?? candidate.phone,
          email: draft.email?.value ?? candidate.email,
          parsedProfileId: run.id,
        },
      });
      await tx.aIRun.update({
        where: { id: run.id },
        data: { isDraft: false, confirmedBy: actor.id, confirmedAt: new Date() },
      });
    });

    await this.timeline.record({
      entityType: 'Candidate',
      entityId: candidateId,
      action: 'candidate.profile_confirmed',
      actorId: actor.id,
      payload: { airRunId: run.id, intakeId: intake.id },
    });

    return this.getRun(run.id, actor, 'ai:confirm');
  }

  private async executeResumeEval(runId: string, inputRefs: string | null): Promise<void> {
    const input = this.parseJson<ResumeEvalInput>(inputRefs);
    if (!input || input.schema !== RESUME_EVAL_SCHEMA) {
      throw new AiProviderError(AI_ERROR_CODES.OUTPUT_INVALID, '简历评估输入契约版本不匹配', {
        retryable: false,
      });
    }
    const file = await this.prisma.resumeFile.findUnique({ where: { id: input.resume.fileId } });
    if (!file) {
      throw new AiProviderError(AI_ERROR_CODES.CONTENT_UNSUPPORTED, '简历文件已不存在，请人工处理', {
        retryable: false,
      });
    }
    const content = await this.loader.load({
      storageKey: file.storageKey,
      fileName: file.fileName,
      mimeType: file.mimeType,
      size: file.size,
    });

    const { result, provider } = await this.router.run(
      'RESUME_EVAL',
      { needsImage: !content.text },
      (candidate) => candidate.evaluateResume({ input, content }),
    );
    await this.persistEvalSuccess(
      runId,
      result.output,
      result.confidence,
      result.warnings,
      result.usage,
      provider.name,
      'RESUME_EVAL',
    );
  }

  private async executeInterviewEval(runId: string, inputRefs: string | null): Promise<void> {
    const input = this.parseJson<InterviewEvalInputLike>(inputRefs);
    if (!input || input.schema !== INTERVIEW_EVAL_SCHEMA) {
      throw new AiProviderError(AI_ERROR_CODES.OUTPUT_INVALID, '面试评估输入契约版本不匹配', {
        retryable: false,
      });
    }
    const material = await this.prisma.interviewTranscriptMaterial.findUnique({
      where: { id: input.transcript.materialId },
    });
    if (!material) {
      throw new AiProviderError(AI_ERROR_CODES.CONTENT_UNSUPPORTED, '听记素材已不存在，请人工评估', {
        retryable: false,
      });
    }
    const transcriptText = material.originalText ?? material.summary ?? '';
    if (transcriptText.trim().length < 20) {
      throw new AiProviderError(AI_ERROR_CODES.CONTENT_UNSUPPORTED, '听记素材文本不足，请人工评估', {
        retryable: false,
      });
    }

    const { result, provider } = await this.router.run(
      'INTERVIEW_EVAL',
      { needsImage: false },
      (candidate) =>
        candidate.evaluateInterview({
          input,
          transcriptText,
          allowedSourceRefs: this.allowedRefs(material),
        }),
    );
    await this.persistEvalSuccess(
      runId,
      result.output,
      result.confidence,
      result.warnings,
      result.usage,
      provider.name,
      'INTERVIEW_EVAL',
    );
  }

  private async persistParseSuccess(
    runId: string,
    intakeId: string,
    result: {
      output: ParsedResume;
      confidence: Record<string, number>;
      warnings?: ContractWarning[];
      usage?: AiUsage;
    },
    providerName: string,
  ): Promise<void> {
    const templateVersion = (await this.config.getConfig()).scenes.RESUME_PARSE.templateVersion;
    await this.prisma.$transaction([
      this.prisma.aIRun.update({
        where: { id: runId },
        data: {
          status: AiRunStatus.SUCCESS,
          output: JSON.stringify(result.output),
          confidence: result.confidence,
          isDraft: true,
          errorCode: null,
          errorMessage: null,
          templateVersion,
          ...this.usageFields(result.usage, providerName),
          ...this.validationField(result.warnings),
        },
      }),
      this.prisma.resumeIntake.update({
        where: { id: intakeId },
        data: { status: IntakeStatus.PARSED, errorCode: null, errorMessage: null },
      }),
    ]);

    const intake = await this.prisma.resumeIntake.findUnique({
      where: { id: intakeId },
      select: { candidateId: true },
    });
    await this.timeline.record({
      entityType: 'ResumeIntake',
      entityId: intakeId,
      action: 'intake.parsed',
      payload: {
        airRunId: runId,
        candidateId: intake?.candidateId ?? null,
        provider: providerName,
        draft: true,
      },
    });
  }

  private async persistEvalSuccess(
    runId: string,
    output: unknown,
    confidence: Record<string, number>,
    warnings: ContractWarning[] | undefined,
    usage: AiUsage | undefined,
    providerName: string,
    scene: 'RESUME_EVAL' | 'INTERVIEW_EVAL',
  ): Promise<void> {
    const templateVersion = (await this.config.getConfig()).scenes[scene].templateVersion;
    const run = await this.prisma.aIRun.update({
      where: { id: runId },
      data: {
        status: AiRunStatus.SUCCESS,
        output: JSON.stringify(output),
        confidence,
        isDraft: true,
        errorCode: null,
        errorMessage: null,
        templateVersion,
        ...this.usageFields(usage, providerName),
        ...this.validationField(warnings),
      },
    });

    await this.timeline.record({
      entityType: scene === 'INTERVIEW_EVAL' ? 'Interview' : 'Candidate',
      entityId: await this.entityIdForRun(run),
      action: scene === 'INTERVIEW_EVAL' ? 'interview.ai_eval_ready' : 'candidate.ai_eval_ready',
      payload: { airRunId: run.id, scenario: scene, provider: providerName, draft: true },
    });
  }

  private async persistEvalFailure(runId: string, error: unknown): Promise<void> {
    await this.prisma.aIRun.update({
      where: { id: runId },
      data: {
        status: AiRunStatus.FAILED,
        errorCode: errorCodeOf(error),
        errorMessage: truncate((error as Error).message, MAX_ERROR_MESSAGE),
        ...this.failureValidation(error),
      },
    });
  }

  private async assertRunAllowed(type: AiRunType, inputRefs: string | null): Promise<void> {
    await this.config.assertSceneEnabled(type as AiScene);

    const input = this.parseJson<Record<string, unknown>>(inputRefs);
    const jobId =
      type === AiRunType.INTERVIEW_EVAL
        ? ((input?.interview as { jobId?: string } | undefined)?.jobId ?? null)
        : ((input?.job as { id?: string } | undefined)?.id ?? null);
    const requirements =
      type === AiRunType.INTERVIEW_EVAL
        ? ((input?.jobRequirements as { text?: string } | undefined)?.text ?? '')
        : ((input?.job as { requirements?: string } | undefined)?.requirements ?? '');

    if (!jobId) {
      throw new AiProviderError(AI_ERROR_CODES.REQUIREMENTS_MISSING, '评估任务缺少职位信息', {
        retryable: false,
      });
    }
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      select: { aiEvalEnabled: true },
    });
    if (!job) {
      throw new AiProviderError(AI_ERROR_CODES.INTERNAL, '评估任务对应职位不存在', { retryable: false });
    }
    if (!job.aiEvalEnabled) {
      throw new AiProviderError(AI_ERROR_CODES.JOB_DISABLED, '该职位已关闭 AI 评估', { retryable: false });
    }
    if (!requirements.trim()) {
      throw new AiProviderError(
        AI_ERROR_CODES.REQUIREMENTS_MISSING,
        '职位未填写招聘要求，评估已取消（AI-5）',
        { retryable: false },
      );
    }
  }

  private async findReusableRun(dedupeKey: string, allowSuccessReuse: boolean) {
    const existing = await this.prisma.aIRun.findFirst({
      where: {
        dedupeKey,
        status: { in: [AiRunStatus.PENDING, AiRunStatus.RUNNING, AiRunStatus.SUCCESS] },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!existing) return null;
    if (existing.status === AiRunStatus.SUCCESS) return allowSuccessReuse ? null : existing;
    return existing;
  }

  private async degradeParse(intakeId: string, runId: string, error: unknown): Promise<void> {
    const code = errorCodeOf(error);
    await this.prisma.$transaction([
      this.prisma.aIRun.update({
        where: { id: runId },
        data: {
          status: AiRunStatus.FAILED,
          errorCode: code,
          errorMessage: truncate((error as Error).message, MAX_ERROR_MESSAGE),
        },
      }),
      this.prisma.resumeIntake.update({
        where: { id: intakeId },
        data: {
          status: IntakeStatus.NEEDS_MANUAL,
          errorCode: code,
          errorMessage: truncate((error as Error).message, MAX_ERROR_MESSAGE),
        },
      }),
    ]);
    await this.recordIntakeDegrade(intakeId, runId, code);
  }

  private async recordIntakeDegrade(intakeId: string, runId: string, code: string): Promise<void> {
    const intake = await this.prisma.resumeIntake.findUnique({
      where: { id: intakeId },
      select: { candidateId: true },
    });
    await this.timeline.record({
      entityType: 'ResumeIntake',
      entityId: intakeId,
      action: 'intake.parse_degraded',
      payload: { airRunId: runId, candidateId: intake?.candidateId ?? null, reason: code },
    });
  }

  private async recordEvalDegrade(
    run: { id: string; type: AiRunType; interviewId: string | null; inputRefs: string | null },
    code: string,
  ): Promise<void> {
    await this.timeline.record({
      entityType: run.type === AiRunType.INTERVIEW_EVAL ? 'Interview' : 'Candidate',
      entityId: await this.entityIdForRun(run),
      action: 'ai_run.degraded',
      payload: { airRunId: run.id, scenario: run.type, reason: code, manualFallback: true },
    });
  }

  private async entityIdForRun(run: {
    id: string;
    interviewId: string | null;
    inputRefs: string | null;
  }): Promise<string> {
    if (run.interviewId) return run.interviewId;
    const input = this.parseJson<Record<string, unknown>>(run.inputRefs);
    const candidateId = (input?.candidate as { id?: string } | undefined)?.id;
    if (candidateId) return candidateId;
    const intake = await this.prisma.resumeIntake.findFirst({
      where: { airRunId: run.id },
      select: { candidateId: true },
    });
    return intake?.candidateId ?? run.id;
  }

  private async interviewAllowedRefs(inputRefs: string | null): Promise<string[]> {
    const input = this.parseJson<InterviewEvalInputLike>(inputRefs);
    if (!input?.transcript?.materialId) return [];
    const material = await this.prisma.interviewTranscriptMaterial.findUnique({
      where: { id: input.transcript.materialId },
      select: { sourceRef: true, segments: true },
    });
    return material ? this.allowedRefs(material) : [];
  }

  private allowedRefs(material: { sourceRef: string; segments: Prisma.JsonValue }): string[] {
    const segments = Array.isArray(material.segments) ? material.segments : [];
    const refs = segments.map((segment) => {
      const index = (segment as { index?: number } | null)?.index;
      return typeof index === 'number' ? `segment:${index}` : null;
    });
    return [material.sourceRef, ...refs.filter((ref): ref is string => Boolean(ref))];
  }

  private async loadRunInScope(id: string, actor: AuthenticatedUser, permission: string) {
    const run = await this.prisma.aIRun.findUnique({ where: { id } });
    if (!run) throw new NotFoundException('AI 任务不存在');

    let intake: { id: string; candidateId: string | null; jobId: string | null } | null = null;
    let candidateId: string | null = null;
    let jobId: string | null = null;

    if (run.type === AiRunType.RESUME_PARSE) {
      intake = await this.prisma.resumeIntake.findFirst({
        where: { airRunId: run.id },
        select: { id: true, candidateId: true, jobId: true },
      });
      candidateId = intake?.candidateId ?? null;
      jobId = intake?.jobId ?? null;
    } else {
      const input = this.parseJson<Record<string, unknown>>(run.inputRefs);
      if (run.type === AiRunType.RESUME_EVAL) {
        candidateId = (input?.candidate as { id?: string } | undefined)?.id ?? null;
        jobId = (input?.job as { id?: string } | undefined)?.id ?? null;
      } else {
        candidateId = (input?.interview as { candidateId?: string } | undefined)?.candidateId ?? null;
        jobId = (input?.interview as { jobId?: string } | undefined)?.jobId ?? null;
      }
    }

    const canReadCandidate = candidateId
      ? await this.authorization.canAccessCandidate(actor, permission, candidateId)
      : false;
    const canReadJob =
      !canReadCandidate && jobId
        ? await this.authorization.canAccessJob(actor, permission, jobId)
        : false;
    if (!canReadCandidate && !canReadJob) throw new NotFoundException('AI 任务不存在');

    return { run, intake, candidateId, jobId };
  }

  private parseInput(value: string | null, intakeId: string): ParseResumeInput {
    const input = this.parseJson<ParseResumeInput>(value);
    if (!input || typeof input.fileName !== 'string') {
      throw new AiProviderError(AI_ERROR_CODES.OUTPUT_INVALID, '解析任务输入缺失，请重新上传简历', {
        retryable: false,
      });
    }
    return { ...input, intakeId: input.intakeId ?? intakeId };
  }

  private parseJson<T>(value: string | null): T | null {
    if (!value) return null;
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }

  private filterSensitiveJson(value: string | null, canReadContacts: boolean): unknown {
    const parsed = this.parseJson<unknown>(value);
    if (parsed === null || canReadContacts) return parsed;
    return maskContacts(parsed);
  }

  private filterSensitiveOutput(type: AiRunType, value: string | null, canReadContacts: boolean): unknown {
    const parsed = this.parseJson<Record<string, unknown>>(value);
    if (parsed === null) return parsed;
    if (canReadContacts) return parsed;
    if (type === AiRunType.RESUME_PARSE) return maskContacts(parsed);
    const output = { ...parsed };
    if (Array.isArray(output.evidence)) {
      output.evidence = [];
      output.evidenceMasked = true;
    }
    return output;
  }

  private usageFields(usage: AiUsage | undefined, providerName: string) {
    return {
      providerName,
      modelName: usage?.model ?? null,
      latencyMs: usage?.latencyMs ?? null,
      promptTokens: usage?.promptTokens ?? null,
      completionTokens: usage?.completionTokens ?? null,
      costMicros: usage?.costMicros ?? null,
    };
  }

  private validationField(warnings: ContractWarning[] | undefined) {
    return {
      validation: warnings?.length ? ({ warnings } as Prisma.InputJsonValue) : Prisma.DbNull,
    };
  }

  private failureValidation(error: unknown) {
    if (error instanceof AiProviderError && 'attempts' in error) {
      const attempts = (error as AiProviderError & { attempts?: unknown }).attempts;
      if (Array.isArray(attempts)) {
        return { validation: { attempts } as Prisma.InputJsonValue };
      }
    }
    return {};
  }
}

function errorCodeOf(error: unknown): string {
  if (error instanceof AiProviderError) return error.code;
  return AI_ERROR_CODES.INTERNAL;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function maskContacts(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskContacts);
  if (!value || typeof value !== 'object') return value;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if ((key === 'phone' || key === 'email') && item && typeof item === 'object') {
      const field = item as Record<string, unknown>;
      result[key] = { ...field, value: null, confidence: 0 };
      continue;
    }
    if (key === 'phone' || key === 'email') {
      result[key] = null;
      continue;
    }
    result[key] = maskContacts(item);
  }
  return result;
}

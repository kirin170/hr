import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AiRunStatus, AiRunType, IntakeStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TimelineService } from '../timeline/timeline.service.js';
import { MODEL_PROVIDER, type ModelProvider } from './model-provider.js';
import type {
  ParseResumeInput,
  ParsedResume,
  ResumeParseResult,
} from './ai.types.js';

@Injectable()
export class AiRunService {
  private readonly logger = new Logger(AiRunService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly timeline: TimelineService,
    @Inject(MODEL_PROVIDER) private readonly provider: ModelProvider,
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

  async getRun(id: string) {
    const run = await this.prisma.aIRun.findUnique({ where: { id } });
    if (!run) {
      throw new NotFoundException(`AI run ${id} not found`);
    }
    return run;
  }

  /** Worker 消费入口：幂等处理一次解析任务 */
  async processParseTask(intakeId: string): Promise<void> {
    const intake = await this.prisma.resumeIntake.findUnique({
      where: { id: intakeId },
    });
    if (!intake || !intake.airRunId) {
      this.logger.warn(`Skip parse task: intake ${intakeId} not found`);
      return;
    }
    if (intake.status === IntakeStatus.DUPLICATE) {
      return;
    }

    const run = await this.prisma.aIRun.findUnique({
      where: { id: intake.airRunId },
    });
    if (!run) {
      return;
    }
    if (run.status === AiRunStatus.SUCCESS) {
      return;
    }

    const input = this.parseInput(run.inputRefs, intakeId);

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
        data: {
          status: IntakeStatus.PARSING,
          attempts: { increment: 1 },
        },
      }),
    ]);

    let result: ResumeParseResult;
    try {
      result = await this.provider.parseResume(input);
    } catch (error) {
      await this.prisma.$transaction([
        this.prisma.aIRun.update({
          where: { id: run.id },
          data: {
            status: AiRunStatus.FAILED,
            errorCode: 'PARSE_FAILED',
            errorMessage: (error as Error).message,
          },
        }),
        this.prisma.resumeIntake.update({
          where: { id: intake.id },
          data: {
            status: IntakeStatus.PARSING,
            errorCode: 'PARSE_FAILED',
            errorMessage: (error as Error).message,
          },
        }),
      ]);
      throw error;
    }

    await this.prisma.$transaction([
      this.prisma.aIRun.update({
        where: { id: run.id },
        data: {
          status: AiRunStatus.SUCCESS,
          output: JSON.stringify(result.output),
          confidence: result.confidence,
          isDraft: true,
          errorCode: null,
          errorMessage: null,
        },
      }),
      this.prisma.resumeIntake.update({
        where: { id: intake.id },
        data: {
          status: IntakeStatus.PARSED,
          errorCode: null,
          errorMessage: null,
        },
      }),
    ]);

    await this.timeline.record({
      entityType: 'ResumeIntake',
      entityId: intake.id,
      action: 'intake.parsed',
      payload: {
        airRunId: run.id,
        candidateId: intake.candidateId,
        attempts: run.attempts + 1,
      },
    });
  }

  /** 重试耗尽后的最终失败：降级人工录入，不阻断主流程（AI-4） */
  async markParseFailed(intakeId: string, error: Error): Promise<void> {
    const intake = await this.prisma.resumeIntake.findUnique({
      where: { id: intakeId },
    });
    if (!intake || !intake.airRunId) {
      return;
    }

    const run = await this.prisma.aIRun.findUnique({
      where: { id: intake.airRunId },
    });
    if (run?.status === AiRunStatus.SUCCESS) {
      return;
    }

    await this.prisma.$transaction([
      this.prisma.aIRun.update({
        where: { id: intake.airRunId },
        data: {
          status: AiRunStatus.FAILED,
          errorCode: 'PARSE_FAILED',
          errorMessage: error.message,
        },
      }),
      this.prisma.resumeIntake.update({
        where: { id: intake.id },
        data: {
          status: IntakeStatus.NEEDS_MANUAL,
          errorCode: 'PARSE_FAILED',
          errorMessage: error.message,
        },
      }),
    ]);

    await this.timeline.record({
      entityType: 'ResumeIntake',
      entityId: intake.id,
      action: 'intake.parse_failed',
      payload: {
        airRunId: intake.airRunId,
        candidateId: intake.candidateId,
        error: error.message,
      },
    });
  }

  /** 人工确认草稿后转正式档案（AI-1 / AI-6） */
  async confirmRun(runId: string, actorId: string | null) {
    const run = await this.getRun(runId);
    if (run.status !== AiRunStatus.SUCCESS || !run.output) {
      throw new BadRequestException(
        `AI run ${runId} has no successful draft to confirm`,
      );
    }

    const intake = await this.prisma.resumeIntake.findFirst({
      where: { airRunId: runId },
    });
    if (!intake?.candidateId) {
      throw new BadRequestException(
        `AI run ${runId} is not linked to a candidate`,
      );
    }

    const draft = JSON.parse(run.output) as ParsedResume;
    const candidate = await this.prisma.candidate.findUnique({
      where: { id: intake.candidateId },
    });
    if (!candidate) {
      throw new NotFoundException(`Candidate ${intake.candidateId} not found`);
    }

    await this.prisma.$transaction([
      this.prisma.candidate.update({
        where: { id: candidate.id },
        data: {
          name: draft.name?.value ?? candidate.name,
          phone: draft.phone?.value ?? candidate.phone,
          email: draft.email?.value ?? candidate.email,
          parsedProfileId: run.id,
        },
      }),
      this.prisma.aIRun.update({
        where: { id: run.id },
        data: {
          isDraft: false,
          confirmedBy: actorId,
          confirmedAt: new Date(),
        },
      }),
    ]);

    await this.timeline.record({
      entityType: 'Candidate',
      entityId: candidate.id,
      action: 'candidate.profile_confirmed',
      actorId,
      payload: { airRunId: run.id, intakeId: intake.id },
    });

    return this.getRun(runId);
  }

  private parseInput(inputRefs: string | null, intakeId: string) {
    try {
      return JSON.parse(inputRefs ?? '{}') as ParseResumeInput;
    } catch {
      this.logger.warn(`Invalid AIRun inputRefs for intake ${intakeId}`);
      return {
        intakeId,
        resumeFileId: null,
        fileName: 'unknown',
      } satisfies ParseResumeInput;
    }
  }
}

import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { AiRunStatus, AiRunType } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuditContext } from '../settings/settings-shared.js';
import { writeAudit } from '../settings/settings-shared.js';
import {
  AI_CONTRACT_VERSION,
  INTERVIEW_EVAL_SCHEMA,
  RESUME_EVAL_SCHEMA,
  RESUME_PARSE_SCHEMA,
  type AiScene,
} from './ai.contract.js';
import {
  AI_ERROR_CODES,
  AiProviderError,
  type ProviderEndpointConfig,
} from './model-provider.js';

export const AI_CONFIG_KEY = 'ai.config';
export const AI_PROVIDER_MODE_ENV = 'AI_PROVIDER_MODE';

export interface AiSceneConfig {
  enabled: boolean;
  templateVersion: string;
  /** 低于该置信度的字段/结论需重点人工核对；不触发任何自动转正式 */
  minConfidenceForReview: number;
}

export interface AiConfigValue {
  version: number;
  enabled: boolean;
  scenes: Record<AiScene, AiSceneConfig>;
  routing: {
    primary: ProviderEndpointConfig;
    fallback: ProviderEndpointConfig;
  };
}

const SCENE_TEMPLATE_VERSIONS: Record<AiScene, string[]> = {
  RESUME_PARSE: [RESUME_PARSE_SCHEMA],
  RESUME_EVAL: [RESUME_EVAL_SCHEMA],
  INTERVIEW_EVAL: [INTERVIEW_EVAL_SCHEMA],
};

const API_KEY_ENVS = {
  primary: 'AI_PRIMARY_API_KEY',
  fallback: 'AI_FALLBACK_API_KEY',
} as const;

function envNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function defaultEndpoint(slot: 'primary' | 'fallback'): ProviderEndpointConfig {
  if (slot === 'primary') {
    return {
      kind: 'DASHSCOPE_QWEN',
      label: 'qwen',
      baseUrl: process.env.AI_PRIMARY_BASE_URL ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: process.env.AI_PRIMARY_MODEL ?? 'qwen-plus',
      apiKeyEnv: API_KEY_ENVS.primary,
      timeoutMs: envNumber('AI_PRIMARY_TIMEOUT_MS', 20_000),
      maxOutputTokens: envNumber('AI_PRIMARY_MAX_TOKENS', 2048),
      inputMicrosPer1kTokens: envNumber('AI_PRIMARY_INPUT_PRICE_MICROS', 0),
      outputMicrosPer1kTokens: envNumber('AI_PRIMARY_OUTPUT_PRICE_MICROS', 0),
      supportsVision: process.env.AI_PRIMARY_VISION !== 'false',
      enabled: true,
    };
  }
  return {
    kind: 'OPENAI_COMPATIBLE',
    label: 'external',
    baseUrl: process.env.AI_FALLBACK_BASE_URL ?? '',
    model: process.env.AI_FALLBACK_MODEL ?? '',
    apiKeyEnv: API_KEY_ENVS.fallback,
    timeoutMs: envNumber('AI_FALLBACK_TIMEOUT_MS', 20_000),
    maxOutputTokens: envNumber('AI_FALLBACK_MAX_TOKENS', 2048),
    inputMicrosPer1kTokens: envNumber('AI_FALLBACK_INPUT_PRICE_MICROS', 0),
    outputMicrosPer1kTokens: envNumber('AI_FALLBACK_OUTPUT_PRICE_MICROS', 0),
    supportsVision: process.env.AI_FALLBACK_VISION === 'true',
    enabled: Boolean(process.env.AI_FALLBACK_BASE_URL && process.env.AI_FALLBACK_MODEL),
  };
}

export function defaultAiConfig(): AiConfigValue {
  return {
    version: 1,
    enabled: true,
    scenes: {
      RESUME_PARSE: { enabled: true, templateVersion: RESUME_PARSE_SCHEMA, minConfidenceForReview: 0.8 },
      RESUME_EVAL: { enabled: true, templateVersion: RESUME_EVAL_SCHEMA, minConfidenceForReview: 0.7 },
      INTERVIEW_EVAL: { enabled: true, templateVersion: INTERVIEW_EVAL_SCHEMA, minConfidenceForReview: 0.7 },
    },
    routing: {
      primary: defaultEndpoint('primary'),
      fallback: defaultEndpoint('fallback'),
    },
  };
}

/** 当前进程的模型模式：mock（默认，非生产）或 live（真实 provider 链）。 */
export function providerMode(): 'mock' | 'live' {
  const mode = (process.env[AI_PROVIDER_MODE_ENV] ?? '').trim().toLowerCase();
  if (mode === 'live' || mode === 'mock') return mode;
  return process.env.NODE_ENV === 'production' || process.env.APP_ENV === 'production' ? 'live' : 'mock';
}

@Injectable()
export class AiConfigService {
  private readonly logger = new Logger(AiConfigService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** 读取生效配置：DB 覆盖优先，缺失字段回落到环境变量默认值。 */
  async getConfig(): Promise<AiConfigValue> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key: AI_CONFIG_KEY } });
    if (!row) return defaultAiConfig();
    try {
      return mergeConfig(defaultAiConfig(), JSON.parse(row.value) as unknown);
    } catch (error) {
      this.logger.warn(`AI 配置解析失败，回落到环境默认值：${(error as Error).message}`);
      return defaultAiConfig();
    }
  }

  /** 后台展示：密钥只返回是否已配置，不返回明文。 */
  async getAdminConfig() {
    const config = await this.getConfig();
    return {
      mode: providerMode(),
      contractVersion: AI_CONTRACT_VERSION,
      config,
      endpoints: [config.routing.primary, config.routing.fallback].map((endpoint) => ({
        ...endpoint,
        apiKeyConfigured: Boolean(process.env[endpoint.apiKeyEnv]),
        baseUrlConfigured: Boolean(endpoint.baseUrl),
      })),
      // 密钥仅能通过部署环境注入，后台不提供读写入口
      secretsEditable: false,
    };
  }

  async updateConfig(value: unknown, actor: AuthenticatedUser, ctx: AuditContext) {
    const body = asRecord(value);
    if (body.version === undefined) {
      throw new BadRequestException('version 为必填项，请传入读取到的版本号');
    }
    const current = await this.getConfig();
    if (body.version !== current.version) {
      throw new BadRequestException('配置已被其他人修改，请刷新后重试');
    }

    const next = mergeConfig(current, body);
    next.version = current.version + 1;

    await this.prisma.$transaction(async (tx) => {
      await tx.systemSetting.upsert({
        where: { key: AI_CONFIG_KEY },
        create: { key: AI_CONFIG_KEY, value: JSON.stringify(next) },
        update: { value: JSON.stringify(next) },
      });
      await writeAudit(tx, actor, ctx, 'ai.config.update', 'AiConfig', AI_CONFIG_KEY, current, next);
    });

    return this.getAdminConfig();
  }

  /** 场景级开关校验：系统关闭或场景关闭时返回 AI_DISABLED。 */
  async assertSceneEnabled(scene: AiScene): Promise<void> {
    const config = await this.getConfig();
    if (!config.enabled) {
      throw new AiProviderError(AI_ERROR_CODES.DISABLED, 'AI 能力已被系统管理员关闭', { retryable: false });
    }
    if (!config.scenes[scene].enabled) {
      throw new AiProviderError(AI_ERROR_CODES.DISABLED, `AI ${scene} 场景已被关闭`, { retryable: false });
    }
  }

  /** 解析可用端点顺序：primary 优先，fallback 兜底；均不可用时由调用方降级人工。 */
  async resolveEndpoints(scene: AiScene, needsImage: boolean): Promise<ProviderEndpointConfig[]> {
    await this.assertSceneEnabled(scene);
    const config = await this.getConfig();
    const candidates = [config.routing.primary, config.routing.fallback].filter((endpoint) => {
      if (!endpoint.enabled) return false;
      if (!endpoint.baseUrl || !endpoint.model) return false;
      if (!process.env[endpoint.apiKeyEnv]) return false;
      if (needsImage && !endpoint.supportsVision) return false;
      return true;
    });
    if (candidates.length === 0) {
      throw new AiProviderError(
        AI_ERROR_CODES.NOT_CONFIGURED,
        needsImage
          ? '未配置支持图片直读的模型服务，无法完成图片简历解析'
          : '未配置可用的模型服务（钉钉/通义优先，外部模型兜底）',
        { retryable: false },
      );
    }
    return candidates;
  }

  /** 后台调用记录与用量：按场景/模型汇总，失败原因保留错误码。 */
  async usageSummary(days = 7) {
    const since = new Date(Date.now() - Math.max(1, Math.min(days, 30)) * 24 * 60 * 60 * 1000);
    const runs = await this.prisma.aIRun.findMany({
      where: { createdAt: { gte: since } },
      select: {
        type: true,
        status: true,
        providerName: true,
        modelName: true,
        latencyMs: true,
        promptTokens: true,
        completionTokens: true,
        costMicros: true,
        errorCode: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 5000,
    });

    const groups = new Map<
      string,
      {
        type: AiRunType;
        provider: string | null;
        model: string | null;
        total: number;
        success: number;
        failed: number;
        latencySum: number;
        latencyCount: number;
        promptTokens: number;
        completionTokens: number;
        costMicros: number;
      }
    >();
    for (const run of runs) {
      const key = `${run.type}|${run.providerName ?? '-'}|${run.modelName ?? '-'}`;
      const group = groups.get(key) ?? {
        type: run.type,
        provider: run.providerName,
        model: run.modelName,
        total: 0,
        success: 0,
        failed: 0,
        latencySum: 0,
        latencyCount: 0,
        promptTokens: 0,
        completionTokens: 0,
        costMicros: 0,
      };
      group.total += 1;
      if (run.status === 'SUCCESS') group.success += 1;
      if (run.status === 'FAILED') group.failed += 1;
      if (run.latencyMs !== null) {
        group.latencySum += run.latencyMs;
        group.latencyCount += 1;
      }
      group.promptTokens += run.promptTokens ?? 0;
      group.completionTokens += run.completionTokens ?? 0;
      group.costMicros += run.costMicros ?? 0;
      groups.set(key, group);
    }

    const failures = new Map<string, number>();
    for (const run of runs) {
      if (run.status !== 'FAILED' || !run.errorCode) continue;
      failures.set(run.errorCode, (failures.get(run.errorCode) ?? 0) + 1);
    }

    return {
      days,
      since: since.toISOString(),
      totals: {
        runs: runs.length,
        success: runs.filter((run) => run.status === 'SUCCESS').length,
        failed: runs.filter((run) => run.status === 'FAILED').length,
        promptTokens: runs.reduce((sum, run) => sum + (run.promptTokens ?? 0), 0),
        completionTokens: runs.reduce((sum, run) => sum + (run.completionTokens ?? 0), 0),
        costMicros: runs.reduce((sum, run) => sum + (run.costMicros ?? 0), 0),
      },
      groups: [...groups.values()].map((group) => ({
        type: group.type,
        provider: group.provider,
        model: group.model,
        total: group.total,
        success: group.success,
        failed: group.failed,
        avgLatencyMs: group.latencyCount > 0 ? Math.round(group.latencySum / group.latencyCount) : null,
        promptTokens: group.promptTokens,
        completionTokens: group.completionTokens,
        costMicros: group.costMicros,
      })),
      failures: [...failures.entries()].map(([code, count]) => ({ code, count })),
      note:
        '成本按配置的千 token 单价估算（微元）；未配置单价时为空，不视为真实账单。Mock 调用的成本恒为 0。',
    };
  }

  async recentRuns(query: { type?: string; status?: string; take?: number }) {
    const type = Object.values(AiRunType).find((item) => item === query.type);
    const status = Object.values(AiRunStatus).find((item) => item === query.status);
    const take = Math.max(1, Math.min(Number(query.take) || 50, 200));
    const runs = await this.prisma.aIRun.findMany({
      where: {
        ...(type ? { type } : {}),
        ...(status ? { status } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true,
        type: true,
        status: true,
        isDraft: true,
        providerName: true,
        modelName: true,
        latencyMs: true,
        promptTokens: true,
        completionTokens: true,
        costMicros: true,
        errorCode: true,
        errorMessage: true,
        attempts: true,
        createdAt: true,
        confirmedAt: true,
      },
    });
    return {
      items: runs,
      note: '只展示调用元数据与失败原因，不返回简历/听记原文；明细通过各业务入口按数据范围查看。',
    };
  }

  /** 职位级 AI 开关列表（AI-3：可按职位关闭评估）。 */
  async listJobSwitches(query: { keyword?: string; take?: number }) {
    const take = Math.max(1, Math.min(Number(query.take) || 100, 200));
    const keyword = query.keyword?.trim();
    const items = await this.prisma.job.findMany({
      where: keyword
        ? { OR: [{ title: { contains: keyword } }, { code: { contains: keyword } }] }
        : {},
      select: { id: true, code: true, title: true, status: true, aiEvalEnabled: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
      take,
    });
    return { items };
  }

  async updateJobSwitch(
    jobId: string,
    value: unknown,
    actor: AuthenticatedUser,
    ctx: AuditContext,
  ) {
    const body = asRecord(value);
    if (typeof body.aiEvalEnabled !== 'boolean') {
      throw new BadRequestException('aiEvalEnabled 必须为布尔值');
    }
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      select: { id: true, title: true, aiEvalEnabled: true },
    });
    if (!job) throw new BadRequestException('职位不存在');

    await this.prisma.$transaction(async (tx) => {
      await tx.job.update({ where: { id: jobId }, data: { aiEvalEnabled: body.aiEvalEnabled as boolean } });
      await writeAudit(
        tx,
        actor,
        ctx,
        'job.ai_eval_switch',
        'Job',
        jobId,
        { aiEvalEnabled: job.aiEvalEnabled },
        { aiEvalEnabled: body.aiEvalEnabled },
      );
    });

    return { id: job.id, title: job.title, aiEvalEnabled: body.aiEvalEnabled };
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('请求体必须是 JSON 对象');
  }
  return value as Record<string, unknown>;
}

function mergeConfig(base: AiConfigValue, patch: unknown): AiConfigValue {
  const body = patch && typeof patch === 'object' && !Array.isArray(patch) ? (patch as Record<string, unknown>) : {};
  const next: AiConfigValue = {
    version: base.version,
    enabled: base.enabled,
    scenes: {
      RESUME_PARSE: { ...base.scenes.RESUME_PARSE },
      RESUME_EVAL: { ...base.scenes.RESUME_EVAL },
      INTERVIEW_EVAL: { ...base.scenes.INTERVIEW_EVAL },
    },
    routing: {
      primary: { ...base.routing.primary },
      fallback: { ...base.routing.fallback },
    },
  };

  if ('enabled' in body) next.enabled = booleanValue(body.enabled, 'enabled');

  if ('scenes' in body) {
    const scenes = asObject(body.scenes, 'scenes');
    for (const scene of Object.keys(SCENE_TEMPLATE_VERSIONS) as AiScene[]) {
      if (!(scene in scenes)) continue;
      const item = asObject(scenes[scene], `scenes.${scene}`);
      if ('enabled' in item) next.scenes[scene].enabled = booleanValue(item.enabled, `scenes.${scene}.enabled`);
      if ('templateVersion' in item) {
        const version = textValue(item.templateVersion, `scenes.${scene}.templateVersion`);
        if (!SCENE_TEMPLATE_VERSIONS[scene].includes(version)) {
          throw new BadRequestException(`scenes.${scene}.templateVersion 仅支持 ${SCENE_TEMPLATE_VERSIONS[scene].join('、')}`);
        }
        next.scenes[scene].templateVersion = version;
      }
      if ('minConfidenceForReview' in item) {
        next.scenes[scene].minConfidenceForReview = numberValue(
          item.minConfidenceForReview,
          `scenes.${scene}.minConfidenceForReview`,
          0,
          1,
        );
      }
    }
  }

  if ('routing' in body) {
    const routing = asObject(body.routing, 'routing');
    for (const slot of ['primary', 'fallback'] as const) {
      if (!(slot in routing)) continue;
      next.routing[slot] = mergeEndpoint(next.routing[slot], asObject(routing[slot], `routing.${slot}`), slot);
    }
  }

  return next;
}

function mergeEndpoint(
  base: ProviderEndpointConfig,
  patch: Record<string, unknown>,
  slot: 'primary' | 'fallback',
): ProviderEndpointConfig {
  const next: ProviderEndpointConfig = { ...base };
  if ('enabled' in patch) next.enabled = booleanValue(patch.enabled, `routing.${slot}.enabled`);
  if ('baseUrl' in patch) {
    const url = textValue(patch.baseUrl, `routing.${slot}.baseUrl`);
    if (url) assertUrl(url, `routing.${slot}.baseUrl`);
    next.baseUrl = url;
  }
  if ('model' in patch) next.model = textValue(patch.model, `routing.${slot}.model`);
  if ('supportsVision' in patch) next.supportsVision = booleanValue(patch.supportsVision, `routing.${slot}.supportsVision`);
  if ('timeoutMs' in patch) next.timeoutMs = numberValue(patch.timeoutMs, `routing.${slot}.timeoutMs`, 1000, 120_000);
  if ('maxOutputTokens' in patch) {
    next.maxOutputTokens = numberValue(patch.maxOutputTokens, `routing.${slot}.maxOutputTokens`, 128, 8192);
  }
  if ('inputMicrosPer1kTokens' in patch) {
    next.inputMicrosPer1kTokens = numberValue(
      patch.inputMicrosPer1kTokens,
      `routing.${slot}.inputMicrosPer1kTokens`,
      0,
      1_000_000,
    );
  }
  if ('outputMicrosPer1kTokens' in patch) {
    next.outputMicrosPer1kTokens = numberValue(
      patch.outputMicrosPer1kTokens,
      `routing.${slot}.outputMicrosPer1kTokens`,
      0,
      1_000_000,
    );
  }
  if ('kind' in patch && patch.kind !== base.kind) {
    throw new BadRequestException(`routing.${slot}.kind 不允许修改（${base.kind}）`);
  }
  if ('apiKeyEnv' in patch && patch.apiKeyEnv !== base.apiKeyEnv) {
    throw new BadRequestException('密钥环境变量名不允许修改，密钥只能由部署环境注入');
  }
  if (next.enabled) {
    if (!next.baseUrl) throw new BadRequestException(`routing.${slot} 启用时必须填写 baseUrl`);
    if (!next.model) throw new BadRequestException(`routing.${slot} 启用时必须填写模型名`);
  }
  return next;
}

function assertUrl(value: string, path: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new BadRequestException(`${path} 必须是合法 URL`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new BadRequestException(`${path} 仅支持 http/https`);
  }
}

function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new BadRequestException(`${path} 必须为布尔值`);
  return value;
}

function numberValue(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new BadRequestException(`${path} 必须为 ${min}–${max} 的数字`);
  }
  return value;
}

function textValue(value: unknown, path: string): string {
  if (typeof value !== 'string') throw new BadRequestException(`${path} 必须为字符串`);
  const trimmed = value.trim();
  if (trimmed.length > 300) throw new BadRequestException(`${path} 不能超过 300 个字符`);
  return trimmed;
}

function asObject(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException(`${path} 必须为对象`);
  }
  return value as Record<string, unknown>;
}

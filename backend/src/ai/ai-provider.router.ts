import { Inject, Injectable, Optional } from '@nestjs/common';
import { AiConfigService, providerMode } from './ai-config.service.js';
import { MockModelProvider } from './mock-model.provider.js';
import {
  AI_ERROR_CODES,
  AiProviderError,
  type AiProviderAttempt,
  type ModelProvider,
  type ProviderEndpointConfig,
} from './model-provider.js';
import { OpenAiCompatibleProvider } from './openai-compatible.provider.js';
import type { AiScene } from './ai.contract.js';

export type { AiProviderAttempt } from './model-provider.js';

/** 端点 → provider 实例工厂；测试可注入替身，生产默认使用 OpenAI 兼容实现。 */
export const AI_PROVIDER_FACTORY = Symbol('AI_PROVIDER_FACTORY');
export type AiProviderFactory = (endpoint: ProviderEndpointConfig) => ModelProvider;

/** 主选 + 兜底全部失败：保留每次尝试的原因，供后台与运行记录展示。 */
export class AiProviderChainError extends AiProviderError {
  constructor(readonly attempts: AiProviderAttempt[]) {
    const detail = attempts
      .map((attempt) => `${attempt.provider}:${attempt.code}`)
      .join(' -> ');
    super(
      AI_ERROR_CODES.ALL_FAILED,
      attempts.length > 0 ? `全部模型服务调用失败（${detail}）` : '没有可用的模型服务',
      { retryable: attempts.some((attempt) => attempt.retryable) },
    );
    this.name = 'AiProviderChainError';
  }
}

/**
 * 场景路由：钉钉/通义优先，外部模型兜底（技术设计 §0.3）。
 *
 * - 主选不可用或输出不满足契约时按配置自动兜底；
 * - 兜底也失败时抛出带尝试明细的错误，由调用方降级为人工处理；
 * - 主选与兜底共用同一 ModelProvider 契约与责任边界（草稿、人工确认、不自动流转）。
 */
@Injectable()
export class AiProviderRouter {
  private readonly mockProvider: ModelProvider;
  private readonly providerFactory: AiProviderFactory;

  constructor(
    private readonly config: AiConfigService,
    @Optional() @Inject(AI_PROVIDER_FACTORY) factory?: AiProviderFactory,
  ) {
    this.providerFactory =
      factory ??
      ((endpoint) => new OpenAiCompatibleProvider(endpoint, process.env[endpoint.apiKeyEnv] ?? ''));
    this.mockProvider = new MockModelProvider(process.env.AI_MOCK_OUTCOME === 'FAIL' ? 'FAIL' : 'SUCCESS');
  }

  async run<T>(
    scene: AiScene,
    options: { needsImage: boolean },
    call: (provider: ModelProvider) => Promise<T>,
  ): Promise<{ result: T; provider: ModelProvider }> {
    const providers = await this.chain(scene, options.needsImage);
    const attempts: AiProviderAttempt[] = [];

    for (const provider of providers) {
      if (options.needsImage && !provider.capabilities.image) {
        attempts.push({
          provider: provider.name,
          code: AI_ERROR_CODES.CAPABILITY_UNSUPPORTED,
          message: '该模型不支持图片直读',
          retryable: false,
          latencyMs: 0,
        });
        continue;
      }
      const startedAt = Date.now();
      try {
        const result = await call(provider);
        return { result, provider };
      } catch (error) {
        const failure =
          error instanceof AiProviderError
            ? error
            : new AiProviderError(AI_ERROR_CODES.INTERNAL, (error as Error).message, {
                provider: provider.name,
              });
        attempts.push({
          provider: provider.name,
          code: failure.code,
          message: failure.message,
          retryable: failure.retryable,
          latencyMs: Date.now() - startedAt,
        });
      }
    }

    throw new AiProviderChainError(attempts);
  }

  /** 供后台展示当前场景的可用链路（不含密钥）。 */
  async describeChain(scene: AiScene, needsImage: boolean): Promise<string[]> {
    const providers = await this.chain(scene, needsImage);
    return providers.map((provider) => provider.name);
  }

  private async chain(scene: AiScene, needsImage: boolean): Promise<ModelProvider[]> {
    if (providerMode() === 'mock') {
      return [this.mockProvider];
    }
    const endpoints = await this.config.resolveEndpoints(scene, needsImage);
    return endpoints.map((endpoint) => this.providerFactory(endpoint));
  }
}

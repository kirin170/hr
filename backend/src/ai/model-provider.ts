import type { ParseResumeInput, ResumeParseResult } from './ai.types.js';

export const MODEL_PROVIDER = Symbol('MODEL_PROVIDER');

/** 可替换的模型适配层（技术设计 §8.2），换模型不影响主流程 */
export interface ModelProvider {
  readonly name: string;
  parseResume(input: ParseResumeInput): Promise<ResumeParseResult>;
}

export class AiProviderError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AiProviderError';
  }
}

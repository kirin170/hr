import {
  AiProviderError,
  AI_ERROR_CODES,
  type InterviewEvalRequest,
  type InterviewEvalResult,
  type ModelProvider,
  type ProviderCapabilities,
  type ProviderEndpointConfig,
  type ResumeEvalRequest,
  type ResumeEvalResult,
  type ResumeParseRequest,
} from './model-provider.js';
import type { AiUsage, ResumeContent, ResumeParseResult } from './ai.types.js';
import {
  validateInterviewEval,
  validateResumeEval,
  validateResumeParse,
} from './ai.contract.js';

type ChatMessage = {
  role: 'system' | 'user';
  content: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;
};

type ChatCompletionResponse = {
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
};

const PARSE_PROMPT = `你是招聘简历解析助手。请只输出 JSON 对象，不要输出 Markdown 或解释。
JSON 结构必须为：
{"name":{"value":string|null,"confidence":number},"phone":{"value":string|null,"confidence":number},"email":{"value":string|null,"confidence":number},"education":{"value":string|null,"confidence":number},"school":{"value":string|null,"confidence":number},"experiences":[{"company":string,"title":string,"period":string?}],"skills":[string]}
confidence 取 0 到 1。无法确认的字段 value 置为 null 且 confidence 不高于 0.3。不要编造简历中不存在的信息。`;

const EVAL_PROMPT = `你是招聘评估助手。请只输出 JSON 对象，不要输出 Markdown 或解释。
JSON 结构必须为：
{"verdict":"符合"或"不符合","score":1到5的整数,"rationale":string,"missingPoints":[string],"evidence":[{"quote":string,"sourceRef":string}],"confidence":number}
rationale 必须说明判断依据并引用招聘要求中的要点；missingPoints 列出简历未覆盖的要求（无则空数组）；
evidence 引用简历原文片段，sourceRef 固定为 RESUME_REF。confidence 取 0 到 1，仅辅助核对。
评估只作参考信号，不得给出录用决定。`;

const INTERVIEW_PROMPT = `你是面试评估助手。请只输出 JSON 对象，不要输出 Markdown 或解释。
JSON 结构必须为：
{"suggestion":"建议录用"或"不建议"或"待定","rationale":string,"evidence":[{"quote":string,"sourceRef":string}],"missingPoints":[string],"confidence":number}
rationale 必须引用听记与面试评价中的事实；missingPoints 列出信息缺口；
evidence 的 quote 必须是听记原文片段，sourceRef 只能取用户消息中列出的可引用定位之一，禁止编造。
钉钉听记内置智能纪要不得作为结论依据；最终录用结论由人工确认。`;

/**
 * OpenAI 兼容协议适配器（技术设计 §0.3）。
 *
 * 通义千问 DashScope 兼容模式与外部模型兜底共用同一实现，差异只在 baseUrl/model/密钥环境变量。
 * 只做协议与契约校验，不重试：重试由队列按 attempts 控制，避免重复计费。
 */
export class OpenAiCompatibleProvider implements ModelProvider {
  readonly name: string;
  readonly kind: ProviderEndpointConfig['kind'];
  readonly capabilities: ProviderCapabilities;

  constructor(
    private readonly config: ProviderEndpointConfig,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.name = config.label;
    this.kind = config.kind;
    this.capabilities = {
      text: true,
      image: config.supportsVision,
      structuredOutput: true,
    };
  }

  async parseResume(request: ResumeParseRequest): Promise<ResumeParseResult> {
    const startedAt = Date.now();
    const { content } = request;
    const response = await this.chat(
      [
        { role: 'system', content: PARSE_PROMPT },
        { role: 'user', content: this.resumeContent(content, '请解析这份简历并按要求输出 JSON。') },
      ],
      'RESUME_PARSE',
    );
    const { output, warnings } = validateResumeParse(this.parseJson(response.content, 'RESUME_PARSE'));
    return {
      output,
      confidence: {
        name: output.name.confidence,
        phone: output.phone.confidence,
        email: output.email.confidence,
        education: output.education.confidence,
        school: output.school.confidence,
      },
      ...(warnings.length > 0 ? { warnings } : {}),
      usage: this.usage(response.usage, startedAt, content.text),
    };
  }

  async evaluateResume(request: ResumeEvalRequest): Promise<ResumeEvalResult> {
    const startedAt = Date.now();
    const { input, content } = request;
    const prompt = [
      `职位：${input.job.title}`,
      `招聘要求：\n${input.job.requirements || '（未填写）'}`,
      `可引用定位：RESUME_REF`,
      '请依据简历文本与招聘要求完成评估。',
    ].join('\n');
    const response = await this.chat(
      [
        { role: 'system', content: EVAL_PROMPT },
        { role: 'user', content: this.resumeContent(content, prompt) },
      ],
      'RESUME_EVAL',
    );
    const { output, warnings } = validateResumeEval(this.parseJson(response.content, 'RESUME_EVAL'));
    return {
      output,
      confidence: { verdict: output.confidence ?? 0.5, score: output.confidence ?? 0.5 },
      ...(warnings.length > 0 ? { warnings } : {}),
      usage: this.usage(response.usage, startedAt, `${content.text ?? ''}${prompt}`),
    };
  }

  async evaluateInterview(request: InterviewEvalRequest): Promise<InterviewEvalResult> {
    const startedAt = Date.now();
    const { input, transcriptText, allowedSourceRefs } = request;
    const feedbackText = input.feedback
      .map((item) => `面试官(${item.interviewerId}) 结论：${item.conclusion ?? '未填'}；评价：${item.content}`)
      .join('\n');
    const prompt = [
      `面试轮次：第 ${input.interview.round} 轮，形式：${input.interview.mode}`,
      `职位招聘要求：\n${input.jobRequirements.text || '（未填写）'}`,
      `面试评价上下文：\n${feedbackText || '（暂无）'}`,
      `可引用定位（sourceRef 只能取以下值）：${allowedSourceRefs.join('、') || '（无）'}`,
      `听记转写：\n${transcriptText}`,
      '请给出面试评估建议草稿。',
    ].join('\n');
    const response = await this.chat(
      [
        { role: 'system', content: INTERVIEW_PROMPT },
        { role: 'user', content: prompt },
      ],
      'INTERVIEW_EVAL',
    );
    const { output, warnings } = validateInterviewEval(
      this.parseJson(response.content, 'INTERVIEW_EVAL'),
      allowedSourceRefs,
    );
    return {
      output,
      confidence: { suggestion: output.confidence ?? 0.5 },
      ...(warnings.length > 0 ? { warnings } : {}),
      usage: this.usage(response.usage, startedAt, prompt),
    };
  }

  private resumeContent(content: ResumeContent, instruction: string): ChatMessage['content'] {
    if (content.imageDataUrl) {
      return [
        { type: 'text', text: instruction },
        { type: 'image_url', image_url: { url: content.imageDataUrl } },
      ];
    }
    return `${instruction}\n\n简历文本：\n${content.text ?? ''}`;
  }

  private async chat(messages: ChatMessage[], scene: string): Promise<{ content: string; usage?: ChatCompletionResponse['usage'] }> {
    if (!this.apiKey) {
      throw new AiProviderError(
        AI_ERROR_CODES.NOT_CONFIGURED,
        `${this.name} 未配置 API Key（环境变量 ${this.config.apiKeyEnv}）`,
        { retryable: false, provider: this.name },
      );
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages,
          temperature: 0.1,
          max_tokens: this.config.maxOutputTokens,
          response_format: { type: 'json_object' },
        }),
        signal: controller.signal,
      });
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        throw new AiProviderError(
          AI_ERROR_CODES.TIMEOUT,
          `${this.name} 调用超时（${this.config.timeoutMs}ms）`,
          { retryable: true, provider: this.name },
        );
      }
      throw new AiProviderError(
        AI_ERROR_CODES.HTTP_ERROR,
        `${this.name} 调用失败：${(error as Error).message}`,
        { retryable: true, provider: this.name },
      );
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
    if (!response.ok) {
      throw new AiProviderError(
        AI_ERROR_CODES.HTTP_ERROR,
        `${this.name} 返回 HTTP ${response.status}（${scene}）：${text.slice(0, 200)}`,
        {
          retryable: response.status === 429 || response.status >= 500,
          status: response.status,
          provider: this.name,
        },
      );
    }

    let body: ChatCompletionResponse;
    try {
      body = JSON.parse(text) as ChatCompletionResponse;
    } catch {
      throw new AiProviderError(AI_ERROR_CODES.BAD_RESPONSE, `${this.name} 返回非 JSON 响应`, {
        retryable: true,
        provider: this.name,
      });
    }
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new AiProviderError(AI_ERROR_CODES.BAD_RESPONSE, `${this.name} 未返回内容`, {
        retryable: true,
        provider: this.name,
      });
    }
    return { content, usage: body.usage };
  }

  private parseJson(content: string, scene: string): unknown {
    const trimmed = content
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '');
    try {
      return JSON.parse(trimmed);
    } catch {
      throw new AiProviderError(
        AI_ERROR_CODES.BAD_RESPONSE,
        `${this.name} 输出不是合法 JSON（${scene}）`,
        { retryable: true, provider: this.name },
      );
    }
  }

  private usage(
    usage: ChatCompletionResponse['usage'],
    startedAt: number,
    promptText: string | null,
  ): AiUsage {
    const promptTokens = usage?.prompt_tokens ?? null;
    const completionTokens = usage?.completion_tokens ?? null;
    const priced = this.config.inputMicrosPer1kTokens > 0 || this.config.outputMicrosPer1kTokens > 0;
    const costMicros =
      priced && (promptTokens !== null || completionTokens !== null)
        ? Math.round(
            ((promptTokens ?? 0) * this.config.inputMicrosPer1kTokens +
              (completionTokens ?? 0) * this.config.outputMicrosPer1kTokens) /
              1000,
          )
        : null;
    return {
      provider: this.name,
      model: this.config.model,
      latencyMs: Date.now() - startedAt,
      promptTokens: promptTokens ?? (promptText ? Math.ceil(promptText.length / 4) : null),
      completionTokens,
      costMicros,
    };
  }
}

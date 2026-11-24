import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { DingTalkApiClient, DingTalkApiError } from './dingtalk-api.client.js';

/** 审批实例 ID：仅接受钉钉实际使用的字符集，拒绝路径、查询串等注入内容。 */
export const APPROVAL_INSTANCE_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

/** 钉钉“审批实例开始、结束、终止”事件类型；落库的 eventType 形如 bpms_instance_change:finish:requisition。 */
export const APPROVAL_EVENT_TYPE = 'bpms_instance_change';

export type DingTalkApprovalFormField = {
  id: string | null;
  name: string | null;
  value: string | null;
  componentType: string | null;
  bizAlias: string | null;
  extValue: string | null;
};

export type DingTalkApprovalInstance = {
  processInstanceId: string;
  title: string | null;
  /** 统一大写：NEW / RUNNING / COMPLETED / TERMINATED */
  status: string;
  /** 统一小写：agree / refuse；未结束时为空 */
  result: string | null;
  createTime: Date | null;
  finishTime: Date | null;
  originatorUserId: string | null;
  originatorDeptId: number | null;
  originatorDeptName: string | null;
  businessId: string | null;
  form: DingTalkApprovalFormField[];
};

export type DingTalkApproverLevel = { actionType: 'AND' | 'OR' | 'NONE'; userIds: string[] };

export type DingTalkStartApprovalInput = {
  processCode: string;
  originatorUserId: string;
  deptId: number;
  formComponentValues: { name: string; value: string }[];
  approvers: DingTalkApproverLevel[];
};

export type OaFailureKind = 'NOT_CONFIGURED' | 'INVALID' | 'NOT_FOUND' | 'DENIED' | 'UNAVAILABLE';

/** 钉钉 OA 调用失败：只保留错误码，不携带审批内容、表单值或令牌。 */
export class DingTalkOaError extends Error {
  constructor(
    readonly kind: OaFailureKind,
    readonly code: string,
  ) {
    super('钉钉 OA 审批接口调用失败');
    this.name = 'DingTalkOaError';
  }
}

/**
 * 从审批实例 ID 或审批详情链接中解析实例 ID。
 * 钉钉审批详情链接形如 …processInstanceDetail?procInstId=xxx 或 …/processInstances/xxx。
 */
export function parseApprovalInstanceRef(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const value = raw.trim();
  if (APPROVAL_INSTANCE_ID_PATTERN.test(value)) return value;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol)) return null;
  const candidates = [
    url.searchParams.get('procInstId'),
    url.searchParams.get('processInstanceId'),
    /\/processInstances\/([A-Za-z0-9_-]+)/.exec(url.pathname)?.[1] ?? null,
  ];
  return candidates.find((candidate) => candidate && APPROVAL_INSTANCE_ID_PATTERN.test(candidate)) ?? null;
}

/**
 * 钉钉 OA 审批适配器（DT-5 / DT-6）。
 * 官方接口（2026-11-24 按 @alicloud/dingtalk 2.2.58 工作流模型核对）：
 * - 查询实例：GET /v1.0/workflow/processInstances?processInstanceId=
 * - 发起实例：POST /v1.0/workflow/processInstances
 * 本适配器只实现“发起一次实例”和“只读查询”，不提供撤销、评论或修改原单的能力。
 */
@Injectable()
export class DingTalkOaClient {
  constructor(private readonly api: DingTalkApiClient) {}

  async getInstance(processInstanceId: string): Promise<DingTalkApprovalInstance> {
    assertInstanceId(processInstanceId);
    const payload = await this.call('GET', '/v1.0/workflow/processInstances', {
      query: { processInstanceId },
    });
    return normalizeApprovalInstance(payload, processInstanceId);
  }

  async startInstance(input: DingTalkStartApprovalInput): Promise<{ id: string }> {
    if (!input.processCode || !input.originatorUserId) {
      throw new DingTalkOaError('INVALID', 'OA_START_INPUT_INVALID');
    }
    const payload = await this.call('POST', '/v1.0/workflow/processInstances', {
      body: {
        processCode: input.processCode,
        originatorUserId: input.originatorUserId,
        deptId: input.deptId,
        formComponentValues: input.formComponentValues,
        ...(input.approvers.length ? { approvers: input.approvers } : {}),
      },
    });
    const id = record(payload)?.id;
    if (typeof id !== 'string' || !APPROVAL_INSTANCE_ID_PATTERN.test(id)) {
      throw new DingTalkOaError('INVALID', 'OA_START_RESPONSE_INVALID');
    }
    return { id };
  }

  private async call(
    method: 'GET' | 'POST',
    path: string,
    options: { query?: Record<string, string>; body?: unknown },
  ): Promise<unknown> {
    try {
      return await this.api.requestOpenApi(method, path, options);
    } catch (error) {
      throw this.classify(error);
    }
  }

  private classify(error: unknown): DingTalkOaError {
    if (error instanceof DingTalkOaError) return error;
    // 应用凭据未注入时通用客户端抛出 ServiceUnavailableException，这里归一为未配置。
    if (error instanceof ServiceUnavailableException) {
      return new DingTalkOaError('NOT_CONFIGURED', 'OA_NOT_CONFIGURED');
    }
    if (!(error instanceof DingTalkApiError)) {
      return new DingTalkOaError('UNAVAILABLE', 'OA_UNKNOWN_ERROR');
    }
    const code = String(error.code);
    if (error.retryable) return new DingTalkOaError('UNAVAILABLE', code);
    if (code.includes('Forbidden') || code.includes('PermissionDenied') || code.includes('AccessDenied')) {
      return new DingTalkOaError('DENIED', code);
    }
    if (code.includes('NotExist') || code.includes('NotFound') || code.includes('notFound') || code === 'http_404') {
      return new DingTalkOaError('NOT_FOUND', code);
    }
    return new DingTalkOaError('INVALID', code);
  }
}

export function assertInstanceId(processInstanceId: string): void {
  if (!APPROVAL_INSTANCE_ID_PATTERN.test(processInstanceId)) {
    throw new DingTalkOaError('INVALID', 'OA_INSTANCE_ID_INVALID');
  }
}

/** 兼容两种官方返回形态：字段平铺，或包在 result 对象内（result.result 为结论字符串）。 */
export function normalizeApprovalInstance(payload: unknown, processInstanceId: string): DingTalkApprovalInstance {
  const outer = record(payload);
  const nested = record(outer?.result);
  const inner = nested && ('status' in nested || 'formComponentValues' in nested || 'formComponents' in nested)
    ? nested
    : outer;
  if (!inner) throw new DingTalkOaError('INVALID', 'OA_INSTANCE_RESPONSE_INVALID');
  if (outer && outer.success === false) throw new DingTalkOaError('INVALID', 'OA_INSTANCE_RESPONSE_FAILED');

  const fields = Array.isArray(inner.formComponentValues)
    ? inner.formComponentValues
    : Array.isArray(inner.formComponents)
      ? inner.formComponents
      : [];

  return {
    processInstanceId,
    title: text(inner.title),
    status: text(inner.status)?.toUpperCase() ?? 'UNKNOWN',
    // 包在 result 对象内时，result.result 才是 agree/refuse 结论。
    result: text(inner.result)?.toLowerCase() ?? null,
    createTime: moment(inner.createTime),
    finishTime: moment(inner.finishTime),
    originatorUserId: text(inner.originatorUserId),
    originatorDeptId: integer(inner.originatorDeptId),
    originatorDeptName: text(inner.originatorDeptName),
    businessId: text(inner.businessId),
    form: fields.flatMap((field) => {
      const item = record(field);
      if (!item) return [];
      const props = record(item.props);
      // 旧形态使用 props.id / props.title，新形态直接使用 id / name。
      const componentType = text(item.componentType ?? props?.componentType);
      return [{
        id: text(item.id ?? props?.id),
        name: text(item.name ?? item.title ?? props?.title ?? props?.label),
        value: typeof item.value === 'string' ? item.value : item.value == null ? null : JSON.stringify(item.value),
        componentType,
        bizAlias: text(item.bizAlias),
        extValue: text(item.extValue),
      }];
    }),
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : typeof value === 'number' ? String(value) : null;
}

function integer(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number(text(value));
  return Number.isSafeInteger(number) ? number : null;
}

/** 官方返回 yyyy-MM-ddTHH:mmZ（UTC）；兼容毫秒时间戳与带时区的 ISO 字符串。 */
function moment(value: unknown): Date | null {
  const raw = text(value);
  if (!raw) return null;
  if (/^\d{13}$/.test(raw)) return new Date(Number(raw));
  if (!/^\d{4}-\d{2}-\d{2}/.test(raw)) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

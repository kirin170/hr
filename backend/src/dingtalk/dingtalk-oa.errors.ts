import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DingTalkOaError } from './dingtalk-oa.client.js';

/**
 * OA 对接的业务失败：code 写入同步事件 lastError 供管理员定位，message 面向人事。
 * 这类失败重试也不会成功，同步事件直接置为 FAILED，由人工处理。
 */
export class OaSyncError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly httpStatus: number = 409,
  ) {
    super(message);
    this.name = 'OaSyncError';
  }
}

/** 把平台错误转换为对外 HTTP 异常；信息里只含归一后的说明，不含平台原始响应。 */
export function oaErrorToHttp(error: unknown, action: string): Error {
  if (error instanceof OaSyncError) {
    return httpException(error.httpStatus, error.code, error.message);
  }
  if (!(error instanceof DingTalkOaError)) return error instanceof Error ? error : new Error(`${action}失败`);
  switch (error.kind) {
    case 'NOT_CONFIGURED':
      return httpException(503, 'OA_NOT_CONFIGURED', '钉钉 OA 正式接入尚未配置');
    case 'DENIED':
      return httpException(403, 'OA_PERMISSION_DENIED', `${action}被拒绝：应用缺少对应 OA 审批权限，请联系管理员`);
    case 'NOT_FOUND':
      return httpException(404, 'OA_INSTANCE_NOT_FOUND', 'OA 审批实例不存在或应用无权查看');
    case 'UNAVAILABLE':
      return httpException(
        503,
        'OA_UNAVAILABLE',
        `${action}结果未知：钉钉 OA 暂不可用，请稍后刷新状态，或在钉钉「我发起的审批」中核对后再重试`,
      );
    default:
      return httpException(400, 'OA_START_REJECTED', `${action}被拒绝：OA 模板或参数配置有误`);
  }
}

/** 业务错误以 `{ code, message }` 作为响应体，前端与脚本可按 code 判断，不依赖中文提示。 */
function httpException(status: number, code: string, message: string): Error {
  const body = { code, message };
  switch (status) {
    case 400:
      return new BadRequestException(body);
    case 403:
      return new ForbiddenException(body);
    case 404:
      return new NotFoundException(body);
    case 503:
      return new ServiceUnavailableException(body);
    default:
      return new ConflictException(body);
  }
}

export function oaErrorCode(error: unknown): string {
  if (error instanceof OaSyncError || error instanceof DingTalkOaError) return error.code.slice(0, 80);
  if (error && typeof error === 'object' && 'code' in error) {
    return String((error as { code: unknown }).code).slice(0, 80);
  }
  return 'oa_sync_failed';
}

/** The submit API has no client idempotency key: a timeout is an unknown outcome, not a safe retry. */
export class WorkNoticeError extends Error {
  constructor(readonly code: string, readonly outcome: 'REJECTED' | 'RETRYABLE' | 'UNKNOWN' | 'READ_RETRY') {
    super('钉钉工作通知接口失败');
  }
}

export class DingTalkWorkNoticeClient {
  async send(token: string, agentId: string, recipientUserId: string, content: string): Promise<string> {
    if (!/^[1-9]\d*$/.test(agentId) || !Number.isSafeInteger(Number(agentId)) || !recipientUserId || recipientUserId.includes(',') || !content || content.length > 2000) throw new WorkNoticeError('invalid_request', 'REJECTED');
    const data = await this.request('topapi/message/corpconversation/asyncsend_v2', token, {
      agent_id: Number(agentId), userid_list: recipientUserId, to_all_user: false,
      msg: { msgtype: 'text', text: { content } },
    }, false);
    const task = data.task_id;
    if (typeof task === 'number' && Number.isSafeInteger(task) && task > 0) return String(task);
    if (typeof task === 'string' && /^[1-9]\d*$/.test(task)) return task;
    throw new WorkNoticeError('invalid_task_id', 'UNKNOWN');
  }

  async result(token: string, agentId: string, taskId: string): Promise<Record<string, unknown>> {
    if (!/^[1-9]\d*$/.test(agentId) || !Number.isSafeInteger(Number(agentId)) || !/^[1-9]\d{0,18}$/.test(taskId)) throw new WorkNoticeError('invalid_request', 'REJECTED');
    return this.request('topapi/message/corpconversation/getsendresult', token, { agent_id: Number(agentId), task_id: taskId }, true);
  }

  private async request(path: string, token: string, body: unknown, readOnly: boolean): Promise<Record<string, unknown>> {
    if (!token) throw new WorkNoticeError('missing_token', 'REJECTED');
    const url = new URL(`https://oapi.dingtalk.com/${path}`);
    url.searchParams.set('access_token', token);
    let response: Response;
    try {
      const encodedBody = JSON.stringify(body).replace(/"task_id":"([1-9]\d{0,18})"/, '"task_id":$1');
      response = await fetch(url.toString(), { method: 'POST', headers: { 'content-type': 'application/json' }, body: encodedBody, signal: AbortSignal.timeout(8_000) });
    } catch { throw new WorkNoticeError('network_error', readOnly ? 'READ_RETRY' : 'UNKNOWN'); }
    if (!response.ok) throw new WorkNoticeError(`http_${response.status}`, readOnly ? 'READ_RETRY' : 'UNKNOWN');
    let value: unknown;
    try {
      const raw = await response.text();
      // Preserve 64-bit task IDs without converting them through an imprecise JS number.
      value = JSON.parse(raw.replace(/"task_id"\s*:\s*([1-9]\d*)\b/g, '"task_id":"$1"')) as unknown;
    } catch { throw new WorkNoticeError('invalid_response', readOnly ? 'READ_RETRY' : 'UNKNOWN'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new WorkNoticeError('invalid_response', readOnly ? 'READ_RETRY' : 'UNKNOWN');
    const data = value as Record<string, unknown>;
    const code = data.errcode;
    if (code !== 0 && code !== '0') {
      const safeCode = typeof code === 'number' && Number.isSafeInteger(code) ? String(code) : typeof code === 'string' && /^\d{1,12}$/.test(code) ? code : 'invalid_response';
      const retryable = ['88', '90002', '90018', '40001', '40014'].includes(safeCode);
      const rejected = ['40003', '40013'].includes(safeCode);
      throw new WorkNoticeError(safeCode, readOnly ? 'READ_RETRY' : retryable ? 'RETRYABLE' : rejected ? 'REJECTED' : 'UNKNOWN');
    }
    return data;
  }
}

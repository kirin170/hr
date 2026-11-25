/**
 * 标准错误码 → 用户可读反馈（ATS-010 契约 BROWSER_IMPORT_ERROR）。
 *
 * 扩展只按 code 分支，不解析服务端文案；未知码回落到通用提示并保留 code 供排查。
 * 这里不含任何平台凭据或页面原文。
 */
export const ERROR_MESSAGES = {
  TOKEN_INVALID: { text: '导入令牌无效，请重新授权。', action: 'reauth' },
  TOKEN_EXPIRED: { text: '导入令牌已过期，请重新授权。', action: 'reauth' },
  TOKEN_OWNER_MISMATCH: { text: '令牌与当前登录账号不一致，请重新授权。', action: 'reauth' },
  REQUEST_ID_REQUIRED: { text: '请求标识缺失，请重试。', action: 'retry' },
  SOURCE_SITE_UNSUPPORTED: { text: '该站点尚未支持导入。', action: 'none' },
  SOURCE_URL_INVALID: { text: '页面地址不可用，请在候选人详情页重试。', action: 'none' },
  THIRD_PARTY_CREDENTIAL_REJECTED: { text: '请求包含第三方凭据，已被拒绝。扩展不会保存招聘网站账号信息。', action: 'none' },
  PAYLOAD_REQUIRED: { text: '没有可导入的内容，请确认页面资料或简历附件。', action: 'none' },
  ATTACHMENT_UNAVAILABLE: { text: '简历附件获取失败，请重试或改用手工上传。', action: 'retry' },
  ATTACHMENT_INVALID: { text: '简历附件格式或大小不合规。', action: 'none' },
  JOB_NOT_FOUND: { text: '目标职位不存在或无权访问，请重新选择职位。', action: 'reselect' },
  TASK_NOT_FOUND: { text: '任务不存在或不属于当前账号。', action: 'none' },
};

/** 传输层失败与服务端错误统一成一个结构，便于 UI 分支。 */
export function describeError(payload, httpStatus) {
  // 服务端目前把标准错误码放在 message 里（Nest 异常体），契约字段 code/errorCode 也一并接受。
  // 只认与已知码完全相等的 message，不去解析任意文案。
  const candidates = [payload?.code, payload?.errorCode, payload?.message];
  const code = candidates.find((value) => typeof value === 'string' && ERROR_MESSAGES[value]) ?? null;
  if (code) return { code, ...ERROR_MESSAGES[code] };
  const unknown = candidates.find((value) => typeof value === 'string' && /^[A-Z][A-Z0-9_]{2,60}$/.test(value));
  if (unknown) return { code: unknown, text: `导入失败（${unknown}），请稍后重试或联系人事。`, action: 'retry' };
  if (httpStatus === 401 || httpStatus === 403) return { code: null, text: '登录态或权限不足，请重新授权。', action: 'reauth' };
  if (httpStatus >= 500) return { code: null, text: '服务暂时不可用，请稍后重试。', action: 'retry' };
  return { code: null, text: '导入失败，请稍后重试。', action: 'retry' };
}

/** 任务终态 → 结果提示；DUPLICATE 是待人工选择，不是失败。 */
export function describeTask(task) {
  switch (task?.status) {
    case 'SUCCESS': return { tone: 'ok', text: '已导入，等待人事确认解析结果。' };
    case 'DUPLICATE': return { tone: 'warn', text: '疑似重复候选人，已转人工选择，不会重复建档。' };
    case 'FAILED': return { tone: 'error', ...describeError({ code: task.errorCode }, 200) };
    case 'RECEIVED':
    case 'PARSING': return { tone: 'pending', text: '已提交，正在解析…' };
    default: return { tone: 'pending', text: '已提交。' };
  }
}
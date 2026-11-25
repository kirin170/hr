/**
 * ATS 导入 API 客户端（对接 ATS-010 已交付契约）。
 *
 * 边界：
 * - 只持有 TalentFlow 的短期系统令牌，且放在会话存储里，浏览器关闭即失效；
 *   绝不读取、保存或转发招聘网站的 cookie / token / 账号信息。
 * - 附件必须由扩展取到字节后以 multipart 上传，不把 URL 交给服务端下载。
 * - 所有请求都由用户点击触发，本模块不在页面加载时自动运行。
 */
import { describeError } from './errors.js';

export const TOKEN_KEY = 'atsSystemToken';

/** 会话存储：默认 chrome.storage.session，测试可注入内存实现。 */
export function defaultStore() {
  return {
    async get() {
      const got = await chrome.storage.session.get(TOKEN_KEY);
      return got[TOKEN_KEY] ?? null;
    },
    async set(value) { await chrome.storage.session.set({ [TOKEN_KEY]: value }); },
    async clear() { await chrome.storage.session.remove(TOKEN_KEY); },
  };
}

export function createClient({ apiBase, store, fetchImpl = globalThis.fetch, now = () => Date.now() }) {
  const base = apiBase.replace(/\/$/, '');

  async function parse(res) {
    const text = await res.text();
    try { return text ? JSON.parse(text) : null; } catch { return null; }
  }

  async function authorized() {
    const held = await store.get();
    if (!held?.token) return { error: { code: 'TOKEN_INVALID', text: '尚未授权，请先填入导入令牌。', action: 'reauth' } };
    if (held.expiresAt && new Date(held.expiresAt).getTime() <= now()) {
      await store.clear();
      return { error: { code: 'TOKEN_EXPIRED', text: '导入令牌已过期，请重新授权。', action: 'reauth' } };
    }
    return { token: held.token };
  }

  return {
    /** 授权：令牌由用户在 TalentFlow 接入配置页签发后显式填入，扩展不抓取任何站点凭据。 */
    async authorize(token, expiresAt) {
      if (!token || typeof token !== 'string') throw new Error('invalid_token');
      await store.set({ token, expiresAt: expiresAt ?? null });
      return { ok: true };
    },

    async status() {
      const held = await store.get();
      if (!held?.token) return { authorized: false };
      const expired = held.expiresAt ? new Date(held.expiresAt).getTime() <= now() : false;
      return { authorized: !expired, expired, expiresAt: held.expiresAt ?? null };
    },

    /**
     * 撤销：有登录会话时调用服务端吊销本人全部令牌；无论服务端是否可达都先清本地。
     * 没有会话时只能清本地，并提示用户去 TalentFlow 侧吊销。
     */
    async revoke({ operatorId, bearer } = {}) {
      await store.clear();
      if (!operatorId || !bearer) return { ok: true, remote: false };
      const res = await fetchImpl(`${base}/api/v1/browser-import/token/revoke/${encodeURIComponent(operatorId)}`, {
        method: 'POST', headers: { Authorization: `Bearer ${bearer}` },
      });
      return { ok: res.ok, remote: res.ok };
    },

    /** 用登录会话续期一张新的短期令牌；系统令牌本身没有 refresh 端点。 */
    async renew(bearer) {
      const res = await fetchImpl(`${base}/api/v1/browser-import/token`, {
        method: 'POST', headers: { Authorization: `Bearer ${bearer}` },
      });
      const body = await parse(res);
      if (!res.ok) return { error: describeError(body, res.status) };
      await store.set({ token: body.token, expiresAt: body.expiresAt ?? null });
      return { ok: true, expiresAt: body.expiresAt ?? null };
    },

    /**
     * 创建导入任务。requestId 由调用方生成并在重试时复用，服务端按 (requestId, operatorId) 幂等。
     * resume 必须是字节（Blob/ArrayBuffer），不接受 URL。
     */
    async createTask({ requestId, sourceSite, sourceCandidateId, sourcePageUrl, targetJobId, pagePayload, resume, resumeName }) {
      const auth = await authorized();
      if (auth.error) return { error: auth.error };
      if (!requestId) return { error: { code: 'REQUEST_ID_REQUIRED', text: '请求标识缺失，请重试。', action: 'retry' } };
      if (typeof resume === 'string') throw new Error('resume_must_be_bytes');

      const form = new FormData();
      form.set('requestId', requestId);
      if (sourceSite) form.set('sourceSite', sourceSite);
      if (sourceCandidateId) form.set('sourceCandidateId', sourceCandidateId);
      if (sourcePageUrl) form.set('sourcePageUrl', sourcePageUrl);
      if (targetJobId) form.set('targetJobId', targetJobId);
      if (pagePayload) form.set('pagePayload', JSON.stringify(pagePayload));
      if (resume) form.set('resume', new Blob([resume]), resumeName || 'resume.pdf');

      const res = await fetchImpl(`${base}/api/v1/browser-import/tasks`, {
        method: 'POST', headers: { 'X-System-Token': auth.token }, body: form,
      });
      const body = await parse(res);
      if (!res.ok) return { error: describeError(body, res.status) };
      return { task: body };
    },

    async getTask(taskId) {
      const auth = await authorized();
      if (auth.error) return { error: auth.error };
      const res = await fetchImpl(`${base}/api/v1/browser-import/tasks/${encodeURIComponent(taskId)}`, {
        headers: { 'X-System-Token': auth.token },
      });
      const body = await parse(res);
      if (!res.ok) return { error: describeError(body, res.status) };
      return { task: body };
    },

    async listJobs() {
      const auth = await authorized();
      if (auth.error) return { error: auth.error };
      const res = await fetchImpl(`${base}/jobs?status=ACTIVE&isVirtual=false&pageSize=100`, {
        headers: { 'X-System-Token': auth.token },
      });
      const body = await parse(res);
      if (!res.ok) return { error: describeError(body, res.status) };
      return { jobs: body?.items ?? [] };
    },
  };
}

/** 附件必须由扩展自己取字节；服务端不做 URL 下载。 */
export async function fetchResumeBytes(url, fetchImpl = globalThis.fetch) {
  const res = await fetchImpl(url, { credentials: 'omit' });
  if (!res.ok) throw new Error('ATTACHMENT_UNAVAILABLE');
  const buffer = await res.arrayBuffer();
  if (!buffer.byteLength) throw new Error('ATTACHMENT_UNAVAILABLE');
  return buffer;
}
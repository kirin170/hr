import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient, fetchResumeBytes } from '../src/api.js';

function memoryStore(initial = null) {
  let value = initial;
  return {
    async get() { return value; },
    async set(next) { value = next; },
    async clear() { value = null; },
    peek() { return value; },
  };
}
function fakeFetch(handler) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init, calls.length);
  };
  return { impl, calls };
}
const json = (body, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });
const NOW = Date.parse('2026-11-25T06:00:00Z');
const held = { token: 'tok', expiresAt: '2026-11-25T06:30:00Z' };

test('未授权时不发请求', async () => {
  const store = memoryStore();
  const { impl, calls } = fakeFetch(() => json({}));
  const client = createClient({ apiBase: 'http://x', store, fetchImpl: impl, now: () => NOW });
  const result = await client.createTask({ requestId: 'r1' });
  assert.equal(result.error.action, 'reauth');
  assert.equal(calls.length, 0);
});

test('令牌过期时清本地并要求重新授权，不发请求', async () => {
  const store = memoryStore({ token: 'tok', expiresAt: '2026-11-25T05:00:00Z' });
  const { impl, calls } = fakeFetch(() => json({}));
  const client = createClient({ apiBase: 'http://x', store, fetchImpl: impl, now: () => NOW });
  const result = await client.createTask({ requestId: 'r1' });
  assert.equal(result.error.code, 'TOKEN_EXPIRED');
  assert.equal(store.peek(), null);
  assert.equal(calls.length, 0);
});

test('缺 requestId 直接拒绝', async () => {
  const store = memoryStore(held);
  const { impl, calls } = fakeFetch(() => json({}));
  const client = createClient({ apiBase: 'http://x', store, fetchImpl: impl, now: () => NOW });
  const result = await client.createTask({});
  assert.equal(result.error.code, 'REQUEST_ID_REQUIRED');
  assert.equal(calls.length, 0);
});

test('附件必须是字节，传 URL 直接抛错', async () => {
  const store = memoryStore(held);
  const { impl } = fakeFetch(() => json({}));
  const client = createClient({ apiBase: 'http://x', store, fetchImpl: impl, now: () => NOW });
  await assert.rejects(() => client.createTask({ requestId: 'r1', resume: 'https://cdn/resume.pdf' }), /resume_must_be_bytes/);
});

test('创建任务用 multipart 与 X-System-Token，字段按契约传递', async () => {
  const store = memoryStore(held);
  const { impl, calls } = fakeFetch(() => json({ taskId: 't1', status: 'RECEIVED' }));
  const client = createClient({ apiBase: 'http://x/', store, fetchImpl: impl, now: () => NOW });
  const result = await client.createTask({
    requestId: 'r1', sourceSite: 'OTHER', sourceCandidateId: 'X-1',
    sourcePageUrl: 'http://127.0.0.1:4174', targetJobId: 'job1',
    pagePayload: { name: '张三' }, resume: new Uint8Array([1, 2, 3]), resumeName: 'r.pdf',
  });
  assert.equal(result.task.taskId, 't1');
  assert.equal(calls[0].url, 'http://x/api/v1/browser-import/tasks');
  assert.equal(calls[0].init.headers['X-System-Token'], 'tok');
  const form = calls[0].init.body;
  assert.equal(form.get('requestId'), 'r1');
  assert.equal(form.get('sourcePageUrl'), 'http://127.0.0.1:4174');
  assert.equal(JSON.parse(form.get('pagePayload')).name, '张三');
  assert.ok(form.get('resume'));
});

test('服务端错误码透传到用户反馈', async () => {
  const store = memoryStore(held);
  const { impl } = fakeFetch(() => json({ code: 'JOB_NOT_FOUND' }, 404));
  const client = createClient({ apiBase: 'http://x', store, fetchImpl: impl, now: () => NOW });
  const result = await client.createTask({ requestId: 'r1' });
  assert.equal(result.error.code, 'JOB_NOT_FOUND');
  assert.equal(result.error.action, 'reselect');
});

test('撤销先清本地，服务端不可达也不残留令牌', async () => {
  const store = memoryStore(held);
  const { impl } = fakeFetch(() => json({}, 503));
  const client = createClient({ apiBase: 'http://x', store, fetchImpl: impl, now: () => NOW });
  const result = await client.revoke({ operatorId: 'hr1', bearer: 'session' });
  assert.equal(store.peek(), null);
  assert.equal(result.remote, false);
});

test('无会话时撤销只清本地并如实告知', async () => {
  const store = memoryStore(held);
  const { impl, calls } = fakeFetch(() => json({}));
  const client = createClient({ apiBase: 'http://x', store, fetchImpl: impl, now: () => NOW });
  const result = await client.revoke();
  assert.equal(result.remote, false);
  assert.equal(calls.length, 0);
  assert.equal(store.peek(), null);
});

test('续期需要登录会话，成功后替换本地令牌', async () => {
  const store = memoryStore(held);
  const { impl, calls } = fakeFetch(() => json({ token: 'new', expiresAt: '2026-11-25T07:00:00Z' }));
  const client = createClient({ apiBase: 'http://x', store, fetchImpl: impl, now: () => NOW });
  const result = await client.renew('session');
  assert.ok(result.ok);
  assert.equal(store.peek().token, 'new');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer session');
});

test('任务查询同样带系统令牌', async () => {
  const store = memoryStore(held);
  const { impl, calls } = fakeFetch(() => json({ taskId: 't1', status: 'SUCCESS' }));
  const client = createClient({ apiBase: 'http://x', store, fetchImpl: impl, now: () => NOW });
  const result = await client.getTask('t1');
  assert.equal(result.task.status, 'SUCCESS');
  assert.equal(calls[0].init.headers['X-System-Token'], 'tok');
});

test('附件取字节失败或为空都判为不可用', async () => {
  await assert.rejects(() => fetchResumeBytes('http://x/a.pdf', async () => ({ ok: false })), /ATTACHMENT_UNAVAILABLE/);
  await assert.rejects(() => fetchResumeBytes('http://x/a.pdf', async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) })), /ATTACHMENT_UNAVAILABLE/);
});

test('取附件不带 cookie', async () => {
  let seen = null;
  await fetchResumeBytes('http://x/a.pdf', async (_url, init) => { seen = init; return { ok: true, arrayBuffer: async () => new ArrayBuffer(4) }; });
  assert.equal(seen.credentials, 'omit');
});
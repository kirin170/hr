/**
 * ATS-011 接口层端到端：用扩展自己的 api.js 与 registry.js 打真实 API。
 * 不加载浏览器扩展（工具不支持加载未打包扩展），只验证扩展会发出的那串请求。
 */
import assert from 'node:assert/strict';
import { createClient, fetchResumeBytes } from '../src/api.js';
import { createDefaultRegistry } from '../src/adapters/registry.js';

const API = 'http://127.0.0.1:3100';
const FIXTURE = 'http://127.0.0.1:4174';
const results = [];
const check = (name, cond, detail) => { results.push({ name, passed: !!cond, detail }); console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail ? ' :: ' + String(detail).slice(0, 120) : '')); };

// 极简 DOM  shim：只支持夹具页用到的 data-field / data-resume 查询。
const html = await fetch(`${FIXTURE}/candidate.html`).then((r) => r.text());
const fields = Object.fromEntries([...html.matchAll(/data-field="([^"]+)">([^<]*)</g)].map((m) => [m[1], m[2]]));
const resumePath = html.match(/data-resume="([^"]+)"/)?.[1];
const doc = {
  querySelector(selector) {
    const key = selector.match(/data-field="([^"]+)"/)?.[1];
    if (key && fields[key] !== undefined) return { textContent: fields[key], getAttribute: () => null };
    if (selector === '[data-resume]') return { getAttribute: () => resumePath };
    return null;
  },
};

const registry = createDefaultRegistry();
const adapter = registry.resolve('127.0.0.1:4174', 'hr-ext');
check('注册表解析到本地夹具适配器', !!adapter && adapter.testOnly, adapter && `${adapter.id}@${adapter.version}`);
const extracted = adapter.extract(doc);
check('夹具提取拿到平台候选人 ID 与白名单字段', extracted.sourceCandidateId === 'FIX-0001' && extracted.pagePayload.name === '夹具候选人', JSON.stringify(extracted.pagePayload).slice(0, 100));

// 登录会话仅用于签发/吊销令牌，模拟用户在 TalentFlow 侧的动作。
const login = await fetch(`${API}/api/v1/auth/local`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'admin', secret: process.env.LOCAL_AUTH_SECRET }) }).then((r) => r.json());
const bearer = login.accessToken;
const operatorId = login.user.id;
const job = await fetch(`${API}/jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` }, body: JSON.stringify({ title: '插件验收职位', departmentId: 'dep-ext', headcount: 1 }) }).then((r) => r.json());

function memoryStore() { let v = null; return { async get() { return v; }, async set(x) { v = x; }, async clear() { v = null; } }; }
const store = memoryStore();
const client = createClient({ apiBase: API, store });

const issued = await client.renew(bearer);
check('用登录会话签发短期系统令牌', issued.ok && !!issued.expiresAt, issued.expiresAt);

const jobs = await client.listJobs();
check('用系统令牌拉取在招职位', !jobs.error && jobs.jobs.some((j) => j.id === job.id), `${jobs.jobs?.length} jobs`);

const bytes = await fetchResumeBytes(`${FIXTURE}${resumePath}`);
check('扩展自行取到附件字节', bytes.byteLength > 0, `${bytes.byteLength} bytes`);

const requestId = crypto.randomUUID();
const first = await client.createTask({
  requestId, sourceSite: 'OTHER', sourceCandidateId: extracted.sourceCandidateId,
  sourcePageUrl: FIXTURE, targetJobId: job.id, pagePayload: extracted.pagePayload,
  resume: bytes, resumeName: 'resume.pdf',
});
check('创建导入任务成功', !first.error && !!first.task?.taskId, first.error ? JSON.stringify(first.error) : first.task.status);

const replay = await client.createTask({
  requestId, sourceSite: 'OTHER', sourceCandidateId: extracted.sourceCandidateId,
  sourcePageUrl: FIXTURE, targetJobId: job.id, pagePayload: extracted.pagePayload,
  resume: bytes, resumeName: 'resume.pdf',
});
check('同 requestId 重放返回同一任务（幂等）', !replay.error && replay.task?.taskId === first.task?.taskId, `${first.task?.taskId} vs ${replay.task?.taskId}`);

const fetched = await client.getTask(first.task.taskId);
check('任务查询只返回本操作者任务', !fetched.error && fetched.task.taskId === first.task.taskId, fetched.task?.status);
check('来源页面只保留协议与主机', fetched.task?.sourcePageHost === FIXTURE, fetched.task?.sourcePageHost);

const badJob = await client.createTask({ requestId: crypto.randomUUID(), sourceSite: 'OTHER', sourcePageUrl: FIXTURE, targetJobId: 'no-such-job', pagePayload: extracted.pagePayload, resume: bytes });
check('目标职位不存在时给出可操作反馈', badJob.error?.code === 'JOB_NOT_FOUND' && badJob.error.action === 'reselect', JSON.stringify(badJob.error));

const unsupported = registry.resolve('www.zhipin.com', 'hr-ext');
check('未交付平台不解析适配器', unsupported === null);

const revoked = await client.revoke({ operatorId, bearer });
check('吊销后本地清空且服务端确认', revoked.ok && revoked.remote);
const afterRevoke = await client.listJobs();
check('吊销后系统令牌立即失效', afterRevoke.error?.action === 'reauth', JSON.stringify(afterRevoke.error));

const passed = results.filter((r) => r.passed).length;
console.log(`\nATS-011 API E2E: ${passed}/${results.length}`);
if (passed !== results.length) { console.log('FAILED: ' + results.filter((r) => !r.passed).map((r) => r.name).join(', ')); process.exitCode = 1; }
const fs = await import('node:fs');
fs.writeFileSync('C:/Users/021756/AppData/Local/Temp/ats011-e2e.json', JSON.stringify(results, null, 1));
void assert;
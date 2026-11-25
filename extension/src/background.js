/**
 * Service worker：只做消息路由。
 *
 * 硬约束：不监听 tabs.onUpdated / onActivated 去发起导入，
 * 页面打开或切换都不会创建任务；一切导入都来自 popup 的显式点击。
 */
import { createClient, defaultStore, fetchResumeBytes } from './api.js';
import { createDefaultRegistry } from './adapters/registry.js';
import { describeTask } from './errors.js';

const API_BASE = 'http://127.0.0.1:3100';
const registry = createDefaultRegistry();
const client = createClient({ apiBase: API_BASE, store: defaultStore() });

/** 重试时复用同一个 requestId，服务端按 (requestId, operatorId) 幂等。 */
let lastRequestId = null;

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

async function extractFromPage(tabId) {
  return chrome.tabs.sendMessage(tabId, { type: 'ats.extract' });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  void (async () => {
    try {
      switch (message?.type) {
        case 'ats.status': {
          const tab = await activeTab();
          const host = tab?.url ? new URL(tab.url).host : '';
          const operator = message.operatorId ?? 'anonymous';
          const adapter = registry.resolve(host, operator);
          sendResponse({
            status: await client.status(),
            host,
            adapter: adapter ? { id: adapter.id, version: adapter.version, testOnly: adapter.testOnly } : null,
            adapters: registry.list(),
          });
          return;
        }
        case 'ats.authorize':
          sendResponse(await client.authorize(message.token, message.expiresAt));
          return;
        case 'ats.renew':
          sendResponse(await client.renew(message.bearer));
          return;
        case 'ats.revoke':
          sendResponse(await client.revoke({ operatorId: message.operatorId, bearer: message.bearer }));
          return;
        case 'ats.jobs':
          sendResponse(await client.listJobs());
          return;
        case 'ats.adapters.toggle':
          registry.setEnabled(message.id, message.enabled);
          sendResponse({ adapters: registry.list() });
          return;
        case 'ats.adapters.rollout':
          registry.setRollout(message.id, message.percent);
          sendResponse({ adapters: registry.list() });
          return;
        case 'ats.adapters.version':
          registry.setActiveVersion(message.id, message.version);
          sendResponse({ adapters: registry.list() });
          return;
        case 'ats.import': {
          // 只由 popup 的点击触发。
          const tab = await activeTab();
          if (!tab?.id || !tab.url) { sendResponse({ error: { text: '没有可用页面。', action: 'none' } }); return; }
          const url = new URL(tab.url);
          const adapter = registry.resolve(url.host, message.operatorId ?? 'anonymous');
          if (!adapter) {
            sendResponse({ error: { code: 'SOURCE_SITE_UNSUPPORTED', text: '该站点尚未支持导入。', action: 'none' } });
            return;
          }
          const extracted = await extractFromPage(tab.id);
          if (!extracted?.ok) { sendResponse({ error: { text: '页面资料读取失败，请刷新后重试。', action: 'retry' } }); return; }
          let resume = null;
          if (extracted.data.resumeUrl) {
            try { resume = await fetchResumeBytes(new URL(extracted.data.resumeUrl, tab.url).href); }
            catch { sendResponse({ error: { code: 'ATTACHMENT_UNAVAILABLE', text: '简历附件获取失败，请重试或改用手工上传。', action: 'retry' } }); return; }
          }
          const requestId = message.retry && lastRequestId ? lastRequestId : crypto.randomUUID();
          lastRequestId = requestId;
          const result = await client.createTask({
            requestId,
            sourceSite: message.sourceSite ?? 'OTHER',
            sourceCandidateId: extracted.data.sourceCandidateId,
            // 只传协议+主机，服务端也会再脱敏一次；路径与查询串不出扩展。
            sourcePageUrl: url.origin,
            targetJobId: message.targetJobId,
            pagePayload: extracted.data.pagePayload,
            resume,
            resumeName: extracted.data.resumeName,
          });
          sendResponse(result.error ? result : { task: result.task, result: describeTask(result.task) });
          return;
        }
        case 'ats.task':
          sendResponse(await client.getTask(message.taskId));
          return;
        default:
          sendResponse({ error: { text: '未知请求。', action: 'none' } });
      }
    } catch (error) {
      sendResponse({ error: { text: String(error?.message ?? error), action: 'retry' } });
    }
  })();
  return true;
});
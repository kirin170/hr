/**
 * 内容脚本：只在收到显式请求时读取页面资料。
 *
 * 加载本脚本本身不会创建任何导入任务，也不会在页面打开时自动上报。
 * 真实平台适配器未交付，这里只按注册表解析当前站点的适配器；解析不到就明确返回不支持。
 *
 * MV3 的声明式内容脚本是经典脚本，不能直接用 import，
 * 因此按需在监听器里动态加载注册表模块（已在 web_accessible_resources 中放行）。
 */
let registryPromise = null;

function loadRegistry() {
  if (!registryPromise) {
    registryPromise = import(chrome.runtime.getURL('src/adapters/registry.js'))
      .then((module) => module.createDefaultRegistry());
  }
  return registryPromise;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'ats.extract') return false;
  void (async () => {
    try {
      const registry = await loadRegistry();
      const adapter = registry.resolve(location.host, message.operatorId ?? 'anonymous');
      if (!adapter) { sendResponse({ ok: false, reason: 'SOURCE_SITE_UNSUPPORTED' }); return; }
      const data = adapter.extract(document);
      sendResponse({ ok: true, data: { ...data, resumeName: 'resume.pdf' } });
    } catch (error) {
      sendResponse({ ok: false, reason: String(error?.message ?? error) });
    }
  })();
  return true;
});
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
/** 只检查代码，不把注释里写下的禁止项当成违规。 */
const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('页面打开或切换不会触发导入：background 不监听 tabs 生命周期事件', () => {
  const source = code('src/background.js');
  assert.ok(!/tabs\.onUpdated/.test(source), '不得监听 tabs.onUpdated');
  assert.ok(!/tabs\.onActivated/.test(source), '不得监听 tabs.onActivated');
  assert.ok(!/webNavigation/.test(source), '不得监听导航事件');
  assert.ok(/runtime\.onMessage/.test(source), '只经消息触发');
});

test('内容脚本加载本身不创建任务，也不自动上报', () => {
  const source = code('src/content.js');
  assert.ok(!/createTask/.test(source), '内容脚本不得直接建任务');
  assert.ok(!/fetch\(/.test(source), '内容脚本不得自行发网络请求');
  assert.ok(/onMessage/.test(source), '只在收到显式请求时读取');
});

test('manifest 只申请最小权限，且不申请未交付平台的域名', () => {
  const manifest = JSON.parse(read('manifest.json'));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual([...manifest.permissions].sort(), ['activeTab', 'storage']);
  const hosts = manifest.host_permissions.join(' ');
  assert.ok(!/zhipin|liepin|boss/i.test(hosts), '未交付平台不得预先申请域名权限');
  for (const entry of manifest.content_scripts) {
    assert.ok(entry.matches.every((m) => /127\.0\.0\.1|localhost/.test(m)), '内容脚本只作用于本地夹具页');
  }
});

test('令牌放会话存储，不落持久化存储', () => {
  const source = code('src/api.js');
  assert.ok(/storage\.session/.test(source));
  assert.ok(!/storage\.local/.test(source), '不得写入 storage.local');
  assert.ok(!/localStorage/.test(source));
});

test('扩展不读取也不保存第三方凭据', () => {
  for (const file of ['src/api.js', 'src/background.js', 'src/content.js', 'src/adapters/registry.js']) {
    const source = code(file);
    assert.ok(!/document\.cookie/.test(source), `${file} 不得读 cookie`);
    assert.ok(!/chrome\.cookies/.test(source), `${file} 不得使用 cookies API`);
  }
});
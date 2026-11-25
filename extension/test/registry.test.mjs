import test from 'node:test';
import assert from 'node:assert/strict';
import { AdapterRegistry, bucket, createDefaultRegistry, fixtureAdapter, ADAPTER_CONTRACT_FIELDS } from '../src/adapters/registry.js';

const HOST = '127.0.0.1:4174';

test('关闭的适配器不解析，且不影响其他入口', () => {
  const registry = createDefaultRegistry();
  registry.setEnabled('fixture.local', false);
  assert.equal(registry.resolve(HOST, 'hr1'), null);
  registry.setEnabled('fixture.local', true);
  assert.ok(registry.resolve(HOST, 'hr1'));
});

test('站点不匹配时不解析，绝不回落到猜测页面结构', () => {
  const registry = createDefaultRegistry();
  assert.equal(registry.resolve('www.zhipin.com', 'hr1'), null);
  assert.equal(registry.resolve('lpt.liepin.com', 'hr1'), null);
});

test('灰度分桶稳定：同一人同一适配器结果恒定', () => {
  const a = bucket('hr1', 'fixture.local');
  assert.equal(a, bucket('hr1', 'fixture.local'));
  assert.ok(a >= 0 && a < 100);
});

test('灰度 0 全员不启用，100 全量启用', () => {
  const registry = createDefaultRegistry();
  registry.setRollout('fixture.local', 0);
  assert.equal(registry.resolve(HOST, 'hr1'), null);
  registry.setRollout('fixture.local', 100);
  assert.ok(registry.resolve(HOST, 'hr1'));
});

test('灰度比例非法值被拒绝', () => {
  const registry = createDefaultRegistry();
  assert.throws(() => registry.setRollout('fixture.local', 101), /invalid_rollout/);
  assert.throws(() => registry.setRollout('fixture.local', -1), /invalid_rollout/);
});

test('切到历史版本即为回滚，且解析结果随之改变', () => {
  const registry = createDefaultRegistry();
  assert.equal(registry.resolve(HOST, 'hr1').version, '1.0.0');
  registry.setActiveVersion('fixture.local', '0.9.0');
  assert.equal(registry.resolve(HOST, 'hr1').version, '0.9.0');
});

test('不存在的版本不能切换', () => {
  const registry = createDefaultRegistry();
  assert.throws(() => registry.setActiveVersion('fixture.local', '9.9.9'), /unknown_version/);
});

test('注册表只含测试夹具，没有任何真实平台适配器', () => {
  const registry = createDefaultRegistry();
  const ids = registry.list().map((a) => a.id);
  assert.deepEqual(ids, ['fixture.local']);
  assert.ok(registry.list().every((a) => a.testOnly));
});

test('夹具提取只产出白名单字段', () => {
  const cells = { sourceCandidateId: 'X-1', name: '张三', phone: '13800000000', cookie: 'should-not-appear' };
  const doc = {
    querySelector(selector) {
      const key = selector.match(/data-field="([^"]+)"/)?.[1];
      if (key && cells[key] !== undefined) return { textContent: cells[key] };
      return null;
    },
  };
  const version = fixtureAdapter.versions.find((v) => v.version === '1.0.0');
  const result = version.extract(doc);
  assert.equal(result.sourceCandidateId, 'X-1');
  assert.deepEqual(Object.keys(result.pagePayload).sort(), ['name', 'phone']);
  assert.ok(Object.keys(result.pagePayload).every((k) => ADAPTER_CONTRACT_FIELDS.includes(k)));
});

test('空注册表不解析任何站点', () => {
  assert.equal(new AdapterRegistry([]).resolve(HOST, 'hr1'), null);
});
import test from 'node:test';
import assert from 'node:assert/strict';
import { describeError, describeTask } from '../src/errors.js';

test('已知错误码按契约映射，并给出下一步动作', () => {
  assert.equal(describeError({ code: 'TOKEN_EXPIRED' }, 401).action, 'reauth');
  assert.equal(describeError({ code: 'ATTACHMENT_UNAVAILABLE' }, 400).action, 'retry');
  assert.equal(describeError({ code: 'SOURCE_SITE_UNSUPPORTED' }, 400).action, 'none');
  assert.match(describeError({ code: 'THIRD_PARTY_CREDENTIAL_REJECTED' }, 400).text, /不会保存/);
});

test('未知错误码保留 code 供排查，不吞掉', () => {
  const result = describeError({ code: 'SOMETHING_NEW' }, 400);
  assert.equal(result.code, 'SOMETHING_NEW');
  assert.match(result.text, /SOMETHING_NEW/);
});

test('无错误码时按 HTTP 状态回落', () => {
  assert.equal(describeError(null, 401).action, 'reauth');
  assert.equal(describeError(null, 503).action, 'retry');
});

test('DUPLICATE 是待人工选择，不是失败', () => {
  const result = describeTask({ status: 'DUPLICATE' });
  assert.equal(result.tone, 'warn');
  assert.match(result.text, /不会重复建档/);
});

test('任务失败时复用错误码映射', () => {
  const result = describeTask({ status: 'FAILED', errorCode: 'ATTACHMENT_INVALID' });
  assert.equal(result.tone, 'error');
  assert.equal(result.code, 'ATTACHMENT_INVALID');
});

test('解析中不是终态', () => {
  assert.equal(describeTask({ status: 'PARSING' }).tone, 'pending');
  assert.equal(describeTask({ status: 'RECEIVED' }).tone, 'pending');
});
test('服务端把标准错误码放在 message 里时同样识别', () => {
  const result = describeError({ message: 'JOB_NOT_FOUND', error: 'Not Found', statusCode: 404 }, 404);
  assert.equal(result.code, 'JOB_NOT_FOUND');
  assert.equal(result.action, 'reselect');
});

test('普通中文文案不会被误当成错误码', () => {
  const result = describeError({ message: '目标职位不存在或无权访问' }, 404);
  assert.equal(result.code, null);
});

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

/**
 * ATS-020 dws 输出结构核对脚本（部署机上执行）。
 *
 * 用法：node scripts/ats020-minutes-probe.mjs <听记 uuid>
 * 只打印 JSON 的键名、类型、长度与数组首元素结构，绝不打印摘要或逐字稿正文。
 * 用于核对 dingtalk-minutes.client.ts 的字段归一化是否匹配真实 dws 版本。
 */
const run = promisify(execFile);
const binary = process.env.DINGTALK_MINUTES_DWS_BIN?.trim() || 'dws';
const minutesId = process.argv[2];
if (!minutesId) {
  console.error('用法：node scripts/ats020-minutes-probe.mjs <听记 uuid>');
  process.exit(1);
}

function shape(value, depth = 0) {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    return `array(${value.length})${value.length ? `[${shape(value[0], depth + 1)}]` : ''}`;
  }
  if (typeof value === 'object') {
    if (depth >= 5) return 'object(...)';
    const entries = Object.entries(value).slice(0, 40);
    return `{${entries.map(([key, child]) => `${key}:${shape(child, depth + 1)}`).join(', ')}}`;
  }
  if (typeof value === 'string') return `string(len=${value.length})`;
  if (typeof value === 'number' || typeof value === 'boolean') return typeof value;
  return 'unknown';
}

const commands = [
  ['+detail', ['minutes', '+detail', '--id', minutesId, '--artifacts', 'basic,summary', '--format', 'json']],
  ['+transcript', ['minutes', '+transcript', '--id', minutesId, '--format', 'json']],
];

for (const [label, args] of commands) {
  try {
    const { stdout } = await run(binary, args, {
      timeout: 30_000,
      maxBuffer: 64 * 1024 * 1024,
      windowsHide: true,
      encoding: 'utf8',
    });
    let payload;
    try {
      payload = JSON.parse(stdout);
    } catch {
      console.log(`\n=== ${label} 失败 === 输出不是合法 JSON`);
      continue;
    }
    console.log(`\n=== ${label} 结构 ===`);
    console.log(shape(payload));
  } catch (error) {
    // 错误输出可能含听记正文，只打印进程状态码
    console.log(`\n=== ${label} 失败 === code=${String(error.code ?? '')} killed=${error.killed === true}`);
    if (error.code === 'ENOENT' || error.code === 'EINVAL') {
      console.log('提示：Windows 下不能直接执行 dws.cmd，请把 DINGTALK_MINUTES_DWS_BIN 指向 ...\\dingtalk-workspace-cli\\vendor\\dws.exe；未登录时先执行 dws auth login --device。');
    }
  }
}

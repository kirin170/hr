import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

/**
 * ATS-020 dws 输出结构核对与一致性自检脚本（部署机上执行）。
 *
 * 用法：node scripts/ats020-minutes-probe.mjs <听记 uuid> [--preview]
 * 默认只打印键名、类型、长度与统计指标；加 --preview 才打印首末段前 30 字，用于人工对照。
 * 用于核对 dingtalk-minutes.client.ts 的字段归一化是否匹配真实 dws 版本。
 */
const run = promisify(execFile);
const binary = process.env.DINGTALK_MINUTES_DWS_BIN?.trim() || 'dws';
const args = process.argv.slice(2);
const preview = args.includes('--preview');
const minutesId = args.find((item) => !item.startsWith('--'));
if (!minutesId) {
  console.error('用法：node scripts/ats020-minutes-probe.mjs <听记 uuid> [--preview]');
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

const payloads = new Map();
for (const [label, commandArgs] of commands) {
  try {
    const { stdout } = await run(binary, commandArgs, {
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
    payloads.set(label, payload);
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

const detail = payloads.get('+detail');
const transcript = payloads.get('+transcript');
if (detail && transcript) selfCheck(detail, transcript);

function selfCheck(detailPayload, transcriptPayload) {
  const basic = detailPayload?.basic?.result ?? {};
  const duration = Number(basic.duration);
  const summary = String(detailPayload?.summary?.result?.fullSummary ?? '');
  const list = Array.isArray(transcriptPayload?.data?.paragraphList) ? transcriptPayload.data.paragraphList : [];
  const rows = list.map((item) => ({
    text: String(item?.paragraph ?? ''),
    start: Number(item?.startTime),
    end: Number(item?.endTime),
    speaker: String(item?.speakerDisplay?.nickName ?? item?.nickName ?? ''),
  }));
  const chars = rows.reduce((total, row) => total + row.text.length, 0);
  const lastEnd = rows.length ? rows[rows.length - 1].end : Number.NaN;
  const deviation = Number.isFinite(duration) && Number.isFinite(lastEnd) ? lastEnd - duration : Number.NaN;
  const monotonic = rows.every((row, index) => index === 0 || row.start >= rows[index - 1].start);
  const perMinute = duration > 0 ? Math.round(chars / (duration / 60_000)) : Number.NaN;
  const speakers = new Map();
  for (const row of rows) {
    const current = speakers.get(row.speaker) ?? { count: 0, chars: 0 };
    speakers.set(row.speaker, { count: current.count + 1, chars: current.chars + row.text.length });
  }
  const clock = (ms) => {
    if (!Number.isFinite(ms)) return 'n/a';
    const total = Math.round(ms / 1000);
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  };
  const brief = (text) => (preview ? `「${text.slice(0, 30)}${text.length > 30 ? '…' : ''}」` : '');

  console.log('\n=== 一致性自检 ===');
  console.log(`标题长度 ${String(basic.title ?? '').length}，摘要长度 ${summary.length}`);
  console.log(`分页追完 complete=${String(transcriptPayload?.data?.complete)}`);
  console.log(`录音时长 ${clock(duration)}，末段结束 ${clock(lastEnd)}，偏差 ${Number.isFinite(deviation) ? `${(deviation / 1000).toFixed(1)}s` : 'n/a'}`);
  console.log(`段落 ${rows.length}，总字数 ${chars}，每分钟 ${perMinute} 字`);
  console.log(`时间轴单调递增 ${monotonic}，时间戳为相对偏移 ${rows.every((row) => row.start < 1e11)}`);
  console.log(`发言人 ${[...speakers].map(([name, stat]) => `${name || '(空)'} ${stat.count} 段/${stat.chars} 字`).join('；')}`);
  if (rows.length) {
    console.log(`首段 [${clock(rows[0].start)}] ${rows[0].speaker}：${brief(rows[0].text)}`);
    console.log(`末段 [${clock(rows[rows.length - 1].start)}] ${rows[rows.length - 1].speaker}：${brief(rows[rows.length - 1].text)}`);
  }
}

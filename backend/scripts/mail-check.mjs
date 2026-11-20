// ATS-022 邮箱连通性检查：只读，不下载附件、不修改邮箱状态。
// 凭据从 backend/.env.local / .env 读取，输出中不打印密码。
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ImapFlow } from 'imapflow';

for (const envFile of ['.env.local', '.env']) {
  try {
    process.loadEnvFile(envFile);
  } catch {
    // 文件不存在时忽略，回退到进程环境变量
  }
}

const provider = (process.env.MAIL_PROVIDER ?? 'mock').trim().toLowerCase();
const host = process.env.MAIL_INBOX_HOST?.trim();
const port = Number(process.env.MAIL_INBOX_PORT ?? 993);
const secure = (process.env.MAIL_INBOX_SECURE ?? 'true').trim().toLowerCase() !== 'false';
const user = process.env.MAIL_INBOX_USER?.trim();
const pass = process.env.MAIL_INBOX_PASSWORD;
const mailbox = process.env.MAIL_CHECK_MAILBOX?.trim() || 'INBOX';
const limit = Math.min(Number(process.env.MAIL_CHECK_LIMIT ?? 5) || 5, 20);

function fail(message) {
  console.error(`[FAIL] ${message}`);
  process.exit(1);
}

console.log('== 配置（密码不显示） ==');
console.log(`provider=${provider} host=${host ?? '(空)'} port=${port} secure=${secure}`);
console.log(`user=${user ?? '(空)'} password=${pass ? `已设置(${pass.length}字符)` : '(空)'}`);
console.log(`mailbox=${mailbox} limit=${limit}`);

if (provider !== 'imap') {
  fail(`MAIL_PROVIDER=${provider}，连通性测试需要 imap`);
}
if (!host || !user || !pass) {
  fail('MAIL_INBOX_HOST / MAIL_INBOX_USER / MAIL_INBOX_PASSWORD 存在空值');
}

// 公司网络存在 TLS 代理时，需要显式提供根证书；缺失时回退到 Node 内置 CA。
const caFile = resolve(process.env.MAIL_CA_FILE?.trim() || '.certs/tecsign-root.pem');
const ca = existsSync(caFile) ? readFileSync(caFile) : undefined;
if (secure) {
  console.log(`tls_ca=${ca ? caFile : '(Node 内置 CA)'}`);
}

const client = new ImapFlow({
  host,
  port,
  secure,
  auth: { user, pass },
  logger: false,
  greetingTimeout: 15000,
  socketTimeout: 20000,
  clientInfo: { name: 'TalentFlow ATS', version: '0.1.0', vendor: 'TalentFlow' },
  tls: { ca, servername: host },
});

function collectAttachments(node, acc = []) {
  if (!node) return acc;
  const disposition = (node.disposition ?? '').toLowerCase();
  const filename = node.dispositionParameters?.filename ?? node.parameters?.name;
  if (disposition === 'attachment' || filename) {
    acc.push({ filename: filename ?? '(未命名)', size: node.size ?? null });
  }
  if (Array.isArray(node.childNodes)) {
    for (const child of node.childNodes) collectAttachments(child, acc);
  }
  return acc;
}

let lock;
try {
  const startedAt = Date.now();
  await client.connect();
  console.log(`[OK] 连接成功，耗时 ${Date.now() - startedAt}ms`);

  lock = await client.getMailboxLock(mailbox);
  const total = client.mailbox.exists ?? 0;
  console.log(`[OK] ${mailbox} 共 ${total} 封邮件`);

  if (total === 0) {
    console.log('[INFO] 邮箱为空，请先投递一封带简历附件的样本邮件');
  } else {
    const from = Math.max(1, total - limit + 1);
    console.log(`== 最近 ${total - from + 1} 封 ==`);
    for await (const message of client.fetch(`${from}:*`, {
      uid: true,
      envelope: true,
      bodyStructure: true,
    })) {
      const subject = (message.envelope?.subject ?? '(无主题)').slice(0, 60);
      const sender = message.envelope?.from?.[0]?.address ?? '(未知发件人)';
      const date = message.envelope?.date?.toISOString() ?? '(无时间)';
      const attachments = collectAttachments(message.bodyStructure);
      const attachmentText = attachments.length
        ? attachments.map((item) => `${item.filename}${item.size ? `/${item.size}B` : ''}`).join(', ')
        : '无附件';
      console.log(`- uid=${message.uid} ${date} ${sender} | ${subject} | 附件: ${attachmentText}`);
    }
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  fail(`连接或读取失败：${message}`);
} finally {
  lock?.release();
  if (client.usable) {
    await client.logout().catch(() => {});
  }
}

console.log('[DONE] 连通性检查通过');

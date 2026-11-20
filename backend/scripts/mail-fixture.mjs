// ATS-022 验证夹具：通过 IMAP APPEND 向测试邮箱投递构造邮件，验证格式分流与查重。
// 用法：node scripts/mail-fixture.mjs append | clean
import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import { withImapClient } from '../dist/mail/imap.client.js';

for (const envFile of ['.env.local', '.env']) {
  try {
    process.loadEnvFile(envFile);
  } catch {
    // 忽略缺失的 env 文件
  }
}

const FIXTURE_SUBJECT = '[ATS022-FIXTURE]';
const connection = {
  host: process.env.MAIL_INBOX_HOST?.trim(),
  port: Number(process.env.MAIL_INBOX_PORT ?? 993),
  secure: (process.env.MAIL_INBOX_SECURE ?? 'true').trim().toLowerCase() !== 'false',
  user: process.env.MAIL_INBOX_USER?.trim(),
  password: process.env.MAIL_INBOX_PASSWORD,
};
const folder = process.env.MAIL_CHECK_MAILBOX?.trim() || 'INBOX';

// 1x1 透明 PNG（真实图片字节）
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function buildXlsx() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('候选人');
  sheet.addRow(['姓名', '手机号', '邮箱']);
  sheet.addRow(['夹具候选人', '13800000000', 'fixture@example.com']);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function buildMessage({ subject, messageId, attachments }) {
  const boundary = 'ATS022-BOUNDARY';
  const parts = attachments.map(
    (item) =>
      `--${boundary}\r\nContent-Type: ${item.type}; name="${item.name}"\r\nContent-Disposition: attachment; filename="${item.name}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${item.buffer.toString('base64')}\r\n`,
  );
  return Buffer.from(
    [
      'From: hr@example.com',
      'To: ats@example.com',
      `Subject: ${subject}`,
      `Message-ID: <${messageId}>`,
      `Date: ${new Date().toUTCString()}`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      'ATS-022 自动验证夹具，请忽略。',
      ...parts,
      `--${boundary}--`,
      '',
    ].join('\r\n'),
    'utf8',
  );
}

const action = process.argv[2] ?? 'append';

await withImapClient(connection, async (client) => {
  const lock = await client.getMailboxLock(folder);
  try {
    if (action === 'clean') {
      // 中文主题在 IMAP SEARCH 下不可靠，改为拉取信封后本地匹配
      const uids = [];
      for await (const message of client.fetch('1:*', { uid: true, envelope: true })) {
        const subject = message.envelope?.subject ?? '';
        if (subject.includes(FIXTURE_SUBJECT)) uids.push(message.uid);
      }
      if (uids.length) await client.messageDelete(uids);
      console.log(`已清理夹具邮件 ${uids.length} 封`);
      return;
    }

    const xlsx = await buildXlsx();
    const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('fake-zip')]);
    const runId = createHash('sha256').update(String(Date.now())).digest('hex').slice(0, 8);

    const fixtures = [
      {
        name: 'A-简历+图片+Excel',
        subject: `${FIXTURE_SUBJECT} A 简历/图片/Excel`,
        messageId: `ats022-a-${runId}@example.com`,
        attachments: [
          { name: 'resume.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: zip },
          { name: 'photo.png', type: 'image/png', buffer: PNG },
          { name: 'batch.xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: xlsx },
        ],
      },
      {
        name: 'B-重复附件',
        subject: `${FIXTURE_SUBJECT} B 重复附件`,
        messageId: `ats022-b-${runId}@example.com`,
        attachments: [
          { name: 'resume.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: zip },
          { name: 'photo.png', type: 'image/png', buffer: PNG },
        ],
      },
      {
        name: 'C-不支持格式',
        subject: `${FIXTURE_SUBJECT} C 不支持格式`,
        messageId: `ats022-c-${runId}@example.com`,
        attachments: [{ name: 'archive.zip', type: 'application/zip', buffer: zip }],
      },
    ];

    for (const fixture of fixtures) {
      const message = buildMessage(fixture);
      const result = await client.append(folder, message, [], new Date());
      console.log(`已投递 ${fixture.name} uid=${result?.uid ?? '?'} messageId=${fixture.messageId}`);
    }
  } finally {
    lock.release();
  }
});

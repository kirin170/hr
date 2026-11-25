import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ImapFlow } from 'imapflow';

export type MailboxConnection = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
};

/**
 * 公司网络存在 TLS 代理时，Node 不读取 Windows 证书库，
 * 需要通过 MAIL_CA_FILE 显式提供根证书（默认 backend/.certs/tecsign-root.pem）。
 */
export function resolveMailCa(): Buffer | undefined {
  const configured = process.env.MAIL_CA_FILE?.trim();
  const file = resolve(configured || '.certs/tecsign-root.pem');
  if (!existsSync(file)) return undefined;
  return readFileSync(file);
}

export function createImapClient(connection: MailboxConnection): ImapFlow {
  return new ImapFlow({
    host: connection.host,
    port: connection.port,
    secure: connection.secure,
    auth: { user: connection.user, pass: connection.password },
    logger: false,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
    clientInfo: { name: 'TalentFlow ATS', version: '0.1.0', vendor: 'TalentFlow' },
    tls: { ca: resolveMailCa(), servername: connection.host },
  });
}

/** 统一连接/断连，保证异常路径也释放连接 */
export async function withImapClient<T>(
  connection: MailboxConnection,
  handler: (client: ImapFlow) => Promise<T>,
): Promise<T> {
  const client = createImapClient(connection);
  // 捕获异步 socket 错误事件，避免未监听 'error' 导致 Node 进程崩溃
  client.on('error', () => {});
  try {
    await client.connect();
    return await handler(client);
  } finally {
    if (client.usable) {
      await client.logout().catch(() => {
        client.close();
      });
    } else {
      client.close();
    }
  }
}

/**
 * 错误脱敏：只保留错误类型与简短描述，绝不把授权码或服务器原始响应写进日志/台账。
 */
export function describeMailError(error: unknown): string {
  if (!error || typeof error !== 'object') return 'unknown_error';
  const code = 'code' in error ? String((error as { code: unknown }).code) : '';
  const responseText =
    'responseText' in error ? String((error as { responseText: unknown }).responseText) : '';
  const message = error instanceof Error ? error.message : '';
  const detail = responseText || message || 'mail_error';
  return `${code ? `${code}: ` : ''}${detail}`.replace(/\s+/g, ' ').slice(0, 300);
}

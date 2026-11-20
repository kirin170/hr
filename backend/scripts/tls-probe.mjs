// 诊断用：查看 IMAP 服务器实际返回的证书签发方，判断是代理拦截还是本机 CA 缺失。
import tls from 'node:tls';

for (const envFile of ['.env.local', '.env']) {
  try {
    process.loadEnvFile(envFile);
  } catch {
    // 忽略缺失的 env 文件
  }
}

const host = process.env.MAIL_INBOX_HOST?.trim() || 'imap.163.com';
const port = Number(process.env.MAIL_INBOX_PORT ?? 993);

const socket = tls.connect({ host, port, servername: host, rejectUnauthorized: false }, () => {
  const cert = socket.getPeerCertificate();
  console.log(`host=${host}:${port}`);
  console.log('subject:', JSON.stringify(cert.subject));
  console.log('issuer:', JSON.stringify(cert.issuer));
  console.log('valid_from:', cert.valid_from, 'valid_to:', cert.valid_to);
  console.log('authorized:', socket.authorized, socket.authorizationError ?? '');
  socket.end();
});

socket.on('error', (error) => {
  console.error('[FAIL]', error.message);
  process.exitCode = 1;
});

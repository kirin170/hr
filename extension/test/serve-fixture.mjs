// 本地夹具静态服务：只为 ATS-011 自测提供页面与附件字节，不对应任何真实平台。
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const root = new URL('./fixtures/', import.meta.url);
const types = { '.html': 'text/html; charset=utf-8', '.pdf': 'application/pdf' };

createServer((req, res) => {
  const path = req.url === '/' ? '/candidate.html' : req.url.split('?')[0];
  try {
    const file = readFileSync(new URL(`.${path}`, root));
    const ext = path.slice(path.lastIndexOf('.'));
    res.writeHead(200, { 'Content-Type': types[ext] ?? 'application/octet-stream' });
    res.end(file);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(4174, '127.0.0.1', () => console.log('fixture server on http://127.0.0.1:4174'));
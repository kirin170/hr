import { createServer, request as proxyRequest } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

export async function verifyInterviewUi(apiPort, token, firstId) {
  const root = join(process.cwd(), '..', 'dist');
  const server = createServer(async (req, res) => {
    if ((req.url || '').startsWith('/api/')) {
      const path = req.url.startsWith('/api/v1/') ? req.url : req.url.slice(4);
      const upstream = proxyRequest({ hostname:'127.0.0.1', port:apiPort, path, method:req.method, headers:{...req.headers, host:`127.0.0.1:${apiPort}`} }, incoming => { res.writeHead(incoming.statusCode || 500, incoming.headers); incoming.pipe(res); });
      upstream.on('error', () => { res.statusCode = 502; res.end(); }); req.pipe(upstream); return;
    }
    const pathname = new URL(req.url || '/', 'http://localhost').pathname;
    const file = pathname.startsWith('/assets/') && !pathname.includes('..') ? join(root, pathname.slice(1)) : join(root, 'index.html');
    try { const content = await readFile(file); const type = {'.js':'text/javascript','.css':'text/css','.html':'text/html'}[extname(file)] || 'application/octet-stream'; res.writeHead(200, {'content-type': type}); res.end(content); } catch { res.statusCode=404; res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const packageFile = process.env.ATS014_PLAYWRIGHT_PATH || join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
  const { chromium } = await import(pathToFileURL(packageFile).href);
  let browser;
  try {
    browser = await chromium.launch({ headless:true, executablePath:process.env.ATS014_CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
    const context = await browser.newContext({ acceptDownloads:true });
    await context.addInitScript(value => localStorage.setItem('talentflow.accessToken', value), token);
    const page = await context.newPage(); await page.goto(origin);
    await page.locator('button[title="面试安排"]').click();
    await page.getByRole('heading', {name:'今天', exact:true}).waitFor();
    await page.getByRole('heading', {name:'明天及以后', exact:true}).waitFor();
    await page.getByRole('heading', {name:'昨天及以前', exact:true}).waitFor();
    await page.locator('.interview-card').first().waitFor();
    assert.ok(await page.locator('section').filter({has:page.getByRole('heading',{name:'今天',exact:true})}).locator('.interview-card').count());
    assert.ok(await page.locator('section').filter({has:page.getByRole('heading',{name:'明天及以后',exact:true})}).locator('.interview-card').count());
    assert.ok(await page.locator('section').filter({has:page.getByRole('heading',{name:'昨天及以前',exact:true})}).locator('.interview-card').count());
    const search = page.getByPlaceholder('候选人姓名'); await search.fill('不存在的候选人');
    await page.waitForFunction(() => document.querySelectorAll('.interview-card').length === 0); assert.equal(await page.locator('.interview-card').count(),0);
    await search.fill('Candidate'); await page.locator('.interview-card').first().waitFor();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button',{name:'导出筛选结果'}).click()]);
    const csv = await readFile(await download.path(), 'utf8'); assert.match(csv,/Candidate/); assert.match(csv,/职位 ID/);
    await page.locator(`[data-interview-id="${firstId}"]`).getByRole('button',{name:'协同详情'}).click();
    await page.getByRole('heading',{name:'面试评价'}).waitFor();
    await page.getByRole('heading',{name:'听记链接'}).waitFor();
    await page.getByRole('heading',{name:'面试登记表'}).waitFor();
    await page.getByRole('button',{name:'生成候选人填写链接'}).click();
    const invite = await page.getByLabel('一次性链接，请通过授权渠道交给候选人').inputValue(); assert.ok(invite.includes('/registration#'));
    const candidateContext = await browser.newContext(); const candidate = await candidateContext.newPage(); await candidate.goto(invite);
    await candidate.getByLabel('电话').fill('123'); await candidate.getByRole('button',{name:'提交', exact:true}).click();
    await candidate.getByText('登记表已提交，谢谢。').waitFor();
    await candidateContext.close(); await context.close();
    console.log('ATS-014 headless browser: 分组三段、筛选、CSV 导出、协同详情和候选人登记通过。');
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
}

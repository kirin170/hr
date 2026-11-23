import { createServer, request as proxyRequest } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
export async function verifyOfferUi(apiPort, token) {
 const root=join(process.cwd(),'..','dist');
 const server=createServer(async(req,res)=>{
  if ((req.url||'').startsWith('/api/')) { const path=req.url.startsWith('/api/v1/')?req.url:req.url.slice(4);const up=proxyRequest({hostname:'127.0.0.1',port:apiPort,path,method:req.method,headers:{...req.headers,host:`127.0.0.1:${apiPort}`}},incoming=>{res.writeHead(incoming.statusCode||500,incoming.headers);incoming.pipe(res)});up.on('error',()=>{res.statusCode=502;res.end()});req.pipe(up);return; }
  const pathname=new URL(req.url||'/','http://localhost').pathname;const file=pathname.startsWith('/assets/')&&!pathname.includes('..')?join(root,pathname.slice(1)):join(root,'index.html');
  try {const content=await readFile(file);res.writeHead(200,{'content-type':{'.js':'text/javascript','.css':'text/css','.html':'text/html'}[extname(file)]||'application/octet-stream'});res.end(content)}catch{res.statusCode=404;res.end()}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const {chromium}=await import(pathToFileURL(process.env.ATS014_PLAYWRIGHT_PATH||join(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs')).href);let browser;
 try {browser=await chromium.launch({headless:true,executablePath:process.env.ATS014_CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});const context=await browser.newContext();await context.addInitScript(value=>localStorage.setItem('talentflow.accessToken',value),token);const page=await context.newPage();await page.goto(`http://127.0.0.1:${server.address().port}`);await page.locator('button[title="简历库"]').click();await page.getByRole('button',{name:/界面候选人/}).first().click();await page.getByRole('heading',{name:'Offer 协同'}).waitFor();await page.getByRole('button',{name:'开始 Offer'}).click();await page.getByText('录用审批资料',{exact:true}).waitFor();await page.getByLabel('录用职级').fill('P6');await page.getByLabel('OA 单号').fill('UI-OA');await page.getByRole('button',{name:'保存资料'}).click();await page.getByRole('button',{name:'预览 OA 材料'}).click();await page.getByText('"hireLevel": "P6"',{exact:false}).waitFor();await page.getByRole('button',{name:'记录接受 / 通过'}).click();await page.getByRole('button',{name:'推进下一阶段'}).click();await page.getByText('OA 审批中',{exact:true}).waitFor();assert.match(await page.getByRole('heading',{name:'Offer 协同'}).locator('..').innerText(),/待处理/);await context.close();console.log('ATS-015 headless browser: 创建、OA 材料预览、接受与显式推进通过。');}
 finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve))}
}

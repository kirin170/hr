const fs = require('fs');
const http = require('http');
const path = require('path');
const net = require('net');
const crypto = require('crypto');
const { spawn } = require('child_process');

const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profile = path.resolve('.chrome-cdp-profile');
const out = path.resolve('screenshots');
fs.mkdirSync(profile, { recursive: true });
fs.mkdirSync(out, { recursive: true });
const browser = spawn(chrome, ['--headless=new','--disable-gpu','--disable-software-rasterizer','--disable-features=Vulkan,UseSkiaRenderer','--no-sandbox','--no-first-run',`--user-data-dir=${profile}`,'--remote-debugging-port=9223','--window-size=1440,1000','about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const getJson = url => new Promise((resolve, reject) => http.get(url, res => { let data=''; res.on('data', d => data += d); res.on('end', () => { try { resolve(JSON.parse(data)) } catch(e) { reject(e) } }); }).on('error', reject));

class CDP {
  constructor(url) {
    const u = new URL(url);
    this.socket = net.connect(Number(u.port), u.hostname);
    this.key = crypto.randomBytes(16).toString('base64');
    this.buffer = Buffer.alloc(0);
    this.pending = new Map();
    this.nextId = 0;
    this.ready = new Promise((resolve, reject) => {
      this.socket.on('error', reject);
      this.socket.on('connect', () => {
        this.socket.write(`GET ${u.pathname}${u.search} HTTP/1.1\r\nHost: ${u.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${this.key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
      });
    });
    this.socket.on('data', chunk => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      if (!this.upgraded) {
        const marker = this.buffer.indexOf('\r\n\r\n');
        if (marker >= 0) { this.upgraded = true; this.buffer = this.buffer.slice(marker + 4); this.readyResolve(); }
        else return;
      }
      if (!this.upgraded) return;
      while (this.buffer.length >= 2) {
        let offset = 2; const second = this.buffer[1]; let len = second & 127;
        if (len === 126) { if (this.buffer.length < 4) return; len = this.buffer.readUInt16BE(2); offset = 4; }
        else if (len === 127) { if (this.buffer.length < 10) return; len = Number(this.buffer.readBigUInt64BE(2)); offset = 10; }
        if (this.buffer.length < offset + 4 + len) return;
        const mask = this.buffer.slice(offset, offset + 4); const data = Buffer.from(this.buffer.slice(offset + 4, offset + 4 + len));
        for (let i = 0; i < data.length; i++) data[i] ^= mask[i % 4];
        const opcode = this.buffer[0] & 15; this.buffer = this.buffer.slice(offset + 4 + len);
        if (opcode === 1) { const msg = JSON.parse(data.toString()); if (msg.id && this.pending.has(msg.id)) { const p = this.pending.get(msg.id); this.pending.delete(msg.id); msg.error ? p.reject(msg.error) : p.resolve(msg.result); } }
      }
    });
    this.opened = new Promise((resolve, reject) => { this.readyResolve = resolve; this.ready.catch(reject); });
  }
  send(method, params = {}) {
    const id = ++this.nextId; const payload = Buffer.from(JSON.stringify({ id, method, params }));
    const mask = crypto.randomBytes(4); const len = payload.length;
    let header;
    if (len < 126) header = Buffer.from([0x81, 0x80 | len]);
    else if (len < 65536) { header = Buffer.alloc(4); header[0]=0x81; header[1]=0x80|126; header.writeUInt16BE(len,2); }
    else { header = Buffer.alloc(10); header[0]=0x81; header[1]=0x80|127; header.writeBigUInt64BE(BigInt(len),2); }
    const masked = Buffer.alloc(len); for (let i=0;i<len;i++) masked[i]=payload[i]^mask[i%4];
    this.socket.write(Buffer.concat([header,mask,masked]));
    return new Promise((resolve,reject)=>this.pending.set(id,{resolve,reject}));
  }
  close(){ this.socket.destroy(); }
}

async function main(){
  let tabs;
  for(let i=0;i<40;i++){ try { tabs=await getJson('http://127.0.0.1:9223/json'); break } catch { await sleep(250) } }
  if(!tabs) throw new Error('CDP not ready');
  const tab=tabs.find(t=>t.type==='page');
  const cdp=new CDP(tab.webSocketDebuggerUrl); await cdp.opened;
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await cdp.send('Page.navigate',{url:'http://127.0.0.1:4173/'}); await sleep(1200);
  const evaluate = async expression => (await cdp.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true})).result.value;
  const shot = async name => { const r=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false}); fs.writeFileSync(path.join(out,name),Buffer.from(r.data,'base64')); };
  const clickText = async text => evaluate(`(()=>{const e=[...document.querySelectorAll('button')].find(x=>x.innerText.trim().includes(${JSON.stringify(text)}));if(!e)return 'missing';e.click();return 'clicked'})()`);
  await shot('01-dashboard.png');
  console.log('dashboard', await clickText('简历库')); await sleep(300); await shot('02-candidates.png');
  console.log('candidate', await clickText('顾若安')); await sleep(350); await shot('03-candidate-drawer.png');
  await evaluate(`document.querySelector('.candidate-drawer .drawer-header .icon-button').click()`); await sleep(200);
  await clickText('招聘流程'); await sleep(300); await shot('04-pipeline.png');
  await clickText('面试安排'); await sleep(300); await shot('05-interviews.png');
  await clickText('试用期管理'); await sleep(300); await shot('06-probation.png');
  await clickText('部门协同'); await sleep(300); await shot('07-team.png');
  await clickText('招聘数据'); await sleep(300); await shot('08-reports.png');
  await clickText('简历库'); await sleep(200); await clickText('添加候选人'); await sleep(250); await shot('09-add-candidate.png');
  const metrics = await evaluate(`({w:document.documentElement.scrollWidth,h:document.documentElement.scrollHeight,vw:innerWidth,vh:innerHeight,text:document.body.innerText.slice(0,100)})`);
  console.log(JSON.stringify(metrics));
  cdp.close(); browser.kill();
}
main().catch(async e=>{console.error(e);browser.kill();process.exit(1)});

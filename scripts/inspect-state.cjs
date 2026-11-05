const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, args: ['--disable-gpu', '--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto('http://127.0.0.1:4173', { waitUntil: 'networkidle' });
  const result = await page.evaluate(() => {
    const raw = localStorage.getItem('talentflow-demo-v1');
    if (!raw) return null;
    const data = JSON.parse(raw);
    return {
      candidates: data.candidates.map(c => ({ id: c.id, name: c.name, stage: c.stage, date: c.appliedAt })),
      interviews: data.interviews.map(i => ({ id: i.id, candidateId: i.candidateId, date: i.date, status: i.status, round: i.round })),
      probation: data.probation.map(p => ({ id: p.id, name: p.name, status: p.status })),
    };
  });
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });

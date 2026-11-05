const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, args: ['--disable-gpu', '--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:4173', { waitUntil: 'networkidle' });
  await page.locator('.sidebar-nav .nav-item').filter({ hasText: '试用期管理' }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'screenshots/probation-fixed.png', fullPage: true });
  console.log('errors', JSON.stringify(errors));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });

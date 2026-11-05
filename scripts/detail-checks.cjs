const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, args: ['--disable-gpu', '--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto('http://127.0.0.1:4173', { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.removeItem('talentflow-demo-v1'));
  await page.reload({ waitUntil: 'networkidle' });

  await page.locator('.sidebar-nav .nav-item').filter({ hasText: '试用期管理' }).click();
  await page.locator('.probation-table tbody tr').filter({ hasText: '夏禾' }).locator('.row-more').click();
  await page.locator('.probation-drawer').waitFor();
  await page.screenshot({ path: 'screenshots/probation-drawer.png', fullPage: true });
  await page.locator('.probation-drawer .drawer-header .icon-button').click();

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator('.sidebar-nav .nav-item').filter({ hasText: '工作台' }).click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'screenshots/dashboard-1280.png', fullPage: true });

  await page.setViewportSize({ width: 1180, height: 800 });
  await page.locator('.sidebar-nav .nav-item').filter({ hasText: '简历库' }).click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'screenshots/candidates-1180.png', fullPage: true });

  console.log('captured detail and responsive screenshots');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });

const { chromium } = require('playwright-core');
const path = require('path');

(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: ['--disable-gpu', '--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(`console: ${msg.text()}`); });
  page.on('pageerror', err => errors.push(`pageerror: ${err.message}`));

  await page.goto('http://127.0.0.1:4173', { waitUntil: 'networkidle' });
  await page.waitForSelector('.app-shell');
  await page.waitForTimeout(350);

  const out = p => path.join(process.cwd(), 'screenshots', p);
  const snap = async name => {
    await page.waitForTimeout(180);
    await page.screenshot({ path: out(name), fullPage: true });
    console.log('captured', name);
  };

  const nav = async (label, name) => {
    await page.locator('.sidebar-nav .nav-item').filter({ hasText: label }).first().click();
    await page.waitForTimeout(250);
    await snap(name);
  };

  await nav('简历库', 'candidates.png');
  await page.locator('.candidate-cell').first().click();
  await page.waitForSelector('.candidate-drawer');
  await snap('candidate-drawer.png');
  await page.locator('.candidate-drawer .drawer-header .icon-button').first().click();

  await nav('招聘流程', 'pipeline.png');
  await nav('面试安排', 'interviews.png');
  await page.getByRole('button', { name: /安排面试/ }).first().click();
  await page.waitForSelector('.interview-modal');
  await snap('interview-modal.png');
  await page.locator('.interview-modal .modal-header .icon-button').click();

  await nav('试用期管理', 'probation.png');
  await nav('部门协同', 'team.png');
  await nav('招聘数据', 'reports.png');

  await page.locator('.sidebar-footer .nav-item').filter({ hasText: '设置' }).click();
  await page.waitForSelector('.settings-modal');
  await snap('settings-modal.png');
  await page.locator('.settings-modal .modal-header .icon-button').click();

  await page.locator('.sidebar-nav .nav-item').filter({ hasText: '简历库' }).first().click();
  await page.getByRole('button', { name: /添加候选人/ }).first().click();
  await page.waitForSelector('.modal');
  await snap('add-candidate-modal.png');

  console.log('errors', JSON.stringify(errors));
  await browser.close();
})().catch(err => { console.error(err); process.exit(1); });

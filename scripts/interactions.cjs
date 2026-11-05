const { chromium } = require('playwright-core');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
(async () => {
  const browser = await chromium.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: true, args: ['--disable-gpu', '--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  await page.goto('http://127.0.0.1:4173', { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.removeItem('talentflow-demo-v1'));
  await page.reload({ waitUntil: 'networkidle' });

  const nav = async label => {
    await page.locator('.sidebar-nav .nav-item').filter({ hasText: label }).first().click();
    await page.waitForTimeout(120);
  };

  // Candidate search and pagination.
  await nav('简历库');
  await page.locator('.table-search input').fill('顾若安');
  await page.waitForTimeout(100);
  assert(await page.locator('.candidate-table tbody tr').count() === 1, 'candidate search did not filter to one row');
  await page.locator('.table-search button').click();
  assert(await page.locator('.candidate-table tbody tr').count() === 7, 'candidate first page count mismatch');
  await page.locator('.pagination button').filter({ hasText: '2' }).click();
  assert(await page.locator('.candidate-table tbody tr').count() === 5, 'candidate second page count mismatch');

  // Batch select.
  await page.locator('.candidate-table tbody input[type=checkbox]').first().click();
  assert(await page.locator('.bulk-bar').isVisible(), 'bulk bar not shown');

  // Add candidate and verify persistence.
  await page.getByRole('button', { name: /添加候选人/ }).first().click();
  await page.locator('.add-candidate-modal input').first().fill('交互测试候选人');
  await page.locator('.add-candidate-modal input').nth(1).fill('13800000000');
  await page.locator('.add-candidate-modal .modal-footer .button-primary').click();
  await page.waitForTimeout(150);
  await page.locator('.table-search input').fill('交互测试候选人');
  assert(await page.locator('.candidate-table tbody tr').count() === 1, 'new candidate not visible');
  const storedAfterAdd = await page.evaluate(() => JSON.parse(localStorage.getItem('talentflow-demo-v1')).candidates.some(c => c.name === '交互测试候选人'));
  assert(storedAfterAdd, 'new candidate not persisted');

  // Open candidate and schedule interview from drawer.
  await page.locator('.candidate-cell').first().click();
  await page.locator('.candidate-drawer').waitFor();
  await page.locator('.candidate-drawer .drawer-header .button-primary').click();
  await page.locator('.interview-modal').waitFor();
  const selectedCandidate = await page.locator('.interview-modal select').first().inputValue();
  assert(selectedCandidate.startsWith('c-'), 'interview modal candidate was not preselected');
  await page.locator('.interview-modal .modal-footer .button-primary').click();
  await page.waitForTimeout(150);
  const storedInterview = await page.evaluate(name => {
    const data = JSON.parse(localStorage.getItem('talentflow-demo-v1'));
    const candidate = data.candidates.find(c => c.name === name);
    return data.interviews.some(i => i.candidateId === candidate?.id);
  }, '交互测试候选人');
  assert(storedInterview, 'scheduled interview not persisted');

  // Pipeline drag and drop.
  await nav('招聘流程');
  const source = page.locator('.kanban-card').first();
  const target = page.locator('.kanban-column').nth(1);
  await source.dragTo(target);
  await page.waitForTimeout(150);
  const firstCardStage = await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('talentflow-demo-v1'));
    return data.candidates.find(c => c.name === '交互测试候选人')?.stage;
  });
  assert(firstCardStage === 'screening', `pipeline drag did not persist expected stage, got ${firstCardStage}`);

  // Interview feedback.
  await nav('面试安排');
  await page.locator('.date-navigator button').first().click();
  await page.waitForTimeout(120);
  const feedbackButton = page.getByRole('button', { name: '填写反馈' }).first();
  assert(await feedbackButton.isVisible(), 'feedback button not visible on yesterday view');
  await feedbackButton.click();
  await page.waitForTimeout(100);
  const feedbackSaved = await page.evaluate(() => JSON.parse(localStorage.getItem('talentflow-demo-v1')).interviews.some(i => i.status === 'completed' && i.feedback));
  assert(feedbackSaved, 'interview feedback not persisted');

  // Probation conversion.
  await nav('试用期管理');
  await page.locator('.probation-table tbody tr').filter({ hasText: '夏禾' }).locator('.row-more').click();
  await page.locator('.probation-drawer').waitFor();
  await page.getByRole('button', { name: /确认转正/ }).click();
  await page.waitForTimeout(120);
  const converted = await page.evaluate(() => JSON.parse(localStorage.getItem('talentflow-demo-v1')).probation.find(p => p.name === '夏禾')?.status);
  assert(converted === 'converted', 'probation conversion not persisted');

  // Settings data reset.
  await page.locator('.sidebar-footer .nav-item').filter({ hasText: '设置' }).click();
  await page.locator('.settings-nav button').filter({ hasText: '工作区' }).click();
  await page.getByRole('button', { name: /重置数据/ }).click();
  await page.waitForTimeout(120);
  const reset = await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('talentflow-demo-v1'));
    return { candidateCount: data.candidates.length, hasTest: data.candidates.some(c => c.name === '交互测试候选人') };
  });
  assert(reset.candidateCount === 12 && !reset.hasTest, `reset did not restore seed data: ${JSON.stringify(reset)}`);

  console.log('PASS: search, pagination, batch state, add candidate, schedule interview, drag stage, feedback, conversion, reset');
  console.log('errors', JSON.stringify(errors));
  assert(errors.length === 0, `runtime errors: ${JSON.stringify(errors)}`);
  await browser.close();
})().catch(async e => { console.error('FAIL:', e.message); process.exit(1); });

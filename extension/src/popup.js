const send = (message) => chrome.runtime.sendMessage(message);
const $ = (id) => document.getElementById(id);
let lastTaskId = null;

function say(text, tone = '') {
  const el = $('message');
  el.textContent = text ?? '';
  el.className = `message ${tone}`;
}

function renderAdapters(list) {
  const box = $('adapters');
  box.textContent = '';
  for (const adapter of list) {
    const row = document.createElement('div');
    row.className = 'adapter';
    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.checked = adapter.enabled;
    toggle.style.width = 'auto';
    toggle.addEventListener('change', async () => {
      const res = await send({ type: 'ats.adapters.toggle', id: adapter.id, enabled: toggle.checked });
      renderAdapters(res.adapters);
    });
    const version = document.createElement('select');
    for (const v of adapter.versions) {
      const option = document.createElement('option');
      option.value = v; option.textContent = v;
      if (v === adapter.activeVersion) option.selected = true;
      version.append(option);
    }
    version.addEventListener('change', async () => {
      const res = await send({ type: 'ats.adapters.version', id: adapter.id, version: version.value });
      renderAdapters(res.adapters);
      say(`已切换到 ${adapter.id} ${version.value}（选历史版本即为回滚）`);
    });
    const label = document.createElement('span');
    label.textContent = `${adapter.name}${adapter.testOnly ? ' · 仅测试' : ''} · 灰度 ${adapter.rolloutPercent}%`;
    row.append(toggle, label, version);
    box.append(row);
  }
}

async function refresh() {
  const res = await send({ type: 'ats.status' });
  const tag = $('adapter');
  if (res.adapter) {
    tag.textContent = `${res.adapter.id} ${res.adapter.version}`;
    tag.className = 'tag ok';
  } else {
    tag.textContent = res.host ? '该站点未支持' : '无可用页面';
    tag.className = 'tag off';
  }
  renderAdapters(res.adapters ?? []);
  const authorized = !!res.status?.authorized;
  $('import').hidden = !authorized;
  $('run').disabled = !authorized || !res.adapter;
  if (authorized) {
    const jobs = await send({ type: 'ats.jobs' });
    const select = $('job');
    select.textContent = '';
    for (const job of jobs.jobs ?? []) {
      const option = document.createElement('option');
      option.value = job.id;
      option.textContent = `${job.title}${job.code ? ` · ${job.code}` : ''}`;
      select.append(option);
    }
    if (jobs.error) say(jobs.error.text, 'error');
  } else if (res.status?.expired) {
    say('导入令牌已过期，请重新授权。', 'warn');
  }
}

$('authorize').addEventListener('click', async () => {
  const token = $('token').value.trim();
  const expiresRaw = $('expires').value;
  if (!token) { say('请填入导入令牌。', 'warn'); return; }
  const expiresAt = expiresRaw ? new Date(expiresRaw).toISOString() : null;
  const res = await send({ type: 'ats.authorize', token, expiresAt });
  if (res?.ok) { $('token').value = ''; say('已授权。', 'ok'); await refresh(); }
  else say('授权失败，请检查令牌。', 'error');
});

$('revoke').addEventListener('click', async () => {
  await send({ type: 'ats.revoke' });
  say('已清除本地令牌。如需彻底吊销，请在 TalentFlow 接入配置页撤销。', 'ok');
  await refresh();
});

async function runImport(retry) {
  $('run').disabled = true;
  say('正在导入…');
  const res = await send({ type: 'ats.import', targetJobId: $('job').value, retry });
  $('run').disabled = false;
  if (res?.error) {
    say(res.error.text, 'error');
    $('retry').hidden = res.error.action !== 'retry';
    return;
  }
  lastTaskId = res.task?.taskId ?? null;
  $('retry').hidden = true;
  say(res.result?.text ?? '已提交。', res.result?.tone ?? '');
}

$('run').addEventListener('click', () => runImport(false));
$('retry').addEventListener('click', () => runImport(true));

void refresh();
void lastTaskId;
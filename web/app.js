// Connects the office to the server: sidebar + drawer, sign-in status, projects, sessions, tasks, approvals, model choice and live updates.
(function () {
  const $ = id => document.getElementById(id);
  const S = { agents: [], models: [], efforts: [], tasks: [], approvals: [], projects: [], sessions: [], usage: null, auth: {}, lead: 'somphone', project: '' };
  const STATUS_TEXT = { queued: 'ລໍຖ້າຄິວ', running: 'ກຳລັງເຮັດ', waiting: 'ລໍຖ້າເຈົ້າ', done: 'ສຳເລັດ', failed: 'ບໍ່ສຳເລັດ', stopped: 'ຢຸດແລ້ວ' };
  const EFFORT_TEXT = { low: 'ຕ່ຳ', medium: 'ປານກາງ', high: 'ສູງ', xhigh: 'ສູງຫຼາຍ', max: 'ສູງສຸດ' };
  const ACCESS_TEXT = { read: '🔒 ອ່ານໄດ້ຢ່າງດຽວ (ບໍ່ແກ້ໄຂໄຟລ໌)', write: '✏️ ອ່ານ ແລະ ແກ້ໄຂໄຟລ໌ໄດ້ · ລັນຄຳສັ່ງຕ້ອງຂໍອະນຸຍາດ' };
  const PANEL_TITLE = { compose: 'ສັ່ງວຽກໃໝ່', approvals: 'ລໍຖ້າເຈົ້າ', tasks: 'ວຽກທັງໝົດ', projects: 'ໂປຣເຈັກ ແລະ session', rooms: 'ຫ້ອງ' };
  const AUTH_TEXT = a => a.mode === 'login' ? `Claude Code${a.plan ? ' · ' + a.plan : ''}` : a.mode === 'apiKey' ? 'API key (.env)' : a.mode === 'none' ? 'ຍັງບໍ່ໄດ້ login' : 'ກຳລັງກວດ login…';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const agent = k => S.agents.find(a => a.key === k);
  const api = async (url, opts = {}) => {
    const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
    return data;
  };
  const say = t => { $('formMsg').textContent = t; };
  const waitOffice = () => new Promise(res => { const t = setInterval(() => { if (window.OFFICE) { clearInterval(t); res(); } }, 50); });
  const mode = () => document.querySelector('input[name="mode"]:checked').value;
  const setCount = (el, n) => { el.hidden = !n; el.textContent = n || ''; };

  // ---------- sidebar + drawer ----------
  let panel = null;
  function openPanel(name) {
    panel = name;
    $('drawer').hidden = !name; document.body.classList.toggle('drawerOpen', !!name);
    document.querySelectorAll('.nav[data-panel]').forEach(b => { if (b.dataset.panel === name) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current'); });
    document.querySelectorAll('.pane').forEach(p => p.classList.toggle('on', p.dataset.pane === name));
    if (name) $('drawerTitle').textContent = PANEL_TITLE[name] || '';
    if (name === 'compose') setTimeout(() => $('tTitle').focus(), 50);
    if (name === 'projects') loadSessions();
    if (window.innerWidth <= 900) document.body.classList.remove('menuOpen');
  }
  document.querySelectorAll('.nav[data-panel]').forEach(b => b.addEventListener('click', () => openPanel(panel === b.dataset.panel ? null : b.dataset.panel)));
  $('drawerClose').onclick = () => openPanel(null);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && panel && !$('taskDlg').open) openPanel(null); });
  $('menuBtn').onclick = () => { const on = document.body.classList.toggle('menuOpen'); $('menuBtn').setAttribute('aria-expanded', String(on)); };
  $('team').addEventListener('click', () => { if (window.innerWidth <= 900) document.body.classList.remove('rOpen'); });
  $('rToggle').onclick = () => { const on = document.body.classList.toggle('rOpen'); $('rToggle').setAttribute('aria-expanded', String(on)); };
  $('usageRefresh').onclick = async () => { $('usageNote').textContent = 'ກຳລັງອັບເດດ…'; try { S.usage = await api('/api/usage/refresh', { method: 'POST' }); } catch { /* keep last */ } renderUsage(); };

  // ---------- renderers ----------
  function renderAuth() {
    $('authBadge').dataset.mode = S.auth.mode || 'checking';
    $('authText').textContent = AUTH_TEXT(S.auth);
    $('authHelp').hidden = S.auth.mode !== 'none';
    $('authBadge').title = S.auth.email ? `Login: ${S.auth.email}` : '';
  }
  // real plan limits (5-hour and weekly) from the Claude Code login
  const untilText = iso => {
    if (!iso) return '';
    const ms = new Date(iso) - Date.now(); if (ms <= 0) return 'ກຳລັງຣີເຊັດ';
    const h = Math.floor(ms / 3.6e6), m = Math.floor(ms % 3.6e6 / 6e4);
    if (h >= 24) return `ຣີເຊັດ ${new Date(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} ${new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    return `ຣີເຊັດໃນ ${h ? h + ' ຊມ ' : ''}${m} ນາທີ (${new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`;
  };
  const limitCard = (title, w) => {
    if (!w) return '';
    const sev = w.pct >= 90 ? 'crit' : w.pct >= 70 ? 'warn' : 'ok';
    return `<div class="limit" data-sev="${sev}"><div class="lt"><b>${title}</b><span class="pct">${w.pct}%</span></div><div class="bar"><i style="width:${Math.min(100, w.pct)}%"></i></div><small>${untilText(w.resetsAt)}</small></div>`;
  };
  function renderUsage() {
    const u = S.usage, box = $('usageBox');
    if (S.auth.mode === 'apiKey') { box.innerHTML = '<p class="empty">ໃຊ້ API key ຢູ່: ບໍ່ມີຂີດຈຳກັດ 5 ຊົ່ວໂມງ ຫຼື ລາຍອາທິດ (ຄິດເງິນຕາມການໃຊ້).</p>'; $('usageNote').textContent = ''; return; }
    if (!u) { box.innerHTML = `<p class="empty">${S.auth.mode === 'none' ? 'ຕ້ອງ login Claude Code ກ່ອນ.' : 'ກຳລັງໂຫຼດ…'}</p>`; $('usageNote').textContent = ''; return; }
    if (!u.available) { box.innerHTML = '<p class="empty">ບັນຊີນີ້ບໍ່ມີຂໍ້ມູນຂີດຈຳກັດ.</p>'; return; }
    box.innerHTML = limitCard('ຮອບ 5 ຊົ່ວໂມງ', u.fiveHour) + limitCard('ລາຍອາທິດ (ທຸກໂມເດວ)', u.weekly) + limitCard('ລາຍອາທິດ · Opus', u.weeklyOpus) + limitCard('ລາຍອາທິດ · Sonnet', u.weeklySonnet);
    $('usageNote').textContent = `${u.plan ? 'ແພັກເກດ Claude ' + u.plan[0].toUpperCase() + u.plan.slice(1) + ' · ' : ''}ອັບເດດ ${new Date(u.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }
  setInterval(renderUsage, 30_000);
  function renderCounts() {
    setCount($('apCount'), S.approvals.length);
    setCount($('taskCount'), S.tasks.filter(t => ['queued', 'running', 'waiting'].includes(t.status)).length);
    setCount($('busyCount'), S.agents.filter(a => ['working', 'waiting', 'meeting'].includes(a.status)).length);
    $('teamCount').textContent = `ທີມ ${S.agents.length} ຄົນ`;
  }
  function renderTasks() {
    const box = $('tasks');
    if (!S.tasks.length) box.innerHTML = '<p class="empty">ຍັງບໍ່ມີວຽກ. ກົດ "ສັ່ງວຽກໃໝ່" ເພື່ອເລີ່ມ.</p>';
    else box.innerHTML = S.tasks.slice(0, 50).map(t => {
      const a = agent(t.assignee), proj = t.cwd ? t.cwd.split('/').pop() : '';
      const who = t.mode === 'team' ? `👥 ທີມ (ນຳໂດຍ ${a?.name || t.assignee})` : `👤 ${a ? a.name + ' · ' + a.role : t.assignee}`;
      return `<button type="button" class="task" data-id="${t.id}"><div class="top"><b>${esc(t.title)}</b><span class="st ${t.status}">${STATUS_TEXT[t.status] || t.status}</span></div><small>${esc(who)} · 📁 ${esc(proj)}${t.costUsd ? ` · $${t.costUsd.toFixed(3)}` : ''}</small></button>`;
    }).join('');
    renderCounts();
  }
  function renderApprovals() {
    $('apEmpty').hidden = !!S.approvals.length;
    $('approvals').innerHTML = S.approvals.map(ap => {
      const a = agent(ap.agent), t = S.tasks.find(x => x.id === ap.taskId);
      if (ap.kind === 'plan') {
        return `<div class="approval plan"><p><b>${esc(a?.name || ap.agent)}</b> ສົ່ງແຜນມາໃຫ້ອະນຸມັດ${t ? `<br><small>ວຽກ: ${esc(t.title)}</small>` : ''}</p><pre>${esc(ap.plan)}</pre><textarea rows="2" id="fb-${ap.id}" placeholder="ຖ້າຢາກໃຫ້ແກ້ແຜນ ຂຽນຄຳແນະນຳຢູ່ນີ້"></textarea><div class="btns"><button type="button" class="btn yes" data-ap="${ap.id}" data-allow="1">ອະນຸມັດແຜນ</button><button type="button" class="btn no" data-ap="${ap.id}" data-allow="0">ໃຫ້ແກ້ແຜນ</button></div></div>`;
      }
      const detail = ap.input?.command || ap.input?.file_path || JSON.stringify(ap.input || {}).slice(0, 300);
      return `<div class="approval"><p><b>${esc(a?.name || ap.agent)}</b> ຂໍ: ${esc(ap.summary)}${t ? `<br><small>ວຽກ: ${esc(t.title)}</small>` : ''}</p><code>${esc(detail)}</code><div class="btns"><button type="button" class="btn yes" data-ap="${ap.id}" data-allow="1">ອະນຸຍາດ</button><button type="button" class="btn no" data-ap="${ap.id}" data-allow="0">ບໍ່ອະນຸຍາດ</button></div></div>`;
    }).join('');
    renderCounts();
  }
  function renderAssignees() {
    const sel = $('tAssignee'), cur = sel.value;
    sel.innerHTML = S.agents.map(a => `<option value="${a.key}">${esc(a.name)} · ${esc(a.role)}</option>`).join('');
    if (cur) sel.value = cur;
  }
  function renderMode() {
    const team = mode() === 'team', lead = agent(S.lead);
    $('tAssignee').hidden = team; $('tAssigneeLabel').hidden = team;
    $('teamHint').textContent = team ? (lead ? `${lead.name} (${lead.role}) ວາງແຜນ${S.superpowers ? ' ດ້ວຍ Superpowers' : ''} → ເຈົ້າອະນຸມັດ → ແຈກວຽກໃຫ້ທີມຕາມບົດບາດ` : '') : 'ມອບວຽກນ້ອຍໃຫ້ຄົນທີ່ເລືອກໂດຍກົງ';
  }
  function renderProjects() {
    if (!S.projects.some(p => p.path === S.project)) S.project = S.projects[0]?.path || '';
    $('tProject').innerHTML = S.projects.map(p => `<option value="${esc(p.path)}">📁 ${esc(p.name)}</option>`).join('');
    $('tProject').value = S.project;
    $('projectList').innerHTML = S.projects.map(p => `<button type="button" class="proj" data-path="${esc(p.path)}" ${p.path === S.project ? 'aria-current="true"' : ''}><b>📁 ${esc(p.name)}</b><small>${esc(p.path)}</small></button>`).join('');
  }
  function renderSessions() {
    const sel = $('tSession'), cur = sel.value;
    sel.innerHTML = '<option value="">✨ Session ໃໝ່</option>' + S.sessions.map(s => `<option value="${s.id}">↩︎ ${esc(s.title.slice(0, 50))}</option>`).join('');
    sel.value = S.sessions.some(s => s.id === cur) ? cur : '';
    $('sessionList').innerHTML = S.sessions.length ? S.sessions.map(s => `<div class="sess"><b>${esc(s.title)}</b><small>${new Date(s.updatedAt).toLocaleString()}${s.branch ? ' · 🌿 ' + esc(s.branch) : ''}</small><div class="btnRow"><button type="button" class="iconBtn" data-resume="${s.id}" data-mode="team">↩︎ ສືບຕໍ່ (ທີມ)</button><button type="button" class="iconBtn" data-resume="${s.id}" data-mode="single">↩︎ ສືບຕໍ່ (ຄົນດຽວ)</button></div></div>`).join('') : '<p class="empty">ໂຟນເດີນີ້ຍັງບໍ່ມີ session ຂອງ Claude Code.</p>';
  }
  async function loadSessions() {
    if (!S.project) return;
    try { S.sessions = await api('/api/sessions?dir=' + encodeURIComponent(S.project)); } catch { S.sessions = []; }
    renderSessions();
  }
  function setProject(p) { S.project = p; renderProjects(); loadSessions(); }
  function prefillResume(sessionId, m, assignee) {
    document.querySelector(`input[name="mode"][value="${m}"]`).checked = true; renderMode();
    if (assignee) $('tAssignee').value = assignee;
    if (![...$('tSession').options].some(o => o.value === sessionId)) $('tSession').insertAdjacentHTML('beforeend', `<option value="${sessionId}">↩︎ session ${sessionId.slice(0, 8)}</option>`);
    $('tSession').value = sessionId; openPanel('compose'); say('ພິມສິ່ງທີ່ຢາກໃຫ້ເຮັດຕໍ່ ແລ້ວກົດ ສົ່ງວຽກ');
  }
  let selectedKey = null;
  function renderCard() {
    const a = agent(selectedKey); if (!a) return;
    $('cRole').textContent = a.role;
    $('cModel').innerHTML = S.models.map(m => `<option value="${m.id}">${esc(m.label)}</option>`).join(''); $('cModel').value = a.model;
    $('cEffort').innerHTML = S.efforts.map(e => `<option value="${e}">${EFFORT_TEXT[e] || e}</option>`).join(''); $('cEffort').value = a.effort;
    $('cAccess').textContent = ACCESS_TEXT[a.access] || '';
  }

  // ---------- task dialog ----------
  let openTaskId = null;
  function renderDialog() {
    const t = S.tasks.find(x => x.id === openTaskId); if (!t) return;
    const a = agent(t.assignee);
    $('dTitle').textContent = t.title;
    $('dMeta').textContent = [t.mode === 'team' ? `ໂໝດທີມ · ນຳໂດຍ ${a?.name}` : `${a?.name} · ${a?.role}`, STATUS_TEXT[t.status], t.model, t.cwd, t.sessionId ? 'session ' + t.sessionId.slice(0, 8) : '', t.costUsd ? '$' + t.costUsd.toFixed(3) : '', t.turns ? t.turns + ' ຮອບ' : ''].filter(Boolean).join(' · ');
    $('dPlanBox').hidden = !t.plan; $('dPlan').textContent = t.plan || '';
    $('dResult').textContent = t.result || t.error || (t.detail ? 'ລາຍລະອຽດ: ' + t.detail : 'ຍັງບໍ່ມີຜົນ');
    $('dLog').innerHTML = (t.log || []).map(l => `<li class="${l.kind}">${new Date(l.t).toLocaleTimeString()} · ${l.who && agent(l.who) ? esc(agent(l.who).name) + ': ' : ''}${esc(l.text)}</li>`).join('') || '<li>ຍັງບໍ່ມີ</li>';
    $('dStop').hidden = !['queued', 'running', 'waiting'].includes(t.status);
    $('dContinue').hidden = !t.sessionId || ['queued', 'running', 'waiting'].includes(t.status);
    $('dOpen').hidden = !t.cwd;
  }
  $('tasks').addEventListener('click', e => { const b = e.target.closest('.task'); if (!b) return; openTaskId = b.dataset.id; renderDialog(); $('taskDlg').showModal(); });
  $('dStop').onclick = async () => { try { await api(`/api/tasks/${openTaskId}/stop`, { method: 'POST' }); } catch (err) { say(err.message); } };
  $('dOpen').onclick = async () => { const t = S.tasks.find(x => x.id === openTaskId); try { await api('/api/projects/open', { method: 'POST', body: { path: t.cwd, editor: 'antigravity' } }); } catch (err) { say(err.message); } };
  $('dContinue').onclick = () => {
    const t = S.tasks.find(x => x.id === openTaskId); if (!t) return;
    $('taskDlg').close(); setProject(t.cwd);
    prefillResume(t.sessionId, t.mode === 'team' ? 'team' : 'single', t.mode === 'team' ? null : t.assignee);
  };

  // ---------- actions ----------
  $('authRecheck').onclick = async () => { S.auth = { mode: 'checking' }; renderAuth(); try { S.auth = await api('/api/auth/recheck', { method: 'POST' }); } catch (err) { say(err.message); } renderAuth(); };
  document.querySelectorAll('input[name="mode"]').forEach(r => r.addEventListener('change', renderMode));
  $('tProject').onchange = () => setProject($('tProject').value);
  $('projectList').addEventListener('click', e => { const b = e.target.closest('.proj'); if (b) setProject(b.dataset.path); });
  $('sessionList').addEventListener('click', e => { const b = e.target.closest('[data-resume]'); if (b) prefillResume(b.dataset.resume, b.dataset.mode); });
  $('pAdd').onclick = async () => {
    try { const p = await api('/api/projects/pick', { method: 'POST' }); if (p.cancelled) return; S.projects = await api('/api/projects'); setProject(p.path); }
    catch (err) { alert(err.message); }
  };
  $('pOpen').onclick = async () => { try { await api('/api/projects/open', { method: 'POST', body: { path: S.project, editor: 'antigravity' } }); } catch (err) { alert('ເປີດບໍ່ໄດ້: ' + err.message); } };
  $('approvals').addEventListener('click', async e => {
    const b = e.target.closest('[data-ap]'); if (!b) return;
    b.disabled = true;
    const feedback = $('fb-' + b.dataset.ap)?.value || '';
    try { await api(`/api/approvals/${b.dataset.ap}`, { method: 'POST', body: { allow: b.dataset.allow === '1', feedback } }); }
    catch (err) { alert(err.message); }
  });
  $('compose').addEventListener('submit', async e => {
    e.preventDefault();
    const title = $('tTitle').value.trim(); if (!title) return;
    const m = mode();
    $('tSend').disabled = true; say('ກຳລັງສົ່ງວຽກ…');
    try {
      const t = await api('/api/tasks', { method: 'POST', body: { title, detail: $('tDetail').value, mode: m, assignee: $('tAssignee').value, cwd: S.project, resume: $('tSession').value || null } });
      const a = agent(t.assignee);
      say(m === 'team' ? `ສົ່ງໃຫ້ທີມແລ້ວ: ${a?.name} ກຳລັງວາງແຜນ` : `ສົ່ງວຽກໃຫ້ ${a?.name} ແລ້ວ`);
      $('tTitle').value = ''; $('tDetail').value = ''; $('tSession').value = '';
      window.OFFICE.focus(t.assignee);
    } catch (err) { say('ສົ່ງບໍ່ສຳເລັດ: ' + err.message); }
    finally { $('tSend').disabled = false; }
  });
  async function saveAgent(patch) {
    try { const a = await api(`/api/agents/${selectedKey}`, { method: 'PATCH', body: patch }); Object.assign(agent(selectedKey), a); syncPerson(selectedKey); }
    catch (err) { alert(err.message); renderCard(); }
  }
  $('cModel').onchange = () => saveAgent({ model: $('cModel').value });
  $('cEffort').onchange = () => saveAgent({ effort: $('cEffort').value });
  $('cAssign').onclick = () => { document.querySelector('input[name="mode"][value="single"]').checked = true; renderMode(); $('tAssignee').value = selectedKey; openPanel('compose'); };

  function syncPerson(key) {
    const a = agent(key); if (!a) return;
    const p = window.OFFICE.people.find(q => q.key === key); if (p) { p.model = a.model; p.role = a.role; }
    window.OFFICE.setLive(key, a);
  }
  function upsertTask(t) { const i = S.tasks.findIndex(x => x.id === t.id); if (i >= 0) S.tasks[i] = t; else S.tasks.unshift(t); renderTasks(); if (openTaskId === t.id) renderDialog(); }

  // ---------- boot ----------
  (async () => {
    await waitOffice();
    window.OFFICE.onSelect = p => { selectedKey = p ? p.key : null; if (p) renderCard(); };
    let st;
    try { st = await api('/api/state'); } catch (err) { $('authText').textContent = 'ເຊື່ອມຕໍ່ server ບໍ່ໄດ້'; return; }
    Object.assign(S, st);
    S.agents.forEach(a => syncPerson(a.key));
    renderAuth(); renderAssignees(); renderMode(); renderProjects(); renderTasks(); renderApprovals(); renderUsage(); renderCounts();
    loadSessions();
    if (S.approvals.length) openPanel('approvals');

    const es = new EventSource('/api/events');
    es.onmessage = m => {
      const ev = JSON.parse(m.data);
      if (ev.type === 'agent') { const a = agent(ev.key); if (a) { Object.assign(a, { status: ev.status, activity: ev.activity, taskId: ev.taskId }); window.OFFICE.setLive(ev.key, a); if (ev.key === selectedKey) renderCard(); renderCounts(); } }
      else if (ev.type === 'agentConfig') { const a = agent(ev.key); if (a) { a.model = ev.model; a.effort = ev.effort; syncPerson(ev.key); if (ev.key === selectedKey) renderCard(); } }
      else if (ev.type === 'task') { upsertTask(ev.task); if (['done', 'failed'].includes(ev.task.status) && ev.task.cwd === S.project) loadSessions(); }
      else if (ev.type === 'log') { const t = S.tasks.find(x => x.id === ev.taskId); if (t) { t.log = [...(t.log || []), ev.entry].slice(-80); if (openTaskId === t.id) renderDialog(); } }
      else if (ev.type === 'approval') { S.approvals.push(ev.approval); renderApprovals(); openPanel('approvals'); window.OFFICE.focus(ev.approval.agent); }
      else if (ev.type === 'approvalDone') { S.approvals = S.approvals.filter(a => a.id !== ev.id); renderApprovals(); }
      else if (ev.type === 'usage') { S.usage = ev.usage; renderUsage(); }
      else if (ev.type === 'auth') { S.auth = ev.auth; renderAuth(); renderUsage(); }
      else if (ev.type === 'projects') { S.projects = ev.projects; renderProjects(); }
    };
    es.onerror = () => { $('authText').textContent = 'ຂາດການເຊື່ອມຕໍ່ server…'; };
    es.onopen = () => renderAuth();
  })();
})();

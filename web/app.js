// Connects the office to the server: sign-in status, projects, sessions, tasks, approvals, model choice and live updates.
(function () {
  const $ = id => document.getElementById(id);
  const S = { agents: [], models: [], efforts: [], tasks: [], approvals: [], projects: [], sessions: [], spend: { usd: 0, limit: 0 }, auth: {}, lead: 'somphone' };
  const STATUS_TEXT = { queued: 'ລໍຖ້າຄິວ', running: 'ກຳລັງເຮັດ', waiting: 'ລໍຖ້າເຈົ້າ', done: 'ສຳເລັດ', failed: 'ບໍ່ສຳເລັດ', stopped: 'ຢຸດແລ້ວ' };
  const EFFORT_TEXT = { low: 'ຕ່ຳ', medium: 'ປານກາງ', high: 'ສູງ', xhigh: 'ສູງຫຼາຍ', max: 'ສູງສຸດ' };
  const ACCESS_TEXT = { read: '🔒 ອ່ານໄດ້ຢ່າງດຽວ (ບໍ່ແກ້ໄຂໄຟລ໌)', write: '✏️ ອ່ານ ແລະ ແກ້ໄຂໄຟລ໌ໄດ້ · ລັນຄຳສັ່ງຕ້ອງຂໍອະນຸຍາດ' };
  const AUTH_TEXT = a => a.mode === 'login' ? `ເຊື່ອມກັບ Claude Code ແລ້ວ${a.plan ? ' · ' + a.plan : ''}` : a.mode === 'apiKey' ? 'ໃຊ້ API key ຈາກ .env' : a.mode === 'none' ? 'ຍັງບໍ່ໄດ້ login Claude Code' : 'ກຳລັງກວດ login…';
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

  // ---------- renderers ----------
  function renderAuth() {
    $('authBadge').dataset.mode = S.auth.mode || 'checking';
    $('authText').textContent = AUTH_TEXT(S.auth);
    $('authHelp').hidden = S.auth.mode !== 'none';
    $('authBadge').title = S.auth.email ? `Login: ${S.auth.email}` : '';
  }
  function renderSpend() {
    $('spend').textContent = '$' + S.spend.usd.toFixed(2);
    $('spendLimit').textContent = `/ $${S.spend.limit.toFixed(2)} ຕໍ່ມື້`;
    $('spendBar').style.width = Math.min(100, S.spend.usd / (S.spend.limit || 1) * 100) + '%';
  }
  function renderTasks() {
    const box = $('tasks');
    if (!S.tasks.length) { box.innerHTML = '<p class="empty">ຍັງບໍ່ມີວຽກ. ພິມວຽກໃນກ່ອງລຸ່ມສຸດ ແລ້ວກົດ "ສົ່ງວຽກ".</p>'; return; }
    box.innerHTML = S.tasks.slice(0, 30).map(t => {
      const a = agent(t.assignee), proj = t.cwd ? t.cwd.split('/').pop() : '';
      const who = t.mode === 'team' ? `👥 ທີມ (ນຳໂດຍ ${a?.name || t.assignee})` : `👤 ${a ? a.name + ' · ' + a.role : t.assignee}`;
      return `<button type="button" class="task" data-id="${t.id}"><div class="top"><b>${esc(t.title)}</b><span class="st ${t.status}">${STATUS_TEXT[t.status] || t.status}</span></div><small>${esc(who)} · 📁 ${esc(proj)}${t.costUsd ? ` · $${t.costUsd.toFixed(3)}` : ''}</small></button>`;
    }).join('');
  }
  function renderApprovals() {
    $('approvalBox').hidden = !S.approvals.length; $('apCount').textContent = S.approvals.length || '';
    $('approvals').innerHTML = S.approvals.map(ap => {
      const a = agent(ap.agent), t = S.tasks.find(x => x.id === ap.taskId);
      if (ap.kind === 'plan') {
        return `<div class="approval plan"><p><b>${esc(a?.name || ap.agent)}</b> ສົ່ງແຜນມາໃຫ້ອະນຸມັດ${t ? `<br><small>ວຽກ: ${esc(t.title)}</small>` : ''}</p><pre>${esc(ap.plan)}</pre><textarea rows="2" id="fb-${ap.id}" placeholder="ຖ້າຢາກໃຫ້ແກ້ແຜນ ຂຽນຄຳແນະນຳຢູ່ນີ້"></textarea><div class="btns"><button type="button" class="btn yes" data-ap="${ap.id}" data-allow="1">ອະນຸມັດແຜນ</button><button type="button" class="btn no" data-ap="${ap.id}" data-allow="0">ໃຫ້ແກ້ແຜນ</button></div></div>`;
      }
      const detail = ap.input?.command || ap.input?.file_path || JSON.stringify(ap.input || {}).slice(0, 300);
      return `<div class="approval"><p><b>${esc(a?.name || ap.agent)}</b> ຂໍ: ${esc(ap.summary)}${t ? `<br><small>ວຽກ: ${esc(t.title)}</small>` : ''}</p><code>${esc(detail)}</code><div class="btns"><button type="button" class="btn yes" data-ap="${ap.id}" data-allow="1">ອະນຸຍາດ</button><button type="button" class="btn no" data-ap="${ap.id}" data-allow="0">ບໍ່ອະນຸຍາດ</button></div></div>`;
    }).join('');
  }
  function renderAssignees() {
    const sel = $('tAssignee'), cur = sel.value;
    sel.innerHTML = S.agents.map(a => `<option value="${a.key}">${esc(a.name)} · ${esc(a.role)}</option>`).join('');
    if (cur) sel.value = cur;
    const lead = agent(S.lead);
    $('teamHint').textContent = lead ? `${lead.name} (${lead.role}) ວາງແຜນ${S.superpowers ? ' ດ້ວຍ Superpowers' : ''} ແລ້ວແຈກວຽກໃຫ້ທີມ` : '';
  }
  function renderMode() { const team = mode() === 'team'; $('tAssignee').hidden = team; $('teamHint').hidden = !team; }
  function renderProjects() {
    const sel = $('tProject'), cur = sel.value;
    sel.innerHTML = S.projects.map(p => `<option value="${esc(p.path)}">📁 ${esc(p.name)} — ${esc(p.path)}</option>`).join('');
    sel.value = S.projects.some(p => p.path === cur) ? cur : (S.projects[0]?.path || '');
  }
  function renderSessions() {
    const sel = $('tSession'), cur = sel.value;
    sel.innerHTML = '<option value="">✨ Session ໃໝ່</option>' + S.sessions.map(s => `<option value="${s.id}">↩︎ ${esc(s.title.slice(0, 60))} · ${new Date(s.updatedAt).toLocaleDateString()}</option>`).join('');
    sel.value = S.sessions.some(s => s.id === cur) ? cur : '';
  }
  async function loadSessions() {
    const dir = $('tProject').value; if (!dir) return;
    try { S.sessions = await api('/api/sessions?dir=' + encodeURIComponent(dir)); } catch { S.sessions = []; }
    renderSessions();
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
  $('dContinue').onclick = async () => {
    const t = S.tasks.find(x => x.id === openTaskId); if (!t) return;
    $('taskDlg').close();
    document.querySelector(`input[name="mode"][value="${t.mode === 'team' ? 'team' : 'single'}"]`).checked = true; renderMode();
    if (t.mode !== 'team') $('tAssignee').value = t.assignee;
    $('tProject').value = t.cwd; await loadSessions();
    if (![...$('tSession').options].some(o => o.value === t.sessionId)) $('tSession').insertAdjacentHTML('beforeend', `<option value="${t.sessionId}">↩︎ ${esc(t.title.slice(0, 60))}</option>`);
    $('tSession').value = t.sessionId; $('tTitle').focus(); say('ພິມສິ່ງທີ່ຢາກໃຫ້ເຮັດຕໍ່ ແລ້ວກົດ ສົ່ງວຽກ');
  };

  // ---------- actions ----------
  $('authRecheck').onclick = async () => { S.auth = { mode: 'checking' }; renderAuth(); try { S.auth = await api('/api/auth/recheck', { method: 'POST' }); } catch (err) { say(err.message); } renderAuth(); };
  document.querySelectorAll('input[name="mode"]').forEach(r => r.addEventListener('change', renderMode));
  $('tProject').onchange = loadSessions;
  $('pAdd').onclick = async () => {
    say('ເລືອກໂຟນເດີໃນໜ້າຕ່າງທີ່ເປີດຂຶ້ນມາ…');
    try { const p = await api('/api/projects/pick', { method: 'POST' }); if (p.cancelled) return say(''); S.projects = await api('/api/projects'); renderProjects(); $('tProject').value = p.path; say(`ເພີ່ມໂຟນເດີ ${p.name} ແລ້ວ`); loadSessions(); }
    catch (err) { say(err.message); }
  };
  $('pOpen').onclick = async () => { try { await api('/api/projects/open', { method: 'POST', body: { path: $('tProject').value, editor: 'antigravity' } }); say('ເປີດໂຟນເດີໃນ Antigravity ແລ້ວ'); } catch (err) { say('ເປີດບໍ່ໄດ້: ' + err.message); } };
  $('approvals').addEventListener('click', async e => {
    const b = e.target.closest('[data-ap]'); if (!b) return;
    b.disabled = true;
    const feedback = $('fb-' + b.dataset.ap)?.value || '';
    try { await api(`/api/approvals/${b.dataset.ap}`, { method: 'POST', body: { allow: b.dataset.allow === '1', feedback } }); }
    catch (err) { say(err.message); }
  });
  $('compose').addEventListener('submit', async e => {
    e.preventDefault();
    const title = $('tTitle').value.trim(); if (!title) return;
    const m = mode();
    $('tSend').disabled = true; say('ກຳລັງສົ່ງວຽກ…');
    try {
      const t = await api('/api/tasks', { method: 'POST', body: { title, detail: $('tDetail').value, mode: m, assignee: $('tAssignee').value, cwd: $('tProject').value, resume: $('tSession').value || null } });
      const a = agent(t.assignee);
      say(m === 'team' ? `ສົ່ງໃຫ້ທີມແລ້ວ: ${a?.name} ກຳລັງວາງແຜນ` : `ສົ່ງວຽກໃຫ້ ${a?.name} ແລ້ວ`);
      $('tTitle').value = ''; $('tDetail').value = ''; $('tSession').value = '';
      window.OFFICE.focus(t.assignee);
    } catch (err) { say('ສົ່ງບໍ່ສຳເລັດ: ' + err.message); }
    finally { $('tSend').disabled = false; }
  });
  async function saveAgent(patch) {
    try { const a = await api(`/api/agents/${selectedKey}`, { method: 'PATCH', body: patch }); Object.assign(agent(selectedKey), a); syncPerson(selectedKey); say(`ບັນທຶກແລ້ວ: ${a.name} ໃຊ້ ${a.model} (${EFFORT_TEXT[a.effort]})`); }
    catch (err) { say(err.message); renderCard(); }
  }
  $('cModel').onchange = () => saveAgent({ model: $('cModel').value });
  $('cEffort').onchange = () => saveAgent({ effort: $('cEffort').value });
  $('cAssign').onclick = () => { document.querySelector('input[name="mode"][value="single"]').checked = true; renderMode(); $('tAssignee').value = selectedKey; $('tTitle').focus(); };

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
    renderAuth(); renderAssignees(); renderMode(); renderProjects(); renderTasks(); renderApprovals(); renderSpend();
    loadSessions();

    const es = new EventSource('/api/events');
    es.onmessage = m => {
      const ev = JSON.parse(m.data);
      if (ev.type === 'agent') { const a = agent(ev.key); if (a) { Object.assign(a, { status: ev.status, activity: ev.activity, taskId: ev.taskId }); window.OFFICE.setLive(ev.key, a); if (ev.key === selectedKey) renderCard(); } }
      else if (ev.type === 'agentConfig') { const a = agent(ev.key); if (a) { a.model = ev.model; a.effort = ev.effort; syncPerson(ev.key); if (ev.key === selectedKey) renderCard(); } }
      else if (ev.type === 'task') { upsertTask(ev.task); if (ev.task.status === 'done' || ev.task.status === 'failed') loadSessions(); }
      else if (ev.type === 'log') { const t = S.tasks.find(x => x.id === ev.taskId); if (t) { t.log = [...(t.log || []), ev.entry].slice(-80); if (openTaskId === t.id) renderDialog(); } }
      else if (ev.type === 'approval') { S.approvals.push(ev.approval); renderApprovals(); window.OFFICE.focus(ev.approval.agent); }
      else if (ev.type === 'approvalDone') { S.approvals = S.approvals.filter(a => a.id !== ev.id); renderApprovals(); }
      else if (ev.type === 'spend') { S.spend.usd = ev.usd; S.spend.limit = ev.limit; renderSpend(); }
      else if (ev.type === 'auth') { S.auth = ev.auth; renderAuth(); }
      else if (ev.type === 'projects') { S.projects = ev.projects; renderProjects(); }
    };
    es.onerror = () => { $('authText').textContent = 'ຂາດການເຊື່ອມຕໍ່ server · ກຳລັງລອງໃໝ່…'; };
    es.onopen = () => renderAuth();
  })();
})();

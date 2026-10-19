// Connects the office to the server: tasks, approvals, model choice and live updates.
(function () {
  const $ = id => document.getElementById(id);
  const S = { agents: [], models: [], efforts: [], tasks: [], approvals: [], spend: { usd: 0, limit: 0 } };
  const STATUS_TEXT = { queued: 'ລໍຖ້າຄິວ', running: 'ກຳລັງເຮັດ', waiting: 'ລໍຖ້າອະນຸຍາດ', done: 'ສຳເລັດ', failed: 'ບໍ່ສຳເລັດ', stopped: 'ຢຸດແລ້ວ' };
  const EFFORT_TEXT = { low: 'ຕ່ຳ', medium: 'ປານກາງ', high: 'ສູງ', xhigh: 'ສູງຫຼາຍ', max: 'ສູງສຸດ' };
  const ACCESS_TEXT = { read: '🔒 ອ່ານໄດ້ຢ່າງດຽວ (ບໍ່ແກ້ໄຂໄຟລ໌)', write: '✏️ ອ່ານ ແລະ ແກ້ໄຂໄຟລ໌ໄດ້ · ລັນຄຳສັ່ງຕ້ອງຂໍອະນຸຍາດ' };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const agent = k => S.agents.find(a => a.key === k);
  const api = async (url, opts = {}) => {
    const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
    return data;
  };
  const waitOffice = () => new Promise(res => { const t = setInterval(() => { if (window.OFFICE) { clearInterval(t); res(); } }, 50); });

  // ---------- renderers ----------
  function renderSpend() {
    $('spend').textContent = '$' + S.spend.usd.toFixed(2);
    $('spendLimit').textContent = `/ $${S.spend.limit.toFixed(2)} ຕໍ່ມື້`;
    $('spendBar').style.width = Math.min(100, S.spend.usd / (S.spend.limit || 1) * 100) + '%';
  }
  function renderTasks() {
    const box = $('tasks');
    if (!S.tasks.length) { box.innerHTML = '<p class="empty">ຍັງບໍ່ມີວຽກ. ພິມວຽກໃນກ່ອງລຸ່ມສຸດ ແລ້ວກົດ "ສົ່ງວຽກ".</p>'; return; }
    box.innerHTML = S.tasks.slice(0, 30).map(t => {
      const a = agent(t.assignee);
      const cost = t.costUsd ? ` · $${t.costUsd.toFixed(3)}` : '';
      return `<button type="button" class="task" data-id="${t.id}"><div class="top"><b>${esc(t.title)}</b><span class="st ${t.status}">${STATUS_TEXT[t.status] || t.status}</span></div><small>${esc(a ? a.name + ' · ' + a.role : t.assignee)}${cost}</small></button>`;
    }).join('');
  }
  function renderApprovals() {
    $('approvalBox').hidden = !S.approvals.length; $('apCount').textContent = S.approvals.length || '';
    $('approvals').innerHTML = S.approvals.map(ap => {
      const a = agent(ap.agent), t = S.tasks.find(x => x.id === ap.taskId);
      const detail = ap.input?.command || ap.input?.file_path || JSON.stringify(ap.input || {}).slice(0, 300);
      return `<div class="approval"><p><b>${esc(a?.name || ap.agent)}</b> ຂໍ: ${esc(ap.summary)}${t ? `<br><small>ວຽກ: ${esc(t.title)}</small>` : ''}</p><code>${esc(detail)}</code><div class="btns"><button type="button" class="btn yes" data-ap="${ap.id}" data-allow="1">ອະນຸຍາດ</button><button type="button" class="btn no" data-ap="${ap.id}" data-allow="0">ບໍ່ອະນຸຍາດ</button></div></div>`;
    }).join('');
  }
  function renderAssignees() {
    const sel = $('tAssignee'), cur = sel.value || 'auto';
    sel.innerHTML = '<option value="auto">🤖 ໃຫ້ AI ເລືອກຄົນ</option>' + S.agents.map(a => `<option value="${a.key}">${esc(a.name)} · ${esc(a.role)}</option>`).join('');
    sel.value = cur;
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
    $('dMeta').textContent = `${a ? a.name + ' · ' + a.role : t.assignee} · ${STATUS_TEXT[t.status] || t.status}${t.model ? ' · ' + t.model : ''}${t.costUsd ? ' · $' + t.costUsd.toFixed(3) : ''}${t.turns ? ' · ' + t.turns + ' ຮອບ' : ''}`;
    $('dResult').textContent = t.result || t.error || (t.detail ? 'ລາຍລະອຽດ: ' + t.detail : 'ຍັງບໍ່ມີຜົນ');
    $('dLog').innerHTML = (t.log || []).map(l => `<li class="${l.kind}">${new Date(l.t).toLocaleTimeString()} · ${esc(l.text)}</li>`).join('') || '<li>ຍັງບໍ່ມີ</li>';
    $('dStop').hidden = !['queued', 'running', 'waiting'].includes(t.status);
  }
  $('tasks').addEventListener('click', e => { const b = e.target.closest('.task'); if (!b) return; openTaskId = b.dataset.id; renderDialog(); $('taskDlg').showModal(); });
  $('dStop').onclick = async () => { try { await api(`/api/tasks/${openTaskId}/stop`, { method: 'POST' }); } catch (err) { alert(err.message); } };

  // ---------- actions ----------
  $('approvals').addEventListener('click', async e => {
    const b = e.target.closest('[data-ap]'); if (!b) return;
    b.disabled = true;
    try { await api(`/api/approvals/${b.dataset.ap}`, { method: 'POST', body: { allow: b.dataset.allow === '1' } }); }
    catch (err) { $('formMsg').textContent = err.message; }
  });
  $('compose').addEventListener('submit', async e => {
    e.preventDefault();
    const title = $('tTitle').value.trim(); if (!title) return;
    const assignee = $('tAssignee').value;
    $('tSend').disabled = true; $('formMsg').textContent = assignee === 'auto' ? 'ກຳລັງໃຫ້ AI ເລືອກຄົນທີ່ເໝາະສົມ…' : 'ກຳລັງສົ່ງວຽກ…';
    try {
      const t = await api('/api/tasks', { method: 'POST', body: { title, detail: $('tDetail').value, assignee } });
      const a = agent(t.assignee);
      $('formMsg').textContent = `ສົ່ງວຽກໃຫ້ ${a?.name || t.assignee} ແລ້ວ`;
      $('tTitle').value = ''; $('tDetail').value = '';
      window.OFFICE.focus(t.assignee);
    } catch (err) { $('formMsg').textContent = 'ສົ່ງບໍ່ສຳເລັດ: ' + err.message; }
    finally { $('tSend').disabled = false; }
  });
  async function saveAgent(patch) {
    try { const a = await api(`/api/agents/${selectedKey}`, { method: 'PATCH', body: patch }); Object.assign(agent(selectedKey), a); syncPerson(selectedKey); $('formMsg').textContent = `ບັນທຶກແລ້ວ: ${a.name} ໃຊ້ ${a.model} (${EFFORT_TEXT[a.effort]})`; }
    catch (err) { $('formMsg').textContent = err.message; renderCard(); }
  }
  $('cModel').onchange = () => saveAgent({ model: $('cModel').value });
  $('cEffort').onchange = () => saveAgent({ effort: $('cEffort').value });
  $('cAssign').onclick = () => { $('tAssignee').value = selectedKey; $('tTitle').focus(); };

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
    try { st = await api('/api/state'); } catch (err) { $('wsLine').textContent = 'ເຊື່ອມຕໍ່ server ບໍ່ໄດ້: ' + err.message; return; }
    Object.assign(S, st);
    $('wsLine').textContent = 'Workspace: ' + st.workspace;
    $('keyWarn').hidden = st.hasKey;
    S.agents.forEach(a => syncPerson(a.key));
    renderAssignees(); renderTasks(); renderApprovals(); renderSpend();

    const es = new EventSource('/api/events');
    es.onmessage = m => {
      const ev = JSON.parse(m.data);
      if (ev.type === 'agent') { const a = agent(ev.key); if (a) { Object.assign(a, { status: ev.status, activity: ev.activity, taskId: ev.taskId }); window.OFFICE.setLive(ev.key, a); if (ev.key === selectedKey) renderCard(); } }
      else if (ev.type === 'agentConfig') { const a = agent(ev.key); if (a) { a.model = ev.model; a.effort = ev.effort; syncPerson(ev.key); if (ev.key === selectedKey) renderCard(); } }
      else if (ev.type === 'task') upsertTask(ev.task);
      else if (ev.type === 'log') { const t = S.tasks.find(x => x.id === ev.taskId); if (t) { t.log = [...(t.log || []), ev.entry].slice(-60); if (openTaskId === t.id) renderDialog(); } }
      else if (ev.type === 'approval') { S.approvals.push(ev.approval); renderApprovals(); window.OFFICE.focus(ev.approval.agent); }
      else if (ev.type === 'approvalDone') { S.approvals = S.approvals.filter(a => a.id !== ev.id); renderApprovals(); }
      else if (ev.type === 'spend') { S.spend.usd = ev.usd; S.spend.limit = ev.limit; renderSpend(); }
    };
    es.onerror = () => { $('wsLine').textContent = 'ຂາດການເຊື່ອມຕໍ່ server · ກຳລັງລອງໃໝ່…'; };
    es.onopen = () => { $('wsLine').textContent = 'Workspace: ' + S.workspace; };
  })();
})();

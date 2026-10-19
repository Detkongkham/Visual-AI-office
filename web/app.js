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
    if (name === 'history') renderHistory();
    if (name && C.open && window.innerWidth <= 900) closeChat();
    if (window.innerWidth <= 900) document.body.classList.remove('menuOpen');
  }
  document.querySelectorAll('.nav[data-panel]').forEach(b => b.addEventListener('click', () => openPanel(panel === b.dataset.panel ? null : b.dataset.panel)));
  $('drawerClose').onclick = () => openPanel(null);
  document.addEventListener('keydown', e => { if (e.key !== 'Escape') return; if (panel) openPanel(null); else if (C.open) closeChat(); });
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
    const hp = $('hProject').value; $('hProject').innerHTML = $('tProject').innerHTML; $('hProject').value = S.projects.some(p => p.path === hp) ? hp : S.project;
    $('projectList').innerHTML = S.projects.map(p => `<button type="button" class="proj" data-path="${esc(p.path)}" ${p.path === S.project ? 'aria-current="true"' : ''}><b>📁 ${esc(p.name)}</b><small>${esc(p.path)}</small></button>`).join('');
  }
  function renderSessions() {
    const sel = $('tSession'), cur = sel.value;
    sel.innerHTML = '<option value="">✨ Session ໃໝ່</option>' + S.sessions.map(s => `<option value="${s.id}">↩︎ ${esc(s.title.slice(0, 50))}</option>`).join('');
    sel.value = S.sessions.some(s => s.id === cur) ? cur : '';
    $('sessionList').innerHTML = S.sessions.length ? S.sessions.map(s => `<div class="sess"><b>${esc(s.title)}</b><small>${new Date(s.updatedAt).toLocaleString()}${s.branch ? ' · 🌿 ' + esc(s.branch) : ''}</small><div class="btnRow"><button type="button" class="iconBtn" data-chat="${s.id}">💬 ເປີດ</button><button type="button" class="iconBtn" data-resume="${s.id}" data-mode="team">↩︎ ສືບຕໍ່ (ທີມ)</button><button type="button" class="iconBtn" data-resume="${s.id}" data-mode="single">↩︎ ສືບຕໍ່ (ຄົນດຽວ)</button></div></div>`).join('') : '<p class="empty">ໂຟນເດີນີ້ຍັງບໍ່ມີ session ຂອງ Claude Code.</p>';
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

  // ---------- chat history view ----------
  // tiny, safe markdown: escape first, then format
  function md(src) {
    const blocks = [];
    let s = esc(src).replace(/```([\w-]*)\n([\s\S]*?)```/g, (m, lang, code) => { blocks.push(`<pre><code>${code}</code></pre>`); return `\u0000${blocks.length - 1}\u0000`; });
    const inline = t => t.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>').replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    const out = []; let list = null, table = null;
    const flush = () => { if (list) { out.push(`<${list.t}>${list.items.map(i => `<li>${inline(i)}</li>`).join('')}</${list.t}>`); list = null; } if (table) { out.push(`<table>${table.map((r, i) => `<tr>${r.map(c => i ? `<td>${inline(c)}</td>` : `<th>${inline(c)}</th>`).join('')}</tr>`).join('')}</table>`); table = null; } };
    for (const line of s.split('\n')) {
      let m;
      if ((m = line.match(/^\u0000(\d+)\u0000$/))) { flush(); out.push(blocks[+m[1]]); }
      else if ((m = line.match(/^(#{1,4})\s+(.*)/))) { flush(); out.push(`<h${m[1].length + 1}>${inline(m[2])}</h${m[1].length + 1}>`); }
      else if ((m = line.match(/^\s*[-*]\s+(.*)/))) { if (!list || list.t !== 'ul') { flush(); list = { t: 'ul', items: [] }; } list.items.push(m[1]); }
      else if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) { if (!list || list.t !== 'ol') { flush(); list = { t: 'ol', items: [] }; } list.items.push(m[1]); }
      else if (/^\s*\|.*\|\s*$/.test(line)) { if (/^\s*\|[\s:|-]+\|\s*$/.test(line)) continue; if (!table) { flush(); table = []; } table.push(line.trim().slice(1, -1).split('|').map(c => c.trim())); }
      else if (!line.trim()) flush();
      else { flush(); out.push(`<p>${inline(line)}</p>`); }
    }
    flush();
    return out.join('').replace(/\u0000(\d+)\u0000/g, (m, i) => blocks[+i]);
  }
  const C = { open: false, title: '', dir: '', sessionId: null, taskIds: new Set(), msgs: [], taskMode: 'team', assignee: null };
  const whoName = k => k === 'you' ? 'ເຈົ້າ' : k === 'claude' ? 'Claude' : (agent(k)?.name || k);
  const whoRole = k => k === 'claude' ? 'Claude Code' : (agent(k)?.role || '');
  function avaHtml(k) {
    if (agent(k)) return `<div class="ava" data-ava="${k}"></div>`;
    return `<div class="ava" style="display:grid;place-items:center;font-size:16px;background:var(--accent-soft)">${k === 'claude' ? '✳︎' : '🙂'}</div>`;
  }
  function renderChat() {
    if (!C.open) return;
    const results = new Map(C.msgs.filter(m => m.type === 'toolResult').map(m => [m.id, m]));
    const parts = []; let lastWho = null;
    const head = k => { const same = lastWho === k; lastWho = k; return same ? '' : `<div class="who">${esc(whoName(k))}<small>${esc(whoRole(k))}</small></div>`; };
    for (const m of C.msgs) {
      if (m.type === 'user') { lastWho = 'you'; parts.push(`<div class="bubbleUser">${esc(m.text)}</div>`); }
      else if (m.type === 'text') parts.push(`<div class="msg">${lastWho === m.who ? '<span></span>' : avaHtml(m.who)}<div class="body">${head(m.who)}<div class="md">${md(m.text)}</div></div></div>`);
      else if (m.type === 'tool') {
        const r = results.get(m.id);
        const state = r ? (r.isError ? '<span class="bad">ຜິດພາດ</span>' : '<span class="ok">ແລ້ວ</span>') : '<span class="run">ກຳລັງເຮັດ…</span>';
        const input = m.input ? (m.input.command || m.input.file_path || m.input.pattern || m.input.description || JSON.stringify(m.input, null, 2)) : '';
        const detail = [input && `▶ ${input}`, m.input?.prompt && `\n${m.input.prompt}`, r?.output && `\n◀ ${r.output}`].filter(Boolean).join('\n');
        parts.push(`<div class="msg">${lastWho === m.who ? '<span></span>' : avaHtml(m.who)}<div class="body">${head(m.who)}<details class="tool"><summary><b>${esc(m.tool)}</b> ${esc(m.summary || '')}${state}</summary>${detail ? `<pre>${esc(detail)}</pre>` : ''}</details></div></div>`);
      }
      else if (m.type === 'delegate') { lastWho = null; parts.push(`<div class="event del">👥 ${esc(whoName(m.who))} → ${esc(whoName(m.to))}: ${esc(m.text.replace(/^ຮັບວຽກຈາກ [^:]+:\s*/, ''))}</div>`); }
      else if (m.type === 'plan') { lastWho = null; parts.push(`<div class="cardPlan"><h4>📋 ແຜນງານຈາກ ${esc(whoName(m.who))}</h4><div class="md">${md(m.text)}</div></div>`); }
      else if (m.type === 'approval') { lastWho = null; parts.push(`<div class="event">✋ ${esc(whoName(m.who))} ຂໍອະນຸຍາດ: ${esc(m.summary)}</div>`); }
      else if (m.type === 'decision') { lastWho = null; parts.push(`<div class="event ${m.allow ? 'yes' : 'no'}">${m.allow ? '✅ ເຈົ້າອະນຸມັດ' : '⛔ ເຈົ້າບໍ່ອະນຸມັດ'}${m.kind === 'plan' ? 'ແຜນ' : ''}${m.text ? ': ' + esc(m.text) : ''}</div>`); }
      else if (m.type === 'result') { lastWho = null; parts.push(`<div class="cardResult"><h4>✓ ສຳເລັດ</h4><div class="md">${md(m.text || '')}</div><small>${m.turns || 0} ຮອບ${m.cost ? ` · ປະມານ $${m.cost.toFixed(3)}` : ''}</small></div>`); }
      else if (m.type === 'error') { lastWho = null; parts.push(`<div class="cardError">⚠️ ${esc(m.text)}</div>`); }
    }
    const running = [...C.taskIds].map(id => S.tasks.find(t => t.id === id)).find(t => t && ['queued', 'running', 'waiting'].includes(t.status));
    if (running) parts.push(`<div class="typing"><i></i><i></i><i></i>${running.status === 'waiting' ? 'ລໍຖ້າເຈົ້າຢູ່ແຜງ "ລໍຖ້າເຈົ້າ"' : 'ກຳລັງເຮັດວຽກ…'}</div>`);
    if (!parts.length) parts.push('<p class="empty" style="text-align:center">ການສົນທະນານີ້ຍັງບໍ່ມີຂໍ້ຄວາມ.</p>');
    const sc = $('chatScroll'), atBottom = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 80;
    $('chatList').innerHTML = parts.join('');
    $('chatList').querySelectorAll('[data-ava]').forEach(el => window.OFFICE.avatar(el, el.dataset.ava, 32));
    if (atBottom || C.justOpened) sc.scrollTop = sc.scrollHeight; C.justOpened = false;
    $('chatStop').hidden = !running; C.running = running;
    $('chatSend').disabled = !!running || !C.sessionId;
    $('chatNote').textContent = running ? 'ລໍຖ້າວຽກນີ້ແລ້ວກ່ອນ ຈຶ່ງສົ່ງຂໍ້ຄວາມຕໍ່ໄດ້' : C.sessionId ? `ຂໍ້ຄວາມຈະສົ່ງເຖິງ ${C.taskMode === 'team' ? 'ທີມ (ນຳໂດຍ ' + whoName(S.lead) + ')' : whoName(C.assignee)} ໃນ session ດຽວກັນ` : '';
  }
  async function openChat({ title, dir, sessionId, task }) {
    Object.assign(C, { open: true, title, dir, sessionId: sessionId || null, taskIds: new Set(), msgs: [], justOpened: true,
      // sessions started outside the office continue in team mode, led by the tech lead
      taskMode: task ? (task.mode === 'team' ? 'team' : 'single') : 'team', assignee: task ? task.assignee : S.lead });
    if (C.sessionId) S.tasks.filter(t => t.sessionId === C.sessionId || t.resume === C.sessionId).forEach(t => C.taskIds.add(t.id));
    if (task) C.taskIds.add(task.id);
    $('chatTitle').textContent = title; $('chatMeta').textContent = [dir, sessionId ? 'session ' + sessionId.slice(0, 8) : ''].filter(Boolean).join(' · ');
    $('chat').hidden = false; openPanel(null); renderChat();
    try { C.msgs = C.sessionId ? await api(`/api/sessions/${C.sessionId}/messages?dir=${encodeURIComponent(dir)}`) : await api(`/api/tasks/${task.id}/messages`); }
    catch (err) { C.msgs = [{ type: 'error', text: 'ໂຫຼດປະຫວັດບໍ່ໄດ້: ' + err.message }]; }
    C.justOpened = true; renderChat(); $('chatInput').focus();
  }
  const openTaskChat = t => openChat({ title: t.title, dir: t.cwd, sessionId: t.sessionId || t.resume, task: t });
  function closeChat() { C.open = false; $('chat').hidden = true; }
  $('chatBack').onclick = closeChat;
  $('chatOpen').onclick = async () => { try { await api('/api/projects/open', { method: 'POST', body: { path: C.dir, editor: 'antigravity' } }); } catch (err) { $('chatNote').textContent = err.message; } };
  $('chatStop').onclick = async () => { if (C.running) try { await api(`/api/tasks/${C.running.id}/stop`, { method: 'POST' }); } catch (err) { $('chatNote').textContent = err.message; } };
  $('chatInput').addEventListener('input', e => { e.target.style.height = 'auto'; e.target.style.height = Math.min(200, e.target.scrollHeight) + 'px'; });
  $('chatInput').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('chatForm').requestSubmit(); } });
  $('chatForm').addEventListener('submit', async e => {
    e.preventDefault();
    const text = $('chatInput').value.trim(); if (!text || !C.sessionId || C.running) return;
    $('chatSend').disabled = true;
    try {
      const t = await api('/api/tasks', { method: 'POST', body: { title: text.split('\n')[0].slice(0, 200), detail: text.includes('\n') ? text : '', mode: C.taskMode, assignee: C.assignee, cwd: C.dir, resume: C.sessionId } });
      C.taskIds.add(t.id); upsertTask(t); $('chatInput').value = ''; $('chatInput').style.height = 'auto';
      window.OFFICE.focus(t.assignee);
    } catch (err) { $('chatNote').textContent = 'ສົ່ງບໍ່ສຳເລັດ: ' + err.message; }
    renderChat();
  });
  $('tasks').addEventListener('click', e => { const b = e.target.closest('.task'); if (!b) return; const t = S.tasks.find(x => x.id === b.dataset.id); if (t) openTaskChat(t); });

  // history list: conversations of a project (office tasks + Claude Code sessions from Antigravity)
  async function renderHistory() {
    const dir = $('hProject').value || S.project; if (!dir) return;
    $('historyList').innerHTML = '<p class="empty">ກຳລັງໂຫຼດ…</p>';
    let sessions = [];
    try { sessions = await api('/api/sessions?dir=' + encodeURIComponent(dir)); } catch { /* none */ }
    const bySession = new Map();
    for (const t of S.tasks.filter(t => t.cwd === dir)) { const k = t.sessionId || t.resume || 'task:' + t.id; if (!bySession.has(k)) bySession.set(k, t); }
    const items = sessions.map(s => ({ id: s.id, title: bySession.get(s.id)?.title || s.title, when: s.updatedAt, office: bySession.has(s.id), task: bySession.get(s.id) }));
    for (const [k, t] of bySession) if (k.startsWith('task:')) items.push({ id: null, title: t.title, when: t.createdAt, office: true, task: t });
    items.sort((a, b) => b.when - a.when);
    $('historyList').innerHTML = items.length ? items.map((it, i) => `<button type="button" class="histItem" data-i="${i}"><b>${esc(it.title)}</b><small>${new Date(it.when).toLocaleString()} · ${it.office ? (it.task?.mode === 'team' ? '👥 ທີມ' : '👤 ' + esc(whoName(it.task?.assignee))) : '✳︎ Claude Code (Antigravity / CLI)'}</small></button>`).join('') : '<p class="empty">ໂຟນເດີນີ້ຍັງບໍ່ມີການສົນທະນາ.</p>';
    $('historyList').onclick = e => { const b = e.target.closest('.histItem'); if (!b) return; const it = items[+b.dataset.i]; openChat({ title: it.title, dir, sessionId: it.id, task: it.task }); };
  }
  $('hProject').onchange = renderHistory;

  // ---------- actions ----------
  $('authRecheck').onclick = async () => { S.auth = { mode: 'checking' }; renderAuth(); try { S.auth = await api('/api/auth/recheck', { method: 'POST' }); } catch (err) { say(err.message); } renderAuth(); };
  document.querySelectorAll('input[name="mode"]').forEach(r => r.addEventListener('change', renderMode));
  $('tProject').onchange = () => setProject($('tProject').value);
  $('projectList').addEventListener('click', e => { const b = e.target.closest('.proj'); if (b) setProject(b.dataset.path); });
  $('sessionList').addEventListener('click', e => { const b = e.target.closest('[data-resume]'); if (b) prefillResume(b.dataset.resume, b.dataset.mode); const h = e.target.closest('[data-chat]'); if (h) { const ss = S.sessions.find(x => x.id === h.dataset.chat); openChat({ title: ss?.title || 'session', dir: S.project, sessionId: h.dataset.chat, task: S.tasks.find(t => t.sessionId === h.dataset.chat) }); } });
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
      upsertTask(t); if (t.resume) openTaskChat(t);
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
  function upsertTask(t) {
    const i = S.tasks.findIndex(x => x.id === t.id); if (i >= 0) S.tasks[i] = t; else S.tasks.unshift(t); renderTasks();
    if (C.open && !C.sessionId && C.taskIds.has(t.id) && t.sessionId) C.sessionId = t.sessionId;
    if (C.open && C.taskIds.has(t.id)) renderChat();
  }

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
      else if (ev.type === 'log') { const t = S.tasks.find(x => x.id === ev.taskId); if (t) t.log = [...(t.log || []), ev.entry].slice(-80); }
      else if (ev.type === 'msg') { if (C.open && C.taskIds.has(ev.taskId)) { C.msgs.push(ev.msg); renderChat(); } }
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

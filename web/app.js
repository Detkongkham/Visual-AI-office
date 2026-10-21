// Connects the office to the server: sidebar + drawer, sign-in status, projects, sessions, tasks, approvals, model choice and live updates.
(function () {
  const $ = id => document.getElementById(id);
  const S = { agents: [], models: [], efforts: [], tasks: [], approvals: [], projects: [], sessions: [], usage: null, auth: {}, lead: 'somphone', project: '' };
  const STATUS_TEXT = { queued: 'ລໍຖ້າຄິວ', running: 'ກຳລັງເຮັດ', waiting: 'ລໍຖ້າເຈົ້າ', done: 'ສຳເລັດ', failed: 'ບໍ່ສຳເລັດ', stopped: 'ຢຸດແລ້ວ' };
  const EFFORT_TEXT = { low: 'ຕ່ຳ', medium: 'ປານກາງ', high: 'ສູງ', xhigh: 'ສູງຫຼາຍ', max: 'ສູງສຸດ' };
  const ACCESS_TEXT = { read: '🔒 ອ່ານໄດ້ຢ່າງດຽວ (ບໍ່ແກ້ໄຂໄຟລ໌)', write: '✏️ ອ່ານ ແລະ ແກ້ໄຂໄຟລ໌ໄດ້ · ລັນຄຳສັ່ງຕ້ອງຂໍອະນຸຍາດ' };
  const PANEL_TITLE = { compose: 'ສັ່ງວຽກໃໝ່', approvals: 'ລໍຖ້າເຈົ້າ', tasks: 'ວຽກທັງໝົດ', projects: 'ໂປຣເຈັກ ແລະ session', rooms: 'ຫ້ອງ', staff: 'ພະນັກງານ', settings: 'ການຕັ້ງຄ່າ' };
  const AUTH_TEXT = a => a.mode === 'login' ? `Claude Code${a.plan ? ' · ' + a.plan : ''}` : a.mode === 'apiKey' ? 'API key (.env)' : a.mode === 'none' ? 'ຍັງບໍ່ໄດ້ login' : 'ກຳລັງກວດ login…';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const agent = k => S.agents.find(a => a.key === k);
  // anyone who ever worked here, archived people included (names and pictures in old chats)
  const person = k => agent(k) || (S.archived || []).find(a => a.key === k);
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
  const LIVE = ['queued', 'running', 'waiting'];
  // the default for new tasks lives in the office settings (shared by every tab)
  const setAuto = on => saveSetting('autoApproveDefault', on);
  // auto-approve switch: the human's intent is task.autoApprove; in team mode it only takes effect after the plan is approved
  const autoSwitch = t => {
    const on = !!t.autoApprove, pending = on && t.mode === 'team' && !t.planApproved;
    return `<button type="button" class="autoSw" role="switch" aria-checked="${on}" data-autotoggle="${esc(t.id)}"${pending ? ' data-pending="1" title="ຈະເລີ່ມອະນຸຍາດອັດຕະໂນມັດຫຼັງເຈົ້າອະນຸມັດແຜນ" aria-label="⚡ ອະນຸຍາດອັດຕະໂນມັດ: ຈະເລີ່ມຫຼັງເຈົ້າອະນຸມັດແຜນ"' : ''}><span class="knob" aria-hidden="true"></span><span>⚡ ອະນຸຍາດອັດຕະໂນມັດ</span><span class="state">${pending ? 'ລໍຖ້າອະນຸມັດແຜນ' : on ? 'ເປີດ' : 'ປິດ'}</span></button>`;
  };

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
    if (name === 'staff') window.STAFF?.render();
    if (name && C.open && window.innerWidth <= 900) closeChat();
    if (window.innerWidth <= 900) document.body.classList.remove('menuOpen');
  }
  document.querySelectorAll('.nav[data-panel]').forEach(b => b.addEventListener('click', () => openPanel(panel === b.dataset.panel ? null : b.dataset.panel)));
  $('drawerClose').onclick = () => openPanel(null);
  document.addEventListener('keydown', e => { if (e.key !== 'Escape') return; if (panel) openPanel(null); else if (C.open) closeChat(); });
  $('menuBtn').onclick = () => { const on = document.body.classList.toggle('menuOpen'); $('menuBtn').setAttribute('aria-expanded', String(on)); };
  $('team').addEventListener('click', () => { if (window.innerWidth <= 900) document.body.classList.remove('rOpen'); });
  $('rToggle').onclick = () => { const on = document.body.classList.toggle('rOpen'); $('rToggle').setAttribute('aria-expanded', String(on)); };
  const THEME_LABEL = { system: 'ອັດຕະໂນມັດ', light: 'ສະຫວ່າງ', dark: 'ມືດ' };
  const THEME_ICON = { system: 'i-monitor', light: 'i-sun', dark: 'i-moon' };
  function renderTheme() {
    const p = THEME.current(), label = THEME_LABEL[p];
    $('themeText').textContent = label; $('bTheme').title = `ໂໝດສີ: ${label} (ກົດເພື່ອປ່ຽນ)`;
    $('bTheme').querySelector('use').setAttribute('href', '#' + THEME_ICON[p]);
  }
  $('bTheme').onclick = () => { THEME.setPref(THEME.next(THEME.current())); renderTheme(); renderSettings(); };
  renderTheme();
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
  const limitCard = (title, w, critAt = 90, warnAt = 70) => {
    if (!w) return '';
    const sev = w.pct >= critAt ? 'crit' : w.pct >= warnAt ? 'warn' : 'ok';
    return `<div class="limit" data-sev="${sev}"><div class="lt"><b>${title}</b><span class="pct">${w.pct}%</span></div><div class="bar"><i style="width:${Math.min(100, w.pct)}%"></i></div><small>${untilText(w.resetsAt)}</small></div>`;
  };
  function renderUsage() {
    const u = S.usage, box = $('usageBox');
    if (S.auth.mode === 'apiKey') { box.innerHTML = '<p class="empty">ໃຊ້ API key ຢູ່: ບໍ່ມີຂີດຈຳກັດ 5 ຊົ່ວໂມງ ຫຼື ລາຍອາທິດ (ຄິດເງິນຕາມການໃຊ້).</p>'; $('usageNote').textContent = ''; return; }
    if (!u) { box.innerHTML = `<p class="empty">${S.auth.mode === 'none' ? 'ຕ້ອງ login Claude Code ກ່ອນ.' : 'ກຳລັງໂຫຼດ…'}</p>`; $('usageNote').textContent = ''; return; }
    if (!u.available) { box.innerHTML = '<p class="empty">ບັນຊີນີ້ບໍ່ມີຂໍ້ມູນຂີດຈຳກັດ.</p>'; return; }
    const st = eff(), stop = st.fiveHourStopPct ?? 90, wk = st.weeklyWarnPct ?? 80;
    box.innerHTML = limitCard('ຮອບ 5 ຊົ່ວໂມງ', u.fiveHour, stop, stop - 20) + limitCard('ລາຍອາທິດ (ທຸກໂມເດວ)', u.weekly, 95, wk) + limitCard('ລາຍອາທິດ · Opus', u.weeklyOpus, 95, wk) + limitCard('ລາຍອາທິດ · Sonnet', u.weeklySonnet, 95, wk)
      + (u.fiveHour?.pct >= stop ? `<p class="empty warnText">⛔ ຮອບ 5 ຊົ່ວໂມງຮອດ ${stop}% ແລ້ວ: ຈະບໍ່ຮັບວຽກໃໝ່ (ປັບໄດ້ໃນ ການຕັ້ງຄ່າ)</p>` : '');
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
      return `<button type="button" class="task" data-id="${t.id}"><div class="top"><b>${esc(t.title)}${t.autoApprove ? '<span class="autoMark" title="ອະນຸຍາດອັດຕະໂນມັດ">⚡</span>' : ''}</b><span class="st ${t.status}">${STATUS_TEXT[t.status] || t.status}</span></div><small>${esc(who)} · 📁 ${esc(proj)}${t.costUsd ? ` · $${t.costUsd.toFixed(3)}` : ''}</small></button>`;
    }).join('');
    renderAutoBar();
    renderCounts();
  }
  function renderAutoBar() {
    const live = S.tasks.filter(t => LIVE.includes(t.status)).slice(0, 20);
    $('autoBar').innerHTML = live.length
      ? live.map(t => `<div class="autoRow"><small>${esc(t.title)}</small>${autoSwitch(t)}</div>`).join('')
      : '<p class="empty">ຍັງບໍ່ມີວຽກກຳລັງເຮັດ. ຕິກ ⚡ ຕອນສັ່ງວຽກ ເພື່ອເປີດລ່ວງໜ້າ</p>';
  }
  function renderApprovals() {
    $('apEmpty').hidden = !!S.approvals.length;
    $('approvals').innerHTML = S.approvals.map(ap => {
      const a = agent(ap.agent), t = S.tasks.find(x => x.id === ap.taskId);
      if (ap.kind === 'plan') {
        return `<div class="approval plan"><p class="apWait" data-since="${ap.createdAt || Date.now()}"></p><p><b>${esc(a?.name || ap.agent)}</b> ສົ່ງແຜນມາໃຫ້ອະນຸມັດ${t ? `<br><small>ວຽກ: ${esc(t.title)}</small>` : ''}</p><pre>${esc(ap.plan)}</pre><textarea rows="2" id="fb-${ap.id}" placeholder="ຖ້າຢາກໃຫ້ແກ້ແຜນ ຂຽນຄຳແນະນຳຢູ່ນີ້"></textarea><div class="btns"><button type="button" class="btn yes" data-ap="${ap.id}" data-allow="1">ອະນຸມັດແຜນ</button><button type="button" class="btn no" data-ap="${ap.id}" data-allow="0">ໃຫ້ແກ້ແຜນ</button></div></div>`;
      }
      const detail = ap.input?.command || ap.input?.file_path || JSON.stringify(ap.input || {}).slice(0, 300);
      return `<div class="approval"><p class="apWait" data-since="${ap.createdAt || Date.now()}"></p><p><b>${esc(a?.name || ap.agent)}</b> ຂໍ: ${esc(ap.summary)}${t ? `<br><small>ວຽກ: ${esc(t.title)}</small>` : ''}</p><code>${esc(detail)}</code><div class="btns"><button type="button" class="btn yes" data-ap="${ap.id}" data-allow="1">ອະນຸຍາດ</button><button type="button" class="btn no" data-ap="${ap.id}" data-allow="0">ບໍ່ອະນຸຍາດ</button><button type="button" class="btn auto" data-auto="${esc(ap.taskId)}" title="ອະນຸຍາດຄຳຂໍນີ້ ແລະ ທຸກຄຳຂໍຕໍ່ໄປໃນວຽກນີ້ ຈົນກວ່າວຽກຈະຈົບ">ອະນຸຍາດທັງໝົດໃນວຽກນີ້</button></div></div>`;
    }).join('');
    renderCounts();
    tickApprovalWaits();
  }
  // the agent's prompt cache expires after ~5 minutes of waiting; after that, continuing re-loads its whole context
  function tickApprovalWaits() {
    for (const el of document.querySelectorAll('.apWait')) {
      const min = Math.floor((Date.now() - Number(el.dataset.since)) / 60000), late = eff().approvalWarnMin ?? 4;
      el.classList.toggle('late', min >= late);
      el.textContent = min < 1 ? 'ຫາກໍ່ສົ່ງມາ' : min >= late ? `⏱ ລໍຖ້າ ${min} ນາທີແລ້ວ: ເກີນ 5 ນາທີ cache ຈະໝົດ ແລະ ຕ້ອງເສຍ token ໂຫຼດ context ໃໝ່` : `⏱ ລໍຖ້າ ${min} ນາທີ`;
    }
  }
  setInterval(tickApprovalWaits, 15_000);
  function renderAssignees() {
    const sel = $('tAssignee'), cur = sel.value;
    const off = eff().disabledAgents || [];
    sel.innerHTML = S.agents.filter(a => !off.includes(a.key)).map(a => `<option value="${a.key}">${esc(a.name)} · ${esc(a.role)}</option>`).join('');
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
    const cur = S.projects.find(p => p.path === S.project), w = $('tProjectWarn');
    w.hidden = !cur?.warn;
    if (cur?.warn) w.innerHTML = `⚠️ ${esc(cur.warn)}<br>${(cur.inner || []).map(d => `<button type="button" class="iconBtn" data-use-dir="${esc(d)}">📁 ໃຊ້ ${esc(d.split('/').pop())}</button>`).join(' ')}`;
    const hp = $('hProject').value; $('hProject').innerHTML = $('tProject').innerHTML; $('hProject').value = S.projects.some(p => p.path === hp) ? hp : S.project;
    $('projectList').innerHTML = S.projects.map(p => `<button type="button" class="proj" data-path="${esc(p.path)}" ${p.path === S.project ? 'aria-current="true"' : ''}><b>📁 ${esc(p.name)}</b><small>${esc(p.path)}</small></button>`).join('');
  }
  // resuming a big session reloads its whole context; past the limit the server starts fresh with a summary
  const kTok = n => `~${Math.round((n || 0) / 1000)}k token`;
  const tooBig = s => s && s.tokens > (S.resumeMaxTokens || 50000);
  function renderSessionHint() {
    const s = S.sessions.find(x => x.id === $('tSession').value);
    $('tSessionHint').hidden = !tooBig(s);
    if (tooBig(s)) $('tSessionHint').textContent = `session ນີ້ໃຫຍ່ (${kTok(s.tokens)}). ເພື່ອປະຢັດ token ຈະເລີ່ມ session ໃໝ່ ໂດຍເອົາໄປແຕ່ສະຫຼຸບ (ເປົ້າໝາຍ, ແຜນລ່າສຸດ, ຄຳຕອບລ່າສຸດ)`;
  }
  function renderSessions() {
    const sel = $('tSession'), cur = sel.value;
    sel.innerHTML = '<option value="">✨ Session ໃໝ່</option>' + S.sessions.map(s => `<option value="${s.id}">↩︎ ${esc(s.title.slice(0, 50))}${s.tokens ? ` · ${kTok(s.tokens)}${tooBig(s) ? ' ⚠️' : ''}` : ''}</option>`).join('');
    sel.value = S.sessions.some(s => s.id === cur) ? cur : ''; renderSessionHint();
    $('sessionList').innerHTML = S.sessions.length ? S.sessions.map(s => `<div class="sess"><b>${esc(s.title)}</b><small>${new Date(s.updatedAt).toLocaleString()}${s.branch ? ' · 🌿 ' + esc(s.branch) : ''}${s.tokens ? ' · ' + kTok(s.tokens) + (tooBig(s) ? ' (ຈະເລີ່ມໃໝ່ພ້ອມສະຫຼຸບ)' : '') : ''}</small><div class="btnRow"><button type="button" class="iconBtn" data-chat="${s.id}">💬 ເປີດ</button><button type="button" class="iconBtn" data-resume="${s.id}" data-mode="team">↩︎ ສືບຕໍ່ (ທີມ)</button><button type="button" class="iconBtn" data-resume="${s.id}" data-mode="single">↩︎ ສືບຕໍ່ (ຄົນດຽວ)</button></div></div>`).join('') : '<p class="empty">ໂຟນເດີນີ້ຍັງບໍ່ມີ session ຂອງ Claude Code.</p>';
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
  const whoName = k => k === 'you' ? 'ເຈົ້າ' : k === 'claude' ? 'Claude' : (person(k)?.name || k);
  const whoRole = k => k === 'claude' ? 'Claude Code' : (person(k)?.role || '');
  function avaHtml(k) {
    if (person(k)) return `<div class="ava" data-ava="${k}"></div>`;
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
      else if (m.type === 'approval') { lastWho = null; parts.push(m.auto ? `<div class="event auto">⚡ ${esc(whoName(m.who))} ອະນຸຍາດອັດຕະໂນມັດ: ${esc(m.summary)}</div>` : `<div class="event">✋ ${esc(whoName(m.who))} ຂໍອະນຸຍາດ: ${esc(m.summary)}</div>`); }
      else if (m.type === 'decision' && m.auto) { lastWho = null; parts.push(`<div class="event auto">⚡ ອະນຸຍາດອັດຕະໂນມັດ${m.text && m.text !== 'ອະນຸຍາດອັດຕະໂນມັດ' ? ': ' + esc(m.text) : ''}</div>`); }
      else if (m.type === 'decision') { lastWho = null; parts.push(`<div class="event ${m.allow ? 'yes' : 'no'}">${m.allow ? '✅ ເຈົ້າອະນຸມັດ' : '⛔ ເຈົ້າບໍ່ອະນຸມັດ'}${m.kind === 'plan' ? 'ແຜນ' : ''}${m.text ? ': ' + esc(m.text) : ''}</div>`); }
      else if (m.type === 'result') { lastWho = null; parts.push(`<div class="cardResult"><h4>✓ ສຳເລັດ</h4><div class="md">${md(m.text || '')}</div><small>${m.turns || 0} ຮອບ${m.cost ? ` · ປະມານ $${m.cost.toFixed(3)}` : ''}</small></div>`); }
      else if (m.type === 'error') { lastWho = null; parts.push(`<div class="cardError">⚠️ ${esc(m.text)}</div>`); }
    }
    const running = [...C.taskIds].map(id => S.tasks.find(t => t.id === id)).find(t => t && ['queued', 'running', 'waiting'].includes(t.status));
    if (running) parts.push(`<div class="typing"><i></i><i></i><i></i>${running.status === 'waiting' ? 'ລໍຖ້າເຈົ້າຢູ່ແຜງ "ລໍຖ້າເຈົ້າ"' : 'ກຳລັງເຮັດວຽກ…'}</div>`);
    if (running) parts.push(`<div class="chatAuto">${autoSwitch(running)}</div>`);
    if (!parts.length) parts.push('<p class="empty" style="text-align:center">ການສົນທະນານີ້ຍັງບໍ່ມີຂໍ້ຄວາມ.</p>');
    const sc = $('chatScroll'), atBottom = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 80;
    $('chatList').innerHTML = parts.join('');
    $('chatList').querySelectorAll('[data-ava]').forEach(el => { const k = el.dataset.ava; window.OFFICE.avatar(el, agent(k) ? k : person(k).look, 32); });
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
  $('chatOpen').onclick = async () => { try { await api('/api/projects/open', { method: 'POST', body: { path: C.dir } }); } catch (err) { $('chatNote').textContent = err.message; } };
  $('chatStop').onclick = async () => { if (C.running) try { await api(`/api/tasks/${C.running.id}/stop`, { method: 'POST' }); } catch (err) { $('chatNote').textContent = err.message; } };
  // one delegated handler for every auto-approve switch (approvals bar + chat)
  document.addEventListener('click', async e => {
    const b = e.target.closest('[data-autotoggle]'); if (!b) return;
    const t = S.tasks.find(x => x.id === b.dataset.autotoggle); if (!t) return;
    const inChat = !!b.closest('#chatList');
    b.disabled = true;
    try { const r = await api(`/api/tasks/${encodeURIComponent(t.id)}/auto-approve`, { method: 'POST', body: { on: !t.autoApprove } }); const cur = S.tasks.find(x => x.id === t.id); if (cur) upsertTask({ ...cur, autoApprove: r.autoApprove }); else b.disabled = false; }
    catch (err) { b.disabled = false; if (inChat) $('chatNote').textContent = err.message; else alert(err.message); }
  });
  $('chatInput').addEventListener('input', e => { e.target.style.height = 'auto'; e.target.style.height = Math.min(200, e.target.scrollHeight) + 'px'; });
  $('chatInput').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('chatForm').requestSubmit(); } });
  $('chatForm').addEventListener('submit', async e => {
    e.preventDefault();
    const text = $('chatInput').value.trim(); if (!text || !C.sessionId || C.running) return;
    $('chatSend').disabled = true;
    try {
      const t = await api('/api/tasks', { method: 'POST', body: { title: text.split('\n')[0].slice(0, 200), detail: text.includes('\n') ? text : '', mode: C.taskMode, assignee: C.assignee, cwd: C.dir, resume: C.sessionId, autoApprove: $('tAuto').checked } });
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
  $('tSession').addEventListener('change', renderSessionHint);
  $('tProjectWarn').addEventListener('click', async e => {
    const b = e.target.closest('[data-use-dir]'); if (!b) return;
    try { const p = await api('/api/projects', { method: 'POST', body: { path: b.dataset.useDir } }); S.projects = await api('/api/projects'); setProject(p.path); } catch (err) { alert(err.message); }
  });
  $('projectList').addEventListener('click', e => { const b = e.target.closest('.proj'); if (b) setProject(b.dataset.path); });
  $('sessionList').addEventListener('click', e => { const b = e.target.closest('[data-resume]'); if (b) prefillResume(b.dataset.resume, b.dataset.mode); const h = e.target.closest('[data-chat]'); if (h) { const ss = S.sessions.find(x => x.id === h.dataset.chat); openChat({ title: ss?.title || 'session', dir: S.project, sessionId: h.dataset.chat, task: S.tasks.find(t => t.sessionId === h.dataset.chat) }); } });
  // ---------- find a folder on this Mac: type to search, or browse from home ----------
  const F = { dir: '', timer: null, seq: 0 };
  const folderRow = f => `<div class="proj fRow"><b>${f.project ? '📦' : '📁'} ${esc(f.name)}</b><span class="btnRow"><button type="button" class="iconBtn" data-f-in="${esc(f.path)}" title="ເບິ່ງໂຟນເດີຂ້າງໃນ">📂</button><button type="button" class="iconBtn" data-f-use="${esc(f.path)}">＋ ໃຊ້</button></span><small>${esc(f.path)}</small></div>`;
  async function browse(dir) {
    const my = ++F.seq;
    try {
      const r = await api('/api/folders' + (dir ? '?dir=' + encodeURIComponent(dir) : '')); if (my !== F.seq) return;
      F.dir = r.path;
      $('fBar').innerHTML = `${r.parent ? `<button type="button" class="iconBtn" data-f-in="${esc(r.parent)}">⬆ ຂຶ້ນ</button>` : ''}<button type="button" class="iconBtn" data-f-in="${esc(r.home)}">🏠</button><small>${esc(r.path)}</small><button type="button" class="iconBtn" data-f-use="${esc(r.path)}">＋ ໃຊ້ໂຟນເດີນີ້</button>`;
      $('fList').innerHTML = r.folders.length ? r.folders.map(folderRow).join('') : '<p class="empty">ບໍ່ມີໂຟນເດີຍ່ອຍ</p>';
    } catch (err) { $('fList').innerHTML = `<p class="empty">${esc(err.message)}</p>`; }
  }
  async function searchFolders(q) {
    const my = ++F.seq;
    $('fBar').innerHTML = '<small>ກຳລັງຄົ້ນຫາ…</small>'; $('fList').innerHTML = '';
    try {
      const r = await api('/api/folders/search?q=' + encodeURIComponent(q)); if (my !== F.seq) return;
      $('fBar').innerHTML = `<small>ພົບ ${r.length} ໂຟນເດີ · 📦 = ໂປຣເຈັກ</small>`;
      $('fList').innerHTML = r.length ? r.map(folderRow).join('') : '<p class="empty">ບໍ່ພົບ. ລອງພິມຊື່ອື່ນ ຫຼື ລົບຄຳຄົ້ນເພື່ອໄລ່ເບິ່ງເອງ</p>';
    } catch (err) { $('fList').innerHTML = `<p class="empty">${esc(err.message)}</p>`; }
  }
  $('fSearch').addEventListener('input', () => { clearTimeout(F.timer); const q = $('fSearch').value.trim(); F.timer = setTimeout(() => q ? searchFolders(q) : browse(F.dir), 350); });
  document.querySelector('[data-pane="projects"]').addEventListener('click', async e => {
    const into = e.target.closest('[data-f-in]'); if (into) { $('fSearch').value = ''; browse(into.dataset.fIn); return; }
    const use = e.target.closest('[data-f-use]'); if (!use) return;
    try { const p = await api('/api/projects', { method: 'POST', body: { path: use.dataset.fUse } }); S.projects = await api('/api/projects'); setProject(p.path); say('ເພີ່ມໂປຣເຈັກ ' + p.name + ' ແລ້ວ'); } catch (err) { alert(err.message); }
  });
  $('tFind').onclick = () => { openPanel('projects'); $('fSearch').focus(); };
  browse('');
  $('pAdd').onclick = async () => {
    try { const p = await api('/api/projects/pick', { method: 'POST' }); if (p.cancelled) return; S.projects = await api('/api/projects'); setProject(p.path); }
    catch (err) { alert(err.message); }
  };
  $('pOpen').onclick = async () => { try { await api('/api/projects/open', { method: 'POST', body: { path: S.project } }); } catch (err) { alert('ເປີດບໍ່ໄດ້: ' + err.message); } };
  $('approvals').addEventListener('click', async e => {
    const au = e.target.closest('[data-auto]');
    if (au) { au.disabled = true; try { await api(`/api/tasks/${au.dataset.auto}/auto-approve`, { method: 'POST', body: { on: true } }); } catch (err) { alert(err.message); au.disabled = false; } return; }
    const b = e.target.closest('[data-ap]'); if (!b) return;
    b.disabled = true;
    const feedback = $('fb-' + b.dataset.ap)?.value || '';
    try { await api(`/api/approvals/${b.dataset.ap}`, { method: 'POST', body: { allow: b.dataset.allow === '1', feedback } }); }
    catch (err) { alert(err.message); }
  });
  // remembered auto-approve value shown in both the compose checkbox and the chat follow-up switch
  const syncAuto = on => { $('tAuto').checked = on; $('chatAuto').setAttribute('aria-checked', String(on)); $('chatAutoState').textContent = on ? 'ເປີດ' : 'ປິດ'; };
  $('tAuto').addEventListener('change', () => { setAuto($('tAuto').checked); syncAuto($('tAuto').checked); });
  $('chatAuto').addEventListener('click', () => { const on = $('tAuto').checked ? false : true; setAuto(on); syncAuto(on); });
  $('compose').addEventListener('submit', async e => {
    e.preventDefault();
    const title = $('tTitle').value.trim(); if (!title) return;
    const m = mode();
    $('tSend').disabled = true; say('ກຳລັງສົ່ງວຽກ…');
    try {
      const t = await api('/api/tasks', { method: 'POST', body: { title, detail: $('tDetail').value, mode: m, assignee: $('tAssignee').value, cwd: S.project, resume: $('tSession').value || null, autoApprove: $('tAuto').checked } });
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
  $('cEdit').onclick = () => { if (selectedKey) window.STAFF?.edit(selectedKey); };
  $('cAssign').onclick = () => { document.querySelector('input[name="mode"][value="single"]').checked = true; renderMode(); $('tAssignee').value = selectedKey; openPanel('compose'); };

  function syncPerson(key) {
    const a = agent(key); if (!a) return;
    const p = window.OFFICE.people.find(q => q.key === key); if (p) { p.model = window.OFFICE.modelName(a.model); p.role = a.role; }
    window.OFFICE.setLive(key, a);
  }
  function upsertTask(t) {
    const i = S.tasks.findIndex(x => x.id === t.id), before = i >= 0 ? S.tasks[i].status : null;
    if (i >= 0) S.tasks[i] = t; else S.tasks.unshift(t); renderTasks();
    if (before && before !== t.status && ['done', 'failed'].includes(t.status) && S.settings?.notifyDone) notify(t.status === 'done' ? '✅ ວຽກສຳເລັດ' : '⚠️ ວຽກບໍ່ສຳເລັດ', t.title);
    if (C.open && !C.sessionId && C.taskIds.has(t.id) && t.sessionId) C.sessionId = t.sessionId;
    if (C.open && C.taskIds.has(t.id)) renderChat();
  }

  // ---------- settings ----------
  async function saveSetting(key, value, statusEl) {
    try {
      S.settings = await api('/api/settings', { method: 'PATCH', body: { [key]: value } });
      if (statusEl) flash(statusEl, '✓ ບັນທຶກແລ້ວ', true);
      applySettings();
    } catch (err) {
      renderSettings(); // put the saved value back, then show why the change was refused
      const el = statusEl && statOf(key);
      if (el) flash(el, err.message, false); else alert(err.message);
    }
  }
  /** the values the office runs with: a group whose switch is off uses its defaults (same rule as settings.effective() on the server) */
  function eff() {
    const st = S.settings || {}, sc = S.settingsSchema, out = { ...st };
    if (sc) for (const g of sc.groups) if (g.toggle && st[g.toggle] === false) for (const f of sc.fields) if (f.group === g.key && f.key !== g.toggle) out[f.key] = f.default;
    return out;
  }
  function applySettings() {
    const st = eff();
    S.lead = st.teamLead || S.lead; S.resumeMaxTokens = st.resumeMaxTokens;
    syncAuto(!!st.autoApproveDefault);
    renderAssignees(); renderMode(); renderUsage(); renderSessions(); tickApprovalWaits();
    window.OFFICE?.setSpeed?.(st.animSpeed); window.OFFICE?.setBubbles?.(st.showBubbles !== false);
    $('pOpen').textContent = `📂 ເປີດໃນ ${EDITOR_TEXT[st.editor] || 'Antigravity'}`;
  }
  const EDITOR_TEXT = { antigravity: 'Antigravity', vscode: 'VS Code', finder: 'Finder' };
  function fieldHtml(f) {
    if (f.toggle) return '';
    const v = S.settings[f.key], id = 'set-' + f.key, help = f.help ? `<small class="sHelp">${esc(f.help)}</small>` : '', stat = `<span class="sStat" data-stat="${f.key}" role="status"></span>`;
    if (f.type === 'bool') return `<div class="sRow sBool"><label for="${id}"><b>${esc(f.label)}</b>${help}</label><input type="checkbox" role="switch" class="sw" id="${id}" data-set="${f.key}" ${v ? 'checked' : ''}>${stat}</div>`;
    if (f.type === 'number') return `<div class="sRow"><label for="${id}"><b>${esc(f.label)}</b>${help}</label><input type="number" id="${id}" data-set="${f.key}" min="${f.min}" max="${f.max}" step="${f.step}" value="${esc(v)}">${stat}</div>`;
    if (f.type === 'select') { const opts = Array.isArray(f.options) ? f.options : S.agents.map(a => ({ value: a.key, label: `${a.name} · ${a.role}` })); return `<div class="sRow"><label for="${id}"><b>${esc(f.label)}</b>${help}</label><select id="${id}" data-set="${f.key}">${opts.map(o => `<option value="${esc(o.value)}" ${o.value === v ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>${stat}</div>`; }
    if (f.type === 'path') return `<div class="sRow sWide"><label for="${id}"><b>${esc(f.label)}</b>${help}</label><div class="row2"><select id="${id}" data-set="${f.key}"><option value="" ${v ? '' : 'selected'}>— ໂຟນເດີທີ່ໃຊ້ລ່າສຸດ —</option>${[...new Set([...(v ? [v] : []), ...S.projects.map(p => p.path)])].map(d => `<option value="${esc(d)}" ${d === v ? 'selected' : ''}>📁 ${esc(d)}</option>`).join('')}</select></div>${stat}</div>`;
    if (f.type === 'list') return `<div class="sRow sWide"><label for="${id}"><b>${esc(f.label)}</b>${help}</label><textarea id="${id}" data-set="${f.key}" rows="5" spellcheck="false">${esc(v.join('\n'))}</textarea>${stat}</div>`;
    if (f.type === 'agents') return `<div class="sRow sWide"><p class="sLabel"><b>${esc(f.label)}</b>${help}</p>${stat}<div class="sAgents">${S.agents.map(a => {
      const lead = a.key === S.settings.teamLead;
      return `<div class="sAgent"><label><input type="checkbox" data-agent-on="${a.key}" ${v.includes(a.key) ? '' : 'checked'} ${lead ? 'disabled title="ຫົວໜ້າທີມປິດບໍ່ໄດ້"' : ''}> ${esc(a.name)} <small>${esc(a.role)}${lead ? ' · ຫົວໜ້າ' : ''}</small></label><label class="sTurns" title="ຈຳນວນຮອບສູງສຸດ (maxTurns)">ຮອບ <input type="number" min="1" max="200" step="1" value="${a.maxTurns || 40}" data-agent-turns="${a.key}"></label></div>`;
    }).join('')}</div></div>`;
    return '';
  }
  function renderSettings() {
    const box = $('settingsBox'), sc = S.settingsSchema;
    if (!sc || !S.settings) return;
    const open = new Set([...box.querySelectorAll('details[open]')].map(d => d.dataset.group)), first = !box.querySelector('details');
    const hasN = 'Notification' in window, perm = hasN ? Notification.permission : 'denied';
    const look = `<details class="sGroup" data-group="look" ${first || open.has('look') ? 'open' : ''}><summary><span>ໜ້າຕາ: ຂະໜາດຕົວໜັງສື ແລະ ສີ</span><button type="button" class="link" data-reset-look>ຄືນຄ່າເລີ່ມຕົ້ນ</button></summary>${lookHtml()}</details>`;
    box.innerHTML = look + sc.groups.map(g => {
      const tf = g.toggle && sc.fields.find(f => f.key === g.toggle), on = !tf || S.settings[tf.key] !== false;
      const master = tf ? `<div class="sRow sBool sMaster"><label for="set-${tf.key}"><b>${on ? 'ເປີດໃຊ້ຢູ່' : 'ປິດຢູ່'}</b><small class="sHelp">${esc(tf.help)}</small></label><input type="checkbox" role="switch" class="sw" id="set-${tf.key}" data-set="${tf.key}" aria-label="${esc(g.label)}: ${esc(tf.label)}" ${on ? 'checked' : ''}><span class="sStat" data-stat="${tf.key}" role="status"></span></div>` : '';
      return `<details class="sGroup${on ? '' : ' off'}" data-group="${g.key}" ${first || open.has(g.key) ? 'open' : ''}><summary><span>${esc(g.label)}${tf ? `<em class="sBadge" data-on="${on}">${on ? 'ເປີດ' : 'ປິດ'}</em>` : ''}</span><button type="button" class="link" data-reset="${g.key}">ຄືນຄ່າເລີ່ມຕົ້ນ</button></summary>
      ${master}
      ${g.key === 'data' ? `<div class="btnRow"><a class="iconBtn" href="/api/export" download>⬇ Export ປະຫວັດ (JSON)</a><button type="button" class="iconBtn" id="clearHistory">🗑 ລ້າງວຽກທີ່ຈົບແລ້ວ</button></div><p class="hint">Port <b>${esc(S.system?.port)}</b> · ຂໍ້ມູນເກັບຢູ່ <code>${esc(S.system?.dataDir || '')}</code>. Port ແລະ API key ປ່ຽນໄດ້ໃນ <code>.env</code> ແລ້ວ restart</p>` : ''}
      ${g.key === 'notify' ? `<div class="btnRow">${perm === 'default' ? '<button type="button" class="iconBtn" id="notifyPerm">🔔 ອະນຸຍາດໃຫ້ browser ແຈ້ງເຕືອນ</button>' : ''}<button type="button" class="iconBtn" id="notifyTest">▶ ລອງແຈ້ງເຕືອນ</button></div>${perm === 'denied' ? '<p class="hint warnText">browser ບລັອກການແຈ້ງເຕືອນໄວ້: ເປີດໄດ້ໃນການຕັ້ງຄ່າຂອງ browser (ສຽງຍັງໃຊ້ໄດ້)</p>' : ''}` : ''}
      <fieldset class="sFields" ${on ? '' : 'disabled'}>${sc.fields.filter(f => f.group === g.key).map(fieldHtml).join('')}</fieldset></details>`;
    }).join('');
  }

  // ---------- look: font size and RGB colours, kept in this browser by theme.js (per light/dark mode) ----------
  const LOOK_COLORS = [{ key: 'accent', label: 'ສີຫຼັກ (ປຸ່ມ, ລິ້ງ, ສະວິດ)' }, { key: 'bg', label: 'ສີພື້ນຫຼັງ' }];
  const SWATCHES = { accent: ['#6a4fd8', '#2f7de1', '#0f9d8a', '#2fa86a', '#e08a1e', '#d64545', '#d6458f', '#5b6475'], bg: ['#d9cfe6', '#cfe0f2', '#d3ebe2', '#f1e6d2', '#ececec', '#1d1a29', '#15202b', '#1f2421'] };
  const RGB = [['r', 'R ແດງ'], ['g', 'G ຂຽວ'], ['b', 'B ຟ້າ']];
  // the colour on screen now: the custom one, or the built-in one from the stylesheet
  const lookMode = () => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  const lookColor = key => {
    const v = THEME.getLook()[lookMode()][key] || getComputedStyle(document.documentElement).getPropertyValue('--' + key).trim();
    return /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : '#808080';
  };
  function lookHtml() {
    const lk = THEME.getLook(), dark = lookMode() === 'dark', pct = Math.round(lk.fontScale * 100);
    const colorRow = ({ key, label }) => {
      const c = lookColor(key), rgb = THEME.toRgb(c), custom = !!lk[lookMode()][key];
      return `<div class="sRow sWide sColor" data-color-row="${key}"><div class="sColorHead"><span class="sChip" style="background:${c}"></span><b>${esc(label)}</b><input type="color" value="${c}" data-look-color="${key}" data-ch="hex" aria-label="${esc(label)}: ເລືອກສີ"><code class="sHex">${c} · rgb(${rgb.join(', ')})</code>${custom ? `<button type="button" class="link" data-look-clear="${key}">ໃຊ້ສີເດີມ</button>` : ''}</div>
        ${RGB.map(([ch, name], i) => `<label class="sRgb"><span>${name}</span><input type="range" min="0" max="255" step="1" value="${rgb[i]}" data-look-color="${key}" data-ch="${ch}" style="--track:${trackOf(rgb, i)}"><input type="number" min="0" max="255" step="1" value="${rgb[i]}" data-look-color="${key}" data-ch="${ch}" aria-label="${esc(label)} ${name}"></label>`).join('')}
        <div class="sSwatches">${SWATCHES[key].map(sw => `<button type="button" class="sSwatch" style="background:${sw}" data-look-swatch="${key}" data-hex="${sw}" title="${sw}" aria-label="ໃຊ້ສີ ${sw}"></button>`).join('')}</div></div>`;
    };
    return `<div class="sRow sWide"><label class="sFont"><b>ຂະໜາດຕົວໜັງສື <output data-font-out>${pct}%</output></b><span class="sFontCtl"><button type="button" class="iconBtn" data-font-step="-5" aria-label="ຫຍໍ້ຕົວໜັງສື">A−</button><input type="range" min="${THEME.FONT_MIN * 100}" max="${THEME.FONT_MAX * 100}" step="5" value="${pct}" data-look-font aria-label="ຂະໜາດຕົວໜັງສື (%)"><button type="button" class="iconBtn" data-font-step="5" aria-label="ຂະຫຍາຍຕົວໜັງສື">A+</button></span><small class="sHelp">ໃຊ້ກັບທຸກໜ້າຂອງລະບົບ. 100% = ຂະໜາດເດີມ</small></label></div>
      <p class="hint sLookNote">ສີຂ້າງລຸ່ມເປັນຂອງ <b>ໂໝດ${dark ? 'ມືດ' : 'ສະຫວ່າງ'}</b> (ໂໝດທີ່ເຫັນຢູ່). ປ່ຽນໂໝດດ້ວຍປຸ່ມ ໂໝດສີ ເທິງແຜນທີ່ ເພື່ອຕັ້ງສີຂອງອີກໂໝດ. ບັນທຶກໄວ້ໃນ browser ນີ້.</p>
      ${LOOK_COLORS.map(colorRow).join('')}`;
  }
  const lookBox = () => $('settingsBox').querySelector('[data-group="look"]');
  // re-draw only the look section, so the slider being dragged keeps focus
  function refreshLook(focusSel) {
    const d = lookBox(); if (!d) return;
    const summary = d.querySelector('summary'); d.innerHTML = ''; d.append(summary); d.insertAdjacentHTML('beforeend', lookHtml());
    if (focusSel) d.querySelector(focusSel)?.focus();
  }
  const trackOf = (rgb, i) => `linear-gradient(90deg, ${THEME.toHex(rgb.map((v, j) => j === i ? 0 : v))}, ${THEME.toHex(rgb.map((v, j) => j === i ? 255 : v))})`;
  // update one colour row in place (rebuilding it would break a slider drag)
  function syncColorRow(key) {
    const row = lookBox()?.querySelector(`[data-color-row="${key}"]`); if (!row) return;
    const c = lookColor(key), rgb = THEME.toRgb(c);
    row.querySelector('.sChip').style.background = c;
    row.querySelector('.sHex').textContent = `${c} · rgb(${rgb.join(', ')})`;
    const pick = row.querySelector('[data-ch="hex"]'); if (pick !== document.activeElement) pick.value = c;
    RGB.forEach(([ch], i) => row.querySelectorAll(`[data-ch="${ch}"]`).forEach(inp => { if (inp !== document.activeElement) inp.value = rgb[i]; if (inp.type === 'range') inp.style.setProperty('--track', trackOf(rgb, i)); }));
    const head = row.querySelector('.sColorHead'), clear = head.querySelector('[data-look-clear]'), custom = !!THEME.getLook()[lookMode()][key];
    if (custom && !clear) head.insertAdjacentHTML('beforeend', `<button type="button" class="link" data-look-clear="${key}">ໃຊ້ສີເດີມ</button>`);
    if (!custom && clear) clear.remove();
  }
  function setLookColor(key, hex) { THEME.setLook({ [key]: hex }); syncColorRow(key); }
  $('settingsBox').addEventListener('input', e => {
    const el = e.target;
    if (el.dataset.lookFont !== undefined) { const v = Number(el.value) / 100; THEME.setLook({ fontScale: v }); lookBox().querySelector('[data-font-out]').textContent = Math.round(v * 100) + '%'; return; }
    const key = el.dataset.lookColor; if (!key) return;
    if (el.dataset.ch === 'hex') return setLookColor(key, el.value);
    if (el.value === '') return; // number box being cleared while typing
    const rgb = THEME.toRgb(lookColor(key)); rgb['rgb'.indexOf(el.dataset.ch)] = Number(el.value);
    setLookColor(key, THEME.toHex(rgb));
  });
  const statOf = key => $('settingsBox').querySelector(`[data-stat="${key}"]`);
  const flash = (el, text, ok) => { if (!el) return; el.textContent = text; el.className = 'sStat ' + (ok ? 'ok' : 'bad'); if (ok) setTimeout(() => { el.textContent = ''; }, 1800); };
  $('settingsBox').addEventListener('change', e => {
    const el = e.target;
    if (el.dataset.set) {
      const f = S.settingsSchema.fields.find(x => x.key === el.dataset.set);
      const value = f.type === 'bool' ? el.checked : f.type === 'number' ? Number(el.value) : f.type === 'list' ? el.value.split('\n') : el.value;
      saveSetting(f.key, value, statOf(f.key));
    } else if (el.dataset.agentOn) {
      const off = new Set(S.settings.disabledAgents); if (el.checked) off.delete(el.dataset.agentOn); else off.add(el.dataset.agentOn);
      saveSetting('disabledAgents', [...off], statOf('disabledAgents'));
    } else if (el.dataset.agentTurns) {
      const key = el.dataset.agentTurns;
      api(`/api/agents/${key}`, { method: 'PATCH', body: { maxTurns: Number(el.value) } })
        .then(a => { const x = agent(key); if (x) x.maxTurns = a.maxTurns; flash(statOf('disabledAgents'), '✓ ບັນທຶກແລ້ວ', true); })
        .catch(err => { flash(statOf('disabledAgents'), err.message, false); el.value = agent(key)?.maxTurns || 40; });
    }
  });
  $('settingsBox').addEventListener('click', async e => {
    const step = e.target.closest('[data-font-step]'), sw = e.target.closest('[data-look-swatch]'), clr = e.target.closest('[data-look-clear]');
    if (step) { THEME.setLook({ fontScale: THEME.getLook().fontScale + Number(step.dataset.fontStep) / 100 }); refreshLook(`[data-font-step="${step.dataset.fontStep}"]`); return; }
    if (sw) { setLookColor(sw.dataset.lookSwatch, sw.dataset.hex); return; }
    if (clr) { setLookColor(clr.dataset.lookClear, null); return; }
    if (e.target.closest('[data-reset-look]')) { e.preventDefault(); THEME.setLook({ fontScale: 1, accent: null, bg: null }, 'light'); THEME.setLook({ accent: null, bg: null }, 'dark'); refreshLook(); return; }
    const r = e.target.closest('[data-reset]');
    if (r) {
      e.preventDefault();
      const keys = S.settingsSchema.fields.filter(f => f.group === r.dataset.reset).map(f => f.key);
      try { S.settings = await api('/api/settings', { method: 'PATCH', body: Object.fromEntries(keys.map(k => [k, null])) }); applySettings(); renderSettings(); } catch (err) { alert(err.message); }
    }
    if (e.target.closest('#notifyPerm')) { await Notification.requestPermission(); renderSettings(); }
    if (e.target.closest('#clearHistory')) {
      const n = S.tasks.filter(t => !LIVE.includes(t.status)).length;
      if (!n) { alert('ບໍ່ມີວຽກທີ່ຈົບແລ້ວໃຫ້ລ້າງ'); return; }
      if (!confirm(`ລຶບວຽກທີ່ຈົບແລ້ວ ${n} ອັນ ພ້ອມປະຫວັດການສົນທະນາຂອງມັນ? (ວຽກທີ່ກຳລັງເຮັດຢູ່ຈະບໍ່ຖືກລຶບ. ກົດ Export ກ່ອນ ຖ້າຢາກເກັບໄວ້)`)) return;
      try { const r = await api('/api/tasks/clear', { method: 'POST' }); alert(`ລຶບແລ້ວ ${r.removed} ວຽກ`); } catch (err) { alert(err.message); }
      return;
    }
    if (e.target.closest('#notifyTest')) notify('🔔 ຫ້ອງການ AI Dev', 'ການແຈ້ງເຕືອນເຮັດວຽກແລ້ວ', true);
  });

  // ---------- notifications: a system notification when the page is not in front, plus a short chime ----------
  let audio = null;
  function chime() {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      [660, 880].forEach((hz, i) => {
        const o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime + i * 0.16;
        o.type = 'sine'; o.frequency.value = hz; o.connect(g); g.connect(audio.destination);
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
        o.start(t); o.stop(t + 0.16);
      });
    } catch { /* no audio */ }
  }
  function notify(title, body, force = false) {
    if (S.settings?.notifySound) chime();
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    if (!force && document.visibilityState === 'visible' && document.hasFocus()) return;
    try { const n = new Notification(title, { body: String(body || '').slice(0, 180), tag: 'ai-office' }); n.onclick = () => { window.focus(); n.close(); }; } catch { /* unsupported */ }
  }

  // ---------- team roster changed (hired, archived, edited, reordered) ----------
  function applyTeam({ agents, archived }) {
    S.agents = agents; S.archived = archived || [];
    window.OFFICE.setTeam(S.agents);
    S.agents.forEach(a => window.OFFICE.setLive(a.key, a));
    if (selectedKey && !agent(selectedKey)) selectedKey = null; else if (selectedKey) renderCard();
    renderAssignees(); renderMode(); renderCounts(); renderTasks(); renderSettings();
    if (C.open) renderChat();
    window.STAFF?.render();
  }
  // what staff.js (the team manager pane) needs from here
  window.APP = { S, api, esc, agent, person, openPanel, applyTeam, EFFORT_TEXT, ACCESS_TEXT };

  // ---------- boot ----------
  (async () => {
    await waitOffice();
    window.OFFICE.onSelect = p => { selectedKey = p ? p.key : null; if (p) renderCard(); };
    let st;
    try { st = await api('/api/state'); } catch (err) { $('authText').textContent = 'ເຊື່ອມຕໍ່ server ບໍ່ໄດ້'; return; }
    Object.assign(S, st);
    window.OFFICE.setTeam(S.agents);
    const startDir = S.settings?.defaultProject; if (startDir && S.projects.some(p => p.path === startDir)) S.project = startDir;
    S.agents.forEach(a => syncPerson(a.key));
    renderAuth(); renderAssignees(); renderMode(); renderProjects(); renderTasks(); renderApprovals(); renderUsage(); renderCounts(); applySettings(); renderSettings();
    loadSessions();
    if (S.approvals.length) openPanel('approvals');

    const es = new EventSource('/api/events');
    es.onmessage = m => {
      const ev = JSON.parse(m.data);
      if (ev.type === 'agent') { const a = agent(ev.key); if (a) { Object.assign(a, { status: ev.status, activity: ev.activity, taskId: ev.taskId }); window.OFFICE.setLive(ev.key, a); if (ev.key === selectedKey) renderCard(); renderCounts(); } }
      else if (ev.type === 'team') applyTeam(ev);
      else if (ev.type === 'tasks') { S.tasks = ev.tasks; renderTasks(); renderCounts(); }
      else if (ev.type === 'settings') { S.settings = ev.settings; applySettings(); renderSettings(); }
      else if (ev.type === 'agentConfig') { const a = agent(ev.key); if (a) { a.model = ev.model; a.effort = ev.effort; if (ev.maxTurns) a.maxTurns = ev.maxTurns; syncPerson(ev.key); if (ev.key === selectedKey) renderCard(); } }
      else if (ev.type === 'task') { upsertTask(ev.task); if (['done', 'failed'].includes(ev.task.status) && ev.task.cwd === S.project) loadSessions(); }
      else if (ev.type === 'log') { const t = S.tasks.find(x => x.id === ev.taskId); if (t) t.log = [...(t.log || []), ev.entry].slice(-80); }
      else if (ev.type === 'msg') { if (C.open && C.taskIds.has(ev.taskId)) { C.msgs.push(ev.msg); renderChat(); } }
      else if (ev.type === 'approval') {
        S.approvals.push(ev.approval); renderApprovals(); openPanel('approvals'); window.OFFICE.focus(ev.approval.agent);
        const ap = ev.approval, who = agent(ap.agent)?.name || ap.agent;
        if (ap.kind === 'plan' ? S.settings?.notifyPlan : S.settings?.notifyApproval) notify(ap.kind === 'plan' ? '📋 ແຜນລໍຖ້າອະນຸມັດ' : '✋ ຂໍອະນຸຍາດ', `${who}: ${ap.summary || ''}`);
      }
      else if (ev.type === 'approvalDone') { S.approvals = S.approvals.filter(a => a.id !== ev.id); renderApprovals(); }
      else if (ev.type === 'usage') { S.usage = ev.usage; renderUsage(); }
      else if (ev.type === 'auth') { S.auth = ev.auth; renderAuth(); renderUsage(); }
      else if (ev.type === 'projects') { S.projects = ev.projects; renderProjects(); }
    };
    es.onerror = () => { $('authText').textContent = 'ຂາດການເຊື່ອມຕໍ່ server…'; };
    es.onopen = () => renderAuth();
  })();
})();

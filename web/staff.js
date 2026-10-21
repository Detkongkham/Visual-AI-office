// Team manager pane: order the team (drag or ▲▼), edit a person, hire someone new, change their look
// (drawing, shirt colour, name-tag colour) and archive or restore people. Talks to /api/agents.
(function () {
  const A = window.APP, $ = id => document.getElementById(id), esc = A.esc;
  const box = $('staffBox');
  const SHIRTS = ['#2f7de1', '#2fa86a', '#d64545', '#e08a1e', '#f2c94c', '#8e5bd8', '#d6458f', '#0f9d8a', '#f2f2f2', '#5b6475', '#1e1e24', '#7a5640'];
  const TAGS = ['#6a4fd8', '#2f7de1', '#0f9d8a', '#2fa86a', '#e08a1e', '#d64545', '#d6458f', '#ffd84d'];
  const FIELDS = ['name', 'role', 'prompt', 'access', 'model', 'effort', 'maxTurns', 'seat'];
  let view = { mode: 'list' }, draft = null, msg = '';

  const office = () => window.OFFICE;
  const seatText = k => office().seats().find(s => s.key === k)?.label || k || '—';
  const freeSeats = own => office().seats().filter(s => !s.owner || s.owner === own);

  // ---------- list ----------
  function listHtml() {
    const S = A.S, off = S.settings?.disabledAgents || [], free = S.seats ? freeSeats(null).length : 0;
    const rows = S.agents.map((a, i) => `<li class="stRow" draggable="true" data-key="${esc(a.key)}">
      <span class="stGrip" aria-hidden="true" title="ລາກເພື່ອຍ້າຍ">⠿</span><div class="ava" data-ava="${esc(a.key)}"></div>
      <div class="stInfo"><b>${esc(a.name)}${a.key === S.lead ? '<em class="stBadge">ຫົວໜ້າ</em>' : ''}${off.includes(a.key) ? '<em class="stBadge off">ປິດຢູ່</em>' : ''}</b><small>${esc(a.role)} · ${esc(office().modelName(a.model))}</small><small>${esc(seatText(a.seat))}</small></div>
      <span class="stBtns"><button type="button" class="iconOnly" data-st-move="-1" aria-label="ຍ້າຍ ${esc(a.name)} ຂຶ້ນ" ${i ? '' : 'disabled'}>▲</button><button type="button" class="iconOnly" data-st-move="1" aria-label="ຍ້າຍ ${esc(a.name)} ລົງ" ${i < S.agents.length - 1 ? '' : 'disabled'}>▼</button><button type="button" class="iconBtn" data-st-edit="${esc(a.key)}" ${S.seats ? '' : 'disabled'}>ແກ້ໄຂ</button></span></li>`).join('');
    const arch = S.archived || [];
    return `<div class="stTop"><button type="button" class="primary" data-st-new ${free ? '' : 'disabled title="ບໍ່ມີໂຕະວ່າງ"'}>＋ ຮັບພະນັກງານໃໝ່</button><small class="muted">${S.agents.length} ຄົນ · ໂຕະວ່າງ ${free}</small></div>
      ${S.seats ? '' : '<p class="folderWarn">⚠️ server ທີ່ເປີດຢູ່ຍັງເປັນລຸ້ນເກົ່າ: ຢຸດ server ແລ້ວລັນ <code>npm start</code> ໃໝ່ ຈຶ່ງຈະແກ້ໄຂ, ຮັບພະນັກງານໃໝ່ ແລະ ເຫັນໜ້າຕາກັບໂຕະຂອງແຕ່ລະຄົນໄດ້</p>'}
      ${msg ? `<p class="formMsg" role="status">${esc(msg)}</p>` : ''}
      <p class="hint">ລາກ ⠿ ຫຼື ກົດ ▲ ▼ ເພື່ອຈັດລຳດັບ. ລຳດັບນີ້ໃຊ້ໃນລາຍຊື່ທີມ, ຕອນເລືອກຄົນສັ່ງວຽກ ແລະ ລາຍຊື່ທີມທີ່ຫົວໜ້າເຫັນ</p>
      <ol class="stList" id="stList">${rows}</ol>
      ${arch.length ? `<details class="stArchive"><summary>ຄັງ: ຄົນທີ່ເກັບໄວ້ (${arch.length})</summary>${arch.map(a => `<div class="stRow"><span></span><div class="ava" data-look="${esc(a.key)}"></div><div class="stInfo"><b>${esc(a.name)}</b><small>${esc(a.role)}</small></div><span class="stBtns"><button type="button" class="iconBtn" data-st-restore="${esc(a.key)}" ${free ? '' : 'disabled'}>ກູ້ຄືນ</button></span></div>`).join('')}</details>` : ''}`;
  }

  // ---------- editor (edit someone, or hire) ----------
  function newDraft() {
    const S = A.S, used = new Set(S.agents.map(a => a.look?.sprite));
    const sprite = office().sprites().find(k => !used.has(k)) || 'dao';
    return { name: '', role: '', prompt: '', access: 'write', model: S.models[1]?.id || S.models[0]?.id, effort: 'medium', maxTurns: 40, seat: freeSeats(null)[0]?.key || '', look: { sprite, shirt: SHIRTS[Math.floor(Math.random() * SHIRTS.length)], color: null }, copyFrom: '' };
  }
  const opt = (v, label, cur) => `<option value="${esc(v)}" ${String(v) === String(cur) ? 'selected' : ''}>${esc(label)}</option>`;
  function swatches(kind, list, cur, none) {
    return `<div class="stColors">${list.map(c => `<button type="button" class="sSwatch" style="background:${c}" data-st-${kind}="${c}" aria-label="ສີ ${c}" aria-pressed="${c === cur}"></button>`).join('')}
      <input type="color" value="${cur || '#808080'}" data-st-${kind}-pick aria-label="ເລືອກສີເອງ"><button type="button" class="link" data-st-${kind}="">${none}</button></div>`;
  }
  function editHtml() {
    const S = A.S, d = draft, isNew = view.mode === 'new', isLead = !isNew && view.key === S.lead;
    return `<button type="button" class="link stBack" data-st-back>← ກັບໄປລາຍຊື່</button>
      <div class="stHero"><canvas id="stPrev" width="120" height="190" aria-label="ຕົວຢ່າງໜ້າຕາ"></canvas>
        <div><span class="stTag" id="stTag">${esc(d.name || 'ຊື່')}</span><small class="muted" id="stRole">${esc(d.role || 'ບົດບາດ')}</small>${isNew ? '<p class="hint">ພະນັກງານໃໝ່ຈະນັ່ງໂຕະທີ່ເລືອກ ແລະ ຫົວໜ້າທີມຈະເຫັນເຂົາໃນລາຍຊື່ທີມທັນທີ</p>' : ''}</div></div>
      ${isNew ? `<label class="fl" for="stCopy">ເລີ່ມຈາກແມ່ແບບ</label><select id="stCopy" data-st-copy>${opt('', '— ເລີ່ມຈາກເປົ່າ —', d.copyFrom)}${S.agents.map(a => opt(a.key, `ຄືກັບ ${a.name} · ${a.role}`, d.copyFrom)).join('')}</select>` : ''}
      <label class="fl" for="st-name">ຊື່</label><input id="st-name" data-st-f="name" maxlength="30" value="${esc(d.name)}" placeholder="ເຊັ່ນ: ນາງ">
      <label class="fl" for="st-role">ບົດບາດ</label><input id="st-role" data-st-f="role" maxlength="60" value="${esc(d.role)}" placeholder="ເຊັ່ນ: Frontend Developer">
      <label class="fl" for="st-prompt">ໜ້າທີ່ ແລະ ວິທີເຮັດວຽກ (prompt, ແນະນຳພາສາອັງກິດ)</label><textarea id="st-prompt" data-st-f="prompt" rows="5" maxlength="4000" placeholder="You are the ... Do ... Never ...">${esc(d.prompt)}</textarea>
      <div class="stGrid">
        <label><span class="fl">ສິດ</span><select data-st-f="access">${opt('write', '✏️ ອ່ານ ແລະ ແກ້ໄຂໄຟລ໌', d.access)}${opt('read', '🔒 ອ່ານຢ່າງດຽວ', d.access)}</select></label>
        <label><span class="fl">ໂມເດວ</span><select data-st-f="model">${S.models.map(m => opt(m.id, m.label, d.model)).join('')}</select></label>
        <label><span class="fl">ລະດັບການຄິດ</span><select data-st-f="effort">${S.efforts.map(e => opt(e, A.EFFORT_TEXT[e] || e, d.effort)).join('')}</select></label>
        <label><span class="fl">ຮອບສູງສຸດ</span><input type="number" min="1" max="200" step="1" data-st-f="maxTurns" value="${esc(d.maxTurns)}"></label>
      </div>
      <label class="fl" for="st-seat">ໂຕະ</label><select id="st-seat" data-st-f="seat">${freeSeats(isNew ? null : view.key).map(s => opt(s.key, s.label, d.seat)).join('')}</select>
      <h3 class="sub">ໜ້າຕາ</h3>
      <p class="fl">ຮູບຕົວລະຄອນ</p>
      <div class="stSprites" role="radiogroup" aria-label="ຮູບຕົວລະຄອນ">${office().sprites().map(k => `<button type="button" class="ava stSprite" role="radio" aria-checked="${k === d.look.sprite}" data-st-sprite="${k}" aria-label="ຮູບ ${k}"></button>`).join('')}</div>
      <p class="fl">ສີເສື້ອ</p>${swatches('shirt', SHIRTS, d.look.shirt, 'ສີເດີມ')}
      <p class="fl">ສີປ້າຍຊື່</p>${swatches('tag', TAGS, d.look.color, 'ບໍ່ມີ (ສີຂາວ)')}
      <p class="formMsg" id="stMsg" role="status">${esc(msg)}</p>
      <div class="btnRow stActions"><button type="button" class="primary" data-st-save>${isNew ? 'ຮັບເຂົ້າທີມ' : 'ບັນທຶກ'}</button><button type="button" class="iconBtn" data-st-back>ຍົກເລີກ</button>
        ${isNew ? '' : `<button type="button" class="iconBtn danger" data-st-archive ${isLead ? 'disabled title="ເລືອກຫົວໜ້າຄົນອື່ນໃນ ການຕັ້ງຄ່າ ກ່ອນ"' : ''}>ເກັບເຂົ້າຄັງ</button>`}</div>`;
  }
  // repaint only the parts that show the look, so typing and colour dragging keep focus
  function paintLook() {
    const d = draft; if (!d) return;
    const cv = $('stPrev'); if (cv) office().preview(cv, d.look);
    const tag = $('stTag'); if (tag) { tag.textContent = d.name || 'ຊື່'; tag.style.background = d.look.color || ''; tag.style.color = d.look.color ? inkOn(d.look.color) : ''; }
    const role = $('stRole'); if (role) role.textContent = d.role || 'ບົດບາດ';
    box.querySelectorAll('[data-st-sprite]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.stSprite === d.look.sprite)));
    box.querySelectorAll('[data-st-shirt]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.stShirt === (d.look.shirt || ''))));
    box.querySelectorAll('[data-st-tag]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.stTag === (d.look.color || ''))));
  }
  const inkOn = c => { const [r, g, b] = [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16) / 255); return 0.299 * r + 0.587 * g + 0.114 * b > 0.6 ? '#2a2238' : '#ffffff'; };

  function render() {
    if (!box || !A.S.agents.length) return;
    if (view.mode !== 'list' && view.mode === 'edit' && !A.agent(view.key)) view = { mode: 'list' };
    if (view.mode === 'list') { box.innerHTML = listHtml(); box.querySelectorAll('[data-ava]').forEach(el => office().avatar(el, el.dataset.ava, 34)); box.querySelectorAll('[data-look]').forEach(el => office().avatar(el, A.person(el.dataset.look)?.look, 34)); return; }
    // the editor is rebuilt only when it opens; live roster updates must not wipe what is being typed
    if (!box.querySelector('[data-st-save]')) { box.innerHTML = editHtml(); box.querySelectorAll('[data-st-sprite]').forEach(b => office().avatar(b, { sprite: b.dataset.stSprite }, 44)); paintLook(); }
  }
  function open(next) {
    view = next; msg = '';
    if (next.mode === 'edit') { const a = A.agent(next.key), drawn = office().people.find(p => p.key === next.key); draft = { ...Object.fromEntries(FIELDS.map(f => [f, a[f]])), look: { sprite: a.look?.sprite || drawn?.sprite, shirt: a.look?.shirt || null, color: a.look?.color || null } }; }
    else if (next.mode === 'new') draft = newDraft();
    else draft = null;
    box.innerHTML = ''; render(); box.closest('.pane').scrollTop = 0;
  }
  const say = t => { msg = t; const el = $('stMsg'); if (el) el.textContent = t; };

  // ---------- events ----------
  box.addEventListener('input', e => {
    const el = e.target;
    if (el.dataset.stF) { draft[el.dataset.stF] = el.type === 'number' ? Number(el.value) : el.value; if (['name', 'role'].includes(el.dataset.stF)) paintLook(); return; }
    if (el.matches('[data-st-shirt-pick]')) { draft.look.shirt = el.value; paintLook(); }
    if (el.matches('[data-st-tag-pick]')) { draft.look.color = el.value; paintLook(); }
  });
  box.addEventListener('change', e => {
    if (!e.target.matches('[data-st-copy]')) return;
    const src = A.agent(e.target.value); draft.copyFrom = e.target.value;
    if (src) { Object.assign(draft, { role: src.role, prompt: src.prompt, access: src.access, model: src.model, effort: src.effort, maxTurns: src.maxTurns }); draft.look.sprite = src.look?.sprite || draft.look.sprite; }
    const keep = { ...draft }; box.innerHTML = ''; draft = keep; render();
  });
  box.addEventListener('click', async e => {
    const t = e.target.closest('button'); if (!t) return;
    const d = t.dataset;
    if ('stNew' in d) return open({ mode: 'new' });
    if (d.stEdit) return open({ mode: 'edit', key: d.stEdit });
    if ('stBack' in d) return open({ mode: 'list' });
    if (d.stSprite) { draft.look.sprite = d.stSprite; return paintLook(); }
    if ('stShirt' in d) { draft.look.shirt = d.stShirt || null; return paintLook(); }
    if ('stTag' in d) { draft.look.color = d.stTag || null; return paintLook(); }
    if (d.stMove) { const row = t.closest('[data-key]'), keys = A.S.agents.map(a => a.key), i = keys.indexOf(row.dataset.key), j = i + Number(d.stMove); if (j < 0 || j >= keys.length) return; [keys[i], keys[j]] = [keys[j], keys[i]]; return saveOrder(keys, row.dataset.key); }
    if (d.stRestore) { try { const a = await A.api(`/api/agents/${encodeURIComponent(d.stRestore)}/restore`, { method: 'POST' }); msg = `${a.name} ກັບມາເຮັດວຽກແລ້ວ`; render(); } catch (err) { alert(err.message); } return; }
    if ('stArchive' in d) {
      const a = A.agent(view.key);
      if (!confirm(`ເກັບ ${a.name} ເຂົ້າຄັງ? ເຂົາຈະອອກຈາກຫ້ອງການ ແລະ ບໍ່ຖືກແຈກວຽກ. ປະຫວັດແຊັດເກົ່າຍັງຢູ່ ແລະ ກູ້ຄືນໄດ້ທຸກເວລາ`)) return;
      try { await A.api(`/api/agents/${encodeURIComponent(view.key)}`, { method: 'DELETE' }); open({ mode: 'list' }); say(`ເກັບ ${a.name} ເຂົ້າຄັງແລ້ວ`); render(); } catch (err) { say(err.message); }
      return;
    }
    if ('stSave' in d) {
      t.disabled = true; say('ກຳລັງບັນທຶກ…');
      try {
        const body = { ...Object.fromEntries(FIELDS.map(f => [f, draft[f]])), look: draft.look };
        if (view.mode === 'new') { if (draft.copyFrom) body.copyFrom = draft.copyFrom; const a = await A.api('/api/agents', { method: 'POST', body }); open({ mode: 'list' }); say(`ຍິນດີຕ້ອນຮັບ ${a.name} ເຂົ້າທີມ 🎉`); window.OFFICE.focus(a.key); }
        else { const a = await A.api(`/api/agents/${encodeURIComponent(view.key)}`, { method: 'PATCH', body }); open({ mode: 'list' }); say(`ບັນທຶກ ${a.name} ແລ້ວ`); }
        render();
      } catch (err) { say(err.message); t.disabled = false; }
    }
  });

  // ---------- ordering ----------
  async function saveOrder(keys, focusKey) {
    const S = A.S, before = S.agents;
    S.agents = keys.map(k => before.find(a => a.key === k)); render(); // show it right away; the server's team event confirms
    if (focusKey) box.querySelector(`[data-key="${focusKey}"] [data-st-move]`)?.focus();
    try { await A.api('/api/agents/order', { method: 'PUT', body: { keys } }); }
    catch (err) { S.agents = before; msg = err.message; render(); }
  }
  let dragKey = null;
  box.addEventListener('dragstart', e => { const li = e.target.closest?.('.stRow[data-key]'); if (!li) return; dragKey = li.dataset.key; li.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragKey); });
  box.addEventListener('dragend', e => { e.target.closest?.('.stRow')?.classList.remove('dragging'); box.querySelectorAll('.dropBefore, .dropAfter').forEach(x => x.classList.remove('dropBefore', 'dropAfter')); dragKey = null; });
  box.addEventListener('dragover', e => {
    const li = e.target.closest?.('.stRow[data-key]'); if (!dragKey || !li) return; e.preventDefault();
    const r = li.getBoundingClientRect(), after = e.clientY > r.top + r.height / 2;
    box.querySelectorAll('.dropBefore, .dropAfter').forEach(x => x.classList.remove('dropBefore', 'dropAfter'));
    if (li.dataset.key !== dragKey) li.classList.add(after ? 'dropAfter' : 'dropBefore');
  });
  box.addEventListener('drop', e => {
    const li = e.target.closest?.('.stRow[data-key]'); if (!dragKey || !li) return; e.preventDefault();
    const after = li.classList.contains('dropAfter'), keys = A.S.agents.map(a => a.key).filter(k => k !== dragKey);
    if (li.dataset.key === dragKey) return;
    keys.splice(keys.indexOf(li.dataset.key) + (after ? 1 : 0), 0, dragKey);
    saveOrder(keys);
  });

  window.STAFF = {
    render,
    edit(key) { A.openPanel('staff'); if (A.S.seats) open({ mode: 'edit', key }); },
  };
})();

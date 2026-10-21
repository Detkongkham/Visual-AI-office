// Shirt mask editor: build a drawing's shirt mask automatically, fix it with a brush, and save it to
// web/assets/shirts/<sprite>.png (alpha = how much of the pixel is shirt). window.ME exposes the same actions for scripting.
(function () {
  const $ = id => document.getElementById(id);
  const sel = $('sprite'), grid = $('grid'), edit = $('edit'), eg = edit.getContext('2d');
  const st = { sprite: null, img: null, w: 0, h: 0, orig: null, mask: null, view: null, viewCv: null, Lr: 0, frame: null, thumbs: [], undo: [], dirty: false };
  const say = t => { $('status').textContent = t; };
  const rowsOf = () => ATLAS[st.sprite].rows;
  Object.keys(ATLAS).forEach(k => sel.insertAdjacentHTML('beforeend', `<option value="${k}">${k}</option>`));

  const loadImg = src => new Promise(res => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = src; });
  async function open(sprite) {
    if (st.dirty && !confirm('ຍັງບໍ່ໄດ້ບັນທຶກ. ປ່ຽນຮູບແທ້ບໍ?')) { sel.value = st.sprite; return; }
    say('ກຳລັງໂຫຼດ…'); st.sprite = sprite; sel.value = sprite;
    const img = await loadImg(ATLAS[sprite].img); st.img = img; st.w = img.naturalWidth; st.h = img.naturalHeight;
    const cv = document.createElement('canvas'); cv.width = st.w; cv.height = st.h; const g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
    st.orig = g.getImageData(0, 0, st.w, st.h);
    const saved = await loadImg(`assets/shirts/${sprite}.png?t=${Date.now()}`);
    const fromFile = saved && saved.naturalWidth === st.w && saved.naturalHeight === st.h;
    st.mask = fromFile ? TINT.maskFromImage(saved) : TINT.autoMask(st.orig.data, st.w, rowsOf(), sprite);
    st.viewCv = cv; st.view = g.createImageData(st.w, st.h); st.undo = []; st.dirty = false;
    buildGrid(); refreshAll(); pick(0, 0);
    say(fromFile ? 'ໂຫຼດໜ້າກາກທີ່ບັນທຶກໄວ້' : 'ຍັງບໍ່ມີໜ້າກາກ: ສ້າງອັດຕະໂນມັດໃຫ້ແລ້ວ (ຍັງບໍ່ໄດ້ບັນທຶກ)');
    try { history.replaceState(null, '', '?k=' + sprite); } catch { /* ignore */ }
  }

  // ---------- drawing the view: tinted preview, or a pink overlay of the mask ----------
  function renderBox(x0, y0, bw, bh) {
    const o = st.orig.data, v = st.view.data, m = st.mask, tint = $('showTint').checked;
    for (let y = y0; y < y0 + bh; y++) for (let x = x0; x < x0 + bw; x++) { const p = y * st.w + x, i = p * 4; v[i] = o[i]; v[i + 1] = o[i + 1]; v[i + 2] = o[i + 2]; v[i + 3] = o[i + 3]; }
    if (tint) TINT.applyMask(v, m, $('color').value, { Lr: st.Lr, box: [x0, y0, bw, bh], width: st.w });
    else for (let y = y0; y < y0 + bh; y++) for (let x = x0; x < x0 + bw; x++) { const p = y * st.w + x, a = m[p] / 255 * 0.6, i = p * 4; if (a) { v[i] += (255 - v[i]) * a; v[i + 1] *= 1 - a; v[i + 2] += (255 - v[i + 2]) * a; } }
    st.viewCv.getContext('2d').putImageData(st.view, 0, 0, x0, y0, bw, bh);
  }
  function refreshAll() { st.Lr = TINT.shirtLuma(st.orig.data, st.mask); renderBox(0, 0, st.w, st.h); st.thumbs.forEach(drawThumb); drawEdit(); }
  function drawThumb(t) { const [fx, fy, fw, fh] = t.f, c = t.cv.getContext('2d'); c.clearRect(0, 0, t.cv.width, t.cv.height); c.drawImage(st.viewCv, fx, fy, fw, fh, 0, 0, t.cv.width, t.cv.height); }
  function buildGrid() {
    grid.innerHTML = ''; st.thumbs = [];
    const names = ['ຍ່າງ (ໜ້າ)', 'ຍ່າງ (ຫຼັງ)', 'ນັ່ງ / ກິດຈະກຳ', 'ກິດຈະກຳ'];
    rowsOf().forEach((row, ri) => {
      grid.insertAdjacentHTML('beforeend', `<p class="rowTitle">ແຖວ ${ri}: ${names[ri] || 'ກິດຈະກຳ'}</p>`);
      const box = document.createElement('div'); box.className = 'frames'; grid.appendChild(box);
      row.forEach((f, fi) => { const cv = document.createElement('canvas'), s = 110 / f[3]; cv.width = Math.round(f[2] * s); cv.height = 110; cv.title = `ແຖວ ${ri} ເຟຣມ ${fi}`; cv.onclick = () => pick(ri, fi); box.appendChild(cv); st.thumbs.push({ ri, fi, f, cv }); });
    });
  }

  // ---------- the big editor ----------
  function pick(ri, fi) {
    st.frame = { ri, fi, f: rowsOf()[ri][fi] };
    st.thumbs.forEach(t => t.cv.classList.toggle('on', t.ri === ri && t.fi === fi));
    const [, , fw, fh] = st.frame.f, s = 4; edit.width = fw * s; edit.height = fh * s; drawEdit();
  }
  function drawEdit() {
    if (!st.frame) return; const [fx, fy, fw, fh] = st.frame.f;
    eg.imageSmoothingEnabled = false; eg.clearRect(0, 0, edit.width, edit.height); eg.drawImage(st.viewCv, fx, fy, fw, fh, 0, 0, edit.width, edit.height);
  }
  const thumbOf = () => st.thumbs.find(t => t.ri === st.frame.ri && t.fi === st.frame.fi);
  function refreshFrame() { const [fx, fy, fw, fh] = st.frame.f; renderBox(fx, fy, fw, fh); drawThumb(thumbOf()); drawEdit(); }
  function snapshot() { const [fx, fy, fw, fh] = st.frame.f, copy = new Uint8Array(fw * fh); for (let y = 0; y < fh; y++) copy.set(st.mask.subarray((fy + y) * st.w + fx, (fy + y) * st.w + fx + fw), y * fw); st.undo.push({ frame: st.frame, copy }); if (st.undo.length > 40) st.undo.shift(); }
  function paintAt(px, py, add) {
    const [fx, fy, fw, fh] = st.frame.f, r = Number($('size').value) || 6, o = st.orig.data;
    for (let y = Math.max(0, py - r); y <= Math.min(fh - 1, py + r); y++) for (let x = Math.max(0, px - r); x <= Math.min(fw - 1, px + r); x++) {
      if ((x - px) ** 2 + (y - py) ** 2 > r * r) continue;
      const p = (fy + y) * st.w + fx + x;
      st.mask[p] = add ? (o[p * 4 + 3] > 8 ? 255 : 0) : 0; // only paint on the drawing, never on empty background
    }
  }
  let mode = 'add', drawing = false, erasing = false;
  const setMode = m => { mode = m; $('mAdd').setAttribute('aria-pressed', String(m === 'add')); $('mErase').setAttribute('aria-pressed', String(m === 'erase')); };
  $('mAdd').onclick = () => setMode('add'); $('mErase').onclick = () => setMode('erase');
  const at = e => { const r = edit.getBoundingClientRect(); return [Math.floor((e.clientX - r.left) / r.width * st.frame.f[2]), Math.floor((e.clientY - r.top) / r.height * st.frame.f[3])]; };
  edit.addEventListener('pointerdown', e => { if (!st.frame) return; edit.setPointerCapture(e.pointerId); drawing = true; erasing = mode === 'erase' || e.shiftKey; snapshot(); paintAt(...at(e), !erasing); refreshFrame(); st.dirty = true; });
  edit.addEventListener('pointermove', e => { if (!drawing) return; paintAt(...at(e), !erasing); refreshFrame(); });
  const stop = () => { if (!drawing) return; drawing = false; st.Lr = TINT.shirtLuma(st.orig.data, st.mask); };
  edit.addEventListener('pointerup', stop); edit.addEventListener('pointercancel', stop);
  $('undo').onclick = () => { const u = st.undo.pop(); if (!u) return; const [fx, fy, fw, fh] = u.frame.f; for (let y = 0; y < fh; y++) st.mask.set(u.copy.subarray(y * fw, y * fw + fw), (fy + y) * st.w + fx); if (st.frame !== u.frame) pick(u.frame.ri, u.frame.fi); refreshFrame(); };
  function frameAuto(ri, fi) {
    const f = rowsOf()[ri][fi], [fx, fy, fw, fh] = f, m = TINT.autoMask(st.orig.data, st.w, rowsOf(), st.sprite, [ri, fi]);
    for (let y = fy; y < fy + fh; y++) st.mask.set(m.subarray(y * st.w + fx, y * st.w + fx + fw), y * st.w + fx);
  }
  $('frameAuto').onclick = () => { snapshot(); frameAuto(st.frame.ri, st.frame.fi); refreshFrame(); st.dirty = true; };
  $('frameClear').onclick = () => { snapshot(); const [fx, fy, fw, fh] = st.frame.f; for (let y = fy; y < fy + fh; y++) st.mask.fill(0, y * st.w + fx, y * st.w + fx + fw); refreshFrame(); st.dirty = true; };
  $('auto').onclick = () => { if (!confirm('ສ້າງໜ້າກາກໃໝ່ທັງຮູບ? ການແກ້ດ້ວຍມືຈະຫາຍ')) return; st.mask = TINT.autoMask(st.orig.data, st.w, rowsOf(), st.sprite); st.undo = []; st.dirty = true; refreshAll(); say('ສ້າງໃໝ່ແລ້ວ (ຍັງບໍ່ໄດ້ບັນທຶກ)'); };
  $('color').oninput = () => refreshAll(); $('showTint').onchange = () => refreshAll();
  sel.onchange = () => open(sel.value);
  $('overview').onchange = () => document.body.classList.toggle('overview', $('overview').checked);

  // ---------- save ----------
  async function save() {
    TINT.solidify(st.mask, st.w); refreshAll();
    const cv = document.createElement('canvas'); cv.width = st.w; cv.height = st.h; const g = cv.getContext('2d'), im = g.createImageData(st.w, st.h);
    for (let p = 0; p < st.mask.length; p++) if (st.mask[p]) { const i = p * 4; im.data[i] = 255; im.data[i + 1] = 0; im.data[i + 2] = 255; im.data[i + 3] = st.mask[p]; }
    g.putImageData(im, 0, 0);
    say('ກຳລັງບັນທຶກ…');
    const r = await fetch(`/api/dev/shirt-mask/${st.sprite}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ png: cv.toDataURL('image/png') }) });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { say('ບັນທຶກບໍ່ໄດ້: ' + (data.error || r.status)); return false; }
    st.dirty = false; say(`ບັນທຶກແລ້ວ (${Math.round(data.bytes / 1024)} KB): reload ຫ້ອງການເພື່ອເຫັນຜົນ`); return true;
  }
  $('save').onclick = save;
  addEventListener('beforeunload', e => { if (st.dirty) e.preventDefault(); });

  // ---------- scripting helpers (fractions of the frame: [x0, y0, x1, y1]) ----------
  const frames = (ri, fi) => rowsOf().flatMap((row, r) => row.map((f, i) => [r, i, f])).filter(([r, i]) => (ri == null || ri === r || (Array.isArray(ri) && ri.includes(r))) && (fi == null || fi === i));
  function boxEach(ri, fi, box, fn) {
    for (const [, , [fx, fy, fw, fh]] of frames(ri, fi)) {
      const [a, b, c, d] = box;
      for (let y = Math.round(fy + b * fh); y < Math.round(fy + d * fh); y++) for (let x = Math.round(fx + a * fw); x < Math.round(fx + c * fw); x++) fn(y * st.w + x);
    }
  }
  window.ME = {
    st, open, save, refreshAll, pick, frameAuto,
    /** clear the mask inside a box on the chosen rows/frames (null = all) */
    erase(ri, fi, box) { boxEach(ri, fi, box, p => { st.mask[p] = 0; }); st.dirty = true; },
    /** clear mask pixels in a box whose colour passes test(r, g, b, luma) */
    eraseIf(ri, fi, box, test) { const o = st.orig.data; boxEach(ri, fi, box, p => { const i = p * 4; if (st.mask[p] && test(o[i], o[i + 1], o[i + 2], 0.299 * o[i] + 0.587 * o[i + 1] + 0.114 * o[i + 2])) st.mask[p] = 0; }); st.dirty = true; },
    /** add drawing pixels in a box whose colour passes test(r, g, b, luma) */
    addIf(ri, fi, box, test) { const o = st.orig.data; boxEach(ri, fi, box, p => { const i = p * 4; if (o[i + 3] > 8 && test(o[i], o[i + 1], o[i + 2], 0.299 * o[i] + 0.587 * o[i + 1] + 0.114 * o[i + 2])) st.mask[p] = 255; }); st.dirty = true; },
    /** morphological closing inside a box: fills gaps narrower than about 2*r px between masked parts (for see-through
     *  cut-outs in a shirt); returns how many pixels were added */
    close(ri, fi, box, r = 4) {
      let added = 0;
      for (const [, , [fx, fy, fw, fh]] of frames(ri, fi)) {
        const [a, b, c, d] = box, x0 = Math.round(a * fw), x1 = Math.round(c * fw), y0 = Math.round(b * fh), y1 = Math.round(d * fh);
        const at = (x, y) => st.mask[(fy + y) * st.w + fx + x] > 128;
        const dil = new Uint8Array(fw * fh);
        for (let y = Math.max(0, y0 - r); y < Math.min(fh, y1 + r); y++) for (let x = Math.max(0, x0 - r); x < Math.min(fw, x1 + r); x++) {
          let hit = false; for (let dy = -r; dy <= r && !hit; dy++) for (let dx = -r; dx <= r; dx++) { const xx = x + dx, yy = y + dy; if (dx * dx + dy * dy <= r * r && xx >= 0 && yy >= 0 && xx < fw && yy < fh && at(xx, yy)) { hit = true; break; } }
          if (hit) dil[y * fw + x] = 1;
        }
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
          if (at(x, y) || !dil[y * fw + x]) continue;
          let keep = true; for (let dy = -r; dy <= r && keep; dy++) for (let dx = -r; dx <= r; dx++) { const xx = x + dx, yy = y + dy; if (dx * dx + dy * dy <= r * r && (xx < 0 || yy < 0 || xx >= fw || yy >= fh || !dil[yy * fw + xx])) { keep = false; break; } }
          if (keep) { st.mask[(fy + y) * st.w + fx + x] = 255; added++; }
        }
      }
      st.dirty = true; return added;
    },
    frames: () => rowsOf().map(r => r.length),
  };
  open(new URLSearchParams(location.search).get('k') || sel.value);
})();

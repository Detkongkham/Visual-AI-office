// 2D office engine: draws rooms and people; people follow live state from the server (window.OFFICE)
(async function () {
  try { await document.fonts.load('700 20px "Noto Sans Lao"'); } catch (e) {}
  const cv = document.getElementById('cv'), g = cv.getContext('2d');
  let W = 0, H = 0, DPR = 1;
  const cam = { u: 20, ox: 0, oy: 0 };
  const P = (x, z, h = 0) => [cam.ox + (x - z) * cam.u, cam.oy + (x + z) * cam.u * 0.5 - h * cam.u * 1.15];

  // ---------- layout: equal room tiles with corridors between ----------
  const SI = 5, S = 8, G = 2.4, M = 1.4; // SI = area covered by the Gemini room picture, S = full room after extension
  // 5 x 3 tiles: the developer wing uses three Dev Workspace rooms side by side
  const ROOMS = [
    { id: 'ceo', img: 'ceo', name: 'ຫ້ອງ CEO', ico: '👔', i: 0, j: 0 },
    { id: 'ba', img: 'ba', name: 'BA Studio', ico: '🧱', i: 1, j: 0 },
    { id: 'core', img: 'core', name: 'AI Core Hall', ico: '🧠', i: 2, j: 0 },
    { id: 'meet', img: 'meet', name: 'Garden Meeting', ico: '🌳', i: 3, j: 0 },
    { id: 'dev', img: 'dev', name: 'Dev Workspace A', ico: '💻', i: 0, j: 1 },
    { id: 'devB', img: 'dev', name: 'Dev Workspace B', ico: '💻', i: 1, j: 1 },
    { id: 'devC', img: 'dev', name: 'Dev Workspace C', ico: '💻', i: 2, j: 1 },
    { id: 'lab', img: 'lab', name: 'AI Lab', ico: '🤖', i: 3, j: 1 },
    { id: 'qa', img: 'qa', name: 'QA Lab', ico: '🐞', i: 4, j: 1 },
    { id: 'cafe', img: 'cafe', name: 'Café', ico: '☕', i: 0, j: 2 },
    { id: 'lounge', img: 'lounge', name: 'Lounge', ico: '🛋️', i: 1, j: 2 },
    { id: 'ops', img: 'ops', name: 'DevOps Control', ico: '🚀', i: 2, j: 2 },
    { id: 'future', img: 'future', name: 'ພື້ນທີ່ຂະຫຍາຍ 1', ico: '➕', i: 3, j: 2 },
    { id: 'future2', img: 'future', name: 'ພື້ນທີ່ຂະຫຍາຍ 2', ico: '➕', i: 4, j: 2 },
  ];
  ROOMS.forEach(r => { r.x0 = r.i * (S + G); r.z0 = r.j * (S + G); r.x1 = r.x0 + S; r.z1 = r.z0 + S; });
  const RID = Object.fromEntries(ROOMS.map(r => [r.id, r]));
  const X0 = -M, Z0 = -M, X1 = 5 * S + 4 * G + M, Z1 = 3 * S + 2 * G + M;
  const PLAZA = { x0: 4 * (S + G), z0: 0 };

  // image pixel (original Gemini px) inside a room -> world point
  function roomPt(id, px, py) {
    const R = ROOMIMG[RID[id].img], k = R.k, x = px * k, y = py * k;
    const B = R.B, Rr = R.R, L = R.L;
    const ax = Rr[0] - B[0], ay = Rr[1] - B[1], bx = L[0] - B[0], by = L[1] - B[1], det = ax * by - ay * bx;
    const dx = x - B[0], dy = y - B[1];
    const lx = (dx * by - dy * bx) / det, lz = (ax * dy - ay * dx) / det;
    const r = RID[id]; return { x: r.x0 + lx * SI, z: r.z0 + lz * SI, room: id };
  }

  const RCOL = {
    ceo: { floor: '#c8814f', line: '#b06d40', wall: '#f4e2cf', trim: '#f2c94c', h: 2.6 },
    ba: { floor: '#c98a52', line: '#b17644', wall: '#b65a43', wallL: '#f6e2de', trim: '#f2a3a8', h: 2.6 },
    core: { floor: '#cdbdf0', line: '#b9a6e6', wall: '#f1dcd0', trim: '#e3c7bb', h: 2.8 },
    meet: { floor: '#8cc63f', line: '#7db436', wall: '#d4ecec', trim: '#5cae6e', h: 2.0 },
    lab: { floor: '#c3e5f2', line: '#a9d6e8', wall: '#e2ebf3', trim: '#9fd8e8', h: 2.0 },
    qa: { floor: '#c7c6ef', line: '#b3b1e4', wall: '#e2eaf3', trim: '#e39a4f', h: 2.0 },
    ops: { floor: '#24385d', line: '#2e4570', wall: '#5d97c4', trim: '#4fc3d9', h: 2.0 },
    cafe: { floor: '#f3dbb2', line: '#e6c99b', wall: '#f3e3cc', trim: '#7a5640', h: 2.0 },
    lounge: { floor: '#8fcbbf', line: '#7dbbb0', wall: '#f3e3cc', trim: '#7a5640', h: 2.0 },
    future: { floor: '#ece8f7', line: '#ddd7ef', wall: '#ece9f6', trim: '#8a6a50', h: 2.0 },
    dev: { floor: '#e2a865', line: '#cf9555', wall: '#f3e3cc', trim: '#c79a6a', h: 2.0 },
  };
  Object.values(RCOL).forEach(c => { c.edge = '#8f7cb0'; c.edge2 = '#7d6a9e'; });
  // ---------- images ----------
  const loadImg = src => new Promise(res => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(im); im.src = src; });
  const RIM = {}, PIM = {}, IMG = {};
  await Promise.all([
    ...Object.keys(ROOMIMG).map(async k => RIM[k] = await loadImg(ROOMIMG[k].img)),
    ...Object.keys(PROPIMG).map(async k => PIM[k] = await loadImg(PROPIMG[k].img)),
    ...Object.keys(ATLAS).map(async k => IMG[k] = await loadImg(ATLAS[k].img)),
  ]);

  // ---------- drawables ----------
  // every drawable has a footprint rect so the painter can tell what is in front
  const STATIC = [];
  ROOMS.forEach(r => STATIC.push({ kind: 'room', r, x0: r.x0, z0: r.z0, x1: r.x1, z1: r.z1, draw: () => drawRoom(r) }));
  function prop(name, x, z, scale = 1, fpx, fpz, lift = 0) { const fp = 0.35 * scale; fpx = fpx || fp; fpz = fpz || fp; const fp2 = fpx; STATIC.push({ kind: 'prop', x0: x - fpx, z0: z - fpz, x1: x + fpx, z1: z + fpz, draw: () => drawProp(name, x, z, scale, lift) }); BLOCK.push([x - fpx, z - fpz, x + fpx, z + fpz]); }
  const BLOCK = [];
  // corridor decoration
  const cx = i => i * (S + G) - G / 2, cz = j => j * (S + G) - G / 2;
  [[1, 1], [2, 1], [3, 1], [4, 1], [1, 2], [2, 2], [3, 2], [4, 2]].forEach(([i, j], n) => prop(n % 2 ? 'monstera' : 'lamp', cx(i) + 0.0, cz(j) + 0.0, n % 2 ? 0.9 : 0.9));
  [[cx(1), -0.8], [cx(2), -0.8], [cx(3), -0.8], [cx(4), -0.8], [-0.8, cz(1)], [-0.8, cz(2)]].forEach(([x, z]) => prop('monstera', x, z, 0.8));
  // plaza in the empty tile: trees + tree house
  prop('tree', PLAZA.x0 + 1.6, PLAZA.z0 + 1.4, 1.2); prop('treehouse', PLAZA.x0 + 6.0, PLAZA.z0 + 1.6, 1.1); prop('tree', PLAZA.x0 + 1.5, PLAZA.z0 + 6.2, 1.1); prop('tree', PLAZA.x0 + 6.4, PLAZA.z0 + 6.4, 1.0); prop('monstera', PLAZA.x0 + 4.0, PLAZA.z0 + 6.8, 0.9); prop('lamp', PLAZA.x0 + 4.2, PLAZA.z0 + 3.6, 0.9);
  // furniture in each room's new floor space (local coords inside the room; picture covers 0..5)
  const EXTRA_SEATS = [];
  // [name, lx, lz, seatKind, scale, lift]; picture covers local 0..5, the new space is x 5..8 or z 5..8
  const D = (x, z, kind = 'seat', n = 'desk2') => [[n, x, z, kind], ['chair', x + 0.85, z + 0.15]];
  const EXT = {
    dev: [...D(6.1, 1.5), ...D(6.1, 3.6), ...D(6.1, 5.7), ...D(1.4, 6.3), ...D(3.5, 6.3), ['kanban', 7.3, 0.25, null, 1, 0.9], ['monstera', 7.6, 7.6], ['lamp', 0.5, 7.6]],
    future: [['ghost', 6.3, 1.5, 'open'], ['ghost', 6.3, 3.7, 'open'], ['ghost', 6.3, 5.9, 'open'], ['ghost', 1.6, 6.4, 'open'], ['ghost', 3.8, 6.4, 'open'], ['whiteboard', 7.4, 7.4], ['monstera', 0.5, 7.6]],
    ceo: [['shelf', 6.4, 0.45], ['execdesk', 6.3, 3.0], ['leather', 7.2, 3.1], ['chartscreen', 7.5, 0.25, null, 1, 0.9], ['monstera', 7.6, 7.5], ['lamp', 0.5, 7.6], ['sofaPurple', 2.6, 6.1], ['coffeeTable', 2.8, 7.2], ['leather', 4.3, 6.9]],
    ba: [['table', 6.4, 3.0], ['chair', 5.7, 4.2], ['chair', 6.6, 4.4], ['chair', 7.4, 4.0], ['whiteboard', 6.6, 6.6], ['kanban', 7.5, 0.25, null, 1, 0.9], ['monstera', 0.5, 7.6], ['monstera', 7.6, 7.6]],
    core: [['robot', 6.5, 2.2], ['holotable', 2.8, 6.5], ['chartscreen', 7.4, 0.25, null, 1, 1.0], ['monstera', 7.6, 7.6], ['monstera', 0.5, 7.6], ['lamp', 6.6, 5.6]],
    meet: [['tree', 6.6, 1.8, null, 1.0], ['tree', 2.2, 6.7, null, 0.9], ['tree', 7.0, 6.8, null, 0.85], ['holotable', 6.3, 4.4], ['chair', 5.6, 5.2], ['chair', 7.1, 5.3]],
    lab: [...D(6.1, 1.8, 'seat', 'desk3'), ...D(1.6, 6.3, 'seat', 'desk3'), ['robot', 6.6, 5.4], ['holoChart', 5.9, 4.0], ['holoCode', 4.0, 6.7], ['chartscreen', 7.4, 0.25, null, 1, 0.9], ['monstera', 7.6, 7.6]],
    qa: [...D(6.1, 1.8), ['holoCheck', 5.9, 4.3], ['holoBug', 7.0, 4.6], ['holoBars', 7.2, 6.0], ['pad', 2.4, 6.6], ['holoCode', 4.1, 6.5], ['kanban', 7.4, 0.25, null, 1, 0.9], ['monstera', 7.6, 7.6], ['monstera', 0.5, 7.6]],
    ops: [['server', 5.8, 0.7], ['server', 6.7, 0.7], ['server', 7.6, 0.7], ...D(6.1, 3.2, 'seat', 'desk3'), ['holotable', 2.6, 6.5], ['holoChart', 6.2, 5.6], ['monstera', 7.6, 7.6]],
    cafe: [['fridge', 6.3, 0.55], ['counter', 7.1, 2.4], ['cafeSet', 5.9, 4.6], ['cafeSet', 7.0, 6.4], ['cafeSet', 1.7, 6.5], ['cafeSet', 3.9, 6.6], ['monstera', 7.6, 7.6], ['monstera', 0.5, 7.6], ['lamp', 5.6, 7.5]],
    lounge: [['sofaTeal', 6.3, 2.0], ['coffeeTable', 6.4, 3.4], ['beanPink', 5.8, 4.7], ['beanYellow', 7.1, 4.9], ['sofaPurple', 2.6, 6.2], ['beanPink', 4.3, 7.1], ['lamp', 7.3, 0.8], ['monstera', 7.6, 7.4], ['shelf', 5.6, 0.45]],
  };
  const RUGS = { ceo: [[2.9, 6.7, 1.0]], lounge: [[6.5, 3.6, 1.25], [3.0, 6.7, 0.9]], meet: [[6.3, 4.6, 1.0]] };
  const FOOT = { sofaTeal: [1.1, 0.42], sofaPurple: [0.9, 0.4], coffeeTable: [0.5, 0.5], beanPink: [0.4, 0.4], beanYellow: [0.4, 0.4], counter: [0.4, 1.1], fridge: [0.4, 0.35], cafeSet: [0.7, 0.6], holoCheck: [0.3, 0.3], holoBug: [0.3, 0.3], holoBars: [0.3, 0.3], holoCode: [0.3, 0.3], holoChart: [0.3, 0.3], pad: [0.55, 0.55], desk2: [0.7, 0.42], desk3: [0.72, 0.42], execdesk: [0.75, 0.45], table: [1.2, 0.6], ghost: [0.7, 0.45], pod: [1.1, 1.1], holotable: [0.65, 0.65], whiteboard: [0.6, 0.2], chartscreen: [0.5, 0.1], kanban: [0.5, 0.1], server: [0.32, 0.32], chair: [0.25, 0.25], leather: [0.28, 0.28], shelf: [0.6, 0.2], robot: [0.4, 0.4] };
  const RUGS_BY_ID = {};
  ROOMS.forEach(r => { if (RUGS[r.img]) RUGS_BY_ID[r.id] = RUGS[r.img].map(([x, z, sc]) => [r.x0 + x, r.z0 + z, sc]); });
  Object.keys(RUGS).forEach(k => delete RUGS[k]); Object.assign(RUGS, RUGS_BY_ID);
  ROOMS.forEach(r => (EXT[r.img] || []).forEach(([name, lx, lz, kind, sc, lift]) => {
    const x = r.x0 + lx, z = r.z0 + lz, f = FOOT[name];
    prop(name, x, z, sc || 1, f ? f[0] : null, f ? f[1] : null, lift || 0);
    if (kind) EXTRA_SEATS.push({ k: 'x' + r.id + lx + lz, used: false });
  }));

  function affineDraw(im, srcPts, dstPts) {
    // map three source pixel points to three screen points
    const [[x0, y0], [x1, y1], [x2, y2]] = srcPts, [[u0, v0], [u1, v1], [u2, v2]] = dstPts;
    const det = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    const a = ((u1 - u0) * (y2 - y0) - (u2 - u0) * (y1 - y0)) / det, c = ((u2 - u0) * (x1 - x0) - (u1 - u0) * (x2 - x0)) / det;
    const b = ((v1 - v0) * (y2 - y0) - (v2 - v0) * (y1 - y0)) / det, d = ((v2 - v0) * (x1 - x0) - (v1 - v0) * (x2 - x0)) / det;
    const e = u0 - a * x0 - c * y0, f = v0 - b * x0 - d * y0;
    g.save(); g.setTransform(DPR * a, DPR * b, DPR * c, DPR * d, DPR * e, DPR * f); g.drawImage(im, 0, 0); g.restore();
  }
  function drawRoom(r) {
    const R = ROOMIMG[r.img];
    const C = RCOL[r.img], ex = r.x0 + SI, ez = r.z0 + SI, wh = C.h;
    // extension walls continue the picture's two back walls
    wallBox(ex, r.z0 - 0.14, r.x1, r.z0, wh, C.wall, C.trim);
    wallBox(r.x0 - 0.14, ez, r.x0, r.z1, wh, C.wallL || C.wall, C.trim);
    affineDraw(RIM[r.img], [R.L, R.R, R.F], [P(r.x0, ez), P(ex, r.z0), P(ex, ez)]);
    // extension floor (L-shape) drawn over the picture's front slab
    const quad = (a, b, c, d, col) => { g.fillStyle = col; g.beginPath(); [a, b, c, d].forEach((q, k) => k ? g.lineTo(...q) : g.moveTo(...q)); g.closePath(); g.fill(); };
    quad(P(ex, r.z0), P(r.x1, r.z0), P(r.x1, r.z1), P(ex, r.z1), C.floor);
    quad(P(r.x0, ez), P(ex, ez), P(ex, r.z1), P(r.x0, r.z1), C.floor);
    g.strokeStyle = C.line; g.lineWidth = Math.max(1, cam.u * 0.03);
    for (let z = r.z0 + 0.5; z < r.z1; z += 0.5) { const xs = z < ez ? ex : r.x0; g.beginPath(); g.moveTo(...P(xs, z)); g.lineTo(...P(r.x1, z)); g.stroke(); }
    (RUGS[r.id] || []).forEach(([x, z, sc]) => { const im = PIM.rug; if (!im || !im.naturalWidth) return; const w = 2.8 * sc * cam.u, h = im.naturalHeight / im.naturalWidth * w, [sx, sy] = P(x, z); g.drawImage(im, sx - w / 2, sy - h / 2, w, h); });
    // slab edges at the front
    const t = 0.22; quad(P(r.x0, r.z1), P(r.x1, r.z1), P(r.x1, r.z1, -t), P(r.x0, r.z1, -t), C.edge); quad(P(r.x1, r.z0), P(r.x1, r.z1), P(r.x1, r.z1, -t), P(r.x1, r.z0, -t), C.edge2);
  }
  function wallBox(x0, z0, x1, z1, h, col, trim) {
    const q = (pts, c) => { g.fillStyle = c; g.beginPath(); pts.forEach((pp, k) => k ? g.lineTo(...pp) : g.moveTo(...pp)); g.closePath(); g.fill(); };
    q([P(x0, z1, 0), P(x1, z1, 0), P(x1, z1, h), P(x0, z1, h)], col); q([P(x1, z0, 0), P(x1, z1, 0), P(x1, z1, h), P(x1, z0, h)], col);
    q([P(x0, z0, h), P(x1, z0, h), P(x1, z1, h), P(x0, z1, h)], trim); q([P(x0, z1, h - 0.12), P(x1, z1, h - 0.12), P(x1, z1, h), P(x0, z1, h)], trim);
  }
  function drawRoomLabel(r) {
    if (cam.u > 9) { // room name plate at the front corner
      const [sx, sy] = P(r.x1, r.z1, -0.2); const fs = Math.max(10, Math.min(15, cam.u * 0.5)); g.font = `800 ${fs}px "Noto Sans Lao", sans-serif`;
      const tw = g.measureText(r.ico + ' ' + r.name).width + fs * 1.4;
      g.fillStyle = 'rgba(42,34,56,.82)'; g.beginPath(); g.roundRect(sx - tw / 2, sy + cam.u * 0.35, tw, fs * 1.7, fs * 0.85); g.fill();
      g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(r.ico + ' ' + r.name, sx, sy + cam.u * 0.35 + fs * 0.88);
    }
  }
  function drawProp(name, x, z, s, lift = 0) {
    const im = PIM[name]; if (!im || !im.naturalWidth) return; const FW = { desk2: 2.3, desk3: 2.4, chair: 0.8, table: 3.4, ghost: 2.0, execdesk: 2.4, leather: 0.9, pod: 3.4, holotable: 2.0, whiteboard: 1.8, chartscreen: 1.7, kanban: 1.7, server: 1.05, rug: 2.8, sofaTeal: 2.5, sofaPurple: 2.0, coffeeTable: 1.3, beanPink: 1.0, beanYellow: 1.0, counter: 2.4, fridge: 1.0, cafeSet: 1.7, holoCheck: 1.0, holoBug: 1.0, holoBars: 1.0, holoCode: 1.15, holoChart: 1.0, pad: 1.3 }[name];
    let h = PROPIMG[name].h * s * cam.u * 1.15, w = im.naturalWidth / im.naturalHeight * h; if (FW) { w = FW * s * cam.u; h = im.naturalHeight / im.naturalWidth * w; }
    const [sx, sy] = P(x, z, lift); g.drawImage(im, sx - w / 2, sy - h * (FW ? 0.78 : 0.94), w, h);
  }
  function drawBase() {
    // floor slab with stone tiles
    const c = [P(X0, Z0), P(X1, Z0), P(X1, Z1), P(X0, Z1)];
    const side = (a, b, col) => { g.fillStyle = col; g.beginPath(); g.moveTo(...a); g.lineTo(...b); g.lineTo(b[0], b[1] + cam.u * 0.6); g.lineTo(a[0], a[1] + cam.u * 0.6); g.closePath(); g.fill(); };
    side(c[3], c[2], '#8f7cb0'); side(c[1], c[2], '#7d6a9e');
    g.fillStyle = '#efe6dc'; g.beginPath(); c.forEach((p, i) => i ? g.lineTo(...p) : g.moveTo(...p)); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(180,160,140,.35)'; g.lineWidth = 1;
    for (let x = Math.ceil(X0); x <= X1; x += 1) { g.beginPath(); g.moveTo(...P(x, Z0)); g.lineTo(...P(x, Z1)); g.stroke(); }
    for (let z = Math.ceil(Z0); z <= Z1; z += 1) { g.beginPath(); g.moveTo(...P(X0, z)); g.lineTo(...P(X1, z)); g.stroke(); }
    // walkway runners between rooms
    g.fillStyle = 'rgba(157,134,255,.12)';
    for (let i = 1; i < 5; i++) { const a = i * (S + G) - G + 0.5, b = i * (S + G) - 0.5; g.beginPath(); [P(a, Z0 + 0.4), P(b, Z0 + 0.4), P(b, Z1 - 0.4), P(a, Z1 - 0.4)].forEach((p, k) => k ? g.lineTo(...p) : g.moveTo(...p)); g.fill(); }
    for (let j = 1; j < 3; j++) { const a = j * (S + G) - G + 0.5, b = j * (S + G) - 0.5; g.beginPath(); [P(X0 + 0.4, a), P(X1 - 0.4, a), P(X1 - 0.4, b), P(X0 + 0.4, b)].forEach((p, k) => k ? g.lineTo(...p) : g.moveTo(...p)); g.fill(); }
    // plaza grass
    const p0 = PLAZA; g.fillStyle = '#9ad48a'; g.beginPath(); [P(p0.x0, p0.z0), P(p0.x0 + S, p0.z0), P(p0.x0 + S, p0.z0 + S), P(p0.x0, p0.z0 + S)].forEach((p, k) => k ? g.lineTo(...p) : g.moveTo(...p)); g.closePath(); g.fill();
    g.strokeStyle = '#6fb35f'; g.lineWidth = 2; g.stroke();
  }

  // ---------- seats and spots (picked on the Gemini room pictures) ----------
  const SP = {
    ceoSeat: roomPt('ceo', 450, 468), ceoStand: roomPt('ceo', 640, 560),
    baSeat1: roomPt('ba', 293, 490), baSeat2: roomPt('ba', 395, 542), baBoard: roomPt('ba', 245, 450),
    core1: roomPt('core', 430, 548), core2: roomPt('core', 560, 605),
    meet1: roomPt('meet', 470, 568), meet2: roomPt('meet', 300, 520),
    labSeat1: roomPt('lab', 290, 497), labSeat2: roomPt('lab', 545, 602), labSeat3: roomPt('lab', 520, 372), labAct: roomPt('lab', 620, 482),
    qaSeat: roomPt('qa', 555, 332), qaHolo: roomPt('qa', 475, 528),
    opsSeat1: roomPt('ops', 545, 307), opsSeat2: roomPt('ops', 725, 417),
    dev1: roomPt('dev', 295, 487), dev2: roomPt('dev', 545, 587), dev3: roomPt('dev', 765, 472), dev4: roomPt('dev', 520, 357),
    cafe1: roomPt('cafe', 600, 422), cafe2: roomPt('cafe', 380, 482),
    lounge1: roomPt('lounge', 680, 482), lounge2: roomPt('lounge', 560, 442),
    devB1: roomPt('devB', 295, 487), devB2: roomPt('devB', 545, 587), devB3: roomPt('devB', 765, 472), devB4: roomPt('devB', 520, 357),
    devC1: roomPt('devC', 295, 487), devC2: roomPt('devC', 545, 587), devC3: roomPt('devC', 765, 472), devC4: roomPt('devC', 520, 357),
    future1: roomPt('future', 475, 482), future2: roomPt('future2', 475, 482),
    plaza: { x: PLAZA.x0 + 2.4, z: PLAZA.z0 + 3.4 },
    labHolo: { x: RID.lab.x0 + 5.5, z: RID.lab.z0 + 4.7 },
  };
  // seats: occupied + open (the future room's ghost desks and empty chairs count as open seats)
  const SEATS = [
    ...['ceoSeat', 'baSeat1', 'baSeat2', 'labSeat1', 'labSeat2', 'labSeat3', 'qaSeat', 'opsSeat1', 'opsSeat2', 'dev1', 'dev2', 'dev3', 'dev4', 'devB1', 'devB2', 'devB3', 'devB4', 'devC1', 'devC2', 'devC3', 'devC4'].map(k => ({ k, used: false })),
    ...Array.from({ length: 16 }, (_, i) => ({ k: 'ghost' + i, used: false })),
    ...EXTRA_SEATS,
  ];

  // ---------- walk grid ----------
  const CS = 0.25, GW = Math.ceil((X1 - X0) / CS), GH = Math.ceil((Z1 - Z0) / CS);
  const grid = new Uint8Array(GW * GH);
  const cell = (x, z) => [Math.max(0, Math.min(GW - 1, Math.floor((x - X0) / CS))), Math.max(0, Math.min(GH - 1, Math.floor((z - Z0) / CS)))];
  const mark = (x0, z0, x1, z1, v) => { const [a, b] = cell(x0, z0), [c, d] = cell(x1 - 1e-3, z1 - 1e-3); for (let j = b; j <= d; j++) for (let i = a; i <= c; i++) grid[j * GW + i] = v; };
  ROOMS.forEach(r => { mark(r.x0 - 0.15, r.z0 - 0.15, r.x0 + SI, r.z0 + SI, 1); mark(r.x0 + SI, r.z0 - 0.2, r.x1, r.z0 + 0.2, 1); mark(r.x0 - 0.2, r.z0 + SI, r.x0 + 0.2, r.z1, 1); });
  BLOCK.forEach(([x0, z0, x1, z1]) => mark(x0, z0, x1, z1, 1));
  mark(X0, Z0, X1, Z0 + 0.3, 1); mark(X0, Z0, X0 + 0.3, Z1, 1); mark(X0, Z1 - 0.3, X1, Z1, 1); mark(X1 - 0.3, Z0, X1, Z1, 1);
  // a lane from a spot straight out through the nearest open (front) side of its room
  function lane(p) {
    const r = RID[p.room]; if (!r) { mark(p.x - 0.3, p.z - 0.3, p.x + 0.3, p.z + 0.3, 0); return; }
    const ex = r.x0 + SI, ez = r.z0 + SI; if (ex - p.x < ez - p.z) mark(p.x - 0.3, p.z - 0.3, ex + 0.4, p.z + 0.3, 0); else mark(p.x - 0.3, p.z - 0.3, p.x + 0.3, ez + 0.4, 0);
  }
  Object.values(SP).forEach(lane);
  function findPath(sx, sz, tx, tz) {
    const [si, sj] = cell(sx, sz), [ti, tj] = cell(tx, tz), N = GW * GH, start = si + sj * GW, goal = ti + tj * GW;
    const gS = new Float32Array(N).fill(1e9), from = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
    // binary heap
    const heap = []; const push = (f, n) => { heap.push([f, n]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    gS[start] = 0; push(0, start);
    while (heap.length) {
      const [, cur] = pop(); if (cur === goal) break; if (closed[cur]) continue; closed[cur] = 1;
      const ci = cur % GW, cj = (cur / GW) | 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = ci + di, nj = cj + dj; if (ni < 0 || nj < 0 || ni >= GW || nj >= GH) continue; const n = ni + nj * GW;
        if (grid[n] && n !== goal) continue;
        const turn = from[cur] >= 0 && (cur - from[cur]) !== (n - cur) ? 0.6 : 0, ng = gS[cur] + 1 + turn;
        if (ng < gS[n]) { gS[n] = ng; from[n] = cur; push(ng + Math.abs(ni - ti) + Math.abs(nj - tj), n); }
      }
    }
    if (from[goal] < 0 && goal !== start) return null;
    const cells = []; for (let c = goal; c >= 0; c = from[c]) cells.push(c); cells.reverse();
    const pts = cells.map(c => ({ x: X0 + ((c % GW) + 0.5) * CS, z: Z0 + (((c / GW) | 0) + 0.5) * CS }));
    const out = [pts[0]]; for (let k = 1; k < pts.length - 1; k++) { const a = out[out.length - 1], b = pts[k], c = pts[k + 1]; if ((b.x - a.x) * (c.z - b.z) !== (b.z - a.z) * (c.x - b.x)) out.push(b); }
    out.push({ x: tx, z: tz }); return out;
  }

  // ---------- people ----------
  const PEOPLE = [
    { key: 'ceo', name: 'ເຈົ້າ', role: 'CEO · ຜູ້ອະນຸມັດ', model: 'Opus 5.5', down: ['L', 0], up: ['L', 1], sit: [2, 0, 3], act: [2, 3, 7], actStand: true, home: 'ceoSeat', spot: ['core1', 'ອະນຸມັດວຽກທີ່ AI Core'] },
    { key: 'manee', name: 'ມະນີ', role: 'Business Analyst', model: 'Opus 5.5', down: ['L', 0], up: ['L', 1], sit: [2, 0, 4], act: [2, 4, 8], actStand: true, home: 'baSeat1', spot: ['baBoard', 'ນຳສະເໜີ requirement ທີ່ກະດານ'] },
    { key: 'somphone', name: 'ສົມພອນ', role: 'Tech Lead', model: 'Opus 5.5', down: ['L', 0], up: ['L', 1], sit: [2, 0, 4], act: [2, 4, 8], actStand: true, home: 'labSeat1', spot: ['labAct', 'ອະທິບາຍ architecture'] },
    { key: 'dao', name: 'ດາວ', role: 'Frontend Developer', model: 'Sonnet 5.5', down: ['R', 0], up: ['L', 1], sit: [2, 0, 3], act: [2, 3, 4], actStand: true, home: 'dev1', spot: ['core2', 'ກວດໜ້າ UI ໃນ hologram'] },
    { key: 'bounmy', name: 'ບຸນມີ', role: 'Backend Developer', model: 'Sonnet 5.5', down: ['R', 0], up: ['L', 1], sit: [2, 0, 4], act: [2, 4, 7], actStand: false, home: 'dev2', spot: null },
    { key: 'keo', name: 'ແກ້ວ', role: 'Code Reviewer', model: 'Opus 5.5', down: ['L', 0], up: null, sit: [2, 0, 4], act: [2, 4, 8], actStand: true, home: 'devB1', spot: ['cafe2', 'ອ່ານ code ພ້ອມກາເຟ'] },
    { key: 'noy', name: 'ນ້ອຍ', role: 'UI/UX Designer', model: 'Sonnet 5.5', down: ['L', 0], up: ['L', 1], sit: [2, 0, 4], act: [2, 4, 8], actStand: false, home: 'devB2', spot: null },
    { key: 'phone', name: 'ພອນ', role: 'Mobile Developer', model: 'Sonnet 5.5', down: ['L', 0], up: null, sit: [2, 0, 4], act: [2, 4, 8], actStand: true, home: 'devC1', spot: ['lounge2', 'ທົດສອບແອັບໃນມືຖື'] },
    { key: 'toy', name: 'ຕ້ອຍ', role: 'QA Engineer', model: 'Sonnet 5.5', down: ['L', 0], up: ['L', 1], sit: [2, 0, 4], act: [3, 0, 4], actStand: true, home: 'qaSeat', spot: ['qaHolo', 'ກວດຜົນເທສໃນ hologram'] },
    { key: 'kham', name: 'ຄຳ', role: 'DevOps Engineer', model: 'Haiku 5.5', down: ['L', 0], up: ['L', 1], sit: [2, 0, 3], act: [2, 3, 6], actStand: false, home: 'opsSeat1', spot: null },
    { key: 'sy', name: 'ສີ', role: 'Security Engineer', model: 'Sonnet 5.5', down: ['L', 0], up: ['L', 1], sit: [2, 0, 4], act: [2, 4, 8], actStand: false, home: 'opsSeat2', spot: null },
    { key: 'saeng', name: 'ແສງ', role: 'Product Manager', model: 'Opus 5.5', down: ['R', 0], up: null, sit: [2, 0, 3], act: [2, 3, 6], actStand: true, home: 'baSeat2', spot: ['meet1', 'ນຳປະຊຸມ planning ໃນສວນ'] },
  ];
  PEOPLE.push(
    { key: 'vanh', name: 'ວັນ', role: 'AI / Data Engineer', model: 'Opus 5.5', down: ['L', 0], up: ['R', 1], sit: [2, 0, 4], act: [3, 0, 5], actStand: true, home: 'labSeat3', spot: ['labHolo', 'ວິເຄາະ neural network ໃນ hologram'] },
    { key: 'thong', name: 'ທອງ', role: 'Technical Writer', model: 'Haiku 5.5', down: ['L', 0], up: ['R', 1], sit: [2, 0, 4], act: [3, 0, 5], actStand: true, home: 'devC2', spot: ['lounge1', 'ຂຽນເອກະສານໃນ Lounge'] },
    { key: 'chanh', name: 'ຈັນ', role: 'Scrum Master', model: 'Sonnet 5.5', down: ['L', 0], up: ['R', 1], sit: [2, 0, 4], act: [3, 0, 5], actStand: true, home: 'devC3', spot: ['meet2', 'ນຳ stand-up meeting ໃນສວນ'] },
  );
  const STATUS = { work: '#ffc93c', review: '#ff8a3d', idle: '#b8b2c4', done: '#3ddc84' };
  const ERRANDS = [['cafe1', 'ໄປເອົາກາເຟ', 'idle'], ['core1', 'ສົ່ງວຽກໃຫ້ AI Core', 'review'], ['meet2', 'ປະຊຸມໃນສວນ', 'work'], ['lounge1', 'ພັກຜ່ອນໃນ Lounge', 'idle'], ['plaza', 'ຍ່າງຮັບລົມໃນສວນ', 'idle'], ['future1', 'ກະກຽມບ່ອນນັ່ງໃຫ້ທີມໃໝ່', 'work'], ['future2', 'ກວດພື້ນທີ່ຂະຫຍາຍ', 'idle']];
  const rnd = (a, b) => a + Math.random() * (b - a);
  PEOPLE.forEach((p, i) => {
    const h = SP[p.home]; SEATS.find(s => s.k === p.home).used = true;
    Object.assign(p, { x: h.x, z: h.z, state: 'sit', timer: rnd(4, 14) + i * 0.6, path: null, pi: 0, frameT: Math.random() * 5, dir: 'down', hface: 'R', status: 'idle', doing: 'ລໍຖ້າວຽກ', hit: null, forced: null, bubble: '' });
  });
  const used = SEATS.filter(s => s.used).length;
  document.getElementById('capAll').textContent = SEATS.length; document.getElementById('capUsed').textContent = used; document.getElementById('capFree').textContent = SEATS.length - used;

  function goTo(p, x, z, then) { const path = findPath(p.x, p.z, x, z); if (!path) { then(); return; } p.path = path; p.pi = 1; p.state = 'walk'; p.after = then; }
  const occupied = new Set();
  function think(p) {
    if (p.forced) { // real work from the server: stay at the desk
      const h = SP[p.home];
      if (Math.hypot(p.x - h.x, p.z - h.z) > 0.3) { if (p.target) occupied.delete(p.target); goTo(p, h.x, h.z, () => { p.state = 'sit'; p.timer = 0.5; }); return; }
      p.x = h.x; p.z = h.z;
      p.state = p.forced === 'wait' ? (p.actStand ? 'actStand' : 'actSit') : (p.forced === 'cheer' ? (p.actStand ? 'actStand' : 'actSit') : 'sit');
      if (p.forced === 'cheer') { p.forced = null; p.timer = 4; } else p.timer = 1.2;
      return;
    }
    if (p.state === 'sit') {
      if (!p.actStand && Math.random() < 0.5) { p.state = 'actSit'; p.timer = rnd(3, 5); p.doing = 'ພັກຢູ່ໂຕະ'; p.status = 'idle'; return; }
      let target, say, st, act = false;
      if (p.spot && Math.random() < 0.55) { [target, say] = p.spot; st = 'work'; act = true; }
      else { const e = ERRANDS[Math.floor(Math.random() * ERRANDS.length)]; [target, say, st] = e; }
      if (occupied.has(target) && !act) { p.timer = rnd(3, 6); return; }
      occupied.add(target); p.target = target;
      const t = SP[target], jx = act ? 0 : rnd(-0.25, 0.25), jz = act ? 0 : rnd(-0.25, 0.25);
      p.doing = 'ກຳລັງຍ່າງ: ' + say; p.status = st;
      goTo(p, t.x + jx, t.z + jz, () => { p.state = act ? 'actStand' : 'stand'; p.timer = rnd(3.5, 6); p.doing = say; });
      return;
    }
    if (p.state === 'actSit') { p.state = 'sit'; p.timer = rnd(8, 16); p.doing = 'ລໍຖ້າວຽກ'; p.status = 'idle'; return; }
    if (p.state === 'stand' || p.state === 'actStand') { occupied.delete(p.target); p.doing = 'ກັບໄປໂຕະ'; const h = SP[p.home]; goTo(p, h.x, h.z, () => { p.state = 'sit'; p.timer = rnd(8, 18); p.doing = 'ລໍຖ້າວຽກ'; p.status = 'idle'; }); }
  }
  function step(p, dt) {
    p.frameT += dt;
    if (p.state === 'walk') {
      const t = p.path[p.pi], dx = t.x - p.x, dz = t.z - p.z, d = Math.hypot(dx, dz), sp = 1.25 * dt;
      if (d > 0.001) { if (Math.abs(dx) >= Math.abs(dz)) { p.dir = dx > 0 ? 'down' : 'up'; p.hface = dx > 0 ? 'R' : 'L'; } else { p.dir = dz > 0 ? 'down' : 'up'; p.hface = dz > 0 ? 'L' : 'R'; } }
      if (d <= sp) { p.x = t.x; p.z = t.z; p.pi++; if (p.pi >= p.path.length) { p.path = null; p.state = 'idle'; p.after && p.after(); } }
      else { p.x += dx / d * sp; p.z += dz / d * sp; }
      return;
    }
    p.timer -= dt; if (p.timer <= 0) think(p);
  }
  function framesOf(p) {
    const rows = ATLAS[p.key].rows, slice = ([r, a, b]) => (rows[r] || rows[0]).slice(a, b);
    if (p.state === 'sit') return { list: slice(p.sit), fps: 3.5, face: null };
    if (p.state === 'actSit' || p.state === 'actStand') { const l = slice(p.act); return { list: l.length ? l : slice(p.sit), fps: 3, face: null }; }
    const spec = p.dir === 'up' ? (p.up || p.down) : p.down, list = rows[spec[1]];
    if (p.state === 'stand' || p.state === 'idle') return { list: [list[0]], fps: 1, face: spec[0] };
    return { list, fps: 9, face: spec[0] };
  }
  const CH = 2.0; // character height in world metres-ish (screen = CH * u * 1.15)
  function drawPerson(p) {
    const im = IMG[p.key]; if (!im || !im.naturalWidth) return;
    const { list, fps, face } = framesOf(p); const f = list[Math.floor(p.frameT * fps) % list.length]; if (!f) return;
    const k = (cam.u * CH * 1.15) / ATLAS[p.key].walkH, w = f[2] * k, h = f[3] * k, [sx, sy] = P(p.x, p.z);
    g.fillStyle = 'rgba(40,30,70,.22)'; g.beginPath(); g.ellipse(sx, sy, cam.u * 0.36, cam.u * 0.17, 0, 0, 7); g.fill();
    g.save(); g.translate(sx, sy + cam.u * 0.04); if (face && face !== p.hface) g.scale(-1, 1); g.drawImage(im, f[0], f[1], f[2], f[3], -w / 2, -h, w, h); g.restore();
    p.hit = [sx - w / 2, sy - h, w, h];
  }
  function drawPersonLabel(p) {
    const [sx, sy] = P(p.x, p.z);
    if (p.bubble && cam.u > 14) {
      const bs = Math.max(10, Math.min(14, cam.u * 0.36)); g.font = `600 ${bs}px "Noto Sans Lao", sans-serif`;
      const txt = p.bubble.length > 34 ? p.bubble.slice(0, 33) + '…' : p.bubble, bw = g.measureText(txt).width + bs * 1.4, by = sy - cam.u * CH * 1.2 - bs * 3.3;
      g.fillStyle = p.forced === 'wait' ? '#fff3e0' : '#ffffff'; g.strokeStyle = p.forced === 'wait' ? '#ff8a3d' : '#6a4fd8'; g.lineWidth = 2;
      g.beginPath(); g.roundRect(sx - bw / 2, by - bs, bw, bs * 2, bs * 0.6); g.fill(); g.stroke();
      g.beginPath(); g.moveTo(sx - 5, by + bs); g.lineTo(sx, by + bs + 6); g.lineTo(sx + 5, by + bs); g.fill();
      g.fillStyle = '#2a2238'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(txt, sx, by + 1);
    }
    const fs = Math.max(9, Math.min(15, cam.u * 0.42)); g.font = `700 ${fs}px "Noto Sans Lao", sans-serif`;
    const tw = g.measureText(p.name).width + fs * 1.6, ly = sy - cam.u * CH * 1.2 - fs * 0.9;
    g.fillStyle = p === selected ? '#6a4fd8' : 'rgba(255,255,255,.95)'; g.strokeStyle = '#2a2238'; g.lineWidth = 1.5;
    g.beginPath(); g.roundRect(sx - tw / 2, ly - fs * 0.8, tw, fs * 1.6, fs * 0.8); g.fill(); g.stroke();
    g.fillStyle = STATUS[p.status]; g.beginPath(); g.arc(sx - tw / 2 + fs * 0.75, ly, fs * 0.32, 0, 7); g.fill(); g.strokeStyle = 'rgba(42,34,56,.6)'; g.lineWidth = 1; g.stroke();
    g.fillStyle = p === selected ? '#fff' : '#2a2238'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(p.name, sx + fs * 0.35, ly + 1);
  }

  // ---------- painter ordering with footprints ----------
  function behind(a, b) { // is a drawn before b?
    if (a.x1 <= b.x0 + 1e-6 || a.z1 <= b.z0 + 1e-6) return true;
    if (b.x1 <= a.x0 + 1e-6 || b.z1 <= a.z0 + 1e-6) return false;
    if (a.kind === 'room' && b.kind !== 'room') return true;
    if (b.kind === 'room' && a.kind !== 'room') return false;
    return (a.x0 + a.x1 + a.z0 + a.z1) < (b.x0 + b.x1 + b.z0 + b.z1);
  }
  function order(items) {
    const n = items.length, indeg = new Array(n).fill(0), adj = items.map(() => []);
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { if (behind(items[i], items[j])) { adj[i].push(j); indeg[j]++; } else { adj[j].push(i); indeg[i]++; } }
    const out = [], q = []; indeg.forEach((d, i) => { if (!d) q.push(i); });
    while (q.length) { q.sort((a, b) => (items[a].x0 + items[a].z0) - (items[b].x0 + items[b].z0)); const i = q.shift(); out.push(items[i]); adj[i].forEach(j => { if (--indeg[j] === 0) q.push(j); }); }
    if (out.length < n) items.forEach(it => { if (!out.includes(it)) out.push(it); });
    return out;
  }

  // ---------- camera + input ----------
  function fit() {
    const pw = W > 760 ? 320 : 0, ph = W > 760 ? 0 : H * 0.36, aw = W - pw - 32, ah = H - ph - 40;
    cam.u = Math.min(aw / ((X1 - X0) + (Z1 - Z0)), ah / (((X1 - X0) + (Z1 - Z0)) * 0.5 + 4.5));
    cam.ox = 0; cam.oy = 0; const [sx, sy] = P((X0 + X1) / 2, (Z0 + Z1) / 2, 1.6); cam.ox = 16 + aw / 2 - sx; cam.oy = (W > 760 ? 34 : 20) + ah / 2 - sy;
  }
  function resize() { DPR = Math.min(devicePixelRatio || 1, 2); W = cv.clientWidth; H = cv.clientHeight; cv.width = W * DPR; cv.height = H * DPR; fit(); }
  addEventListener('resize', resize); resize();
  function zoomAt(f, mx, my) { const nu = Math.max(6, Math.min(160, cam.u * f)), k = nu / cam.u; cam.ox = mx - (mx - cam.ox) * k; cam.oy = my - (my - cam.oy) * k; cam.u = nu; }
  cv.addEventListener('wheel', e => { e.preventDefault(); zoomAt(Math.exp(-e.deltaY * 0.0015), e.offsetX, e.offsetY); }, { passive: false });
  const ptrs = new Map(); let dragMoved = false, pinch = null;
  cv.addEventListener('pointerdown', e => { cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.offsetX, e.offsetY]); dragMoved = false; cv.classList.add('dragging'); if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]) }; } });
  cv.addEventListener('pointermove', e => { if (!ptrs.has(e.pointerId)) return; const prev = ptrs.get(e.pointerId); ptrs.set(e.pointerId, [e.offsetX, e.offsetY]);
    if (ptrs.size === 2 && pinch) { const [a, b] = [...ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]); zoomAt(d / pinch.d, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2); pinch.d = d; dragMoved = true; return; }
    const dx = e.offsetX - prev[0], dy = e.offsetY - prev[1]; if (Math.abs(dx) + Math.abs(dy) > 1) { dragMoved = true; follow = false; bFollow.setAttribute('aria-pressed', 'false'); } cam.ox += dx; cam.oy += dy; });
  const up = e => { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = null; cv.classList.remove('dragging');
    if (!dragMoved && e.type === 'pointerup') { const hit = PEOPLE.slice().reverse().find(p => p.hit && e.offsetX >= p.hit[0] && e.offsetX <= p.hit[0] + p.hit[2] && e.offsetY >= p.hit[1] && e.offsetY <= p.hit[1] + p.hit[3]); select(hit || null); } };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  const bFollow = document.getElementById('bFollow'), bFast = document.getElementById('bFast');
  let follow = false, speed = 1;
  document.getElementById('bFit').onclick = () => { follow = false; bFollow.setAttribute('aria-pressed', 'false'); fit(); };
  document.getElementById('bIn').onclick = () => zoomAt(1.3, W / 2, H / 2);
  document.getElementById('bOut').onclick = () => zoomAt(1 / 1.3, W / 2, H / 2);
  bFollow.onclick = () => { follow = !follow && !!selected; bFollow.setAttribute('aria-pressed', String(follow)); if (follow && cam.u < 60) zoomAt(70 / cam.u, W / 2, H / 2); };
  bFast.onclick = () => { speed = speed === 1 ? 3 : 1; bFast.setAttribute('aria-pressed', String(speed !== 1)); };
  const viewC = () => [W > 760 ? (W - 320) / 2 : W / 2, W > 760 ? H / 2 : H * 0.32];
  function centerOn(x, z, u) { if (u) cam.u = u; const [sx, sy] = P(x, z, 1), [vx, vy] = viewC(); cam.ox += vx - sx; cam.oy += vy - sy; }

  // ---------- panel + card ----------
  let selected = null;
  const card = document.getElementById('card');
  const avaStyle = (key, el, size) => { const a = ATLAS[key], f = a.rows[0][0], s = size / (f[3] * 0.32); el.style.backgroundImage = `url(${a.img})`; el.style.backgroundSize = `${(IMG[key].naturalWidth * s) | 0}px ${(IMG[key].naturalHeight * s) | 0}px`; el.style.backgroundPosition = `${(-(f[0] + f[2] / 2) * s + size / 2) | 0}px ${(-f[1] * s + size * 0.06) | 0}px`; };
  const teamEl = document.getElementById('team'), rowsEl = {};
  PEOPLE.forEach(p => { const b = document.createElement('button'); b.className = 'row'; b.type = 'button';
    b.innerHTML = `<div class="ava"><i></i></div><div><b>${p.name} · ${p.role}</b><span></span></div>`; avaStyle(p.key, b.querySelector('.ava'), 34);
    b.onclick = () => { select(p); centerOn(p.x, p.z, Math.max(cam.u, 60)); }; teamEl.appendChild(b); rowsEl[p.key] = b; });
  const roomsEl = document.getElementById('rooms');
  ROOMS.forEach(r => { const b = document.createElement('button'); b.className = 'row'; b.type = 'button'; b.innerHTML = `<i class="ico">${r.ico}</i><div><b>${r.name}</b></div>`;
    b.onclick = () => { follow = false; bFollow.setAttribute('aria-pressed', 'false'); centerOn(r.x0 + S / 2, r.z0 + S / 2, Math.min(150, (W > 760 ? W - 380 : W - 40) / (2 * S + 1))); }; roomsEl.appendChild(b); });
  function select(p) {
    selected = p; window.OFFICE && window.OFFICE.onSelect && window.OFFICE.onSelect(p); card.hidden = !p; Object.values(rowsEl).forEach(b => b.removeAttribute('aria-current'));
    if (!p) { follow = false; bFollow.setAttribute('aria-pressed', 'false'); return; }
    rowsEl[p.key].setAttribute('aria-current', 'true'); avaStyle(p.key, document.getElementById('cAva'), 64);
    document.getElementById('cName').textContent = p.name; document.getElementById('cRole').textContent = `${p.role} · ໂມເດວ ${p.model}`;
  }
  function refreshUI() {
    PEOPLE.forEach(p => { const r = rowsEl[p.key]; r.querySelector('span').textContent = p.doing; r.querySelector('.ava i').style.background = STATUS[p.status]; });
    if (selected) { document.getElementById('cDoing').textContent = selected.doing; document.getElementById('cDot').style.background = STATUS[selected.status]; }
  }

  // ---------- public API used by app.js ----------
  const STATUS_OF = { idle: 'idle', working: 'work', waiting: 'review', done: 'done', error: 'review' };
  window.OFFICE = {
    people: PEOPLE,
    setLive(key, live) {
      const p = PEOPLE.find(q => q.key === key); if (!p) return;
      p.status = STATUS_OF[live.status] || 'idle';
      const was = p.forced;
      if (live.status === 'working') { p.forced = 'work'; p.doing = live.activity; p.bubble = live.activity; }
      else if (live.status === 'waiting') { p.forced = 'wait'; p.doing = live.activity; p.bubble = live.activity; }
      else if (live.status === 'done') { p.forced = 'cheer'; p.doing = live.activity; p.bubble = live.activity; setTimeout(() => { if (!p.forced) p.bubble = ''; }, 6000); }
      else { p.forced = null; p.bubble = live.status === 'error' ? live.activity : ''; p.doing = live.activity || 'ລໍຖ້າວຽກ'; }
      if (p.forced && p.state !== 'walk' && was !== p.forced) p.timer = 0;
      if (p.forced && p.state !== 'walk') p.timer = Math.min(p.timer, 0.2);
    },
    select: p => select(p),
    focus(key) { const p = PEOPLE.find(q => q.key === key); if (p) { select(p); centerOn(p.x, p.z, Math.max(cam.u, 60)); } },
    onSelect: null,
  };
  // ---------- loop ----------
  let T = 0, last = performance.now(), uiT = 0;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  function frame(now) {
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000)) * speed * (reduce ? 0.5 : 1); last = now; T += dt;
    PEOPLE.forEach(p => step(p, dt));
    if (follow && selected) { const [sx, sy] = P(selected.x, selected.z, 1), [vx, vy] = viewC(); cam.ox += (vx - sx) * 0.08; cam.oy += (vy - sy) * 0.08; }
    g.setTransform(DPR, 0, 0, DPR, 0, 0); g.clearRect(0, 0, W, H);
    drawBase();
    const people = PEOPLE.map(p => ({ kind: 'person', x0: p.x - 0.12, x1: p.x + 0.12, z0: p.z - 0.12, z1: p.z + 0.12, draw: () => drawPerson(p) }));
    order(STATIC.concat(people)).forEach(it => it.draw());
    ROOMS.forEach(drawRoomLabel); PEOPLE.forEach(drawPersonLabel);
    uiT -= dt; if (uiT <= 0) { refreshUI(); uiT = 0.4; }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
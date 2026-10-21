// Shirt recolouring for the employee drawings. Each drawing has a shirt mask (web/assets/shirts/<sprite>.png, made with
// mask-editor.html): the alpha channel says how much of each pixel is shirt. Recolouring repaints the masked pixels in a
// new colour while keeping the folds and shading. Drawings without a saved mask get one built on the fly by autoMask.
// Pure pixel maths, shared by office.js, the mask editor and the tests.
(function (root) {
  const hex = c => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : null;
  const toRgb = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
  const luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
  // colour without brightness: two opponent axes divided by brightness, so a shirt in light and in shadow lands close together
  const chroma = (r, g, b) => { const l = luma(r, g, b) + 24; return [(r - g) / l, ((r + g) / 2 - b) / l]; };
  // where faces, necks and hands fall on the same two axes; a pixel nearer to skin than to the shirt is left alone
  const SKIN = [0.3, 0.32];
  const smooth = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
  const median = v => { v.sort((p, q) => p - q); return v.length ? v[v.length >> 1] : 128; };

  // autoMask settings per drawing. sample = where to read the shirt colour (fractions of the first walk frame);
  // band / sitBand = the torso height range (fractions of a frame) that seeds the shirt on walk rows / other rows;
  // tol = how far a colour may drift from the sample; light = allowed brightness range relative to the sample;
  // near = how far (in tol units) the shirt's blended edges and shadows may drift while growing the mask;
  // skin = how strongly skin-like colours are refused (0 = not at all, for shirts whose light parts look like skin);
  // smooth = magic-wand step size (sum of RGB differences between neighbours) for spreading into highlights, 0 = off;
  // smoothTop = [walk, other rows]: the magic wand never spreads above this height (keeps it off a skin-coloured face);
  // keep = a separate patch (e.g. the far sleeve) counts as shirt when it has this share of the biggest patch's torso pixels;
  // hem = [walk, other rows]: nothing below this height (fraction of a frame) is shirt, for trousers of the same colour;
  // top = [walk, other rows]: nothing above this height is shirt, for a neck or face close to the shirt colour;
  // shoulders = share of the widest masked row that marks the shoulder line (nothing above it is shirt)
  const DEFAULT = { sample: [0.4, 0.3, 0.6, 0.4], band: [0.2, 0.55], sitBand: [0.2, 0.55], tol: 0.32, light: [0.35, 2.6], skin: 0.7, near: 2.2 };
  // settings the saved masks were first built with (the masks were then corrected by hand in mask-editor.html)
  const SHIRT = {
    ceo: { hem: [0.6, 0.62] },
    dao: { tol: 0.62, shoulders: 0.4, hem: [0.52, 1] },
    somphone: { hem: [0.6, 1] },
    keo: { light: [0.62, 1.6], tol: 0.3 },
    toy: { tol: 0.45 },
    kham: { tol: 0.26, near: 1.4 },
    sy: { tol: 0.3, light: [0.2, 3.2], hem: [0.56, 0.52], near: 1.5 },
    saeng: { light: [0.62, 1.6], tol: 0.25, near: 1.4, hem: [0.47, 0.55] },
    thong: { shoulders: 0.6, skin: 1.0, tol: 0.3, keep: 0.02, light: [0.25, 2.6] },
    chanh: { skin: 1.2, shoulders: 0.6, tol: 0.28 },
  };
  const specOf = sprite => ({ ...DEFAULT, ...(SHIRT[sprite] || {}) });

  /** median colour of the sample area in a frame */
  function sampleShirt(data, width, frame, spec) {
    const [fx, fy, fw, fh] = frame, [a, b, c, d] = spec.sample, rs = [], gs = [], bs = [];
    for (let y = Math.round(fy + b * fh); y < fy + d * fh; y++) for (let x = Math.round(fx + a * fw); x < fx + c * fw; x++) {
      const i = (y * width + x) * 4; if (data[i + 3] < 200) continue; rs.push(data[i]); gs.push(data[i + 1]); bs.push(data[i + 2]);
    }
    return [median(rs), median(gs), median(bs)];
  }

  /** build a shirt mask (0..255 per pixel, whole atlas) from colour plus connection: per frame, pixels that match the
   *  shirt strongly form regions; only regions reaching into the torso band are kept, then grown into weaker matches
   *  that touch them. Props, hair or a whiteboard of a similar colour stay out unless they touch the shirt. */
  function autoMask(data, width, rows, sprite, only = null) { // only = [row, frame] to build a single frame
    const spec = specOf(sprite), height = data.length / 4 / width, mask = new Uint8Array(width * height);
    const ref = sampleShirt(data, width, rows[0][0], spec), Lr = Math.max(8, luma(...ref)), [ra, rb] = chroma(...ref);
    rows.forEach((row, ri) => { const band = ri < 2 ? spec.band : spec.sitBand; row.forEach(([fx, fy, fw, fh], fi) => {
      if (only && (only[0] !== ri || only[1] !== fi)) return;
      const n = fw * fh, w = new Float32Array(n), near = new Uint8Array(n), dark = new Uint8Array(n), rim = new Uint8Array(n); // dark = shadow on a dark shirt; rim = may be a blended edge
      for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) {
        const i = ((fy + y) * width + fx + x) * 4; if (data[i + 3] < 8) continue;
        const r = data[i], g = data[i + 1], b = data[i + 2], L = luma(r, g, b), [pa, pb] = chroma(r, g, b), dist = Math.hypot(pa - ra, pb - rb);
        const j = y * fw + x, dSkin = Math.hypot(pa - SKIN[0], pb - SKIN[1]);
        if (dist < spec.tol * 3.5 && dSkin >= dist * 0.35) rim[j] = 1; // edges blend with the background, so judged loosely
        if (dSkin < dist * spec.skin || L > Lr * spec.light[1] + 30) continue;

        if (L >= Lr * spec.light[0] - 6) w[j] = 1 - smooth(spec.tol * 0.55, spec.tol, dist);
        if (dist < spec.tol * spec.near && L >= Lr * spec.light[0] * 0.7) near[j] = 1;
        if (Lr < 90 && L < Lr * 1.15 && dist < spec.tol * spec.near) dark[j] = 1;
      }
      // regions of strong matches (4-connected); keep those with enough pixels inside the torso band
      const lab = new Int32Array(n).fill(-1), sizes = [], inBand = [], b0 = band[0] * fh, b1 = band[1] * fh;
      for (let s = 0; s < n; s++) {
        if (lab[s] >= 0 || w[s] < 0.6) continue;
        const id = sizes.length, stack = [s]; lab[s] = id; let size = 0, inside = 0;
        while (stack.length) {
          const j = stack.pop(), x = j % fw, y = (j / fw) | 0; size++; if (y >= b0 && y < b1) inside++;
          for (const k of [x > 0 ? j - 1 : -1, x < fw - 1 ? j + 1 : -1, j - fw, j + fw]) if (k >= 0 && k < n && lab[k] < 0 && w[k] >= 0.6) { lab[k] = id; stack.push(k); }
        }
        sizes.push(size); inBand.push(inside);
      }
      const best = Math.max(0, ...inBand), keep = inBand.map((v, id) => v >= Math.max(15, best * (spec.keep ?? 0.1)) && sizes[id] >= 30);
      // grow from the kept regions into touching weaker matches and the shirt's blended edge
      const out = new Float32Array(n), queue = [];
      for (let j = 0; j < n; j++) if (lab[j] >= 0 && keep[lab[j]]) { out[j] = w[j]; queue.push(j); }
      for (let q = 0; q < queue.length; q++) {
        const j = queue[q], x = j % fw;
        for (const k of [x > 0 ? j - 1 : -1, x < fw - 1 ? j + 1 : -1, j - fw, j + fw]) {
          if (k < 0 || k >= n || out[k] > 0 || !near[k]) continue;
          const v = Math.max(w[k], out[j] * 0.8); if (v < 0.3) continue;
          out[k] = v; queue.push(k);
        }
      }
      // smooth growth (spec.smooth > 0): keep spreading into neighbours that differ only a little from the shirt pixel
      // next to them, like a magic wand; reaches highlights that drift far from the sample colour but stops at edges
      if (spec.smooth) {
        const px = j => ((fy + ((j / fw) | 0)) * width + fx + (j % fw)) * 4, q2 = [];
        const top = Math.round((spec.smoothTop ? spec.smoothTop[ri < 2 ? 0 : 1] : 0) * fh) * fw; // never spread above (a face)
        for (let j = 0; j < n; j++) if (out[j] > 0.5) q2.push(j);
        for (let q = 0; q < q2.length; q++) {
          const j = q2[q], x = j % fw, a = px(j);
          for (const k of [x > 0 ? j - 1 : -1, x < fw - 1 ? j + 1 : -1, j - fw, j + fw]) {
            if (k < 0 || k >= n || out[k] > 0) continue;
            const b = px(k); if (data[b + 3] < 200 || k < top) continue;
            const d = Math.abs(data[a] - data[b]) + Math.abs(data[a + 1] - data[b + 1]) + Math.abs(data[a + 2] - data[b + 2]);
            const [pa, pb] = chroma(data[b], data[b + 1], data[b + 2]);
            if (d > spec.smooth || Math.hypot(pa - ra, pb - rb) > spec.tol * 4) continue;
            out[k] = 1; q2.push(k);
          }
        }
      }
      // close holes and thin stripes (folds and shadows): an unmasked pixel of the drawing with five or more of its eight
      // neighbours masked joins them; three rounds fill gaps up to about six pixels wide
      for (let pass = 0; pass < 3; pass++) {
        const add = [];
        for (let j = 0; j < n; j++) {
          if (out[j] || !(near[j] || dark[j])) continue;
          const x = j % fw; let c = 0;
          for (const dy of [-fw, 0, fw]) for (const dx of [-1, 0, 1]) { if ((!dx && !dy) || (x + dx < 0) || (x + dx >= fw)) continue; const k = j + dy + dx; if (k >= 0 && k < n && out[k] > 0.4) c++; }
          if (c >= 5) add.push(j);
        }
        for (const j of add) out[j] = 0.9;
      }
      // a soft two-pixel rim: pixels hugging the mask (three or more masked neighbours) whose colour is still nearer the
      // shirt than skin are blends of the shirt with what is behind it; repaint them part-way
      for (let pass = 0; pass < 2; pass++) { const add = [];
        for (let j = 0; j < n; j++) {
          if (out[j] > 0 || !rim[j]) continue;
          const x = j % fw; let c = 0;
          for (const dy of [-fw, 0, fw]) for (const dx of [-1, 0, 1]) { if ((!dx && !dy) || x + dx < 0 || x + dx >= fw) continue; const k = j + dy + dx; if (k >= 0 && k < n && out[k] > 0.5) c++; }
          if (c >= 3) add.push(j);
        }
        for (const j of add) out[j] = 0.85; }
      // the shirt's outline: antialiased pixels on the drawing's silhouette (within two pixels of empty background) and
      // within two pixels of the mask are blends of the shirt with the background; take them in whatever their colour
      { const alphaAt = j => data[((fy + ((j / fw) | 0)) * width + fx + (j % fw)) * 4 + 3];
        const grow = (src, steps) => { let cur = src; for (let t = 0; t < steps; t++) { const nx = cur.slice(); for (let j = 0; j < n; j++) if (cur[j]) { const x = j % fw; if (x > 0) nx[j - 1] = 1; if (x < fw - 1) nx[j + 1] = 1; if (j >= fw) nx[j - fw] = 1; if (j + fw < n) nx[j + fw] = 1; } cur = nx; } return cur; };
        const empty = new Uint8Array(n), solid = new Uint8Array(n);
        for (let j = 0; j < n; j++) { if (alphaAt(j) < 8) empty[j] = 1; if (out[j] > 0.5) solid[j] = 1; }
        const nearEmpty = grow(empty, 2), nearMask = grow(solid, 2);
        for (let j = 0; j < n; j++) if (!out[j] && !empty[j] && nearEmpty[j] && nearMask[j]) out[j] = 0.55; // part-way: these blend with the light background
      }
      // fill enclosed holes (highlights, prints, specks): unmasked patches up to 80 px whose every neighbour is mask or
      // part of the patch; up to 400 px when the patch is see-through (white cut out by the drawing's background removal)
      const seen = new Uint8Array(n);
      for (let s0 = 0; s0 < n; s0++) {
        if (seen[s0] || out[s0] > 0) continue;
        const patch = [s0], stack = [s0]; seen[s0] = 1; let closed = true, see = false; // see = has see-through pixels
        while (stack.length) {
          const j = stack.pop(), x = j % fw, i = ((fy + ((j / fw) | 0)) * width + fx + x) * 4;
          if (data[i + 3] < 8) see = true;
          if (x === 0 || x === fw - 1 || j < fw || j >= n - fw) closed = false;
          for (const k of [x > 0 ? j - 1 : -1, x < fw - 1 ? j + 1 : -1, j - fw, j + fw]) if (k >= 0 && k < n && !seen[k] && !(out[k] > 0)) { seen[k] = 1; stack.push(k); patch.push(k); }
          if (patch.length > (see ? 400 : 80)) closed = false;
        }
        if (closed) for (const j of patch) out[j] = 1;
      }
      // full strength inside the shirt: a partial weight only makes sense on its edge, so every masked pixel whose
      // neighbours (two pixels out) are all masked becomes solid; dark folds that drift in colour no longer show through
      { const solid = [];
        for (let j = 0; j < n; j++) {
          if (!(out[j] > 0) || out[j] >= 1) continue;
          const x = j % fw, y = (j / fw) | 0; let inside = x >= 2 && x < fw - 2 && y >= 2 && y < fh - 2;
          for (let dy = -2; dy <= 2 && inside; dy++) for (let dx = -2; dx <= 2; dx++) if (!(out[j + dy * fw + dx] > 0)) { inside = false; break; }
          if (inside) solid.push(j);
        }
        for (const j of solid) out[j] = 1; }
      if (spec.hem) out.fill(0, Math.round((ri < 2 ? spec.hem[0] : spec.hem[1]) * fh) * fw);
      if (spec.top) out.fill(0, 0, Math.round((ri < 2 ? spec.top[0] : spec.top[1]) * fh) * fw);
      // shoulders: the neck is a narrow column above them; drop mask rows above the first row that is at least
      // `shoulders` of the widest masked row (for skin-coloured shirts, where the neck matches the shirt)
      if (spec.shoulders) {
        const widths = Array.from({ length: fh }, (_, y) => { let c = 0; for (let x = 0; x < fw; x++) if (out[y * fw + x] > 0.4) c++; return c; });
        const widest = Math.max(...widths), first = widths.findIndex(c => c >= widest * spec.shoulders);
        if (first > 0) out.fill(0, 0, first * fw);
      }
      for (let j = 0; j < n; j++) if (out[j] > 0) mask[(fy + ((j / fw) | 0)) * width + fx + (j % fw)] = Math.round(Math.min(1, out[j]) * 255);
    }); });
    return mask;
  }

  /** make every masked pixel whose neighbours two pixels out are all masked full strength (whole atlas, in place) */
  function solidify(mask, width) {
    const height = mask.length / width, solid = [];
    for (let y = 2; y < height - 2; y++) for (let x = 2; x < width - 2; x++) {
      const p = y * width + x; if (!mask[p] || mask[p] === 255) continue;
      let inside = true;
      for (let dy = -2; dy <= 2 && inside; dy++) for (let dx = -2; dx <= 2; dx++) if (!mask[p + dy * width + dx]) { inside = false; break; }
      if (inside) solid.push(p);
    }
    for (const p of solid) mask[p] = 255;
    return solid.length;
  }

  /** the shirt's median brightness: the reference its folds are measured from */
  function shirtLuma(data, mask) {
    const ls = [];
    for (let p = 0; p < mask.length; p += 3) if (mask[p] > 200) { const i = p * 4; ls.push(luma(data[i], data[i + 1], data[i + 2])); }
    return Math.max(8, median(ls));
  }

  /** repaint masked pixels in place. opts.Lr = shirtLuma (computed when missing); opts.box = [x, y, w, h] with
   *  opts.width limits the work to one area (the mask editor repaints only the frame being drawn on) */
  function applyMask(data, mask, target, opts = {}) {
    const T = toRgb(hex(target)), TL = Math.max(8, luma(...T)), Lr = opts.Lr || shirtLuma(data, mask);
    // keep the folds: brightness differences carry over, softened when the new colour is much darker or lighter
    const k = 0.45 + 0.55 * Math.min(TL, Lr) / Math.max(TL, Lr);
    const paint = p => {
      const m = mask[p]; if (!m) return;
      const w = m / 255, i = p * 4, r = data[i], g = data[i + 1], b = data[i + 2], L = data[i + 3] < 128 ? Lr : luma(r, g, b);
      const s = Math.max(TL * 0.22, Math.min(255, TL + (L - Lr) * k)) / TL;
      data[i] = Math.round(r + (Math.min(255, T[0] * s) - r) * w);
      data[i + 1] = Math.round(g + (Math.min(255, T[1] * s) - g) * w);
      data[i + 2] = Math.round(b + (Math.min(255, T[2] * s) - b) * w);
      // some drawings lost alpha inside white parts (background removal); a pixel deep inside the shirt is made solid
      const W = opts.width;
      if (W && data[i + 3] < 250 && m > 200 && mask[p - 1] > 200 && mask[p + 1] > 200 && mask[p - W] > 200 && mask[p + W] > 200) data[i + 3] = 255;
    };
    if (opts.box) { const [x0, y0, bw, bh] = opts.box; for (let y = y0; y < y0 + bh; y++) for (let x = x0; x < x0 + bw; x++) paint(y * opts.width + x); }
    else for (let p = 0; p < mask.length; p++) paint(p);
    return data;
  }

  /** repaint the shirt: with a saved mask when given, otherwise with an automatic one */
  function recolor(data, width, rows, target, sprite, mask) {
    return applyMask(data, mask || autoMask(data, width, rows, sprite), target, { width });
  }

  /** browser: the alpha channel of a mask image as a byte per pixel */
  function maskFromImage(img) {
    const cv = document.createElement('canvas'); cv.width = img.naturalWidth; cv.height = img.naturalHeight;
    const g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, cv.width, cv.height).data, m = new Uint8Array(cv.width * cv.height);
    for (let p = 0; p < m.length; p++) m[p] = d[p * 4 + 3];
    return m;
  }

  /** browser: a canvas of the atlas with the shirt repainted (cached by the caller); maskImg = the saved mask, if any */
  function tintedCanvas(img, rows, target, sprite, maskImg) {
    const cv = document.createElement('canvas'); cv.width = img.naturalWidth; cv.height = img.naturalHeight;
    const g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
    if (!hex(target)) return cv;
    const im = g.getImageData(0, 0, cv.width, cv.height);
    const mask = maskImg && maskImg.naturalWidth === cv.width && maskImg.naturalHeight === cv.height ? maskFromImage(maskImg) : null;
    recolor(im.data, cv.width, rows, target, sprite, mask);
    g.putImageData(im, 0, 0); return cv;
  }

  root.TINT = { hex, recolor, autoMask, applyMask, shirtLuma, solidify, maskFromImage, tintedCanvas, sampleShirt, specOf, SHIRT };
})(typeof window !== 'undefined' ? window : globalThis);

import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../web/tint.js';

const { TINT } = globalThis;
// a 40x100 "frame": grey background (transparent), a blue shirt block in the torso, a skin head, and a separate
// blue prop near the feet that is not touching the shirt
function frame() {
  const w = 40, h = 100, data = new Uint8ClampedArray(w * h * 4);
  const put = (x0, y0, x1, y1, [r, g, b]) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * w + x) * 4; data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255; } };
  put(14, 4, 26, 18, [220, 170, 140]);   // face
  put(10, 18, 30, 55, [40, 80, 200]);    // shirt
  put(12, 30, 20, 34, [25, 50, 140]);    // a dark fold inside the shirt
  put(10, 55, 30, 90, [40, 40, 50]);     // trousers
  put(32, 85, 38, 95, [40, 80, 200]);    // blue prop, not touching the shirt
  return { w, h, data, rows: [[[0, 0, w, h]], [[0, 0, w, h]]] };
}
const at = (f, x, y) => y * f.w + x;

test('autoMask takes the shirt and its folds, leaves face, trousers and a same-colour prop alone', () => {
  const f = frame(), m = TINT.autoMask(f.data, f.w, f.rows, 'test');
  assert.ok(m[at(f, 20, 40)] > 200, 'shirt');
  assert.ok(m[at(f, 15, 32)] > 200, 'dark fold inside the shirt');
  assert.equal(m[at(f, 20, 10)], 0, 'face');
  assert.equal(m[at(f, 20, 70)], 0, 'trousers');
  assert.equal(m[at(f, 35, 90)], 0, 'prop');
});

test('applyMask repaints only masked pixels, keeps folds darker and leaves alpha', () => {
  const f = frame(), m = TINT.autoMask(f.data, f.w, f.rows, 'test'), before = f.data.slice();
  TINT.applyMask(f.data, m, '#2fa86a', { width: f.w });
  const px = (x, y) => Array.from(f.data.slice(at(f, x, y) * 4, at(f, x, y) * 4 + 4));
  const [r, g, b] = px(20, 40); assert.ok(g > r && g > b, 'shirt is green now');
  assert.ok(px(15, 32)[1] < px(20, 40)[1], 'fold stays darker than the lit shirt');
  assert.deepEqual(px(20, 10), Array.from(before.slice(at(f, 20, 10) * 4, at(f, 20, 10) * 4 + 4)), 'face untouched');
  assert.equal(px(0, 0)[3], 0, 'background still transparent');
});

test('solidify fills partial weights inside the mask but keeps soft edges', () => {
  const w = 10, m = new Uint8Array(w * w);
  for (let y = 1; y < 9; y++) for (let x = 1; x < 9; x++) m[y * w + x] = 150;
  TINT.solidify(m, w);
  assert.equal(m[5 * w + 5], 255);
  assert.equal(m[1 * w + 1], 150);
});

test('recolor uses a saved mask when one is given', () => {
  const f = frame(), mask = new Uint8Array(f.w * f.h); mask[at(f, 20, 10)] = 255; // paint only one face pixel
  TINT.recolor(f.data, f.w, f.rows, '#ff0000', 'test', mask);
  const i = at(f, 20, 40) * 4; assert.deepEqual([f.data[i], f.data[i + 1], f.data[i + 2]], [40, 80, 200], 'shirt untouched');
  const j = at(f, 20, 10) * 4; assert.ok(f.data[j] > f.data[j + 1], 'the masked pixel turned red');
});

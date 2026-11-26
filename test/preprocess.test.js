const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const pre = require('../src/preprocess');
const B = require('./benchlib');

const fixture = (n) => { const p = B.PNG.sync.read(fs.readFileSync(path.join(__dirname, 'fixtures', n))); return { gray: B.lum(p.data, p.width, p.height), W: p.width, H: p.height }; };
const flat = (W, H, v) => new Uint8Array(W * H).fill(v);

test('flat margins are stripped, blank images are left alone', () => {
  const W = 60, H = 40, g = flat(W, H, 255);
  for (let y = 15; y < 25; y++) for (let x = 20; x < 40; x++) g[y * W + x] = (x + y) % 2 ? 0 : 200; // textured, like glyphs
  const s = pre.stripFlat(g, W, H);
  assert.ok(s.W <= 22 && s.H <= 12, `${s.W}x${s.H}`);
  assert.equal(pre.stripFlat(flat(W, H, 255), W, H).W, W);
});
test('white text on a dark background is turned into dark text on light', () => {
  const W = 80, H = 30, g = flat(W, H, 20);
  for (let y = 8; y < 22; y++) for (let x = 10; x < 14; x++) g[y * W + x] = 235;
  const n = pre.normalise(g, W, H);
  assert.equal(n.inverted, true);
  const mean = n.gray.reduce((a, b) => a + b, 0) / n.gray.length;
  assert.ok(mean > 200, `mean ${mean}`);
});
test('a dark photo frame around a light label is cut off', () => {
  const W = 120, H = 60, g = flat(W, H, 15);
  for (let y = 12; y < 48; y++) for (let x = 12; x < 108; x++) g[y * W + x] = 215;
  for (let y = 24; y < 36; y++) for (let x = 30; x < 34; x++) g[y * W + x] = 60;
  const t = pre.trimDark(g, W, H);
  assert.ok(t.W <= 100 && t.H <= 40, `${t.W}x${t.H}`);
});
test('glyph height is measured on thin faint photo text', () => {
  const f = fixture('code-plate.png');
  const n = pre.normalise(f.gray, f.W, f.H);
  const h = pre.glyphHeight(n.gray, n.W, n.H, pre.inkThreshold(n.gray));
  assert.ok(h >= 10 && h <= 18, `height ${h}`); // raw photo pixels: letters are ~13 px tall
});
test('variants are offered cheapest first and are valid images', () => {
  const f = fixture('caps-line.png');
  const v = pre.variants(f.gray, f.W, f.H);
  assert.deepEqual(v.map((x) => x.label), ['normal', 'sharp', 'bold', 'flipped', 'small', 'large']);
  const im = v[0].make();
  assert.equal(im.gray.length, im.W * im.H);
  assert.ok(im.W >= 20 && im.H >= 20);
});
test('huge images are bounded', () => {
  const W = 5000, H = 400, g = flat(W, H, 255);
  for (let x = 100; x < 4900; x += 20) for (let y = 150; y < 250; y++) g[y * W + x] = 0;
  const n = pre.normalise(g, W, H);
  assert.ok(Math.max(n.W, n.H) <= 3600);
});

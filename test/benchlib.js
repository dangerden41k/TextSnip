'use strict';
// dev helpers for test/bench.js: emulate what the overlay does to a snip, and score OCR text.
const { PNG } = require('pngjs');

function lum(rgba, w, h) { const g = new Uint8Array(w * h); for (let i = 0; i < g.length; i++) g[i] = (rgba[i * 4] * 299 + rgba[i * 4 + 1] * 587 + rgba[i * 4 + 2] * 114) / 1000; return g; }
function resizeBilinear(g, w, h, nw, nh) {
  const out = new Uint8Array(nw * nh);
  for (let y = 0; y < nh; y++) {
    const fy = Math.min(h - 1, Math.max(0, ((y + 0.5) * h) / nh - 0.5)), y0 = Math.floor(fy), y1 = Math.min(h - 1, y0 + 1), wy = fy - y0;
    for (let x = 0; x < nw; x++) {
      const fx = Math.min(w - 1, Math.max(0, ((x + 0.5) * w) / nw - 0.5)), x0 = Math.floor(fx), x1 = Math.min(w - 1, x0 + 1), wx = fx - x0;
      out[y * nw + x] = (g[y0 * w + x0] * (1 - wx) + g[y0 * w + x1] * wx) * (1 - wy) + (g[y1 * w + x0] * (1 - wx) + g[y1 * w + x1] * wx) * wy;
    }
  }
  return out;
}
// same steps as ui/overlay.js prepare(): upscale, gray, invert if mean < 110, stretch 2%..98%, white margin
function overlayPrepare(rgba, w, h, upscale = 2.5) {
  const s = Math.max(1, Math.min(upscale, 3600 / Math.max(w, h)));
  const pad = Math.max(12, Math.round(7 * s)), iw = Math.round(w * s), ih = Math.round(h * s);
  const g = resizeBilinear(lum(rgba, w, h), w, h, iw, ih);
  const hist = new Uint32Array(256); let sum = 0;
  for (const v of g) { hist[v]++; sum += v; }
  const n = g.length, invert = sum / n < 110;
  let lo = 0, hi = 255, acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > n * 0.02) { lo = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > n * 0.02) { hi = v; break; } }
  const span = Math.max(1, hi - lo), W = iw + 2 * pad, H = ih + 2 * pad, out = new Uint8Array(W * H).fill(255);
  for (let y = 0; y < ih; y++) for (let x = 0; x < iw; x++) {
    let v = Math.max(0, Math.min(255, ((g[y * iw + x] - lo) * 255) / span)); if (invert) v = 255 - v;
    out[(y + pad) * W + x + pad] = v;
  }
  return { gray: out, W, H };
}
function toPng(gray, W, H) { const p = new PNG({ width: W, height: H }); for (let i = 0; i < gray.length; i++) { p.data[i * 4] = p.data[i * 4 + 1] = p.data[i * 4 + 2] = gray[i]; p.data[i * 4 + 3] = 255; } return PNG.sync.write(p); }

function lev(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) { const cur = [i]; for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
  return prev[b.length];
}
const norm = (t) => t.split('\n').map((l) => l.trim().replace(/\s+/g, ' ')).filter(Boolean).join('\n');
const accuracy = (got, truth) => { const a = norm(got), b = norm(truth); return Math.max(0, 1 - lev(a, b) / Math.max(1, b.length)); };
module.exports = { PNG, lum, resizeBilinear, overlayPrepare, toPng, lev, norm, accuracy };

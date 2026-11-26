'use strict';
// Image preparation for OCR on gray Uint8Array images (0 = black). Works on anything: overlay snips,
// clipboard images, files. The result is always dark text on a light background with no frame.
// prepare() returns a list of VARIANTS in priority order; the pipeline tries the next one only when
// the previous result is weak, so the common case costs one OCR pass.

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function hist(g) { const h = new Uint32Array(256); for (let i = 0; i < g.length; i++) h[g[i]]++; return h; }
function otsu(h, n) {
  let sum = 0; for (let i = 0; i < 256; i++) sum += i * h[i];
  let wB = 0, sB = 0, best = -1, thr = 127;
  for (let t = 0; t < 256; t++) {
    wB += h[t]; if (!wB) continue;
    const wF = n - wB; if (!wF) break;
    sB += t * h[t];
    const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) * (mB - mF);
    if (v > best) { best = v; thr = t; }
  }
  return thr;
}
function percentile(h, n, p) { let acc = 0; for (let v = 0; v < 256; v++) { acc += h[v]; if (acc > n * p) return v; } return 255; }

// ink = clearly darker than the background; the background is the most common tone
function inkThreshold(g) {
  const h = hist(g); let bg = 255, best = -1;
  for (let v = 0; v < 256; v++) { let c = 0; for (let d = -3; d <= 3; d++) c += h[clamp(v + d, 0, 255)]; if (c > best) { best = c; bg = v; } }
  return clamp(bg - 45, 40, 235);
}

function crop(g, W, t, b, l, r) {
  const nw = r - l + 1, nh = b - t + 1, o = new Uint8Array(nw * nh);
  for (let y = 0; y < nh; y++) o.set(g.subarray((y + t) * W + l, (y + t) * W + l + nw), y * nw);
  return { gray: o, W: nw, H: nh };
}
function pad(g, W, H, m, bg = 255) {
  const NW = W + 2 * m, NH = H + 2 * m, o = new Uint8Array(NW * NH).fill(bg);
  for (let y = 0; y < H; y++) o.set(g.subarray(y * W, y * W + W), (y + m) * NW + m);
  return { gray: o, W: NW, H: NH };
}
const invert = (g) => g.map((v) => 255 - v);

// remove margins of (almost) one flat colour, e.g. the padding the overlay adds
function stripFlat(g, W, H, tol = 14) {
  const rowFlat = (y, l, r) => { let mn = 255, mx = 0; for (let x = l; x <= r; x++) { const v = g[y * W + x]; if (v < mn) mn = v; if (v > mx) mx = v; } return mx - mn < tol; };
  const colFlat = (x, t, b) => { let mn = 255, mx = 0; for (let y = t; y <= b; y++) { const v = g[y * W + x]; if (v < mn) mn = v; if (v > mx) mx = v; } return mx - mn < tol; };
  let t = 0, b = H - 1, l = 0, r = W - 1;
  while (t < b && rowFlat(t, l, r)) t++;
  while (b > t && rowFlat(b, l, r)) b--;
  while (l < r && colFlat(l, t, b)) l++;
  while (r > l && colFlat(r, t, b)) r--;
  if (r - l + 1 < 4 || b - t + 1 < 4) return { gray: g, W, H }; // nothing but a speck left: leave it alone
  return crop(g, W, t, b, l, r);
}
// remove a dark frame (photo background around a light label) from the outside in
function trimDark(g, W, H, frac = 0.5, dark = 150) {
  let t = 0, b = H - 1, l = 0, r = W - 1;
  const rowD = (y) => { let c = 0; for (let x = l; x <= r; x++) if (g[y * W + x] < dark) c++; return c / (r - l + 1); };
  const colD = (x) => { let c = 0; for (let y = t; y <= b; y++) if (g[y * W + x] < dark) c++; return c / (b - t + 1); };
  const maxT = Math.floor(H * 0.35), maxL = Math.floor(W * 0.35);
  for (let k = 0; k < 4; k++) {
    let n = 0; while (t < b && n < maxT && rowD(t) > frac) { t++; n++; }
    n = 0; while (b > t && n < maxT && rowD(b) > frac) { b--; n++; }
    n = 0; while (l < r && n < maxL && colD(l) > frac) { l++; n++; }
    n = 0; while (r > l && n < maxL && colD(r) > frac) { r--; n++; }
  }
  if (t === 0 && l === 0 && b === H - 1 && r === W - 1) return { gray: g, W, H };
  return crop(g, W, t, b, l, r);
}

function resize(g, w, h, nw, nh) { // area average when shrinking, bilinear when growing
  const out = new Uint8Array(nw * nh);
  if (nw <= w && nh <= h) {
    const sx = w / nw, sy = h / nh;
    for (let y = 0; y < nh; y++) {
      const y0 = y * sy, y1 = Math.min(h, (y + 1) * sy);
      for (let x = 0; x < nw; x++) {
        const x0 = x * sx, x1 = Math.min(w, (x + 1) * sx);
        let acc = 0, wt = 0;
        for (let yy = Math.floor(y0); yy < Math.ceil(y1); yy++) {
          const wy = Math.min(yy + 1, y1) - Math.max(yy, y0);
          for (let xx = Math.floor(x0); xx < Math.ceil(x1); xx++) {
            const wx = Math.min(xx + 1, x1) - Math.max(xx, x0), k = wx * wy;
            acc += g[yy * w + xx] * k; wt += k;
          }
        }
        out[y * nw + x] = wt ? acc / wt : 255;
      }
    }
    return out;
  }
  for (let y = 0; y < nh; y++) {
    const fy = clamp(((y + 0.5) * h) / nh - 0.5, 0, h - 1), y0 = Math.floor(fy), y1 = Math.min(h - 1, y0 + 1), wy = fy - y0;
    for (let x = 0; x < nw; x++) {
      const fx = clamp(((x + 0.5) * w) / nw - 0.5, 0, w - 1), x0 = Math.floor(fx), x1 = Math.min(w - 1, x0 + 1), wx = fx - x0;
      out[y * nw + x] = (g[y0 * w + x0] * (1 - wx) + g[y0 * w + x1] * wx) * (1 - wy) + (g[y1 * w + x0] * (1 - wx) + g[y1 * w + x1] * wx) * wy;
    }
  }
  return out;
}

// thicken thin dark strokes (grayscale erosion 3x3): thin dot-matrix / antialiased glyphs become readable
function bolden(g, W, H) {
  const o = new Uint8Array(g.length);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let m = 255;
    for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= H) continue;
      for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx >= 0 && xx < W) { const v = g[yy * W + xx]; if (v < m) m = v; } } }
    o[y * W + x] = m;
  }
  return o;
}

// unsharp mask: brings back edges of soft / rescaled / video-frame text
function sharpen(g, W, H, amount = 1.4) {
  const o = new Uint8Array(g.length);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let acc = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= H) continue;
      for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx >= 0 && xx < W) { acc += g[yy * W + xx]; n++; } } }
    const v = g[y * W + x];
    o[y * W + x] = clamp(v + amount * (v - acc / n), 0, 255);
  }
  return o;
}

// median height of the individual glyphs (connected dark blobs), in pixels; 0 if there are too few.
// Robust against thin strokes, many lines or a single line; frames and rules are ignored.
function glyphHeight(g, W, H, thr) {
  let src = g, w = W, h = H, k = 1;
  if (W * H > 3e6) { w = Math.round(W / 2); h = Math.round(H / 2); src = resize(g, W, H, w, h); k = 2; }
  const ink = new Uint8Array(w * h); for (let i = 0; i < ink.length; i++) ink[i] = src[i] < thr ? 1 : 0;
  const heights = [], stack = new Int32Array(w * h);
  for (let i = 0; i < ink.length; i++) {
    if (ink[i] !== 1) continue;
    let sp = 0, minY = h, maxY = 0, minX = w, maxX = 0, area = 0;
    stack[sp++] = i; ink[i] = 2;
    while (sp) {
      const p = stack[--sp], y = (p / w) | 0, x = p - y * w;
      area++; if (y < minY) minY = y; if (y > maxY) maxY = y; if (x < minX) minX = x; if (x > maxX) maxX = x;
      for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, q = yy * w + xx; if (xx >= 0 && xx < w && ink[q] === 1) { ink[q] = 2; stack[sp++] = q; } } }
    }
    const bh = maxY - minY + 1, bw = maxX - minX + 1;
    if (bh >= 3 && bw <= w * 0.6 && area < w * h * 0.25 && bh < h * 0.95) heights.push(bh);
  }
  if (heights.length < 3) return 0;
  heights.sort((a, c) => a - c);
  return heights[Math.floor(heights.length / 2)] * k;
}

// Tesseract is happy with glyphs about 26..56 px tall; only outside that range the image is rescaled
// (tuned on test/bench.js). Shrinking thin text that is already fine costs accuracy, so there is a dead zone.
const LO = Number(process.env.GLYPH_LO) || 26, HI = Number(process.env.GLYPH_HI) || 56;
const TARGET_BAND = 36;
const wantedScale = (h) => (h < 4 ? 1 : h < LO ? clamp(TARGET_BAND / h, 1, 3) : h > HI ? clamp(TARGET_BAND / h, 0.4, 1) : 1);
const MAX_SIDE = 3600, MARGIN = 20;

// normalise: flat margins off, polarity (dark text on light), frame off, contrast stretch
function normalise(gray, W, H) {
  if (Math.max(W, H) > MAX_SIDE) { // keep memory and time bounded for huge images
    const k = MAX_SIDE / Math.max(W, H), nw = Math.round(W * k), nh = Math.round(H * k);
    gray = resize(gray, W, H, nw, nh); W = nw; H = nh;
  }
  let s = stripFlat(gray, W, H);
  let { gray: g, W: w, H: h } = s;
  const hh = hist(g), n = g.length, thr = otsu(hh, n);
  let darkN = 0; for (let v = 0; v <= thr; v++) darkN += hh[v];
  const bgDark = darkN > n - darkN; // the larger class is the background
  if (bgDark) g = invert(g);
  const t2 = trimDark(g, w, h); g = t2.gray; w = t2.W; h = t2.H;
  const h2 = hist(g), n2 = g.length, lo = percentile(h2, n2, 0.01), hi = 255 - percentile(hist(invert(g)), n2, 0.01);
  const span = Math.max(40, hi - lo);
  g = g.map((v) => clamp(((v - lo) * 255) / span, 0, 255));
  return { gray: g, W: w, H: h, inverted: bgDark };
}

function fit(g, w, h, f) {
  const side = Math.max(w, h) * f;
  if (side > MAX_SIDE) f *= MAX_SIDE / side;
  const nw = Math.max(8, Math.round(w * f)), nh = Math.max(8, Math.round(h * f));
  return Math.abs(f - 1) < 0.04 ? { gray: g, W: w, H: h } : { gray: resize(g, w, h, nw, nh), W: nw, H: nh };
}

function finish(g, w, h) { const p = pad(g, w, h, MARGIN); return p; }

// list of variants, cheapest first. Each has a label and make() producing { gray, W, H }.
function variants(gray, W, H) {
  let base = null;
  const norm = () => base || (base = normalise(gray, W, H));
  const scaled = () => {
    const n = norm();
    const band = glyphHeight(n.gray, n.W, n.H, inkThreshold(n.gray));
    const f = wantedScale(band);
    return { n, f: Math.abs(f - 1) < 0.1 ? 1 : f };
  };
  return [
    { label: 'normal', make: () => { const { n, f } = scaled(); const r = fit(n.gray, n.W, n.H, f); return finish(r.gray, r.W, r.H); } },
    { label: 'sharp', make: () => { const { n, f } = scaled(); const r = fit(n.gray, n.W, n.H, f); return finish(sharpen(r.gray, r.W, r.H), r.W, r.H); } },
    { label: 'bold', make: () => { const { n, f } = scaled(); const r = fit(n.gray, n.W, n.H, f); return finish(bolden(r.gray, r.W, r.H), r.W, r.H); } },
    { label: 'flipped', make: () => { const { n, f } = scaled(); const r = fit(invert(n.gray), n.W, n.H, f); return finish(r.gray, r.W, r.H); } },
    { label: 'small', make: () => { const { n, f } = scaled(); const r = fit(n.gray, n.W, n.H, f * 0.65); return finish(r.gray, r.W, r.H); } },
    { label: 'large', make: () => { const { n, f } = scaled(); const r = fit(n.gray, n.W, n.H, f * 1.5); return finish(r.gray, r.W, r.H); } },
  ];
}

module.exports = { variants, normalise, inkThreshold, sharpen, stripFlat, trimDark, bolden, glyphHeight, otsu, resize, hist, TARGET_BAND };

'use strict';
// Glyph judge: decides digit vs letter from the *shape and size* of each look-alike glyph
// (0/O/o, 1/l/I, 5/S/s, 8/B, 2/Z/z). Feature spec mirrors train/glyphfeat.py.
const fs = require('fs');
const path = require('path');

const GW = 12, GH = 16;
const AMBIG = '0Oo1lI5Ss8B2Zz';
const SURE_D = '34679';
const GROUPS = ['0Oo', '1lI', '5Ss', '8B', '2Zz'];
// In keys/codes a thin J often looks like a bracket: read it as J.
const CODE_PRE = { ')': 'J', ']': 'J', '}': 'J' };
const CODE_GROUPS = ['0O', '1I', '5S', '8B', '2Z']; // codes/keys: capitals and digits only

const wcache = new Map();
function wmat(L, n) {
  const key = L * 100 + n;
  let M = wcache.get(key);
  if (M) return M;
  M = new Float64Array(n * L);
  for (let k = 0; k < n; k++) {
    const a = (k * L) / n, b = ((k + 1) * L) / n;
    for (let p = Math.floor(a); p < Math.ceil(b) && p < L; p++) {
      M[k * L + p] = (Math.min(b, p + 1) - Math.max(a, p)) / (b - a);
    }
  }
  wcache.set(key, M);
  return M;
}

const median = (v) => {
  const s = [...v].sort((a, b) => a - b), n = s.length;
  return n % 2 ? s[(n - 1) / 2] : 0.5 * (s[n / 2 - 1] + s[n / 2]);
};
const clip = (v, lo = 0, hi = 4) => Math.min(hi, Math.max(lo, v));

function lineContext(boxes, chars) {
  const hs = boxes.map((b) => b[3] - b[1]), ws = boxes.map((b) => b[2] - b[0]);
  const refH = median(hs), refW = median(ws);
  const dw = ws.filter((_, i) => SURE_D.includes(chars[i]));
  const dh = hs.filter((_, i) => SURE_D.includes(chars[i]));
  return {
    refH, refW,
    dW: dw.length ? median(dw) : refW, dH: dh.length ? median(dh) : refH, dflag: dw.length ? 1 : 0,
  };
}

// gray: Float32Array/Uint8Array of W*H (0 = black ink, 255 = white page)
function features(gray, W, H, box, ctx, baseline) {
  const x0 = Math.max(0, box[0]), y0 = Math.max(0, box[1]);
  const x1 = Math.min(W, box[2]), y1 = Math.min(H, box[3]);
  const w = x1 - x0, h = y1 - y0;
  if (w < 1 || h < 1) return null;
  const Wy = wmat(h, GH), Wx = wmat(w, GW);
  const tmp = new Float64Array(GH * w);
  let sum = 0;
  const ink = new Float64Array(h * w);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) { const v = 1 - gray[(y0 + y) * W + x0 + x] / 255; ink[y * w + x] = v; sum += v; }
  }
  for (let r = 0; r < GH; r++) {
    for (let y = 0; y < h; y++) {
      const wy = Wy[r * h + y];
      if (!wy) continue;
      for (let x = 0; x < w; x++) tmp[r * w + x] += wy * ink[y * w + x];
    }
  }
  const out = new Float64Array(9 + GH * GW);
  out[0] = clip(w / h); out[1] = clip(h / ctx.refH); out[2] = clip(w / ctx.refW);
  out[3] = clip(w / ctx.dW); out[4] = clip(h / ctx.dH); out[5] = ctx.dflag;
  out[6] = clip((baseline - y0) / ctx.refH, -1, 3); out[7] = clip((y1 - baseline) / ctx.refH, -1, 3);
  out[8] = sum / (w * h);
  for (let r = 0; r < GH; r++) {
    for (let c = 0; c < GW; c++) {
      let s = 0;
      for (let x = 0; x < w; x++) s += tmp[r * w + x] * Wx[c * w + x];
      out[9 + r * GW + c] = s;
    }
  }
  return out;
}

// Stacked input: glyph geometry + what Tesseract itself decided (char, confidence, alternatives).
function buildInput(feat, sym) {
  const extra = new Float64Array(AMBIG.length * 2 + 1);
  const i = AMBIG.indexOf(sym.text);
  if (i >= 0) extra[i] = 1;
  extra[AMBIG.length] = (sym.confidence || 0) / 100;
  for (const c of sym.choices || []) {
    const j = AMBIG.indexOf(c.text);
    if (j >= 0) extra[AMBIG.length + 1 + j] = (c.confidence || 0) / 100;
  }
  const out = new Float64Array(feat.length + extra.length);
  out.set(feat); out.set(extra, feat.length);
  return out;
}

let model = null;
function loadModel(file = path.join(__dirname, 'glyph_model.json')) {
  if (!model) model = JSON.parse(fs.readFileSync(file, 'utf8'));
  return model;
}

function predict(feat) {
  const m = loadModel();
  let a = Float64Array.from(feat, (v, i) => (v - m.mean[i]) / m.std[i]);
  for (let l = 0; l < m.W.length; l++) {
    const W = m.W[l], b = m.b[l], nOut = b.length;
    const o = new Float64Array(nOut);
    for (let j = 0; j < nOut; j++) o[j] = b[j];
    for (let i = 0; i < a.length; i++) {
      const ai = a[i], row = W[i];
      if (ai) for (let j = 0; j < nOut; j++) o[j] += ai * row[j];
    }
    if (l < m.W.length - 1) for (let j = 0; j < nOut; j++) o[j] = Math.max(0, o[j]);
    a = o;
  }
  const mx = Math.max(...a);
  const e = a.map((v) => Math.exp(v - mx)), s = e.reduce((x, y) => x + y, 0);
  return e.map((v) => v / s);
}

// Pick the most likely member of the glyph's look-alike group.
function judge(ch, probs, minMargin = 0, groups = GROUPS) {
  const g = groups.find((x) => x.includes(ch));
  if (!g) return { ch, conf: 1 };
  const cand = [...g].map((c) => ({ c, p: probs[AMBIG.indexOf(c)] })).sort((a, b) => b.p - a.p);
  const total = cand.reduce((s, x) => s + x.p, 0) || 1;
  const own = cand.find((x) => x.c === ch).p;
  if (cand[0].c !== ch && cand[0].p - own < minMargin * total) {
    return { ch, conf: own / total, alt: cand.find((x) => x.c !== ch).c };
  }
  return { ch: cand[0].c, conf: cand[0].p / total, alt: cand[1].c };
}

function* symbolLines(data) {
  for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) {
    yield l.words.flatMap((w) => w.symbols);
  }
}

// Re-decides every look-alike glyph in a Tesseract result. Returns new text (same length).
// doubtBelow: glyphs decided with less confidence than this are reported in `doubts`
// (0.92 flags ~8% of look-alike glyphs and ~70% of the remaining errors on unseen fonts).
function refine(data, gray, W, H, { minMargin = 0, doubtBelow = 0.92, codes = false } = {}) {
  const groups = codes ? CODE_GROUPS : GROUPS;
  const text = data.text;
  if (codes) { // a bar standing alone (bubble edge, list marker) is noise, not an I
    for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) for (const w of l.words || []) {
      if (w.symbols.length > 1 || w.text === '|') for (const s of w.symbols) if (w.symbols.length > 1 && CODE_PRE[s.text]) { s._pre = s.text; s.text = CODE_PRE[s.text]; }
    }
  }
  const flat = [];
  const decisions = new Map();
  for (const syms of symbolLines(data)) {
    const alnum = syms.filter((s) => s.text.length === 1 && /[\p{L}\p{N}]/u.test(s.text));
    const boxes = alnum.map((s) => [s.bbox.x0, s.bbox.y0, s.bbox.x1, s.bbox.y1]);
    const ctx = alnum.length ? lineContext(boxes, alnum.map((s) => s.text)) : null;
    for (const s of syms) {
      flat.push(s);
      if (!ctx || !AMBIG.includes(s.text)) continue;
      const bl = s.baseline || { x0: 0, y0: s.bbox.y1, x1: 1, y1: s.bbox.y1 };
      const cx = (s.bbox.x0 + s.bbox.x1) / 2;
      const base = bl.x1 !== bl.x0 ? bl.y0 + ((bl.y1 - bl.y0) * (cx - bl.x0)) / (bl.x1 - bl.x0) : bl.y0;
      const f = features(gray, W, H, [s.bbox.x0, s.bbox.y0, s.bbox.x1, s.bbox.y1], ctx, base);
      if (f) decisions.set(s, judge(s.text, predict(buildInput(f, s)), minMargin, groups));
    }
  }
  const chars = [...text];
  const idx = [];
  chars.forEach((c, i) => { if (!/\s/.test(c)) idx.push(i); });
  if (idx.length !== flat.length) return { text, changes: [], doubts: [], aligned: false };
  const changes = [], doubts = [];
  flat.forEach((s, k) => {
    if (s._pre) chars[idx[k]] = s.text;
    const d = decisions.get(s);
    if (d && d.conf < doubtBelow) doubts.push({ pos: idx[k], ch: d.ch, alt: d.alt, conf: +d.conf.toFixed(3) });
    if (d && d.ch !== s.text) { changes.push({ pos: idx[k], from: s.text, to: d.ch, conf: d.conf }); chars[idx[k]] = d.ch; }
  });
  return { text: chars.join(''), changes, doubts, aligned: true };
}

module.exports = { CODE_GROUPS, refine, features, buildInput, symbolLines, predict, judge, lineContext, loadModel, AMBIG, GROUPS };

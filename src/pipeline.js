'use strict';
// Recognition pipeline: general pass -> (auto) code detection -> whitelist pass -> glyph judge
// -> re-check of lines that break the list's common shape (e.g. a dropped character).
const glyph = require('./glyph');
const wordfix = require('./wordfix');
const pre = require('./preprocess');

const CODE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-)]}'; // )]} are thin J glyphs, mapped back to J in glyph.refine
const shapeOf = (line) => line.replace(/[A-Z0-9]/g, 'X');
const lines = (t) => t.split('\n').map((l) => l.trim()).filter(Boolean);

// Dash-grouped codes such as XXXXX-XXXXX-XXXXX (keys, serials). Tolerant to OCR noise
// (stray | ) characters, a few lowercase mistakes), but not to ordinary hyphenated words.
function looksLikeCodes(text) {
  const toks = text.split(/\s+/).filter((t) => t.length >= 6);
  if (!toks.length) return false;
  const code = toks.filter((t) => /^\W*[A-Za-z0-9|)(]{3,}(-[A-Za-z0-9|)(]{2,})+\W*$/.test(t) && !/[a-z]{3,}/.test(t));
  return code.length >= 1 && code.length / toks.length >= 0.6;
}

function dominantShape(ls) {
  const counts = new Map();
  for (const l of ls) counts.set(shapeOf(l), (counts.get(shapeOf(l)) || 0) + 1);
  const [shape, n] = [...counts].sort((a, b) => b[1] - a[1])[0] || ['', 0];
  return n >= 3 && n >= 0.6 * ls.length ? shape : null;
}

// The glyph judge is tuned for codes/keys. Inside ordinary words (brOwn, cOnverted) and inside pure
// numbers or pure letter tokens (4821 -> 482I) it only does harm, so its decisions there are undone;
// it keeps deciding mixed tokens (digits next to letters), which is where 0/O and 1/I really clash.
function gateJudge(rawText, r) {
  const orig = [...rawText], chars = [...r.text];
  if (orig.length !== chars.length) return r;
  const undo = new Set();
  const re = /[\p{L}\p{N}]+/gu;
  const flat = orig.join('');
  let m;
  while ((m = re.exec(flat))) {
    const start = [...flat.slice(0, m.index)].length, len = [...m[0]].length;
    const tok = m[0], word = len >= 2 && /\p{Ll}/u.test(tok), pure = !(/\p{N}/u.test(tok) && /\p{L}/u.test(tok));
    if (word || pure) for (let i = start; i < start + len; i++) undo.add(i);
  }
  for (const c of r.changes) if (undo.has(c.pos)) chars[c.pos] = orig[c.pos];
  return { ...r, text: chars.join(''), changes: r.changes.filter((c) => !undo.has(c.pos)), doubts: r.doubts.filter((d) => !undo.has(d.pos)) };
}

// ---- tiny image helpers (gray Uint8Array) ----
function resize(g, w, h, nw, nh) {
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

function crop(g, w, x0, y0, x1, y1, pad) {
  const cw = x1 - x0 + 2 * pad, ch = y1 - y0 + 2 * pad;
  const out = new Uint8Array(cw * ch).fill(255);
  for (let y = 0; y < y1 - y0; y++) for (let x = 0; x < x1 - x0; x++) out[(y + pad) * cw + x + pad] = g[(y0 + y) * w + x0 + x];
  return { gray: out, w: cw, h: ch };
}

// 8-bit grayscale BMP (Tesseract reads it directly, no PNG encoder needed)
function bmp(gray, w, h) {
  const row = (w + 3) & ~3, size = 54 + 1024 + row * h, b = Buffer.alloc(size);
  b.write('BM', 0); b.writeUInt32LE(size, 2); b.writeUInt32LE(54 + 1024, 10); b.writeUInt32LE(40, 14);
  b.writeInt32LE(w, 18); b.writeInt32LE(h, 22); b.writeUInt16LE(1, 26); b.writeUInt16LE(8, 28); b.writeUInt32LE(256, 46);
  for (let i = 0; i < 256; i++) { const o = 54 + i * 4; b[o] = b[o + 1] = b[o + 2] = i; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) b[54 + 1024 + (h - 1 - y) * row + x] = gray[y * w + x];
  return b;
}

// Shape to enforce: the list's dominant shape, or (short lists) a repeated shape with equal groups.
function targetShape(ls) {
  const dom = dominantShape(ls);
  if (dom) return dom;
  const counts = new Map();
  for (const l of ls) counts.set(shapeOf(l), (counts.get(shapeOf(l)) || 0) + 1);
  const [shape, n] = [...counts].filter(([sh]) => /^X{3,}(-X{3,})+$/.test(sh) && new Set(sh.split('-').map((g) => g.length)).size === 1)
    .sort((a, b) => b[1] - a[1])[0] || ['', 0];
  return n >= 2 && n >= 0.25 * ls.length ? shape : null;
}

// Restore dropped dashes and cut stray edge glyphs (bubble borders) so a line fits the list's shape.
function repairLine(line, shape) {
  if (shapeOf(line) === shape) return line;
  let a = line.replace(/[^A-Z0-9]/g, '');
  const exp = (shape.match(/X/g) || []).length;
  if (a.length < exp || a.length - exp > 3) return line;
  a = a.slice(0, exp); // stray glyphs are almost always at the end (right-hand border)
  let i = 0;
  return [...shape].map((c) => (c === 'X' ? a[i++] : c)).join('');
}

async function recheck(ls, bboxes, shape, gray, W, H, recognize, opts) {
  const fixed = [...ls];
  for (let i = 0; i < ls.length; i++) {
    if (shapeOf(ls[i]) === shape || !bboxes[i]) continue;
    const b = bboxes[i], lh = b.y1 - b.y0;
    const x0 = Math.max(0, b.x0 - lh), x1 = Math.min(W, b.x1 + lh), y0 = Math.max(0, b.y0 - Math.round(lh * 0.4)), y1 = Math.min(H, b.y1 + Math.round(lh * 0.4));
    const votes = new Map();
    let settled = null;
    outer:
    for (const f of [0.8, 1, 1.33]) {
      const c0 = crop(gray, W, x0, y0, x1, y1, 0);
      const nw = Math.round(c0.w * f), nh = Math.round(c0.h * f);
      const sc = f === 1 ? c0 : { gray: resize(c0.gray, c0.w, c0.h, nw, nh), w: nw, h: nh };
      const padded = crop(sc.gray, sc.w, 0, 0, sc.w, sc.h, Math.round(8 * Math.max(1, f)));
      for (const psm of ['7', '8']) {
        let data;
        try { data = await recognize(bmp(padded.gray, padded.w, padded.h), { ...opts, psm, whitelist: CODE_CHARS }); } catch { continue; }
        let t = data.text.trim().split('\n')[0] || '';
        const r = glyph.refine(data, padded.gray, padded.w, padded.h, { codes: true });
        if (r.aligned) t = r.text.trim().split('\n')[0] || t;
        if (shapeOf(t) === shape) {
          votes.set(t, (votes.get(t) || 0) + 1);
          if ((votes.get(t) || 0) >= 2) { settled = t; break outer; } // 2 matching reads: enough
        }
      }
    }
    fixed[i] = settled || (votes.size ? [...votes].sort((a, b) => b[1] - a[1])[0][0] : ls[i]);
  }
  return fixed;
}

const chars = (t) => (t.match(/\S/g) || []).length;
const cleanEdges = (l) => l.replace(/^\s*[|¦\[\]{}]+\s+/, '').replace(/\s+[|¦\[\]{}]+\s*$/, '');

// How good is a result? Empty text scores -1. Otherwise: Tesseract's confidence of the first (free) pass,
// plus a bonus when code lines all share one shape (XXXX-XXXX-XXXX), damped for very short reads.
// (In code mode the whitelisted pass reports no usable confidence, hence the first pass.)
function scoreOf(res) {
  const n = chars(res.refined);
  if (!n) return -1;
  let s = res.conf0 || 0;
  if (res.codes) {
    const ls = lines(res.refined);
    const shapes = new Set(ls.map(shapeOf));
    if (ls.length && shapes.size === 1 && n >= 8) s += 30;
  }
  return Math.min(100, s) * Math.min(1, n / 6);
}

// Per-position vote among code readings that share one shape (e.g. 4-4-4-4): each variant misreads
// different characters, together they usually give the right key. Ties go to the earliest (best) reading.
function voteCodes(cands) {
  const shapeKey = (r) => lines(r.refined).map(shapeOf).join('|');
  const tally = new Map();
  for (const c of cands) tally.set(shapeKey(c), (tally.get(shapeKey(c)) || 0) + 1);
  const [key, count] = [...tally.entries()].sort((x, y) => y[1] - x[1])[0] || [];
  if (!key || count < 2) return null;
  const group = cands.filter((c) => shapeKey(c) === key);
  const rows = group.map((c) => lines(c.refined).map((l) => [...l]));
  return rows[0].map((line, li) => line.map((_, ci) => {
    const votes = new Map();
    rows.forEach((r) => votes.set(r[li][ci], (votes.get(r[li][ci]) || 0) + 1));
    let best = rows[0][li][ci], n = 0;
    for (const [ch, v] of votes) if (v > n) { best = ch; n = v; }
    return best;
  }).join('')).join('\n');
}

// With prep=true the image is normalised first (flat margins, polarity, frame, scale). The first two
// variants (normal, sharpened) are compared on small images (cheap) or when the first is unsure; a
// shorter reading loses to a more complete one of similar confidence (a dropped word is not "confident").
// Code lists are read by several variants and voted per character. Weak or empty results fall through
// to bolder strokes, flipped polarity and other scales.
async function run(args) {
  if (!args.prep || !args.gray) return runOne(args);
  const vs = pre.variants(args.gray, args.W, args.H);
  const small = args.W * args.H < 600000;
  const all = [];
  const codeCands = () => all.filter((r) => r.codes && chars(r.refined) >= 8 && lines(r.refined).every((l) => shapeOf(l) === shapeOf(lines(r.refined)[0])));
  for (let i = 0; i < vs.length; i++) {
    let im;
    try { im = vs[i].make(); } catch { continue; }
    let res;
    try { res = await runOne({ ...args, buf: bmp(im.gray, im.W, im.H), gray: im.gray, W: im.W, H: im.H }); } catch { continue; }
    res.variant = vs[i].label;
    res.score = scoreOf(res);
    all.push(res);
    const top = Math.max(...all.map((r) => r.score));
    const codesNow = all.some((r) => r.codes);
    if (i === 0 && (small || res.conf0 < 85 || res.codes)) continue; // compare with the sharpened variant
    if (codesNow && codeCands().length < 3 && i < vs.length - 1) continue; // gather voters
    if (top >= 65) break;
  }
  if (!all.length) return runOne(args);
  const voters = codeCands();
  if (voters.length >= 2) {
    const voted = voteCodes(voters);
    const lead = voters.slice().sort((x, y) => y.score - x.score)[0];
    if (voted) return { ...lead, refined: voted, doubts: [], variant: `${lead.variant}+vote` };
  }
  // text: among readings of comparable confidence prefer the most complete
  const topConf = Math.max(...all.filter((r) => chars(r.refined)).map((r) => r.conf0 || 0), 0);
  const comparable = all.filter((r) => chars(r.refined) && (r.conf0 || 0) >= topConf - 12);
  const maxN = Math.max(1, ...comparable.map((r) => chars(r.refined)));
  const rank = (r) => { const n = chars(r.refined); return n ? (r.conf0 || 0) * Math.min(1, n / 6) * Math.min(1, n / maxN) ** 2 : -1; };
  return all.slice().sort((x, y) => rank(y) - rank(x))[0];
}

// recognize(buffer, {langs, psm, whitelist}) -> tesseract data. gray: Uint8Array W*H of the same image.
async function runOne({ buf, gray, W, H, kind = 'auto', langs, psm, recognize }) {
  const opts = { langs, psm };
  let data = await recognize(buf, opts);
  const conf0 = data.confidence;
  let raw = data.text.replace(/\s+$/, '');
  let codes = kind === 'codes' || (kind === 'auto' && looksLikeCodes(raw));
  if (codes && (kind === 'codes' || data.confidence >= 0 )) {
    data = await recognize(buf, { ...opts, psm: kind === 'codes' && psm === '3' ? '6' : psm, whitelist: CODE_CHARS });
    raw = data.text.replace(/\s+$/, '');
  }
  let refined = raw, changes = [], doubts = [];
  if (gray) {
    let r = glyph.refine(data, gray, W, H, { codes });
    if (r.aligned && !codes) r = gateJudge(data.text, r);
    if (r.aligned) { refined = r.text.replace(/\s+$/, ''); changes = r.changes; doubts = r.doubts; }
  }
  let wordChanges = [];
  if (!codes) { const w = wordfix.fixText(refined); refined = w.text.split('\n').map(cleanEdges).join('\n'); wordChanges = w.changes; }
  if (codes) refined = refined.split('\n').map((l) => l.replace(/(^|\s)[|)\]}]+(?=\s|$)/g, ' ').trim().replace(/\s{2,}/g, ' ')).join('\n');
  if (codes && gray) {
    let ls = lines(refined);
    const shape = targetShape(ls);
    if (shape && ls.some((l) => shapeOf(l) !== shape)) {
      // 1) re-read the odd lines at other scales / modes and vote
      const boxes = [];
      for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) boxes.push(l.bbox);
      if (boxes.length === ls.length) {
        ls = await recheck(ls, boxes, shape, gray, W, H, recognize, opts);
        doubts = [];
      }
      // 2) whatever still breaks the shape: restore dropped dashes, cut stray edge glyphs
      ls = ls.map((l) => repairLine(l, shape));
      refined = ls.join('\n');
    }
  }
  return { raw, refined, changes, doubts, codes, data, wordChanges, conf0 };
}

module.exports = { run, runOne, gateJudge, looksLikeCodes, shapeOf, dominantShape, CODE_CHARS };

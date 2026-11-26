'use strict';
// Repairs typical OCR confusions inside WORDS, backed by frequency dictionaries (src/words.json):
//  - Latin/Cyrillic look-alikes mixed in one word  (Oплата -> Оплата, hello written with Cyrillic е/о)
//  - digits or bars read instead of letters        (rep0rt -> report, Pre55 -> Press, t0taI -> total)
//  - stray capitals in the middle of a word        (brOwn -> brown)
// A change is made only when the result is a known word and the original is not (or, for case, when
// the lower-case form is a known word), so names, codes, numbers and unknown jargon are left alone.
const fs = require('fs');
const path = require('path');

let D = null;
const norm = (w) => w.replace(/ё/g, 'е');
function dict() {
  if (D) return D;
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'words.json'), 'utf8'));
  D = {};
  for (const lang of ['en', 'ru']) {
    const m = new Map();
    raw[lang].split(' ').forEach((w, i) => { const k = lang === 'ru' ? norm(w) : w; if (!m.has(k)) m.set(k, i); });
    D[lang] = m;
  }
  return D;
}
const rank = (lang, w) => { const r = dict()[lang].get(lang === 'ru' ? norm(w) : w); return r === undefined ? -1 : r; };
const known = (lang, w) => { if (lang === 'en' && EXTRA.includes(w)) return true; const r = rank(lang, w); return r >= 0 && (w.length > 3 || r < 3000); };

// not in frequency lists but common on screens: counted as known words
const EXTRA = 'ctrl alt shift enter esc tab del ins win fn pdf png jpg jpeg gif zip rar exe dll txt doc docx xls xlsx ppt csv json xml html css url api sql usb wifi http https www app ok'.split(' ');
const LAT_ALT = { r: ['n'], n: ['r', 'h'], c: ['e'], e: ['c', 'o'], l: ['i', 't'], i: ['l', 'j'], u: ['v'], v: ['u'], a: ['o', 'e'], o: ['a', 'e'], h: ['b', 'n'], b: ['h'], m: ['n'], g: ['q'], q: ['g'] };
const LAT2CYR = { a: 'а', c: 'с', e: 'е', o: 'о', p: 'р', x: 'х', y: 'у', A: 'А', B: 'В', C: 'С', E: 'Е', H: 'Н', K: 'К', M: 'М', O: 'О', P: 'Р', T: 'Т', X: 'Х' };
const CYR2LAT = Object.fromEntries(Object.entries(LAT2CYR).map(([l, c]) => [c, l]));
const DIG_LAT = { 0: ['o'], 1: ['l', 'i'], 5: ['s'], 8: ['b'], 2: ['z'], '|': ['l', 'i'], I: ['l', 'i'] };
const DIG_CYR = { 0: ['о'], 3: ['з'], 6: ['б'] };
const CASEAMB = new Set('OSVWXZCUKP');
const isCyr = (c) => /[\u0400-\u04FF]/.test(c);
const isLat = (c) => /[A-Za-z]/.test(c);
const isUp = (c) => c !== c.toLowerCase();
const letters = (cs) => cs.filter((c) => /\p{L}/u.test(c));

// all ways to read some characters as other letters (at most `max` substitutions)
function* variants(cs, alts, max) {
  const pos = cs.map((_, i) => i).filter((i) => alts[i] && alts[i].length).slice(0, 8);
  const rec = function* (start, left, cur) {
    for (let k = start; k < pos.length; k++) {
      for (const a of alts[pos[k]]) {
        const next = cur.slice(); next.push([pos[k], a]);
        yield next;
        if (left > 1) yield* rec(k + 1, left - 1, next);
      }
    }
  };
  yield* rec(0, max, []);
}

// brand names that legitimately have capitals inside (kept as the OCR wrote them)
const KEEP = new Set(('iphone ipad ipod imac ios macos ebay youtube github gitlab linkedin powerpoint javascript typescript '
  + 'wordpress playstation xbox paypal whatsapp facebook instagram tiktok openai chatgpt vscode nvidia').split(' '));

function lowerInterior(cs, lang) { // brOwn -> brown, fOx -> fox: look-alike capitals after a lower-case start
  if (cs.length < 3 || /\p{Lu}/u.test(cs[0]) === false && cs.length < 3) return cs;
  const rest = cs.slice(1);
  if (!rest.some((c) => /\p{Ll}/u.test(c))) return cs;
  if (rest.some((c) => /\p{Lu}/u.test(c) && !CASEAMB.has(c))) return cs; // CamelCase (GitHub, TextSnip)
  if (cs.length === 3 && /\p{Lu}/u.test(cs[2])) return cs; // iOS, mAP-like shapes
  const low = cs.join('').toLowerCase();
  if (KEEP.has(low) || rank(lang, low) < 0) return cs;
  return [cs[0], ...rest.map((c) => (CASEAMB.has(c) ? c.toLowerCase() : c))];
}

function fixToken(tok, ctx) {
  const cs = [...tok];
  const L = letters(cs);
  if (!L.length) return tok; // numbers
  const cyr = L.filter(isCyr).length, lat = L.filter(isLat).length;
  let out = cs;

  // 1) one word written in two alphabets -> the majority alphabet (or the line's)
  if (cyr && lat) {
    const target = cyr > lat ? 'cyr' : lat > cyr ? 'lat' : ctx.script;
    if (!target) return tok;
    const map = target === 'cyr' ? LAT2CYR : CYR2LAT;
    const wrong = target === 'cyr' ? isLat : isCyr;
    if (L.filter(wrong).every((c) => map[c])) out = cs.map((c) => (wrong(c) ? map[c] : c));
    else return tok;
  } else if (L.length >= 3 && L.every((c) => (isLat(c) ? LAT2CYR[c] : false)) && ctx.script === 'cyr'
    && !known('en', tok.toLowerCase()) && known('ru', [...tok].map((c) => LAT2CYR[c]).join('').toLowerCase())) {
    out = cs.map((c) => LAT2CYR[c]); // a Russian word typed in look-alike Latin letters
  } else if (L.length >= 3 && L.every((c) => (isCyr(c) ? CYR2LAT[c] : false)) && ctx.script === 'lat'
    && !known('ru', tok.toLowerCase()) && known('en', [...tok].map((c) => CYR2LAT[c]).join('').toLowerCase())) {
    out = cs.map((c) => CYR2LAT[c]); // an English word typed in look-alike Cyrillic letters
  }

  // 2) digits / bars read instead of letters, validated by the dictionary
  const L2 = letters(out);
  const lang = L2.some(isCyr) ? 'ru' : L2.length ? 'en' : null;
  const word = out.join('');
  if (lang && L2.length >= 1 && out.length >= 2 && out.length <= 24 && !/^[\p{Lu}\p{N}]+$/u.test(word) && !known(lang, word.toLowerCase())) {
    const table = lang === 'ru' ? DIG_CYR : DIG_LAT;
    const alts = out.map((c) => (table[c] ? table[c] : null));
    let best = null;
    for (const sub of variants(out, alts, 4)) {
      const t = out.slice(); for (const [i, a] of sub) t[i] = a;
      const low = t.join('').toLowerCase();
      if (!/^\p{L}+$/u.test(low) || !known(lang, low)) continue;
      const score = sub.length * 100000 + rank(lang, low);
      if (!best || score < best.score) best = { score, sub };
    }
    if (best) {
      const t = out.slice();
      const allUp = L2.length >= 2 && L2.every(isUp);
      for (const [i, a] of best.sub) {
        const orig = out[i];
        t[i] = allUp || (i === 0 && ctx.atStart) || (/\p{L}/u.test(orig) && isUp(orig) && i === 0 && ctx.atStart) ? a.toUpperCase() : a;
      }
      out = t;
    }
  }

  // 2b) one letter misread as a similar one (guick -> quick): unique, common, 4+ letters, original unknown
  if (lang === 'en' && out.length >= 4 && out.length <= 16 && /^\p{L}+$/u.test(out.join('')) && !/\p{Lu}.*\p{Lu}/u.test(out.join(''))) {
    const cur = out.join('');
    if (!known('en', cur.toLowerCase())) {
      const hits = [];
      const lowc = [...cur.toLowerCase()];
      for (let i = 0; i < lowc.length; i++) for (const a of LAT_ALT[lowc[i]] || []) {
        const t = lowc.slice(); t[i] = a;
        const cand = t.join('');
        if ((EXTRA.includes(cand) || (rank('en', cand) >= 0 && rank('en', cand) < 8000))) hits.push({ i, a, cand });
      }
      const uniq = [...new Set(hits.map((h) => h.cand))];
      if (uniq.length === 1) { const h = hits[0]; out = out.slice(); out[h.i] = isUp(out[h.i]) ? h.a.toUpperCase() : h.a; }
    }
  }

  // 3) look-alike capitals in the middle of a known word
  const final = out.join('');
  if (lang) { const lowerIn = lowerInterior(out, lang).join(''); if (lowerIn !== final) out = [...lowerIn]; }
  return out.join('');
}

function scriptOf(line) {
  const L = letters([...line]);
  if (L.length < 3) return null;
  const c = L.filter(isCyr).length / L.length;
  return c > 0.6 ? 'cyr' : c < 0.4 ? 'lat' : null;
}

function fixLine(line) {
  const script = scriptOf(line);
  const changes = [];
  let first = true;
  const out = line.replace(/[\p{L}\p{N}]+/gu, (tok, off, str) => {
    const before = str.slice(0, off).replace(/\s+$/, '');
    const atStart = first || /[.!?:]["»”)]?$/.test(before) || before === '';
    first = false;
    const fixed = fixToken(tok, { script, atStart });
    if (fixed !== tok) changes.push({ from: tok, to: fixed });
    return fixed;
  });
  return { text: out, changes };
}

const NUMLET = { I: '1', l: '1', '|': '1', O: '0', o: '0', S: '5', B: '8', Z: '2' };
// 03/II/2026 -> 03/11/2026, 2O26 -> 2026, 1S.03 -> 15.03: a chain of tokens joined by . / : - , that
// contains at least two pure numbers is numeric, so look-alike letters inside it are digits.
function fixNumbers(line) {
  return line.replace(/[\p{L}\p{N}|]+(?:[./:,-][\p{L}\p{N}|]+)+/gu, (chain) => {
    const toks = chain.split(/([./:,-])/);
    const isNum = (t) => /^\d+$/.test(t);
    const numLike = (t) => /^[IlOoSBZ|\d]+$/.test(t) && /\d/.test(t) || /^[IlOoSBZ|]{1,2}$/.test(t);
    const even = toks.filter((_, i) => i % 2 === 0);
    if (even.filter(isNum).length < 1 || even.filter(numLike).length < 2 || even.some((t) => !numLike(t) && !/^[\p{L}]{0,2}$/u.test(t) && false)) return chain;
    return toks.map((t, i) => (i % 2 === 1 || isNum(t) || t.length > 6 || !/^[IlOoSBZ|\d]+$/.test(t) ? t : [...t].map((c) => NUMLET[c] || c).join(''))).join('');
  });
}

function fixText(text) {
  const changes = [];
  const out = text.split('\n').map((l) => { const r = fixLine(fixNumbers(l)); changes.push(...r.changes); return r.text; }).join('\n');
  return { text: out, changes };
}

module.exports = { fixText, fixLine, fixToken, known, rank };

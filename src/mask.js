'use strict';
// Hides things that should not end up in a clipboard, history or notification by accident:
// bank card numbers (Luhn-checked), IBANs (mod-97 checked), e-mail addresses, API keys / tokens
// and values after "password:" style labels. Numbers, dates, phone numbers and codes stay readable.
const DOTS = '••••';

const luhn = (d) => { let s = 0, alt = false; for (let i = d.length - 1; i >= 0; i--) { let n = +d[i]; if (alt) { n *= 2; if (n > 9) n -= 9; } s += n; alt = !alt; } return s % 10 === 0; };
const iban97 = (s) => {
  const t = s.slice(4) + s.slice(0, 4); let rem = 0;
  for (const ch of t) { const v = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55); for (const c of v) rem = (rem * 10 + Number(c)) % 97; }
  return rem === 1;
};

function maskSensitive(text) {
  let count = 0;
  let t = String(text);
  const mark = (s) => { count++; return s; };

  t = t.replace(/\b(?:\d[ -]?){13,19}\b/g, (m) => {
    const trail = m.match(/[ -]*$/)[0], d = m.replace(/\D/g, '');
    return d.length >= 13 && d.length <= 19 && luhn(d) ? mark(`${DOTS} ${DOTS} ${DOTS} ${d.slice(-4)}${trail}`) : m;
  });
  t = t.replace(/\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?\b/g, (m) => {
    const s = m.replace(/ /g, '');
    return s.length >= 15 && s.length <= 34 && iban97(s) ? mark(`${s.slice(0, 4)} ${DOTS} ${DOTS} ${s.slice(-4)}`) : m;
  });
  t = t.replace(/\b([\w.+-])[\w.+-]*@([\w-]+(?:\.[\w-]+)+)\b/g, (_m, a, dom) => mark(`${a}•••@${dom}`));
  const tokens = [
    /\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}\b/g, /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g, /\bgithub_pat_\w{30,}\b/g,
    /\bAKIA[0-9A-Z]{16}\b/g, /\bsk-[A-Za-z0-9_-]{20,}/g, /\bxox[baprs]-[\w-]{10,}/g,
  ];
  for (const re of tokens) t = t.replace(re, () => mark(`${DOTS}${DOTS}`));
  t = t.replace(/\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/g, () => mark(`Bearer ${DOTS}${DOTS}`));
  t = t.replace(/((?<![\p{L}\p{N}_])(?:пароль|password|passwd|pwd|pass|token|токен|secret|секрет)\s*[:=]\s*)(\S+)/giu, (_m, label) => mark(`${label}${DOTS}${DOTS}`));
  t = t.replace(/\b(?=[A-Za-z0-9+/_-]*\d)(?=[A-Za-z0-9+/_-]*[A-Za-z])[A-Za-z0-9+/_-]{40,}\b/g, () => mark(`${DOTS}${DOTS}`));
  return { text: t, count };
}

module.exports = { maskSensitive, luhn, iban97 };

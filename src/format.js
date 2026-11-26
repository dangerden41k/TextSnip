'use strict';
// Copy formats for running text (never applied to code lists):
//   keep       - as recognised
//   oneline    - everything in one line
//   paragraphs - wrapped lines joined into paragraphs, blank lines kept, list items stay on their own lines
// In both joined modes a word split by a hyphen at a line end is glued back (про-\nдолжение -> продолжение).
const BULLET = /^\s*(?:[-•*–—]\s|\d{1,3}[.)]\s)/;

function join(lines) {
  let out = '';
  for (const raw of lines) {
    const l = raw.trim();
    if (!l) continue;
    if (!out) out = l;
    else if (/\p{L}-$/u.test(out) && /^\p{Ll}/u.test(l)) out = out.slice(0, -1) + l;
    else out += ' ' + l;
  }
  return out.replace(/[ \t]{2,}/g, ' ');
}

function formatText(text, mode) {
  if (mode !== 'oneline' && mode !== 'paragraphs') return text;
  const lines = String(text).split('\n');
  if (mode === 'oneline') return join(lines);
  const out = []; let cur = [], gap = false;
  const flush = () => { if (cur.length) { if (gap && out.length) out.push(''); out.push(join(cur)); cur = []; gap = false; } };
  for (const l of lines) {
    if (!l.trim()) { flush(); gap = true; } else if (BULLET.test(l)) { flush(); cur.push(l); } else cur.push(l);
  }
  flush();
  return out.join('\n');
}

module.exports = { formatText };

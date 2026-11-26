'use strict';
// Online translation (opt-in, the only feature that needs internet).
// Primary: Google's public "gtx" endpoint. Fallback: MyMemory.
const TIMEOUT = 12000;

async function post(url, body) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const r = await fetch(url, {
      method: 'POST', signal: ctl.signal,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' }, body,
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

function chunks(text, max) {
  const out = []; let cur = '';
  for (const line of text.split('\n')) {
    if (cur && cur.length + line.length + 1 > max) { out.push(cur); cur = line; } else cur = cur ? `${cur}\n${line}` : line;
  }
  if (cur) out.push(cur);
  return out;
}

async function google(text, to) {
  let from = '';
  const parts = [];
  for (const c of chunks(text, 1800)) {
    const d = await post(`https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${to}&dt=t`, `q=${encodeURIComponent(c)}`);
    parts.push((d[0] || []).map((x) => x[0]).join(''));
    from = from || d[2] || '';
  }
  return { text: parts.join('\n'), from };
}

async function myMemory(text, to) {
  const parts = [];
  for (const c of chunks(text, 400)) {
    const r = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(c)}&langpair=Autodetect|${to}`);
    const d = await r.json();
    if (d.responseStatus && Number(d.responseStatus) !== 200) throw new Error(d.responseDetails || 'MyMemory error');
    parts.push(d.responseData.translatedText);
  }
  return { text: parts.join('\n'), from: '' };
}

async function translate(text, to = 'ru') {
  if (!text.trim()) return { text: '', from: '' };
  try {
    let res = await google(text, to);
    if (res.from === to) res = await google(text, to === 'en' ? 'ru' : 'en'); // already in that language
    return res;
  } catch (e1) {
    try { return await myMemory(text, to); } catch (e2) { throw new Error('Нет связи с сервисом перевода'); }
  }
}

module.exports = { translate, chunks };

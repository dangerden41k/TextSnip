const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const u = require('../src/updater');

const REL = 'https://github.com/me/textsnip/releases/download/v1.4.0/';
const SHA = 'a'.repeat(64);
const release = (extra = {}) => ({
  tag_name: 'v1.4.0', body: 'fixes', html_url: 'https://github.com/me/textsnip/releases/tag/v1.4.0',
  assets: [
    { name: 'notes.txt', browser_download_url: `${REL}notes.txt` },
    { name: 'TextSnip.exe', browser_download_url: `${REL}TextSnip.exe`, digest: `sha256:${SHA}` },
    { name: 'TextSnip.exe.sha256', browser_download_url: `${REL}TextSnip.exe.sha256` },
  ], ...extra,
});
const fakeApi = (data) => async () => ({ ok: true, json: async () => data });

test('version compare', () => {
  assert.equal(u.cmp('1.10.0', '1.9.9'), 1);
  assert.equal(u.cmp('v1.2.0', '1.2'), 0);
  assert.equal(u.cmp('1.2.0', '1.3.0'), -1);
});
test('endpoint accepts only owner/repo', () => {
  assert.match(u.endpoint('me/textsnip').url, /api\.github\.com\/repos\/me\/textsnip\/releases\/latest/);
  assert.equal(u.endpoint('https://x.io/latest.json'), null);
  assert.equal(u.endpoint('not a repo'), null);
  assert.equal(u.endpoint('../../etc/passwd'), null);
});
test('github release is parsed and compared', async () => {
  const r = await u.check('me/textsnip', '1.2.0', fakeApi(release()));
  assert.equal(r.newer, true); assert.equal(r.version, '1.4.0');
  assert.equal(r.url, `${REL}TextSnip.exe`); assert.equal(r.sha256, SHA); assert.equal(r.shaUrl, `${REL}TextSnip.exe.sha256`);
  assert.equal((await u.check('me/textsnip', '1.4.0', fakeApi(release()))).newer, false);
});
test('assets from another repo or host are ignored', async () => {
  const evil = release({ assets: [{ name: 'TextSnip.exe', browser_download_url: 'https://evil.example/TextSnip.exe' },
    { name: 'TextSnip.exe', browser_download_url: 'https://github.com/other/repo/releases/download/v9/TextSnip.exe' }] });
  assert.equal((await u.check('me/textsnip', '1.0.0', fakeApi(evil))).url, '');
});
test('a foreign page url is replaced by the repo release page', async () => {
  const r = await u.check('me/textsnip', '1.0.0', fakeApi(release({ html_url: 'https://evil.example/x' })));
  assert.equal(r.page, 'https://github.com/me/textsnip/releases/latest');
});
test('swap script waits, moves, restarts, deletes itself', () => {
  const s = u.swapScript('C:\\a\\new.exe', 'C:\\a\\TextSnip.exe');
  assert.match(s, /move \/Y "C:\\a\\new\.exe" "C:\\a\\TextSnip\.exe"/);
  assert.match(s, /start "" "C:\\a\\TextSnip\.exe"/);
  assert.match(s, /del "%~f0"/);
});
test('swap script neutralises %VAR% and refuses quotes in paths', () => {
  assert.match(u.swapScript('C:\\a\\n.exe', 'C:\\100%\\T.exe'), /"C:\\100%%\\T\.exe"/);
  assert.throws(() => u.swapScript('C:\\a\\n.exe', 'C:\\a"&calc&"\\T.exe'), /unsafe/);
});
test('downloads only from github over https, and need a checksum', async () => {
  await assert.rejects(u.download('http://github.com/a.exe', '/tmp/a.exe', { sha256: SHA }), /https/);
  await assert.rejects(u.download('https://evil.example/a.exe', '/tmp/a.exe', { sha256: SHA }), /GitHub/);
  await assert.rejects(u.download(`${REL}TextSnip.exe`, '/tmp/a.exe', {}), /checksum/);
});

const body = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(5 * 1024 * 1024 + 16, 7)]);
const okFetch = async () => ({ ok: true, url: `${REL}TextSnip.exe`, headers: new Headers({ 'content-length': String(body.length) }), body: new Response(body).body });
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ts-')), 'TextSnip.update.exe');

test('download verifies the SHA-256 and keeps a good file', async () => {
  const dest = tmp();
  await u.download(`${REL}TextSnip.exe`, dest, { sha256: crypto.createHash('sha256').update(body).digest('hex'), fetchFn: okFetch });
  assert.equal(fs.statSync(dest).size, body.length);
});
test('download with a wrong checksum is deleted and rejected', async () => {
  const dest = tmp();
  await assert.rejects(u.download(`${REL}TextSnip.exe`, dest, { sha256: SHA, fetchFn: okFetch }), /checksum mismatch/);
  assert.equal(fs.existsSync(dest), false);
});
test('a redirect to a foreign host is rejected', async () => {
  const evilFetch = async () => ({ ok: true, url: 'https://evil.example/x.exe', headers: new Headers(), body: new Response(body).body });
  await assert.rejects(u.download(`${REL}TextSnip.exe`, tmp(), { sha256: SHA, fetchFn: evilFetch }), /untrusted redirect/);
});
test('fetchSha reads the digest and refuses junk', async () => {
  const mk = (t) => async () => ({ ok: true, url: `${REL}TextSnip.exe.sha256`, text: async () => t });
  assert.equal(await u.fetchSha(`${REL}TextSnip.exe.sha256`, mk(`${SHA}  TextSnip.exe\n`)), SHA);
  await assert.rejects(u.fetchSha(`${REL}TextSnip.exe.sha256`, mk('<html>')), /bad checksum/);
  await assert.rejects(u.fetchSha('https://evil.example/x', mk(SHA)), /untrusted/);
});

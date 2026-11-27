'use strict';
// Self-update for the portable exe. The app polls the latest GitHub Release of the configured
// "owner/repo", downloads TextSnip.exe, verifies its SHA-256 and swaps it in after the app exits.
// Hardening: only owner/repo sources, only https downloads from GitHub hosts, asset must belong to
// that repo, and an install is refused unless a SHA-256 for the exact file is known.
const fs = require('fs');
const crypto = require('crypto');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const HOSTS = new Set(['github.com', 'api.github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com']);
const REPO_RE = /^[A-Za-z0-9-]{1,39}\/(?!\.{1,2}$)[\w.-]{1,100}$/; // GitHub naming rules: no dots in owner, repo is not "." or ".."

const trustedUrl = (u) => {
  try { const x = new URL(u); return x.protocol === 'https:' && HOSTS.has(x.hostname); } catch { return false; }
};

const cmp = (a, b) => {
  const pa = String(a).replace(/^v/i, '').split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b).replace(/^v/i, '').split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0) ? 1 : -1;
  return 0;
};

// source: "owner/repo" (GitHub Releases). Arbitrary URLs are not accepted on purpose.
function endpoint(source) {
  source = String(source || '').trim();
  if (!REPO_RE.test(source)) return null;
  return { url: `https://api.github.com/repos/${source}/releases/latest`, repo: source, page: `https://github.com/${source}/releases/latest` };
}

function parse(data, repo, page) {
  const assets = Array.isArray(data.assets) ? data.assets : [];
  const prefix = `https://github.com/${repo}/releases/download/`;
  const own = (a) => a && typeof a.browser_download_url === 'string' && a.browser_download_url.startsWith(prefix);
  const exe = assets.find((a) => own(a) && /^TextSnip\.exe$/i.test(a.name));
  const sum = assets.find((a) => own(a) && /^TextSnip\.exe\.sha256$/i.test(a.name));
  const digest = exe && /^sha256:([a-f0-9]{64})$/i.exec(String(exe.digest || '')); // GitHub computes this for every asset
  const setup = assets.find((a) => own(a) && /^TextSnip-Setup\.exe$/i.test(a.name));
  const setupSum = assets.find((a) => own(a) && /^TextSnip-Setup\.exe\.sha256$/i.test(a.name));
  const setupDigest = setup && /^sha256:([a-f0-9]{64})$/i.exec(String(setup.digest || ''));
  return {
    setupUrl: setup ? setup.browser_download_url : '',
    setupSha256: setupDigest ? setupDigest[1].toLowerCase() : '',
    setupShaUrl: setupSum ? setupSum.browser_download_url : '',
    version: String(data.tag_name || '').replace(/^v/i, ''),
    url: exe ? exe.browser_download_url : '',
    sha256: digest ? digest[1].toLowerCase() : '',
    shaUrl: sum ? sum.browser_download_url : '',
    notes: typeof data.body === 'string' ? data.body : '',
    page: trustedUrl(data.html_url) ? data.html_url : page,
  };
}

async function check(source, current, fetchFn = fetch) {
  const ep = endpoint(source);
  if (!ep) throw new Error('bad source');
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 12000);
  try {
    const r = await fetchFn(ep.url, { signal: ctl.signal, headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'TextSnip' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const info = parse(await r.json(), ep.repo, ep.page);
    return { ...info, newer: !!info.version && cmp(info.version, current) > 0, current };
  } finally { clearTimeout(t); }
}

// Reads the hex digest from a "TextSnip.exe.sha256" release asset.
async function fetchSha(url, fetchFn = fetch) {
  if (!trustedUrl(url)) throw new Error('untrusted checksum url');
  const r = await fetchFn(url, { redirect: 'follow', headers: { 'User-Agent': 'TextSnip' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  if (r.url && !trustedUrl(r.url)) throw new Error('untrusted redirect');
  const m = /^\s*([a-f0-9]{64})\b/i.exec((await r.text()).slice(0, 200));
  if (!m) throw new Error('bad checksum file');
  return m[1].toLowerCase();
}

async function download(url, dest, { sha256, onProgress, fetchFn = fetch } = {}) {
  if (!trustedUrl(url)) throw new Error('only https downloads from GitHub are allowed');
  if (!/^[a-f0-9]{64}$/i.test(sha256 || '')) throw new Error('missing checksum');
  const r = await fetchFn(url, { redirect: 'follow', headers: { 'User-Agent': 'TextSnip' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  if (r.url && !trustedUrl(r.url)) throw new Error('untrusted redirect');
  const total = Number(r.headers.get('content-length')) || 0;
  const hash = crypto.createHash('sha256');
  let got = 0;
  const src = Readable.fromWeb(r.body);
  src.on('data', (c) => { hash.update(c); got += c.length; if (onProgress && total) onProgress(got / total); });
  await pipeline(src, fs.createWriteStream(dest));
  const bad = (msg) => { try { fs.unlinkSync(dest); } catch { /* already gone */ } throw new Error(msg); };
  if (hash.digest('hex') !== sha256.toLowerCase()) bad('checksum mismatch');
  const fd = fs.openSync(dest, 'r'), head = Buffer.alloc(2);
  fs.readSync(fd, head, 0, 2, 0); fs.closeSync(fd);
  if (head.toString() !== 'MZ' || fs.statSync(dest).size < 5 * 1024 * 1024) bad('downloaded file is not a valid exe');
}

const quote = (p) => {
  if (/["\r\n]/.test(p)) throw new Error('unsafe path');
  return `"${p.replace(/%/g, '%%')}"`; // %VAR% would be expanded by cmd inside the script
};

// Windows batch script for the portable exe: wait until it is free, swap files, start the new version.
function swapScript(newFile, target) {
  return [
    '@echo off', 'set tries=0', ':wait', 'ping 127.0.0.1 -n 2 >nul', 'set /a tries+=1',
    `move /Y ${quote(newFile)} ${quote(target)} >nul 2>&1`,
    'if errorlevel 1 ( if %tries% LSS 60 goto wait )',
    `start "" ${quote(target)}`, '(goto) 2>nul & del "%~f0"', '',
  ].join('\r\n');
}

// Windows batch script for the installer. After the app has quit it runs the release's own installer:
//  - silent (default, updates): per-user, no questions, installs where the app already lives, then starts it;
//  - interactive (first install from the portable exe): the normal wizard where the user picks the folder
//    (its last page offers to start the app), so nothing is started here.
function installScript(setupFile, appExe, { silent = true } = {}) {
  return [
    '@echo off', 'ping 127.0.0.1 -n 3 >nul',
    silent ? `start "" /wait ${quote(setupFile)} /S` : `start "" /wait ${quote(setupFile)}`,
    ...(silent ? [`if exist ${quote(appExe)} start "" ${quote(appExe)}`] : []),
    `del ${quote(setupFile)} >nul 2>&1`, '(goto) 2>nul & del "%~f0"', '',
  ].join('\r\n');
}

module.exports = { cmp, endpoint, parse, check, fetchSha, download, swapScript, installScript, trustedUrl };

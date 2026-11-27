'use strict';
const {
  app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, desktopCapturer,
  screen, clipboard, nativeImage, Notification, shell, safeStorage, session,
} = require('electron');
const path = require('path');
const fs = require('fs');
const pipeline = require('./src/pipeline');
const ocr = require('./src/ocr');
const codes = require('./src/codes');
const { translate } = require('./src/translate');
const updater = require('./src/updater');

if (!app.requestSingleInstanceLock()) app.quit();
app.setAppUserModelId('TextSnip');

const DEFAULTS = {
  hotkey: 'Control+Shift+X',
  hotkeyToggle: 'Control+Alt+T',
  mode: 'glyph',
  langs: 'eng+rus',
  psm: '6',
  upscale: 2.5,
  autoCopy: true,
  showWindow: true,
  notify: true,
  closeToTray: true,
  autostart: false,
  codes: true,
  kind: 'auto',
  updateRepo: 'dangerden41k/TextSnip',
  updateAuto: true,
  translateTo: 'ru',
  translateOk: false, // online translation sends text to Google/MyMemory: off until the user agrees
  saveHistory: true,
  copyMode: 'keep', // keep | oneline | paragraphs (running text only, never code lists)
  maskSensitive: false, // hide card numbers, e-mails, tokens, passwords in the result
  captureDelay: '0', // seconds before the selection overlay opens
  notifyText: false, // recognized text in a Windows notification stays in the notification centre
  animations: true,
  dust: true,
  accent: '#9d90ff',
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const file = (n) => path.join(app.getPath('userData'), n);
const readJson = (n, d) => { try { return JSON.parse(fs.readFileSync(file(n), 'utf8')); } catch { return d; } };
const writeJson = (n, v) => { try { fs.writeFileSync(file(n), JSON.stringify(v, null, 2)); } catch { /* ignore */ } };

// ---------- settings validation + private history ----------
const { sanitize } = require('./src/settings');
const { formatText } = require('./src/format');
const { maskSensitive } = require('./src/mask');

// History holds whatever was on screen (maybe passwords), so it is encrypted with Windows DPAPI
// (safeStorage). If encryption is unavailable it is kept in memory only, never as plain text.
const HIST_ENC = 'history.bin';
const rm = (n) => { try { fs.unlinkSync(file(n)); } catch { /* not there */ } };
function persistHistory(h) {
  if (settings.saveHistory && safeStorage.isEncryptionAvailable() && h.length) {
    try { fs.writeFileSync(file(HIST_ENC), safeStorage.encryptString(JSON.stringify(h))); } catch { /* ignore */ }
  } else rm(HIST_ENC);
  rm('history.json'); // the old plain-text file
}
function loadHistory() {
  try {
    if (fs.existsSync(file(HIST_ENC)) && safeStorage.isEncryptionAvailable()) {
      const h = JSON.parse(safeStorage.decryptString(fs.readFileSync(file(HIST_ENC))));
      if (Array.isArray(h)) return h.slice(0, 100);
    }
  } catch { /* unreadable: start empty */ }
  const legacy = readJson('history.json', null); // migrate from the plain-text version
  if (Array.isArray(legacy)) { const h = legacy.slice(0, 100); persistHistory(h); return h; }
  return [];
}

// No popups, no navigation away from our own pages, no permission prompts.
function lockDown(wc) {
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('will-navigate', (e) => e.preventDefault());
  wc.on('will-attach-webview', (e) => e.preventDefault());
}

let settings, history, stats;
let win = null, tray = null;
let quitting = false, busy = false, restoreAfter = false;
const send = (ch, data) => { if (win && !win.isDestroyed()) win.webContents.send(ch, data); };

// ---------- hotkeys ----------
function registerHotkeys() {
  globalShortcut.unregisterAll();
  const errors = {};
  const map = { hotkey: startCaptureDelayed, hotkeyToggle: toggleWindow };
  for (const [key, fn] of Object.entries(map)) {
    const acc = settings[key];
    if (!acc) continue;
    let ok = false;
    try { ok = globalShortcut.register(acc, fn); } catch { ok = false; }
    if (!ok) errors[key] = true;
  }
  return errors;
}

function applySettings(patch) {
  patch = sanitize(patch);
  const prev = { ...settings };
  settings = { ...settings, ...patch };
  if (settings.hotkey && settings.hotkey === settings.hotkeyToggle) {
    const changed = 'hotkey' in patch ? 'hotkey' : 'hotkeyToggle';
    settings[changed] = prev[changed];
    return { settings, errors: { [changed]: 'dup' } };
  }
  let errors = registerHotkeys();
  if (Object.keys(errors).length) {
    for (const k of Object.keys(errors)) settings[k] = prev[k];
    registerHotkeys();
  }
  writeJson('settings.json', settings);
  if (prev.saveHistory && !settings.saveHistory) { history = []; persistHistory(history); send('history', history); }
  // the portable exe unpacks itself to a temp folder: autostart must point at the file the user runs
  app.setLoginItemSettings({ openAtLogin: !!settings.autostart, path: process.env.PORTABLE_EXECUTABLE_FILE || process.execPath, args: ['--hidden'] });
  scheduleUpdates();
  send('settings', settings);
  return { settings, errors };
}

// ---------- window / tray ----------
function createWindow(hidden) {
  win = new BrowserWindow({
    width: 1080, height: 720, minWidth: 880, minHeight: 620,
    frame: false, show: false, backgroundColor: '#0a090c', title: 'TextSnip',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  lockDown(win.webContents);
  win.removeMenu();
  win.loadFile(path.join(__dirname, 'ui', 'index.html'));
  win.once('ready-to-show', () => { if (!hidden) win.show(); });
  win.on('close', (e) => {
    if (!quitting && settings.closeToTray) { e.preventDefault(); win.hide(); }
  });
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function toggleWindow() {
  if (win && win.isVisible() && win.isFocused()) win.hide(); else showWindow();
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png')).resize({ width: 20, height: 20 });
  tray = new Tray(icon);
  tray.setToolTip('TextSnip');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Выделить область', click: startCaptureDelayed },
    { label: 'Открыть окно', click: showWindow },
    { type: 'separator' },
    { label: 'Выход', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('click', showWindow);
}

function notify(title, body) {
  if (settings.notify && Notification.isSupported()) new Notification({ title, body, silent: true }).show();
}

// ---------- capture ----------
// One overlay window per display, created ahead of time and kept hidden, so the picker
// appears as soon as the screenshot is ready.
const overlays = new Map(); // display id -> { win, loaded, wantFocus }
let capturing = false, safetyTimer = null;

function createOverlay(d) {
  const w = new BrowserWindow({
    x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height,
    frame: false, resizable: false, movable: false, skipTaskbar: true, show: false,
    alwaysOnTop: true, hasShadow: false, backgroundColor: '#0a090c',
    webPreferences: { preload: path.join(__dirname, 'overlay-preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false },
  });
  lockDown(w.webContents);
  w.setAlwaysOnTop(true, 'screen-saver');
  w.setBounds(d.bounds);
  const ov = { win: w, wantFocus: false };
  ov.loaded = new Promise((res) => w.webContents.once('did-finish-load', res));
  w.loadFile(path.join(__dirname, 'ui', 'overlay.html'));
  overlays.set(String(d.id), ov);
}

function syncOverlays() {
  const displays = screen.getAllDisplays();
  const ids = new Set(displays.map((d) => String(d.id)));
  for (const [id, ov] of overlays) if (!ids.has(id)) { ov.win.destroy(); overlays.delete(id); }
  for (const d of displays) {
    const ov = overlays.get(String(d.id));
    if (ov) ov.win.setBounds(d.bounds); else createOverlay(d);
  }
}

function hideOverlays(except) {
  clearTimeout(safetyTimer);
  for (const ov of overlays.values()) {
    if (ov.win === except || ov.win.isDestroyed()) continue;
    ov.win.hide();
    ov.win.webContents.send('wipe'); // drop the full-screen pixels held by the hidden overlay
  }
  if (!except) capturing = false;
}

function ocrNativeImage(img) {
  if (busy) { send('status', { kind: 'warn', text: 'Подожди: предыдущий снимок ещё обрабатывается' }); return; }
  if (!img || img.isEmpty()) { send('status', { kind: 'warn', text: 'Не удалось открыть картинку (поддерживаются PNG и JPG)' }); return; }
  runOcr(img.toDataURL());
}

let delayTimer = null;
function startCaptureDelayed() { // menus, tooltips and hover states need a moment to be put on screen
  const sec = Number(settings.captureDelay) || 0;
  clearTimeout(delayTimer);
  if (!sec) { startCapture(); return; }
  send('status', { kind: 'busy', text: `Съёмка через ${sec} с — открой нужное меню` });
  delayTimer = setTimeout(startCapture, sec * 1000);
}

async function startCapture() {
  if (capturing || busy) return;
  capturing = true;
  const displays = screen.getAllDisplays();
  const cursorDisp = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  restoreAfter = !!(win && win.isVisible() && !win.isMinimized());
  if (restoreAfter) { win.setOpacity(0); win.hide(); await sleep(45); win.setOpacity(1); }

  let sources;
  try {
    const maxW = Math.max(...displays.map((d) => Math.round(d.bounds.width * d.scaleFactor)));
    const maxH = Math.max(...displays.map((d) => Math.round(d.bounds.height * d.scaleFactor)));
    sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: maxW, height: maxH } });
  } catch (e) {
    capturing = false;
    if (restoreAfter) showWindow();
    send('status', { kind: 'error', text: 'Не удалось сделать снимок экрана' });
    return;
  }

  let sent = 0;
  await Promise.all(displays.map(async (d) => {
    const src = sources.find((x) => x.display_id === String(d.id)) || (displays.length === 1 ? sources[0] : null);
    const ov = overlays.get(String(d.id));
    if (!src || !ov) return;
    const { width, height } = src.thumbnail.getSize();
    const bgra = src.thumbnail.toBitmap(); // raw pixels: no slow PNG encoding
    await ov.loaded;
    ov.wantFocus = d.id === cursorDisp.id;
    ov.win.setBounds(d.bounds);
    ov.win.webContents.send('shot', { bgra, width, height, upscale: settings.upscale });
    sent++;
  }));
  if (!sent) {
    capturing = false;
    if (restoreAfter) showWindow();
    send('status', { kind: 'error', text: 'Не удалось сделать снимок экрана' });
    return;
  }
  safetyTimer = setTimeout(() => { // never leave the user stuck without a picker
    if (capturing && ![...overlays.values()].some((o) => o.win.isVisible())) { hideOverlays(); if (restoreAfter) showWindow(); }
  }, 4000);
}

async function runOcr(dataURL) {
  busy = true;
  send('status', { kind: 'busy', text: 'Распознаю…' });
  try {
    const buf = Buffer.from(dataURL.split(',')[1], 'base64');
    let gray = null, width = 0, height = 0;
    try {
      const img = nativeImage.createFromBuffer(buf), size = img.getSize(), bgra = img.toBitmap();
      ({ width, height } = size);
      gray = new Uint8Array(width * height);
      for (let i = 0; i < gray.length; i++) gray[i] = (bgra[i * 4] * 114 + bgra[i * 4 + 1] * 587 + bgra[i * 4 + 2] * 299) / 1000; // B,G,R -> luminance
    } catch (e) { gray = null; }

    const res = await pipeline.run({
      buf, gray, W: width, H: height, kind: settings.kind, langs: settings.langs, psm: settings.psm, recognize: ocr.recognize, prep: true,
    });
    const data = res.data;
    const raw = res.raw;
    let found = [];
    if (settings.codes && gray) { try { found = codes.decode(gray, width, height); } catch (e) { found = []; } }
    const noisy = (raw.match(/[\p{L}\p{N}]/gu) || []).length < 8 || data.confidence < 50;
    const useCode = found.length > 0 && noisy && !res.codes; // a QR/barcode picture: OCR only sees noise
    if (!raw.trim() && !found.length) {
      send('status', { kind: 'warn', text: 'Текст не найден — выдели область плотнее вокруг текста' });
      notify('TextSnip', 'Текст не найден');
      if (restoreAfter || settings.showWindow) showWindow();
      return;
    }
    // digit-vs-letter decided from the shape and size of each look-alike glyph (inside the pipeline)
    // running text may be reshaped (one line / paragraphs) and masked; code lists never are
    const plain = !res.codes && !useCode;
    const post = (t) => { if (!plain) return t; let o = formatText(t, settings.copyMode); if (settings.maskSensitive) o = maskSensitive(o).text; return o; };
    const reshaped = plain && (settings.copyMode !== 'keep' || settings.maskSensitive); // char positions no longer match
    const rawOut = post(raw), refined = post(res.refined), changes = res.changes, doubts = reshaped ? [] : res.doubts;
    const text = useCode ? found.map((c) => c.text).join('\n') : settings.mode === 'raw' ? rawOut : refined;
    const fixed = { text, changes: settings.mode === 'raw' || useCode ? 0 : changes.length };
    const item = {
      id: Date.now(), ts: Date.now(), raw: rawOut, refined, text: fixed.text, changes: fixed.changes,
      doubts: settings.mode === 'raw' || useCode ? [] : doubts, codes: found, fromCode: useCode, mode: settings.mode,
    };
    if (settings.saveHistory) { history = [item, ...history].slice(0, 100); persistHistory(history); }
    stats.captures += 1;
    stats.fixed += fixed.changes;
    writeJson('stats.json', stats);
    if (settings.autoCopy) clipboard.writeText(fixed.text);
    notify(settings.autoCopy ? 'Скопировано' : 'Готово', settings.notifyText ? fixed.text.slice(0, 120) : `Символов: ${[...fixed.text].length}`);
    send('result', { item, stats });
    if (settings.showWindow || restoreAfter) showWindow();
  } catch (e) {
    send('status', { kind: 'error', text: `Ошибка распознавания: ${e.message || e}` });
    if (restoreAfter || settings.showWindow) showWindow();
  } finally {
    busy = false;
  }
}


// ---------- updates ----------
let updateInfo = null, updateTimer = null, installing = false, lastRelease = null;
const runMode = () => (process.env.PORTABLE_EXECUTABLE_FILE ? 'portable' : app.isPackaged ? 'installed' : 'dev');

async function checkUpdate(manual) {
  if (!settings.updateRepo) {
    if (manual) send('status', { kind: 'warn', text: 'Впиши репозиторий GitHub в настройках (owner/repo)' });
    return;
  }
  try {
    const r = await updater.check(settings.updateRepo, app.getVersion());
    lastRelease = r;
    if (r.newer) {
      const fresh = !updateInfo || updateInfo.version !== r.version;
      updateInfo = r;
      send('update', r);
      if (fresh) {
        notify('Доступно обновление TextSnip', `Версия ${r.version} — открой окно и нажми «Обновить»`);
        if (Notification.isSupported() && !settings.notify) new Notification({ title: 'Доступно обновление TextSnip', body: `Версия ${r.version}` }).show();
      }
    } else if (manual) {
      send('status', { kind: '', text: `Установлена последняя версия (${app.getVersion()})` });
    }
  } catch (e) {
    if (manual) send('status', { kind: 'error', text: 'Не удалось проверить обновления' });
  }
}

function scheduleUpdates() {
  clearInterval(updateTimer);
  if (settings.updateAuto && settings.updateRepo) updateTimer = setInterval(() => checkUpdate(false), 10 * 60 * 1000);
}

const openSafe = (u) => { if (updater.trustedUrl(u)) shell.openExternal(u); };

// Downloads a release asset and verifies its SHA-256 (GitHub's digest or the .sha256 asset). false = no checksum known.
async function fetchVerified(url, sha256, shaUrl, dest, label) {
  const sha = sha256 || (shaUrl ? await updater.fetchSha(shaUrl) : '');
  if (!sha) return false;
  let last = -1;
  await updater.download(url, dest, {
    sha256: sha,
    onProgress: (p) => { const pct = Math.floor(p * 100); if (pct !== last) { last = pct; send('status', { kind: 'busy', text: `${label}… ${pct}%` }); } },
  });
  return true;
}
function runCmdScript(text) { // detached batch file that outlives this process
  const script = path.join(fs.mkdtempSync(path.join(app.getPath('temp'), 'textsnip-')), 'run.cmd');
  fs.writeFileSync(script, text);
  require('child_process').spawn('cmd.exe', ['/d', '/s', '/c', `"${script}"`], { detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true }).unref();
}
const tempFile = (name) => path.join(fs.mkdtempSync(path.join(app.getPath('temp'), 'textsnip-dl-')), name);
const installedExe = () => path.join(process.env.LOCALAPPDATA || '', 'Programs', 'TextSnip', 'TextSnip.exe');

async function installUpdate() {
  if (!updateInfo || installing) return;
  const info = updateInfo, mode = runMode();
  if (mode === 'dev') { openSafe(info.page); return; }
  const noSum = () => { installing = false; send('status', { kind: 'warn', text: 'У релиза нет контрольной суммы — скачай обновление вручную со страницы релиза' }); openSafe(info.page); };
  installing = true;
  try {
    if (mode === 'portable') { // replace the single exe in place
      const target = process.env.PORTABLE_EXECUTABLE_FILE;
      if (!target || !info.url) { installing = false; openSafe(info.page); return; }
      const dest = path.join(path.dirname(target), 'TextSnip.update.exe');
      try { fs.unlinkSync(dest); } catch { /* none left over */ }
      if (!(await fetchVerified(info.url, info.sha256, info.shaUrl, dest, 'Скачиваю обновление'))) { noSum(); return; }
      runCmdScript(updater.swapScript(dest, target));
    } else { // installed: run the release's installer silently over the current installation
      if (!info.setupUrl) { installing = false; openSafe(info.page); return; }
      const dest = tempFile('TextSnip-Setup.exe');
      if (!(await fetchVerified(info.setupUrl, info.setupSha256, info.setupShaUrl, dest, 'Скачиваю обновление'))) { noSum(); return; }
      runCmdScript(updater.installScript(dest, process.execPath));
    }
    quitting = true;
    app.quit();
  } catch (e) {
    installing = false;
    send('status', { kind: 'error', text: 'Не удалось скачать или проверить обновление — открою страницу релиза' });
    openSafe(info.page);
  }
}

// "Install on this computer" from the portable exe: download the installer, install per-user, start the installed app.
async function installHere() {
  if (runMode() !== 'portable' || installing) return false;
  installing = true;
  const fail = (text) => { installing = false; send('status', { kind: 'error', text }); return false; };
  try {
    const r = lastRelease || await updater.check(settings.updateRepo || DEFAULTS.updateRepo, app.getVersion());
    if (!r.setupUrl) return fail('В последнем релизе нет установщика');
    const dest = tempFile('TextSnip-Setup.exe');
    if (!(await fetchVerified(r.setupUrl, r.setupSha256, r.setupShaUrl, dest, 'Скачиваю установщик'))) return fail('У установщика нет контрольной суммы — установка отменена');
    send('status', { kind: 'busy', text: 'Устанавливаю… программа перезапустится сама' });
    runCmdScript(updater.installScript(dest, installedExe()));
    quitting = true;
    app.quit();
    return true;
  } catch (e) {
    return fail('Не удалось скачать или проверить установщик');
  }
}

// ---------- IPC ----------
// Every handler checks who is asking: only our main window (or, for the picker, an overlay window).
const trusted = (e) => !!win && !win.isDestroyed() && e.sender === win.webContents;
const overlayOf = (e) => [...overlays.values()].find((o) => !o.win.isDestroyed() && o.win.webContents === e.sender);

ipcMain.handle('state:get', (e) => (trusted(e) ? { settings, history, stats, version: app.getVersion(), mode: runMode() } : null));
ipcMain.handle('app:install-here', (e) => (trusted(e) ? installHere() : false));
ipcMain.handle('settings:set', (e, patch) => (trusted(e) ? applySettings(patch) : null));
ipcMain.on('hotkeys:pause', (e, on) => { if (!trusted(e)) return; if (on) globalShortcut.unregisterAll(); else registerHotkeys(); });
ipcMain.on('capture:start', (e) => { if (trusted(e)) startCaptureDelayed(); });
ipcMain.handle('ocr:image', (e, bytes) => { // a PNG/JPG the user dropped or pasted into the window
  if (!trusted(e)) return false;
  if (!(bytes instanceof ArrayBuffer || ArrayBuffer.isView(bytes))) return false;
  const buf = Buffer.from(bytes.buffer ? Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength) : bytes);
  if (!buf.length || buf.length > 40e6) { send('status', { kind: 'warn', text: 'Файл пустой или слишком большой (до 40 МБ)' }); return false; }
  ocrNativeImage(nativeImage.createFromBuffer(buf));
  return true;
});
ipcMain.handle('ocr:clipboard', (e) => {
  if (!trusted(e)) return false;
  const img = clipboard.readImage();
  if (img.isEmpty()) { send('status', { kind: 'warn', text: 'В буфере обмена нет картинки' }); return false; }
  ocrNativeImage(img);
  return true;
});
ipcMain.on('clipboard:write', (e, text) => { if (trusted(e)) clipboard.writeText(String(text ?? '').slice(0, 1000000)); });
ipcMain.handle('history:delete', (e, id) => {
  if (!trusted(e)) return null;
  history = history.filter((h) => h.id !== id); persistHistory(history); return history;
});
ipcMain.handle('history:clear', (e) => {
  if (!trusted(e)) return null;
  history = []; persistHistory(history); return history;
});
ipcMain.on('update:check', (e) => { if (trusted(e)) checkUpdate(true); });
ipcMain.on('update:install', (e) => { if (trusted(e)) installUpdate(); });
ipcMain.handle('translate:run', async (e, text) => {
  if (!trusted(e)) return { ok: false, error: 'denied' };
  if (!settings.translateOk) return { ok: false, error: 'Онлайн-перевод выключен в настройках' };
  try { return { ok: true, ...(await translate(String(text || '').slice(0, 20000), settings.translateTo)) }; } catch (err) { return { ok: false, error: err.message }; }
});
ipcMain.on('win:min', (e) => { if (trusted(e)) win.minimize(); });
ipcMain.on('win:close', (e) => { if (trusted(e)) win.close(); });
ipcMain.on('overlay:ready', (e) => {
  const ov = overlayOf(e);
  if (!ov || !capturing) return;
  ov.win.show();
  if (ov.wantFocus) ov.win.focus();
});
ipcMain.on('overlay:selected', (e, dataURL) => {
  const ov = overlayOf(e);
  if (!ov || !capturing || busy) return;
  if (typeof dataURL !== 'string' || dataURL.length > 80000000 || !dataURL.startsWith('data:image/png;base64,')) { hideOverlays(); return; }
  hideOverlays(ov.win); // the other screens close at once
  runOcr(dataURL);
});
ipcMain.on('overlay:close', (e) => { if (overlayOf(e)) hideOverlays(); });
ipcMain.on('overlay:cancel', (e) => {
  if (!overlayOf(e)) return;
  hideOverlays();
  if (restoreAfter) showWindow();
});

// ---------- lifecycle ----------
app.on('second-instance', showWindow);
app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  settings = { ...DEFAULTS, ...sanitize(readJson('settings.json', {})) };
  if (!settings.updateRepo) settings.updateRepo = DEFAULTS.updateRepo; // old settings.json saved an empty value
  if (!['glyph', 'raw'].includes(settings.mode)) settings.mode = 'glyph';
  if (!['auto', 'text', 'codes'].includes(settings.kind)) settings.kind = 'auto';
  history = settings.saveHistory ? loadHistory() : [];
  if (!settings.saveHistory) persistHistory(history);
  stats = { captures: 0, fixed: 0, ...readJson('stats.json', {}) };
  createWindow(process.argv.includes('--hidden'));
  createTray();
  syncOverlays();
  scheduleUpdates();
  setTimeout(() => checkUpdate(false), 20000);
  win.webContents.once('did-finish-load', () => { if (updateInfo) send('update', updateInfo); });
  for (const ev of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(ev, syncOverlays);
  const errors = registerHotkeys();
  if (Object.keys(errors).length) win.webContents.once('did-finish-load', () => send('status', { kind: 'warn', text: 'Горячая клавиша занята другим приложением — поменяй в настройках' }));
});
app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => { globalShortcut.unregisterAll(); ocr.dispose(); });
app.on('window-all-closed', () => { /* stay in tray */ });

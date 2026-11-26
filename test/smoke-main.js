'use strict';
// End-to-end smoke test: the real main.js + real Tesseract pipeline on a mocked "electron".
// Run: npm run smoke   (takes ~1 minute: it OCRs a few real pictures)
const Module = require('module'), path = require('path'), fs = require('fs'), os = require('os');
const { PNG } = require('pngjs');
const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-userdata-'));
const fx = (n) => fs.readFileSync(path.join(__dirname, 'fixtures', n));
fs.writeFileSync(path.join(ud, 'history.json'), JSON.stringify([{ id: 1, text: 'secret-password-123' }])); // legacy plain history
fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ updateRepo: 'https://evil.example/x.json', evil: 1, autoCopy: false }));

const handlers = {}, listeners = {}, sent = [], wins = [];
const mkWC = () => ({ send: (...a) => sent.push(a), on() {}, setWindowOpenHandler() {}, once() {}, isDestroyed: () => false });
class BW {
  constructor(o) { this.o = o; this.webContents = mkWC(); wins.push(this); }
  loadFile() { return Promise.resolve(); } removeMenu() {} on() {} once() {} show() {} hide() {} focus() {} close() {} minimize() {}
  setAlwaysOnTop() {} setBounds() {} setIgnoreMouseEvents() {} setMenuBarVisibility() {} isDestroyed() { return false; } isVisible() { return true; }
  isMinimized() { return false; } restore() {} setSkipTaskbar() {}
}
BW.fromWebContents = () => null; BW.getAllWindows = () => wins;
const enc = { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from('ENC:' + Buffer.from(s).toString('base64')), decryptString: (b) => Buffer.from(b.toString().slice(4), 'base64').toString() };
// a nativeImage that really decodes PNG, so the real OCR path runs
const img = (buf) => {
  let p; try { p = PNG.sync.read(buf); } catch { return { isEmpty: () => true }; }
  const bgra = Buffer.alloc(p.width * p.height * 4);
  for (let i = 0; i < p.width * p.height; i++) { bgra[i * 4] = p.data[i * 4 + 2]; bgra[i * 4 + 1] = p.data[i * 4 + 1]; bgra[i * 4 + 2] = p.data[i * 4]; bgra[i * 4 + 3] = 255; }
  return { isEmpty: () => false, getSize: () => ({ width: p.width, height: p.height }), toBitmap: () => bgra, toDataURL: () => 'data:image/png;base64,' + buf.toString('base64') };
};
let clipImage = img(fx('caps-line.png'));
const electron = {
  app: { getPath: (n) => (n === 'userData' ? ud : os.tmpdir()), getVersion: () => '1.4.2', whenReady: () => ({ then: (cb) => { setImmediate(cb); return { catch() {} }; } }),
    requestSingleInstanceLock: () => true, on() {}, quit() {}, setLoginItemSettings() {}, isPackaged: false, setAppUserModelId() {}, commandLine: { appendSwitch() {} }, disableHardwareAcceleration() {}, getName: () => 'TextSnip' },
  BrowserWindow: BW, ipcMain: { handle: (c, f) => (handlers[c] = f), on: (c, f) => (listeners[c] = f) },
  globalShortcut: { register: () => true, unregisterAll() {}, unregister() {} }, Tray: class { setToolTip() {} setContextMenu() {} on() {} setImage() {} destroy() {} },
  Menu: { buildFromTemplate: () => ({}) }, desktopCapturer: { getSources: async () => [] },
  screen: { getAllDisplays: () => [], getPrimaryDisplay: () => ({ scaleFactor: 1, bounds: { x: 0, y: 0, width: 1, height: 1 } }), on() {} },
  clipboard: { writeText: (t) => (electron._clip = t), readImage: () => clipImage }, nativeImage: { createFromBuffer: img, createFromPath: () => ({ resize: () => ({}), isEmpty: () => true }), createEmpty: () => ({}) },
  Notification: class { constructor(o) { sent.push(['NOTIFY', o]); } show() {} static isSupported() { return true; } }, shell: { openExternal() {} },
  safeStorage: enc, session: { defaultSession: { setPermissionRequestHandler() {}, setPermissionCheckHandler() {} } },
};
const orig = Module._load;
Module._load = function (req, ...r) { return req === 'electron' ? electron : orig.call(this, req, ...r); };
let failed = 0;
const ok = (c, m) => { if (!c) failed++; console.log((c ? 'PASS ' : 'FAIL ') + m); };
process.on('uncaughtException', (e) => { failed++; console.log('UNCAUGHT:', e.stack.split('\n').slice(0, 4).join(' | ')); });
require('../main.js');

const waitResult = async (from) => { for (let i = 0; i < 400; i++) { const r = sent.slice(from).find((a) => a[0] === 'result'); if (r) return r[1].item; const s = sent.slice(from).find((a) => a[0] === 'status' && a[1].kind !== 'busy'); if (s) return { status: s[1] }; await new Promise((r2) => setTimeout(r2, 250)); } return null; };

setTimeout(async () => {
  const main = wins[0], me = { sender: main.webContents }, stranger = { sender: mkWC() };
  ok(main.o.webPreferences.sandbox === true && main.o.webPreferences.contextIsolation === true, 'main window: sandbox + contextIsolation');
  const st = await handlers['state:get'](me);
  ok(st.settings.updateRepo !== 'https://evil.example/x.json' && !('evil' in st.settings), 'settings.json is sanitised on load');
  ok(!fs.existsSync(path.join(ud, 'history.json')) && fs.existsSync(path.join(ud, 'history.bin')) && !fs.readFileSync(path.join(ud, 'history.bin')).toString().includes('secret-password'), 'legacy history migrated to encrypted history.bin');
  ok((await handlers['state:get'](stranger)) === null && (await handlers['ocr:image'](stranger, fx('code-plate.png'))) === false, 'foreign senders are refused (state, ocr:image)');
  ok((await handlers['ocr:image'](me, new Uint8Array(0))) === false && (await handlers['ocr:image'](me, 'text')) === false, 'empty / non-binary image data is refused');

  let n = sent.length;
  await handlers['ocr:image'](me, new Uint8Array(fx('code-plate.png')));
  let it = await waitResult(n);
  ok(it && it.text && it.text.includes('LCQH-87CP-MMDH-LF7Y'), 'photo of a code plate (thin dot-matrix text in a dark frame): ' + JSON.stringify(it && (it.text || it.status)));

  n = sent.length;
  await handlers['ocr:image'](me, new Uint8Array(fx('caps-line.png')));
  it = await waitResult(n);
  ok(it && /REDEEM YOUR CODE TO UNLOCK THE DED CORONET MASK IN THE GAME/.test(it.text) && !/[A-Z]0[A-Z]/.test(it.text), 'ALL-CAPS line has no zeros inside words: ' + JSON.stringify(it && it.text));

  await handlers['settings:set'](me, { maskSensitive: true, saveHistory: true });
  n = sent.length;
  await handlers['ocr:image'](me, new Uint8Array(fx('card-text.png')));
  it = await waitResult(n);
  ok(it && it.text && !it.text.includes('4111 1111') && !it.text.includes('ivan.petrov') && /1111/.test(it.text), 'card number and e-mail are masked: ' + JSON.stringify(it && it.text));

  await handlers['settings:set'](me, { maskSensitive: false, copyMode: 'oneline' });
  n = sent.length; clipImage = img(fx('card-text.png'));
  ok((await handlers['ocr:clipboard'](me)) === true, 'ocr:clipboard accepted');
  it = await waitResult(n);
  ok(it && it.text && !it.text.includes('\n') && /4111/.test(it.text), 'copy format "one line": ' + JSON.stringify(it && it.text));

  clipImage = { isEmpty: () => true }; n = sent.length;
  ok((await handlers['ocr:clipboard'](me)) === false && sent.slice(n).some((a) => a[0] === 'status' && /нет картинки/.test(a[1].text)), 'empty clipboard gives a friendly message');

  console.log(failed ? `\n${failed} CHECK(S) FAILED` : '\nALL SMOKE CHECKS PASSED');
  process.exit(failed ? 1 : 0);
}, 500);

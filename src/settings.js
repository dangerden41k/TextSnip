'use strict';
const updater = require('./updater');

const BOOLS = ['autoCopy', 'showWindow', 'notify', 'closeToTray', 'autostart', 'codes', 'updateAuto', 'animations', 'dust', 'translateOk', 'saveHistory', 'notifyText', 'maskSensitive'];
const ENUMS = { mode: ['glyph', 'raw'], kind: ['auto', 'text', 'codes'], langs: ['eng+rus', 'rus', 'eng'], psm: ['6', '7', '3'], translateTo: ['ru', 'en', 'uk', 'de'], copyMode: ['keep', 'oneline', 'paragraphs'], captureDelay: ['0', '3', '5'] };
// Only known keys with valid values get through, whether they come from the UI or from settings.json.
function sanitize(p) {
  const out = {};
  if (!p || typeof p !== 'object') return out;
  for (const k of BOOLS) if (typeof p[k] === 'boolean') out[k] = p[k];
  for (const [k, vals] of Object.entries(ENUMS)) if (vals.includes(String(p[k]))) out[k] = String(p[k]);
  for (const k of ['hotkey', 'hotkeyToggle']) if (typeof p[k] === 'string' && /^[\x20-\x7E]{0,60}$/.test(p[k])) out[k] = p[k];
  if (typeof p.upscale === 'number' && p.upscale >= 1 && p.upscale <= 4) out.upscale = p.upscale;
  if (typeof p.accent === 'string' && /^#[0-9a-f]{6}$/i.test(p.accent)) out.accent = p.accent;
  if (typeof p.updateRepo === 'string' && (p.updateRepo.trim() === '' || updater.endpoint(p.updateRepo))) out.updateRepo = p.updateRepo.trim();
  return out;
}

module.exports = { sanitize, BOOLS, ENUMS };

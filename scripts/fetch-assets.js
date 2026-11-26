'use strict';
// Downloads the OCR language models into ./tessdata and verifies their SHA-256.
// Pinned to a fixed commit of tesseract-ocr/tessdata_fast so every build gets identical bytes.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const COMMIT = '87416418657359cb625c412a48b6e1d6d41c29bd';
const FILES = {
  'eng.traineddata': '7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2',
  'rus.traineddata': 'e16e5e036cce1d9ec2b00063cf8b54472625b9e14d893a169e2b0dedeb4df225',
};
const dir = path.join(__dirname, '..', 'tessdata');
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

(async () => {
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, want] of Object.entries(FILES)) {
    const dest = path.join(dir, name);
    if (fs.existsSync(dest) && sha(fs.readFileSync(dest)) === want) { console.log(`ok     ${name} (cached)`); continue; }
    const url = `https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/${COMMIT}/${name}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    if (sha(buf) !== want) throw new Error(`${name}: checksum mismatch, refusing to use it`);
    fs.writeFileSync(dest, buf);
    console.log(`ok     ${name} (${buf.length} bytes)`);
  }
})().catch((e) => { console.error(e.message); process.exit(1); });

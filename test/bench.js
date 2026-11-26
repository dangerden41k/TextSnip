'use strict';
// dev: MODE=base|new node test/bench.js  -> OCR accuracy over /tmp/bench/img (see /tmp/bench/gen.py)
const fs = require('fs'), path = require('path');
const B = require('./benchlib');
const ROOT = process.env.ROOT || require('path').join(__dirname, '..');
const ocr = require(ROOT + '/src/ocr'), pipe = require(ROOT + '/src/pipeline');
const dir = process.env.BENCH || '/tmp/bench', MODE = process.env.MODE || 'base', ONLY = process.env.ONLY;
const truth = JSON.parse(fs.readFileSync(path.join(dir, 'truth.json'), 'utf8'));
(async () => {
  const res = {}; let k = 0; const t0 = Date.now();
  for (const name of Object.keys(truth)) {
    if (ONLY && !name.includes(ONLY)) continue;
    const png = B.PNG.sync.read(fs.readFileSync(path.join(dir, 'img', name + '.png')));
    const p = B.overlayPrepare(png.data, png.width, png.height);
    const buf = B.toPng(p.gray, p.W, p.H);
    const r = await pipe.run({ buf, gray: p.gray, W: p.W, H: p.H, kind: 'auto', langs: 'eng+rus', psm: '6', recognize: ocr.recognize, prep: MODE === 'new' });
    res[name] = { acc: B.accuracy(r.refined, truth[name]), accRaw: B.accuracy(r.raw, truth[name]), text: r.refined, raw: r.raw, conf: r.data.confidence };
    if (++k % 20 === 0) console.error(k, 'done', Math.round((Date.now() - t0) / 1000) + 's');
  }
  fs.writeFileSync(path.join(dir, `res_${process.env.TAG || MODE}.json`), JSON.stringify(res));
  const avg = (f) => { const v = Object.entries(res).filter(([n]) => f(n)).map(([, r]) => r.acc); return v.length ? (100 * v.reduce((a, b) => a + b, 0) / v.length).toFixed(1) : '-'; };
  const avgRaw = (f) => { const v = Object.entries(res).filter(([n]) => f(n)).map(([, r]) => r.accRaw); return (100 * v.reduce((a, b) => a + b, 0) / v.length).toFixed(1); }; console.log('  RAW tesseract (no glyph judge): ALL=' + avgRaw(() => true) + '%  en=' + avgRaw((n) => n.startsWith('en_')) + '%  ru=' + avgRaw((n) => n.startsWith('ru_')) + '%  mix=' + avgRaw((n) => n.startsWith('mix_')) + '%');
  console.log(`MODE=${MODE} images=${Object.keys(res).length} time=${Math.round((Date.now() - t0) / 1000)}s  ALL=${avg(() => true)}%`);
  for (const th of ['light', 'dark', 'blue', 'lowc', 'mid']) console.log('  theme', th.padEnd(6), avg((n) => n.includes('_' + th + '_')) + '%');
  for (const sz of [11, 14, 20, 30]) console.log('  size ', String(sz).padEnd(6), avg((n) => n.endsWith('_' + sz)) + '%');
  for (const t of ['ru', 'en', 'mix']) console.log('  text ', t.padEnd(6), avg((n) => n.startsWith(t + '_')) + '%');
  await ocr.dispose();
})();

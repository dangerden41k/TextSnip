// dev: node test/pipeline-real.js  -> end-to-end exact-line count on the real key screenshots (needs /tmp/real)
function lev(a, b) { const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]); for (let j = 1; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; }
const fs = require('fs'), path = require('path');
const { PNG } = require('pngjs');
const ocr = require('../src/ocr'), pipe = require('../src/pipeline'), glyph = require('../src/glyph');
if (process.env.MODEL) glyph.loadModel(process.env.MODEL);
const truth = JSON.parse(fs.readFileSync('/tmp/real/truth.json'));
(async () => {
  const variants = JSON.parse(fs.readFileSync('/tmp/real/variants.json')).filter((v) => v.scale === 3 && v.pad === 20);
  let ex = 0, n = 0, exRaw = 0;
  for (const v of variants) {
    const buf = fs.readFileSync(`/tmp/real/v_${v.id}.png`), png = PNG.sync.read(buf);
    const gray = new Uint8Array(png.width * png.height); for (let i = 0; i < gray.length; i++) gray[i] = png.data[i * 4];
    const res = await pipe.run({ buf, gray, W: png.width, H: png.height, kind: process.env.KIND || 'auto', langs: 'eng', psm: '6', recognize: ocr.recognize });
    const got = new Set(res.refined.split('\n').map((s) => s.trim()));
    const gotRaw = new Set(res.raw.split('\n').map((s) => s.trim()));
    const t = truth[v.img];
    ex += t.filter((l) => got.has(l)).length; exRaw += t.filter((l) => gotRaw.has(l)).length; n += t.length;
    if (process.env.SHOW) { const gl = res.refined.split('\n').map((s) => s.trim()); t.forEach((l, i) => { if (!got.has(l)) console.log('  MISS', l, '| nearest:', gl.reduce((b, c) => (lev(c, l) < lev(b, l) ? c : b), gl[0])); }); }
    console.log(v.img, 'codes:', res.codes, 'exact lines:', t.filter((l) => got.has(l)).length + '/' + t.length);
  }
  console.log(`TOTAL exact lines ${ex}/${n}`);
  await ocr.dispose();
})();

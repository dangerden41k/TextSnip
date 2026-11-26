// dev: node test/dump-train.js <imgdir> <out.jsonl> : Tesseract + JS features for every look-alike glyph
const fs = require('fs'), path = require('path');
const { PNG } = require('pngjs');
const { createWorker } = require('tesseract.js');
const glyph = require('../src/glyph');
const [dir, outFile, limit = '1000000'] = process.argv.slice(2);
(async () => {
  const base = path.join(__dirname, '..');
  const w = await createWorker('eng', 1, {
    workerPath: require.resolve('tesseract.js/src/worker-script/node/index.js'),
    corePath: path.join(base, 'node_modules/tesseract.js-core'), langPath: path.join(base, 'tessdata'), gzip: false, cacheMethod: 'none',
  });
  await w.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1', tessedit_char_whitelist: process.env.WL ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-' : '' });
  const labels = JSON.parse(fs.readFileSync(path.join(dir, 'labels.json'), 'utf8')).slice(0, +limit);
  const fd = fs.openSync(outFile, 'w');
  let n = 0;
  for (const lb of labels) {
    const buf = fs.readFileSync(path.join(dir, `${lb.id}.png`));
    const png = PNG.sync.read(buf);
    const gray = new Uint8Array(png.width * png.height);
    for (let i = 0; i < gray.length; i++) gray[i] = png.data[i * 4];
    const { data } = await w.recognize(buf, {}, { text: true, blocks: true });
    const syms = [];
    for (const line of glyph.symbolLines(data)) {
      const alnum = line.filter((s) => s.text.length === 1 && /[\p{L}\p{N}]/u.test(s.text));
      const ctx = alnum.length ? glyph.lineContext(alnum.map((s) => [s.bbox.x0, s.bbox.y0, s.bbox.x1, s.bbox.y1]), alnum.map((s) => s.text)) : null;
      for (const s of line) {
        let inp = null;
        if (ctx && glyph.AMBIG.includes(s.text)) {
          const bl = s.baseline, cx = (s.bbox.x0 + s.bbox.x1) / 2;
          const base = bl.x1 !== bl.x0 ? bl.y0 + ((bl.y1 - bl.y0) * (cx - bl.x0)) / (bl.x1 - bl.x0) : bl.y0;
          const f = glyph.features(gray, png.width, png.height, [s.bbox.x0, s.bbox.y0, s.bbox.x1, s.bbox.y1], ctx, base);
          if (f) inp = Array.from(glyph.buildInput(f, s), (v) => +v.toFixed(5));
        }
        syms.push({ t: s.text, x: inp });
      }
    }
    fs.writeSync(fd, JSON.stringify({ id: lb.id, text: lb.text, font: lb.font, syms }) + '\n');
    if (++n % 200 === 0) console.log(n);
  }
  fs.closeSync(fd);
  console.log('done', n);
  await w.terminate();
})();

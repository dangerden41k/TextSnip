// dev: node test/eval-glyph.js <evalset dir> <model.json> [limit]  -> JSON dump of raw/refined text per image
const fs = require('fs'), path = require('path');
const { PNG } = require('pngjs');
const { createWorker } = require('tesseract.js');
const glyph = require('../src/glyph');
const [dir, modelFile, limit = '100000'] = process.argv.slice(2);
glyph.loadModel(modelFile);
(async () => {
  const base = path.join(__dirname, '..');
  const w = await createWorker('eng', 1, {
    workerPath: require.resolve('tesseract.js/src/worker-script/node/index.js'),
    corePath: path.join(base, 'node_modules/tesseract.js-core'), langPath: path.join(base, 'tessdata'), gzip: false, cacheMethod: 'none',
  });
  await w.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
  const labels = JSON.parse(fs.readFileSync(path.join(dir, 'labels.json'), 'utf8')).slice(0, +limit);
  const out = [];
  for (const lb of labels) {
    const buf = fs.readFileSync(path.join(dir, `${lb.id}.png`));
    const png = PNG.sync.read(buf);
    const gray = new Uint8Array(png.width * png.height);
    for (let i = 0; i < gray.length; i++) gray[i] = png.data[i * 4];
    const { data } = await w.recognize(buf, {}, { text: true, blocks: true });
    const r = glyph.refine(data, gray, png.width, png.height, { minMargin: 0 });
    const r2 = glyph.refine(data, gray, png.width, png.height, { minMargin: 0.35 });
    out.push({ ...lb, raw: data.text, refined: r.text, refined_m: r2.text, aligned: r.aligned });
  }
  fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify(out));
  console.log('done', out.length, 'aligned', out.filter((o) => o.aligned).length);
  await w.terminate();
})();

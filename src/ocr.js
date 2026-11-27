'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { createWorker } = require('tesseract.js');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
let worker = null;
let workerLangs = '';
let chain = Promise.resolve(); // one recognition at a time

// Inside Electron tesseract.js fetch()es language data, which cannot read local files.
// So the bundled models are served from a loopback-only server (127.0.0.1, random port).
let server = null;
let langUrl = '';
function serveModels() {
  if (langUrl) return Promise.resolve(langUrl);
  const dir = path.join(ROOT, 'tessdata');
  server = http.createServer((req, res) => {
    const name = path.basename(decodeURIComponent((req.url || '').split('?')[0]));
    const file = path.join(dir, name);
    if (!/^[a-z_]+\.traineddata$/.test(name) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { langUrl = `http://127.0.0.1:${server.address().port}`; resolve(langUrl); });
  });
}

async function ensure(langs) {
  if (worker && workerLangs === langs) return worker;
  if (worker) await worker.terminate();
  const langPath = await serveModels();
  worker = await createWorker(langs, 1, {
    workerPath: require.resolve('tesseract.js/src/worker-script/node/index.js'),
    corePath: path.join(ROOT, 'node_modules', 'tesseract.js-core'),
    langPath,
    gzip: false,
    cacheMethod: 'none',
  });
  workerLangs = langs;
  return worker;
}

const memo = new Map(); // sha256(buffer+opts) -> cached Tesseract data (deep-copied on hit)
function recognize(buffer, { langs = 'eng+rus', psm = '6', whitelist = '' } = {}) {
  const key = crypto.createHash('sha256').update(buffer).digest('hex') + `|${langs}|${psm}|${whitelist}`;
  const hit = memo.get(key);
  if (hit) return Promise.resolve(JSON.parse(JSON.stringify(hit)));
  const job = chain.then(async () => {
    const w = await ensure(langs);
    await w.setParameters({
      tessedit_pageseg_mode: String(psm),
      preserve_interword_spaces: '1',
      user_defined_dpi: '300',
      tessedit_char_whitelist: whitelist,
    });
    const { data } = await w.recognize(buffer, {}, { text: true, blocks: true });
    const copy = JSON.parse(JSON.stringify(data)); // clean copy: callers mutate symbols (glyph._pre)
    if (memo.size > 8) memo.delete(memo.keys().next().value);
    memo.set(key, copy);
    return data; // text + blocks (symbols with boxes, confidence)
  });
  chain = job.catch(() => {});
  return job;
}

async function dispose() {
  if (worker) await worker.terminate();
  worker = null;
  if (server) server.close();
}

module.exports = { recognize, dispose, ensure };

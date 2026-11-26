const test = require('node:test');
const assert = require('node:assert');
const { translate, chunks } = require('../src/translate');

test('chunks keep lines whole and respect the limit', () => {
  const c = chunks('aaaa\nbbbb\ncccc', 9);
  assert.deepEqual(c, ['aaaa\nbbbb', 'cccc']);
});
test('google parser + same-language retry', async () => {
  const calls = [];
  global.fetch = async (url, o) => {
    calls.push(url);
    const tl = /tl=(\w+)/.exec(url)[1];
    return { ok: true, json: async () => [[[`out-${tl}`, 'x']], null, tl === 'ru' ? 'ru' : 'en'] };
  };
  const r = await translate('Привет', 'ru'); // source already Russian -> retries into English
  assert.equal(r.text, 'out-en');
  assert.equal(calls.length, 2);
});
test('falls back and reports offline', async () => {
  global.fetch = async () => { throw new Error('offline'); };
  await assert.rejects(translate('x', 'ru'), /Нет связи/);
});

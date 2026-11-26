const test = require('node:test');
const assert = require('node:assert');
const { sanitize } = require('../src/settings');

test('unknown keys and wrong types are dropped', () => {
  assert.deepEqual(sanitize({ evil: 1, __proto__: { x: 1 }, autoCopy: 'yes', mode: 'hack', upscale: 99 }), {});
  assert.deepEqual(sanitize(null), {});
  assert.deepEqual(sanitize('x'), {});
});
test('valid values pass', () => {
  assert.deepEqual(sanitize({ autoCopy: false, mode: 'raw', psm: '7', upscale: 2.5, accent: '#9d90ff', hotkey: 'Control+Shift+X', translateTo: 'de' }),
    { autoCopy: false, mode: 'raw', psm: '7', upscale: 2.5, accent: '#9d90ff', hotkey: 'Control+Shift+X', translateTo: 'de' });
});
test('update repo must be owner/repo, nothing else', () => {
  assert.equal(sanitize({ updateRepo: ' me/textsnip ' }).updateRepo, 'me/textsnip');
  assert.equal(sanitize({ updateRepo: '' }).updateRepo, '');
  for (const bad of ['https://evil.example/x.json', 'a/b/c', 'file:///c:/x', '../x', 'me/..', 'my.name/x', 'me/ts snip']) assert.equal('updateRepo' in sanitize({ updateRepo: bad }), false, bad);
});
test('accent and hotkey cannot carry markup', () => {
  assert.equal('accent' in sanitize({ accent: 'red;background:url(x)' }), false);
  assert.equal('hotkey' in sanitize({ hotkey: '<img src=x onerror=1>'.repeat(5) }), false);
});

const test = require('node:test');
const assert = require('node:assert');
const { fixText } = require('../src/wordfix');
const fix = (s) => fixText(s).text;

test('digits and bars read instead of letters are repaired by the dictionary', () => {
  assert.equal(fix('rep0rt finaI Wind0w5 t0taI'), 'report final Windows total');
  assert.equal(fix('the qzick fox'), 'the qzick fox'); // unknown word, no unique common candidate: untouched
  assert.equal(fix('ship 0n time'), 'ship on time');
  assert.equal(fix('Pre55 the key'), 'Press the key');
});
test('stray capitals inside a word are lowered', () => {
  assert.equal(fix('a brOwn fOx cOnverted'), 'a brown fox converted');
  assert.equal(fix('ScreenShOt5 are saved'), 'Screenshots are saved');
});
test('mixed Latin/Cyrillic words go to the majority alphabet', () => {
  assert.equal(fix('Oплата до 15 марта'), 'Оплата до 15 марта'); // Latin O -> Cyrillic О
  assert.equal(fix('Hастройки окна'), 'Настройки окна');
  assert.equal(fix('Версия cиcтемы'), 'Версия системы');
});
test('russian digits-in-words', () => {
  assert.equal(fix('c0лнце и ко3а'), 'солнце и коза');
});
test('numbers, codes, names and acronyms are never touched', () => {
  for (const s of ['0147 and 03/11/2026', 'ID: AB-7391 PC', 'XK3RJ-0O1IL-S5B8Z', 'GitHub TextSnip iPhone', 'version 1.4.1', '2,4 МБ', 'x86 mp3 H264', 'Ctrl+Shift+X']) assert.equal(fix(s), s, s);
});
test('real words are never "corrected" into other words', () => {
  const s = 'Order 100 items: Windows, Press, Total, online, orbit, solo, Illinois, SOS';
  assert.equal(fix(s), s);
});
test('a Russian word spelled in look-alike Latin letters inside a Russian line', () => {
  assert.equal(fix('Это был сон, а не caмoлёт'), 'Это был сон, а не самолёт');
});

test('look-alike letters inside dates, versions and numbers become digits', () => {
  assert.equal(fix('on 03/II/2026 at 1S.03.2O26'), 'on 03/11/2026 at 15.03.2026');
  assert.equal(fix('v1.4.1 and 2,4 МБ'), 'v1.4.1 and 2,4 МБ');
  assert.equal(fix('ID: AB-7391-ZQ'), 'ID: AB-7391-ZQ'); // only one pure number: not a numeric chain
  assert.equal(fix('call 555-O199'), 'call 555-0199');
});
test('one misread letter is fixed when the answer is unique and common', () => {
  assert.equal(fix('the guick brown fox'), 'the quick brown fox');
  assert.equal(fix('Press Ctri+Shift'), 'Press Ctrl+Shift');
  assert.equal(fix('Onder 0147'), 'Order 0147');
});
test('rare words and names are not turned into other words', () => {
  for (const s of ['Zorin Linux', 'Nginx server', 'Kubernetes pods', 'Raspberry Pi']) assert.equal(fix(s), s, s);
});

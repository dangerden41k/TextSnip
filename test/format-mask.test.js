const test = require('node:test');
const assert = require('node:assert');
const { formatText } = require('../src/format');
const { maskSensitive } = require('../src/mask');

test('format: keep leaves text alone', () => assert.equal(formatText('a\nb', 'keep'), 'a\nb'));
test('format: one line joins everything and glues hyphenated words', () => {
  assert.equal(formatText('Это длин-\nное слово\nв три строки', 'oneline'), 'Это длинное слово в три строки');
  assert.equal(formatText('well-\nKnown stays', 'oneline'), 'well- Known stays'); // capital next line: not a split word
});
test('format: paragraphs keep blank lines and list items', () => {
  const src = 'Первая строка\nпродолжение.\n\nВторой абзац.\n- пункт один\n- пункт два\nхвост пункта';
  assert.equal(formatText(src, 'paragraphs'), 'Первая строка продолжение.\n\nВторой абзац.\n- пункт один\n- пункт два хвост пункта');
});
test('mask: Luhn-valid card numbers only', () => {
  assert.equal(maskSensitive('Card 4111 1111 1111 1111 ok').text, 'Card •••• •••• •••• 1111 ok');
  assert.equal(maskSensitive('Card 4111-1111-1111-1111.').text, 'Card •••• •••• •••• 1111.');
  for (const s of ['order 4111 1111 1111 1112', 'date 15.03.2026', 'phone +7 912 345 67 89', 'id 1234567890123456789']) assert.equal(maskSensitive(s).text, s, s);
});
test('mask: IBAN with a valid checksum', () => {
  assert.equal(maskSensitive('GB82 WEST 1234 5698 7654 32').text, 'GB82 •••• •••• 5432');
  assert.equal(maskSensitive('GB00 WEST 1234 5698 7654 32').count, 0);
});
test('mask: e-mail, tokens, password labels', () => {
  assert.equal(maskSensitive('mail ivan.petrov@example.com now').text, 'mail i•••@example.com now');
  assert.equal(maskSensitive('key ghp_abcdefghijklmnopqrstuvwxyz0123456789 end').text, 'key •••••••• end');
  assert.equal(maskSensitive('Пароль: Qwerty123! и login').text, 'Пароль: •••••••• и login');
  assert.equal(maskSensitive('Authorization: Bearer abcdefghijklmnopqrstuvwxyz123').text, 'Authorization: Bearer ••••••••');
});
test('mask: game keys, versions, hashes of normal length stay', () => {
  for (const s of ['LCQH-87CP-MMDH-LF7Y', 'v1.4.1', 'build 2048', 'ID: AB-7391', 'sha 9f86d081884c7d65']) assert.equal(maskSensitive(s).text, s, s);
});

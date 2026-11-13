// The PIN screen in front of a shop's dashboard (src/components/manage/PinGate.jsx),
// redesigned 2026-11-13. The look changed; the checks must not: the PIN still goes
// to verify_store_pin, the reset still goes through the WhatsApp code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pinColors, nextDigits, shopInitial, isImageSrc } from '../src/utils/pinGate.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const GATE = read('src/components/manage/PinGate.jsx');
const MANAGE = read('src/pages/ManageStore.jsx');

/** WCAG contrast of a #rrggbb colour against white. */
function contrastWithWhite(hex) {
  const lin = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const n = parseInt(hex.slice(1), 16);
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return 1.05 / (L + 0.05);
}

test('colours: the shop colour, a darker button, a soft ring; bad input falls back', () => {
  assert.deepEqual(pinColors('#16a34a'), { accent: '#16a34a', button: '#12823b', ring: '#16a34a2e' });
  assert.deepEqual(pinColors('#16A34A'), pinColors('#16a34a'), 'case does not matter');
  assert.equal(pinColors('#0d9').accent, '#00dd99', 'short hex is expanded');
  for (const bad of [undefined, null, '', 'green', 'rgb(0,0,0)', '#12345', '#1234567', 42]) {
    assert.equal(pinColors(bad).accent, '#0d9488', String(bad));
  }
  assert.equal(pinColors('nope', '#2563eb').accent, '#2563eb');
});

test('the button is readable on the shop colours where the plain colour was not', () => {
  // A common green shop colour and PocketLink's default teal: white text fails on the
  // plain colour, passes on the button shade.
  for (const c of ['#16a34a', '#0d9488']) {
    assert.ok(contrastWithWhite(c) < 4.5, `${c} alone is below 4.5:1`);
    assert.ok(contrastWithWhite(pinColors(c).button) >= 4.5, `${c} button is at least 4.5:1`);
  }
});

test('digits: only numbers, never more than the boxes hold', () => {
  assert.equal(nextDigits('', '12', 4), '12');
  assert.equal(nextDigits('12', '12a3', 4), '123');
  assert.equal(nextDigits('', '123456', 4), '1234', 'a paste is cut to fit');
  assert.equal(nextDigits('', ' 4 8 1 2 9 0 ', 6), '481290', 'a pasted code with spaces');
  assert.equal(nextDigits('123', '12', 4), '12', 'delete');
  assert.equal(nextDigits('', null, 4), '');
});

test('digits after a wrong PIN: the next key starts again, a delete clears', () => {
  assert.equal(nextDigits('1234', '12345', 4, true), '5', 'typing replaces the wrong PIN');
  assert.equal(nextDigits('1234', '123', 4, true), '', 'delete clears all of it');
  assert.equal(nextDigits('1234', '1234', 4, true), '');
  assert.equal(nextDigits('1234', '12349876', 4, true), '9876', 'a paste after it is the new PIN');
});

test('logo: an image when there is one, else the first letter', () => {
  for (const ok of ['https://x.supabase.co/storage/v1/object/public/a/logo.jpg', 'http://a/b.png', 'data:image/png;base64,AAA', '/logo.svg']) {
    assert.equal(isImageSrc(ok), true, ok);
  }
  for (const no of ['', '🛍️', 'logo.png', 'javascript:alert(1)', null, undefined, {}]) assert.equal(isImageSrc(no), false, String(no));
  assert.equal(shopInitial('sunrise kirana'), 'S');
  assert.equal(shopInitial('  '), 'S');
  assert.equal(shopInitial(undefined), 'S');
});

test('the checks are unchanged: verify_store_pin, then the WhatsApp code reset', () => {
  assert.match(GATE, /ok = await verifyPin\(slug, value\)/);
  assert.match(GATE, /if \(ok\) \{ onVerified\(value\); return; \}/);
  assert.match(GATE, /await sendOtp\(`91\$\{phone10\}`\)/);
  assert.match(GATE, /await resetPin\(slug, newPin, `91\$\{phone10\}`, code\)/);
  assert.match(GATE, /if \(newPin !== confPin\)/);
  assert.match(GATE, /if \(code\.length !== 6\)/);
  // One unlock at a time, even when the 4th digit and Enter land together.
  assert.match(GATE, /if \(busy\.current\) return;/);
  assert.match(GATE, /if \(v\.length === 4\) unlock\(v\);/);
});

test('ManageStore uses the new screen and hands it the shop', () => {
  assert.match(MANAGE, /import PinGate +from '\.\.\/components\/manage\/PinGate';/);
  assert.match(MANAGE, /<PinGate slug=\{businessSlug\} config=\{config\} onVerified=/);
  assert.equal(/function PinGate\(/.test(MANAGE), false, 'the old screen is gone');
});

test('what the screen promises about the lock is what the server does', () => {
  const sql = read('supabase/pin-attempt-throttle.sql');
  assert.match(sql, /c_max_ip +constant integer +:= 10;/);
  assert.match(sql, /c_window +constant interval := interval '15 minutes';/);
  assert.equal((GATE.match(/After 10 wrong tries, PIN entry pauses for 15 minutes/g) || []).length, 2, 'phone and computer');
});

test('one real input per box row, with the right keyboard and autofill', () => {
  assert.match(GATE, /type="text" inputMode="numeric" pattern="\[0-9\]\*"/);
  assert.match(GATE, /autoComplete="one-time-code"/, 'the WhatsApp code can be filled by the phone');
  assert.equal(/type="number"/.test(GATE), false, 'no spinner arrows');
});

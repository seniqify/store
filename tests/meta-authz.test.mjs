// Authorisation rules for creating and controlling Meta campaigns.
//
// PocketLink sellers have no email accounts: they register with a WhatsApp
// number, prove it with a one-time code, and open Manage with a 4-digit PIN. So
// the PIN authorises creation, and the only step that spends money demands a
// fresh code sent to the store's REGISTERED number.
//
// These tests pin the two decisions that are easy to get quietly wrong: who may
// enable spend, and which phone number a one-time code is checked against.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activationAllowed, normalizePhone } from '../api/meta/campaign-launch.js';

// ── Who may enable spend ─────────────────────────────────────────────────────

test('a crm_team admin may activate without an OTP', () => {
  assert.equal(activationAllowed('admin', false), true);
});

test('a merchant may activate only after proving their WhatsApp number', () => {
  assert.equal(activationAllowed(null, true), true);
  assert.equal(activationAllowed(null, false), false);
});

test('knowing the PIN alone never enables spend', () => {
  // The PIN got them this far — it is what the handler checked before reaching
  // this point. It must not also be what authorises the money step.
  assert.equal(activationAllowed(null, false), false);
  assert.equal(activationAllowed(undefined, false), false);
});

test('a non-admin staff role cannot activate without an OTP', () => {
  assert.equal(activationAllowed('exec', false), false);
  assert.equal(activationAllowed('ads_tester', false), false);   // stale role
  assert.equal(activationAllowed('exec', true), true);           // ...but OTP counts
});

test('only a literal true counts as OTP proof', () => {
  // A failed lookup that returns a truthy object, or a string, must not pass.
  for (const bogus of [{}, 'true', 1, [], 'yes']) {
    assert.equal(activationAllowed(null, bogus), false);
  }
});

// ── Which phone the code is checked against ──────────────────────────────────
// The store's number comes from its own config server-side and is compared on
// the last 10 digits, so country-code formatting differences do not create a
// false mismatch — and a caller cannot redirect the proof to a phone they own.

test('country code and formatting do not change the identity', () => {
  const want = normalizePhone('9175187668');
  assert.equal(normalizePhone('919175187668'), want);
  assert.equal(normalizePhone('+91 91751 87668'), want);
  assert.equal(normalizePhone('+91-9175-187-668'), want);
  assert.equal(normalizePhone('0091 9175187668'), want);
});

test('different numbers never collide', () => {
  assert.notEqual(normalizePhone('9175187668'), normalizePhone('9175187669'));
  assert.notEqual(normalizePhone('919175187668'), normalizePhone('919175187660'));
});

test('empty or junk input yields null, never a match', () => {
  for (const bad of ['', '   ', null, undefined, 'abc', '+++']) {
    assert.equal(normalizePhone(bad), null);
  }
  // null must not equal null-ish in a way that lets two unknown numbers match:
  // the caller checks `if (!want) return false` before comparing.
  assert.equal(normalizePhone(''), normalizePhone('xyz'));   // both null
});

test('a short number is kept whole rather than silently padded', () => {
  assert.equal(normalizePhone('12345'), '12345');
});

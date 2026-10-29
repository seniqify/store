// A plan saved for a phone (a free month claimed, or a payment made, before the
// store was built) must not be resumed once its term has ended: the store would
// launch already expired (a free month claimed in August, finished in October).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { planTermEnded } from '../src/utils/planLimits.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const src = (p) => readFileSync(`${ROOT}${p}`, 'utf8');
const NOW = Date.parse('2026-10-25T10:17:00Z');

test('planTermEnded: a date in the past has ended', () => {
  assert.equal(planTermEnded('2026-09-21T09:00:00Z', NOW), true);
  assert.equal(planTermEnded('2026-10-25T10:17:00Z', NOW), true, 'ends exactly now');
});

test('planTermEnded: a future date, no date, or a bad date has not ended', () => {
  assert.equal(planTermEnded('2026-11-24T10:17:00Z', NOW), false);
  assert.equal(planTermEnded(null, NOW), false);
  assert.equal(planTermEnded('', NOW), false);
  assert.equal(planTermEnded('not a date', NOW), false);
});

test('a saved plan whose term ended is not resumed at sign-up', () => {
  const store = src('src/utils/storeService.js');
  const body = store.slice(store.indexOf('export async function getPendingSignup'), store.indexOf('export async function clearPendingSignup'));
  assert.match(body, /if \(planTermEnded\(data\.plan_expires_at\)\) return null;/);
});

test('onboarding will not launch on a plan that has already ended', () => {
  const onb = src('src/pages/Onboarding.jsx');
  assert.match(onb, /ssExp && !planTermEnded\(ssExp\)/, 'a stale plan in this browser is not used');
  assert.match(onb, /if \(!planExpiresAt \|\| planTermEnded\(planExpiresAt\)\) \{\s*navigate\('\/plans'/, 'Launch sends them to pick a plan');
});

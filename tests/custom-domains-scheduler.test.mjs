// PR-C.1: the custom-domain reconciler runs on a Vercel Cron schedule.
//
// What is scheduled, and why every 30 minutes rather than hourly: a connected
// group's health is due once last_checked_at is at least store_domain_health_interval()
// (1 hour) old, and last_checked_at is stamped when the check FINISHES -- a moment
// after the tick. Proven here against the real PR-B + PR-B.1 SQL, then followed
// through for the schedule actually configured in vercel.json.
//
// The reconciler's own behaviour under that schedule (health semantics, other
// groups untouched, no removal because of a failed check) is driven through the
// cron entry point in tests/custom-domains-server.test.mjs ("scheduled pass").
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createDb, domainIn, FUNCTION_PATHS } from './helpers/routingWorld.mjs';
import { asRole } from './helpers/domainDb.mjs';
import { RECONCILE_BUDGET_MS, LEASE_SAFETY_MS } from '../api/domains/_reconcile.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(`${ROOT}${p}`, 'utf8');
const VJ = JSON.parse(read('vercel.json'));
const PATH = '/api/domains/reconcile';

/** Minutes between ticks of a "*\/N * * * *" (or "0 * * * *") schedule; anything else is refused. */
function everyMinutes(schedule) {
  const [min, ...rest] = schedule.trim().split(/\s+/);
  assert.deepEqual(rest, ['*', '*', '*', '*'], 'every hour of every day');
  if (min === '0') return 60;
  const m = /^\*\/(\d+)$/.exec(min);
  assert.ok(m && 60 % Number(m[1]) === 0, `a minute step that divides the hour: ${min}`);
  return Number(m[1]);
}

/**
 * When a connected group gets its health checks under a schedule, by the
 * database's rule: due when last_checked_at <= tick - 1 h; a check stamps
 * last_checked_at a few seconds after its tick. Returns the gaps (minutes).
 */
function healthGaps(stepMin, { hours = 48, stampSec = 3 } = {}) {
  const checks = [stampSec];
  for (let t = stepMin * 60; t <= hours * 3600; t += stepMin * 60) {
    if (checks.at(-1) <= t - 3600) checks.push(t + stampSec);
  }
  return checks.slice(1).map((c, i) => (c - checks[i]) / 60);
}

// ═══════════════════════════════════════════════════════════════════════════

test('exactly one schedule: the existing reconciler endpoint, every 30 minutes', () => {
  assert.deepEqual(VJ.crons, [{ path: PATH, schedule: '*/30 * * * *' }]);
  assert.ok(existsSync(`${ROOT}api/domains/reconcile.js`), 'the scheduled path is a real function');
  assert.ok(FUNCTION_PATHS.has(PATH), 'and Vercel resolves it as one');
  // No second health system: the cron calls the same handler the server tests drive.
  assert.match(read('api/domains/reconcile.js'), /export async function handleReconcile/);
});

test('the edge middleware never sees the cron path (matcher), so it reaches the function on any host', async () => {
  const { config } = await import('../middleware.js');
  for (const pattern of config.matcher) {
    assert.doesNotMatch(PATH, new RegExp(`^${pattern}$`), pattern);
  }
});

test('time limits: one pass fits the function, and the group lease outlives it', () => {
  const maxMs = VJ.functions['api/domains/reconcile.js'].maxDuration * 1000;
  assert.equal(maxMs, 60000);
  assert.ok(RECONCILE_BUDGET_MS < maxMs, 'the pass stops itself before Vercel kills it');
  assert.ok(LEASE_SAFETY_MS > 0);
  // Ticks never overlap: a pass ends long before the next tick.
  assert.ok(everyMinutes(VJ.crons[0].schedule) * 60000 > maxMs);
});

test('the real SQL: health is due only once the last check is a full hour old', async () => {
  const db = await createDb();
  await domainIn(db, 'brandshop', 'brand.test', 'connected');
  const lease = async () => (await asRole(db, 'service_role', 'select * from public.domain_reconcile_lease(1)')).rows;
  const checkedAgo = (sql) => db.query(`update public.store_domains set last_checked_at = now() - interval '${sql}' where store_slug = 'brandshop'`);
  await checkedAgo('59 minutes 57 seconds');        // checked 3 s after the previous hourly tick
  assert.deepEqual(await lease(), [], 'an hourly tick finds it 3 s short: not due, nothing leased');
  await checkedAgo('60 minutes 1 second');
  const [l] = await lease();
  assert.equal(l?.work, 'health', 'one hour old: due');
  await db.close();
});

test('cadence: every connected group is checked every 60-90 minutes (hourly would mean every 2 hours)', () => {
  const step = everyMinutes(VJ.crons[0].schedule);
  const gaps = healthGaps(step);
  assert.ok(gaps.length > 20);
  assert.ok(Math.min(...gaps) >= 60, 'never more often than the database allows');
  assert.ok(Math.max(...gaps) <= 90, `checked at least every 90 minutes (got ${Math.max(...gaps)})`);
  // Two consecutive failures can only come from two separate checks: a DNS break
  // is marked misconfigured within two gaps.
  assert.ok(2 * Math.max(...gaps) <= 180);
  // Why not hourly: with the stamp a moment after the tick, every other tick is skipped.
  assert.deepEqual([...new Set(healthGaps(60))], [120]);
});

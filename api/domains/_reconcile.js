// The custom-domain reconciler: idempotent, database-led. Vercel is external,
// derived state; the database decides what should be true.
//
// One pass:
//   1. domain_expire_stale      TTLs (a group Vercel may still hold goes to
//                               cleanup, not release -- PR-B's rule)
//   2. verified / ready         attach missing hostnames (fresh add intent each),
//                               observe, mark ready when every hostname is
//                               configured; stale 'adding' rows are retried
//   3. connected / misconfigured  hourly health check (logic only; no schedule is
//                               installed by this PR)
//   4. disconnecting            remove from Vercel under a FRESH remove intent per
//                               attempt, observe, then domain_finish_disconnect,
//                               which alone decides the release (2-min fence)
//
// Running it twice in a row is safe: every step re-reads the database and asks
// it for authorisation again. With CUSTOM_DOMAINS_ENABLED off it does nothing at
// all -- no Vercel call, no database call.
import { syncGroup, releaseGroup, healthCheck } from './_steps.js';

export const HEALTH_INTERVAL_MS = 55 * 60 * 1000;        // hourly cadence, a little slack
export const RECONCILE_BUDGET_MS = 45000;                // start no new group after this
const WORK_STATUSES = ['verified', 'ready', 'connected', 'misconfigured', 'disconnecting'];

export function healthDue(g, nowMs) {
  return !g.last_checked_at || nowMs - Date.parse(g.last_checked_at) >= HEALTH_INTERVAL_MS;
}

export async function reconcile(deps, { now = () => Date.now(), budgetMs = RECONCILE_BUDGET_MS } = {}) {
  const { config, db, vercel } = deps;
  if (!config.enabled) return { outcome: 'feature_disabled' };
  if (!vercel.configured) return { outcome: 'not_configured' };

  const t0 = now();
  const summary = {
    outcome: 'ok', expired: 0, attached_or_observed: 0, marked_ready: 0,
    health_checked: 0, health_no_verdict: 0, cleanup_finished: 0, cleanup_pending: 0,
    skipped: 0, deferred: 0, errors: 0,
  };

  const exp = await db.expireStale(200);
  summary.expired = Number(exp?.expired) || 0;

  const groups = await db.groupsInStatus(WORK_STATUSES);
  for (let i = 0; i < groups.length; i++) {
    if (now() - t0 > budgetMs) { summary.deferred = groups.length - i; break; }
    const g = groups[i];
    try {
      if (g.status === 'verified' || g.status === 'ready') {
        const s = await syncGroup(deps, g, { attach: true, nowMs: now() });
        summary.attached_or_observed++;
        if (s.ready === 'ready') summary.marked_ready++;
      } else if (g.status === 'connected' || g.status === 'misconfigured') {
        if (!healthDue(g, now())) { summary.skipped++; continue; }
        const h = await healthCheck(deps, g);
        if (h.verdict === null) summary.health_no_verdict++; else summary.health_checked++;
      } else if (g.status === 'disconnecting') {
        const f = await releaseGroup(deps, g);
        if (f.outcome === 'disconnected' || f.outcome === 'expired') summary.cleanup_finished++;
        else summary.cleanup_pending++;
      }
    } catch {
      summary.errors++;                                   // one group never stops the rest
    }
  }
  return summary;
}

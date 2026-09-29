// The custom-domain reconciler: idempotent, database-led, fair.
//
// One pass:
//   1. domain_expire_stale         TTLs (a group Vercel may still hold goes to
//                                  cleanup, not release -- PR-B's rule)
//   2. repeat while the budget allows another whole step:
//        domain_reconcile_lease(1) -> ONE whole group, least-recently-served
//        first, across ALL kinds of work (PR-B.1); disjoint from any other
//        worker's; never a batch the budget could not finish
//        work = cleanup  remove from Vercel under fresh remove intents, then
//                        domain_finish_disconnect (the 2-minute fence decides)
//        work = health   one authoritative check, recorded ONLY with the lease's
//                        health token (a stale or duplicate result is refused)
//        work = sync     attach / observe / mark ready
//      until no group is eligible, or the budget is spent.
//
// Fairness: every lease moves its group to the back of one queue, so with N
// eligible groups each is served within N passes -- including a group whose
// worker crashed or timed out (its lease lapses after 120 s and it is served
// again in turn). Health-not-yet-due groups are not eligible at all.
//
// Time: the budget's hard deadline is the earlier of the pass budget and the
// lease's safe end (lease length - LEASE_SAFETY_MS). External calls stop
// RECORD_RESERVE_MS before it, so results can still be recorded. The lease
// (120 s) is twice the function's maxDuration (60 s), so it cannot expire under
// a live worker.
//
// With CUSTOM_DOMAINS_ENABLED off: no call of any kind.
import { syncGroup, releaseGroup, healthCheck } from './_steps.js';
import { createBudget, RECORD_RESERVE_MS, MIN_STEP_MS } from './_budget.js';

export const RECONCILE_BUDGET_MS = 50000;    // hard stop; maxDuration is 60 s
export const LEASE_SAFETY_MS = 30000;        // never plan to work in a lease's last 30 s

export async function reconcile(deps, { now = () => Date.now(), budgetMs = RECONCILE_BUDGET_MS, reserveMs = RECORD_RESERVE_MS } = {}) {
  const { config } = deps;
  if (!config.enabled) return { outcome: 'feature_disabled' };
  if (!deps.vercel.configured) return { outcome: 'not_configured' };

  const pass = createBudget({ totalMs: budgetMs, reserveMs, now });
  const bind = (budget) => ({ ...deps, budget, db: deps.db.withBudget(budget), vercel: deps.vercel.withBudget(budget) });
  const run = bind(pass);

  const summary = {
    outcome: 'ok', expired: 0, leased: 0, cleanup: 0, health: 0, sync: 0,
    marked_ready: 0, health_no_verdict: 0, cleanup_finished: 0, errors: 0, complete: false,
  };

  try {
    const exp = await run.db.expireStale(200);
    summary.expired = Number(exp?.expired) || 0;
  } catch {
    summary.errors++;
  }

  while (pass.canStart(MIN_STEP_MS)) {
    let lease;
    try {
      [lease] = await run.db.reconcileLease(1);
    } catch {
      summary.errors++;
      break;
    }
    if (!lease) { summary.complete = true; break; }
    summary.leased++;

    const groupBudget = pass.until(now() + Number(lease.lease_seconds) * 1000 - LEASE_SAFETY_MS);
    const gd = bind(groupBudget);
    try {
      const [g] = await gd.db.groupsByIds([lease.group_id]);
      if (!g || g.status !== lease.status) continue;              // changed since the lease: next pass
      if (lease.work === 'cleanup') {
        summary.cleanup++;
        const f = await releaseGroup(gd, g);
        if (f.outcome === 'disconnected' || f.outcome === 'expired') summary.cleanup_finished++;
      } else if (lease.work === 'health') {
        summary.health++;
        const h = await healthCheck(gd, g, lease.health_token);
        if (h.verdict === null) summary.health_no_verdict++;
      } else {
        summary.sync++;
        const s = await syncGroup(gd, g, { attach: true, nowMs: now() });
        if (s.ready === 'ready') summary.marked_ready++;
      }
    } catch {
      summary.errors++;                                   // one group never stops the rest
    }
  }
  return summary;
}

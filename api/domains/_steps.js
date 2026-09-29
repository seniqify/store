// The Vercel steps shared by the merchant API and the reconciler.
//
// Every step has the same shape, and none skips a stage:
//
//   read DB  ->  DB intent (domain_vercel_intent)  ->  Vercel call
//            ->  observe what is actually true  ->  record it (domain_vercel_observe)
//
// * No Vercel add or DELETE without an 'ok' intent obtained IMMEDIATELY before
//   it, in the same execution. A DELETE never reuses an earlier authorisation:
//   a retry -- this run or the next -- asks the database again, which renews the
//   2-minute release fence, and an ended group is refused (no DELETE at all).
// * Observations are Vercel's raw facts. A transport failure is "unknown" and
//   is NOT written, so a flaky API call can never demote or promote anything.
// * The database derives every state; nothing here assigns one.

const NEEDS_ATTACH = new Set(['none', 'removed', 'adding']);
const ON_VERCEL = (s) => s !== 'none' && s !== 'removed';
export const CONFLICT_BACKOFF_MS = 60 * 60 * 1000;

const ABSENT = { attached: false, verified: null, misconfigured: null };

/** Observe one hostname and record the facts. */
export async function observeRow({ db, vercel }, g, host, { recheckVerification = true } = {}) {
  const f = await vercel.facts(host, { recheckVerification });
  if (f.unknown) return { host, unknown: true, reason: f.reason };
  const r = await db.vercelObserve(g.group_id, g.store_slug, host, f);
  return { host, outcome: r.outcome, vercel_state: r.vercel_state, status: r.status, recommended: f.recommended ?? null };
}

/** Attach one hostname to THIS project, only under an 'ok' add intent. */
export async function attachRow(deps, g, row) {
  const { db, vercel } = deps;
  const host = row.hostname;
  const i = await db.vercelIntent(g.group_id, g.store_slug, host, 'add');
  if (i.outcome === 'already_attached') return observeRow(deps, g, host);
  if (i.outcome !== 'ok') return { host, refused: i.outcome };          // not authorised: Vercel untouched

  const a = await vercel.add(host);
  if (a.result === 'attached' || a.result === 'already_attached') return observeRow(deps, g, host);
  if (a.result === 'conflict') {
    // Another project or account holds the name. Never taken, never removed:
    // record the fact that it is NOT on this project, with a bounded reason.
    const r = await db.vercelObserve(g.group_id, g.store_slug, host, ABSENT, 'vercel_conflict');
    return { host, conflict: true, vercel_state: r.vercel_state };
  }
  if (a.result === 'rejected') {
    const seen = await vercel.inspect(host);
    if (seen.unknown) return { host, rejected: a.reason };
    if (seen.attached) return observeRow(deps, g, host);
    const r = await db.vercelObserve(g.group_id, g.store_slug, host, ABSENT, a.reason);
    return { host, rejected: a.reason, vercel_state: r.vercel_state };
  }
  // No answer: the row stays 'adding'; the next attempt re-authorises.
  return { host, unknown: true, reason: a.reason };
}

function conflictBackoff(row, nowMs) {
  return row.vercel_state === 'removed' && row.last_error === 'vercel_conflict'
    && row.vercel_state_at && nowMs - Date.parse(row.vercel_state_at) < CONFLICT_BACKOFF_MS;
}

/**
 * Bring a verified / ready group's hostnames in line with Vercel; mark the
 * group ready when the database agrees every hostname is configured.
 */
export async function syncGroup(deps, g, { attach = true, nowMs = Date.now() } = {}) {
  const results = [];
  for (const row of g.rows) {
    if (attach && NEEDS_ATTACH.has(row.vercel_state)) {
      results.push(conflictBackoff(row, nowMs)
        ? { host: row.hostname, backoff: true, vercel_state: row.vercel_state }
        : await attachRow(deps, g, row));
    } else if (row.vercel_state === 'none') {
      results.push({ host: row.hostname, vercel_state: 'none' });      // never sent: nothing to observe
    } else {
      results.push(await observeRow(deps, g, row.hostname));
    }
  }
  const anyUnknown = results.some((r) => r.unknown);
  const allConfigured = results.length > 0 && results.every((r) => r.vercel_state === 'configured');
  let ready = null;
  if (allConfigured && (g.status === 'verified' || results.some((r) => r.status === 'verified'))) {
    ready = (await deps.db.markReady(g.group_id, g.store_slug)).outcome;
  }
  return { results, anyUnknown, allConfigured, ready };
}

/** Remove one hostname -- only under a FRESH 'ok' remove intent. */
export async function releaseRow(deps, g, row) {
  const { db, vercel } = deps;
  const host = row.hostname;
  if (!ON_VERCEL(row.vercel_state)) return { host, skipped: true };
  const i = await db.vercelIntent(g.group_id, g.store_slug, host, 'remove');
  if (i.outcome === 'nothing_to_remove') return { host, skipped: true };
  if (i.outcome !== 'ok') return { host, refused: i.outcome };          // e.g. group_ended: no DELETE

  const d = await vercel.remove(host);                                 // bounded well inside the fence
  if (d.result !== 'removed' && d.result !== 'absent') return { host, pending: d.reason };

  // Confirm what is actually true before recording it.
  const seen = await vercel.inspect(host);
  if (seen.unknown) return { host, pending: seen.reason };
  if (seen.attached) return observeRow(deps, g, host);
  const r = await db.vercelObserve(g.group_id, g.store_slug, host, ABSENT);
  return { host, removed: true, vercel_state: r.vercel_state };
}

/** Clean up a 'disconnecting' group, then let the database decide the release. */
export async function releaseGroup(deps, g) {
  const results = [];
  for (const row of g.rows) results.push(await releaseRow(deps, g, row));
  const f = await deps.db.finishDisconnect(g.group_id, g.store_slug);
  return { results, outcome: f.outcome, retry_after_seconds: f.retry_after_seconds ?? null };
}

/**
 * One authoritative health check of a connected / misconfigured group.
 * Verdict only when Vercel answered for EVERY hostname; a transport failure is
 * no verdict at all (not a failure, not a success). Unknown or null facts are
 * never healthy. PocketLink's TXT record is deliberately not part of this.
 */
export async function healthCheck(deps, g) {
  const { db, vercel } = deps;
  const facts = [];
  for (const row of g.rows) {
    const f = await vercel.facts(row.hostname, { recheckVerification: false });
    if (f.unknown) return { verdict: null, reason: f.reason };
    facts.push([row.hostname, f]);
  }
  const states = [];
  for (const [host, f] of facts) {
    const r = await db.vercelObserve(g.group_id, g.store_slug, host, f);
    states.push([host, r.vercel_state]);
  }
  const bad = states.filter(([, s]) => s !== 'configured').map(([h, s]) => `${h}=${s}`);
  const ok = bad.length === 0;
  const r = await db.healthUpdate(g.group_id, g.store_slug, ok, ok ? null : `not_configured: ${bad.join(', ')}`.slice(0, 300));
  return { verdict: ok, outcome: r.outcome, failures: r.failures ?? null };
}

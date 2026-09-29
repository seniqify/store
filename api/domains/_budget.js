// One execution budget per merchant request or reconciler pass.
//
// Two deadlines, so results can always be written down:
//   hard            nothing at all runs after this (the function is still alive)
//   actionDeadline  = hard - reserve. No EXTERNAL work (Vercel, DNS) runs after
//                   this; the reserve is kept for recording what was learnt
//                   (domain_vercel_observe, domain_health_update, finish).
// Every client caps each call's timeout at the time left in its window, and
// refuses to START a call that could not usefully finish. A step never takes a
// database intent it could not follow through (see _steps.js).

export const RECORD_RESERVE_MS = 8000;
export const MIN_EXTERNAL_MS = 1500;   // don't start a Vercel / DNS call with less than this
export const MIN_DB_MS = 500;          // don't start a database call with less than this
export const MIN_STEP_MS = 4000;       // intent + external call + observation

export function createBudget({ totalMs, reserveMs = RECORD_RESERVE_MS, now = () => Date.now(), hard } = {}) {
  const hardAt = hard ?? now() + totalMs;
  const budget = {
    now,
    hard: hardAt,
    actionDeadline: hardAt - reserveMs,
    reserveMs,
    actionLeft: () => budget.actionDeadline - now(),
    recordLeft: () => budget.hard - now(),
    canStart: (ms = MIN_EXTERNAL_MS) => budget.actionLeft() >= ms,
    /** A budget that also ends by `deadline` (e.g. a lease's safe end). */
    until: (deadline) => createBudget({ hard: Math.min(budget.hard, deadline), reserveMs, now }),
  };
  return budget;
}

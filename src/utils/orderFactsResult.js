/**
 * The result contract for the canonical order-facts feed.
 *
 * Every other fetcher in orderService collapses a failure into an empty array,
 * which is fine for a list you are going to render. It is NOT fine for the feed
 * the accounting is computed from: there, an empty array is a real answer — this
 * store has taken no orders — and a failure means we do not know. Rendered the
 * same way, a dropped connection tells a trading merchant their Gross Sales is
 * zero.
 *
 * So the feed returns an envelope:
 *
 *   { ok: true,  data: [...] }          the server answered
 *   { ok: false, data: [], reason }     it did not
 *
 * `reason` is a coarse, safe label for the UI to branch on. Backend error text
 * never passes through it, so nothing about the database reaches the screen.
 *
 * This module is pure and imports nothing, so the contract can be tested
 * directly rather than inferred from the shape of a mocked client.
 */

/** The only reasons a read can fail. Anything else is normalised to the last. */
export const FACTS_FAILURE_REASONS = Object.freeze(['rpc', 'malformed', 'unavailable']);

/** A failed read. Always carries an empty list, so a careless caller that
 *  ignores `ok` still cannot mistake stale rows for fresh ones. */
export function factsFailed(reason = 'unavailable') {
  return {
    ok: false,
    data: [],
    reason: FACTS_FAILURE_REASONS.includes(reason) ? reason : 'unavailable',
  };
}

/**
 * Turn a supabase-js `{ data, error }` response into the envelope.
 *
 * An `error` is a failure. A success whose payload is not a list is also a
 * failure — counting money out of something that is not an array of rows is not
 * something to do quietly.
 */
export function factsFromRpc(response) {
  const { data, error } = response || {};
  if (error) return factsFailed('rpc');
  if (!Array.isArray(data)) return factsFailed('malformed');
  return { ok: true, data };
}

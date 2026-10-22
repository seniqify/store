/**
 * rpcPages — read EVERY row a set-returning database function gives back.
 *
 * The Supabase API hands back at most 1,000 rows per request (PostgREST's
 * max-rows), whatever the function returns, and it does not say when it cuts.
 * A function written with "no LIMIT" is still capped at 1,000 in the browser.
 * That is how krupaagarbattiwork's Stats read 429 orders out of 964
 * (2026-10-22): get_store_order_facts returns newest first, abandoned
 * checkouts included, and her newest 1,000 rows were mostly abandoned ones.
 *
 * readAllRpcRows asks for the total once (Prefer: count=exact), then reads the
 * rows a page at a time in a fixed OLDEST-first order - a new order arriving
 * meanwhile lands after the last page, so nothing already counted shifts. It
 * advances by the rows actually received, so a server cap below the page size
 * cannot end the read early, and it refuses to answer with fewer rows than the
 * database counted: an accounting screen must say "could not load", never show
 * a quietly short total.
 *
 * Pure apart from the `call` it is handed, so it can be tested without a network.
 */

export const RPC_PAGE_SIZE = 1000;
// Safety stop: 500 pages of 1,000 is 500,000 rows.
export const MAX_RPC_PAGES = 500;

/**
 * @param {(withCount: boolean) => object} call  builds a FRESH query for the
 *   function each time, e.g. (c) => supabase.rpc(fn, args, c ? { count: 'exact' } : undefined)
 * @param {object} [opts]
 * @param {Array<[string, boolean]>} [opts.order]  [column, ascending] pairs - a
 *   total order, so pages never overlap or leave gaps
 * @param {number} [opts.pageSize]
 * @returns {Promise<{ data: Array|null, error: any }>}  a supabase-style
 *   response: every row, or an error (never a partial list)
 */
export async function readAllRpcRows(call, {
  order = [['created_at', true], ['id', true]],
  pageSize = RPC_PAGE_SIZE,
} = {}) {
  const rows = [];
  const seen = new Set();
  let total = null;
  let offset = 0;

  for (let page = 0; page < MAX_RPC_PAGES; page++) {
    let q = call(page === 0);
    for (const [column, ascending] of order) q = q.order(column, { ascending });
    let res;
    try {
      res = await q.range(offset, offset + pageSize - 1);
    } catch (e) {
      return { data: null, error: e || new Error('request failed') };
    }
    const { data, error } = res || {};
    if (error) return { data: null, error };
    if (!Array.isArray(data)) return { data, error: null };   // the caller's own check fails it
    if (page === 0 && Number.isInteger(res.count)) total = res.count;

    for (const r of data) {
      const id = r && r.id;
      if (id != null) {
        if (seen.has(id)) continue;
        seen.add(id);
      }
      rows.push(r);
    }
    offset += data.length;
    if (data.length === 0) break;
    if (total !== null && offset >= total) break;
    if (page === MAX_RPC_PAGES - 1) return { data: null, error: new Error('too many rows') };
  }

  if (total !== null && rows.length < total) {
    return { data: null, error: new Error(`read ${rows.length} of ${total} rows`) };
  }
  return { data: rows, error: null };
}

/** Newest first, ties broken by id - the order the functions themselves return. */
export function newestFirst(rows) {
  return [...rows].sort((a, b) => {
    const ta = Date.parse(a?.created_at) || 0;
    const tb = Date.parse(b?.created_at) || 0;
    if (ta !== tb) return tb - ta;
    const ia = String(a?.id ?? '');
    const ib = String(b?.id ?? '');
    return ia < ib ? 1 : ia > ib ? -1 : 0;
  });
}

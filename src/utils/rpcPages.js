/**
 * rpcPages — read EVERY row of a Supabase read: a set-returning database
 * function or a table select.
 *
 * The Supabase API hands back at most 1,000 rows per request (PostgREST's
 * max-rows), whatever the query asks for, and it does not say when it cuts.
 * `.limit(2000)` still returns 1,000, and a function written with "no LIMIT"
 * is still capped at 1,000 in the browser. That is how krupaagarbattiwork's
 * Stats read 429 orders out of 964 (2026-10-22): get_store_order_facts returns
 * newest first, abandoned checkouts included, and her newest 1,000 rows were
 * mostly abandoned ones. The Console and Sales Hub stopped the same way.
 *
 * readAllRpcRows asks for the total once (Prefer: count=exact) with the first
 * page, then reads the remaining pages - a few at a time - in a fixed
 * OLDEST-first order, so an order or a view arriving meanwhile lands after the
 * last page and nothing already counted shifts. The page stride is what the
 * server actually returned, so a cap below the page size cannot leave gaps. It
 * refuses to answer with fewer rows than the database counted: an accounting
 * screen must say "could not load", never show a quietly short total.
 *
 * Pure apart from the `call` it is handed, so it can be tested without a network.
 */

export const RPC_PAGE_SIZE = 1000;
// Safety stop: 500 pages of 1,000 is 500,000 rows.
export const MAX_RPC_PAGES = 500;
// Pages in flight at once after the first.
export const RPC_PARALLEL = 4;

/**
 * @param {(withCount: boolean) => object} call  builds a FRESH query each time,
 *   e.g. (c) => supabase.rpc(fn, args, c ? { count: 'exact' } : undefined)
 *   or   (c) => supabase.from(t).select(cols, c ? { count: 'exact' } : undefined)
 * @param {object} [opts]
 * @param {Array<[string, boolean]>} [opts.order]  [column, ascending] pairs - a
 *   total order, so pages never overlap or leave gaps
 * @param {string} [opts.key]  the unique column, to drop a row seen twice
 * @param {number} [opts.pageSize]
 * @param {number} [opts.parallel]
 * @returns {Promise<{ data: Array|null, error: any }>}  a supabase-style
 *   response: every row, or an error (never a partial list)
 */
export async function readAllRpcRows(call, {
  order = [['created_at', true], ['id', true]],
  key = 'id',
  pageSize = RPC_PAGE_SIZE,
  parallel = RPC_PARALLEL,
} = {}) {
  const page = (offset, withCount) => {
    let q = call(withCount);
    for (const [column, ascending] of order) q = q.order(column, { ascending });
    return q.range(offset, offset + pageSize - 1);
  };
  const rows = [];
  const seen = new Set();
  const take = (data) => {
    for (const r of data) {
      const k = r == null ? null : r[key];
      if (k != null) {
        if (seen.has(k)) continue;
        seen.add(k);
      }
      rows.push(r);
    }
  };
  const failed = (e) => ({ data: null, error: e || new Error('request failed') });

  let first;
  try {
    first = await page(0, true);
  } catch (e) {
    return failed(e);
  }
  if (first?.error) return { data: null, error: first.error };
  if (!Array.isArray(first?.data)) return { data: first?.data ?? null, error: null };   // the caller's own check fails it
  take(first.data);
  const total = Number.isInteger(first.count) ? first.count : null;

  if (total !== null) {
    if (first.data.length >= total) return { data: rows, error: null };
    if (first.data.length === 0) return failed(new Error(`read 0 of ${total} rows`));
    // The server may cap below pageSize: step by what it actually gave.
    const stride = first.data.length;
    const offsets = [];
    for (let o = stride; o < total; o += stride) offsets.push(o);
    if (offsets.length >= MAX_RPC_PAGES) return failed(new Error('too many rows'));

    const results = new Array(offsets.length);
    let next = 0;
    const worker = async () => {
      while (next < offsets.length) {
        const i = next++;
        results[i] = await page(offsets[i], false);
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.min(parallel, offsets.length) }, worker));
    } catch (e) {
      return failed(e);
    }
    for (const res of results) {
      if (res?.error) return { data: null, error: res.error };
      if (!Array.isArray(res?.data)) return failed(new Error('malformed page'));
      take(res.data);
    }
    if (rows.length < total) return failed(new Error(`read ${rows.length} of ${total} rows`));
    return { data: rows, error: null };
  }

  // No count from the server: one page at a time until an empty one.
  let offset = first.data.length;
  if (offset === 0) return { data: rows, error: null };
  for (let n = 1; n < MAX_RPC_PAGES; n++) {
    let res;
    try {
      res = await page(offset, false);
    } catch (e) {
      return failed(e);
    }
    if (res?.error) return { data: null, error: res.error };
    if (!Array.isArray(res?.data)) return failed(new Error('malformed page'));
    if (res.data.length === 0) return { data: rows, error: null };
    take(res.data);
    offset += res.data.length;
  }
  return failed(new Error('too many rows'));
}

/** For screens whose fetchers answer "nothing" on failure: every row, or []. */
export async function readAllRowsOrEmpty(call, opts) {
  try {
    const { data, error } = await readAllRpcRows(call, opts);
    return error || !Array.isArray(data) ? [] : data;
  } catch {
    return [];
  }
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

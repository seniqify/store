/**
 * orderPages — read EVERY order of a store, a page at a time.
 *
 * get_store_orders returns the newest DETAILED_ORDER_CAP real orders (plus the
 * newest ABANDONED_ORDER_CAP abandoned checkouts). When that page is full,
 * get_store_orders_before (supabase/orders-history-forward.sql) reads the older
 * real orders, 500 at a time, until the store's first order.
 *
 * Pure apart from the `rpc(fn, args)` it is handed (supabase.rpc in the app),
 * so the paging can be tested against a real database.
 */
import { DETAILED_ORDER_CAP } from './ordersView.js';

// Safety stop: 400 pages is 200,000 orders. Past it the list says it is partial.
export const MAX_ORDER_PAGES = 400;

const isAbandonedRow = (o) => String(o?.status ?? '').toLowerCase() === 'abandoned';

// The oldest real order in get_store_orders' page (it is newest first), or null
// when the page is not full - then the store has no older orders to read.
function firstPageBoundary(first) {
  const real = first.filter((o) => !isAbandonedRow(o));
  return real.length >= DETAILED_ORDER_CAP ? real[real.length - 1] : null;
}

/**
 * Every order, newest page first. Resolves null when the first page cannot be
 * read (the caller shows nothing rather than a misleading empty list).
 *
 * `reuse`: rows a previous read of this store returned. The first page is
 * re-read and the older orders are taken from `reuse` instead of being paged
 * again - for silent polling. Ignored when `reuse` was itself partial.
 *
 * The result carries `partial: true` when an older page failed: the newest
 * orders are all there, some older ones are not.
 */
export async function readAllOrders(rpc, slug, hashed, { reuse = null } = {}) {
  const { data, error } = await rpc('get_store_orders', { p_slug: slug, p_hashed_pin: hashed });
  if (error) return null;
  const first = data || [];
  const older = Array.isArray(reuse) && !reuse.partial
    ? keepOlder(first, reuse)
    : await pageOlder(rpc, slug, hashed, first);
  const rows = [...first, ...older.rows];
  if (older.partial) rows.partial = true;
  return rows;
}

/** Page back from get_store_orders' oldest real order to the store's first. */
async function pageOlder(rpc, slug, hashed, first) {
  const boundary = firstPageBoundary(first);
  if (!boundary) return { rows: [], partial: false };
  const seen = new Set(first.map((o) => o.id));
  const rows = [];
  // The first step is inclusive of the boundary timestamp (get_store_orders
  // breaks ties arbitrarily), so pass no id; duplicates are dropped by id.
  let cursor = { at: boundary.created_at, id: null };
  for (let page = 0; page < MAX_ORDER_PAGES; page++) {
    let res;
    try {
      res = await rpc('get_store_orders_before', {
        p_slug: slug, p_hashed_pin: hashed, p_before_at: cursor.at, p_before_id: cursor.id,
      });
    } catch {
      return { rows, partial: true };
    }
    const { data, error } = res || {};
    if (error || !Array.isArray(data)) return { rows, partial: true };
    let added = 0;
    for (const o of data) {
      if (seen.has(o.id)) continue;
      seen.add(o.id);
      rows.push(o);
      added++;
    }
    if (data.length < DETAILED_ORDER_CAP) return { rows, partial: false };
    if (!added) return { rows, partial: true };   // the cursor did not move
    const last = data[data.length - 1];
    cursor = { at: last.created_at, id: last.id };
  }
  return { rows, partial: true };
}

/** The older orders of a previous read, past the fresh first page. */
function keepOlder(first, reuse) {
  const boundary = firstPageBoundary(first);
  if (!boundary) return { rows: [], partial: false };
  const seen = new Set(first.map((o) => o.id));
  const at = new Date(boundary.created_at).getTime();
  return {
    rows: reuse.filter((o) => !seen.has(o.id) && !isAbandonedRow(o)
      && new Date(o.created_at).getTime() <= at),
    partial: false,
  };
}

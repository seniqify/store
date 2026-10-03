/**
 * Abandoned carts — the numbers Home and the Abandoned tab both show.
 *
 * The RULE lives in one place, the database function get_store_abandoned_carts
 * (supabase/abandoned-carts-forward.sql): one row per customer (phone) who
 * reached checkout in the last 30 IST days and has not ordered since, carrying
 * their latest cart and how many days they tried. This file only adds those
 * rows up, so the two screens cannot drift apart again — the 406-vs-50 bug was
 * two screens each counting abandoned rows their own way.
 *
 * Pure: no React, no clock, no network.
 */

/** Civil days in the window. Must equal the SQL's `interval '29 days'` + today. */
export const ABANDONED_WINDOW_DAYS = 30;

/** Cards the Abandoned tab renders per "Show more" tap. A page size, never a cap. */
export const ABANDONED_PAGE_SIZE = 50;

const paise = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) : 0; };

/**
 * @param {Array<object>} rows  rows from get_store_abandoned_carts
 * @returns {{ count: number, value: number, attempts: number }}
 *   count     customers to win back (the number both screens show)
 *   value     rupees in their latest carts
 *   attempts  checkout attempts behind them (at least one each)
 */
export function summarizeAbandoned(rows) {
  const list = Array.isArray(rows) ? rows : [];
  let valuePaise = 0;
  let attempts = 0;
  for (const r of list) {
    valuePaise += paise(r?.total);
    const n = Math.trunc(Number(r?.attempts));
    attempts += Number.isFinite(n) && n > 1 ? n : 1;
  }
  return { count: list.length, value: valuePaise / 100, attempts };
}

import { supabase } from '../lib/supabase';

/**
 * Real social proof for the storefront.
 * ────────────────────────────────────────────────────────────────────────────
 * Reads per-product sales aggregates (units sold, orders, units in the last 7
 * days) from the `get_product_sales` RPC — a SECURITY DEFINER function that
 * returns ONLY counts grouped by product name (no customer PII), so it's safe
 * for anonymous storefront visitors even though orders are otherwise RLS-locked.
 *
 * Cached per session (sessionStorage, 15 min TTL) so browsing the catalog and
 * opening products never re-hits the DB — the call fires once per store, off the
 * render path, and the cards enhance in when it resolves.
 *
 * Matching is by product NAME (orders store the name, not an id). Owners rename
 * products over time (e.g. add "(Pack of 3)"), so old orders can carry a slightly
 * different name than the live product. The SalesIndex therefore matches EXACT
 * first, then falls back to a normalised key (lowercased, parentheticals and
 * punctuation stripped) so a renamed product still shows its real sales.
 */

const TTL_MS = 15 * 60 * 1000;   // 15 minutes — sales barely move within a visit

// Thresholds: never show weak proof. "2 sold" undersells; silence is better.
const WEEK_MIN  = 3;   // "N bought this week" needs real recent demand
const TOTAL_MIN = 6;   // "N sold" needs a believable base

// Loose key for fuzzy matching: drop bracketed notes, keep alphanumerics only.
//   "Bajar Amti 90 g Per Packet ( Pack of 3)" → "bajar amti 90 g per packet"
function normKey(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')   // strip "(...)" notes that get added on renames
    .replace(/[^a-z0-9]+/g, ' ')  // punctuation → space
    .trim();
}

/** Name-keyed sales lookup with an exact-then-normalised fallback. Quacks like a
 *  Map for callers: `.get(name)` and `.size`. */
class SalesIndex {
  constructor(rows) {
    this.exact = new Map();
    this.norm  = new Map();
    for (const r of Array.isArray(rows) ? rows : []) {
      if (!r || !r.name) continue;
      const info = {
        sold:     Number(r.sold)      || 0,
        orders:   Number(r.orders)    || 0,
        soldWeek: Number(r.sold_week) || 0,
      };
      this.exact.set(r.name, info);
      // Sum into the normalised bucket so two old spellings of one product add up.
      const k = normKey(r.name);
      const prev = this.norm.get(k);
      this.norm.set(k, prev
        ? { sold: prev.sold + info.sold, orders: prev.orders + info.orders, soldWeek: prev.soldWeek + info.soldWeek }
        : { ...info });
    }
  }
  get size() { return this.exact.size; }
  get(name) {
    if (!name) return undefined;
    return this.exact.get(name) || this.norm.get(normKey(name));
  }
}

/**
 * Fetch a store's per-product sales as a SalesIndex (use `.get(productName)` →
 * { sold, orders, soldWeek }). Never throws; returns an empty index on any error
 * (so the storefront simply shows no proof rather than breaking).
 */
export async function fetchProductSales(slug) {
  if (!slug) return new SalesIndex([]);
  const key = `pl_sales_${slug}`;

  // Session cache — instant on repeat page loads within the visit.
  try {
    const raw = sessionStorage.getItem(key);
    if (raw) {
      const cached = JSON.parse(raw);
      if (cached && Array.isArray(cached.rows) && Date.now() - cached.t < TTL_MS) {
        return new SalesIndex(cached.rows);
      }
    }
  } catch { /* ignore malformed/unavailable storage */ }

  try {
    const { data, error } = await supabase.rpc('get_product_sales', { p_slug: slug });
    if (error || !Array.isArray(data)) return new SalesIndex([]);
    try { sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), rows: data })); } catch { /* quota — skip cache */ }
    return new SalesIndex(data);
  } catch {
    return new SalesIndex([]);
  }
}

/**
 * Turn one product's sales into a short, honest social-proof line — or null when
 * the numbers are too small to help. Recent demand wins over lifetime total.
 *   { text, hot }  — `hot` = urgent/trending styling (this-week signal).
 */
export function proofFor(info) {
  if (!info) return null;
  const sold     = Number(info.sold)     || 0;
  const soldWeek = Number(info.soldWeek) || 0;
  if (soldWeek >= WEEK_MIN)  return { text: `${soldWeek} bought this week`, hot: true };
  if (sold     >= TOTAL_MIN) return { text: `${sold} sold`, hot: false };
  return null;
}

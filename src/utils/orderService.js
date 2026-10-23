import { supabase } from '../lib/supabase';
import { calcCartTotals } from './currency';
import { couponDiscountFor } from './offers';
import { hashPin } from './pinHash';
import { lineProductId } from './reviewShape';
import { getMetaMatchData } from './metaPixel';
import { factsFromRpc, factsFailed } from './orderFactsResult';
import { readAllOrders } from './orderPages.js';
import { readAllRpcRows, newestFirst } from './rpcPages.js';

/**
 * Order capture + retrieval.
 *  • saveOrder      — public (anon) insert when a customer places an order.
 *  • saveLead       — public (anon) insert when a customer requests a service quote.
 *  • fetchOrders    — owner-only read, gated by the store PIN (server RPC).
 *  • setOrderStatus — owner-only status update, gated by the store PIN.
 *
 * Customers can INSERT but never SELECT orders (RLS), so customer PII is only
 * readable by the owner via the PIN-checked RPCs.
 */

/** Build the exact `orders` row for a placed order. Shared by the client insert
 *  (saveOrder) and the server-side safety net (the order-notify edge function),
 *  so both persist an identical shape. `id` is passed in so the same row id is
 *  reused everywhere → the server upsert dedupes cleanly against the client insert.
 *
 *  `confirmToken` is passed in for the same reason: the DB would happily mint one
 *  by default, but then the checkout success screen could not link to
 *  /order/<token> without a round-trip (RLS lets customers INSERT an order and
 *  never SELECT it back). Minting it caller-side means the client insert and the
 *  safety-net upsert agree on one token, and the buyer gets their tracking link
 *  the instant the order is placed. */
export function buildOrderRow(customerDetails = {}, cart = [], config = {}, coupon = null, id, confirmToken) {
  const { subtotal, tax, shipping, packaging, codFee, total } =
    calcCartTotals(cart, config.cart, customerDetails.paymentMethod);
  const couponDiscount = coupon ? couponDiscountFor(coupon, subtotal) : 0;
  const netTotal = Math.max(0, total - couponDiscount);
  const couponNote = couponDiscount > 0 ? `Coupon ${coupon.code} (−₹${couponDiscount})` : '';
  // Meta match signals (fbp/fbc/ua) captured now so a later server-side CAPI
  // Purchase (fired at merchant-accept / payment-verify) can still be matched.
  const { fbp, fbc, ua } = getMetaMatchData();
  return {
    ...(id ? { id } : {}),
    ...(confirmToken ? { confirm_token: confirmToken } : {}),
    fbp: fbp || null, fbc: fbc || null, client_ua: ua || null,
    store_slug:     config.slug,
    customer_name:  customerDetails.partyName || customerDetails.name || '',
    customer_phone: String(customerDetails.mobile || customerDetails.phone || '').replace(/\D/g, '').slice(-10),
    destination:    customerDetails.destination || customerDetails.city || '',
    pincode:        String(customerDetails.pincode || '').replace(/\D/g, '').slice(0, 6),
    payment_method: customerDetails.paymentMethod || '',
    notes:          [customerDetails.notes || '', couponNote].filter(Boolean).join(' · '),
    items:          cart.map((i) => ({ productId: lineProductId(i), name: i.name, price: i.price, qty: i.qty, variant: i.variant || null, size: i.size || null, unit: i.unit || null })),
    item_count:     cart.reduce((s, i) => s + i.qty, 0),
    subtotal, tax, shipping, packaging, cod_fee: codFee, total: netTotal,
    status:         'new',
  };
}

/** Best-effort: record an order. Never throws — must not block the WhatsApp handoff.
 *  Returns the order's id (minted client-side, since RLS lets customers INSERT but
 *  not SELECT their row) so an online-payment flow can mark that exact order paid.
 *  Pass an `id` to reuse a caller-minted row id (so the order-notify safety net can
 *  dedupe against this insert), and `confirmToken` so the caller can build the
 *  buyer's /order/<token> tracking link. Returns null if nothing was saved. */
export async function saveOrder(customerDetails = {}, cart = [], config = {}, coupon = null, id, confirmToken) {
  // Skip demo stores (slug stripped) and empty carts.
  if (!config?.slug || !Array.isArray(cart) || cart.length === 0) return null;
  const rowId = id || ((typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : undefined);
  const row = buildOrderRow(customerDetails, cart, config, coupon, rowId, confirmToken);
  // supabase-js reports a refused insert in `error`; it does not throw. Unchecked,
  // a failed save looked like success and a customer paid for an order that was
  // never recorded (2026-09-09). One retry covers a dropped mobile connection.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { error } = await supabase.from('orders').insert(row);
      if (!error || error.code === '23505') return rowId || null;   // 23505: the first try did land
      console.error('saveOrder refused:', error.message);
    } catch (err) {
      console.error('saveOrder failed:', err?.message || err);
    }
  }
  return null;
}

/** Best-effort: record a service quote request as a lead — an order row with
 *  zero totals, so leads never count as revenue in Stats. Never throws — must
 *  not block the WhatsApp handoff. */
export async function saveLead(form = {}, config = {}) {
  if (!config?.slug || !form?.name || !Array.isArray(form.services) || form.services.length === 0) return;
  try {
    const items = form.services.map((name) => {
      const svc = (config.products || []).find((p) => p.name === name);
      return { name, price: svc?.price || 0, qty: 1, unit: svc?.unit || null };
    });
    await supabase.from('orders').insert({
      store_slug:     config.slug,
      customer_name:  String(form.name).trim().slice(0, 80),
      customer_phone: String(form.phone || '').replace(/\D/g, '').slice(-10),
      destination:    '',
      payment_method: '',
      notes:          [form.budget ? `Budget ₹${form.budget}` : '', String(form.notes || '').trim()]
                        .filter(Boolean).join(' · ').slice(0, 500),
      items,
      item_count:     items.length,
      subtotal: 0, tax: 0, shipping: 0, total: 0,
      status:         'new',
    });
  } catch {
    /* best-effort — a failed log must never break the customer's inquiry */
  }
}

/** Best-effort: record an abandoned checkout — the customer typed their full
 *  phone number but never sent the order. Shows up ONLY in the Abandoned tab
 *  (fetchOrders hides these rows everywhere else). Never throws. */
export async function saveAbandonedCheckout(customerDetails = {}, cart = [], config = {}) {
  if (!config?.slug || !Array.isArray(cart) || cart.length === 0) return;
  try {
    const { subtotal, tax, shipping, total } = calcCartTotals(cart, config.cart);
    await supabase.from('orders').insert({
      store_slug:     config.slug,
      customer_name:  customerDetails.partyName || '',
      customer_phone: String(customerDetails.mobile || '').replace(/\D/g, '').slice(-10),
      destination:    customerDetails.destination || '',
      payment_method: '',
      notes:          '🛒 abandoned checkout',
      items:          cart.map((i) => ({ productId: lineProductId(i), name: i.name, price: i.price, qty: i.qty, variant: i.variant || null, size: i.size || null, unit: i.unit || null })),
      item_count:     cart.reduce((s, i) => s + i.qty, 0),
      subtotal, tax, shipping, total,
      status:         'abandoned',
    });
  } catch {
    /* best-effort — must never disturb the customer's checkout */
  }
}

/** Best-effort: record the customer's WhatsApp marketing choice for this shop
 *  (record_whatsapp_consent), the moment they tick or untick the checkout box.
 *  `wording` is the exact sentence they saw. Never throws, never blocks the
 *  checkout — like saveAbandonedCheckout above. */
export async function recordWhatsappConsent(slug, phone, granted, wording) {
  try {
    await supabase.rpc('record_whatsapp_consent', {
      p_slug: slug, p_phone: phone, p_granted: Boolean(granted), p_wording: wording,
    });
  } catch {
    /* best-effort — a failed record must never disturb the order */
  }
}

/** Owner-only: list this store's orders (PIN-checked server-side).
 *  Abandoned-checkout rows are excluded by default so Orders, Stats and
 *  Customers never count them — only the Customers CSV export opts in. The
 *  Abandoned tab reads fetchAbandonedCarts instead.
 *
 *  EVERY real order, not just the newest 500. get_store_orders returns the
 *  newest DETAILED_ORDER_CAP real orders (plus the newest ABANDONED_ORDER_CAP
 *  abandoned checkouts); when that page is full, get_store_orders_before reads
 *  the older ones 500 at a time until the store's first order.
 *
 *  `reuse`: the array a previous fetchOrders for this store returned. The first
 *  page is re-read and the older orders are taken from `reuse` instead of being
 *  paged again — for silent polling, where re-reading years of orders every few
 *  seconds would be wasteful. Ignored when `reuse` was itself partial.
 *
 *  The result carries `partial: true` when older orders could not all be read
 *  (a page failed): the newest orders are still there, and screens say so —
 *  see isPartialList. */
export async function fetchOrders(slug, pin, { includeAbandoned = false, reuse = null } = {}) {
  try {
    const hashed = await hashPin(pin);
    const rows = await readAllOrders((fn, args) => supabase.rpc(fn, args), slug, hashed, { reuse });
    if (!rows) return [];
    const out = rows.filter((o) => includeAbandoned || o.status !== 'abandoned');
    if (rows.partial) out.partial = true;
    return out;
  } catch {
    return [];
  }
}

/** Owner-only: the UNCAPPED, PII-free scalar feed behind every canonical
 *  commerce metric (get_store_order_facts, added in commerce-metrics PR 1).
 *
 *  This is the accounting source. fetchOrders above now reads every real order
 *  (only abandoned checkouts stay capped, at the newest 300), but it pages and
 *  can come back partial. This feed has no LIMIT, is one request, and it
 *  deliberately carries no items, no name, no phone and no address, so the
 *  screens that need those still go through fetchOrders.
 *
 *  Rows come back exactly as buildCommerceMetrics expects them. Abandoned and
 *  cancelled rows are INCLUDED on purpose: classification is the model's job,
 *  not the query's, so nothing filters a row out before it has been counted.
 *
 *  RESULT CONTRACT - unlike the other fetchers here, this one does NOT collapse
 *  failure into an empty array. An empty array is a real accounting answer: it
 *  means this store has taken no orders. A failed request means we do not know,
 *  and the two must never render the same screen, or a network blip shows the
 *  merchant "Gross Sales 0" for a store that has been trading for a year.
 *
 *    { ok: true,  data: [...] }            the server answered
 *    { ok: false, data: [], reason }       it did not
 *
 *  `reason` is one of 'rpc' | 'malformed' | 'unavailable' - a coarse, safe label
 *  for the UI to branch on. Backend error text is never passed through.
 *
 *  BACKEND CONTRACT, stated plainly because it bounds what this can detect: a
 *  wrong PIN is NOT an error. get_store_order_facts returns an empty set when
 *  verify_store_pin fails, exactly as get_store_orders does, so that a caller
 *  cannot use it to probe which stores or PINs exist. A wrong PIN therefore
 *  arrives here as { ok: true, data: [] } and is indistinguishable from a store
 *  with no orders. That is deliberate at the database, and Manage has already
 *  verified the PIN before any of this renders. */
export async function fetchOrderFacts(slug, pin) {
  try {
    const hashed = await hashPin(pin);
    // Paged: the API returns at most 1,000 rows a request, so one call stopped
    // a store's totals at its newest 1,000 rows (Krupa's Stats: 429 of 964
    // orders, 2026-10-22). readAllRpcRows reads them all or fails.
    const facts = factsFromRpc(await readAllRpcRows((withCount) =>
      supabase.rpc('get_store_order_facts', { p_slug: slug, p_hashed_pin: hashed },
        withCount ? { count: 'exact' } : undefined)));
    return facts.ok ? { ...facts, data: newestFirst(facts.data) } : facts;
  } catch {
    // Network down, request aborted, hashing unavailable - all "we do not know".
    return factsFailed('unavailable');
  }
}

/** Owner-only: the store's abandoned carts (get_store_abandoned_carts) - ONE row
 *  per customer who reached checkout in the last 30 IST days and has not ordered
 *  since, with their latest cart and `attempts`. The single definition behind
 *  both Home's abandoned-carts row and the Abandoned tab, so the two always show
 *  the same number. Uncapped: the 30-day window bounds it.
 *
 *  `allTime`: the same rule with no 30-day window (get_store_abandoned_carts_since,
 *  supabase/abandoned-all-time-forward.sql) - every customer who ever reached
 *  checkout and has not ordered since, for the tab's "All time" and the CSV
 *  export. Those rows also carry the address typed at checkout; `attempts`
 *  counts all time.
 *
 *  Same envelope as fetchOrderFacts - { ok, data } or { ok: false, data: [],
 *  reason } - because "no abandoned carts" and "could not load them" must not
 *  look alike. A wrong PIN is an empty set, as everywhere else. */
export async function fetchAbandonedCarts(slug, pin, { allTime = false } = {}) {
  try {
    const hashed = await hashPin(pin);
    const [fn, args] = allTime
      ? ['get_store_abandoned_carts_since', { p_slug: slug, p_hashed_pin: hashed, p_since: null }]
      : ['get_store_abandoned_carts', { p_slug: slug, p_hashed_pin: hashed }];
    // Paged like fetchOrderFacts: past 1,000 customers one call would stop.
    const carts = factsFromRpc(await readAllRpcRows((withCount) =>
      supabase.rpc(fn, args, withCount ? { count: 'exact' } : undefined)));
    return carts.ok ? { ...carts, data: newestFirst(carts.data) } : carts;
  } catch {
    return factsFailed('unavailable');
  }
}

/** Owner-only: a tiny, PII-safe "any new orders since X?" probe (PIN-checked
 *  server-side). Returns { new_count, latest_name, latest_total, latest_at } —
 *  one integer + the newest order's name/amount for the alert toast. Polled from
 *  the Manage shell so a badge/toast/chime can fire the moment an order lands,
 *  without pulling the whole order list every few seconds. A wrong PIN yields
 *  new_count 0 (the server EXISTS check fails → no rows), so nothing leaks. */
export async function fetchNewOrderSignal(slug, pin, sinceIso) {
  try {
    const hashed = await hashPin(pin);
    const { data, error } = await supabase.rpc('new_orders_since', {
      p_slug: slug, p_hashed_pin: hashed, p_since: sinceIso,
    });
    if (error) return null;
    return Array.isArray(data) ? (data[0] || null) : (data || null);
  } catch {
    return null;
  }
}

/** Owner-only: change an order's status (PIN-checked server-side). */
export async function setOrderStatus(slug, pin, orderId, status) {
  try {
    const hashed = await hashPin(pin);
    await supabase.rpc('update_order_status', { p_slug: slug, p_hashed_pin: hashed, p_order_id: orderId, p_status: status });
  } catch {
    /* ignore */
  }
}

/** Owner-only: turn an unpaid online order into cash on delivery, after the
 *  buyer agreed (switch_order_to_cod, supabase/switch-to-cod-forward.sql). The
 *  database only changes an online order with no payment and not cancelled.
 *  Resolves true when it changed. */
export async function switchOrderToCod(slug, pin, orderId) {
  try {
    const hashed = await hashPin(pin);
    const { data, error } = await supabase.rpc('switch_order_to_cod', { p_slug: slug, p_hashed_pin: hashed, p_order_id: orderId });
    return !error && data === true;
  } catch {
    return false;
  }
}

/** Owner-only: mark an order paid / unpaid (PIN-checked server-side). */
export async function setOrderPaid(slug, pin, orderId, paid) {
  try {
    const hashed = await hashPin(pin);
    await supabase.rpc('set_order_paid', { p_slug: slug, p_hashed_pin: hashed, p_order_id: orderId, p_paid: paid });
  } catch {
    /* ignore */
  }
}

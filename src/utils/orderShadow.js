/**
 * orderShadow — observation only.
 *
 * After a checkout has ALREADY saved its order the normal way, this sends the
 * same cart to order-create so the server can price it from the store's own
 * configuration and record how that compares with what the browser computed.
 * Every mismatch it produces is either a drift bug in the new engine or a real
 * forged price on the live site, and neither can be found by reasoning.
 *
 * IT MUST NEVER AFFECT THE CHECKOUT IT IS OBSERVING.
 *
 *   * the caller does not await it
 *   * the promise it returns never rejects — every failure path is swallowed
 *   * the response is never read: not parsed, not inspected, not returned
 *   * it does nothing at all unless an order was actually saved
 *
 * It also sends no money. Prices, totals, fees and discounts are exactly what
 * the server is being asked to compute for itself; sending the browser's
 * figures would defeat the comparison and re-introduce the thing phase 2
 * exists to remove. Only identifiers, option names, quantities and the
 * customer's own details go out.
 */
// Explicit extension: this module is also imported directly by the test
// runner (plain Node ESM), which does not resolve extensionless paths.
import { lineProductId } from './reviewShape.js';

const SB_URL = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_URL) || '';
const SB_KEY = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_ANON_KEY) || '';

/** Long enough for a slow mobile network, short enough that nothing lingers. */
export const SHADOW_TIMEOUT_MS = 4000;

/** Where the observation goes. Built from the same environment the rest of the
 *  storefront uses; overridable only so the tests can exercise the real request
 *  path instead of the "not configured, do nothing" short-circuit. */
export const SHADOW_ENDPOINT = SB_URL ? `${SB_URL}/functions/v1/order-create` : '';

/**
 * Cart lines as the reviewed schema wants them: what was chosen, never what it
 * cost. The split between the price-driving variant and the extra option groups
 * is read from the store's config — the same source buildCartItem used when the
 * line was created — so the server resolves the identical option.
 */
export function shadowLinesFromCart(cart = [], config = {}) {
  const byId = new Map(
    (Array.isArray(config?.products) ? config.products : [])
      .filter((p) => p && p.id != null)
      .map((p) => [String(p.id), p]),
  );

  return (Array.isArray(cart) ? cart : []).map((item) => {
    const productId = lineProductId(item);
    const product = productId ? byId.get(String(productId)) : null;
    const picks = Array.isArray(item?.variantSelections)
      ? item.variantSelections.map((p) => p?.name).filter(Boolean)
      : [];
    // picks[0] is the price-driving option only when the product has one;
    // otherwise every pick belongs to an extras group, in config order.
    const hasPriceVariant = !!(product?.variants?.options?.length);
    return {
      productId: String(productId ?? ''),
      variant: hasPriceVariant ? (picks[0] ?? null) : null,
      extras: hasPriceVariant ? picks.slice(1) : picks,
      qty: Math.trunc(Number(item?.qty)) || 0,
    };
  });
}

function newIdempotencyKey() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch { /* fall through */ }
  return `shadow-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Fire the observation. Returns a promise that ALWAYS resolves — callers do not
 * await it, and nothing downstream may depend on it.
 *
 * `observedOrderId` must be the order this checkout just saved; the caller
 * passes the id it minted and wrote, never anything a user supplied.
 */
export function sendShadowOrder({
  slug, mode = 'order', cart = [], config = {}, customer = {},
  paymentMethod = '', couponCode = null, notes = '', observedOrderId = null,
  attribution = {}, timeoutMs = SHADOW_TIMEOUT_MS, endpoint = SHADOW_ENDPOINT,
} = {}) {
  try {
    // No endpoint, no order to compare against, or nothing to price: do nothing.
    if (!endpoint || !slug || !observedOrderId) return Promise.resolve();
    const lines = shadowLinesFromCart(cart, config);
    if (!lines.length) return Promise.resolve();

    const body = {
      slug,
      mode,
      idempotencyKey: newIdempotencyKey(),
      paymentMethod,
      couponCode: couponCode || null,
      notes: String(notes || ''),
      customer: {
        name:        String(customer.name || ''),
        phone:       String(customer.phone || ''),
        destination: String(customer.destination || ''),
        pincode:     String(customer.pincode || ''),
      },
      lines,
      observedOrderId,
      attribution: {
        fbp: attribution.fbp || null,
        fbc: attribution.fbc || null,
        ua:  attribution.ua  || null,
      },
    };

    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => { try { ctrl.abort(); } catch { /* ignore */ } }, timeoutMs) : null;

    return fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
      body: JSON.stringify(body),
      signal: ctrl ? ctrl.signal : undefined,
      // Survive the page navigating away — the observation is worth keeping,
      // and it is the only thing this request can affect.
      keepalive: true,
    })
      // The response is deliberately not read. Nothing here may influence the
      // order, the payment, or what the customer sees.
      .then(() => undefined, () => undefined)
      .finally(() => { if (timer) clearTimeout(timer); });
  } catch {
    // Building the request must not be able to break a checkout either.
    return Promise.resolve();
  }
}

// RTO protection: is this cash-on-delivery order likely to come back unsold?
// Read from the shop's own order history, before the order is shipped. PURE.
//
// Settings live in config.delivery.rto (Delivery → Settings → RTO protection).
// Every rule is on unless the shop turned it off.

export const RTO_DEFAULTS = Object.freeze({
  on: true, firstBig: true, address: true, refused: true, hold: false, discount: 20,
});

export function rtoSettings(config = {}) {
  return { ...RTO_DEFAULTS, ...(config?.delivery?.rto || {}) };
}

const digits10 = (p) => String(p || '').replace(/\D/g, '').slice(-10);
const isCod = (o) => String(o?.payment_method || '').toLowerCase() === 'cod';
const isReal = (o) => !['abandoned', 'cancelled'].includes(String(o?.status || '').toLowerCase());
const wasReturned = (o) => o?.shipment_outcome === 'returned' || /\b(rto|returned|refus)/i.test(String(o?.shipment_status || ''));

/** The street part of the composed address "<street>, <City> - <pincode>". */
function streetOf(destination) {
  const s = String(destination || '').replace(/\s*-\s*\d{6}\s*$/, '');
  const i = s.lastIndexOf(',');
  return i > 0 ? s.slice(0, i) : s;
}

/** Phone → { orders, returned } over the shop's real orders. */
export function customerHistory(orders = []) {
  const map = new Map();
  for (const o of orders) {
    if (!isReal(o)) continue;
    const k = digits10(o.customer_phone);
    if (!k) continue;
    const h = map.get(k) || { orders: [], returned: 0 };
    h.orders.push(o);
    if (wasReturned(o)) h.returned += 1;
    map.set(k, h);
  }
  return map;
}

/**
 * The risk for one order: { level: 'high' | 'low' | 'none', reasons[], earlier }.
 * Only unpaid COD orders not yet shipped are judged; anything else is 'none'.
 * 'low' = a known good customer (earlier orders, none returned).
 */
export function rtoRisk(o, history, settings = RTO_DEFAULTS) {
  const none = { level: 'none', reasons: [], earlier: 0 };
  if (!settings.on || !o || !isCod(o) || o.paid || o.awb || !isReal(o)) return none;
  const h = history?.get(digits10(o.customer_phone)) || { orders: [], returned: 0 };
  const created = Date.parse(o.created_at) || 0;
  const earlier = h.orders.filter((x) => x.id !== o.id && (Date.parse(x.created_at) || 0) < created);
  const returned = earlier.filter(wasReturned).length;
  const reasons = [];
  if (settings.refused && returned > 0) reasons.push(`Refused or returned ${returned === 1 ? 'an order' : `${returned} orders`} before`);
  if (settings.firstBig && earlier.length === 0 && Number(o.total) > 1000) reasons.push('First order from this number, cash on delivery above ₹1,000');
  if (settings.address && o.destination && !/\d/.test(streetOf(o.destination))) reasons.push('Address has no house or flat number');
  if (reasons.length) return { level: 'high', reasons, earlier: earlier.length };
  if (earlier.length > 0) return { level: 'low', reasons: [`Ordered ${earlier.length} time${earlier.length === 1 ? '' : 's'} before, none returned`], earlier: earlier.length };
  return none;
}

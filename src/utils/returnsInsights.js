/**
 * Manage → Payments → Lost to returns: what the parcels that came back cost the
 * shop, and where they came from.
 *
 * Built from the DETAILED rows (fetchOrders), because it needs the courier
 * charge, the buyer's confirmation and the address - none of which the facts
 * feed carries. The headline money (₹ written off, how many) stays on the
 * facts feed through buildMoneyHome; this only adds the "why".
 *
 * Pure: no React, no clock, no network.
 */

/**
 * The city part of an order's address, the same way order_city() reads it in
 * the database (supabase/order-tracking.sql): `destination` is the composed
 * address "<street>, <City> - <pincode>". Drop the trailing pincode, take the
 * last comma segment, and give up (null) when that does not look like a city.
 */
export function orderCity(destination) {
  const v = String(destination ?? '').trim();
  if (!v || /Pickup/.test(v)) return null;          // collected from the shop: no city
  const city = v.replace(/\s*[-,]\s*[0-9]{6}\s*$/, '').replace(/^.*,\s*/, '').trim();
  if (!city || /^[0-9]*$/.test(city) || city.length > 30 || city.split(/\s+/).length > 3) return null;
  return city.replace(/\b\w/g, (c) => c.toUpperCase());
}

const isCod = (o) => String(o?.payment_method ?? '').toLowerCase().trim() === 'cod';

/**
 * @param {Array<{order: object, amount: number}>} returns  buildMoneyLists().returns
 * @returns {{
 *   courierCharges: number,   rupees the shop paid couriers on these parcels
 *   chargedParcels: number,   how many of them had a recorded charge
 *   cod: number,              how many were cash on delivery
 *   unconfirmed: number,      COD parcels whose buyer never tapped "Confirm"
 *   cities: Array<{ city: string, count: number }>  most first, at most 3
 * }}
 */
export function returnsInsights(returns = []) {
  let courierPaise = 0;
  let chargedParcels = 0;
  let cod = 0;
  let unconfirmed = 0;
  const byCity = new Map();
  for (const r of Array.isArray(returns) ? returns : []) {
    const o = r?.order || {};
    const charge = Number(o.shipping_cost);
    if (Number.isFinite(charge) && charge > 0) {
      courierPaise += Math.round(charge * 100);
      chargedParcels += 1;
    }
    if (isCod(o)) {
      cod += 1;
      if (!o.customer_confirmed_at) unconfirmed += 1;
    }
    const city = orderCity(o.destination);
    if (city) byCity.set(city, (byCity.get(city) || 0) + 1);
  }
  const cities = [...byCity.entries()]
    .map(([city, count]) => ({ city, count }))
    .sort((a, b) => b.count - a.count || a.city.localeCompare(b.city))
    .slice(0, 3);
  return { courierCharges: courierPaise / 100, chargedParcels, cod, unconfirmed, cities };
}

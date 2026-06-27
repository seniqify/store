/**
 * Customer intelligence — derives a per-customer view from saved orders.
 *
 * Phase 1 of the re-engagement engine: we collect NO new data. Every order
 * already stores customer_name, customer_phone, items[], total, status and
 * created_at; grouping those by phone number turns the orders table into a
 * lightweight CRM (who your customers are, what they buy, when they last came).
 *
 * Pure + side-effect free so it's unit-testable and runs client-side from the
 * orders the owner already fetches (PIN-checked). No RPC, no migration.
 */

const DAY = 86400000;

// Customers that haven't ordered in this many days are "win-back" candidates.
export const LAPSED_DAYS = 30;
// Orders at/above this count earns the "loyal" badge.
export const LOYAL_ORDERS = 3;

// Segment metadata for the UI (label / emoji / one-line rule).
export const SEGMENTS = {
  loyal:      { label: 'Loyal',       emoji: '⭐', desc: `${LOYAL_ORDERS}+ orders` },
  winback:    { label: 'Win-back',    emoji: '🔴', desc: `No order in ${LAPSED_DAYS}+ days` },
  bigspender: { label: 'Big spender', emoji: '💰', desc: 'Top 20% by spend' },
  new:        { label: 'New',         emoji: '🆕', desc: 'Single order' },
};

function ts(iso) {
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/**
 * Group raw orders into customer profiles and tag each with segments.
 * @param {Array} orders  rows from get_store_orders
 * @param {number} now    injectable clock (for tests)
 * @returns {Array} customers sorted by most-recent order first
 */
export function buildCustomers(orders = [], now = Date.now()) {
  const byPhone = new Map();

  for (const o of orders) {
    const phone = String(o.customer_phone || '').replace(/\D/g, '').slice(-10);
    if (phone.length !== 10) continue;            // unusable number → can't be a contact
    const t = ts(o.created_at);
    const cancelled = o.status === 'cancelled';

    let c = byPhone.get(phone);
    if (!c) {
      c = { phone, name: '', _nameAt: -1, orders: [], orderCount: 0, totalSpent: 0,
            firstOrderAt: 0, lastOrderAt: 0, itemCounts: new Map() };
      byPhone.set(phone, c);
    }
    c.orders.push(o);

    // Display name = the name from their most recent order that has one.
    const nm = String(o.customer_name || '').trim();
    if (nm && t >= c._nameAt) { c.name = nm; c._nameAt = t; }

    // Cancelled orders stay in history but don't count toward value/recency.
    if (!cancelled) {
      c.orderCount += 1;
      c.totalSpent += Number(o.total) || 0;
      if (t && (!c.firstOrderAt || t < c.firstOrderAt)) c.firstOrderAt = t;
      if (t > c.lastOrderAt) c.lastOrderAt = t;
      for (const it of o.items || []) {
        const name = String(it.name || '').trim();
        if (name) c.itemCounts.set(name, (c.itemCounts.get(name) || 0) + (Number(it.qty) || 1));
      }
    }
  }

  const customers = [...byPhone.values()].map((c) => {
    const topItems = [...c.itemCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name, qty]) => ({ name, qty }));
    const daysSinceLast = c.lastOrderAt ? Math.floor((now - c.lastOrderAt) / DAY) : null;
    return {
      phone:         c.phone,
      name:          c.name,
      orderCount:    c.orderCount,
      totalSpent:    Math.round(c.totalSpent),
      avgOrderValue: c.orderCount ? Math.round(c.totalSpent / c.orderCount) : 0,
      firstOrderAt:  c.firstOrderAt,
      lastOrderAt:   c.lastOrderAt,
      daysSinceLast,
      topItems,
      history:       [...c.orders].sort((a, b) => ts(b.created_at) - ts(a.created_at)),
      segments:      [],
    };
  });

  assignSegments(customers);
  // Default order: most recently active first.
  customers.sort((a, b) => b.lastOrderAt - a.lastOrderAt);
  return customers;
}

// Tag each customer with the segments they belong to (a customer can be in
// several — e.g. a big spender who has also lapsed is both "bigspender" + "winback").
function assignSegments(customers) {
  // Big-spender cut-off = 80th percentile of positive spend across the base.
  // Needs a few customers to be meaningful, else everyone looks like a whale.
  const spends = customers.map((c) => c.totalSpent).filter((v) => v > 0).sort((a, b) => a - b);
  const p80 = spends.length ? spends[Math.min(spends.length - 1, Math.floor(spends.length * 0.8))] : Infinity;

  for (const c of customers) {
    const segs = [];
    if (c.orderCount >= LOYAL_ORDERS) segs.push('loyal');
    if (c.orderCount === 1) segs.push('new');
    if (c.daysSinceLast != null && c.daysSinceLast >= LAPSED_DAYS && c.orderCount >= 1) segs.push('winback');
    if (spends.length >= 3 && c.totalSpent > 0 && c.totalSpent >= p80) segs.push('bigspender');
    c.segments = segs;
  }
}

/** Headline numbers for the stat cards. */
export function summarizeCustomers(customers = []) {
  const total   = customers.length;
  const repeat  = customers.filter((c) => c.orderCount >= 2).length;
  const winback = customers.filter((c) => c.segments.includes('winback')).length;
  const revenue = customers.reduce((s, c) => s + c.totalSpent, 0);
  return {
    total,
    repeat,
    repeatRate: total ? Math.round((repeat / total) * 100) : 0,
    winback,
    revenue,
    avgClv: total ? Math.round(revenue / total) : 0,
  };
}

/** Count of customers per segment (for the filter chips). */
export function segmentCounts(customers = []) {
  const counts = {};
  for (const key of Object.keys(SEGMENTS)) counts[key] = 0;
  for (const c of customers) for (const s of c.segments) counts[s] = (counts[s] || 0) + 1;
  return counts;
}

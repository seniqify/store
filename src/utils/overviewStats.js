/**
 * Manage → Home dashboard stats.
 * ────────────────────────────────────────────────────────────────────────────
 * Pure, side-effect-free reduction of the store's own orders + reviews + product
 * config into the numbers the owner's Home screen shows: today's pulse, a
 * prioritised "needs attention" set, and a 7-day sales sparkline. No new data —
 * everything here is already fetched by the existing tabs (orders PIN-checked,
 * reviews public, products from config). Kept pure so it's unit-testable.
 */

const DAY = 86400000;

function ts(iso) { const t = new Date(iso).getTime(); return Number.isNaN(t) ? 0 : t; }
function num(v)  { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); }

export function buildOverview(orders = [], config = {}, reviews = [], now = Date.now()) {
  const real      = orders.filter((o) => o.status !== 'abandoned' && o.status !== 'cancelled');
  const abandoned = orders.filter((o) => o.status === 'abandoned');
  const todayStart = startOfDay(now);

  // ── Today vs yesterday ──
  const todayOrders = real.filter((o) => ts(o.created_at) >= todayStart);
  const todaySales  = todayOrders.reduce((s, o) => s + num(o.total), 0);

  const yStart  = todayStart - DAY;
  const ySales  = real
    .filter((o) => ts(o.created_at) >= yStart && ts(o.created_at) < todayStart)
    .reduce((s, o) => s + num(o.total), 0);
  const todayDeltaPct = ySales > 0 ? Math.round(((todaySales - ySales) / ySales) * 100) : null;

  // ── Attention signals ──
  const newOrders = real.filter((o) => o.status === 'new');

  // "To collect" = orders with money owed still not marked paid (COD, mostly).
  const unpaid    = real.filter((o) => !o.paid && num(o.total) > 0);
  const toCollect = unpaid.reduce((s, o) => s + num(o.total), 0);

  const recentAbandoned = abandoned.filter((o) => ts(o.created_at) >= now - 30 * DAY);
  const abandonedValue  = recentAbandoned.reduce((s, o) => s + num(o.total), 0);

  const products = Array.isArray(config.products) ? config.products : [];
  const outOfStock = products.filter((p) => {
    const n = Number(p.stock);
    const tracks = p.stock != null && p.stock !== '' && Number.isFinite(n);
    return p.inStock === false || (tracks && n <= 0);
  });

  const recentReviews = (reviews || []).filter((r) => ts(r.created_at) >= now - 7 * DAY);

  // ── 7-day sales sparkline (oldest → today) ──
  const week = [];
  for (let i = 6; i >= 0; i--) {
    const dayStart = todayStart - i * DAY;
    const dayEnd   = dayStart + DAY;
    const sales = real
      .filter((o) => ts(o.created_at) >= dayStart && ts(o.created_at) < dayEnd)
      .reduce((s, o) => s + num(o.total), 0);
    week.push({ dayStart, sales });
  }
  const weekTotal = week.reduce((s, d) => s + d.sales, 0);

  return {
    todaySales,
    todayCount:      todayOrders.length,
    todayDeltaPct,
    newCount:        newOrders.length,
    toCollect,
    unpaidCount:     unpaid.length,
    abandonedCount:  recentAbandoned.length,
    abandonedValue,
    outOfStockNames: outOfStock.map((p) => p.name).filter(Boolean),
    outOfStockCount: outOfStock.length,
    newReviewCount:  recentReviews.length,
    latestReview:    recentReviews[0] || null,
    week,
    weekTotal,
    totalOrders:     real.length,
  };
}

/**
 * Manage → Home: the parts of the dashboard that are NOT accounting.
 * ────────────────────────────────────────────────────────────────────────────
 * Out-of-stock comes from the store's own product config, and new reviews come
 * from the reviews table. Neither is derived from orders, so neither belongs to
 * the canonical commerce model and neither is affected if the order feed fails —
 * which is exactly why they live apart: Home can still show them when the
 * accounting section cannot render.
 *
 * Every order-derived figure this file used to compute — today's sales, the
 * to-collect total, the new-order count, abandoned carts and the week chart —
 * now comes from src/utils/overviewMetrics.js over commerceMetrics. Do not add
 * order accounting back here: a second implementation is how two screens start
 * disagreeing about what a sale is.
 */

const DAY = 86400000;

function ts(iso) { const t = new Date(iso).getTime(); return Number.isNaN(t) ? 0 : t; }

/**
 * @param {object} config          the store config (products live here)
 * @param {Array}  reviews         rows from fetchReviews
 * @param {number} now             epoch ms
 * @param {number} [reviewDays]    how recent a review counts as "new"
 */
export function buildOverviewExtras(config = {}, reviews = [], now = Date.now(), reviewDays = 7) {
  const products = Array.isArray(config.products) ? config.products : [];
  const outOfStock = products.filter((p) => {
    const n = Number(p.stock);
    const tracks = p.stock != null && p.stock !== '' && Number.isFinite(n);
    return p.inStock === false || (tracks && n <= 0);
  });

  const recentReviews = (reviews || []).filter((r) => ts(r.created_at) >= now - reviewDays * DAY);

  return {
    outOfStockNames: outOfStock.map((p) => p.name).filter(Boolean),
    outOfStockCount: outOfStock.length,
    newReviewCount:  recentReviews.length,
    latestReview:    recentReviews[0] || null,
  };
}

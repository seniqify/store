/**
 * What the order tracking page shows BELOW the tracking (founder-approved
 * mockup, 2026-10-05): the shop's offer, more of its products, and a real
 * "Order again". The WhatsApp utility messages stay pure order updates; the
 * selling happens on our own page, where their buttons land.
 *
 * Pure (storage and clock are handed in); tested in tests/tracking-extras.test.mjs.
 */
import { isOfferLive, isCouponLive, describeDiscount, offerEndsAt, applyOffersToProducts } from './offers.js';
import { hasAnyOptions, resolveSelection, variantExtrasOf } from './variants.js';

const day = (iso) => {
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? '' : t.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

/**
 * The one offer to show, or null:
 *   1. a scheduled sale running now (already public on the shop page) -- the
 *      one ending soonest, as the shop page's sale banner picks it;
 *   2. otherwise a coupon the shop chose to show on order pages
 *      (`showOnOrderPage`). Coupons are NOT shown by default: a shop may keep
 *      a code private (staff, one customer), and this page reaches every buyer.
 */
export function pickShopOffer(config, now = new Date()) {
  const live = (Array.isArray(config?.offers) ? config.offers : []).filter((o) => o && isOfferLive(o, now));
  if (live.length) {
    const ending = live.map((o) => ({ o, end: offerEndsAt(o, now) })).filter((x) => x.end).sort((a, b) => a.end - b.end)[0];
    const o = ending ? ending.o : live[0];
    return {
      kind: 'sale',
      label: 'Sale on now',
      title: [o.name, describeDiscount(o)].filter(Boolean).join(' · '),
      code: null,
      note: ending ? `Ends ${day(ending.end)}` : '',
    };
  }
  const c = (Array.isArray(config?.coupons) ? config.coupons : [])
    .find((x) => x && x.showOnOrderPage === true && String(x.code || '').trim() && isCouponLive(x, now));
  if (c) {
    return {
      kind: 'coupon',
      label: 'For your next order',
      title: c.discountType === 'flat' ? `₹${c.discountValue} off` : `${c.discountValue}% off`,
      code: String(c.code).trim(),
      note: [c.expiresAt ? `Valid till ${day(c.expiresAt)}` : '', c.minOrder ? `on orders above ₹${c.minOrder}` : '']
        .filter(Boolean).join(' · '),
    };
  }
  return null;
}

function stockOf(p) {
  const n = Number(p?.stock);
  return p?.stock != null && p.stock !== '' && Number.isFinite(n) ? n : null;
}

/**
 * Up to `max` products to suggest: in stock, priced, not already in this order,
 * best sellers first (sales: anything with `.get(name)` -> { sold }), today's
 * sale prices applied. Each comes with what its card shows and how "+ Add" works:
 * a product with choices (size, colour...) opens its page; one without goes
 * straight into the cart.
 */
export function suggestProducts(config, orderItems, sales, { max = 4, now = new Date() } = {}) {
  const items = Array.isArray(orderItems) ? orderItems : [];
  const ids = new Set(items.map((i) => String(i?.productId ?? '')).filter(Boolean));
  const names = new Set(items.map((i) => String(i?.name ?? '').trim().toLowerCase()).filter(Boolean));
  const products = applyOffersToProducts((Array.isArray(config?.products) ? config.products : []).filter(Boolean),
    Array.isArray(config?.offers) ? config.offers : [], now);
  const soldOf = (p) => Number(sales?.get?.(p.name)?.sold) || 0;
  return products
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => {
      if (p.id == null || ids.has(String(p.id)) || names.has(String(p.name || '').trim().toLowerCase())) return false;
      const stock = stockOf(p);
      return p.inStock !== false && !(stock !== null && stock <= 0);
    })
    .map(({ p, i }) => {
      const first = p.variants?.options?.length ? p.variants.options[0].name : null;
      const picks = variantExtrasOf(p).map((g) => g.options.find((o) => o && o.name)?.name);
      const shown = resolveSelection(p, first, picks);
      return { p, i, price: Number(shown.price), mrp: Number(shown.mrp) || null, image: shown.image || '' };
    })
    .filter((x) => Number.isFinite(x.price) && x.price > 0)
    .sort((a, b) => soldOf(b.p) - soldOf(a.p) || a.i - b.i)
    .slice(0, max)
    .map(({ p, price, mrp, image }) => ({
      id: p.id, name: p.name, price, mrp: mrp && mrp > price ? mrp : null, image,
      sold: soldOf(p), hasOptions: hasAnyOptions(p),
    }));
}

/**
 * The lines "Order again" puts back in the cart: { productId, qty, variant },
 * the shape cartRestore expects. The shop page rebuilds each from TODAY's
 * catalogue and leaves out what is gone. Orders saved before items carried a
 * productId (before mid-September 2026) are matched to `products` by exact
 * name; a line that matches nothing is skipped, never guessed.
 */
export function reorderLines(orderItems, products = []) {
  const byName = new Map();
  for (const p of Array.isArray(products) ? products : []) {
    const k = String(p?.name ?? '').trim().toLowerCase();
    if (k && p.id != null && !byName.has(k)) byName.set(k, p.id);
  }
  return (Array.isArray(orderItems) ? orderItems : [])
    .map((it) => {
      if (!it) return null;
      const id = it.productId != null && String(it.productId) !== ''
        ? it.productId
        : byName.get(String(it.name ?? '').trim().toLowerCase());
      if (id == null) return null;
      return {
        productId: id,
        qty: Math.max(1, Math.trunc(Number(it.qty)) || 1),
        ...(it.variant ? { variant: String(it.variant) } : {}),
      };
    })
    .filter(Boolean);
}

// Shared offers logic — used by the Manage "Offers" tab today and by the
// storefront (strikethrough prices, countdown, coupon at checkout) next.
//
// An offer (scheduled sale) shape:
//   { id, name, active, discountType:'percent'|'flat', discountValue,
//     appliesTo:'all'|'category', categoryId,
//     schedule:{ type:'always'|'range'|'weekend'|'happyHours', start, end, from, to } }
//
// A coupon shape:
//   { id, code, discountType, discountValue, minOrder, expiresAt, active }

function startOfDay(s) { const d = new Date(s); d.setHours(0, 0, 0, 0); return d; }
function endOfDay(s)   { const d = new Date(s); d.setHours(23, 59, 59, 999); return d; }

// Is this scheduled sale running right now?
export function isOfferLive(offer, now = new Date()) {
  if (!offer || offer.active === false) return false;
  const sc = offer.schedule || {};
  switch (sc.type) {
    case 'range': {
      if (sc.start && now < startOfDay(sc.start)) return false;
      if (sc.end   && now > endOfDay(sc.end))     return false;
      return Boolean(sc.start || sc.end);
    }
    case 'weekend': {
      const d = now.getDay();          // 0 = Sun, 6 = Sat
      return d === 0 || d === 6;
    }
    case 'happyHours': {
      if (!sc.from || !sc.to) return false;
      const cur = now.getHours() * 60 + now.getMinutes();
      const [fh, fm] = sc.from.split(':').map(Number);
      const [th, tm] = sc.to.split(':').map(Number);
      const from = fh * 60 + fm, to = th * 60 + tm;
      // Handle windows that wrap past midnight (e.g. 22:00–02:00).
      return from <= to ? (cur >= from && cur <= to) : (cur >= from || cur <= to);
    }
    case 'always':
    default:
      return true;
  }
}

// Does a sale apply to a given product?
export function offerCoversProduct(offer, product) {
  if (offer.appliesTo === 'category') return product?.category === offer.categoryId;
  return true; // 'all'
}

// New, discounted price for a base price under one offer (rounded to rupee).
export function applyDiscount(price, offer) {
  if (price == null || !offer) return price;
  const v = Number(offer.discountValue) || 0;
  if (offer.discountType === 'flat') return Math.max(0, price - v);
  return Math.max(0, Math.round(price * (1 - v / 100)));
}

// The single best live sale price for a product (lowest wins), or null if none.
export function bestOfferForProduct(product, offers = [], now = new Date()) {
  let best = null;
  for (const o of offers) {
    if (!isOfferLive(o, now) || !offerCoversProduct(o, product)) continue;
    const np = applyDiscount(product.price, o);
    if (np != null && np < product.price && (best == null || np < best.price)) {
      best = { price: np, offer: o };
    }
  }
  return best;
}

// ── Display helpers (kept here so Manage + storefront read identically) ──────
export function describeDiscount(o) {
  if (!o) return '';
  return o.discountType === 'flat' ? `₹${o.discountValue} off` : `${o.discountValue}% off`;
}

function fmtD(s) {
  try { return new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); }
  catch { return s; }
}

export function describeSchedule(o) {
  const sc = o?.schedule || {};
  switch (sc.type) {
    case 'range':      return sc.start && sc.end ? `${fmtD(sc.start)} – ${fmtD(sc.end)}` : 'Date range';
    case 'weekend':    return 'Every weekend';
    case 'happyHours': return sc.from && sc.to ? `Daily ${sc.from}–${sc.to}` : 'Daily happy hours';
    case 'always':
    default:           return 'Always on';
  }
}

export function describeCoupon(c) {
  const off = c.discountType === 'flat' ? `₹${c.discountValue} off` : `${c.discountValue}% off`;
  const min = c.minOrder ? ` · min ₹${c.minOrder}` : '';
  const exp = c.expiresAt ? ` · till ${fmtD(c.expiresAt)}` : '';
  return `${off}${min}${exp}`;
}

// Is a coupon currently usable (active + not past its expiry day)?
export function isCouponLive(c, now = new Date()) {
  if (!c || c.active === false) return false;
  if (c.expiresAt && now > endOfDay(c.expiresAt)) return false;
  return true;
}

// The rupee discount a coupon gives on a subtotal (0 if not usable / under min).
export function couponDiscountFor(coupon, subtotal, now = new Date()) {
  if (!coupon || !isCouponLive(coupon, now)) return 0;
  if (coupon.minOrder && subtotal < Number(coupon.minOrder)) return 0;
  const v = Number(coupon.discountValue) || 0;
  const d = coupon.discountType === 'flat' ? v : Math.round((subtotal * v) / 100);
  return Math.max(0, Math.min(d, subtotal));
}

// Return a copy of products with live sale prices baked in: the discounted price
// becomes `price`, the pre-sale price becomes `mrp` (so the existing card/cart
// strikethrough + "you save" machinery shows the sale), plus `_onSale`/`_saleName`.
// Variant option prices get the same treatment. Untouched if no live offer covers it.
export function applyOffersToProducts(products = [], offers = [], now = new Date()) {
  const live = offers.filter((o) => isOfferLive(o, now));
  if (!live.length) return products;

  return products.map((p) => {
    let best = null;
    for (const o of live) {
      if (!offerCoversProduct(o, p)) continue;
      if (best == null || applyDiscount(p.price, o) < applyDiscount(p.price, best)) best = o;
    }
    if (!best) return p;

    const np = { ...p, _onSale: true, _saleName: best.name };
    if (p.price != null) {
      const sp = applyDiscount(p.price, best);
      if (sp < p.price) { np.price = sp; np.mrp = p.price; }
    }
    if (p.variants?.options?.length) {
      np.variants = {
        ...p.variants,
        options: p.variants.options.map((opt) => {
          if (opt.price == null) return opt;
          const osp = applyDiscount(opt.price, best);
          return osp < opt.price ? { ...opt, price: osp, mrp: opt.price } : opt;
        }),
      };
    }
    return np;
  });
}

// When does a live sale end? Used for the storefront countdown. null = no countdown
// (e.g. an "always on" sale). Handles date ranges, weekends and daily happy-hours.
export function offerEndsAt(offer, now = new Date()) {
  const sc = offer?.schedule || {};
  if (sc.type === 'range' && sc.end) return endOfDay(sc.end);
  if (sc.type === 'happyHours' && sc.to) {
    const [th, tm] = sc.to.split(':').map(Number);
    const d = new Date(now); d.setHours(th, tm, 0, 0);
    if (d <= now) d.setDate(d.getDate() + 1);
    return d;
  }
  if (sc.type === 'weekend') {
    const d = new Date(now);
    d.setDate(d.getDate() + ((7 - d.getDay()) % 7));   // this/next Sunday
    d.setHours(23, 59, 59, 999);
    return d;
  }
  return null;
}

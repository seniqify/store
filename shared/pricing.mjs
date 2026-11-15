/**
 * shared/pricing.mjs — the one pricing engine.
 *
 * Imported by BOTH the storefront bundle (Vite) and the server (Deno edge
 * function), so what the customer is shown and what the server charges cannot
 * drift apart. Pure ESM: no imports, no DOM, no Deno, no Node — only Web Crypto,
 * which all three runtimes provide.
 *
 * ─── THE RULE THIS FILE EXISTS TO ENFORCE ────────────────────────────────────
 *
 * The functions here are safe to run on the server ONLY when their inputs come
 * from stores.config. `priceOrder` below takes the store's config and a request
 * carrying nothing but identifiers, option NAMES and quantities; it looks
 * everything else up itself. It must never be handed a product object, a price,
 * a fee, a GST value, a coupon definition or a total that arrived from a
 * browser. `calcCartTotals` is the arithmetic underneath and is deliberately
 * dumb — it trusts what it is given, which is why the server must only ever give
 * it lines that `priceOrder` built.
 */

export const ENGINE_VERSION = 'pricing-1';

// ── arithmetic ───────────────────────────────────────────────────────────────

/**
 * Cart totals. Moved verbatim from src/utils/currency.js so the browser and the
 * server run the same code; behaviour is unchanged.
 *
 * Per item: GST rate and whether it's inclusive/exclusive. Each can be set on
 * the product to override the store-wide defaults (mixed-rate / mixed-mode
 * stores); otherwise the store settings apply.
 */
export function calcCartTotals(items, cartConfig = {}, paymentMethod) {
  const {
    taxRate = 0, freeShippingAbove, shippingCharge, taxInclusive: storeInclusive = false,
    packagingCharge, codCharge,
  } = cartConfig || {};

  const rateFor      = (item) => (item.gstRate != null ? item.gstRate : taxRate);
  const inclusiveFor = (item) => (item.taxInclusive != null ? item.taxInclusive : storeInclusive);

  const subtotal = items.reduce((sum, item) => sum + item.price * item.qty, 0);

  // How much the customer saves vs. MRP (0 for items without mrp)
  const savings = items.reduce((sum, item) => {
    if (!item.mrp || item.mrp <= item.price) return sum;
    return sum + (item.mrp - item.price) * item.qty;
  }, 0);

  // "Free delivery above ₹X" only applies when X is a real positive threshold.
  // A 0 / blank value means "no free-delivery offer" → always charge the fee.
  const freeAbove = Number(freeShippingAbove);
  const hasFreeThreshold = Number.isFinite(freeAbove) && freeAbove > 0;
  const shipRaw = Number(shippingCharge);
  const shipFee = Number.isFinite(shipRaw) && shipRaw > 0 ? shipRaw : 0;
  const shipping =
    items.length === 0                          ? 0
    : hasFreeThreshold && subtotal >= freeAbove ? 0
    : shipFee;

  // Extra charges — flat amounts the owner sets. Same 0/blank = "none" guard.
  const packRaw = Number(packagingCharge);
  const packaging = items.length > 0 && Number.isFinite(packRaw) && packRaw > 0 ? packRaw : 0;
  const codRaw = Number(codCharge);
  const codFee = items.length > 0 && paymentMethod === 'cod' && Number.isFinite(codRaw) && codRaw > 0 ? codRaw : 0;

  // GST summed per line so a cart can mix rates and even mix modes.
  let taxRaw = 0;
  let addedTax = 0;
  for (const item of items) {
    const r = rateFor(item);
    if (r <= 0) continue;
    const line = item.price * item.qty;
    if (inclusiveFor(item)) {
      taxRaw += line - line / (1 + r);          // back-calculated, not added
    } else {
      const t = line * r;
      taxRaw   += t;
      addedTax += t;                            // added on top of the subtotal
    }
  }
  const tax = Math.round(taxRaw);

  const taxed = items.filter((i) => rateFor(i) > 0);
  const rates = new Set(taxed.map(rateFor));
  const taxUniformPct = rates.size === 1 ? Math.round([...rates][0] * 100) : null;
  const taxInclusive  = taxed.length > 0 && taxed.every(inclusiveFor);

  return {
    subtotal, savings, tax, shipping, packaging, codFee, taxInclusive, taxUniformPct,
    total: subtotal + Math.round(addedTax) + shipping + packaging + codFee,
  };
}

/** The discount a coupon gives on a subtotal. Arithmetic only — whether the
 *  coupon is usable at all is decided by the caller (see couponOutcome). */
export function couponDiscountValue(coupon, subtotal) {
  const v = Number(coupon?.discountValue) || 0;
  const d = coupon?.discountType === 'flat' ? v : Math.round((subtotal * v) / 100);
  return Math.max(0, Math.min(d, subtotal));
}

// ── catalog resolution ───────────────────────────────────────────────────────

/** Extra choice groups on a product, filtered to the well-formed ones. */
export function variantExtrasOf(product) {
  const groups = product?.variantExtras;
  if (!Array.isArray(groups)) return [];
  return groups.filter(
    (g) => g && g.label && Array.isArray(g.options) && g.options.some((o) => o && o.name),
  );
}

/**
 * Display resolution — the storefront's rule, where an unknown variant name
 * falls back to the first option so a card always renders a price.
 * NOT for server use: see resolveLineStrict.
 */
export function resolveSelection(product, selVariantName, selExtraNames = []) {
  const variants = product?.variants;
  const hasPriceVariant = !!(variants && variants.options && variants.options.length);
  const vOpt = hasPriceVariant
    ? variants.options.find((o) => o.name === selVariantName) || variants.options[0]
    : null;

  let price = vOpt && vOpt.price != null ? vOpt.price : product.price;
  let mrp   = vOpt ? (vOpt.mrp != null ? vOpt.mrp : null) : (product.mrp ?? null);
  let image = vOpt && vOpt.image ? vOpt.image : product.image;

  const picks = [];
  if (vOpt) picks.push({ label: variants.label || 'Options', name: vOpt.name });

  variantExtrasOf(product).forEach((g, i) => {
    const opts = g.options.filter((o) => o && o.name);
    const opt = opts.find((o) => o.name === selExtraNames[i]) || opts[0];
    if (!opt) return;
    picks.push({ label: g.label, name: opt.name });
    const add = Number(opt.addPrice) || 0;
    if (add) {
      price += add;
      if (mrp != null) mrp += add;
    }
  });

  return { price, mrp, image, picks };
}

/**
 * Server resolution. Same maths as resolveSelection, but a NAMED option that
 * does not exist is an error rather than a silent fall back to the first one:
 * charging for a variant the customer did not choose is worse than refusing.
 * A group the request says nothing about still takes that group's first option,
 * which is what the UI shows by default.
 *
 * → { ok: true, line } | { ok: false, reason, productId }
 */
export function resolveLineStrict(product, sel = {}) {
  const productId = String(product?.id ?? '');
  const variants = product?.variants;
  const hasPriceVariant = !!(variants && variants.options && variants.options.length);

  let vOpt = null;
  if (hasPriceVariant) {
    const wanted = sel.variant == null ? null : String(sel.variant);
    vOpt = wanted == null
      ? variants.options[0]
      : variants.options.find((o) => o && o.name === wanted);
    if (!vOpt) return { ok: false, reason: 'variant_unavailable', productId };
  }

  let price = vOpt && vOpt.price != null ? vOpt.price : product.price;
  let mrp   = vOpt ? (vOpt.mrp != null ? vOpt.mrp : null) : (product.mrp ?? null);

  const picks = [];
  if (vOpt) picks.push({ label: variants.label || 'Options', name: vOpt.name });

  const groups = variantExtrasOf(product);
  const asked = Array.isArray(sel.extras) ? sel.extras : [];
  for (let i = 0; i < groups.length; i++) {
    const opts = groups[i].options.filter((o) => o && o.name);
    if (!opts.length) continue;
    const wanted = asked[i] == null ? null : String(asked[i]);
    const opt = wanted == null ? opts[0] : opts.find((o) => o.name === wanted);
    if (!opt) return { ok: false, reason: 'variant_unavailable', productId };
    picks.push({ label: groups[i].label, name: opt.name });
    const add = Number(opt.addPrice) || 0;
    if (add) {
      price += add;
      if (mrp != null) mrp += add;
    }
  }

  const qty = Number(sel.qty);
  if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY_PER_LINE) {
    return { ok: false, reason: 'invalid_quantity', productId };
  }

  return {
    ok: true,
    line: {
      productId,
      name: String(product.name ?? ''),
      price,
      ...(mrp != null ? { mrp } : {}),
      qty,
      ...(product.gstRate != null ? { gstRate: product.gstRate } : {}),
      ...(product.taxInclusive != null ? { taxInclusive: product.taxInclusive } : {}),
      ...(picks.length ? { variant: picks.map((p) => p.name).join(', '), variantSelections: picks } : {}),
    },
  };
}

export const MAX_QTY_PER_LINE = 99;
export const MAX_LINES = 50;

// ── coupons ──────────────────────────────────────────────────────────────────

/**
 * The storefront's historical expiry rule: end of the expiry day in the
 * BROWSER's timezone. Kept unchanged so the shipped UI behaves exactly as it
 * does today. The server must not use it — see couponOutcome.
 */
export function isCouponLiveLocal(c, now = new Date()) {
  if (!c || c.active === false) return false;
  if (c.expiresAt) {
    const d = new Date(c.expiresAt);
    d.setHours(23, 59, 59, 999);
    if (now > d) return false;
  }
  return true;
}

/** End of the given calendar day in a fixed offset (default +05:30, IST), as an
 *  absolute instant. The server pins the zone so a coupon's life does not depend
 *  on the buyer's device clock or the server's own locale. */
export function endOfDayInZone(dateStr, offsetMinutes = 330) {
  const m = String(dateStr ?? '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const [, y, mo, d] = m;
  // 23:59:59.999 local-to-the-zone, expressed as UTC.
  const utcMs = Date.UTC(Number(y), Number(mo) - 1, Number(d), 23, 59, 59, 999);
  return new Date(utcMs - offsetMinutes * 60000);
}

/**
 * Server-side coupon decision, from the store's own coupon list.
 * → { applied, discount, code, reason }
 * reason: 'ok' | 'none' | 'not_found' | 'inactive' | 'expired' | 'below_min_order'
 */
export function couponOutcome(coupons, code, subtotal, now = new Date(), offsetMinutes = 330) {
  const wanted = String(code ?? '').trim().toUpperCase();
  if (!wanted) return { applied: false, discount: 0, code: null, reason: 'none' };

  const list = Array.isArray(coupons) ? coupons : [];
  const c = list.find((x) => String(x?.code ?? '').trim().toUpperCase() === wanted);
  if (!c) return { applied: false, discount: 0, code: wanted, reason: 'not_found' };
  if (c.active === false) return { applied: false, discount: 0, code: wanted, reason: 'inactive' };

  if (c.expiresAt) {
    const end = endOfDayInZone(c.expiresAt, offsetMinutes);
    if (end && now > end) return { applied: false, discount: 0, code: wanted, reason: 'expired' };
  }
  if (c.minOrder && subtotal < Number(c.minOrder)) {
    return { applied: false, discount: 0, code: wanted, reason: 'below_min_order' };
  }

  return { applied: true, discount: couponDiscountValue(c, subtotal), code: wanted, reason: 'ok' };
}

// ── the authoritative quote ──────────────────────────────────────────────────

/**
 * Price an order from the store's config and a request that carries only
 * identifiers, option names and quantities.
 *
 * `config` MUST be the store's own configuration as loaded from the database.
 * `request` is the untrusted side: only request.lines[].productId / .variant /
 * .extras / .qty, request.paymentMethod and request.couponCode are read, and
 * each is used to LOOK SOMETHING UP, never as a value.
 *
 * → { ok: true, lines, totals, coupon } | { ok: false, reason, productId? }
 */
export function priceOrder(config, request, now = new Date(), offsetMinutes = 330) {
  const lines = Array.isArray(request?.lines) ? request.lines : [];
  if (!lines.length) return { ok: false, reason: 'no_items' };
  if (lines.length > MAX_LINES) return { ok: false, reason: 'too_many_lines' };

  const catalog = new Map();
  for (const p of Array.isArray(config?.products) ? config.products : []) {
    if (p && p.id != null) catalog.set(String(p.id), p);
  }

  const resolved = [];
  for (const sel of lines) {
    const product = catalog.get(String(sel?.productId ?? ''));
    if (!product) return { ok: false, reason: 'product_unavailable', productId: String(sel?.productId ?? '') };
    if (product.inStock === false) {
      return { ok: false, reason: 'product_unavailable', productId: String(product.id) };
    }
    const r = resolveLineStrict(product, sel);
    if (!r.ok) return r;
    resolved.push(r.line);
  }

  const method = String(request?.paymentMethod ?? '').toLowerCase();
  const totals = calcCartTotals(resolved, config?.cart || {}, method);
  const coupon = couponOutcome(config?.coupons, request?.couponCode, totals.subtotal, now, offsetMinutes);
  const total = Math.max(0, totals.total - coupon.discount);

  return {
    ok: true,
    lines: resolved,
    coupon,
    totals: {
      subtotal: totals.subtotal,
      tax: totals.tax,
      shipping: totals.shipping,
      packaging: totals.packaging,
      codFee: totals.codFee,
      discount: coupon.discount,
      total,
    },
  };
}

// ── Buy X Get Y free (founder, 2026-11-15) ───────────────────────────────────

/**
 * Apply "Buy X Get Y free" sales to a cart. The caller passes only the sales
 * that are running now (the schedule rule lives with the other sale rules).
 *
 * A sale: { id, name, discountType: 'bxgy', buy, get,
 *           freeMode: 'same' | 'other',
 *           appliesTo: 'products' | 'category', productIds: [...], categoryId,   (same)
 *           triggerId, giftId }                                                  (other)
 *
 *   same, products  each covered line: every (buy + get) units, `get` are free
 *   same, category  units pooled across the category; the cheapest are free
 *   other           every `buy` of the trigger product adds `get` of the gift
 *                   product at ₹0 (capped at its stock, skipped if sold out)
 *
 * A line is used by one sale at most (the first that covers it). Free units
 * become their OWN line priced 0 with mrp = the price they would have cost, so
 * calcCartTotals, "you save", GST, stock and per-product revenue all stay right
 * without knowing about this rule.
 *
 * → { lines, freeByLine: { [lineId]: freeQty }, gifts, saving, nudge }
 *   nudge: { kind: 'same'|'mix'|'gift', add, lineId?, name?, giftName?, offerName }
 */
export function buyXGetY(lines = [], sales = [], products = []) {
  const list = Array.isArray(lines) ? lines : [];
  const catalog = new Map((Array.isArray(products) ? products : []).filter((p) => p && p.id != null).map((p) => [String(p.id), p]));
  const pid = (l) => String(l?.id ?? '').split('::')[0];
  const qtyOf = (l) => Math.max(0, Math.trunc(Number(l?.qty)) || 0);
  const priceOf = (l) => Number(l?.price) || 0;
  const whole = (v, d) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) && n >= 1 && n <= 9 ? n : d; };

  const free = new Map();        // line index -> free units
  const offerAt = new Map();     // line index -> the sale's name
  const taken = new Set();
  const gifts = [];
  let saving = 0;
  let nudge = null;

  for (const o of Array.isArray(sales) ? sales : []) {
    if (!o || o.discountType !== 'bxgy') continue;
    const buy = whole(o.buy, 1);
    const get = whole(o.get, 1);
    const group = buy + get;
    const name = String(o.name || `Buy ${buy} Get ${get}`);

    if (o.freeMode === 'other') {
      const trig = String(o.triggerId ?? '');
      const gp = catalog.get(String(o.giftId ?? ''));
      if (!trig || !gp || String(gp.id) === trig || gp.inStock === false) continue;
      const bought = list.reduce((s, l) => (pid(l) === trig ? s + qtyOf(l) : s), 0);
      let n = Math.floor(bought / buy) * get;
      if (typeof gp.stock === 'number') n = Math.min(n, Math.max(0, Math.trunc(gp.stock)));
      if (n > 0) {
        const unit = Number(gp.price) || 0;
        gifts.push({
          id: String(gp.id), name: String(gp.name ?? ''), image: gp.image, category: gp.category,
          price: 0, mrp: Math.max(Number(gp.mrp) || 0, unit), unitPrice: unit, qty: n, free: true, gift: true, offerName: name,
          ...(gp.gstRate != null ? { gstRate: gp.gstRate } : {}),
        });
        saving += n * unit;
      } else if (bought > 0 && !nudge) {
        nudge = { kind: 'gift', add: buy - bought, lineId: list.find((l) => pid(l) === trig)?.id ?? null, giftName: String(gp.name ?? ''), offerName: name };
      }
      continue;
    }

    const ids = new Set((Array.isArray(o.productIds) ? o.productIds : []).map(String));
    const covers = (l) => (o.appliesTo === 'category'
      ? String(l?.category ?? catalog.get(pid(l))?.category ?? '') === String(o.categoryId ?? '') && o.categoryId != null
      : ids.has(pid(l)));
    const idx = [];
    list.forEach((l, i) => { if (!taken.has(i) && priceOf(l) > 0 && qtyOf(l) > 0 && covers(l)) idx.push(i); });
    if (!idx.length) continue;
    idx.forEach((i) => { taken.add(i); offerAt.set(i, name); });

    if (o.appliesTo === 'category') {
      // Mix and match: of every (buy + get) units, the cheapest `get` are free.
      const units = [];
      for (const i of idx) for (let k = 0; k < qtyOf(list[i]); k++) units.push(i);
      units.sort((a, b) => priceOf(list[b]) - priceOf(list[a]));
      const groups = Math.floor(units.length / group);
      for (const i of units.slice(units.length - groups * get)) free.set(i, (free.get(i) || 0) + 1);
      const rem = units.length % group;
      if (!nudge && rem >= buy) nudge = { kind: 'mix', add: group - rem, offerName: name };
    } else {
      for (const i of idx) {
        const q = qtyOf(list[i]);
        const f = Math.floor(q / group) * get;
        if (f) free.set(i, f);
        const rem = q % group;
        if (!nudge && rem >= buy) nudge = { kind: 'same', add: group - rem, lineId: list[i].id, name: String(list[i].name ?? ''), offerName: name };
      }
    }
  }

  const out = [];
  const freeByLine = {};
  list.forEach((l, i) => {
    const q = qtyOf(l);
    const f = Math.min(free.get(i) || 0, q);
    if (q - f > 0) out.push(f ? { ...l, qty: q - f } : l);
    if (f) {
      freeByLine[l.id] = f;
      // Its "was" price is the MRP when there is one, like every other line's saving.
      out.push({ ...l, qty: f, price: 0, mrp: Math.max(Number(l.mrp) || 0, priceOf(l)), unitPrice: priceOf(l), free: true, offerName: offerAt.get(i) });
      saving += f * priceOf(l);
    }
  });
  out.push(...gifts);
  return { lines: out, freeByLine, gifts, saving, nudge };
}

// ── request fingerprint ──────────────────────────────────────────────────────

const clean = (v) => String(v ?? '').normalize('NFC').trim().replace(/\s+/g, ' ');
const digits = (v) => String(v ?? '').replace(/\D/g, '');

/**
 * The canonical form of an order intent. Two requests that mean the same order
 * produce the same string; any change to what is ordered, by whom, to where,
 * how it is paid or what it is called produces a different one.
 *
 * Line order does not matter (the same cart re-sorted is the same intent), but
 * the order of `extras` within a line does: position maps to the config's
 * variantExtras groups.
 *
 * DELIBERATELY EXCLUDED: attribution (fbp / fbc / user agent) and the
 * idempotency key itself. Attribution legitimately differs between a first
 * attempt and a retry of the same cart — a refreshed cookie, a browser update,
 * an ad-blocker toggled — and it never affects what is ordered, owed or
 * delivered. Binding it would turn a harmless retry into an idempotency
 * conflict and push the customer to place a second order, which is the exact
 * outcome idempotency exists to prevent. The values stored on the row are the
 * ones sent by the attempt that committed.
 */
export function canonicalRequest(request = {}) {
  const lines = (Array.isArray(request.lines) ? request.lines : [])
    .map((l) => [
      String(l?.productId ?? ''),
      l?.variant == null ? '' : clean(l.variant),
      (Array.isArray(l?.extras) ? l.extras : []).map((e) => (e == null ? '' : clean(e))).join('^'),
      String(Math.trunc(Number(l?.qty)) || 0),
    ].join(':'))
    .sort();

  const c = request.customer || {};
  return [
    'req-v1',
    clean(request.slug).toLowerCase(),
    clean(request.mode).toLowerCase() || 'order',
    clean(request.paymentMethod).toLowerCase(),
    clean(request.couponCode).toUpperCase(),
    lines.join('|'),
    clean(c.name),
    digits(c.phone).slice(-10),
    clean(c.destination),
    digits(c.pincode).slice(0, 6),
    clean(request.notes),
  ].join('\n');
}

/** SHA-256 hex of a string. Web Crypto: present in browsers, Deno and Node 18+. */
export async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(String(text));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The request fingerprint: sha256 of canonicalRequest(). */
export function requestFingerprint(request) {
  return sha256Hex(canonicalRequest(request));
}

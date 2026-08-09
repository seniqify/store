import { BUSINESS_CONFIG } from '../config/businessConfig';

/**
 * Format a number as Indian Rupees.
 * e.g.  1234567 → ₹12,34,567
 */
export function formatINR(amount) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * Calculate discount percentage between selling price and MRP.
 * Returns 0 if there is no discount.
 */
export function discountPercent(price, mrp) {
  if (!mrp || mrp <= price) return 0;
  return Math.round(((mrp - price) / mrp) * 100);
}

/**
 * Calculate full cart totals from a cart array.
 *
 * @param {CartItem[]} items
 * @param {object}     [cartConfig]  — optional; defaults to BUSINESS_CONFIG.cart.
 *                                     Pass the active business's cart config in
 *                                     multi-tenant context so tax rate, thresholds,
 *                                     and shipping charges are correct per business.
 *
 * Returns:
 *   subtotal  — sum of (price × qty) for all items
 *   savings   — sum of (MRP − price) × qty for discounted items (≥ 0)
 *   tax       — GST at the rate in cartConfig.taxRate
 *   shipping  — flat fee or 0 when subtotal passes freeShippingAbove
 *   total     — the final amount the customer pays
 */
export function calcCartTotals(items, cartConfig = BUSINESS_CONFIG.cart, paymentMethod) {
  const {
    taxRate = 0, freeShippingAbove, shippingCharge, taxInclusive: storeInclusive = false,
    packagingCharge, codCharge,
  } = cartConfig;

  // Per item: GST rate and whether it's inclusive/exclusive. Each can be set on
  // the product to override the store-wide defaults (mixed-rate / mixed-mode
  // stores); otherwise the store settings apply.
  const rateFor      = (item) => (item.gstRate != null ? item.gstRate : taxRate);
  const inclusiveFor = (item) => (item.taxInclusive != null ? item.taxInclusive : storeInclusive);

  const subtotal = items.reduce(
    (sum, item) => sum + item.price * item.qty,
    0
  );

  // How much the customer saves vs. MRP (0 for items without mrp)
  const savings = items.reduce((sum, item) => {
    if (!item.mrp || item.mrp <= item.price) return sum;
    return sum + (item.mrp - item.price) * item.qty;
  }, 0);

  // "Free delivery above ₹X" only applies when X is a real positive threshold.
  // A 0 / blank value means "no free-delivery offer" → always charge the fee.
  // (A store that wants delivery free for everyone sets the Delivery Charge to 0.)
  // Without this guard, freeShippingAbove = 0 made `subtotal >= 0` always true,
  // so every order shipped free and the delivery fee was never applied.
  const freeAbove = Number(freeShippingAbove);
  const hasFreeThreshold = Number.isFinite(freeAbove) && freeAbove > 0;
  const shipping =
    items.length === 0                          ? 0
    : hasFreeThreshold && subtotal >= freeAbove ? 0
    : shippingCharge;

  // Extra charges — flat amounts the owner sets. Same 0/blank = "none" guard as
  // delivery, so a blank field never sneaks a charge onto the order.
  //   • Packaging: a real cost on every order (delivery AND pickup).
  //   • COD fee: only when the customer chose Cash on Delivery — waived on prepaid,
  //     which nudges shoppers to pay online.
  const packRaw = Number(packagingCharge);
  const packaging = items.length > 0 && Number.isFinite(packRaw) && packRaw > 0 ? packRaw : 0;
  const codRaw = Number(codCharge);
  const codFee = items.length > 0 && paymentMethod === 'cod' && Number.isFinite(codRaw) && codRaw > 0 ? codRaw : 0;

  // GST summed per line so a cart can mix rates (5% dry fruit + 18% oil) and even
  // mix modes. `taxRaw` is the total GST shown; `addedTax` is only the part added
  // on top (exclusive lines) — inclusive lines already sit inside the subtotal.
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

  // Labels: expose the single rate when all taxed lines share one (else null),
  // and "inclusive" only when every taxed line is inclusive.
  const taxed = items.filter((i) => rateFor(i) > 0);
  const rates = new Set(taxed.map(rateFor));
  const taxUniformPct = rates.size === 1 ? Math.round([...rates][0] * 100) : null;
  const taxInclusive  = taxed.length > 0 && taxed.every(inclusiveFor);

  return {
    subtotal,
    savings,
    tax,
    shipping,
    packaging,
    codFee,
    taxInclusive,
    taxUniformPct,
    total: subtotal + Math.round(addedTax) + shipping + packaging + codFee,
  };
}

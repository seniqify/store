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
export function calcCartTotals(items, cartConfig = BUSINESS_CONFIG.cart) {
  const { taxRate, freeShippingAbove, shippingCharge } = cartConfig;

  const subtotal = items.reduce(
    (sum, item) => sum + item.price * item.qty,
    0
  );

  // How much the customer saves vs. MRP (0 for items without mrp)
  const savings = items.reduce((sum, item) => {
    if (!item.mrp || item.mrp <= item.price) return sum;
    return sum + (item.mrp - item.price) * item.qty;
  }, 0);

  const tax = Math.round(subtotal * taxRate);

  const shipping =
    items.length === 0            ? 0
    : subtotal >= freeShippingAbove ? 0
    : shippingCharge;

  return {
    subtotal,
    savings,
    tax,
    shipping,
    total: subtotal + tax + shipping,
  };
}

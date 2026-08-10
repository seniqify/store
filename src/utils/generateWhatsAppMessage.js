import { calcCartTotals, formatINR } from './currency';
import { couponDiscountFor } from './offers';
import { saveOrder } from './orderService';

/**
 * generateWhatsAppMessage
 * ─────────────────────────────────────────────────────────────────────────────
 * Builds the pre-filled order message sent to the seller via WhatsApp.
 *
 * @param {object} customerDetails  { partyName, mobile, destination, paymentMethod, notes }
 * @param {Array}  cart             CartItem[]
 * @param {object} businessConfig   Active business config — always pass this explicitly.
 *
 * Output format (WhatsApp markdown supported):
 *
 *   *NEW ORDER — Business Name*
 *
 *   Party: Raj Textiles
 *   Mobile: +91 98765 43210
 *   Destination: Tirupur
 *   Payment: UPI / QR Code
 *
 *   Products:
 *   1. Premium Bath Towel × 2 — ₹698
 *   2. Stripe Hand Towel × 3 — ₹837
 *
 *   Subtotal: ₹1,535
 *   GST (5%): ₹77
 *   Delivery: FREE
 *   *Total: ₹1,612*
 *
 *   Notes: Please pack carefully
 */

const PAYMENT_LABELS = {
  cod:    'COD',
  upi:    'UPI',
  bank:   'Bank Transfer',
  cheque: 'Cheque',
};

const MAX_WORDS = 50;
const wordCount = (s) => s.trim().split(/\s+/).filter(Boolean).length;

/**
 * Builds the order message for a given set of visible items + an optional
 * trailer line (used to say "+N more items" once the list is trimmed).
 * Cost breakdown (subtotal/GST/delivery) is dropped first when trimming —
 * the buyer already saw it on-screen before sending; the seller mainly needs
 * WHAT to prepare and the final amount to collect.
 */
function build(customerDetails, items, finalTotal, opts) {
  const { trailer, showBreakdown, breakdown, coupon } = opts;
  const lines = ['🛍️ *New Order*', ''];

  lines.push(`${customerDetails.partyName}, +91${customerDetails.mobile}`);
  if (customerDetails.destination) lines.push(customerDetails.destination);
  lines.push('');

  items.forEach((item) => {
    const v = item.variant ? ` (${item.variant})` : '';
    lines.push(`${item.name}${v} x${item.qty} ${formatINR(item.price * item.qty)}`);
  });
  if (trailer) lines.push(trailer);
  lines.push('');

  if (showBreakdown) {
    lines.push(`Subtotal ${formatINR(breakdown.subtotal)}`);
    if (breakdown.tax > 0) lines.push(`GST ${formatINR(breakdown.tax)}`);
    if (breakdown.packaging > 0) lines.push(`Packaging ${formatINR(breakdown.packaging)}`);
    lines.push(`Delivery ${breakdown.shipping === 0 ? 'FREE' : formatINR(breakdown.shipping)}`);
    if (breakdown.codFee > 0) lines.push(`COD fee ${formatINR(breakdown.codFee)}`);
    if (breakdown.couponDiscount > 0) lines.push(`Coupon -${formatINR(breakdown.couponDiscount)}`);
  }

  const payLabel = PAYMENT_LABELS[customerDetails.paymentMethod] ?? customerDetails.paymentMethod;
  if (payLabel) lines.push(`Payment: ${payLabel}`);
  lines.push(`*Total: ${formatINR(finalTotal)}*`);

  // Collapse the blank-line gap left when destination/breakdown are skipped.
  return lines.filter((l, i) => l !== '' || lines[i - 1] !== '').join('\n').trim();
}

/**
 * generateWhatsAppMessage
 * Kept under 50 words on purpose — the store's WhatsApp automation only
 * triggers on incoming messages at or under that length. The full order
 * (every item, notes, cost breakdown) is always saved via saveOrder() first,
 * so trimming this text never loses data — it's just what's typed into chat.
 */
export function generateWhatsAppMessage(customerDetails, cart, businessConfig = {}, coupon = null) {
  const cartConfig = businessConfig.cart ?? { taxRate: 0, freeShippingAbove: 999, shippingCharge: 49 };
  const { subtotal, tax, shipping, packaging, codFee, total } = calcCartTotals(cart, cartConfig, customerDetails.paymentMethod);
  const couponDiscount = coupon ? couponDiscountFor(coupon, subtotal) : 0;
  const finalTotal = Math.max(0, total - couponDiscount);
  const breakdown = { subtotal, tax, shipping, packaging, codFee, couponDiscount };

  // 1. Try the full message (all items + cost breakdown).
  let msg = build(customerDetails, cart, finalTotal, { showBreakdown: true, breakdown, coupon });
  if (wordCount(msg) <= MAX_WORDS) return msg;

  // 2. Drop the cost breakdown — buyer already saw it on-screen.
  msg = build(customerDetails, cart, finalTotal, { showBreakdown: false, breakdown, coupon });
  if (wordCount(msg) <= MAX_WORDS || cart.length <= 1) return msg;

  // 3. Trim the item list; the full cart is already in Manage → Orders.
  for (let keep = cart.length - 1; keep >= 1; keep--) {
    const more = cart.length - keep;
    const candidate = build(customerDetails, cart.slice(0, keep), finalTotal, {
      showBreakdown: false, breakdown, coupon,
      trailer: `+${more} more item${more > 1 ? 's' : ''} (full list in Orders)`,
    });
    msg = candidate;
    if (wordCount(candidate) <= MAX_WORDS) break;
  }
  return msg;
}

/**
 * generateWhatsAppURL
 * Returns the full wa.me deep-link with the message encoded via encodeURIComponent.
 * Uses the business's own WhatsApp number from businessConfig.
 */
export function generateWhatsAppURL(customerDetails, cart, businessConfig = {}, coupon = null) {
  const message = generateWhatsAppMessage(customerDetails, cart, businessConfig, coupon);
  const encoded = encodeURIComponent(message);
  const number  = businessConfig.whatsappNumber ?? '';
  return `https://wa.me/${number}?text=${encoded}`;
}

/**
 * openOrderOnWhatsApp
 * Opens WhatsApp with the pre-filled order message — WITHOUT recording the order.
 * Use when the order has already been saved separately (so it is never saved twice
 * and the save can't be lost if this hand-off is blocked/slow).
 * Mobile: opens the WhatsApp app directly via the wa.me deep link.
 */
export function openOrderOnWhatsApp(customerDetails, cart, businessConfig = {}, coupon = null) {
  const url = generateWhatsAppURL(customerDetails, cart, businessConfig, coupon);
  window.open(url, '_blank', 'noopener,noreferrer');
}

/**
 * sendOrderOnWhatsApp
 * Records the order, then opens WhatsApp in a new tab with the pre-filled message.
 * Mobile: opens the WhatsApp app directly via the wa.me deep link.
 */
export function sendOrderOnWhatsApp(customerDetails, cart, businessConfig = {}, coupon = null) {
  // Record the order first (best-effort, fire-and-forget — never blocks WhatsApp).
  saveOrder(customerDetails, cart, businessConfig, coupon);
  openOrderOnWhatsApp(customerDetails, cart, businessConfig, coupon);
}

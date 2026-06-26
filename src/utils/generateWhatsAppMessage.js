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
  cod:    'Cash / COD',
  upi:    'UPI / QR Code',
  bank:   'Bank Transfer (NEFT/RTGS)',
  cheque: 'Cheque',
};

export function generateWhatsAppMessage(customerDetails, cart, businessConfig = {}, coupon = null) {
  const cartConfig = businessConfig.cart ?? { taxRate: 0, freeShippingAbove: 999, shippingCharge: 49 };
  const { subtotal, tax, shipping, total, taxInclusive, taxUniformPct } = calcCartTotals(cart, cartConfig);
  const couponDiscount = coupon ? couponDiscountFor(coupon, subtotal) : 0;
  const finalTotal = Math.max(0, total - couponDiscount);

  const lines = [];

  // ── Header ─────────────────────────────────────────────────────────────────
  const bizName = businessConfig.businessName ?? businessConfig.name ?? '';
  lines.push(bizName ? `*NEW ORDER — ${bizName}*` : '*NEW ORDER*');
  lines.push('');

  // ── Customer details ────────────────────────────────────────────────────────
  lines.push(`Party: ${customerDetails.partyName}`);
  lines.push(`Mobile: +91 ${customerDetails.mobile}`);
  lines.push(`Destination: ${customerDetails.destination}`);
  if (customerDetails.paymentMethod) {
    const label = PAYMENT_LABELS[customerDetails.paymentMethod] ?? customerDetails.paymentMethod;
    lines.push(`Payment: ${label}`);

    // ── Append payment-method-specific details ───────────────────────────────
    if (customerDetails.paymentMethod === 'upi' && businessConfig.upi) {
      lines.push(`UPI ID: ${businessConfig.upi}`);
    }

    if (customerDetails.paymentMethod === 'bank') {
      const b = businessConfig.bank;
      if (b?.accountNumber) {
        lines.push('');
        lines.push('*Bank Transfer Details:*');
        if (b.accountName)   lines.push(`Name: ${b.accountName}`);
        lines.push(`A/C No: ${b.accountNumber}`);
        if (b.ifsc)          lines.push(`IFSC: ${b.ifsc}`);
        if (b.bankName)      lines.push(`Bank: ${b.bankName}`);
      }
    }
  }
  lines.push('');

  // ── Product list ────────────────────────────────────────────────────────────
  lines.push('Products:');
  cart.forEach((item, index) => {
    const lineTotal = formatINR(item.price * item.qty);
    const v = item.variant ? ` (${item.variant})` : '';
    lines.push(`${index + 1}. ${item.name}${v} × ${item.qty} — ${lineTotal}`);
  });
  lines.push('');

  // ── Cost breakdown ──────────────────────────────────────────────────────────
  lines.push(`Subtotal: ${formatINR(subtotal)}`);
  if (tax > 0) lines.push(`GST${taxUniformPct != null ? ` (${taxUniformPct}%)` : ''}${taxInclusive ? ' incl.' : ''}: ${formatINR(tax)}`);
  lines.push(`Delivery: ${shipping === 0 ? 'FREE' : formatINR(shipping)}`);
  if (couponDiscount > 0) lines.push(`Coupon (${coupon.code}): -${formatINR(couponDiscount)}`);
  lines.push(`*Total: ${formatINR(finalTotal)}*`);

  // ── Optional notes ──────────────────────────────────────────────────────────
  if (customerDetails.notes?.trim()) {
    lines.push('');
    lines.push(`Notes: ${customerDetails.notes.trim()}`);
  }

  return lines.join('\n');
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
 * sendOrderOnWhatsApp
 * Opens WhatsApp in a new tab with the pre-filled order message.
 * Mobile: opens the WhatsApp app directly via the wa.me deep link.
 */
export function sendOrderOnWhatsApp(customerDetails, cart, businessConfig = {}, coupon = null) {
  // Record the order first (best-effort, fire-and-forget — never blocks WhatsApp).
  saveOrder(customerDetails, cart, businessConfig, coupon);
  const url = generateWhatsAppURL(customerDetails, cart, businessConfig, coupon);
  window.open(url, '_blank', 'noopener,noreferrer');
}

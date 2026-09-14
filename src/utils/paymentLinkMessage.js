/**
 * The WhatsApp message that carries a Razorpay payment link. Pure (no network),
 * so it is unit-tested in node; paymentLinks.js re-exports it.
 * Plain text on purpose: emoji turn into � on some WhatsApp clients.
 */
export function paymentLinkMessage({ customerName, storeName, total, url } = {}) {
  const first = String(customerName || '').trim().split(/\s+/)[0];
  const amount = `₹${Number(total || 0).toLocaleString('en-IN')}`;
  return `${first ? `Hi ${first}` : 'Hi'}, here is a secure Razorpay link to pay ${amount} for your order from *${storeName || 'our store'}*:\n` +
    `${url}\n\n` +
    `Pay by UPI or card. Once paid, there is nothing to hand over at delivery.`;
}

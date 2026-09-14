/**
 * Order state rules shared by every screen that shows or counts orders.
 *
 * Checkout saves an online order BEFORE the customer pays (the payment is
 * created against that saved row), so an online order that is not marked paid
 * means one of two very different things:
 *
 *   incomplete   — nothing has happened since: the customer left the payment
 *                  screen. Not a sale.
 *   unconfirmed  — the seller has already shipped or delivered it, so money most
 *                  likely arrived, but Razorpay has not confirmed it to us yet
 *                  (for example a checkout from before payments were matched by
 *                  order id). The Razorpay check confirms these automatically.
 *
 * Neither is hidden: if money did arrive the order must stay visible. The same
 * "online, not paid, no payment_ref" test keeps both out of the new-order alert
 * (new_orders_since).
 */

const isOnlineUnpaid = (o) => String(o?.payment_method || '').toLowerCase() === 'online'
  && o?.paid !== true
  && !o?.payment_ref;

/** Handed to a courier, or delivered. */
export function isShippedOrDelivered(o) {
  return Boolean(o?.awb)
    || o?.status === 'dispatched'
    || o?.status === 'delivered'
    || o?.shipment_outcome === 'delivered';
}

/** An online order the customer left without paying, and nothing happened since. */
export function isPaymentIncomplete(o) {
  return isOnlineUnpaid(o) && !isShippedOrDelivered(o);
}

/** An online order already shipped or delivered whose payment Razorpay has not confirmed yet. */
export function isPaymentUnconfirmed(o) {
  return isOnlineUnpaid(o) && isShippedOrDelivered(o);
}

/** Does this order count as a sale in totals, stats and customer value? */
export function countsAsSale(o) {
  return o?.status !== 'cancelled' && o?.status !== 'abandoned' && !isPaymentIncomplete(o);
}

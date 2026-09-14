/**
 * Order state rules shared by every screen that shows or counts orders.
 *
 * Checkout saves an online order BEFORE the customer pays (the payment is
 * created against that saved row). A customer who leaves the Razorpay screen
 * without paying therefore leaves a real row behind that is not a sale.
 *
 * It is flagged, never hidden: if Razorpay captured the money but our
 * verification hiccuped, the seller still needs to see the order and can mark
 * it paid. The same rule already keeps these rows out of the new-order alert
 * (new_orders_since: online orders alert only when paid or payment_ref is set).
 */

/** An online order the customer has not finished paying for. */
export function isPaymentIncomplete(o) {
  return String(o?.payment_method || '').toLowerCase() === 'online'
    && o?.paid !== true
    && !o?.payment_ref;
}

/** Does this order count as a sale in totals, stats and customer value? */
export function countsAsSale(o) {
  return o?.status !== 'cancelled' && o?.status !== 'abandoned' && !isPaymentIncomplete(o);
}

import { supabase } from '../lib/supabase';

/** Load Razorpay Checkout once (resolves false if the SDK can't be fetched). */
function loadRazorpayScript() {
  return new Promise((resolve) => {
    if (window.Razorpay) { resolve(true); return; }
    const s = document.createElement('script');
    s.src     = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload  = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

/**
 * Run the online-payment flow for a store order:
 *   create a Razorpay order on the STORE's own account → open Checkout →
 *   verify the signature server-side → the order is marked paid.
 *
 * Money settles to the merchant's Razorpay; PocketLink never touches it.
 *
 * Resolves:
 *   { paid: true, paymentId }        — captured & verified
 *   { paid: true, unverified: true } — captured, but our verify hiccuped (reconcile later)
 *   { paid: false, reason }          — customer closed the sheet
 * Throws on setup errors (SDK/order creation) so the caller can fall back.
 */
export async function payOnline({ slug, amount, orderRowId, customer = {}, storeName, themeColor }) {
  const loaded = await loadRazorpayScript();
  if (!loaded) throw new Error('Could not load the payment screen. Check your connection.');

  const { data: order } = await supabase.functions.invoke('payments-create-order', {
    body: { slug, amount, notes: { order_row_id: orderRowId || '' } },
  });
  if (order?.error || !order?.order_id) {
    throw new Error(order?.error || 'Could not start the payment.');
  }

  return await new Promise((resolve, reject) => {
    const options = {
      key:         order.key_id,
      order_id:    order.order_id,
      amount:      order.amount,
      currency:    order.currency || 'INR',
      name:        storeName || 'Your order',
      description: 'Order payment',
      prefill: {
        name:    customer.name || '',
        contact: String(customer.phone || '').replace(/\D/g, '').slice(-10),
      },
      theme: { color: themeColor || '#0d9488' },
      modal: { ondismiss: () => resolve({ paid: false, reason: 'cancelled' }) },
      handler: async (response) => {
        try {
          const { data: v } = await supabase.functions.invoke('payments-verify', {
            body: {
              slug,
              razorpay_order_id:   response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature:  response.razorpay_signature,
              order_row_id:        orderRowId,
            },
          });
          // Money is captured by the time handler fires. If verify can't confirm,
          // still treat it as paid (never alarm a charged customer) and let the
          // owner reconcile — a webhook will self-heal once the OAuth flow ships.
          resolve({ paid: true, paymentId: response.razorpay_payment_id, unverified: !v?.verified });
        } catch {
          resolve({ paid: true, paymentId: response.razorpay_payment_id, unverified: true });
        }
      },
    };
    const rzp = new window.Razorpay(options);
    rzp.on('payment.failed', (resp) => reject(new Error(resp.error?.description || 'Payment failed. Please try again.')));
    rzp.open();
  });
}

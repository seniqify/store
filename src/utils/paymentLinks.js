import { supabase } from '../lib/supabase';
import { hashPin } from './pinHash';

/**
 * Razorpay payment links for store orders (supabase/functions/payments-link).
 * The server decides the amount from the saved order and marks the order paid
 * only when Razorpay confirms the link was paid for it.
 */

async function call(body) {
  const { data, error } = await supabase.functions.invoke('payments-link', { body });
  if (error) throw new Error('Could not reach the payment service. Check your connection.');
  if (data?.error) throw new Error(data.error);
  return data || {};
}

/** Seller: make (or reuse) the link for an order. Resolves { url } or { paid: true }. */
export async function createPaymentLink(slug, pin, orderId) {
  return call({ action: 'create', slug, hashed_pin: await hashPin(pin), order_id: orderId });
}

/** Seller: ask Razorpay about up to 50 orders. Resolves [{ order_id, status }]. */
export async function checkPaymentLinks(slug, pin, orderIds = []) {
  const r = await call({ action: 'check', slug, hashed_pin: await hashPin(pin), order_ids: orderIds.slice(0, 50) });
  return r.results || [];
}

/** Seller: confirm online checkouts from the last 7 days that Razorpay shows as paid. */
export async function reconcileOnlinePayments(slug, pin) {
  const r = await call({ action: 'reconcile', slug, hashed_pin: await hashPin(pin) });
  return r.results || [];
}

/** Customer's order page, after Razorpay redirects back. Never throws. */
export async function confirmPaymentLinkByToken(token) {
  try {
    const { data } = await supabase.functions.invoke('payments-link', { body: { action: 'confirm', token } });
    return Boolean(data?.paid);
  } catch {
    return false;
  }
}

export { paymentLinkMessage } from './paymentLinkMessage';

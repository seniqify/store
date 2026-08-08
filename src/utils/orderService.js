import { supabase } from '../lib/supabase';
import { calcCartTotals } from './currency';
import { couponDiscountFor } from './offers';
import { hashPin } from './pinHash';

/**
 * Order capture + retrieval.
 *  • saveOrder      — public (anon) insert when a customer places an order.
 *  • saveLead       — public (anon) insert when a customer requests a service quote.
 *  • fetchOrders    — owner-only read, gated by the store PIN (server RPC).
 *  • setOrderStatus — owner-only status update, gated by the store PIN.
 *
 * Customers can INSERT but never SELECT orders (RLS), so customer PII is only
 * readable by the owner via the PIN-checked RPCs.
 */

/** Best-effort: record an order. Never throws — must not block the WhatsApp handoff. */
export async function saveOrder(customerDetails = {}, cart = [], config = {}, coupon = null) {
  // Skip demo stores (slug stripped) and empty carts.
  if (!config?.slug || !Array.isArray(cart) || cart.length === 0) return;
  try {
    const { subtotal, tax, shipping, total } = calcCartTotals(cart, config.cart);
    const couponDiscount = coupon ? couponDiscountFor(coupon, subtotal) : 0;
    const netTotal = Math.max(0, total - couponDiscount);
    const couponNote = couponDiscount > 0 ? `Coupon ${coupon.code} (−₹${couponDiscount})` : '';
    await supabase.from('orders').insert({
      store_slug:     config.slug,
      customer_name:  customerDetails.partyName || customerDetails.name || '',
      customer_phone: String(customerDetails.mobile || customerDetails.phone || '').replace(/\D/g, '').slice(-10),
      destination:    customerDetails.destination || customerDetails.city || '',
      payment_method: customerDetails.paymentMethod || '',
      notes:          [customerDetails.notes || '', couponNote].filter(Boolean).join(' · '),
      items:          cart.map((i) => ({ name: i.name, price: i.price, qty: i.qty, variant: i.variant || null, size: i.size || null, unit: i.unit || null })),
      item_count:     cart.reduce((s, i) => s + i.qty, 0),
      subtotal, tax, shipping, total: netTotal,
      status:         'new',
    });
  } catch (err) {
    // Best-effort — a failed save must never break the customer's order — but log
    // it (was fully silent) so a lost order leaves a trace to diagnose.
    console.error('saveOrder failed:', err?.message || err);
  }
}

/** Best-effort: record a service quote request as a lead — an order row with
 *  zero totals, so leads never count as revenue in Stats. Never throws — must
 *  not block the WhatsApp handoff. */
export async function saveLead(form = {}, config = {}) {
  if (!config?.slug || !form?.name || !Array.isArray(form.services) || form.services.length === 0) return;
  try {
    const items = form.services.map((name) => {
      const svc = (config.products || []).find((p) => p.name === name);
      return { name, price: svc?.price || 0, qty: 1, unit: svc?.unit || null };
    });
    await supabase.from('orders').insert({
      store_slug:     config.slug,
      customer_name:  String(form.name).trim().slice(0, 80),
      customer_phone: String(form.phone || '').replace(/\D/g, '').slice(-10),
      destination:    '',
      payment_method: '',
      notes:          [form.budget ? `Budget ₹${form.budget}` : '', String(form.notes || '').trim()]
                        .filter(Boolean).join(' · ').slice(0, 500),
      items,
      item_count:     items.length,
      subtotal: 0, tax: 0, shipping: 0, total: 0,
      status:         'new',
    });
  } catch {
    /* best-effort — a failed log must never break the customer's inquiry */
  }
}

/** Best-effort: record an abandoned checkout — the customer typed their full
 *  phone number but never sent the order. Shows up ONLY in the Abandoned tab
 *  (fetchOrders hides these rows everywhere else). Never throws. */
export async function saveAbandonedCheckout(customerDetails = {}, cart = [], config = {}) {
  if (!config?.slug || !Array.isArray(cart) || cart.length === 0) return;
  try {
    const { subtotal, tax, shipping, total } = calcCartTotals(cart, config.cart);
    await supabase.from('orders').insert({
      store_slug:     config.slug,
      customer_name:  customerDetails.partyName || '',
      customer_phone: String(customerDetails.mobile || '').replace(/\D/g, '').slice(-10),
      destination:    customerDetails.destination || '',
      payment_method: '',
      notes:          '🛒 abandoned checkout',
      items:          cart.map((i) => ({ name: i.name, price: i.price, qty: i.qty, variant: i.variant || null, size: i.size || null, unit: i.unit || null })),
      item_count:     cart.reduce((s, i) => s + i.qty, 0),
      subtotal, tax, shipping, total,
      status:         'abandoned',
    });
  } catch {
    /* best-effort — must never disturb the customer's checkout */
  }
}

/** Owner-only: list this store's orders (PIN-checked server-side).
 *  Abandoned-checkout rows are excluded by default so Orders, Stats and
 *  Customers never count them — only the Abandoned tab opts in. */
export async function fetchOrders(slug, pin, { includeAbandoned = false } = {}) {
  try {
    const hashed = await hashPin(pin);
    const { data, error } = await supabase.rpc('get_store_orders', { p_slug: slug, p_hashed_pin: hashed });
    if (error) return [];
    return (data || []).filter((o) => includeAbandoned || o.status !== 'abandoned');
  } catch {
    return [];
  }
}

/** Owner-only: change an order's status (PIN-checked server-side). */
export async function setOrderStatus(slug, pin, orderId, status) {
  try {
    const hashed = await hashPin(pin);
    await supabase.rpc('update_order_status', { p_slug: slug, p_hashed_pin: hashed, p_order_id: orderId, p_status: status });
  } catch {
    /* ignore */
  }
}

/** Owner-only: mark an order paid / unpaid (PIN-checked server-side). */
export async function setOrderPaid(slug, pin, orderId, paid) {
  try {
    const hashed = await hashPin(pin);
    await supabase.rpc('set_order_paid', { p_slug: slug, p_hashed_pin: hashed, p_order_id: orderId, p_paid: paid });
  } catch {
    /* ignore */
  }
}

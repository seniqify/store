import { supabase } from '../lib/supabase';
import { calcCartTotals } from './currency';
import { hashPin } from './pinHash';

/**
 * Order capture + retrieval.
 *  • saveOrder      — public (anon) insert when a customer places an order.
 *  • fetchOrders    — owner-only read, gated by the store PIN (server RPC).
 *  • setOrderStatus — owner-only status update, gated by the store PIN.
 *
 * Customers can INSERT but never SELECT orders (RLS), so customer PII is only
 * readable by the owner via the PIN-checked RPCs.
 */

/** Best-effort: record an order. Never throws — must not block the WhatsApp handoff. */
export async function saveOrder(customerDetails = {}, cart = [], config = {}) {
  // Skip demo stores (slug stripped) and empty carts.
  if (!config?.slug || !Array.isArray(cart) || cart.length === 0) return;
  try {
    const { subtotal, tax, shipping, total } = calcCartTotals(cart, config.cart);
    await supabase.from('orders').insert({
      store_slug:     config.slug,
      customer_name:  customerDetails.partyName || customerDetails.name || '',
      customer_phone: String(customerDetails.mobile || customerDetails.phone || '').replace(/\D/g, '').slice(-10),
      destination:    customerDetails.destination || customerDetails.city || '',
      payment_method: customerDetails.paymentMethod || '',
      notes:          customerDetails.notes || '',
      items:          cart.map((i) => ({ name: i.name, price: i.price, qty: i.qty, size: i.size || null, unit: i.unit || null })),
      item_count:     cart.reduce((s, i) => s + i.qty, 0),
      subtotal, tax, shipping, total,
      status:         'new',
    });
  } catch {
    /* best-effort — a failed log must never break the customer's order */
  }
}

/** Owner-only: list this store's orders (PIN-checked server-side). */
export async function fetchOrders(slug, pin) {
  try {
    const hashed = await hashPin(pin);
    const { data, error } = await supabase.rpc('get_store_orders', { p_slug: slug, p_hashed_pin: hashed });
    if (error) return [];
    return data || [];
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

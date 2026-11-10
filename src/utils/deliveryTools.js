import { supabase } from '../lib/supabase';
import { hashPin } from './pinHash';

// Delivery tools (supabase/delivery-tools-forward.sql): automatic shipping
// updates, COD money, the buyer's missed-delivery answer and the pay-online
// discount. Shop calls are PIN-checked in the database; a wrong PIN reads null.

async function shopRpc(fn, slug, pin, args = {}) {
  const hashed = await hashPin(pin);
  const { data, error } = await supabase.rpc(fn, { p_slug: slug, p_hashed_pin: hashed, ...args });
  if (error) throw new Error('Could not reach the server. Try again.');
  if (data === null) throw new Error('Your PIN was not accepted. Open Manage again.');
  return data;
}

export const getShipUpdates = (slug, pin) => shopRpc('get_ship_updates', slug, pin);
export const setShipUpdates = (slug, pin, enabled, events) =>
  shopRpc('set_ship_updates', slug, pin, { p_enabled: enabled, p_events: events });
export const getCodRemittance = (slug, pin) => shopRpc('get_cod_remittance', slug, pin);
/** This month's order messages: { free_limit, free_used, paid, skipped, balance_paise } (whatsapp-coins-forward.sql). */
export const getOrderMessageUsage = (slug, pin) => shopRpc('get_order_message_usage', slug, pin);
export const markCodRemitted = (slug, pin, orderIds, received = true) =>
  shopRpc('mark_cod_remitted', slug, pin, { p_order_ids: orderIds, p_received: received });

/** Take Rs `discount` off a COD order so the buyer pays online. → { ok, total, reason } */
export const prepayDiscount = (slug, pin, orderId, discount) =>
  shopRpc('seller_prepay_discount', slug, pin, { p_order_id: orderId, p_discount: discount });

/** Buyer side (order page): the token is the credential. */
export async function getDeliveryChoice(token) {
  const { data, error } = await supabase.rpc('get_delivery_choice', { p_token: token });
  return error ? null : data;
}
export async function setDeliveryChoice(token, choice, address) {
  const { data, error } = await supabase.rpc('set_delivery_choice', { p_token: token, p_choice: choice, p_address: address || null });
  if (error) return { ok: false, reason: 'network' };
  return data || { ok: false, reason: 'network' };
}

export const SHIP_EVENTS = Object.freeze([
  { key: 'shipped',   title: 'Shipped',               desc: 'When the courier picks it up, with the tracking page link' },
  { key: 'ofd',       title: 'Out for delivery today', desc: 'With the amount to keep ready for cash on delivery' },
  { key: 'failed',    title: 'Delivery failed',        desc: 'The customer picks: deliver tomorrow, change address or cancel' },
  { key: 'delivered', title: 'Delivered',              desc: 'With a link to rate the order' },
]);

export const DELIVERY_CHOICE_LABEL = {
  reattempt: 'Deliver tomorrow',
  address: 'Change the address',
  cancel: 'Cancel the order',
};

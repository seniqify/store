import { supabase } from '../lib/supabase';
import { hashPin } from './pinHash';

/** Owner-only: connect a store's Delhivery account (PIN-checked server-side).
 *  Validates the token against Delhivery before saving. Throws a friendly error. */
export async function connectDelhivery(slug, pin, fields) {
  const hashedPin = await hashPin(pin);
  const { data, error } = await supabase.functions.invoke('shipping-connect', {
    body: { action: 'connect', slug, hashedPin, ...fields },
  });
  if (error) throw new Error('Could not reach the server. Try again.');
  if (data?.error) throw new Error(data.error);
  return data;
}

/** Owner-only: connect a store's Shadowfax account (PIN-checked server-side).
 *  Validates the token + pickup serviceability before saving. */
export async function connectShadowfax(slug, pin, fields) {
  const hashedPin = await hashPin(pin);
  const { data, error } = await supabase.functions.invoke('shipping-connect', {
    body: { action: 'connect', provider: 'shadowfax', slug, hashedPin, ...fields },
  });
  if (error) throw new Error('Could not reach the server. Try again.');
  if (data?.error) throw new Error(data.error);
  return data;
}

/** Owner-only: disconnect the store's courier — Delhivery or Shadowfax (PIN-checked). */
export async function disconnectDelhivery(slug, pin) {
  const hashedPin = await hashPin(pin);
  const { data, error } = await supabase.functions.invoke('shipping-connect', {
    body: { action: 'disconnect', slug, hashedPin },
  });
  if (error) throw new Error('Could not reach the server. Try again.');
  if (data?.error) throw new Error(data.error);
  return data;
}

/** Storefront: get a live Delhivery rate + serviceability for a destination pincode. */
export async function getShippingRate(slug, destPincode, weightG, paymentMode) {
  const { data, error } = await supabase.functions.invoke('shipping-rate', {
    body: { slug, destPincode, weightG, paymentMode },
  });
  if (error) return { error: 'rate lookup failed' };
  return data || {};
}

/** Owner-only: create a Delhivery shipment for an order (PIN-checked). `details`
 *  are the merchant's edited fields from the booking modal (name/address/payment/
 *  weight/dimensions); the order's own data is the fallback. → { awb, trackUrl } */
export async function bookShipment(slug, pin, orderId, details = {}) {
  const hashedPin = await hashPin(pin);
  const { data, error } = await supabase.functions.invoke('shipping-book', {
    body: { slug, hashedPin, orderId, details },
  });
  if (error) throw new Error('Could not reach the server. Try again.');
  if (data?.error) throw new Error(data.error);
  return data;
}

/** Owner-only: label | track | cancel on a booked order (PIN-checked). */
export async function shipmentOp(slug, pin, orderId, action) {
  const hashedPin = await hashPin(pin);
  const { data, error } = await supabase.functions.invoke('shipping-ops', {
    body: { action, slug, hashedPin, orderId },
  });
  if (error) throw new Error('Could not reach the server. Try again.');
  if (data?.error) throw new Error(data.error);
  return data;
}

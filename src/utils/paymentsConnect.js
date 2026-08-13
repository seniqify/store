import { supabase } from '../lib/supabase';
import { hashPin } from './pinHash';

/** Owner-only: connect a store's Razorpay account (PIN-checked server-side).
 *  Returns { connected, mode, keyIdMasked }. Throws with a friendly message. */
export async function connectRazorpay(slug, pin, { keyId, keySecret }) {
  const hashedPin = await hashPin(pin);
  const { data, error } = await supabase.functions.invoke('payments-connect', {
    body: { action: 'connect', slug, hashedPin, keyId, keySecret },
  });
  if (error) throw new Error('Could not reach the server. Try again.');
  if (data?.error) throw new Error(data.error);
  return data;
}

/** Owner-only: disconnect a store's Razorpay account (PIN-checked server-side). */
export async function disconnectRazorpay(slug, pin) {
  const hashedPin = await hashPin(pin);
  const { data, error } = await supabase.functions.invoke('payments-connect', {
    body: { action: 'disconnect', slug, hashedPin },
  });
  if (error) throw new Error('Could not reach the server. Try again.');
  if (data?.error) throw new Error(data.error);
  return data;
}

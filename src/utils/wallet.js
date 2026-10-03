import { supabase } from '../lib/supabase';
import { hashPin } from './pinHash';
import { loadRazorpayScript } from './onlinePayment';
import { factsFailed } from './orderFactsResult';

/**
 * WhatsApp message wallet — the network side. Prices and packs live in
 * walletPacks.js; the rules (never below zero, credit only what Razorpay
 * confirms, once) live in the database (supabase/wallet-forward.sql).
 */

/** The shop's wallet: { ok: true, data: { balance_paise, price_paise,
 *  pending_topups, recent[] } } or { ok: false, data: [], reason }. A wrong PIN
 *  comes back as data: null. */
export async function fetchWallet(slug, pin) {
  try {
    const hashed = await hashPin(pin);
    const { data, error } = await supabase.rpc('get_store_wallet', { p_slug: slug, p_hashed_pin: hashed });
    if (error) return factsFailed('rpc');
    if (data !== null && (typeof data !== 'object' || Array.isArray(data))) return factsFailed('malformed');
    return { ok: true, data };
  } catch {
    return factsFailed('unavailable');
  }
}

/** Ask the server to check this shop's unpaid top-ups with Razorpay and credit
 *  the paid ones. Returns { credited, waiting } (zeros on any failure — the
 *  next call simply tries again; nothing is ever lost). */
export async function confirmTopups(slug, pin, orderId) {
  try {
    const hashed = await hashPin(pin);
    const { data } = await supabase.functions.invoke('wallet-topup', {
      body: { action: 'confirm', slug, hashedPin: hashed, ...(orderId ? { order_id: orderId } : {}) },
    });
    return { credited: Number(data?.credited) || 0, waiting: Number(data?.waiting) || 0 };
  } catch {
    return { credited: 0, waiting: 0 };
  }
}

/**
 * Buy a pack: the server creates the Razorpay order at ITS price → Checkout →
 * the server asks Razorpay and credits. Resolves
 *   { paid: true, credited: true }   — the messages are in the wallet
 *   { paid: true, credited: false }  — paid; Razorpay has not confirmed yet
 *                                      (the wallet re-checks when opened)
 *   { paid: false }                  — the sheet was closed
 * Throws when the payment cannot start or fails, with a message to show.
 */
export async function buyPack({ slug, pin, messages, storeName = '', phone = '', themeColor = '#0d9488' }) {
  const loaded = await loadRazorpayScript();
  if (!loaded) throw new Error('Could not load the payment screen. Check your connection.');

  const hashed = await hashPin(pin);
  const { data: order } = await supabase.functions.invoke('wallet-topup', {
    body: { action: 'create', slug, hashedPin: hashed, messages },
  });
  if (order?.error || !order?.order_id) throw new Error(order?.error || 'Could not start the payment.');

  return await new Promise((resolve, reject) => {
    const rzp = new window.Razorpay({
      key:         order.key_id,
      order_id:    order.order_id,
      amount:      order.amount,
      currency:    order.currency || 'INR',
      name:        'PocketLink',
      description: `${Number(order.messages).toLocaleString('en-IN')} WhatsApp messages${storeName ? ` · ${storeName}` : ''}`,
      prefill:     { contact: String(phone || '').replace(/\D/g, '').slice(-10) },
      notes:       { purpose: 'wallet_topup', store: slug },
      theme:       { color: themeColor },
      modal:       { ondismiss: () => resolve({ paid: false }) },
      handler: async () => {
        const r = await confirmTopups(slug, pin, order.order_id);
        resolve({ paid: true, credited: r.credited > 0 });
      },
    });
    rzp.on('payment.failed', (resp) => reject(new Error(resp?.error?.description || 'Payment failed. Please try again.')));
    rzp.open();
  });
}

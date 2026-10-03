/**
 * WhatsApp message wallet — prices, packs and labels. Pure: no network, no
 * React, so it is tested directly.
 *
 * The server is the authority on every number here: wallet_message_price_paise()
 * in SQL holds the price, and the wallet-topup edge function holds the packs and
 * charges from its own table — the browser only names how many messages it
 * wants. These copies exist to DISPLAY them, and a test keeps them equal.
 */

/** Rs 1.50 per message (founder pricing, 2026-10-04). */
export const MESSAGE_PRICE_PAISE = 150;

/** The packs a shop can buy. Same as PACKS in supabase/functions/wallet-topup. */
export const WALLET_PACKS = Object.freeze([
  Object.freeze({ messages: 100,  amountPaise: 15000 }),
  Object.freeze({ messages: 500,  amountPaise: 75000 }),
  Object.freeze({ messages: 1000, amountPaise: 150000 }),
]);

const int = (v) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) ? n : 0; };

/** Whole messages a balance pays for. Never negative. */
export function messagesLeft(balancePaise, pricePaise = MESSAGE_PRICE_PAISE) {
  const b = int(balancePaise);
  const p = int(pricePaise);
  return b > 0 && p > 0 ? Math.floor(b / p) : 0;
}

/** Paise → "₹1.50", "₹150", "₹1,500". formatINR rounds to whole rupees, which
 *  would show the Rs 1.50 price as "₹2"; this keeps the paise when there are any. */
export function formatPaise(paise) {
  const p = int(paise);
  const whole = p % 100 === 0;
  return `₹${(p / 100).toLocaleString('en-IN', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}`;
}

/** One ledger row as the shop reads it. */
export function ledgerLabel(row, pricePaise = MESSAGE_PRICE_PAISE) {
  const amount = int(row?.amount_paise);
  const n = Math.round(Math.abs(amount) / (int(pricePaise) || MESSAGE_PRICE_PAISE));
  const msgs = `${n.toLocaleString('en-IN')} ${n === 1 ? 'message' : 'messages'}`;
  switch (row?.kind) {
    case 'topup':  return { sign: '+', text: `${msgs} added`, tone: 'credit' };
    case 'refund': return { sign: '+', text: `${msgs} refunded (not sent)`, tone: 'credit' };
    case 'debit':  return { sign: '−', text: row?.note || `${msgs} sent`, tone: 'debit' };
    case 'adjust': return { sign: amount >= 0 ? '+' : '−', text: row?.note || 'Adjustment by PocketLink', tone: amount >= 0 ? 'credit' : 'debit' };
    default:       return { sign: '', text: row?.note || '', tone: 'debit' };
  }
}

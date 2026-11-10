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

/** PocketLink Coins: how the wallet is shown. 1 Coin = 50 paise, so a shipping
 *  update is 1 Coin and a Rs 1.50 message is 3 -- never a fraction. */
export const COIN_PAISE = 50;

/** The packs a shop can buy. Same as PACKS (and BONUS_PAISE) in
 *  supabase/functions/wallet-topup. `messages` is the pack's id there. */
export const WALLET_PACKS = Object.freeze([
  Object.freeze({ messages: 100,  amountPaise: 15000,  bonusPaise: 0 }),
  Object.freeze({ messages: 500,  amountPaise: 75000,  bonusPaise: 3750 }),
  Object.freeze({ messages: 1000, amountPaise: 150000, bonusPaise: 15000 }),
]);

const int = (v) => { const n = Math.trunc(Number(v)); return Number.isFinite(n) ? n : 0; };

/** Whole Coins in a paise amount (rounded down; never negative). */
export function coinsOf(paise) {
  const p = int(paise);
  return p > 0 ? Math.floor(p / COIN_PAISE) : 0;
}

/** 1 → "1 Coin", 1575 → "1,575 Coins". */
export function formatCoins(n) {
  const c = Math.max(0, int(n));
  return `${c.toLocaleString('en-IN')} ${c === 1 ? 'Coin' : 'Coins'}`;
}

/** A pack as the shop sees it: { coins, bonus, total, price }. */
export function packCoins(p) {
  const coins = coinsOf(p?.amountPaise);
  const bonus = coinsOf(p?.bonusPaise);
  return { coins, bonus, total: coins + bonus, price: formatPaise(p?.amountPaise) };
}

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

/** One ledger row as the shop reads it, in Coins: { sign, coins, text, tone }. */
export function ledgerLabel(row) {
  const amount = int(row?.amount_paise);
  const coins = coinsOf(Math.abs(amount));
  switch (row?.kind) {
    case 'topup':  return { sign: '+', coins, text: `Added${/₹\d/.test(row?.note || '') ? ` · ${row.note}` : ''}`, tone: 'credit' };
    case 'refund': return { sign: '+', coins, text: 'Given back · message not sent', tone: 'credit' };
    case 'debit':  return { sign: '−', coins, text: row?.note || 'Message sent', tone: 'debit' };
    case 'adjust': return { sign: amount >= 0 ? '+' : '−', coins, text: row?.note || 'Adjustment by PocketLink', tone: amount >= 0 ? 'credit' : 'debit' };
    default:       return { sign: '', coins, text: row?.note || '', tone: 'debit' };
  }
}

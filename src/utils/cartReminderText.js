/**
 * The cart reminder exactly as the customer reads it on WhatsApp, in English or
 * मराठी. PURE (tested).
 *
 * The words live in the approved WhatsApp templates; the database fills the same
 * five values for both (cart_reminder_claim, supabase/cart-reminder-lang-forward.sql):
 *   {{1}} first name   {{2}} first item (+ N more)   {{3}} shop   {{4}} total
 *   {{5}} the cart link (the button)
 * This file rebuilds the message from a cart so the shop can see what went out.
 */

export const CART_REMINDER_LANGS = Object.freeze([
  { code: 'en', label: 'English' },
  { code: 'mr', label: 'मराठी' },
]);

const BUTTONS = {
  en: ['Complete my order', 'Stop offers'],
  mr: ['माझी ऑर्डर पूर्ण करा', 'ऑफर थांबवा'],
};

// The total as the template gets it: whole rupees with no commas ("1500"), else two decimals.
function totalText(total) {
  const n = Number(total);
  if (!Number.isFinite(n)) return '0';
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/** { text, buttons } for one cart, in `lang` ('en' | 'mr'; anything else is English). */
export function cartReminderMessage(lang, cart = {}, storeName = '') {
  const mr = lang === 'mr';
  const items = Array.isArray(cart.items) ? cart.items : [];
  const first = String(items[0]?.name || '').trim() || (mr ? 'तुमच्या वस्तू' : 'your items');
  const more = items.length > 1 ? (mr ? ` + आणखी ${items.length - 1} वस्तू` : ` + ${items.length - 1} more`) : '';
  const name = String(cart.customer_name || '').trim().split(/\s+/)[0] || (mr ? 'ग्राहक' : 'there');
  const shop = String(storeName || '').trim() || (mr ? 'आमचे दुकान' : 'our shop');
  const total = totalText(cart.total);
  const text = mr
    // The blanks in template order ({{1}} name, {{2}} items, {{3}} shop, {{4}} total).
    ? `नमस्कार ${name}, तुम्ही कार्टमध्ये ठेवलेले ${first}${more} अजून ${shop} वर तुमची वाट पाहत आहे (₹${total}). 🛒\nतुमच्या वस्तू सेव्ह आहेत, एका मिनिटात ऑर्डर पूर्ण करण्यासाठी खालील बटण दाबा.`
    : `Hi ${name}, you left ${first}${more} in your cart at ${shop} (₹${total}). Your items are still saved — tap below to finish your order in under a minute.`;
  return { text, buttons: BUTTONS[mr ? 'mr' : 'en'] };
}

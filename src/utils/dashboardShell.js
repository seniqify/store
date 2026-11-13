// The frame around a shop's dashboard (Manage): the dark side menu on a computer,
// the top bar with search and the bell, and the phone's "More" screen.
// Redesigned 2026-11-13 from the approved prototype. PURE: no React, no network.

import { pinColors } from './pinGate.js';

/** Side-menu groups. Only tabs the shop actually has are shown. */
export const NAV_GROUPS = [
  { title: 'Run',        keys: ['home', 'orders', 'payments', 'products', 'delivery'] },
  { title: 'Grow',       keys: ['whatsapp', 'customers', 'reviews', 'offers', 'ads', 'abandoned'] },
  { title: 'Understand', keys: ['analytics', 'insights', 'assistant'] },
  { title: 'Set up',     keys: ['settings'] },
];

/** The groups with the tabs this shop has, empty groups dropped. */
export function navGroups(tabs = []) {
  const byKey = new Map(tabs.map((t) => [t.key, t]));
  return NAV_GROUPS
    .map((g) => ({ title: g.title, items: g.keys.map((k) => byKey.get(k)).filter(Boolean) }))
    .filter((g) => g.items.length > 0);
}

/**
 * Colours for the dark side menu: a near-black green with a soft glow of the
 * shop colour in the top corner, the same look as the PIN screen.
 *   accent -- the shop colour (active icon, glow)
 *   button -- the shop colour 20% darker, readable under white text
 */
export function shellColors(themeColor) {
  const { accent, button, ring } = pinColors(themeColor);
  return {
    accent, button, ring,
    tint: `${accent}17`,
    // A very dark shop colour would vanish on the dark menu; use white then.
    activeIcon: contrast(accent, SIDEBAR_BG) >= 3 ? accent : '#ffffff',
    sidebarBg: SIDEBAR_BG,
    sidebarGlow: `radial-gradient(circle at 100% 0%, ${accent}38, transparent 42%), radial-gradient(circle at 0% 100%, rgba(20,184,166,0.12), transparent 45%)`,
  };
}

const SIDEBAR_BG = '#061310';

/** WCAG contrast ratio between two #rrggbb colours. */
export function contrast(a, b) {
  const lum = (hex) => {
    const n = parseInt(String(hex).slice(1), 16);
    const lin = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The line under the plan name in the side menu. For a paying shop the date is
 * when the plan runs out if no renewal lands (planExpiresAt), so it says
 * "Active till", not "Renews on": the renewal charge happens a little before.
 */
export function planLine({ plan, isPaying, onTrial, daysLeft, planExpiresAt, lapsed } = {}) {
  if (!plan || plan === 'free' || lapsed) return 'See plans';
  if (onTrial && daysLeft != null) return `Free trial · ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left`;
  if (isPaying && planExpiresAt) {
    const d = new Date(planExpiresAt);
    if (!Number.isNaN(d.getTime())) {
      return 'Active till ' + d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
    }
  }
  return 'Active';
}

// Other words a shopkeeper might type for a section.
const SECTION_WORDS = {
  payments: ['money', 'razorpay', 'payment link', 'hisaab', 'payout', 'cod'],
  delivery: ['courier', 'shipping', 'shadowfax', 'delhivery', 'parcel', 'awb', 'rto'],
  whatsapp: ['coins', 'message', 'wallet'],
  abandoned: ['cart', 'reminder'],
  analytics: ['stats', 'sales', 'report', 'profit', 'visits'],
  insights: ['ai', 'ideas', 'bot'],
  offers: ['coupon', 'discount', 'code'],
  ads: ['facebook', 'instagram', 'boost', 'meta'],
  settings: ['pin', 'address', 'theme', 'colour', 'color', 'plan', 'domain', 'logo', 'upi'],
  products: ['stock', 'price', 'menu', 'item', 'category'],
};

/**
 * What the dashboard search box offers for `query`:
 *   sections -- dashboard sections whose name matches ("deliv" -> Delivery)
 *   products -- up to `limit` of the shop's products whose name matches
 *   find     -- the text to hand to the Orders / Customers search, or '' when
 *               there is nothing to look for
 */
export function searchSuggestions(query, { tabs = [], products = [], limit = 4 } = {}) {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return { sections: [], products: [], find: '' };
  const sections = tabs
    .filter((t) => String(t.label || '').toLowerCase().includes(q) || (SECTION_WORDS[t.key] || []).some((w) => w.startsWith(q)))
    .slice(0, 3);
  const found = (Array.isArray(products) ? products : [])
    .filter((p) => p && String(p.name || '').toLowerCase().includes(q))
    .slice(0, limit);
  return { sections, products: found, find: String(query).trim() };
}

const SUBTITLES = {
  orders: 'Accept, ship and track every order',
  payments: 'Online payments, cash on delivery and payment links',
  products: 'What buyers see on your page',
  delivery: 'Book couriers and track every parcel',
  whatsapp: 'Coins and automatic messages',
  customers: 'Everyone who bought from you',
  reviews: 'What buyers say about you',
  offers: 'Coupon codes for your buyers',
  ads: 'Facebook and Instagram',
  abandoned: 'Added to cart but did not buy',
  analytics: 'Sales, profit and visits',
  insights: 'Ideas from your own shop data',
  assistant: 'Ask anything about your shop',
  settings: 'Shop details, delivery, payments and plan',
};

/** The grey line under a section's name in the computer's top bar. */
export function sectionSubtitle(key, { isService = false, now = Date.now() } = {}) {
  if (key === 'home') return todayLine(now);
  if (key === 'orders' && isService) return 'Reply to every enquiry';
  return SUBTITLES[key] || '';
}

/** Today in the shop's own time zone, e.g. "Friday, 13 November". */
export function todayLine(now = Date.now()) {
  return new Date(now).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' });
}

/** A bell entry for an order that just arrived (from the new-order poll). */
export function arrivalText({ name, total, count } = {}, formatMoney = (n) => `₹${n}`) {
  const who = String(name || '').trim() || 'a customer';
  const money = Number(total) > 0 ? ` · ${formatMoney(Number(total))}` : '';
  return Number(count) > 1 ? `${count} new orders, latest from ${who}${money}` : `New order from ${who}${money}`;
}

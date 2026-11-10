// What the one PocketLink plan includes, in words: shared by /plans and the
// landing page (/sell) so the two never describe different products. Only
// features that are live go here. PURE.
import { PRICE } from './planLimits.js';
import { WALLET_PACKS, packCoins } from './walletPacks.js';

const inr = (n) => `₹${Number(n).toLocaleString('en-IN')}`;

export const YEARLY_SAVING = PRICE.monthly * 12 - PRICE.yearly;          // ₹2,989
export const YEARLY_PER_MONTH = Math.round(PRICE.yearly / 12);           // ₹1,250
export const FREE_ORDER_MESSAGES = 500;                                  // order_message_free_limit()

// Every feature, grouped the way a shop owner thinks about the day.
export const FEATURE_GROUPS = [
  {
    key: 'shop', title: 'Your online shop',
    points: [
      'Unlimited products and categories, with sizes, colours and stock counts',
      'Your own link and QR code, built for phones; buyers need no app',
      'Verified badge, no PocketLink branding, optional Premium Dark look',
      'Made for shops, restaurants and service businesses',
    ],
  },
  {
    key: 'orders', title: 'Orders and payments',
    points: [
      'Every order in your dashboard with a new-order alert, and on WhatsApp',
      'Online payments into your own Razorpay, plus UPI and cash on delivery',
      'Payment links, coupons, offers and a cash-on-delivery fee',
      'Hisaab: sales statements in PDF and Excel, and your expenses',
    ],
  },
  {
    key: 'delivery', title: 'Delivery',
    points: [
      'Delhivery and Shadowfax built in: pick the courier for each order, or your own delivery boy',
      'Live tracking on a page with your shop’s name and logo',
      'RTO protection flags risky cash-on-delivery orders before you ship',
      'COD money: see what each courier still owes you',
    ],
  },
  {
    key: 'whatsapp', title: 'WhatsApp on autopilot',
    points: [
      `${FREE_ORDER_MESSAGES} free order confirmations every month (“Confirm my order”)`,
      'Shipping updates: shipped, out for delivery, delivery failed, delivered',
      'Abandoned-cart reminders and offers to your customers',
    ],
  },
  {
    key: 'grow', title: 'Grow',
    points: [
      'Facebook and Instagram ads built and measured for you; nothing spends until you approve',
      'Verified customer reviews, bestseller and “N sold” badges',
      'Your customer list with export, and a listing on the PocketLink Marketplace',
    ],
  },
  {
    key: 'numbers', title: 'Know your numbers',
    points: [
      'Real profit per order and product, after product cost, packaging, courier and ads',
      'Stats, AI business insights and an AI assistant',
    ],
  },
  {
    key: 'always', title: 'Always included',
    points: [
      '0% commission: payments land in your own account',
      'Priority support, and every new feature at no extra cost',
    ],
  },
];

// The short list on the plan card.
export const CARD_FEATURES = [
  'Unlimited products, your own link and QR code',
  'Online payments, UPI and cash on delivery',
  'Delhivery and Shadowfax, with live tracking',
  `${FREE_ORDER_MESSAGES} free WhatsApp order confirmations every month`,
  'Facebook and Instagram ads, real profit and AI insights',
  'Priority support and every new feature',
];

// WhatsApp Coins (1 Coin = Rs 0.50), from the wallet's own numbers.
export const COIN_PRICES = [
  { what: `Order confirmation, after the ${FREE_ORDER_MESSAGES} free each month`, coins: 1 },
  { what: 'Shipping update (shipped, out for delivery, failed, delivered)', coins: 1 },
  { what: 'Cart reminder or offer to a customer', coins: 3 },
];
export const COIN_PACKS = WALLET_PACKS.map(packCoins);

export const PRICING_FAQS = [
  {
    q: 'How much does PocketLink cost?',
    a: `One plan with every feature: ${inr(PRICE.monthly)} a month, or ${inr(PRICE.yearly)} a year (${inr(YEARLY_PER_MONTH)} a month, two months free). Prices include GST. No setup fee, no contract, cancel anytime.`,
  },
  {
    q: 'Are there different plans or tiers?',
    a: 'No. There is one plan and it includes everything: unlimited products, online payments, Delhivery and Shadowfax, WhatsApp automation, Facebook and Instagram ads, profit tracking, AI insights and priority support.',
  },
  {
    q: 'What are Coins?',
    a: `Coins pay for WhatsApp messages PocketLink sends for you. 1 Coin = ₹0.50. Your plan includes ${FREE_ORDER_MESSAGES} free order confirmations every month; after that an order confirmation or a shipping update is 1 Coin, and a cart reminder or offer is 3 Coins. Add Coins from ${COIN_PACKS[0].price} in the WhatsApp tab. Coins never expire, and a message that can’t be sent gives its Coins back.`,
  },
  {
    q: 'Do you take a commission on my sales?',
    a: 'Never. 0% commission: online payments go straight into your own Razorpay account, and cash on delivery is yours.',
  },
  {
    q: 'Is paying yearly cheaper?',
    a: `Yes: ${inr(PRICE.yearly)} a year instead of ${inr(PRICE.monthly * 12)}, so you save ${inr(YEARLY_SAVING)}, about two months free. Yearly renews automatically so your shop never lapses.`,
  },
  {
    q: 'I already pay for PocketLink. Does my price change?',
    a: 'No. Your current subscription keeps its price for as long as it stays active. The new price is for new subscriptions.',
  },
  {
    q: 'What is the Featured Store add-on?',
    a: 'An optional ₹299 a month boost that lifts your shop inside the PocketLink Marketplace: a featured badge, priority listing and festival promotions.',
  },
  {
    q: 'Can I cancel anytime?',
    a: 'Anytime, with no lock-in. Your page stays online; only the paid features stop.',
  },
  {
    q: 'How do I pay, and how soon does it start?',
    a: 'By UPI, card or net banking through Razorpay, with a GST invoice for every payment. Your plan starts the moment the payment succeeds.',
  },
];

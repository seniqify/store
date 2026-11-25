// FAQ for the sales team: what customers ask (facts kept in line with
// pricingCopy.js / planLimits.js) and the team's own doubts. Answers only a
// manager can give (trial, discount, cash, incentive) come from team settings.
import { PRICE } from '../utils/planLimits.js';

const inr = (n) => `₹${Number(n).toLocaleString('en-IN')}`;

export const CUSTOMER_CATS = Object.freeze([['all', 'All'], ['price', 'Price and plan'], ['shop', 'Shop and orders'], ['pay', 'Payments and delivery'], ['grow', 'Grow']]);
export const TEAM_CATS = Object.freeze([['all', 'All'], ['crm', 'Using the CRM'], ['score', 'Score and incentive'], ['rules', 'Rules'], ['team', 'From the team']]);

// [category, question, answer]; a `policy` key means the manager fills the answer.
export const CUSTOMER_FAQ = Object.freeze([
  ['price', 'How much does PocketLink cost?', `One plan with every feature: ${inr(PRICE.monthly)} a month, or ${inr(PRICE.yearly)} a year (${inr(Math.round(PRICE.yearly / 12))} a month, two months free). Prices include GST. No setup fee, no contract, cancel anytime.`],
  ['price', 'Are there different plans or tiers?', 'No. There is one plan and it includes everything: unlimited products, online payments, Delhivery and Shadowfax, WhatsApp automation, Facebook and Instagram ads, profit tracking, AI insights and priority support.'],
  ['price', 'Do you take a commission on my sales?', 'Never. 0% commission: online payments go straight into the shop’s own Razorpay account, and cash on delivery is theirs.'],
  ['price', 'Can I cancel anytime?', 'Anytime, with no lock-in. The page stays online; only the paid features stop.'],
  ['price', 'How do I pay, and how soon does it start?', 'By UPI, card or net banking through Razorpay, with a GST invoice for every payment. The plan starts the moment the payment succeeds.'],
  ['price', 'What are Coins?', 'Coins pay for WhatsApp messages PocketLink sends for the shop. 1 Coin = ₹0.50. The plan includes 500 free order confirmations every month; after that an order confirmation or shipping update is 1 Coin, and a cart reminder or offer is 3 Coins. Coins never expire, and a message that can’t be sent gives its Coins back.'],
  ['price', 'Is there a free trial or an offer?', null, 'trial'],
  ['shop', 'Do my customers need to download an app?', 'No app needed. The shop page opens in any browser, and customers place orders through WhatsApp, which they already have.'],
  ['shop', 'How do I receive orders?', 'Every order lands in the dashboard with a new-order alert, and on WhatsApp. Cash-on-delivery buyers get a “Confirm my order” message automatically (500 free every month), so fake orders show up before the shop ships.'],
  ['shop', 'How many products can I add?', 'Unlimited products and categories, with sizes, colours and stock counts.'],
  ['shop', 'Will my page show PocketLink branding?', 'No. The page carries the shop’s own brand with a verified badge and no PocketLink branding.'],
  ['pay', 'Can I accept online payments?', 'Yes. The shop connects its own Razorpay and customers pay by UPI, card or net banking; the money goes straight to the shop’s account. UPI to their number and cash on delivery work too.'],
  ['pay', 'Do you deliver across India?', 'Yes. Delhivery and Shadowfax are built in: pick the courier for each order, print the label, and the customer tracks it live on a page with the shop’s name. The shop’s own delivery boy works too.'],
  ['pay', 'What if a cash-on-delivery buyer refuses the parcel?', 'The “Confirm my order” message catches fake orders before the shop ships, and the COD money page shows what each courier still owes.'],
  ['grow', 'Can you run Facebook and Instagram ads for me?', 'Yes. Ads are built and measured inside PocketLink, and nothing spends until the shop approves.'],
  ['grow', 'Can I see my real profit?', 'Yes. Real profit per order and product, after product cost, packaging, courier and ads, plus sales statements in PDF and Excel.'],
]);

export const TEAM_FAQ = Object.freeze([
  ['crm', 'How do I log a call?', 'In Call queue, call the lead, then tap how it went and save. Every call needs an outcome, or it does not count.'],
  ['crm', 'My location is not found at check-in.', 'Turn on Location (GPS) on the phone and allow it for crm.pocketlink.store when the browser asks. Step outside the shop and press Try again; wait until it says “accurate to” under 50 m. A visit cannot be saved without a location, so if it still fails, tell your manager.'],
  ['crm', 'The shop I met belongs to another person’s list.', 'Do not call them yourself. Ask your manager (below) to move the lead to you.'],
  ['crm', 'Where are example shops to show customers?', 'Scripts → By type of business: live examples for clothing (pocketlink.store/demo/aanyaboutique) and salons and services (pocketlink.store/demo/glowup). For other types, show the clothing example, or make their shop together during the demo.'],
  ['crm', 'How do I change my password?', 'Tap your name (top right on the phone, bottom left on a computer) → My account → Change my password.'],
  ['score', 'How is my score calculated?', '5 areas: Activity 20%, Reach 15%, Conversion 30%, Revenue 25%, Discipline 10%. Each KPI is your actual against your target, up to 100%; monthly targets are counted by today. See My score for your numbers.'],
  ['score', 'When is my incentive paid?', null, 'incentive'],
  ['rules', 'A customer asks for a discount.', null, 'discount'],
  ['rules', 'A customer wants to pay me in cash.', null, 'cash'],
]);

export const POLICY_LABELS = Object.freeze({
  trial: 'Free trial or offer the team may give',
  incentive: 'Incentive rule and pay date',
  discount: 'What the team may offer as a discount',
  cash: 'Rule for cash payments',
});
export const POLICY_HINTS = Object.freeze({
  discount: `Never promise a price that is not on pocketlink.store/plans (${inr(PRICE.monthly)} a month, ${inr(PRICE.yearly)} a year).`,
  cash: 'Never take cash. The shop pays at pocketlink.store/plans by UPI, card or net banking, and gets a GST invoice.',
});

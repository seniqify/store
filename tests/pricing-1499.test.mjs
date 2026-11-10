// 2026-11 pricing: Rs 1,499 a month, Rs 14,999 a year (GST-inclusive), one
// plan, every feature, plus WhatsApp Coins. The amount debited is the Razorpay
// plan_id's (create-razorpay-subscription), so the display and the plan ids
// are checked together.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PRICE } from '../src/utils/planLimits.js';
import { YEARLY_SAVING, YEARLY_PER_MONTH, FREE_ORDER_MESSAGES, PRICING_FAQS, COIN_PACKS, FEATURE_GROUPS } from '../src/utils/pricingCopy.js';
import { PLAN_BY_ID } from '../shared/razorpay-plans.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(`${ROOT}${p}`, 'utf8').replace(/\r\n/g, '\n');

test('the price is Rs 1,499 a month and Rs 14,999 a year', () => {
  assert.deepEqual({ m: PRICE.monthly, y: PRICE.yearly }, { m: 1499, y: 14999 });
  assert.equal(YEARLY_SAVING, 2989);
  assert.equal(YEARLY_PER_MONTH, 1250);
  assert.equal(FREE_ORDER_MESSAGES, 500, 'the same 500 as order_message_free_limit()');
  assert.match(read('supabase/whatsapp-coins-forward.sql'), /as \$function\$ select 500 \$function\$/);
});

test('no page shows the old price; they all read PRICE', () => {
  for (const f of ['src/pages/Plans.jsx', 'src/pages/Landing.jsx', 'src/pages/Checkout.jsx', 'src/pages/SalesHub.jsx',
    'src/components/manage/AbandonedTab.jsx', 'src/utils/pricingCopy.js']) {
    const src = read(f);
    assert.equal(/1,099|9,999|\b1099\b|\b9999\b/.test(src), false, `${f} still shows the old price`);
  }
  assert.match(read('src/pages/Landing.jsx'), /price: PRICE\.monthly\.toLocaleString\('en-IN'\)/);
});

test('the copy tells the truth about messages and GST', () => {
  const all = PRICING_FAQS.map((f) => `${f.q} ${f.a}`).join('\n');
  assert.match(all, /What are Coins\?/);
  assert.match(all, /1 Coin = ₹0\.50/);
  assert.match(all, /500 free order confirmations every month/);
  assert.match(all, /Prices include GST/);
  assert.equal(/per message\?[^\n]*Never/i.test(all), false, 'messages are no longer free without limit');
  assert.ok(!read('src/pages/Plans.jsx').includes('exclusive of GST'), 'the charged amount includes GST');
  assert.deepEqual(COIN_PACKS.map((p) => [p.price, p.total]), [['₹150', 300], ['₹750', 1575], ['₹1,500', 3300]]);
  assert.ok(FEATURE_GROUPS.every((g) => g.points.length > 0));
});

test('the subscription function charges a plan that is mapped back to premium', () => {
  const fn = read('supabase/functions/create-razorpay-subscription/index.ts');
  const block = fn.slice(fn.indexOf('premium: {'), fn.indexOf('},', fn.indexOf('premium: {')));
  const monthly = block.match(/monthly: '([^']+)'/)[1];
  const yearly = block.match(/yearly:\s+'([^']+)'/)[1];
  assert.ok(/^plan_[A-Za-z0-9]+$/.test(monthly) && /^plan_[A-Za-z0-9]+$/.test(yearly), 'real Razorpay plan ids, not placeholders');
  // New subscriptions must be charged the NEW amount (the display says Rs 1,499).
  assert.notEqual(monthly, 'plan_TX4Yj0ktnJ9Ic3', 'still the Rs 1,099 monthly plan');
  assert.notEqual(yearly, 'plan_TX4a4orxglrlrC', 'still the Rs 9,999 yearly plan');
  assert.deepEqual(PLAN_BY_ID[monthly], { plan: 'premium', period: 'monthly' });
  assert.deepEqual(PLAN_BY_ID[yearly], { plan: 'premium', period: 'yearly' });
  // The old Rs 1,099 / 9,999 plans stay mapped: their mandates keep renewing.
  assert.deepEqual(PLAN_BY_ID.plan_TX4Yj0ktnJ9Ic3, { plan: 'premium', period: 'monthly' });
  assert.deepEqual(PLAN_BY_ID.plan_TX4a4orxglrlrC, { plan: 'premium', period: 'yearly' });
});

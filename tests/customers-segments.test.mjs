// Customer segments (src/utils/customers.js), especially "Big spender".
//
// 2026-10-04, krupaagarbattiwork: Customers showed "Big spender (265)" of 312,
// labelled "Top 20% by spend". Most customers bought one ₹290 combo once, so the
// 80th percentile was ₹290 itself and `spend >= p80` matched nearly everyone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCustomers } from '../src/utils/customers.js';

const NOW = Date.parse('2026-10-04T06:00:00Z');
let n = 0;
const order = (phone, total, over = {}) => ({
  id: `o-${++n}`, customer_phone: phone, customer_name: `C${phone.slice(-3)}`,
  total, status: 'confirmed', created_at: '2026-10-01T06:00:00Z', items: [], ...over,
});
const phone = (i) => String(9000000000 + i);
const big = (customers) => customers.filter((c) => c.segments.includes('bigspender')).map((c) => c.phone).sort();

test('the krupaagarbattiwork case: one common amount no longer makes everyone a big spender', () => {
  const rows = [];
  for (let i = 0; i < 265; i++) rows.push(order(phone(i), 290));                   // the ₹290 combo, once
  for (let i = 265; i < 300; i++) rows.push(order(phone(i), 150));
  for (let i = 300; i < 312; i++) { rows.push(order(phone(i), 290)); rows.push(order(phone(i), 290)); }  // came back
  const customers = buildCustomers(rows, NOW);
  assert.equal(customers.length, 312);
  assert.deepEqual(big(customers), Array.from({ length: 12 }, (_, k) => phone(300 + k)).sort(),
    'only the twelve who spent more than the common ₹290');
});

test('distinct spends: still the top 20%', () => {
  const rows = [];
  for (let i = 1; i <= 10; i++) rows.push(order(phone(i), i * 100));
  assert.deepEqual(big(buildCustomers(rows, NOW)), [phone(9), phone(10)]);
});

test('everyone spent the same: nobody stands out', () => {
  const rows = [];
  for (let i = 0; i < 20; i++) rows.push(order(phone(i), 290));
  assert.deepEqual(big(buildCustomers(rows, NOW)), []);
});

test('fewer than three paying customers: no big spenders yet', () => {
  assert.deepEqual(big(buildCustomers([order(phone(1), 100), order(phone(2), 5000)], NOW)), []);
});

test('cancelled orders add no spend', () => {
  const rows = [];
  for (let i = 1; i <= 9; i++) rows.push(order(phone(i), 100));
  rows.push(order(phone(10), 9000, { status: 'cancelled' }));
  rows.push(order(phone(11), 400));
  assert.deepEqual(big(buildCustomers(rows, NOW)), [phone(11)]);
});

test('the other segments are unchanged', () => {
  const rows = [
    order(phone(1), 100), order(phone(1), 100), order(phone(1), 100),                // loyal
    order(phone(2), 100, { created_at: '2026-08-01T06:00:00Z' }),                    // new + win-back
  ];
  const [a, b] = [phone(1), phone(2)].map((p) => buildCustomers(rows, NOW).find((c) => c.phone === p));
  assert.ok(a.segments.includes('loyal'));
  assert.deepEqual(b.segments.filter((s) => s !== 'bigspender'), ['new', 'winback']);
});

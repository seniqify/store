// Manage → Payments: the OPERATIONAL lists.
//
// This file used to test the money maths — paymentKind, isReturned and
// buildPayments, including the `paid_at || delivered_at || created_at` fallback.
// Commerce-metrics PR 7 moved every total onto the canonical model
// (tests/commerce-payments.test.mjs) and deleted that maths, so what is tested
// here now is what is left: the two worklists that need detailed rows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  buildPaymentsLists, collectedChannel, isAtDetailedCap,
  KIND_LABEL, DETAILED_ORDER_CAP,
} from '../src/utils/paymentsLedger.js';
import { periodKeys } from '../src/utils/paymentsMetrics.js';

const SRC = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const code = (p) => SRC(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const NOW = Date.parse('2026-09-20T06:30:00Z');   // 12:00 IST
const TODAY = periodKeys(NOW, 1);
const WEEK = periodKeys(NOW, 7);

const row = (over = {}) => ({
  id: over.id ?? `x-${Math.random().toString(36).slice(2)}`,
  created_at: '2026-09-19T10:00:00.000Z',
  status: 'new',
  payment_method: 'cod',
  total: 100,
  paid: false,
  paid_at: null,
  paid_via: null,
  payment_ref: null,
  payment_link_id: null,
  awb: null,
  shipment_status: null,
  shipment_outcome: null,
  ...over,
});

// ── the worklist ────────────────────────────────────────────────────────────

test('needs attention holds only what the system cannot finish', () => {
  const { attention } = buildPaymentsLists([
    row({ id: 'link', total: 400, payment_link_id: 'plink_1' }),
    row({ id: 'inc', total: 300, payment_method: 'online' }),
    row({ id: 'nc', total: 200, awb: 'A2', shipment_status: 'Not Contactable' }),
    row({ id: 'transit', total: 100, awb: 'A3', shipment_status: 'Out For Delivery' }),
    row({ id: 'collected', total: 100, paid: true, paid_via: 'cod_delivery', status: 'delivered' }),
  ], { periodKeys: TODAY });
  const reasons = Object.fromEntries(attention.map((a) => [a.order.id, a.reason]));
  assert.deepEqual(reasons, { link: 'link_pending', inc: 'incomplete', nc: 'delivery_issue' });
  assert.equal(attention.some((a) => a.reason === 'cod_delivered'), false, 'nothing to mark by hand');
});

test('one order occupies ONE attention row, never two', () => {
  // Before PR 7 a delivery problem and a pending payment link were pushed
  // independently, so this order appeared twice in the worklist.
  const both = row({ id: 'dup', total: 500, awb: 'A9', shipment_status: 'Not Contactable', payment_link_id: 'plink_9' });
  const { attention } = buildPaymentsLists([both], { periodKeys: TODAY });
  assert.equal(attention.length, 1, 'one row');
  assert.equal(attention[0].reason, 'delivery_issue', 'the first applicable reason wins');
  assert.equal(new Set(attention.map((a) => a.order.id)).size, attention.length, 'ids are unique');
});

test('cancelled and abandoned rows never reach either list', () => {
  const { attention, recent } = buildPaymentsLists([
    row({ id: 'c', status: 'cancelled', payment_link_id: 'p1' }),
    row({ id: 'a', status: 'abandoned', payment_link_id: 'p2' }),
    row({ id: 'cp', status: 'cancelled', paid: true, paid_at: '2026-09-20T05:00:00.000Z' }),
  ], { periodKeys: TODAY });
  assert.deepEqual(attention, []);
  assert.deepEqual(recent, []);
});

// ── the payments list ───────────────────────────────────────────────────────

test('a payment is listed only when its date is actually known', () => {
  const { recent } = buildPaymentsLists([
    row({ id: 'dated', total: 500, paid: true, paid_at: '2026-09-20T05:00:00.000Z', paid_via: 'cod_delivery' }),
    row({ id: 'undated', total: 900, paid: true, paid_at: null, paid_via: 'cod_delivery' }),
  ], { periodKeys: TODAY });
  assert.deepEqual(recent.map((r) => r.order.id), ['dated'],
    'money with no payment date belongs to no period');
});

test('the payments list is dated by paid_at and nothing else', () => {
  // created_at and delivered_at are both inside today; paid_at is not.
  const { recent } = buildPaymentsLists([
    row({ id: 'old', total: 700, paid: true, paid_via: 'cod_delivery',
          paid_at: '2026-01-05T05:00:00.000Z',
          created_at: '2026-09-20T04:00:00.000Z', delivered_at: '2026-09-20T05:00:00.000Z' }),
  ], { periodKeys: TODAY });
  assert.deepEqual(recent, [], 'the old fallback would have listed it today');
});

test('payments are newest first and capped at 50', () => {
  const rows = [];
  for (let i = 0; i < 60; i++) {
    rows.push(row({ id: `p-${i}`, paid: true, paid_via: 'cod_delivery',
      paid_at: new Date(NOW - i * 60000).toISOString() }));
  }
  const { recent } = buildPaymentsLists(rows, { periodKeys: WEEK });
  assert.equal(recent.length, 50);
  assert.equal(recent[0].order.id, 'p-0', 'newest first');
  for (let i = 1; i < recent.length; i++) assert.ok(recent[i - 1].at >= recent[i].at);
});

// ── how money arrived ───────────────────────────────────────────────────────

test('the channel comes from paid_via, not from what the customer chose', () => {
  assert.equal(collectedChannel({ paid_via: 'cod_delivery' }), 'cod_collected');
  assert.equal(collectedChannel({ paid_via: 'razorpay' }), 'online');
  assert.equal(collectedChannel({ paid_via: 'payment_link' }), 'link');
  // The case that used to be mislabelled: chose "online", no record of payment.
  assert.equal(collectedChannel({ payment_method: 'online', payment_ref: 'pay_1' }), 'marked',
    'payment_method is a choice, not a receipt');
  // A COD order marked paid with no paid_via: the shopkeeper took the cash.
  assert.equal(collectedChannel({ payment_method: 'cod' }), 'cod_collected');
  assert.equal(collectedChannel({ payment_method: 'upi' }), 'marked');
  assert.equal(collectedChannel({}), 'marked');
});

test('every channel has a label', () => {
  for (const k of ['online', 'link', 'cod_collected', 'marked']) {
    assert.ok(KIND_LABEL[k], `missing label for ${k}`);
  }
});

// ── the cap ─────────────────────────────────────────────────────────────────

test('the list cap is the backend contract, and is only claimed when reached', () => {
  assert.equal(DETAILED_ORDER_CAP, 500);
  assert.equal(isAtDetailedCap(500), true);
  assert.equal(isAtDetailedCap(499), false);
  assert.equal(isAtDetailedCap(447), false);
});

// ── no accounting lives here any more ───────────────────────────────────────

test('the ledger computes no money total at all', () => {
  const src = code('../src/utils/paymentsLedger.js');
  // Matched precisely: buildPaymentsLists legitimately contains "buildPayments".
  for (const gone of [/\bbuildPayments\s*\(/, /\bpaymentKind\b/, /\bisReturned\b/,
                      /\bcodDue\b/, /delivered_at\s*\|\|/, /created_at\s*\|\|/]) {
    assert.ok(!gone.test(src), `paymentsLedger must no longer contain ${gone}`);
  }
  // No summation of any kind.
  assert.ok(!/\+=\s*(total|amount)/.test(src), 'nothing is accumulated here');
  assert.ok(!/reduce\(/.test(src), 'and nothing is reduced');
});

test('the ledger reuses canonical classification rather than its own', () => {
  const src = code('../src/utils/paymentsLedger.js');
  assert.match(src, /from '\.\/commerceMetrics\.js'/);
  assert.ok(!/rto|rts|shipment_outcome\s*===/.test(src), 'no private return matching');
  assert.ok(!/status\s*===\s*'cancelled'/.test(src), 'no private cancelled test');
});

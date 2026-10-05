// The buyer's order page as a TRACKER (src/utils/orderTimeline.js): the whole
// journey, steps still to come in grey, the current one marked -- for courier
// orders and for shops delivering themselves (their Orders card now moves the
// order: Send to delivery boy -> Out for delivery, then Delivered).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildTimeline } from '../src/utils/orderTimeline.js';

const order = (over = {}) => ({
  ref: '8C56C', status: 'new', paymentMethod: 'cod', paid: false, total: 500,
  placedAt: '2026-10-05T04:58:00Z', confirmedAt: null, awb: null, courier: null, shipmentStatus: null, ...over,
});
const view = (o) => {
  const t = buildTimeline(o);
  return { hero: t.hero.title, steps: t.steps.map((s) => `${s.key}:${s.state}`).join(' '), note: Boolean(t.note) };
};

test('confirmed, not sent yet: "Preparing your order", the whole journey ahead in grey', () => {
  assert.deepEqual(view(order({ confirmedAt: '2026-10-05T04:58:30Z' })), {
    hero: 'Preparing your order',
    steps: 'placed:done confirmed:done packing:now ofd:todo delivered:todo',
    note: true,
  });
});

test('waiting for the buyer to confirm: nothing is being packed yet', () => {
  assert.deepEqual(view(order()), {
    hero: 'Order placed',
    steps: 'placed:done confirmed:todo packing:todo ofd:todo delivered:todo',
    note: true,
  });
  // A shop that accepted it (older orders) is packing it, even without a buyer tap.
  assert.equal(view(order({ status: 'confirmed' })).steps, 'placed:done confirmed:todo packing:now ofd:todo delivered:todo');
});

test('own delivery: Send to delivery boy makes it Out for delivery; Delivered finishes it', () => {
  assert.deepEqual(view(order({ confirmedAt: 'x', status: 'dispatched' })), {
    hero: 'Out for delivery',
    steps: 'placed:done confirmed:done packing:done ofd:now delivered:todo',
    note: false,
  });
  assert.deepEqual(view(order({ confirmedAt: 'x', status: 'delivered' })), {
    hero: 'Delivered',
    steps: 'placed:done confirmed:done packing:done ofd:done delivered:done',
    note: false,
  });
});

test('courier orders keep the courier journey', () => {
  assert.deepEqual(view(order({ confirmedAt: 'x', awb: 'SF1', courier: 'shadowfax', shipmentStatus: 'Bag In Transit' })), {
    hero: 'On the way',
    steps: 'placed:done confirmed:done shipped:done transit:now ofd:todo delivered:todo',
    note: false,
  });
  assert.equal(view(order({ awb: 'SF1', courier: 'shadowfax', shipmentStatus: 'Delivered' })).hero, 'Delivered');
});

test('a cancelled order shows no journey', () => {
  assert.deepEqual(view(order({ status: 'cancelled' })), { hero: 'Order cancelled', steps: 'placed:done confirmed:todo', note: false });
});

test('the page is a tracker: never a bare "Order confirmed" headline, and the Track link says so', () => {
  for (const o of [order({ confirmedAt: 'x' }), order({ status: 'confirmed' }), order({ confirmedAt: 'x', status: 'confirmed' })]) {
    assert.notEqual(buildTimeline(o).hero.title, 'Order confirmed');
  }
  const page = readFileSync(new URL('../src/pages/OrderTracking.jsx', import.meta.url), 'utf8');
  assert.match(page, /\{isConfirmRoute \? 'Order' : 'Tracking order'\} #\{o\.ref\}/);
});

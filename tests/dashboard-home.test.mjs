// Home (Manage → Home), redesigned 2026-11-13 from the approved prototype: four
// "today" tiles on a computer (one big card on a phone), "Needs your attention"
// rows that each carry their own button, the latest orders, the week's sales,
// delivery queues, WhatsApp Coins and best sellers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildOverviewMetrics } from '../src/utils/overviewMetrics.js';
import { stageOf, orderRef } from '../src/utils/homeOrders.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const HOME = read('src/components/manage/OverviewTab.jsx');
const LATEST = read('src/components/manage/HomeLatestOrders.jsx');
const MANAGE = read('src/pages/ManageStore.jsx');

const NOW = Date.UTC(2026, 10, 13, 9, 0);          // 13 Nov 2026, 2:30 pm in India
const DAY = 86400000;
const at = (daysAgo) => new Date(NOW - daysAgo * DAY).toISOString();
const row = (over) => ({ id: Math.random().toString(36).slice(2), created_at: at(0), status: 'new', total: 500, paid: false, ...over });

test('delivery queues: ready to ship, on the way, delivered and returned in 30 days', () => {
  const rows = [
    row({ status: 'new' }),                                                   // new: not "ready to ship" yet
    row({ status: 'confirmed' }),                                             // ready to ship
    row({ status: 'confirmed' }),                                             // ready to ship
    row({ status: 'confirmed', awb: 'SF1', shipment_status: 'In Transit' }),  // on the way (courier)
    row({ status: 'dispatched' }),                                            // on the way (own delivery boy)
    row({ status: 'delivered', delivered_at: at(3) }),                        // delivered, in 30 days
    row({ status: 'delivered', delivered_at: at(40), created_at: at(42) }),   // delivered, too old
    row({ status: 'dispatched', awb: 'SF2', shipment_status: 'RTO Delivered', created_at: at(5) }), // returned
    row({ status: 'cancelled' }),                                             // ignored
  ];
  const s = buildOverviewMetrics(rows, { now: NOW }).shipping;
  assert.equal(s.readyToShip, 2);
  assert.equal(s.onTheWay, 2);
  assert.equal(s.delivered30, 1);
  assert.equal(s.returned30, 1);
  assert.equal(typeof s.codOnTheWay, 'number');
});

test('delivery queues are counts only and come out zero for an empty or failed read', () => {
  const s = buildOverviewMetrics([], { now: NOW }).shipping;
  assert.deepEqual({ ...s, codOnTheWay: 0 }, { readyToShip: 0, onTheWay: 0, delivered30: 0, returned30: 0, codOnTheWay: 0 });
  // Without a clock nothing is "in the last 30 days".
  const noClock = buildOverviewMetrics([row({ status: 'delivered', delivered_at: at(1) })], {}).shipping;
  assert.equal(noClock.delivered30, 0);
});

test('latest-orders stage and reference', () => {
  assert.equal(stageOf({ status: 'new' }), 'new');
  assert.equal(stageOf({ status: 'confirmed' }), 'to_ship');
  assert.equal(stageOf({ status: 'dispatched' }), 'on_the_way');
  assert.equal(stageOf({ status: 'confirmed', awb: 'SF1' }), 'on_the_way');
  assert.equal(stageOf({ status: 'delivered' }), 'delivered');
  assert.equal(stageOf({ status: 'cancelled' }), 'cancelled');
  assert.equal(orderRef({ id: 'a7f2c9-77e1' }), 'a7f2c');
  assert.equal(orderRef({}), '');
});

test('every attention row has its own button and goes where it is fixed', () => {
  for (const [cta, tab] of [['Book courier', 'delivery'], ['Remind', 'abandoned'], ['Restock', 'products'], ['Reply', 'reviews']]) {
    const i = HOME.indexOf(`cta: '${cta}'`);
    assert.ok(i !== -1, cta);
    assert.match(HOME.slice(i, i + 120), new RegExp(`onGoTab\\?\\.\\('${tab}'\\)`), `${cta} -> ${tab}`);
  }
  // "Ready to ship" is an accounting row: gated on the order feed like the others.
  assert.ok(HOME.split('\n').find((l) => l.includes('acc.shipping.readyToShip > 0')).includes('accountingOk'));
  assert.match(HOME, /function AttentionRow\(/);
});

test('the side cards hide when their own read fails, instead of showing zero', () => {
  assert.match(HOME, /setViews\(v \|\| false\)/);
  assert.match(HOME, /setUsage\(u && !u\.error \? u : false\)/);
  assert.match(HOME, /\{usage && \(/, 'the WhatsApp card needs a successful read');
  assert.match(HOME, /\{best\.length > 0 && \(/, 'best sellers only with real sales');
  assert.match(HOME, /\{accountingOk && !isService && \(/, 'delivery is accounting-gated');
});

test('latest orders: first page only, a list not a figure, Accept is a plain status change', () => {
  assert.match(LATEST, /fetchOrders\(slug, pin, \{ reuse: \[\] \}\)/);
  assert.match(LATEST, /setOrderStatus\(slug, pin, o\.id, 'confirmed'\)/);
  assert.ok(!/wa\.me|sendWhatsApp/.test(LATEST), 'accepting sends nothing by itself');
  assert.ok(!/fetchOrders\b/.test(HOME), 'Home itself still never reads the capped list');
});

test('Home gets the full computer width; other sections keep their column', () => {
  assert.match(MANAGE, /const WIDE_TABS = new Set\(\['home'\]\);/);
  assert.match(MANAGE, /onFind=\{findIn\}/);
});

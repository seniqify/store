// Delivery board search, and picking several gallery photos at once.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { matchesShipmentSearch, shipmentRef, prettyStatus } from '../src/utils/deliveryStatus.js';

const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
const MANAGE = read('src/pages/ManageStore.jsx');
const BOARD = read('src/components/manage/DeliveryBoard.jsx');

const order = { customer_name: 'Suwarna Patil', customer_phone: '+91 98765 43210', awb: 'SF38627159675' };

test('search matches part of the name, any case', () => {
  assert.equal(matchesShipmentSearch(order, 'suwarna'), true);
  assert.equal(matchesShipmentSearch(order, '  PATIL '), true);
  assert.equal(matchesShipmentSearch(order, 'rohit'), false);
});

test('search matches part of the phone number, ignoring spaces and +91', () => {
  assert.equal(matchesShipmentSearch(order, '98765'), true);
  assert.equal(matchesShipmentSearch(order, '43210'), true);
  assert.equal(matchesShipmentSearch(order, '98765 43210'), true);
  assert.equal(matchesShipmentSearch(order, '12'), false, 'two digits are too short to mean a number');
});

test('search matches the AWB, and an empty search shows everything', () => {
  assert.equal(matchesShipmentSearch(order, 'sf386'), true);
  assert.equal(matchesShipmentSearch(order, ''), true);
  assert.equal(matchesShipmentSearch(order, '   '), true);
  assert.equal(matchesShipmentSearch({}, 'x'), false);
});

test('search finds the order number the buyer quotes, a product, or the address', () => {
  const o = { ...order, id: 'a7f2c9e1-0000-4000-8000-000000000000', destination: 'Plot 4, Akkalkot Road, Solapur 413006',
    items: [{ name: 'Kaju Katli', qty: 2 }, { name: 'Besan Ladoo', qty: 1 }] };
  assert.equal(shipmentRef(o), 'A7F2C', 'the same short number Orders and Home show');
  assert.equal(matchesShipmentSearch(o, '#a7f2c'), true);
  assert.equal(matchesShipmentSearch(o, 'A7F2'), true);
  assert.equal(matchesShipmentSearch(o, '#a7'), false, 'two letters are too short to mean an order number');
  assert.equal(matchesShipmentSearch(o, 'kaju'), true);
  assert.equal(matchesShipmentSearch(o, 'akkalkot'), true);
  assert.equal(matchesShipmentSearch(o, 'pune'), false);
  assert.equal(shipmentRef({}), '');
});

test('courier wording reads plainly, however the courier spells it', () => {
  assert.equal(prettyStatus('RTO Initiated'), 'Return started');
  assert.equal(prettyStatus('Out For Delivery'), 'Out for delivery');
  assert.equal(prettyStatus('Not Contactable'), 'Not contactable');
  assert.equal(prettyStatus('Picked Up'), 'Picked up');
  assert.equal(prettyStatus('bag_in_transit'), 'In transit');
  assert.equal(prettyStatus(''), 'Booked');
  assert.equal(prettyStatus('Some New Code'), 'Some New Code', 'unknown words still show');
});

test('Track: the status tabs and courier chips are always in view, not hidden in dropdowns', () => {
  assert.match(BOARD, /role="tablist" aria-label="Shipment status"/);
  assert.ok(BOARD.includes("const statusTabs = ['all', ...BUCKETS, ...(count('cancelled') ? ['cancelled'] : [])];"));
  assert.ok(BOARD.includes('onClick={() => setFilter(k)}'));
  assert.ok(BOARD.includes('onClick={() => setCourier(k)}'));
  assert.ok(!/statusMenu|courierMenu|aria-haspopup/.test(BOARD), 'no dropdowns left');
  // Each row says which order it is; the totals sit below the list.
  assert.ok(BOARD.includes('#{shipmentRef(o)}'));
  assert.ok(BOARD.indexOf('role="tablist"') < BOARD.indexOf('Shipments so far'), 'tabs first, totals after');
});

test('the board filters its list with the search but keeps the tiles on the whole board', () => {
  assert.match(BOARD, /placeholder="Search name, phone, order no. or AWB…"/);
  // The list filters on the deferred search text, worked out once per change.
  assert.match(BOARD, /const searchText = useDeferredValue\(query\)/);
  assert.match(BOARD, /m\[b\] = \(groups\[b\] \|\| \[\]\)\.filter\(\(o\) => matchesShipmentSearch\(o, searchText\)\)/);
  assert.match(BOARD, /const shown = \(b\) => matched\[b\] \|\| \[\]/);
  // Drawn a page at a time; the page is cut from the searched list.
  assert.match(BOARD, /page\[b\] = \(effFilter === 'all' \|\| effFilter === b\) \? shown\(b\)\.slice\(0, Math\.max\(0, left\)\) : \[\]/);
  assert.match(BOARD, /\{page\[b\]\.map\(\(o\) =>/);
  assert.match(BOARD, /count\('attention'\)/, 'tiles still count the unsearched board');
  assert.match(BOARD, /No shipment matches/);
});

test('the gallery add tile accepts several photos, never more than the 5 slots', () => {
  assert.match(MANAGE, /multiple=\{multiple > 1\}/);
  assert.match(MANAGE, /value="" multiple=\{5 - \(form\.images \|\| \[\]\)\.length\}/);
  assert.match(MANAGE, /\[\.\.\.\(p\.images \|\| \[\]\), \.\.\.urls\]\.slice\(0, 5\)/);
  assert.match(MANAGE, /files\.slice\(0, multiple\)/);
  // one at a time, not Promise.all: several phone photos at once can exhaust memory
  const addFiles = MANAGE.slice(MANAGE.indexOf('async function addFiles'), MANAGE.indexOf('// ── Compact tile'));
  assert.match(addFiles, /for \(const f of files\.slice\(0, multiple\)\)[\s\S]*await compressImageFile/);
  assert.equal(/Promise\.all/.test(addFiles), false);
});

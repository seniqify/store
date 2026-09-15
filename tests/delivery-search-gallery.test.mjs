// Delivery board search, and picking several gallery photos at once.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { matchesShipmentSearch } from '../src/utils/deliveryStatus.js';

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

test('the board filters its list with the search but keeps the tiles on the whole board', () => {
  assert.match(BOARD, /placeholder="Search name, number or AWB…"/);
  assert.match(BOARD, /const shown = \(b\) => \(groups\[b\] \|\| \[\]\)\.filter\(\(o\) => matchesShipmentSearch\(o, query\)\)/);
  assert.match(BOARD, /\{shown\(b\)\.map\(\(o\) =>/);
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

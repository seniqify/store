// Typing in the Orders and Delivery searches lagged on big shops: every
// keystroke rebuilt one Intl.DateTimeFormat per order (to count orders by day)
// and redrew every card. Formatters are now built once per zone, the lists
// filter on a deferred copy of the search, the cards are memoised, and the
// lists draw 50 cards at a time behind "Show more".
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dayKeyInZone, hourInZone, weekdayInZone } from '../src/utils/commerceMetrics.js';
import { dayCounts } from '../src/utils/ordersView.js';
import { LIST_PAGE_SIZE } from '../src/utils/listPage.js';

const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
const TAB = read('src/components/manage/OrdersTab.jsx');
const BOARD = read('src/components/manage/DeliveryBoard.jsx');

test('counting a long list by day builds the zone formatter once, not once per order', () => {
  const Real = Intl.DateTimeFormat;
  let made = 0;
  Intl.DateTimeFormat = function (...a) { made += 1; return new Real(...a); };
  try {
    const rows = Array.from({ length: 500 }, (_, i) => ({ created_at: new Date(Date.UTC(2026, 9, 1) + i * 3600e3).toISOString() }));
    // A zone nothing else in this file has used yet, so the count starts cold.
    const counts = dayCounts(rows, 'Asia/Dubai');
    assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), 500);
    assert.ok(made <= 1, `built ${made} formatters for 500 orders`);
  } finally {
    Intl.DateTimeFormat = Real;
  }
});

test('reused formatters still answer for the zone asked, when zones alternate', () => {
  // 2026-10-31 20:30 UTC is already 1 November in India, still 31 October in UTC.
  const t = Date.UTC(2026, 9, 31, 20, 30);
  for (let i = 0; i < 3; i++) {
    assert.equal(dayKeyInZone(t, 'Asia/Kolkata'), '2026-11-01');
    assert.equal(dayKeyInZone(t, 'UTC'), '2026-10-31');
    assert.equal(hourInZone(t, 'Asia/Kolkata'), 2);
    assert.equal(hourInZone(t, 'UTC'), 20);
    assert.equal(weekdayInZone(t, 'Asia/Kolkata'), 0);   // Sunday
    assert.equal(weekdayInZone(t, 'UTC'), 6);            // Saturday
  }
  assert.equal(dayKeyInZone(null), null);
  assert.equal(dayKeyInZone(Number.NaN), null);
});

test('the Orders list filters on the deferred search and its cards are memoised', () => {
  assert.match(TAB, /const searchText = useDeferredValue\(query\)/);
  assert.match(TAB, /const q\s+= searchText\.trim\(\)\.toLowerCase\(\)/, 'the list reads the deferred text');
  assert.match(TAB, /<input value=\{query\} onChange=\{\(e\) => setQuery\(e\.target\.value\)\}/, 'the box reads the live text');
  assert.match(TAB, /const OrderCard = memo\(function OrderCard\(/);
  assert.match(TAB, /const LeadCard = memo\(function LeadCard\(/);
  // Handlers handed to every card must keep their identity, or memo does nothing.
  assert.match(TAB, /const changeStatus = useCallback\(/);
  assert.match(TAB, /const markPaid = useCallback\(/);
  assert.match(TAB, /dateCounts: dayCounts\(orders \|\| \[\]\),\n\s*\}\), \[orders, leads\]\)/, 'per-list counts are not per keystroke');
});

test('the Delivery list filters on the deferred search and its cards are memoised', () => {
  assert.match(BOARD, /const searchText = useDeferredValue\(query\)/);
  assert.match(BOARD, /const OrderCard = memo\(function OrderCard\(/);
  assert.match(BOARD, /onOpen=\{setActive\}/, 'no fresh arrow per card per render');
  assert.match(BOARD, /\}, \[orders, activeCourier\]\);/, 'buckets are sorted once per load');
});

test('both lists draw a page at a time behind Show more, never a silent cap', () => {
  assert.equal(LIST_PAGE_SIZE, 50, 'the same page as the Abandoned tab');
  // Orders: the page is cut from the full filtered list, and the rest is a tap away.
  assert.match(TAB, /const pageRows  = filtered\.slice\(0, visible\)/);
  // Phone: one card each; computer: one row each, the open order beside them.
  assert.match(TAB, /\{!wide && pageRows\.map\(cardFor\)\}/);
  assert.match(TAB, /for \(const o of wide \? pageRows : \[\]\)/);
  assert.match(TAB, /Show \{Math\.min\(LIST_PAGE_SIZE, remaining\)\} more/);
  assert.match(TAB, /Showing \{pageRows\.length\} of \{filtered\.length\} \{noun\}s/);
  // The search line still counts every match, not just the drawn page.
  assert.match(TAB, /<b className="text-gray-600">\{filtered\.length\}<\/b>/);
  // A new search or chip starts at the first page.
  assert.match(TAB, /const view      = `\$\{q\}\|\$\{filter\}\|\$\{dateFilter\}\|\$\{unpaidOnly\}`/);
  assert.match(TAB, /const visible   = more\.view === view \? more\.n : LIST_PAGE_SIZE/);
  // Delivery: the same, across its sections.
  assert.match(BOARD, /const view = `\$\{searchText\}\|\$\{effFilter\}\|\$\{activeCourier\}`/);
  assert.match(BOARD, /Show \{Math\.min\(LIST_PAGE_SIZE, remaining\)\} more/);
  assert.match(BOARD, /Showing \{Math\.min\(visible, shownTotal\)\} of \{shownTotal\} shipments/);
});

test('the fixed defaults keep memoised cards from redrawing when a prop is left out', () => {
  assert.match(TAB, /riders = NO_RIDERS, payInfo = NO_PAY_INFO, store = NO_STORE, rto = RTO_DEFAULTS, searchSeed = null, wide = false \}\)/);
  // The RTO reading is worked out once per list, never per card render.
  assert.match(TAB, /const risks = useMemo\(/);
  assert.match(TAB, /risk=\{risks\.get\(o\.id\)\}/);
});

// The other dashboard sections, laid out like the approved prototype on a
// computer (2026-11-13). Each keeps everything it did before; only the layout
// and the look change. Phones keep one column.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const MANAGE = read('src/pages/ManageStore.jsx');

test('WhatsApp: Coins and win-back on the left, the automatic messages on the right', () => {
  const tab = read('src/components/manage/WhatsAppTab.jsx');
  assert.match(MANAGE, /const WIDE_TABS = new Set\(\[[^\]]*'whatsapp'/);
  assert.match(MANAGE, /abandonedCarts\)\} wide=\{isDesktop\} \/>/);
  assert.match(tab, /wide \? 'grid grid-cols-2 gap-6 items-start' : 'max-w-3xl mx-auto space-y-4'/);
  // Same pieces as before, in both layouts.
  for (const piece of ['<WalletCard ', '<ShipUpdates ', 'toggleCart', "onGoTab?.('customers')", "onGoTab?.('abandoned')"]) {
    assert.ok(tab.includes(piece), piece);
  }
  assert.match(tab, /\{wide && winBack\}/);
  assert.match(tab, /\{!wide && winBack\}/);
});

test('the Coins card shows the balance on the dark panel, still only what the server returned', () => {
  const card = read('src/components/manage/WalletCard.jsx');
  assert.match(card, /linear-gradient\(135deg, #0b1f19, #061310\)/);
  assert.match(card, /WhatsApp Coins/);
  assert.match(card, /= ₹\{\(balance \/ 100\)/);
});

test('Customers: the list on the left, Send an offer and Coins on the right', () => {
  const tab = read('src/components/manage/CustomersTab.jsx');
  assert.match(MANAGE, /const WIDE_TABS = new Set\(\[[^\]]*'customers'/);
  assert.match(MANAGE, /searchSeed=\{seedFor\('customers'\)\} wide=\{isDesktop\} \/>/);
  assert.match(tab, /wide \? 'grid grid-cols-\[minmax\(0,1fr\)_360px\] gap-6 items-start' : 'space-y-4'/);
  // The offer still goes to exactly the customers shown.
  assert.match(tab, /audience=\{filtered\}/);
  assert.match(tab, /\{!wide && offers\}/);
  assert.match(tab, /\{wide && <div className="space-y-4 sticky/);
});

test('Payments: full width, the money cards in two columns on a computer, Hisaab kept readable', () => {
  const home = read('src/components/manage/payments/MoneyHome.jsx');
  const tab = read('src/components/manage/PaymentsTab.jsx');
  assert.match(MANAGE, /const WIDE_TABS = new Set\(\[[^\]]*'payments'/);
  assert.match(home, /lg:columns-2 lg:gap-6 \[&>\*\]:break-inside-avoid/);
  assert.match(tab, /<div className="max-w-3xl">\n\s*<HisaabTab /);
});

test('the remaining sections use the computer width; their card lists sit in grids', () => {
  assert.match(MANAGE, /'abandoned', 'reviews', 'offers', 'analytics', 'insights', 'ads'\]\);/);
  assert.ok(!/const WIDE_TABS = new Set\(\[[^\]]*'(assistant|settings)'/.test(MANAGE), 'assistant and settings keep a reading column');
  assert.match(read('src/components/manage/ReviewsTab.jsx'), /lg:grid lg:grid-cols-2 lg:gap-4 lg:items-start/);
  assert.match(read('src/components/manage/AnalyticsTab.jsx'), /grid grid-cols-2 lg:grid-cols-4 gap-3/);
  assert.equal((read('src/components/manage/OffersTab.jsx').match(/lg:grid lg:grid-cols-2 xl:grid-cols-3/g) || []).length, 2);
  assert.match(read('src/components/manage/AiInsightsTab.jsx'), /lg:columns-2 lg:gap-6/);
});

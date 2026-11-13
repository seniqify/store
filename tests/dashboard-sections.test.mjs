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

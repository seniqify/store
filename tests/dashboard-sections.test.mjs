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
  assert.match(MANAGE, /searchSeed=\{seedFor\('customers'\)\} wide=\{isDesktop\} offerSeed=\{offerSeed\} \/>/);
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
  assert.match(read('src/components/manage/ReviewsTab.jsx'), /lg:grid lg:grid-cols-\[320px_minmax\(0,1fr\)\] lg:gap-6 lg:items-start/);
  assert.match(read('src/components/manage/AnalyticsTab.jsx'), /grid grid-cols-2 lg:grid-cols-4 gap-3/);
  assert.equal((read('src/components/manage/OffersTab.jsx').match(/grid gap-4 sm:grid-cols-2 xl:grid-cols-3/g) || []).length, 2);
  assert.match(read('src/components/manage/AiInsightsTab.jsx'), /lg:columns-2 lg:gap-6/);
});

// ── 2026-11-15: the last four sections, matched to the approved prototype ────
test('Offers: one tile per coupon (big code, switch, Copy and Send), sale tiles, Save kept in view', () => {
  const tab = read('src/components/manage/OffersTab.jsx');
  assert.match(tab, /function CouponTile\(/);
  assert.match(tab, /function SaleTile\(/);
  assert.match(tab, /font-mono text-\[20px\] font-extrabold tracking-wider/);
  assert.match(tab, /onSend=\{onSendOffer \? \(\) => onSendOffer\(\{ code: c\.code, offer: describeDiscount\(c\) \}\) : null\}/);
  assert.match(tab, /sticky bottom-24 lg:bottom-4/);
  // Every old action is still reachable from a tile.
  for (const f of ['toggleCoupon(c.id)', 'openEditCoupon(c)', 'deleteCoupon(c.id)', 'copyCode(c.code)', 'toggleSale(o.id)', 'openEditSale(o)', 'deleteSale(o.id)']) {
    assert.ok(tab.includes(f), f);
  }
  // Send opens Customers with the code filled into the offer message.
  assert.match(MANAGE, /const sendOffer = useCallback\(\(seed\) => \{ goTab\('customers'\); setOfferSeed\(seed\); \}, \[goTab\]\);/);
  assert.match(read('src/components/manage/CustomersTab.jsx'), /initialFields=\{offerSeed\}/);
  assert.match(read('src/components/manage/OffersPanel.jsx'), /useState\(\(\) => \(\{ \.\.\.\(initialFields \|\| \{\}\) \}\)\)/);
});

test('Abandoned carts: four tiles, the list beside win-back and Coins, one compact row per cart', () => {
  const tab = read('src/components/manage/AbandonedTab.jsx');
  for (const t of ['Left behind', 'Not reminded yet', 'Won back', 'Auto reminder']) assert.ok(tab.includes(`>${t}</p>`), t);
  assert.match(tab, /lg:grid lg:grid-cols-\[minmax\(0,1fr\)_360px\]/);
  assert.match(tab, /onSummary=\{setRecovery\}/);
  assert.match(tab, /<ul className="divide-y divide-gray-100">/);
  assert.match(read('src/components/manage/CartChat.jsx'), /export function CartThumbs\(/);
  assert.match(tab, /<CartThumbs items=\{items\} products=\{products\} \/>/);
  const card = read('src/components/manage/RecoveryCard.jsx');
  assert.match(card, /onSummary\?\.\(s\?\.ok \? s\.data : null\)/);
});

test('Reviews: the rating panel on the left (average, 5 to 1 bars, ask for reviews), reviews beside it', () => {
  const tab = read('src/components/manage/ReviewsTab.jsx');
  assert.match(tab, /const dist = \[5, 4, 3, 2, 1\]\.map/);
  assert.match(tab, /all from real orders/);
  assert.match(tab, /onClick=\{\(\) => onGoTab\('orders'\)\}/);
  assert.match(MANAGE, /<ReviewsTab [^>]*onGoTab=\{goTab\} \/>/);
  // Still reply and report only: nothing is hidden or deleted.
  assert.match(tab, /replyToReview\(slug, pin, r\.id, text\)/);
  assert.match(tab, /reportReview\(slug, pin, r\.id, text\)/);
  assert.ok(!/deleteReview|hideReview/.test(tab));
});

test('Stats: a line chart read off with the pointer, the hisaab, buyers, one products table', () => {
  const tab = read('src/components/manage/AnalyticsTab.jsx');
  assert.match(tab, /function DailyChart\(/);
  assert.match(tab, /chartDays: range/);
  assert.match(tab, /\[\[7, '7 days'\], \[14, '14 days'\], \[30, '30 days'\]\]/);
  // Sales per day stays a Premium view; everyone sees orders per day.
  assert.match(tab, /const showSales = advanced && chartKind === 'sales';/);
  assert.match(tab, /Where your money goes/);
  assert.match(tab, /You keep/);
  assert.match(tab, /<th className="font-bold py-2 pl-4 text-right pr-5">Profit<\/th>/);
});

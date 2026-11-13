// The frame around the shop dashboard (Manage), redesigned 2026-11-13 from the
// approved clickable prototype: a dark side menu on a computer, a top bar with one
// search box and the bell, a phone top bar, and a phone "More" screen of tiles in
// place of the slide-out drawer. The sections themselves are unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  NAV_GROUPS, navGroups, shellColors, contrast, planLine, searchSuggestions, sectionSubtitle, todayLine, arrivalText,
} from '../src/utils/dashboardShell.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const MANAGE = read('src/pages/ManageStore.jsx');
const SIDEBAR = read('src/components/manage/shell/ManageSidebar.jsx');
const MORE = read('src/components/manage/shell/MoreScreen.jsx');
const SEARCH = read('src/components/manage/shell/GlobalSearch.jsx');
const BELL = read('src/components/manage/shell/AlertsBell.jsx');

const TABS = [
  { key: 'home', label: 'Home' }, { key: 'orders', label: 'Orders' }, { key: 'payments', label: 'Payments' },
  { key: 'customers', label: 'Customers' }, { key: 'analytics', label: 'Stats' }, { key: 'delivery', label: 'Delivery' },
  { key: 'settings', label: 'Settings' },
];

test('menu groups: same four groups, only the tabs a shop has, empty groups dropped', () => {
  assert.deepEqual(NAV_GROUPS.map((g) => g.title), ['Run', 'Grow', 'Understand', 'Set up']);
  const g = navGroups(TABS);
  assert.deepEqual(g.map((x) => x.title), ['Run', 'Grow', 'Understand', 'Set up']);
  assert.deepEqual(g[0].items.map((t) => t.key), ['home', 'orders', 'payments', 'delivery']);
  // A service shop has no delivery, payments, WhatsApp, ads or carts.
  const service = navGroups([{ key: 'home' }, { key: 'orders' }, { key: 'settings' }]);
  assert.deepEqual(service.map((x) => x.title), ['Run', 'Set up']);
  assert.deepEqual(navGroups([]), []);
});

test('colours: dark menu with the shop colour, a readable button, a visible active icon', () => {
  const c = shellColors('#16a34a');
  assert.equal(c.accent, '#16a34a');
  assert.equal(c.button, '#12823b', 'same 20% darker button as the PIN screen');
  assert.equal(c.sidebarBg, '#061310');
  assert.match(c.sidebarGlow, /#16a34a38/);
  assert.equal(c.activeIcon, '#16a34a');
  // A shop colour too dark to see on the dark menu gets a white icon instead.
  assert.equal(shellColors('#1e1b4b').activeIcon, '#ffffff');
  assert.ok(contrast(shellColors('#0d9488').activeIcon, '#061310') >= 3);
  assert.equal(shellColors('not a colour').accent, '#0d9488', 'bad input falls back');
});

test('plan line: says what is true for free, trial, paying and lapsed shops', () => {
  assert.equal(planLine({ plan: 'free' }), 'See plans');
  assert.equal(planLine({ plan: 'premium', lapsed: true }), 'See plans');
  assert.equal(planLine({ plan: 'premium', onTrial: true, daysLeft: 1 }), 'Free trial · 1 day left');
  assert.equal(planLine({ plan: 'premium', onTrial: true, daysLeft: 9 }), 'Free trial · 9 days left');
  // The expiry carries a few days of grace after the renewal charge, so it is
  // "Active till", never a promised renewal date.
  assert.equal(planLine({ plan: 'premium', isPaying: true, planExpiresAt: '2026-12-14T04:30:32.000Z' }), 'Active till 14 Dec 2026');
  assert.equal(planLine({ plan: 'premium', isPaying: true, planExpiresAt: 'garbage' }), 'Active');
  assert.ok(!/Renews/.test(read('src/utils/dashboardShell.js').split('export function planLine')[1].split('}\n')[0]));
});

test('search: hands the text to Orders and Customers, finds products and sections', () => {
  const products = [{ id: 1, name: 'Kanda Lasun Masala', price: 270 }, { id: 2, name: 'Garam Masala', price: 540 }, null];
  assert.deepEqual(searchSuggestions('  ', { tabs: TABS, products }), { sections: [], products: [], find: '' });
  const s = searchSuggestions(' lasun ', { tabs: TABS, products });
  assert.equal(s.find, 'lasun');
  assert.deepEqual(s.products.map((p) => p.id), [1]);
  assert.deepEqual(searchSuggestions('deliv', { tabs: TABS }).sections.map((t) => t.key), ['delivery']);
  // Everyday words reach the right section.
  assert.deepEqual(searchSuggestions('courier', { tabs: TABS }).sections.map((t) => t.key), ['delivery']);
  assert.deepEqual(searchSuggestions('pin', { tabs: TABS }).sections.map((t) => t.key), ['settings']);
  assert.ok(searchSuggestions('a', { tabs: TABS, products, limit: 1 }).products.length <= 1);
});

test('subtitles and dates are in the shop’s time zone', () => {
  // 13 Nov 2026 22:00 UTC is already Saturday 14 Nov in India.
  const late = Date.UTC(2026, 10, 13, 22, 0);
  assert.equal(todayLine(late), 'Saturday, 14 November');
  assert.equal(sectionSubtitle('home', { now: late }), 'Saturday, 14 November');
  assert.equal(sectionSubtitle('orders'), 'Accept, ship and track every order');
  assert.equal(sectionSubtitle('orders', { isService: true }), 'Reply to every enquiry');
  assert.equal(sectionSubtitle('nope'), '');
});

test('bell entries name the customer and amount, or say plainly when unknown', () => {
  const inr = (n) => `₹${n}`;
  assert.equal(arrivalText({ name: 'Asha', total: 810, count: 1 }, inr), 'New order from Asha · ₹810');
  assert.equal(arrivalText({ name: '', total: 0, count: 3 }, inr), '3 new orders, latest from a customer');
});

test('the dashboard uses the new frame and drops the slide-out drawer', () => {
  for (const s of ['<ManageSidebar', '<DesktopTopBar', '<PhoneTopBar', '<MoreScreen', '<GlobalSearch']) assert.ok(MANAGE.includes(s), s);
  assert.ok(!/menuOpen|setMenuOpen|GroupedNav/.test(MANAGE), 'no drawer state left behind');
  // "More" in the phone's bottom bar opens the tiles screen.
  assert.match(MANAGE, /onClick=\{\(\) => goTab\('more'\)\} aria-label="More sections"/);
  // A computer never stays on the phone-only "More" screen.
  assert.match(MANAGE, /if \(isDesktop && tab === 'more'\) setTab\('home'\);/);
  // Lock still clears the PIN, so the PIN screen comes back.
  assert.match(MANAGE, /const lock {6}= \(\) => \{ setPinVerified\(false\); setStorePin\(''\);/);
  // The new-order count still drives the red Orders badge, now through the bell too.
  assert.match(MANAGE, /const badges {4}= \{ orders: newCount \}/);
  assert.match(MANAGE, /<AlertsBell newCount=\{newCount\}/);
});

test('search hands its text to the section’s own search box, once', () => {
  for (const f of ['src/components/manage/OrdersTab.jsx', 'src/components/manage/CustomersTab.jsx']) {
    assert.match(read(f), /if \(searchSeed\?\.q && searchSeed !== seedSeen\) \{ setSeedSeen\(searchSeed\); setQuery\(searchSeed\.q\);/, f);
  }
  assert.match(MANAGE, /searchSeed=\{seedFor\('orders'\)\}/);
  assert.match(MANAGE, /searchSeed=\{seedFor\('customers'\)\}/);
  assert.match(MANAGE, /searchSeed=\{seedFor\('products'\)\}/);
  // Short product lists have no search box, so nothing hidden can filter them.
  assert.match(MANAGE, /const seedable = key !== 'products' \|\| products\.length > 8;/);
  assert.match(SEARCH, /onFind\('orders', s\.find\)/);
});

test('menu and tiles: red count only on Orders, Lock & exit, plan, labelled buttons', () => {
  assert.match(SIDEBAR, /key === 'orders' \? 'bg-red-600 text-white'/);
  assert.match(SIDEBAR, /aria-current=\{active \? 'page' : undefined\}/);
  assert.match(SIDEBAR, /Lock &amp; exit/);
  assert.match(MORE, /Lock &amp; exit/);
  assert.match(MORE, /Understand & set up/);
  assert.match(BELL, /aria-label=\{newCount > 0 \? `Alerts, \$\{newCount\} new \$\{nouns\}` : 'Alerts'\}/);
});

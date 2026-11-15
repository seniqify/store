// Add Coins (2026-11-15, founder): the ways to add Coins fold behind one button,
// and a shop can type any amount, not only the three packs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  WALLET_PACKS, customTopup, bonusPaiseFor, CUSTOM_MIN_RUPEES, CUSTOM_MAX_RUPEES,
} from '../src/utils/walletPacks.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const CARD = read('src/components/manage/WalletCard.jsx');
const EDGE = read('supabase/functions/wallet-topup/index.ts');
const WALLET = read('src/utils/wallet.js');

test('a typed amount: whole rupees from 50 to 50,000, 2 Coins a rupee', () => {
  assert.deepEqual(customTopup('200'), { ok: true, rupees: 200, amountPaise: 20000, coins: 400, bonus: 0, total: 400 });
  assert.equal(customTopup('50').ok, true);
  assert.equal(customTopup('49').ok, false);
  assert.equal(customTopup('50001').ok, false);
  assert.equal(customTopup('12.5').error, 'Enter whole rupees.');
  assert.deepEqual(customTopup(''), { ok: false, error: '' }, 'nothing typed is not an error');
  assert.deepEqual(customTopup('abc'), { ok: false, error: '' });
  assert.equal(CUSTOM_MIN_RUPEES, 50);
  assert.equal(CUSTOM_MAX_RUPEES, 50000);
});

test('the bonus steps are the packs’ own: 5% from Rs 750, 10% from Rs 1,500', () => {
  for (const p of WALLET_PACKS) assert.equal(bonusPaiseFor(p.amountPaise), p.bonusPaise, `${p.messages} pack`);
  assert.equal(customTopup('749').bonus, 0);
  assert.equal(customTopup('750').bonus, 75);
  assert.equal(customTopup('1500').bonus, 300);
  assert.equal(customTopup('2000').total, 4000 + 400);
});

test('the server applies the same limits and steps, and never takes a price from the browser', () => {
  assert.match(EDGE, /const CUSTOM_MIN_PAISE = 5000;/);
  assert.match(EDGE, /const CUSTOM_MAX_PAISE = 5000000;/);
  assert.equal(CUSTOM_MIN_RUPEES * 100, 5000);
  assert.equal(CUSTOM_MAX_RUPEES * 100, 5000000);
  for (const rule of ['if (amountPaise >= 150000) return Math.round(amountPaise * 0.10);', 'if (amountPaise >= 75000) return Math.round(amountPaise * 0.05);']) {
    assert.ok(EDGE.includes(rule), `edge: ${rule}`);
    assert.ok(read('src/utils/walletPacks.js').includes(rule.replace('amountPaise', 'p').replace('amountPaise', 'p')), `app: ${rule}`);
  }
  assert.ok(!/body\.(amount|bonus|price)/.test(EDGE));
  // The browser names a pack or whole rupees, nothing else.
  assert.match(WALLET, /body: rupees \? \{ action: 'create', slug, hashedPin: hashed, rupees \} : \{ action: 'create', slug, hashedPin: hashed, messages \},/);
});

test('the card: one Add Coins button; the packs and the typed amount only after tapping it', () => {
  assert.match(CARD, /const \[adding, setAdding\] = useState\(false\);/);
  assert.match(CARD, /onClick=\{\(\) => setAdding\(true\)\}/);
  assert.match(CARD, /\{adding && \(\(\) => \{/);
  assert.match(CARD, /Or enter any amount/);
  assert.match(CARD, /onClick=\{\(\) => buy\(null, typed\)\}/);
  assert.match(CARD, /disabled=\{!typed\.ok \|\| Boolean\(buying\)\}/);
  // The compact strip's Add Coins opens straight into the choices.
  assert.match(CARD, /onClick=\{\(\) => \{ setOpen\(true\); setAdding\(true\); \}\}/);
});

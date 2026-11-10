// Book courier: the merchant picks the courier for each order inside the booking
// window (or their own delivery boy), instead of switching the default in Settings.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { transformWithOxc } from 'vite';
import { autoPickCourier, courierOptions } from '../src/utils/courierChoice.js';

const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
const BOOK = read('supabase/functions/shipping-book/index.ts');
const RATE = read('supabase/functions/shipping-rate/index.ts');
const MODAL = read('src/components/manage/ShipBookModal.jsx');
const ORDERS = read('src/components/manage/OrdersTab.jsx');
const CONNECT = read('src/utils/shippingConnect.js');

async function pickCourierOf(src, file) {
  const js = (await transformWithOxc(src, file, { lang: 'ts' })).code;
  const head = js.indexOf('function pickCourier(');
  assert.notEqual(head, -1, `${file} has no pickCourier`);
  let depth = 0, i = js.indexOf('{', head);
  for (; i < js.length; i++) { if (js[i] === '{') depth++; else if (js[i] === '}' && --depth === 0) break; }
  return new Function(`${js.slice(head, i + 1)}\nreturn pickCourier;`)();
}

for (const [label, src] of [['shipping-book', BOOK], ['shipping-rate', RATE]]) {
  test(`${label}: the courier picked in Book courier wins; anything else falls back to the default`, async () => {
    const pick = await pickCourierOf(src, `${label}.ts`);
    const both = { delhivery: true, shadowfax: true, courier: 'shadowfax' };
    assert.equal(pick(both, 'delhivery'), 'delhivery');
    assert.equal(pick(both, 'Delhivery'), 'delhivery');
    assert.equal(pick({ delhivery: true, courier: 'delhivery' }, 'shadowfax'), 'shadowfax');
    // Unknown or missing names never reach a courier: the default answers.
    assert.equal(pick(both, 'xpressbees'), 'shadowfax');
    assert.equal(pick(both, ''), 'shadowfax');
    assert.equal(pick(both, undefined), 'shadowfax');
    assert.equal(pick({ shadowfax: true }, null), 'shadowfax');
    assert.equal(pick({}, null), 'delhivery');
    assert.equal(pick({ courier: 'ShadowFax' }, null), 'shadowfax');
    assert.equal(pick({ courier: 'bluedart' }, null), 'delhivery');
  });
}

test('shipping-book reads the picked courier and books only a CONNECTED one', () => {
  assert.match(BOOK, /const \{ slug, hashedPin, orderId, details = \{\}, courier \} = await req\.json\(\);/);
  assert.match(BOOK, /const activeCourier = pickCourier\(store\.config\?\.shipping \|\| \{\}, courier\);/);
  // The account row (status connected + token) still gates the booking.
  assert.match(BOOK, /\.eq\('provider', activeCourier\)\.maybeSingle\(\);\s*if \(!acct \|\| acct\.status !== 'connected' \|\| !acct\.api_token\)/);
  assert.match(BOOK, /is not connected\. Connect it in Settings → Shipping, or pick another courier\./);
  // Both success replies say which courier carries it, so the card can show it.
  assert.match(BOOK, /\.\.\.booked\.reply, courier: 'shadowfax'/);
  assert.match(BOOK, /\.\.\.booked\.reply, courier: 'delhivery'/);
  // An unconfirmed booking with another courier still blocks the switch.
  assert.match(BOOK, /Pick \$\{other\} in Book courier/);
});

test('shipping-rate answers for the courier asked about (checkout still gets the default)', () => {
  assert.match(RATE, /const \{ slug, destPincode, weightG, paymentMode, courier \} = await req\.json\(\);/);
  assert.match(RATE, /const activeCourier = pickCourier\(store\?\.config\?\.shipping \|\| \{\}, courier\);/);
});

test('the app sends the picked courier with the rate check and the booking', () => {
  assert.match(CONNECT, /getShippingRate\(slug, destPincode, weightG, paymentMode, courier\)[\s\S]*body: \{ slug, destPincode, weightG, paymentMode, courier \}/);
  assert.match(CONNECT, /bookShipment\(slug, pin, orderId, details = \{\}, courier\)[\s\S]*body: \{ slug, hashedPin, orderId, details, courier \}/);
  assert.match(MODAL, /getShippingRate\(slug, f\.pin, Number\(f\.weight\), f\.payment === 'COD' \? 'COD' : 'Pre-paid', c\)/);
  assert.match(MODAL, /\}, pickOpt\.key\);/);
});

const rates = {
  shadowfax: { serviceable: false, reason: 'Shadowfax does not deliver to this pincode' },
  delhivery: { serviceable: true, cod: true, prepaid: true, amount: 62 },
};

test('default courier cannot deliver => the other one is picked', () => {
  const opts = courierOptions(['shadowfax', 'delhivery'], rates, 'COD', 'shadowfax');
  assert.deepEqual(opts.map((x) => [x.key, x.usable, x.off]), [['shadowfax', false, true], ['delhivery', true, false]]);
  assert.equal(autoPickCourier(opts), 'delhivery');
  assert.equal(opts[1].amount, 62);
  assert.equal(opts[0].estimate, true, 'Shadowfax prices are rate-card estimates');
});

test('both deliver => the default stays picked, even when the other is cheaper', () => {
  const r = { shadowfax: { serviceable: true, cod: true, amount: 58 }, delhivery: { serviceable: true, cod: true, amount: 54 } };
  const opts = courierOptions(['delhivery', 'shadowfax'], r, 'Prepaid', 'shadowfax');
  assert.equal(autoPickCourier(opts), 'shadowfax');
});

test('COD at a pincode without cash on delivery => that courier is not usable', () => {
  const r = { shadowfax: { serviceable: true, cod: true, amount: 58 }, delhivery: { serviceable: true, cod: false, prepaid: true, amount: 54 } };
  const cod = courierOptions(['shadowfax', 'delhivery'], r, 'COD', 'delhivery');
  assert.deepEqual(cod.map((x) => [x.key, x.usable, x.noCod]), [['shadowfax', true, false], ['delhivery', false, true]]);
  assert.equal(autoPickCourier(cod), 'shadowfax');
  const prepaid = courierOptions(['shadowfax', 'delhivery'], r, 'Prepaid', 'delhivery');
  assert.equal(autoPickCourier(prepaid), 'delhivery');
});

test('nothing usable, or still checking => no courier is picked', () => {
  const none = { shadowfax: { serviceable: false }, delhivery: { serviceable: false } };
  assert.equal(autoPickCourier(courierOptions(['shadowfax', 'delhivery'], none, 'COD', 'shadowfax')), null);
  const waiting = courierOptions(['shadowfax', 'delhivery'], { shadowfax: { loading: true } }, 'COD', 'shadowfax');
  assert.equal(waiting.every((x) => x.loading && !x.usable), true);
  assert.equal(autoPickCourier(waiting), null);
});

test('a rate lookup that failed leaves the courier bookable (the booking itself checks)', () => {
  const opts = courierOptions(['delhivery'], { delhivery: { error: true } }, 'COD', 'delhivery');
  assert.equal(opts[0].usable, true);
  assert.equal(opts[0].unchecked, true);
  assert.equal(opts[0].amount, null);
});

test('the order card has one "Book courier" button and passes every connected courier + delivery boys', () => {
  assert.equal(/Book \{ship\.cName\}|Book \{cName\}/.test(ORDERS), false, 'no courier-named Book button is left');
  assert.match(ORDERS, /<Truck size=\{icon\} \/> Book courier<\/button>/);
  assert.match(ORDERS, /const connectedCouriers = \(store\) => \['shadowfax', 'delhivery'\]\.filter\(\(c\) => store\?\.shipping\?\.\[c\]\);/);
  assert.equal((ORDERS.match(/couriers=\{connectedCouriers\(store\)\} riders=\{dispatchRiders\} riderHref=\{riderWa\}/g) || []).length, 2);
  // Sending it with the delivery boy moves the order on, like the card's own button.
  assert.match(ORDERS, /onRider=\{\(\) => \{ ship\.setModal\(false\); onStatus\(o\.id, 'dispatched'\); \}\}/);
  // A courier picked here shows on the card straight away.
  assert.match(ORDERS, /courier: ship\.bookedWith \|\| o\.courier/);
});

test('the modal never changes the Settings default', () => {
  assert.equal(/setActiveCourier/.test(MODAL), false);
  assert.match(MODAL, /Picking here is for this order only/);
});

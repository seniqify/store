// Booking a shipment is two steps that fail independently: the courier creates a
// real parcel, then PocketLink records it. Everything here guards the gap between
// them, because that gap is where duplicate parcels come from.
//
// Before this: the order was read, `awb` seen as null, the courier called, and
// the row updated blindly — the update's result was never even looked at. Two
// requests could both read null and both create a shipment; a failed write left
// a live parcel nothing pointed at; and the "already booked" reply handed every
// Shadowfax shipment a Delhivery tracking link, because `courier` was not in the
// select list at all.
//
// The pure decision functions are EXECUTED here, not just pattern-matched: the
// .ts is transformed to JS and the helpers are run against fakes. The parts that
// live inside serve() cannot run without Deno, so those are pinned against the
// source instead — stated plainly rather than implied.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { transformWithOxc } from 'vite';

const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8')
  .replace(/\r\n/g, '\n');

const BOOK = read('supabase/functions/shipping-book/index.ts');
const OPS = read('supabase/functions/shipping-ops/index.ts');

// ── the harness ─────────────────────────────────────────────────────────────

const JS = (await transformWithOxc(BOOK, 'index.ts', { lang: 'ts' })).code;
assert.ok(JS && JS.length > 1000, 'the edge function must transform before anything can be tested');

/** Pull one top-level function out of the transformed module and run it. */
function load(names, scope = {}) {
  const parts = names.map((name) => {
    const head = JS.indexOf(`function ${name}(`);
    assert.notEqual(head, -1, `${name} is gone from shipping-book — the test is no longer testing it`);
    const start = JS.lastIndexOf('\n', head) + 1;
    const open = JS.indexOf('{', head);
    let depth = 0;
    let i = open;
    for (; i < JS.length; i++) {
      if (JS[i] === '{') depth++;
      else if (JS[i] === '}') { depth--; if (depth === 0) break; }
    }
    return JS.slice(start, i + 1).replace(/^async function/, 'async function').replace(/^\s*(export\s+)?/, '');
  }).join('\n');
  const keys = Object.keys(scope);
  const make = new Function(...keys, `${parts}\nreturn { ${names.join(', ')} };`);
  return make(...keys.map((k) => scope[k]));
}

const BASE = 'https://track.delhivery.com';

// ── A + B. the already-booked reply ─────────────────────────────────────────

test('the order read now includes courier, which the already-booked reply needs', () => {
  assert.match(BOOK, /\.select\('id, awb, courier, customer_name/,
    'courier must be selected or order.courier is undefined at runtime');
});

test('an existing shipment short-circuits BEFORE any courier call', () => {
  const guard = BOOK.indexOf('if (order.awb) {');
  const shadowfax = BOOK.indexOf("acct.provider === 'shadowfax'");
  const delhivery = BOOK.indexOf('/api/cmu/create.json');
  assert.ok(guard > -1, 'the existing-AWB guard is still there');
  assert.ok(guard < shadowfax && guard < delhivery,
    'it returns before either provider can be asked to create anything');
  assert.match(BOOK.slice(guard, guard + 400), /alreadyBooked: true/);
});

test('a booked Shadowfax order is never given a Delhivery tracking link', () => {
  const { trackUrlFor } = load(['trackUrlFor']);
  assert.equal(trackUrlFor('shadowfax', 'SF123'), null, 'Shadowfax has no public tracking page');
  assert.equal(trackUrlFor('Shadowfax', 'SF123'), null, 'and the courier name is not case-sensitive');
  assert.equal(trackUrlFor('delhivery', 'DL999'), 'https://www.delhivery.com/track/package/DL999');
  assert.equal(trackUrlFor(null, 'DL999'), 'https://www.delhivery.com/track/package/DL999',
    'an unrecorded courier still falls back to Delhivery, as it always did');
  assert.equal(trackUrlFor('delhivery', null), null, 'and no AWB means no link at all');
});

test('the old defect is gone: courier is no longer read from an unselected column', () => {
  assert.equal(/order\.courier === 'shadowfax' \? null :/.test(BOOK), false,
    'the inline ternary that read an unselected column must not come back');
  assert.match(BOOK, /trackUrlFor\(order\.courier, order\.awb\)/);
});

// ── C + D + I. the conditional attach ───────────────────────────────────────

test('ZERO ROWS IS NOT SUCCESS', () => {
  const { classifyAttach } = load(['classifyAttach']);
  assert.equal(classifyAttach(null, []), 'lost', 'the guard refused: someone else attached first');
  assert.equal(classifyAttach(null, null), 'lost', 'and a missing array is not a silent success either');
  assert.equal(classifyAttach(undefined, undefined), 'lost');
});

test('exactly one updated row is success, and nothing else is', () => {
  const { classifyAttach } = load(['classifyAttach']);
  assert.equal(classifyAttach(null, [{ id: 'o1' }]), 'ok');
  assert.equal(classifyAttach(null, [{ id: 'o1' }, { id: 'o2' }]), 'lost',
    'more than one row is not something to report as a clean booking');
});

test('a write error is its own state, never confused with losing the race', () => {
  const { classifyAttach } = load(['classifyAttach']);
  assert.equal(classifyAttach({ message: 'boom' }, null), 'error');
  assert.equal(classifyAttach({ message: 'boom' }, [{ id: 'o1' }]), 'error',
    'an error wins even if rows came back — we cannot trust what landed');
});

test('both providers attach conditionally and inspect the result', () => {
  for (const [name, marker] of [['shadowfax', 'sAttach'], ['delhivery', 'dAttach']]) {
    const at = BOOK.indexOf(`const ${marker} = await supabase.from('orders')`);
    assert.notEqual(at, -1, `${name} must go through the guarded attach`);
    const block = BOOK.slice(at, at + 420);
    assert.match(block, /\.is\('awb', null\)/, `${name}: the update is guarded by the null AWB`);
    assert.match(block, /\.select\('id'\)/, `${name}: and it asks which rows moved`);
    assert.match(block, /classifyAttach\(/, `${name}: and the answer is classified`);
  }
});

test('no blind overwrite survives anywhere in the booking path', () => {
  const updates = BOOK.match(/\.update\(\{[^}]*awb[^}]*\}\)[\s\S]{0,180}/g) || [];
  assert.ok(updates.length >= 2, 'both providers still persist an AWB');
  for (const u of updates) {
    assert.match(u, /\.is\('awb', null\)/, 'every AWB write is conditional');
  }
});

// ── E + F + G. compensation ─────────────────────────────────────────────────

test('losing the race returns the AUTHORITATIVE AWB, never ours', () => {
  const { bookingConflict, trackUrlFor } = load(['bookingConflict', 'trackUrlFor']);
  const r = bookingConflict('lost', true, 'SF-OURS', { awb: 'SF-WINNER', courier: 'shadowfax' });
  assert.equal(r.awb, 'SF-WINNER', 'the AWB on the order is the one that counts');
  assert.equal(r.alreadyBooked, true);
  assert.equal(r.trackUrl, null, 'and a Shadowfax winner gets no Delhivery link');
  assert.equal(r.error, undefined, 'it is not an error — the order is correctly booked');
  assert.equal(JSON.stringify(r).includes('SF-OURS'), false,
    'our cancelled duplicate must never be presented as the shipment');
  assert.equal(r.needsReconciliation, undefined);
  void trackUrlFor;
});

test('a persistence error with a successful undo is a plain, retryable failure', () => {
  const { bookingConflict } = load(['bookingConflict']);
  const r = bookingConflict('error', true, 'DL-OURS', null);
  assert.match(r.error, /cancelled with the courier/);
  assert.match(r.error, /try booking again/);
  assert.equal(r.awb, undefined, 'no AWB is claimed');
  assert.equal(r.needsReconciliation, undefined, 'nothing is left hanging');
});

test('COMPENSATION FAILURE is never dressed up as success or as a simple retry', () => {
  const { bookingConflict } = load(['bookingConflict']);
  for (const kind of ['lost', 'error']) {
    const r = bookingConflict(kind, false, 'DL-ORPHAN', { awb: 'DL-WINNER', courier: 'delhivery' });
    assert.equal(r.alreadyBooked, undefined, `${kind}: not reported as a normal booking`);
    assert.equal(r.needsReconciliation, true, `${kind}: the merchant is told it needs sorting out`);
    assert.equal(r.orphanAwb, 'DL-ORPHAN', `${kind}: and given the number to cancel`);
    assert.match(r.error, /Do not book again/, `${kind}: retrying would book a third parcel`);
    assert.equal(/please try (booking )?again/i.test(r.error), false,
      `${kind}: must not tell them to just retry while a live parcel is unaccounted for`);
  }
});

test('compensation calls the SAME cancel endpoints the cancel action already uses', async () => {
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, body: init?.body, auth: init?.headers?.Authorization });
    return url.includes('shadowfax')
      ? { json: async () => ({ responseCode: 200, responseMsg: 'cancelled' }) }
      : { text: async () => '<status>True</status>' };
  };
  const { cancelAtCourier } = load(['cancelAtCourier'], { fetch: fakeFetch, BASE });

  const sfx = await cancelAtCourier('shadowfax', 'SF1', 'tok', 'production');
  assert.equal(sfx.cancelled, true);
  assert.match(calls[0].url, /dale\.shadowfax\.in\/api\/v3\/clients\/orders\/cancel\//);
  assert.match(calls[0].body, /"request_id":"SF1"/);

  const dlv = await cancelAtCourier('delhivery', 'DL1', 'tok', '');
  assert.equal(dlv.cancelled, true);
  assert.match(calls[1].url, /track\.delhivery\.com\/api\/p\/edit/);
  assert.match(calls[1].body, /"cancellation":"true"/);
});

test('staging Shadowfax cancels against staging, not production', async () => {
  const seen = [];
  const fakeFetch = async (url) => { seen.push(url); return { json: async () => ({ responseCode: 200 }) }; };
  const { cancelAtCourier } = load(['cancelAtCourier'], { fetch: fakeFetch, BASE });
  await cancelAtCourier('shadowfax', 'SF1', 'tok', 'staging');
  assert.match(seen[0], /dale\.staging\.shadowfax\.in/);
});

test('a refused or unreachable cancel reports failure, and leaks nothing', async () => {
  const refuse = async (url) => (url.includes('shadowfax')
    ? { json: async () => ({ responseCode: 500, responseMsg: 'nope', secret: 'token-abc' }) }
    : { text: async () => '<status>False</status> token-abc' });
  const { cancelAtCourier } = load(['cancelAtCourier'], { fetch: refuse, BASE });
  for (const p of ['shadowfax', 'delhivery']) {
    const r = await cancelAtCourier(p, 'A1', 'tok', 'production');
    assert.equal(r.cancelled, false, `${p} refusal is a failure`);
    assert.equal(r.reason.includes('token-abc'), false, `${p}: no provider body travels out`);
    assert.ok(r.reason.length < 60, `${p}: the reason stays short`);
  }
  const thrower = async () => { throw new Error('ECONNRESET tok=secret'); };
  const { cancelAtCourier: c2 } = load(['cancelAtCourier'], { fetch: thrower, BASE });
  const r = await c2('delhivery', 'A1', 'tok', '');
  assert.equal(r.cancelled, false, 'an unreachable courier is NOT a confirmed cancellation');
  assert.equal(r.reason.includes('secret'), false);
});

test('both providers compensate, and neither overwrites the winning AWB', () => {
  for (const [name, marker] of [['shadowfax', 'sState'], ['delhivery', 'dState']]) {
    const at = BOOK.indexOf(`const ${marker} = classifyAttach(`);
    const block = BOOK.slice(at, at + 700);
    assert.match(block, new RegExp(`if \\(${marker} !== 'ok'\\)`), `${name}: anything but ok is handled`);
    assert.match(block, /cancelAtCourier\(/, `${name}: the duplicate parcel is taken back`);
    assert.match(block, /bookingConflict\(/, `${name}: and the answer says so`);
    assert.equal(/\.update\(/.test(block), false, `${name}: the order is never written again here`);
  }
});

// ── J. unknown courier result ───────────────────────────────────────────────

test('an unanswered courier is reported as unknown, not as a failure to retry', () => {
  const { bookingUnknown } = load(['bookingUnknown']);
  const r = bookingUnknown();
  assert.equal(r.bookingUnknown, true);
  assert.match(r.error, /cannot tell whether a shipment was created/);
  assert.match(r.error, /Check your courier panel/);
  assert.equal(r.awb, undefined, 'no AWB is invented');
  assert.equal(/try again/i.test(r.error), false, 'a blind retry could create a second parcel');
});

test('both create calls are wrapped so a throw cannot be mistaken for a refusal', () => {
  for (const create of ['/v3/clients/orders/'+String.fromCharCode(96), '/api/cmu/create.json']) {
    const at = BOOK.indexOf(create);
    const around = BOOK.slice(Math.max(0, at - 260), at + 360);
    assert.match(around, /try \{/, `${create}: the create call is inside a try`);
    assert.match(around, /bookingUnknown\(\)/, `${create}: and a throw becomes the unknown state`);
  }
});

// ── anti-drift: the duplicated cancel logic ─────────────────────────────────

test('the cancel calls match shipping-ops, which owns the cancel action', () => {
  // Each edge function deploys alone, so this logic is duplicated on purpose.
  // Pinning the two copies is what keeps the duplication honest.
  for (const bit of [
    "/v3/clients/orders/cancel/",
    "request_id: awb",
    '/api/p/edit',
    "waybill: String(awb), cancellation: 'true'",
  ]) {
    assert.ok(OPS.includes(bit), `shipping-ops still uses ${bit}`);
  }
  assert.match(BOOK, /request_id: awb/);
  assert.match(BOOK, /waybill: String\(awb\), cancellation: 'true'/);
  const opsOk = /cd\?\.responseCode === 200 \|\| \/cancel\/i\.test\(cd\?\.responseMsg \|\| ''\)/;
  assert.match(OPS, opsOk, 'shipping-ops success test');
  assert.match(BOOK, opsOk, 'and shipping-book uses the identical test');
});

// ── scope guards ────────────────────────────────────────────────────────────

test('this PR does not begin rebooking', () => {
  // "cancel→rebook" appears in a pre-existing comment about Shadowfax order
  // ids, so this has to read the code and not the prose around it.
  const code = BOOK.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
  assert.equal(/rebook/i.test(code), false, 'no rebooking action in the code itself');
  assert.equal(/shipment_attempts/.test(BOOK), false, 'no attempt history table');
  assert.match(BOOK, /if \(order\.awb\) \{/, 'an existing AWB still blocks booking outright');
  assert.equal(/awb: null/.test(BOOK), false, 'and booking never clears an AWB');
});

test('authorization and tenancy are untouched', () => {
  assert.match(BOOK, /verify_store_pin/, 'the PIN gate stays');
  const pin = BOOK.indexOf('verify_store_pin');
  const order = BOOK.indexOf(".from('orders')");
  assert.ok(pin < order, 'and it runs before any order is read');
  const reads = BOOK.match(/\.eq\('id', order(?:Id|\.id)\)[^\n]*/g) || [];
  assert.ok(reads.length >= 4, 'every order touch is still addressed by id');
  for (const r of reads) assert.match(r, /store_slug/, 'and scoped to the store');
});

test('no courier credential can reach the browser', () => {
  const returned = BOOK.match(/return json\(\{[\s\S]{0,300}?\}\)/g) || [];
  for (const r of returned) {
    assert.equal(/api_token|Authorization|service_role|SUPABASE_SERVICE/.test(r), false,
      `a response must not carry credentials: ${r.slice(0, 80)}`);
  }
});

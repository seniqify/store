// Booking a shipment is two steps that fail independently: the courier creates a
// real parcel, then PocketLink records it. Everything here guards the gap between
// them, because that gap is where duplicate parcels come from.
//
// Before PR A: the order was read, `awb` seen as null, the courier called, and
// the row updated blindly — the update's result was never even looked at. Two
// requests could both read null and both create a shipment; a failed write left
// a live parcel nothing pointed at; and the "already booked" reply handed every
// Shadowfax shipment a Delhivery tracking link, because `courier` was not in the
// select list at all.
//
// B2B replaced PR A's conditional attach and its compensation logic with the
// claim / finalize / supersede RPCs. The tests for that superseded machinery
// (classifyAttach, attachVerdict, bookingConflict and their call sites) are
// retired here; every state they covered is now executed against the new flow
// in tests/shipping-book-claim.test.mjs. What remains below is what PR A
// established and B2B keeps: the already-booked reply, the courier-aware
// tracking link, the unknown reply, the tenancy guards -- and the duplicate
// cleanup's cancel call, now held to the same strict confirmation as
// shipping-ops.
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

/** The duplicate-cleanup cancel, with the strict tests it depends on. */
const loadCancel = () => load(['shadowfaxCancelConfirmed', 'delhiveryCancelConfirmed', 'cancelAtCourier'], { BASE });

/** A courier response, shaped like fetch's. */
const answer = (status, body) => ({
  ok: status >= 200 && status < 300, status,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

// ── A + B. the already-booked reply ─────────────────────────────────────────

test('the order read now includes courier, which the already-booked reply needs', () => {
  assert.match(BOOK, /\.select\('id, awb, courier, customer_name/,
    'courier must be selected or order.courier is undefined at runtime');
});

test('an existing shipment short-circuits BEFORE any courier call', () => {
  const guard = BOOK.indexOf('if (order.awb) {');
  const shadowfax = BOOK.indexOf("acct.provider === 'shadowfax'");
  const delhivery = BOOK.indexOf('/api/cmu/create.json`');
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

// ── duplicate cleanup: the cancel call ──────────────────────────────────────

test('cleanup calls the SAME cancel endpoints the cancel action uses', async () => {
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, body: init?.body, auth: init?.headers?.Authorization });
    return url.includes('shadowfax')
      ? answer(200, { responseCode: 200, responseMsg: 'Order cancelled successfully' })
      : answer(200, '<status>True</status>');
  };
  const { cancelAtCourier } = loadCancel();

  const sfx = await cancelAtCourier(fakeFetch, 'shadowfax', 'SF1', 'tok', 'production');
  assert.equal(sfx.cancelled, true);
  assert.match(calls[0].url, /dale\.shadowfax\.in\/api\/v3\/clients\/orders\/cancel\//);
  assert.match(calls[0].body, /"request_id":"SF1"/);

  const dlv = await cancelAtCourier(fakeFetch, 'delhivery', 'DL1', 'tok', '');
  assert.equal(dlv.cancelled, true);
  assert.match(calls[1].url, /track\.delhivery\.com\/api\/p\/edit/);
  assert.match(calls[1].body, /"cancellation":"true"/);
});

test('staging Shadowfax cancels against staging, not production', async () => {
  const seen = [];
  const fakeFetch = async (url) => { seen.push(url); return answer(200, { responseCode: 200 }); };
  const { cancelAtCourier } = loadCancel();
  await cancelAtCourier(fakeFetch, 'shadowfax', 'SF1', 'tok', 'staging');
  assert.match(seen[0], /dale\.staging\.shadowfax\.in/);
});

test('a refused or unreachable cancel reports failure, and leaks nothing', async () => {
  const refuse = async (url) => (url.includes('shadowfax')
    ? answer(200, { responseCode: 500, responseMsg: 'nope', secret: 'token-abc' })
    : answer(200, '<status>False</status> token-abc'));
  const { cancelAtCourier } = loadCancel();
  for (const p of ['shadowfax', 'delhivery']) {
    const r = await cancelAtCourier(refuse, p, 'A1', 'tok', 'production');
    assert.equal(r.cancelled, false, `${p} refusal is a failure`);
    assert.equal(r.reason.includes('token-abc'), false, `${p}: no provider body travels out`);
    assert.ok(r.reason.length < 60, `${p}: the reason stays short`);
  }
  const thrower = async () => { throw new Error('ECONNRESET tok=secret'); };
  const r = await cancelAtCourier(thrower, 'delhivery', 'A1', 'tok', '');
  assert.equal(r.cancelled, false, 'an unreachable courier is NOT a confirmed cancellation');
  assert.equal(r.reason.includes('secret'), false);
});

test('a refusal that merely MENTIONS cancel is not a cancellation -- the defect B2B removed', async () => {
  const { cancelAtCourier } = loadCancel();
  const sfx = async () => answer(200, { responseCode: 400, responseMsg: 'Order cannot be cancelled' });
  const dlv = async () => answer(200, '<status>False</status><remark>Cannot be cancelled</remark>');
  assert.equal((await cancelAtCourier(sfx, 'shadowfax', 'A1', 'tok', 'production')).cancelled, false);
  assert.equal((await cancelAtCourier(dlv, 'delhivery', 'A1', 'tok', '')).cancelled, false);
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

test('the create call is wrapped so a throw cannot be mistaken for a refusal', () => {
  const fn = BOOK.slice(BOOK.indexOf('async function bookShipment('));
  const create = fn.indexOf('await deps.fetch(url, init)');
  const around = fn.slice(Math.max(0, create - 200), create + 300);
  assert.match(around, /try \{/, 'the create call is inside a try');
  assert.match(around, /bookingUnknown\(name, reference\)/, 'and a throw becomes the unknown state');
});

// ── anti-drift: the duplicated cancel logic ─────────────────────────────────

test('the cleanup cancel matches shipping-ops, success test included', () => {
  // Each edge function deploys alone, so this logic is duplicated on purpose.
  // Pinning the two copies is what keeps the duplication honest.
  for (const bit of [
    "/v3/clients/orders/cancel/",
    "request_id: awb",
    '/api/p/edit',
    "waybill: String(awb), cancellation: 'true'",
  ]) {
    assert.ok(OPS.includes(bit), `shipping-ops still uses ${bit}`);
    assert.ok(BOOK.includes(bit), `and shipping-book does too: ${bit}`);
  }
  // B2B closed the divergence PR2 recorded: both copies now use the strict
  // tests, byte for byte.
  const body = (src, name) => {
    const ls = src.split('\n');
    const h = ls.findIndex((l) => l.startsWith(`function ${name}(`));
    let t = h;
    while (ls[t] !== '}') t++;
    return ls.slice(h, t + 1).join('\n');
  };
  for (const n of ['shadowfaxCancelConfirmed', 'delhiveryCancelConfirmed']) {
    assert.equal(body(BOOK, n), body(OPS, n), `${n} is identical in both`);
  }
  const loose = /cd\?\.responseCode === 200 \|\| \/cancel\/i\.test\(cd\?\.responseMsg \|\| ''\)/;
  assert.doesNotMatch(OPS, loose);
  assert.doesNotMatch(BOOK, loose, 'the loose test is gone from shipping-book too');
});

// ── scope guards ────────────────────────────────────────────────────────────

test('booking does not begin rebooking', () => {
  // "cancel→rebook" appears in comments about courier references, so this has
  // to read the code and not the prose around it.
  const code = BOOK.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
  assert.equal(/rebook/i.test(code), false, 'no rebooking action in the code itself');
  assert.equal(/shipment_attempts/.test(BOOK), false, 'the ledger table is reached only through RPCs');
  assert.match(BOOK, /if \(order\.awb\) \{/, 'an existing AWB still blocks booking outright');
  assert.equal(/\.update\(/.test(code), false, 'and booking never writes an order row itself');
});

test('authorization and tenancy are untouched', () => {
  assert.match(BOOK, /verify_store_pin/, 'the PIN gate stays');
  // Measured inside the handler: readCurrentShipment is a top-level helper that
  // also touches orders, and it is declared above serve() by definition.
  const handler = BOOK.slice(BOOK.indexOf('serve(async (req)'));
  const pin = handler.indexOf('verify_store_pin');
  const order = handler.indexOf(".from('orders')");
  assert.ok(pin > -1 && order > -1 && pin < order, 'and it runs before any order is read');
  const reads = BOOK.match(/\.eq\('id', order(?:Id|\.id)\)[^\n]*/g) || [];
  assert.ok(reads.length >= 2, 'every order read is still addressed by id');
  for (const r of reads) assert.match(r, /store_slug/, 'and scoped to the store');
  // every ledger RPC carries the store it acts for
  const rpcArgs = BOOK.match(/p_store_slug:\s*c\.slug/g) || [];
  assert.ok(rpcArgs.length >= 5, 'claim, finalize, fail, supersede all name the store');
});

test('no courier credential can reach the browser', () => {
  const returned = BOOK.match(/return json\(\{[\s\S]{0,300}?\}\)/g) || [];
  for (const r of returned) {
    assert.equal(/api_token|Authorization|service_role|SUPABASE_SERVICE/.test(r), false,
      `a response must not carry credentials: ${r.slice(0, 80)}`);
  }
});

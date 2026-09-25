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
  const r = bookingConflict('superseded', true, 'SF-OURS', { awb: 'SF-WINNER', courier: 'shadowfax' });
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
  const r = bookingConflict('unattached', true, 'DL-OURS', null);
  assert.match(r.error, /cancelled with the courier/);
  assert.match(r.error, /try booking again/);
  assert.equal(r.awb, undefined, 'no AWB is claimed');
  assert.equal(r.needsReconciliation, undefined, 'nothing is left hanging');
});

test('COMPENSATION FAILURE is never dressed up as success or as a simple retry', () => {
  const { bookingConflict } = load(['bookingConflict']);
  for (const kind of ['superseded', 'unattached']) {
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

test('both providers re-read the order BEFORE deciding anything', () => {
  for (const [name, marker] of [['shadowfax', 'sAttach'], ['delhivery', 'dAttach']]) {
    const at = BOOK.indexOf(`classifyAttach(${marker}.error, ${marker}.data) !== 'ok'`);
    assert.notEqual(at, -1, `${name}: a non-ok attach is still handled`);
    const block = BOOK.slice(at, at + 900);
    const read = block.indexOf('readCurrentShipment(');
    const cancel = block.indexOf('cancelAtCourier(');
    assert.ok(read > -1, `${name}: the database is re-read`);
    assert.ok(cancel > -1, `${name}: compensation is still available`);
    assert.ok(read < cancel, `${name}: and the re-read happens FIRST`);
    assert.match(block, /attachVerdict\(/, `${name}: the verdict decides, not the write's report`);
    assert.match(block, /verdict !== 'attached'/, `${name}: an attached AWB is left alone`);
    assert.match(block, /verdict === 'unknown'/, `${name}: and an unknown verdict cancels nothing`);
    assert.match(block, /bookingConflict\(/, `${name}: the answer says what happened`);
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

test('the cancel calls match shipping-ops; the success test diverges until B2B', () => {
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
  // The SUCCESS test is where the two copies now deliberately differ. PR2
  // hardened shipping-ops to explicit confirmation only. shipping-book's
  // compensation copy, cancelAtCourier, keeps the old loose test until B2B
  // rewrites shipping-book -- a KNOWN, recorded divergence. When B2B adopts the
  // strict test, replace the last two assertions with an identity pin.
  const loose = /cd\?\.responseCode === 200 \|\| \/cancel\/i\.test\(cd\?\.responseMsg \|\| ''\)/;
  assert.doesNotMatch(OPS, loose, 'shipping-ops no longer accepts a message that merely mentions cancel');
  assert.match(OPS, /function shadowfaxCancelConfirmed\(/);
  assert.match(OPS, /function delhiveryCancelConfirmed\(/);
  assert.match(BOOK, loose, 'KNOWN DIVERGENCE until B2B: shipping-book compensation still uses the loose test');
});

// ── the error path: an unheard answer is not a failed write ─────────────────
//
// A client/network error after the row was committed used to cancel our AWB
// while the order still pointed at it — PocketLink tracking a parcel it had
// just killed. The write's own report is no longer an input to that decision;
// the database is.

const verdictOf = () => load(['attachVerdict']).attachVerdict;

test('COMMITTED-BUT-ERROR: the write landed, so nothing may be cancelled', () => {
  const attachVerdict = verdictOf();
  assert.equal(attachVerdict('DL-A', { known: true, awb: 'DL-A', courier: 'delhivery' }), 'attached');
  assert.equal(attachVerdict(12345, { known: true, awb: '12345', courier: 'delhivery' }), 'attached',
    'an AWB is compared as text, whatever the courier handed back');
});

test('the attached verdict is the one case that never reaches compensation', () => {
  // bookingConflict has no 'attached' branch at all, and both call sites gate
  // on `verdict !== 'attached'` before they can reach cancelAtCourier.
  assert.equal(/'attached'/.test(BOOK.slice(BOOK.indexOf('function bookingConflict'),
    BOOK.indexOf('function bookingUnknown'))), false,
    'bookingConflict cannot answer for an attached shipment');
  for (const marker of ['sAttach', 'dAttach']) {
    const at = BOOK.indexOf(`classifyAttach(${marker}.error, ${marker}.data) !== 'ok'`);
    const block = BOOK.slice(at, at + 900);
    const gate = block.indexOf("verdict !== 'attached'");
    const cancel = block.indexOf('cancelAtCourier(');
    assert.ok(gate > -1 && gate < cancel, `${marker}: attached short-circuits before any cancel`);
  }
});

test('ANOTHER AWB WON: compensate ours, report theirs, never overwrite', () => {
  const attachVerdict = verdictOf();
  const { bookingConflict } = load(['bookingConflict', 'trackUrlFor']);
  assert.equal(attachVerdict('DL-OURS', { known: true, awb: 'DL-WINNER', courier: 'delhivery' }), 'superseded');
  const r = bookingConflict('superseded', true, 'DL-OURS', { awb: 'DL-WINNER', courier: 'delhivery' });
  assert.equal(r.awb, 'DL-WINNER');
  assert.equal(r.alreadyBooked, true);
  assert.equal(r.trackUrl, 'https://www.delhivery.com/track/package/DL-WINNER');
  assert.equal(JSON.stringify(r).includes('DL-OURS'), false, 'ours is gone, not reported');
});

test('DB STILL NULL: ours definitely never landed, so cancel it', () => {
  const attachVerdict = verdictOf();
  const { bookingConflict } = load(['bookingConflict']);
  assert.equal(attachVerdict('DL-OURS', { known: true, awb: null, courier: null }), 'unattached');
  assert.equal(attachVerdict('DL-OURS', { known: true, awb: '', courier: null }), 'unattached',
    'an empty string is no AWB either');
  const r = bookingConflict('unattached', true, 'DL-OURS', { awb: null, courier: null });
  assert.match(r.error, /cancelled with the courier/);
  assert.match(r.error, /try booking again/, 'nothing is live, so retrying is safe here');
  assert.equal(r.needsReconciliation, undefined);
});

test('RE-READ FAILED: cancel nothing, claim nothing, promise nothing', () => {
  const attachVerdict = verdictOf();
  const { bookingConflict } = load(['bookingConflict']);
  for (const cur of [{ known: false, awb: null }, { known: false, awb: 'DL-A' }, null, undefined]) {
    assert.equal(attachVerdict('DL-OURS', cur), 'unknown', 'an unreadable order is never "no AWB"');
  }
  const r = bookingConflict('unknown', false, 'DL-OURS', null);
  assert.equal(r.attachUnknown, true);
  assert.equal(r.needsReconciliation, true);
  assert.equal(r.orphanAwb, 'DL-OURS');
  assert.equal(r.alreadyBooked, undefined, 'no booking is claimed');
  assert.match(r.error, /could not be read back/);
  assert.match(r.error, /Do not book again/);
  assert.equal(/try booking again|please try again/i.test(r.error), false,
    'a blind retry could book a second live parcel');
});

test('an unknown verdict cannot reach the courier at all', () => {
  for (const marker of ['sAttach', 'dAttach']) {
    const at = BOOK.indexOf(`classifyAttach(${marker}.error, ${marker}.data) !== 'ok'`);
    const block = BOOK.slice(at, at + 900);
    assert.match(block, /verdict === 'unknown'\s*\n?\s*\?\s*\{ cancelled: false/,
      `${marker}: unknown short-circuits the cancel into a non-result`);
  }
});

test('compensation failure still wins over every verdict', () => {
  const { bookingConflict } = load(['bookingConflict']);
  for (const v of ['superseded', 'unattached']) {
    const r = bookingConflict(v, false, 'SF-ORPHAN', { awb: 'SF-WINNER', courier: 'shadowfax' });
    assert.equal(r.needsReconciliation, true, `${v}: a live orphan is always surfaced`);
    assert.equal(r.orphanAwb, 'SF-ORPHAN');
    assert.equal(r.alreadyBooked, undefined, `${v}: never dressed up as a booking`);
    assert.match(r.error, /Do not book again/);
  }
});

test('the decision tree is total: every verdict has exactly one answer', () => {
  const { bookingConflict } = load(['bookingConflict', 'trackUrlFor']);
  const seen = new Set();
  for (const v of ['superseded', 'unattached', 'unknown']) {
    for (const undone of [true, false]) {
      const r = bookingConflict(v, undone, 'X1', { awb: 'Y1', courier: 'delhivery' });
      assert.ok(r && (r.error || r.alreadyBooked), `${v}/${undone} answers something`);
      // An answer is either a booking or a problem, never silently both.
      assert.equal(Boolean(r.error) && Boolean(r.alreadyBooked), false, `${v}/${undone} is unambiguous`);
      seen.add(`${v}:${undone}`);
    }
  }
  assert.equal(seen.size, 6);
});

// ── scope guards ────────────────────────────────────────────────────────────

test('this PR does not begin rebooking', () => {
  // "cancel→rebook" appears in a pre-existing comment about Shadowfax order
  // ids, so this has to read the code and not the prose around it.
  const code = BOOK.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
  assert.equal(/rebook/i.test(code), false, 'no rebooking action in the code itself');
  assert.equal(/shipment_attempts/.test(BOOK), false, 'no attempt history table');
  assert.match(BOOK, /if \(order\.awb\) \{/, 'an existing AWB still blocks booking outright');
  const writes = BOOK.match(/\.update\(\{[^}]*\}\)/g) || [];
  for (const w of writes) {
    assert.equal(/awb:\s*null/.test(w), false, 'and booking never clears an AWB');
  }
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

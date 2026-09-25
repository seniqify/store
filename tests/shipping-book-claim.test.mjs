// B2B -- shipping-book on the atomic claim / finalize RPCs.
//
// Before B2B, two requests for one order could both reach the courier and both
// create a parcel; PR A only made sure one of them won the order and tried to
// cancel the other. Now every booking walks one flow, bookShipment:
//
//   claim_shipment_attempt -> (only 'claimed' goes on) -> courier create, ONCE,
//   with a reference that is a pure function of (order, attempt)
//     CREATED  -> finalize_shipment_attempt (one retry if unheard)
//                 order_awb_conflict -> strict cancel -> supersede ONLY on proof
//     REJECTED -> fail_shipment_attempt -- only for a refusal shape PROVEN per
//                 courier. None is proven, so no real reply is REJECTED today:
//                 every reply without an AWB, whatever its status, is UNKNOWN
//     UNKNOWN  -> the claim stays OPEN and blocks the order
//
// Everything here is EXECUTED: the .ts is transformed to JS and the real flow
// runs against a fake courier and a STATEFUL fake database that honours the
// RPCs' contracts -- including a claim that is atomic per call, so concurrent
// requests can be raced for real. The wiring inside serve() is source-pinned.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { transformWithOxc } from 'vite';

const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8')
  .replace(/\r\n/g, '\n');

const BOOK = read('supabase/functions/shipping-book/index.ts');
const OPS  = read('supabase/functions/shipping-ops/index.ts');
const B2A  = read('supabase/shipment-claim-forward.sql');
const B2A1 = read('supabase/shipment-terminal-forward.sql');

/** Source with comments removed. */
const codeOnly = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
  .map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');
const BOOK_CODE = codeOnly(BOOK);

// ── the harness ─────────────────────────────────────────────────────────────

const JS = (await transformWithOxc(BOOK, 'index.ts', { lang: 'ts' })).code;
assert.ok(JS && JS.length > 1000, 'shipping-book must transform before anything can be tested');

function load(names, scope = {}) {
  const parts = names.map((name) => {
    const head = JS.indexOf(`function ${name}(`);
    assert.notEqual(head, -1, `${name} is gone from shipping-book -- the test is no longer testing it`);
    const start = JS.lastIndexOf('\n', head) + 1;
    const open = JS.indexOf('{', head);
    let depth = 0;
    let i = open;
    for (; i < JS.length; i++) {
      if (JS[i] === '{') depth++;
      else if (JS[i] === '}') { depth--; if (depth === 0) break; }
    }
    return JS.slice(start, i + 1).replace(/^\s*(export\s+)?/, '');
  }).join('\n');
  const keys = Object.keys(scope);
  const make = new Function(...keys, `${parts}\nreturn { ${names.join(', ')} };`);
  return make(...keys.map((k) => scope[k]));
}

const BASE = 'https://track.delhivery.com';
const FLOW = [
  'trackUrlFor', 'readCurrentShipment', 'askRpc', 'orderHex', 'fnv1a32', 'delhiveryReference',
  'shadowfaxReference', 'jsonObject', 'createReason', 'mentionsDuplicate', 'shadowfaxCancelConfirmed',
  'delhiveryCancelConfirmed', 'cancelAtCourier', 'bookingUnknown', 'claimRefused',
  'finalizeUnheard', 'finalizeRefused', 'settleDuplicate', 'bookShipment',
];
const F = load([...FLOW, 'classifyShadowfaxCreate', 'classifyDelhiveryCreate'], { BASE });

// ── a stateful fake database that honours the RPC contracts ─────────────────

/**
 * One order and its attempts. Each RPC is decided synchronously after a single
 * yield, so concurrent callers interleave BETWEEN calls but never inside one --
 * which is what the real claim's row lock guarantees. `script` queues exact
 * answers ({data,error} or an Error to throw) that are used first.
 */
function ledgerDb({ orderAwb = null, orderCourier = null, script = {} } = {}) {
  const state = { orderAwb, orderCourier, attempts: [], nextId: 100 };
  const log = { rpc: [], writes: [] };
  const handlers = {
    claim_shipment_attempt(a) {
      if (state.orderAwb) return { outcome: 'already_booked', awb: state.orderAwb };
      const open = state.attempts.find((x) => x.end_reason === null);
      if (open) {
        return open.awb
          ? { outcome: 'open_with_awb', attempt_id: open.id, awb: open.awb }
          : { outcome: 'open_without_awb', attempt_id: open.id };
      }
      const no = state.attempts.reduce((m, x) => Math.max(m, x.attempt_no), 0) + 1;
      const row = { id: ++state.nextId, attempt_no: no, courier: a.p_courier, awb: null,
        end_reason: null, final_status: null };
      state.attempts.push(row);
      return { outcome: 'claimed', attempt_id: row.id, attempt_no: no, courier: a.p_courier };
    },
    finalize_shipment_attempt(a) {
      const att = state.attempts.find((x) => x.id === a.p_attempt_id);
      if (!att) return { outcome: 'attempt_not_found' };
      if (att.end_reason) return { outcome: 'attempt_terminal', end_reason: att.end_reason };
      if (att.courier !== a.p_courier) return { outcome: 'courier_mismatch', courier: att.courier };
      if (att.awb && att.awb !== a.p_awb) return { outcome: 'attempt_awb_conflict', awb: att.awb };
      if (state.orderAwb && state.orderAwb !== a.p_awb) return { outcome: 'order_awb_conflict', awb: state.orderAwb };
      if (att.awb === a.p_awb && state.orderAwb === a.p_awb) return { outcome: 'already_finalized', awb: a.p_awb };
      if (!att.awb && !state.orderAwb) {
        att.awb = a.p_awb; att.final_status = a.p_final_status;
        state.orderAwb = a.p_awb; state.orderCourier = a.p_courier;
        return { outcome: 'finalized', attempt_id: att.id, awb: a.p_awb };
      }
      return { outcome: att.awb ? 'partial_state_attempt_only' : 'partial_state_order_only' };
    },
    fail_shipment_attempt(a) {
      const att = state.attempts.find((x) => x.id === a.p_attempt_id);
      if (!att) return { outcome: 'attempt_not_found' };
      if (att.end_reason) return { outcome: 'attempt_terminal', end_reason: att.end_reason };
      if (att.awb) return { outcome: 'attempt_has_awb', awb: att.awb };
      att.end_reason = 'failed'; att.final_status = a.p_final_status;
      return { outcome: 'failed', attempt_id: att.id };
    },
    supersede_shipment_attempt(a) {
      const att = state.attempts.find((x) => x.id === a.p_attempt_id);
      if (!att) return { outcome: 'attempt_not_found' };
      if (state.orderAwb === a.p_awb) return { outcome: 'order_still_points_here' };
      if (att.end_reason) {
        return att.end_reason === 'superseded' && att.awb === a.p_awb
          ? { outcome: 'already_superseded' } : { outcome: 'attempt_terminal', end_reason: att.end_reason };
      }
      if (att.awb) return { outcome: 'attempt_has_awb', awb: att.awb };
      att.awb = a.p_awb; att.end_reason = 'superseded'; att.final_status = a.p_final_status;
      return { outcome: 'superseded', attempt_id: att.id };
    },
  };
  const from = (table) => {
    const chain = {
      select: () => chain, eq: () => chain, is: () => chain, limit: () => chain,
      update: (v) => { log.writes.push({ table, op: 'update', v }); return chain; },
      insert: (v) => { log.writes.push({ table, op: 'insert', v }); return chain; },
      upsert: (v) => { log.writes.push({ table, op: 'upsert', v }); return chain; },
      delete: () => { log.writes.push({ table, op: 'delete' }); return chain; },
      maybeSingle: async () => ({ data: { awb: state.orderAwb, courier: state.orderCourier }, error: null }),
    };
    return chain;
  };
  return {
    state, log, from,
    rpc: async (fn, args) => {
      log.rpc.push({ fn, args });
      await Promise.resolve();
      const q = script[fn];
      if (q && q.length) {
        const next = q.shift();
        if (next instanceof Error) throw next;
        return next;
      }
      if (!handlers[fn]) throw new Error(`unexpected RPC ${fn}`);
      return { data: handlers[fn](args), error: null };
    },
  };
}
const calls = (db, fn) => db.log.rpc.filter((r) => r.fn === fn);

/** A courier with scripted answers to create and cancel. */
function fakeCourier({ create = SFX_CREATED, cancel = SFX_CANCELLED, onCreate } = {}) {
  const seen = { create: [], cancel: [] };
  const fetch = async (url, init) => {
    const kind = /\/cancel\/|\/api\/p\/edit/.test(url) ? 'cancel' : 'create';
    seen[kind].push({ url, init });
    if (kind === 'create' && onCreate) onCreate();
    const r = kind === 'create' ? create : cancel;
    if (r instanceof Error) throw r;
    const text = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
    return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => text };
  };
  return { seen, fetch };
}

const SFX_CREATED = { status: 200, body: { message: 'Success', data: { awb_number: 'SFAWB0001', status: 'new' } } };
const DLV_CREATED = { status: 200, body: { success: true, packages: [{ waybill: 'DLAWB0001', status: 'Success' }] } };
const SFX_CANCELLED = { status: 200, body: { responseCode: 200, responseMsg: 'Order cancelled successfully' } };
const DLV_CANCELLED = { status: 200, body: '<root><status>True</status></root>' };

const ORDER = '3f2a9c1e-7b4d-4e8a-9c3b-1d2e3f4a5b6c';
const ctx = (over = {}) => {
  const provider = over.provider || 'shadowfax';
  return {
    slug: 'store-a', orderId: ORDER, provider, token: 'tok-SECRET-9', mode: 'production', shipCost: 55,
    request: (reference) => ({
      url: provider === 'shadowfax' ? 'https://dale.shadowfax.in/api/v3/clients/orders/' : `${BASE}/api/cmu/create.json`,
      init: { method: 'POST', body: JSON.stringify({ reference }) },
    }),
    ...over,
  };
};

async function book({ db = ledgerDb(), courier = fakeCourier(), c = ctx() } = {}) {
  const out = await F.bookShipment({ supabase: db, fetch: courier.fetch }, c);
  return { out, reply: out.reply, db, courier };
}
const referenceSent = (courier, i = 0) => JSON.parse(courier.seen.create[i].init.body).reference;

// ═══════════════════════════════════════════════════════════════════════════
// CLAIM -- only 'claimed' reaches the courier
// ═══════════════════════════════════════════════════════════════════════════

for (const n of [2, 5]) {
  test(`${n} simultaneous requests for one order => exactly ONE courier create`, async () => {
    const db = ledgerDb();
    const courier = fakeCourier();
    const outs = await Promise.all(Array.from({ length: n }, () =>
      F.bookShipment({ supabase: db, fetch: courier.fetch }, ctx())));
    assert.equal(courier.seen.create.length, 1, 'one parcel, however many clicks');
    assert.equal(outs.filter((o) => o.booked).length, 1);
    assert.equal(calls(db, 'claim_shipment_attempt').length, n, 'every request asked');
    assert.equal(db.state.attempts.length, 1, 'and exactly one attempt exists');
    for (const o of outs.filter((x) => !x.booked)) {
      assert.ok(o.reply.error, 'each loser is turned away with a reason');
    }
  });
}

const NOT_CLAIMED = [
  { outcome: 'already_booked', awb: 'EXISTING1' },
  { outcome: 'open_with_awb', attempt_id: 7, awb: 'LIVE1' },
  { outcome: 'open_without_awb', attempt_id: 7 },
  { outcome: 'order_not_bookable', status: 'cancelled' },
  { outcome: 'order_not_found' },
  { outcome: 'invalid_courier' },
  { outcome: 'race_lost' },
  { outcome: 'something_new' },
];

test('every non-claimed outcome => ZERO courier calls, and nothing else is asked', async () => {
  for (const data of NOT_CLAIMED) {
    const db = ledgerDb({ script: { claim_shipment_attempt: [{ data, error: null }] } });
    const { reply, courier } = await book({ db });
    assert.equal(courier.seen.create.length + courier.seen.cancel.length, 0, data.outcome);
    assert.deepEqual(db.log.rpc.map((r) => r.fn), ['claim_shipment_attempt'], data.outcome);
    assert.ok(reply.error || reply.alreadyBooked, data.outcome);
  }
});

test('an unheard claim contacts no courier and is not retried', async () => {
  for (const first of [new Error('timeout'), { data: null, error: { message: 'x' } }, { data: {}, error: null }]) {
    const db = ledgerDb({ script: { claim_shipment_attempt: [first] } });
    const { reply, courier } = await book({ db });
    assert.equal(courier.seen.create.length, 0);
    assert.equal(calls(db, 'claim_shipment_attempt').length, 1, 'never a second claim');
    assert.match(reply.error, /nothing was sent to the courier/);
  }
});

test('open_without_awb blocks -- a booking is in progress or unconfirmed', async () => {
  const db = ledgerDb();
  db.state.attempts.push({ id: 1, attempt_no: 1, courier: 'shadowfax', awb: null, end_reason: null });
  const { reply, courier } = await book({ db });
  assert.equal(courier.seen.create.length, 0);
  assert.equal(reply.bookingInProgress, true);
  assert.equal(reply.needsReconciliation, true);
});

test('open_with_awb blocks -- a live parcel not yet attached', async () => {
  const db = ledgerDb();
  db.state.attempts.push({ id: 1, attempt_no: 1, courier: 'shadowfax', awb: 'LIVE1', end_reason: null });
  const { reply, courier } = await book({ db });
  assert.equal(courier.seen.create.length, 0);
  assert.equal(reply.awb, 'LIVE1');
  assert.equal(reply.needsReconciliation, true);
});

test('already_booked does not call the courier, and reports the real shipment', async () => {
  const db = ledgerDb({ orderAwb: 'DLEXISTING', orderCourier: 'delhivery' });
  const { reply, courier } = await book({ db });
  assert.equal(courier.seen.create.length, 0);
  assert.equal(reply.alreadyBooked, true);
  assert.equal(reply.awb, 'DLEXISTING');
  assert.equal(reply.trackUrl, 'https://www.delhivery.com/track/package/DLEXISTING');
});

// ═══════════════════════════════════════════════════════════════════════════
// UNKNOWN -- the claim stays OPEN and blocking
// ═══════════════════════════════════════════════════════════════════════════

const UNKNOWN_CREATES = [
  ['a timeout', new Error('timed out')],
  ['a connection reset', new Error('ECONNRESET')],
  ['HTTP 500', { status: 500, body: { message: 'Internal error' } }],
  ['HTTP 502, HTML', { status: 502, body: '<html>Bad Gateway</html>' }],
  ['HTTP 200, not JSON', { status: 200, body: 'OK' }],
  ['HTTP 200, no AWB', { status: 200, body: { message: 'Failure', errors: 'Pincode not serviceable' } }],
  ['an AWB without a clean success', { status: 200, body: { message: 'Pending', data: { awb_number: 'SF9' } } }],
  ['an AWB on a 4xx', { status: 400, body: { message: 'Success', data: { awb_number: 'SF9' } } }],
  ['a duplicate reference, 400', { status: 400, body: { errors: 'client_order_id already exists' } }],
  ['a duplicate reference, 200', { status: 200, body: { errors: ['Duplicate client_order_id'] } }],
  ['HTTP 408', { status: 408, body: { errors: 'timeout' } }],
  ['HTTP 409', { status: 409, body: { errors: 'conflict' } }],
  ['HTTP 429', { status: 429, body: { errors: 'slow down' } }],
];

for (const [label, create] of UNKNOWN_CREATES) {
  test(`UNKNOWN (${label}): the claim stays OPEN, no fail, no retry`, async () => {
    const { reply, db, courier } = await book({ courier: fakeCourier({ create }) });
    assert.equal(courier.seen.create.length, 1, 'the courier create is never retried');
    assert.equal(calls(db, 'fail_shipment_attempt').length, 0, 'an unknown is never failed');
    assert.equal(calls(db, 'finalize_shipment_attempt').length, 0);
    const att = db.state.attempts[0];
    assert.equal(att.end_reason, null, 'the claim is still open');
    assert.equal(att.awb, null);
    assert.equal(reply.bookingUnknown, true);
    assert.equal(reply.needsReconciliation, true);
    assert.equal(reply.reference, referenceSent(courier), 'the merchant is told what to look for');
  });
}

test('UNKNOWN: an open claim then blocks the next booking outright', async () => {
  const db = ledgerDb();
  await book({ db, courier: fakeCourier({ create: new Error('timed out') }) });
  const second = fakeCourier();
  const { reply } = await book({ db, courier: second });
  assert.equal(second.seen.create.length, 0, 'no second parcel');
  assert.equal(reply.bookingInProgress, true);
});

test('UNKNOWN: a duplicate reference says so -- the first create may have succeeded', async () => {
  for (const [provider, create] of [
    ['shadowfax', { status: 400, body: { errors: 'client_order_id already exists' } }],
    ['delhivery', { status: 200, body: { success: false, packages: [{ waybill: '', remarks: ['Duplicate order id'] }] } }],
  ]) {
    const { reply, db } = await book({ courier: fakeCourier({ create }), c: ctx({ provider }) });
    assert.match(reply.error, /reference already exists/, provider);
    assert.equal(db.state.attempts[0].end_reason, null, `${provider}: never released`);
    assert.equal(calls(db, 'fail_shipment_attempt').length, 0, provider);
  }
});

test('UNKNOWN: Delhivery 2xx with remarks but no waybill is not treated as a refusal', async () => {
  const create = { status: 200, body: { success: false, rmk: 'x', packages: [{ status: 'Fail', waybill: '', remarks: ['Non serviceable pincode'] }] } };
  const { reply, db } = await book({ courier: fakeCourier({ create }), c: ctx({ provider: 'delhivery' }) });
  assert.equal(reply.bookingUnknown, true);
  assert.match(reply.error, /Non serviceable pincode/, 'the merchant still sees why');
  assert.equal(db.state.attempts[0].end_reason, null);
});

// ═══════════════════════════════════════════════════════════════════════════
// NO AWB => UNKNOWN, WHATEVER THE HTTP STATUS
//
// HTTP status alone never proves that nothing was created, and no refusal
// shape is proven for either courier: no staging evidence has been captured.
// So a generic 4xx -- 400, 401, 403, 404, 422 -- is UNKNOWN like every other
// reply without an AWB: no fail, the claim stays open, the order stays
// blocked. The bodies below are illustrative, not captured courier replies.
// ═══════════════════════════════════════════════════════════════════════════

const GENERIC_4XX = [400, 401, 403, 404, 422];
const NO_AWB_BODIES = [
  { message: 'Failure', errors: ['Pincode not serviceable'] },
  { errors: { pincode: ['Invalid pincode'] } },
  { detail: 'Invalid token.' },
  { success: false, rmk: 'Bad request', packages: [{ status: 'Fail', waybill: '', remarks: ['Invalid weight'] }] },
  { error: 'Forbidden' },
  {},
  'Not Found',
  '<html><body>Bad Request</body></html>',
  '',
];
const asText = (b) => (typeof b === 'string' ? b : JSON.stringify(b));
const CLASSIFY = { shadowfax: F.classifyShadowfaxCreate, delhivery: F.classifyDelhiveryCreate };

for (const status of GENERIC_4XX) {
  for (const provider of ['shadowfax', 'delhivery']) {
    test(`generic HTTP ${status} without an AWB (${provider}) => UNKNOWN: no fail, the claim stays OPEN`, async () => {
      for (const body of NO_AWB_BODIES) {
        const got = CLASSIFY[provider](status, asText(body));
        assert.equal(got.kind, 'unknown', `${status} ${asText(body)}`);
        assert.equal(got.duplicate, false, `${status} ${asText(body)}`);
      }
      const db = ledgerDb();
      const create = { status, body: NO_AWB_BODIES[0] };
      const { out, reply, courier } = await book({ db, courier: fakeCourier({ create }), c: ctx({ provider }) });
      assert.equal(out.booked, false);
      assert.equal(courier.seen.create.length, 1, 'the create is never retried');
      assert.equal(calls(db, 'fail_shipment_attempt').length, 0, 'a generic 4xx never calls fail');
      assert.equal(db.state.attempts[0].end_reason, null, 'the claim stays open');
      assert.equal(reply.bookingUnknown, true);
      assert.equal(reply.needsReconciliation, true);
      assert.match(reply.error, /Pincode not serviceable/, 'the merchant still sees what the courier said');
      const next = fakeCourier();
      const again = await book({ db, courier: next, c: ctx({ provider }) });
      assert.equal(next.seen.create.length, 0, 'the order stays blocked: no second parcel');
      assert.equal(again.reply.bookingInProgress, true);
    });
  }
}

test('EVERY HTTP status 0-599 without an AWB => UNKNOWN, for both couriers', () => {
  let n = 0;
  for (let status = 0; status < 600; status++) {
    for (const provider of ['shadowfax', 'delhivery']) {
      for (const body of NO_AWB_BODIES) {
        assert.equal(CLASSIFY[provider](status, asText(body)).kind, 'unknown', `${provider} ${status} ${asText(body)}`);
        n++;
      }
    }
  }
  assert.equal(n, 600 * 2 * NO_AWB_BODIES.length);
});

test('a duplicate-reference reply is UNKNOWN at EVERY status -- even beside an AWB', () => {
  const dup = {
    shadowfax: [
      { errors: 'client_order_id already exists' }, { message: 'Duplicate client_order_id' },
      { message: 'Success', data: { awb_number: 'SF1' }, errors: ['Duplicate client_order_id'] },
      'duplicate client_order_id',
    ],
    delhivery: [
      { rmk: 'Duplicate order id' }, { packages: [{ waybill: '', remarks: ['Duplicate order id'] }] },
      { packages: [{ waybill: 'DL1', remarks: ['Duplicate order id'] }] },
      'Duplicate order id',
    ],
  };
  for (let status = 0; status < 600; status++) {
    for (const provider of ['shadowfax', 'delhivery']) {
      for (const body of dup[provider]) {
        const got = CLASSIFY[provider](status, asText(body));
        assert.equal(got.kind, 'unknown', `${provider} ${status} ${asText(body)}`);
        assert.equal(got.duplicate, true, `${provider} ${status} ${asText(body)}`);
      }
    }
  }
});

test('a duplicate at any status never calls fail, and says the reference already exists', async () => {
  for (const status of [200, 400, 401, 403, 404, 409, 422, 500]) {
    for (const [provider, body] of [
      ['shadowfax', { errors: 'client_order_id already exists' }],
      ['delhivery', { packages: [{ waybill: '', remarks: ['Duplicate order id'] }] }],
    ]) {
      const { reply, db } = await book({ courier: fakeCourier({ create: { status, body } }), c: ctx({ provider }) });
      assert.equal(calls(db, 'fail_shipment_attempt').length, 0, `${provider} ${status}`);
      assert.equal(db.state.attempts[0].end_reason, null, `${provider} ${status}`);
      assert.match(reply.error, /reference already exists/, `${provider} ${status}`);
    }
  }
});

const REJECTION_LOOKING_2XX = [
  ['shadowfax', 200, { message: 'Failure', errors: ['Invalid pincode'] }],
  ['shadowfax', 201, { message: 'Failure', errors: 'Order could not be created' }],
  ['shadowfax', 200, { message: 'Success', data: { awb_number: '' } }],
  ['delhivery', 200, { success: false, rmk: 'Rejected', packages: [{ status: 'Fail', waybill: '', remarks: ['Non serviceable pincode'] }] }],
  ['delhivery', 200, { success: false, error: 'Invalid request' }],
  ['delhivery', 202, { packages: [] }],
];

for (const [provider, status, body] of REJECTION_LOOKING_2XX) {
  test(`a ${status} that LOOKS like a rejection, without an AWB (${provider}) => UNKNOWN, no fail`, async () => {
    assert.equal(CLASSIFY[provider](status, asText(body)).kind, 'unknown');
    const { reply, db } = await book({ courier: fakeCourier({ create: { status, body } }), c: ctx({ provider }) });
    assert.equal(calls(db, 'fail_shipment_attempt').length, 0);
    assert.equal(db.state.attempts[0].end_reason, null, 'the claim stays open');
    assert.equal(reply.bookingUnknown, true);
  });
}

test('5 simultaneous requests while the courier answers a generic 400 => ONE create, and no release', async () => {
  const db = ledgerDb();
  const courier = fakeCourier({ create: { status: 400, body: { errors: 'Invalid pincode' } } });
  const outs = await Promise.all(Array.from({ length: 5 }, () =>
    F.bookShipment({ supabase: db, fetch: courier.fetch }, ctx())));
  assert.equal(courier.seen.create.length, 1, 'one courier create, however many clicks');
  assert.equal(outs.filter((o) => o.reply.bookingUnknown).length, 1, 'the one that reached the courier');
  assert.equal(outs.filter((o) => o.reply.bookingInProgress).length, 4, 'the rest were turned away by the claim');
  assert.equal(calls(db, 'fail_shipment_attempt').length, 0);
  assert.equal(db.state.attempts.length, 1);
  assert.equal(db.state.attempts[0].end_reason, null, 'and the claim still blocks the order');
});

// ═══════════════════════════════════════════════════════════════════════════
// REJECTED -- reached ONLY through a refusal shape PROVEN for one courier
//
// None is proven, so with the REAL classifiers no reply reaches this branch;
// the first test below runs every reply in this file through them and counts
// zero fail_shipment_attempt calls. The branch is kept for the day a shape is
// evidenced, so its mechanics stay tested -- through a STAND-IN Shadowfax
// classifier that "proves" exactly one test-only shape and defers every other
// reply to the real one. Delhivery keeps its real classifier throughout.
// ═══════════════════════════════════════════════════════════════════════════

const PROVEN_TEST_ONLY = { status: 400, body: { test_only_proven_refusal: true, errors: ['Pincode not serviceable'] } };
const S = load(FLOW, {
  BASE,
  classifyShadowfaxCreate: (status, body) => (
    status === PROVEN_TEST_ONLY.status && body === JSON.stringify(PROVEN_TEST_ONLY.body)
      ? { kind: 'rejected', reason: 'Pincode not serviceable' }
      : F.classifyShadowfaxCreate(status, body)),
  classifyDelhiveryCreate: F.classifyDelhiveryCreate,
});
async function bookProven({ db = ledgerDb(), courier = fakeCourier(), c = ctx() } = {}) {
  const out = await S.bookShipment({ supabase: db, fetch: courier.fetch }, c);
  return { out, reply: out.reply, db, courier };
}

const EVERY_REPLY = [
  ...['shadowfax', 'delhivery'].flatMap((p) => UNKNOWN_CREATES.map(([, create]) => [p, create])),
  ...['shadowfax', 'delhivery'].flatMap((p) => GENERIC_4XX.flatMap((status) =>
    NO_AWB_BODIES.map((body) => [p, { status, body }]))),
  ...REJECTION_LOOKING_2XX.map(([p, status, body]) => [p, { status, body }]),
  ['shadowfax', SFX_CREATED], ['delhivery', DLV_CREATED],
  ['shadowfax', PROVEN_TEST_ONLY], ['delhivery', PROVEN_TEST_ONLY],
];

test('with the REAL classifiers, NO reply calls fail_shipment_attempt -- not even the test-only shape', async () => {
  const failed = [];
  for (const [provider, create] of EVERY_REPLY) {
    const { db } = await book({ courier: fakeCourier({ create }), c: ctx({ provider }) });
    if (calls(db, 'fail_shipment_attempt').length) failed.push(provider);
  }
  assert.ok(EVERY_REPLY.length > 100, `${EVERY_REPLY.length} replies`);
  assert.deepEqual(failed, []);
});

test('with one shape proven for Shadowfax, ONLY that exact reply to Shadowfax calls fail', async () => {
  const failed = [];
  for (const [provider, create] of EVERY_REPLY) {
    const { db } = await bookProven({ courier: fakeCourier({ create }), c: ctx({ provider }) });
    if (calls(db, 'fail_shipment_attempt').length) failed.push([provider, create]);
  }
  assert.deepEqual(failed, [['shadowfax', PROVEN_TEST_ONLY]], 'the same reply to Delhivery is not proof');
});

test('REJECTED (proven shape): fail_shipment_attempt releases the claim', async () => {
  const { reply, db, courier } = await bookProven({ courier: fakeCourier({ create: PROVEN_TEST_ONLY }) });
  assert.equal(courier.seen.create.length, 1);
  const fail = calls(db, 'fail_shipment_attempt');
  assert.equal(fail.length, 1);
  assert.deepEqual(fail[0].args, { p_attempt_id: db.state.attempts[0].id, p_store_slug: 'store-a',
    p_final_status: 'Pincode not serviceable' });
  assert.equal(calls(db, 'finalize_shipment_attempt').length, 0);
  assert.equal(db.state.attempts[0].end_reason, 'failed');
  assert.match(reply.error, /could not book this shipment: Pincode not serviceable/);
  assert.equal(reply.needsReconciliation, undefined, 'a proven refusal needs no reconciliation');
});

test('REJECTED (proven shape): a released claim permits a NEW claim, with a NEW reference, only via the RPCs', async () => {
  const db = ledgerDb();
  const first = fakeCourier({ create: PROVEN_TEST_ONLY });
  await bookProven({ db, courier: first });
  const second = fakeCourier();
  const { out } = await bookProven({ db, courier: second });
  assert.equal(out.booked, true);
  assert.equal(db.state.attempts.length, 2);
  assert.equal(db.state.attempts[1].attempt_no, 2);
  assert.notEqual(referenceSent(second), referenceSent(first), 'attempt 2 sends a different reference');
  assert.equal(db.log.writes.length, 0, 'the lifecycle moved only through RPCs');
});

test('REJECTED (proven shape): an unheard fail RPC is retried once, and never assumed', async () => {
  const db = ledgerDb({ script: { fail_shipment_attempt: [new Error('a'), new Error('b')] } });
  const { reply, courier } = await bookProven({ db, courier: fakeCourier({ create: PROVEN_TEST_ONLY }) });
  assert.equal(calls(db, 'fail_shipment_attempt').length, 2);
  assert.equal(courier.seen.create.length, 1);
  assert.equal(reply.needsReconciliation, true, 'the order may still be locked');
});

test('REJECTED (proven shape): only a failed attempt counts as released', async () => {
  const answers = [
    [{ outcome: 'attempt_terminal', end_reason: 'failed' }, true],
    [{ outcome: 'attempt_terminal', end_reason: 'superseded' }, false],
    [{ outcome: 'attempt_has_awb', awb: 'X1' }, false],
    [{ outcome: 'attempt_not_found' }, false],
  ];
  for (const [data, released] of answers) {
    const db = ledgerDb({ script: { fail_shipment_attempt: [{ data, error: null }] } });
    const { reply } = await bookProven({ db, courier: fakeCourier({ create: PROVEN_TEST_ONLY }) });
    assert.equal(reply.needsReconciliation, released ? undefined : true, JSON.stringify(data));
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// SUCCESS -- finalize writes the pair; shipping-book writes nothing itself
// ═══════════════════════════════════════════════════════════════════════════

test('a confirmed Shadowfax AWB calls finalize_shipment_attempt, exactly', async () => {
  const { out, db, courier } = await book();
  const claim = calls(db, 'claim_shipment_attempt')[0].args;
  assert.deepEqual(claim, { p_store_slug: 'store-a', p_order_id: ORDER, p_courier: 'shadowfax' });
  const fin = calls(db, 'finalize_shipment_attempt');
  assert.equal(fin.length, 1);
  assert.deepEqual(fin[0].args, {
    p_attempt_id: db.state.attempts[0].id, p_store_slug: 'store-a', p_courier: 'shadowfax',
    p_awb: 'SFAWB0001', p_shipping_cost: 55, p_final_status: 'new',
  });
  assert.equal(out.booked, true);
  assert.equal(out.awb, 'SFAWB0001');
  assert.deepEqual(out.reply, { awb: 'SFAWB0001', status: 'new' });
  assert.equal(courier.seen.create.length, 1);
  assert.equal(db.log.writes.length, 0, 'no direct orders.awb write');
  assert.equal(db.state.orderAwb, 'SFAWB0001', 'the order now points at the parcel');
});

test('a confirmed Delhivery waybill calls finalize with the package status', async () => {
  const { out, db } = await book({ courier: fakeCourier({ create: DLV_CREATED }), c: ctx({ provider: 'delhivery' }) });
  const fin = calls(db, 'finalize_shipment_attempt')[0].args;
  assert.equal(fin.p_courier, 'delhivery');
  assert.equal(fin.p_awb, 'DLAWB0001');
  assert.equal(fin.p_final_status, 'Success');
  assert.equal(out.booked, true);
});

test('the success reply carries the right tracking link per courier (handler wiring)', () => {
  assert.equal(F.trackUrlFor('shadowfax', 'SF1'), null);
  assert.equal(F.trackUrlFor('delhivery', 'DL1'), 'https://www.delhivery.com/track/package/DL1');
  assert.match(BOOK_CODE, /return json\(\{ \.\.\.booked\.reply, trackUrl: null, pickup: \{ scheduled: true, covered: true \} \}\);/);
  assert.match(BOOK_CODE, /return json\(\{ \.\.\.booked\.reply, trackUrl: `https:\/\/www\.delhivery\.com\/track\/package\/\$\{awb\}`, pickup \}\);/);
});

// ═══════════════════════════════════════════════════════════════════════════
// FINALIZE RETRY -- the database is asked again; the courier never is
// ═══════════════════════════════════════════════════════════════════════════

test('an unheard finalize => exactly ONE database retry, the courier still once', async () => {
  const db = ledgerDb({ script: { finalize_shipment_attempt: [new Error('reply lost')] } });
  const { out, courier } = await book({ db });
  const fin = calls(db, 'finalize_shipment_attempt');
  assert.equal(fin.length, 2);
  assert.deepEqual(fin[1].args, fin[0].args, 'identical arguments');
  assert.equal(courier.seen.create.length, 1);
  assert.equal(out.booked, true);
});

test('an unheard finalize whose retry says already_finalized is success', async () => {
  const db = ledgerDb({ script: { finalize_shipment_attempt: [new Error('reply lost'),
    { data: { outcome: 'already_finalized', awb: 'SFAWB0001' }, error: null }] } });
  const { out } = await book({ db });
  assert.equal(out.booked, true);
});

test('two unheard finalizes => reconciliation: no cancel, no fail, no courier retry', async () => {
  const db = ledgerDb({ script: { finalize_shipment_attempt: [new Error('a'), { data: null, error: { message: 'b' } }] } });
  const { out, reply, courier } = await book({ db });
  assert.equal(out.booked, false);
  assert.equal(calls(db, 'finalize_shipment_attempt').length, 2, 'never a third');
  assert.equal(courier.seen.create.length, 1);
  assert.equal(courier.seen.cancel.length, 0, 'the parcel may be attached -- it is not cancelled');
  assert.equal(calls(db, 'fail_shipment_attempt').length, 0);
  assert.equal(reply.needsReconciliation, true);
  assert.equal(reply.attachUnknown, true);
  assert.equal(reply.createdAwb, 'SFAWB0001');
  assert.match(reply.error, /Do not book again/);
});

// ═══════════════════════════════════════════════════════════════════════════
// FINALIZE OUTCOMES
// ═══════════════════════════════════════════════════════════════════════════

const RECONCILE = ['attempt_not_found', 'attempt_terminal', 'courier_mismatch', 'attempt_awb_conflict',
  'partial_state_attempt_only', 'partial_state_order_only', 'invalid_awb', 'something_new'];

test('every conflicting finalize outcome => reconciliation, and nothing is cancelled or failed', async () => {
  for (const outcome of RECONCILE) {
    const db = ledgerDb({ script: { finalize_shipment_attempt: [{ data: { outcome }, error: null }] } });
    const { out, reply, courier } = await book({ db });
    assert.equal(out.booked, false, outcome);
    assert.equal(reply.needsReconciliation, true, outcome);
    assert.equal(reply.orphanAwb, 'SFAWB0001', outcome);
    assert.equal(courier.seen.cancel.length, 0, `${outcome}: no cleanup on ambiguous evidence`);
    assert.equal(calls(db, 'fail_shipment_attempt').length, 0, outcome);
    assert.equal(calls(db, 'supersede_shipment_attempt').length, 0, outcome);
  }
});

test('drift: bookShipment names every outcome finalize_shipment_attempt can return', () => {
  const body = B2A.slice(B2A.indexOf('create or replace function public.finalize_shipment_attempt'),
    B2A.indexOf('create or replace function public.fail_shipment_attempt'));
  const sql = [...new Set([...body.matchAll(/'outcome',\s*'([a-z_]+)'/g)].map((m) => m[1]))];
  for (const o of sql) assert.ok(BOOK.includes(`case '${o}':`), `bookShipment names ${o}`);
});

// ═══════════════════════════════════════════════════════════════════════════
// CONFLICT -- order_awb_conflict: strict cleanup, supersede only on proof
// ═══════════════════════════════════════════════════════════════════════════

/** An old PR-A instance attaches ITS parcel while ours is being created. */
const oldInstanceWins = (db) => () => { db.state.orderAwb = 'OLDWINNER1'; db.state.orderCourier = 'shadowfax'; };

test('order_awb_conflict triggers cleanup; a CONFIRMED cancel supersedes our attempt', async () => {
  const db = ledgerDb();
  const courier = fakeCourier({ onCreate: oldInstanceWins(db) });
  const { out, reply } = await book({ db, courier });
  assert.equal(out.booked, false);
  assert.equal(courier.seen.cancel.length, 1);
  assert.match(courier.seen.cancel[0].init.body, /"request_id":"SFAWB0001"/, 'OUR parcel is the one cancelled');
  const sup = calls(db, 'supersede_shipment_attempt');
  assert.equal(sup.length, 1);
  assert.deepEqual(sup[0].args, { p_attempt_id: db.state.attempts[0].id, p_store_slug: 'store-a',
    p_courier: 'shadowfax', p_awb: 'SFAWB0001', p_final_status: 'Cancelled (duplicate)' });
  assert.equal(db.state.attempts[0].end_reason, 'superseded');
  assert.equal(reply.alreadyBooked, true);
  assert.equal(reply.awb, 'OLDWINNER1', 'the winner is reported, never ours');
  assert.equal(JSON.stringify(reply).includes('SFAWB0001'), false);
});

const UNCONFIRMED_CLEANUPS = [
  ['"cannot be cancelled" with code 200', 'shadowfax', { status: 200, body: { responseCode: 200, responseMsg: 'Order cannot be cancelled' } }],
  ['"cannot be cancelled" with code 400', 'shadowfax', { status: 400, body: { responseCode: 400, responseMsg: 'Order cannot be cancelled' } }],
  ['loose "cancelled" text', 'delhivery', { status: 200, body: 'Package cancelled' }],
  ['a Delhivery refusal', 'delhivery', { status: 200, body: '<status>False</status><remark>Cannot be cancelled</remark>' }],
  ['a timeout', 'shadowfax', new Error('timed out')],
  ['a 5xx', 'delhivery', { status: 503, body: '<status>True</status>' }],
];

for (const [label, provider, cancel] of UNCONFIRMED_CLEANUPS) {
  test(`UNCONFIRMED cleanup (${label}): no supersede, the claim stays OPEN and blocking`, async () => {
    const db = ledgerDb();
    const create = provider === 'shadowfax' ? SFX_CREATED : DLV_CREATED;
    const courier = fakeCourier({ create, cancel, onCreate: oldInstanceWins(db) });
    const { reply } = await book({ db, courier, c: ctx({ provider }) });
    assert.equal(courier.seen.cancel.length, 1);
    assert.equal(calls(db, 'supersede_shipment_attempt').length, 0, 'never supersede without proof');
    assert.equal(db.state.attempts[0].end_reason, null, 'the claim still blocks');
    assert.equal(reply.needsReconciliation, true);
    assert.ok(reply.orphanAwb, 'the live duplicate is named');
    assert.match(reply.error, /Do not book again/);
    assert.equal(reply.alreadyBooked, undefined, 'never reported as a clean booking');
  });
}

test('a confirmed Delhivery cleanup (XML or JSON boolean) supersedes too', async () => {
  for (const cancel of [DLV_CANCELLED, { status: 200, body: { status: true } }]) {
    const db = ledgerDb();
    const courier = fakeCourier({ create: DLV_CREATED, cancel, onCreate: oldInstanceWins(db) });
    await book({ db, courier, c: ctx({ provider: 'delhivery' }) });
    assert.equal(calls(db, 'supersede_shipment_attempt').length, 1);
    assert.equal(db.state.attempts[0].end_reason, 'superseded');
  }
});

test('an unheard supersede is retried once; a refused one is reconciliation', async () => {
  const retried = ledgerDb({ script: { supersede_shipment_attempt: [new Error('lost')] } });
  const r1 = await book({ db: retried, courier: fakeCourier({ onCreate: oldInstanceWins(retried) }) });
  assert.equal(calls(retried, 'supersede_shipment_attempt').length, 2);
  assert.equal(r1.reply.alreadyBooked, true);

  const refused = ledgerDb({ script: { supersede_shipment_attempt: [{ data: { outcome: 'attempt_awb_conflict' }, error: null }] } });
  const r2 = await book({ db: refused, courier: fakeCourier({ onCreate: oldInstanceWins(refused) }) });
  assert.equal(r2.reply.needsReconciliation, true);
  assert.equal(r2.reply.duplicateCancelled, true);
  assert.equal(r2.reply.alreadyBooked, undefined);
});

test('cleanup uses the SAME strict tests as shipping-ops, byte for byte', () => {
  const body = (src, name) => {
    const ls = src.split('\n');
    const h = ls.findIndex((l) => l.startsWith(`function ${name}(`));
    let t = h;
    while (ls[t] !== '}') t++;
    return ls.slice(h, t + 1).join('\n');
  };
  for (const n of ['shadowfaxCancelConfirmed', 'delhiveryCancelConfirmed']) {
    assert.equal(body(BOOK, n), body(OPS, n), n);
  }
  assert.equal(/\/cancel\/i\.test|cancell\?ed|"status"\\s\*:\\s\*true/.test(BOOK_CODE), false,
    'the loose tests are gone from shipping-book');
});

test('strict cleanup parsing: "cannot be cancelled" and loose "cancelled" are NOT success', () => {
  assert.equal(F.shadowfaxCancelConfirmed(true, JSON.stringify({ responseCode: 200, responseMsg: 'Order cannot be cancelled' })), false);
  assert.equal(F.shadowfaxCancelConfirmed(true, JSON.stringify({ responseCode: 400, responseMsg: 'cancelled' })), false);
  assert.equal(F.shadowfaxCancelConfirmed(true, JSON.stringify({ responseCode: 200, responseMsg: 'Order cancelled' })), true);
  assert.equal(F.delhiveryCancelConfirmed(true, 'Package cancelled'), false);
  assert.equal(F.delhiveryCancelConfirmed(true, '<status>True</status>'), true);
  assert.equal(F.delhiveryCancelConfirmed(true, JSON.stringify({ status: 'true' })), false);
  assert.equal(F.delhiveryCancelConfirmed(false, '<status>True</status>'), false);
});

// ═══════════════════════════════════════════════════════════════════════════
// DETERMINISTIC REFERENCE
// ═══════════════════════════════════════════════════════════════════════════

test('the same order + attempt always gives the same reference', () => {
  for (const n of [1, 2, 7, 99]) {
    assert.equal(F.delhiveryReference(ORDER, n), F.delhiveryReference(ORDER, n));
    assert.equal(F.shadowfaxReference(ORDER, n), F.shadowfaxReference(ORDER, n));
  }
});

test('a different attempt gives a different reference -- guaranteed within an order', () => {
  const d = new Set(); const s = new Set();
  for (let n = 1; n <= 5000; n++) {
    d.add(F.delhiveryReference(ORDER, n));
    s.add(F.shadowfaxReference(ORDER, n));
  }
  assert.equal(d.size, 5000);
  assert.equal(s.size, 5000);
});

test('Delhivery: exactly 8 characters, [0-9A-Z], led by the tail of the order id', () => {
  for (let n = 1; n <= 200; n++) {
    const ref = F.delhiveryReference(ORDER, n);
    assert.match(ref, /^[0-9A-Z]{8}$/);
    assert.equal(ref.slice(0, 4), '5B6C', 'the last 4 hex of the order id, as the live label always showed');
  }
});

test('Shadowfax: exactly 20 characters, [0-9a-z], led by the last 12 hex of the order id', () => {
  const ref = F.shadowfaxReference(ORDER, 1);
  assert.match(ref, /^[0-9a-z]{20}$/);
  assert.equal(ref, '1d2e3f4a5b6c00000001');
});

test('Shadowfax: a new reference can never equal one sent before B2B', () => {
  // Legacy: last 12 hex + Date.now().toString(36). Every Date.now() since 1972
  // is >= 36^7, so its 8 base36 digits never start with '0'.
  const legacy = '1d2e3f4a5b6c' + Date.now().toString(36);
  assert.equal(legacy.length, 20);
  assert.notEqual(legacy[12], '0');
  for (let n = 1; n <= 1000; n++) assert.equal(F.shadowfaxReference(ORDER, n)[12], '0');
  assert.ok(Date.now() >= 36 ** 7);
});

test('references refuse to exist when they cannot be valid', () => {
  for (const [id, n] of [['not-a-uuid', 1], [ORDER, 0], [ORDER, -1], [ORDER, 1.5], [ORDER, 'x'], [null, 1]]) {
    assert.equal(F.delhiveryReference(id, n), '', `${id}/${n}`);
    assert.equal(F.shadowfaxReference(id, n), '', `${id}/${n}`);
  }
});

test('the reference sent is the one for the CLAIMED attempt', async () => {
  for (const provider of ['shadowfax', 'delhivery']) {
    const create = provider === 'shadowfax' ? SFX_CREATED : DLV_CREATED;
    const { courier, db } = await book({ courier: fakeCourier({ create }), c: ctx({ provider }) });
    const n = db.state.attempts[0].attempt_no;
    const want = provider === 'shadowfax' ? F.shadowfaxReference(ORDER, n) : F.delhiveryReference(ORDER, n);
    assert.equal(referenceSent(courier), want, provider);
  }
});

test('if a claim cannot yield a reference, the claim is released and NOTHING is sent', async () => {
  const db = ledgerDb({ script: { claim_shipment_attempt: [{ data: { outcome: 'claimed', attempt_id: 5, attempt_no: 0 }, error: null }] } });
  const { reply, courier } = await book({ db });
  assert.equal(courier.seen.create.length, 0);
  assert.equal(calls(db, 'fail_shipment_attempt').length, 1, 'safe: no courier was contacted');
  assert.match(reply.error, /nothing was sent to the courier/);
});

// ═══════════════════════════════════════════════════════════════════════════
// The create classifiers, as pure functions
// ═══════════════════════════════════════════════════════════════════════════

test('Shadowfax classifier: created / unknown -- REJECTED is never returned', () => {
  const k = (s, b) => F.classifyShadowfaxCreate(s, asText(b)).kind;
  assert.equal(k(200, SFX_CREATED.body), 'created');
  assert.equal(k(201, SFX_CREATED.body), 'created');
  assert.equal(k(400, { errors: 'Invalid pincode' }), 'unknown', 'a 4xx without an AWB is not proof');
  assert.equal(k(401, 'unauthorised'), 'unknown', 'nor is a 401');
  assert.equal(k(200, { errors: 'Invalid pincode' }), 'unknown');
  assert.equal(k(500, { errors: 'x' }), 'unknown');
  assert.equal(k(0, ''), 'unknown');
  assert.equal(k(400, { errors: 'Duplicate client_order_id' }), 'unknown');
  assert.equal(k(400, 'duplicate'), 'unknown', 'a non-JSON body is scanned for duplicates too');
});

test('Delhivery classifier: created / unknown -- REJECTED is never returned', () => {
  const k = (s, b) => F.classifyDelhiveryCreate(s, asText(b)).kind;
  assert.equal(k(200, DLV_CREATED.body), 'created');
  assert.equal(k(200, { packages: [{ waybill: 12345 }] }), 'created', 'a numeric waybill is still a waybill');
  assert.equal(k(400, { rmk: 'bad request' }), 'unknown', 'a 4xx without a waybill is not proof');
  assert.equal(k(422, { rmk: 'Invalid weight' }), 'unknown', 'nor is a 422');
  assert.equal(k(200, { packages: [{ waybill: '', remarks: ['x'] }] }), 'unknown');
  assert.equal(k(200, { packages: [{ waybill: '', remarks: ['Duplicate order id'] }] }), 'unknown');
  assert.equal(k(502, 'gateway'), 'unknown');
  assert.equal(k(500, { packages: [{ waybill: 'DL1' }] }), 'unknown', 'a waybill on a 5xx is not a clean success');
});

test('CREATED: an explicit AWB on a clean 2xx success, exactly as before', () => {
  const sfx = (s, b) => F.classifyShadowfaxCreate(s, asText(b));
  const dlv = (s, b) => F.classifyDelhiveryCreate(s, asText(b));
  assert.deepEqual(sfx(200, SFX_CREATED.body), { kind: 'created', awb: 'SFAWB0001', status: 'new' });
  assert.deepEqual(sfx(201, { message: 'Success', data: { awb_number: ' SF7 ' } }), { kind: 'created', awb: 'SF7', status: 'new' });
  assert.deepEqual(sfx(200, { message: 'Success', data: { awb_number: 'SF8', status: 'pickup_scheduled' } }),
    { kind: 'created', awb: 'SF8', status: 'pickup_scheduled' });
  assert.deepEqual(dlv(200, DLV_CREATED.body), { kind: 'created', awb: 'DLAWB0001', status: 'Success' });
  assert.deepEqual(dlv(200, { packages: [{ waybill: 12345 }] }), { kind: 'created', awb: '12345', status: 'Manifested' });
  // an AWB beside anything short of a clean success is still UNKNOWN
  assert.equal(sfx(400, { message: 'Success', data: { awb_number: 'SF9' } }).kind, 'unknown');
  assert.equal(sfx(200, { message: 'Pending', data: { awb_number: 'SF9' } }).kind, 'unknown');
  assert.equal(dlv(500, { packages: [{ waybill: 'DL1' }] }).kind, 'unknown');
  assert.equal(dlv(200, 'waybill DL1').kind, 'unknown', 'a non-JSON body is not a clean success');
});

test('a success body that merely echoes the word "duplicate" in data is not misread', () => {
  // Only the courier's message fields are scanned when the body is JSON.
  const body = { message: 'Success', data: { awb_number: 'SF1', address: 'Duplicate Lane' } };
  assert.equal(F.classifyShadowfaxCreate(200, JSON.stringify(body)).kind, 'created');
});

// ═══════════════════════════════════════════════════════════════════════════
// Nothing leaks
// ═══════════════════════════════════════════════════════════════════════════

test('no reply carries the courier token or a raw provider body', async () => {
  const leaky = { status: 500, body: { message: 'boom', token: 'tok-SECRET-9', stack: 'secret' } };
  const scenarios = [
    book({ courier: fakeCourier({ create: leaky }) }),
    book({ courier: fakeCourier({ create: new Error('tok-SECRET-9') }) }),
    book(),
  ];
  for (const { reply } of await Promise.all(scenarios)) {
    const s = JSON.stringify(reply);
    assert.equal(s.includes('tok-SECRET-9'), false, s);
    assert.equal(s.includes('stack'), false, s);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// SOURCE-PINNED -- the wiring inside serve()
// ═══════════════════════════════════════════════════════════════════════════

test('source: in bookShipment the claim comes BEFORE the courier create', () => {
  const fn = BOOK_CODE.slice(BOOK_CODE.indexOf('async function bookShipment('));
  const claim = fn.indexOf("'claim_shipment_attempt'");
  const create = fn.indexOf('deps.fetch(url, init)');
  assert.ok(claim > 0 && create > claim);
  assert.match(fn.slice(claim, create), /if \(claim\.outcome !== 'claimed'\)/);
});

test('source: the only courier create call is the one inside bookShipment', () => {
  // The create URLs are built in the handler but only ever fetched by bookShipment.
  assert.equal([...BOOK_CODE.matchAll(/deps\.fetch\(/g)].length, 1);
  const handler = BOOK_CODE.slice(BOOK_CODE.indexOf('serve(async (req)'));
  assert.equal(/await fetch\(`\$\{sBase\}\/v3\/clients\/orders\/`/.test(handler), false);
  assert.equal(/await fetch\(`\$\{BASE\}\/api\/cmu\/create\.json`/.test(handler), false);
});

test('source: local validation happens before any claim, in both branches', () => {
  const handler = BOOK_CODE.slice(BOOK_CODE.indexOf('serve(async (req)'));
  const pin = handler.indexOf('verify_store_pin');
  const guard = handler.indexOf('if (order.awb) {');
  const idCheck = handler.indexOf('if (!orderHex(order.id))');
  const sfxPin = handler.indexOf("return json({ error: 'No valid 6-digit pincode");
  const sfxBook = handler.indexOf("provider: 'shadowfax'");
  const dlvPin = handler.lastIndexOf("return json({ error: 'No valid 6-digit pincode");
  const dlvBook = handler.indexOf("provider: 'delhivery'");
  assert.ok(pin > 0 && pin < guard && guard < idCheck, 'PIN, then the AWB guard, then the id check');
  assert.ok(idCheck < sfxPin && sfxPin < sfxBook, 'Shadowfax: pincode validated before bookShipment');
  assert.ok(dlvPin > sfxBook && dlvPin < dlvBook, 'Delhivery: pincode validated before bookShipment');
});

test('source: HTTP status alone can never release a claim', () => {
  assert.equal(/isRefusalStatus/.test(BOOK), false, 'the generic 4xx rule is gone');
  for (const name of ['classifyShadowfaxCreate', 'classifyDelhiveryCreate']) {
    const start = BOOK_CODE.indexOf(`function ${name}(`);
    const body = BOOK_CODE.slice(start, BOOK_CODE.indexOf('\n}\n', start));
    assert.ok(start > 0 && body.length > 200, name);
    assert.equal(/'rejected'/.test(body), false, `${name} returns no REJECTED: no refusal shape is proven`);
    assert.equal(/\b4\d\d\b|status\s*>=\s*4|status\s*<\s*5/.test(body), false, `${name} reads no 4xx status`);
  }
  // fail_shipment_attempt: once for a reference that cannot be built (nothing
  // was sent), and in the REJECTED branch with its one retry. Nowhere else.
  assert.equal([...BOOK_CODE.matchAll(/'fail_shipment_attempt'/g)].length, 3);
});

test('source: shipping-book writes no order row itself, and never names the ledger table', () => {
  assert.equal(/\.update\(/.test(BOOK_CODE), false);
  assert.equal(/\.insert\(/.test(BOOK_CODE), false);
  assert.equal(BOOK.includes('shipment_attempts'), false);
});

test('source: no clock-based or random reference survives', () => {
  assert.equal(/Date\.now\(\)\.toString\(36\)/.test(BOOK_CODE), false);
  assert.equal(/Math\.random|crypto\.randomUUID/.test(BOOK_CODE), false);
});

test('source: the PR A guard -- an existing AWB never reaches the claim -- stays', () => {
  assert.match(BOOK, /if \(order\.awb\) \{/);
});

test('scope: B2B does not start rebooking or touch shipping-ops', () => {
  assert.equal(/rebook/i.test(BOOK_CODE), false);
  assert.equal(BOOK.includes('cancel_current_shipment'), false, 'cancellation stays in shipping-ops');
  assert.ok(OPS.includes("rpc('cancel_current_shipment'"), 'shipping-ops is as PR2 left it');
  void B2A1;
});

// PR2 -- shipping-ops cancellation hardening.
//
// Cancelling clears the order's AWB and closes the shipment's ledger attempt,
// both for good. Before this, shipping-ops did both on the word of a regex:
// Shadowfax "succeeded" when its message matched /cancel/i -- which "Order
// cannot be cancelled" does -- and Delhivery when the body contained
// "cancelled" anywhere. The AWB was then cleared directly, and the ledger was
// never told.
//
// Now one flow, cancelShipment, sits behind three gates, in order:
//   1. the ORDER's own terminal evidence, checked before any courier call
//   2. an EXPLICIT courier confirmation -- nothing weaker counts
//   3. cancel_current_shipment as the only write, every outcome named
//
// Everything here is EXECUTED: the .ts is transformed to JS and the real flow
// runs against a fake courier and a fake database that records every call and
// every write. Only the wiring inside serve() is pinned against the source.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { transformWithOxc } from 'vite';

const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8')
  .replace(/\r\n/g, '\n');

const OPS  = read('supabase/functions/shipping-ops/index.ts');
const BOOK = read('supabase/functions/shipping-book/index.ts');
const B1   = read('supabase/shipment-attempts-forward.sql');
const B2A1 = read('supabase/shipment-terminal-forward.sql');

/** Source with // line comments and /* block comments *\/ removed. */
const codeOnly = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
  .map((l) => l.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n');
const OPS_CODE = codeOnly(OPS);

// ── the harness ─────────────────────────────────────────────────────────────

const JS = (await transformWithOxc(OPS, 'index.ts', { lang: 'ts' })).code;
assert.ok(JS && JS.length > 1000, 'shipping-ops must transform before anything can be tested');

/** Pull top-level functions out of the transformed module and run them. */
function load(names, scope = {}) {
  const parts = names.map((name) => {
    const head = JS.indexOf(`function ${name}(`);
    assert.notEqual(head, -1, `${name} is gone from shipping-ops -- the test is no longer testing it`);
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
const {
  terminalEvidence, shadowfaxCancelConfirmed, delhiveryCancelConfirmed, providerSays,
  cancelOutcomeReply, cancelShipment,
} = load(['terminalEvidence', 'shadowfaxCancelConfirmed', 'delhiveryCancelConfirmed', 'providerSays',
  'pointerNow', 'callCancelRpc', 'recordNotUpdated', 'cancelOutcomeReply', 'cancelShipment'], { BASE });

/**
 * A database that records every RPC, read and write. `rpc` is one answer used
 * for every call, or an ARRAY of answers used in order (an Error is thrown),
 * so a retry can be scripted call by call.
 */
function fakeDb({ rpc = { data: { outcome: 'cancelled' }, error: null },
                  pointer = { data: { awb: null }, error: null } } = {}) {
  const queue = Array.isArray(rpc) ? [...rpc] : null;
  const log = { rpc: [], reads: [], writes: [] };
  const from = (table) => {
    const chain = {
      select: () => chain, eq: () => chain, is: () => chain, limit: () => chain,
      update: (v) => { log.writes.push({ table, op: 'update', v }); return chain; },
      insert: (v) => { log.writes.push({ table, op: 'insert', v }); return chain; },
      upsert: (v) => { log.writes.push({ table, op: 'upsert', v }); return chain; },
      delete: () => { log.writes.push({ table, op: 'delete' }); return chain; },
      maybeSingle: async () => {
        log.reads.push(table);
        if (pointer instanceof Error) throw pointer;
        return pointer;
      },
      then: (res) => res({ data: null, error: null }),
    };
    return chain;
  };
  return {
    log,
    from,
    rpc: async (name, args) => {
      log.rpc.push({ name, args });
      const next = queue ? (queue.length ? queue.shift() : new Error('no more RPC answers scripted')) : rpc;
      if (next instanceof Error) throw next;
      return next;
    },
  };
}

/** A courier that records every call and answers with (status, body). */
function fakeCourier(status, body) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    if (status instanceof Error) throw status;
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return { ok: status >= 200 && status < 300, status, text: async () => text };
  };
  return { calls, fetch };
}

const ctx = (over = {}) => ({
  slug: 'store-a', orderId: 'order-1', provider: 'shadowfax', awb: 'SF123',
  token: 'tok-SECRET-123', mode: 'production',
  order: { shipment_status: 'Bag In Transit', shipment_outcome: null },
  ...over,
});
const SFX_OK = { responseCode: 200, responseMsg: 'Order cancelled successfully' };
const DLV_OK = '<?xml version="1.0"?><root><status>True</status></root>';

/** Run the whole flow once; return the reply and everything it touched. */
async function run({ courier = fakeCourier(200, SFX_OK), db = fakeDb(), c = ctx() } = {}) {
  const reply = await cancelShipment({ supabase: db, fetch: courier.fetch }, c);
  return { reply, courier, db };
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. Shadowfax: explicit confirmation only
// ═══════════════════════════════════════════════════════════════════════════

/** The predicate this PR replaces, verbatim in behaviour. */
const oldShadowfax = (cd) => cd?.responseCode === 200 || /cancel/i.test(cd?.responseMsg || '');

test('Shadowfax: "cannot be cancelled" is NOT success -- whatever the code says', () => {
  for (const code of [400, 422, 500, 200]) {
    const body = { responseCode: code, responseMsg: 'Order cannot be cancelled' };
    assert.equal(shadowfaxCancelConfirmed(true, JSON.stringify(body)), false, `code ${code}`);
  }
});

test('Shadowfax: ...which the old test accepted, the defect being fixed', () => {
  assert.equal(oldShadowfax({ responseCode: 400, responseMsg: 'Order cannot be cancelled' }), true);
});

test('Shadowfax: arbitrary text containing "cancel" is NOT success', () => {
  for (const body of [
    { responseCode: 500, responseMsg: 'cancel request received' },
    { responseCode: 400, responseMsg: 'Cancellation failed' },
    { responseMsg: 'Order cancelled' },                       // no code at all
    { responseCode: '200', responseMsg: 'Order cancelled' },  // a string is not the number
    { responseCode: 200, responseMsg: 'Cancellation not allowed after pickup' },
    { responseCode: 200, responseMsg: 'Unable to cancel' },
  ]) {
    assert.equal(shadowfaxCancelConfirmed(true, JSON.stringify(body)), false, JSON.stringify(body));
  }
  assert.equal(shadowfaxCancelConfirmed(true, 'cancelled'), false, 'plain text is not JSON');
});

test('Shadowfax: an explicit confirmation is success', () => {
  assert.equal(shadowfaxCancelConfirmed(true, JSON.stringify(SFX_OK)), true);
  assert.equal(shadowfaxCancelConfirmed(true, JSON.stringify({ responseCode: 200 })), true);
});

test('Shadowfax: an HTTP failure or a malformed body is never success', () => {
  assert.equal(shadowfaxCancelConfirmed(false, JSON.stringify(SFX_OK)), false, 'HTTP 5xx with a 200 body');
  for (const bad of ['', '{', 'null', '[]', '[{"responseCode":200}]', '<html>502</html>']) {
    assert.equal(shadowfaxCancelConfirmed(true, bad), false, JSON.stringify(bad));
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Delhivery: explicit confirmation only
// ═══════════════════════════════════════════════════════════════════════════

test('Delhivery: <status>True</status> is success', () => {
  assert.equal(delhiveryCancelConfirmed(true, DLV_OK), true);
  assert.equal(delhiveryCancelConfirmed(true, '<status> true </status>'), true);
});

test('Delhivery: a JSON body whose status is the boolean true is success', () => {
  assert.equal(delhiveryCancelConfirmed(true, JSON.stringify({ status: true })), true);
  assert.equal(delhiveryCancelConfirmed(true, JSON.stringify({ status: true, remark: 'done' })), true);
});

test('Delhivery: "cancelled" text alone is NOT success', () => {
  for (const t of ['Package cancelled', 'cancelled', 'CANCELLED successfully', 'cancel']) {
    assert.equal(delhiveryCancelConfirmed(true, t), false, t);
  }
});

test('Delhivery: a refusal, or mixed statuses, is NOT success', () => {
  assert.equal(delhiveryCancelConfirmed(true, '<status>False</status><remark>Cannot be cancelled</remark>'), false);
  assert.equal(delhiveryCancelConfirmed(true, '<status>True</status><status>False</status>'), false);
});

test('Delhivery: JSON-ish text, the string "true" and malformed JSON are NOT success', () => {
  for (const t of [
    'ok "status": true done',            // a JSON fragment inside non-JSON text
    '{"status": true',                   // malformed JSON
    JSON.stringify({ status: 'true' }),  // the string is not the boolean
    JSON.stringify({ status: false }),
    JSON.stringify([{ status: true }]),  // not an object
    'true', 'null', '',
  ]) {
    assert.equal(delhiveryCancelConfirmed(true, t), false, t);
  }
});

test('Delhivery: HTTP 4xx / 5xx is never success, whatever the body says', () => {
  assert.equal(delhiveryCancelConfirmed(false, DLV_OK), false);
  assert.equal(delhiveryCancelConfirmed(false, JSON.stringify({ status: true })), false);
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. The order-side terminal gate
// ═══════════════════════════════════════════════════════════════════════════

test('terminal gate: shipment_outcome delivered / returned / lost', () => {
  for (const o of ['delivered', 'returned', 'lost']) {
    assert.equal(terminalEvidence({ shipment_outcome: o, shipment_status: 'Bag In Transit' }), o);
  }
});

test('terminal gate: the raw status, read the way B1 reads it', () => {
  const cases = [
    ['Delivered', 'delivered'],
    ['RTO Delivered', 'returned'],          // the return family wins
    ['Returned To Seller', 'returned'],
    ['RTS', 'returned'],
    ['Lost', 'lost'],
    ['Undelivered', null],                  // not a delivery
    ['Not Delivered', null],                // not a delivery
    ['Bag In Transit', null],
    ['Cancelled', null],                    // not a reason to refuse
    ['', null],
  ];
  for (const [st, want] of cases) assert.equal(terminalEvidence({ shipment_status: st }), want, st);
});

test('terminal gate: the outcome outranks the raw status', () => {
  assert.equal(terminalEvidence({ shipment_outcome: 'returned', shipment_status: 'Delivered' }), 'returned');
});

test('terminal gate: return before lost before delivered', () => {
  assert.equal(terminalEvidence({ shipment_status: 'RTO - lost' }), 'returned');
  assert.equal(terminalEvidence({ shipment_status: 'Lost, not delivered' }), 'lost');
});

for (const [label, order] of [
  ['delivered', { shipment_outcome: 'delivered' }],
  ['returned',  { shipment_outcome: 'returned' }],
  ['lost',      { shipment_outcome: 'lost' }],
  ['delivered (status only)', { shipment_status: 'Delivered' }],
]) {
  test(`flow: a ${label} order is refused BEFORE the courier is called`, async () => {
    const { reply, courier, db } = await run({ c: ctx({ order }) });
    assert.equal(reply.cancelled, false);
    assert.ok(reply.terminal, 'the reply says why');
    assert.equal(courier.calls.length, 0, 'the courier was never contacted');
    assert.equal(db.log.rpc.length, 0, 'cancel_current_shipment was never called');
    assert.equal(db.log.writes.length, 0, 'nothing was written');
  });
}

test('flow: "Undelivered" and "Not Delivered" do NOT stop a cancellation', async () => {
  for (const st of ['Undelivered', 'Not Delivered']) {
    const { reply, courier } = await run({ c: ctx({ order: { shipment_status: st } }) });
    assert.equal(courier.calls.length, 1, st);
    assert.equal(reply.cancelled, true, st);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// No confirmation, no mutation
// ═══════════════════════════════════════════════════════════════════════════

test('flow: a network error changes nothing', async () => {
  for (const provider of ['shadowfax', 'delhivery']) {
    const courier = fakeCourier(new Error('ECONNRESET'));
    const { reply, db } = await run({ courier, c: ctx({ provider }) });
    assert.equal(reply.cancelled, false, provider);
    assert.equal(reply.courierUnreachable, true, provider);
    assert.equal(db.log.rpc.length, 0, `${provider}: no RPC`);
    assert.equal(db.log.writes.length, 0, `${provider}: no write`);
  }
});

test('flow: a malformed response changes nothing', async () => {
  for (const provider of ['shadowfax', 'delhivery']) {
    const courier = fakeCourier(200, '{"responseCode": 200,');
    const { reply, db } = await run({ courier, c: ctx({ provider }) });
    assert.equal(reply.cancelled, false, provider);
    assert.equal(db.log.rpc.length, 0, `${provider}: no RPC`);
    assert.equal(db.log.writes.length, 0, `${provider}: no write`);
  }
});

test('flow: a 5xx changes nothing, even with a confirming body', async () => {
  for (const [provider, body] of [['shadowfax', SFX_OK], ['delhivery', DLV_OK]]) {
    const { reply, db } = await run({ courier: fakeCourier(502, body), c: ctx({ provider }) });
    assert.equal(reply.cancelled, false, provider);
    assert.equal(db.log.rpc.length, 0, provider);
    assert.equal(db.log.writes.length, 0, provider);
  }
});

test('flow: a Shadowfax refusal changes nothing, and says what the courier said', async () => {
  const courier = fakeCourier(200, { responseCode: 200, responseMsg: 'Order cannot be cancelled' });
  const { reply, db } = await run({ courier });
  assert.equal(reply.cancelled, false);
  assert.equal(reply.courierConfirmed, false);
  assert.match(reply.error, /cannot be cancelled/);
  assert.equal(db.log.rpc.length, 0);
  assert.equal(db.log.writes.length, 0);
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Confirmation -> cancel_current_shipment, the only write
// ═══════════════════════════════════════════════════════════════════════════

test('flow: a confirmed Shadowfax cancellation calls cancel_current_shipment, exactly', async () => {
  const { reply, courier, db } = await run();
  assert.equal(courier.calls.length, 1);
  assert.match(courier.calls[0].url, /^https:\/\/dale\.shadowfax\.in\/api\/v3\/clients\/orders\/cancel\/$/);
  assert.equal(courier.calls[0].init.body, JSON.stringify({ request_id: 'SF123' }));
  assert.deepEqual(db.log.rpc, [{ name: 'cancel_current_shipment', args: {
    p_store_slug: 'store-a', p_order_id: 'order-1', p_courier: 'shadowfax',
    p_awb: 'SF123', p_final_status: 'Cancelled' } }]);
  assert.equal(db.log.writes.length, 0, 'the RPC is the only write');
  assert.equal(reply.cancelled, true);
});

test('flow: a confirmed Delhivery cancellation -- XML or JSON -- calls it too', async () => {
  for (const body of [DLV_OK, { status: true }]) {
    const { reply, courier, db } = await run({
      courier: fakeCourier(200, body), c: ctx({ provider: 'delhivery', awb: 'DL9' }) });
    assert.equal(courier.calls[0].url, `${BASE}/api/p/edit`);
    assert.equal(courier.calls[0].init.body, JSON.stringify({ waybill: 'DL9', cancellation: 'true' }));
    assert.equal(db.log.rpc.length, 1);
    assert.equal(db.log.rpc[0].args.p_courier, 'delhivery');
    assert.equal(db.log.writes.length, 0);
    assert.equal(reply.cancelled, true);
  }
});

test('flow: staging Shadowfax accounts cancel against staging', async () => {
  const { courier } = await run({ c: ctx({ mode: 'staging' }) });
  assert.match(courier.calls[0].url, /dale\.staging\.shadowfax\.in/);
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. Every RPC outcome, named
// ═══════════════════════════════════════════════════════════════════════════

const SUCCESS = ['cancelled', 'cancelled_pointer_was_clear'];
const CONDITIONAL = ['already_cancelled'];   // success only once the pointer reads clear
const REFUSAL = ['shipment_already_terminal', 'attempt_state_mismatch', 'attempt_not_found',
  'courier_mismatch', 'awb_mismatch', 'order_not_found', 'invalid_awb', 'invalid_courier',
  'transition_race'];

test('every RPC outcome: two are success outright, each refusal is reconciliation', async () => {
  for (const outcome of [...SUCCESS, ...REFUSAL]) {
    const db = fakeDb({ rpc: { data: { outcome }, error: null } });
    const { reply } = await run({ db });
    assert.equal(db.log.rpc.length, 1, `${outcome}: exactly one RPC call, no retry`);
    assert.equal(db.log.writes.length, 0, `${outcome}: no fallback write`);
    if (SUCCESS.includes(outcome)) {
      assert.equal(reply.cancelled, true, outcome);
    } else {
      assert.equal(reply.cancelled, false, outcome);
      assert.equal(reply.courierCancelled, true, `${outcome}: the courier did cancel`);
      assert.equal(reply.needsReconciliation, true, outcome);
      assert.equal(reply.outcome, outcome);
    }
  }
});

test('an outcome this code does not know is never success', () => {
  for (const o of ['cancelled ', 'CANCELLED', 'ok', '', null, undefined, 42]) {
    assert.equal(cancelOutcomeReply(o, 'Shadowfax').cancelled, false, String(o));
  }
});

test('transition_race does not trigger a fallback write', async () => {
  const db = fakeDb({ rpc: { data: { outcome: 'transition_race' }, error: null } });
  const { reply } = await run({ db });
  assert.equal(db.log.writes.length, 0);
  assert.equal(db.log.rpc.length, 1);
  assert.equal(reply.needsReconciliation, true);
});

test('attempt_not_found does not trigger a fallback write', async () => {
  const db = fakeDb({ rpc: { data: { outcome: 'attempt_not_found' }, error: null } });
  const { reply } = await run({ db });
  assert.equal(db.log.writes.length, 0);
  assert.equal(db.log.rpc.length, 1);
  assert.equal(reply.cancelled, false);
});

test('drift: the replies name exactly the outcomes cancel_current_shipment can return', () => {
  const body = B2A1.slice(B2A1.indexOf('create or replace function public.cancel_current_shipment'),
    B2A1.indexOf('create or replace function public.supersede_shipment_attempt'));
  const sql = new Set([...body.matchAll(/'outcome',\s*'([a-z_]+)'/g)].map((m) => m[1]));
  assert.deepEqual([...sql].sort(), [...SUCCESS, ...CONDITIONAL, ...REFUSAL].sort());
  for (const o of sql) assert.ok(OPS.includes(`case '${o}':`), `shipping-ops names ${o}`);
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. Race safety -- an unheard RPC answer is asked for ONCE more
// ═══════════════════════════════════════════════════════════════════════════
// The courier has already confirmed by the time the RPC runs, and is never
// asked again. cancel_current_shipment is idempotent, so a lost answer is safe
// to request once more. A cleared AWB is never, by itself, proof: during a
// rolling deploy an old shipping-ops instance clears orders.awb without
// closing the ledger.

const heard = (outcome) => ({ data: { outcome }, error: null });
const CLEAR = { data: { awb: null }, error: null };
const RETAINED = { data: { awb: 'SF123' }, error: null };
/** Every shape of "no usable answer". */
const UNHEARD = [
  new Error('socket hang up'),
  { data: null, error: { message: 'boom' } },
  { data: null, error: null },
  { data: {}, error: null },
  { data: { outcome: 7 }, error: null },
];

test('RPC unheard, then cancelled on the retry => success', async () => {
  for (const first of UNHEARD) {
    const db = fakeDb({ rpc: [first, heard('cancelled')] });
    const { reply, courier } = await run({ db });
    assert.equal(reply.cancelled, true, JSON.stringify(first));
    assert.equal(db.log.rpc.length, 2, 'exactly one retry');
    assert.deepEqual(db.log.rpc[1], db.log.rpc[0], 'with identical arguments');
    assert.equal(courier.calls.length, 1, 'the courier is never asked again');
    assert.equal(db.log.writes.length, 0);
  }
});

test('RPC unheard, then already_cancelled with the pointer clear => success (the first call had landed)', async () => {
  const db = fakeDb({ rpc: [new Error('reply lost'), heard('already_cancelled')], pointer: CLEAR });
  const { reply, courier } = await run({ db });
  assert.equal(reply.cancelled, true);
  assert.equal(reply.outcome, 'already_cancelled');
  assert.equal(db.log.rpc.length, 2);
  assert.equal(db.log.reads.length, 1, 'the pointer was checked');
  assert.equal(courier.calls.length, 1);
  assert.equal(db.log.writes.length, 0);
});

test('RPC unheard, then cancelled_pointer_was_clear => success (an old instance had cleared the pointer)', async () => {
  const db = fakeDb({ rpc: [new Error('timeout'), heard('cancelled_pointer_was_clear')] });
  const { reply, courier } = await run({ db });
  assert.equal(reply.cancelled, true);
  assert.equal(db.log.rpc.length, 2);
  assert.equal(courier.calls.length, 1);
  assert.equal(db.log.writes.length, 0);
});

test('two unheard RPC answers + a CLEARED pointer => reconciliation, NOT success', async () => {
  // The defect the review found: a cleared AWB used to be read as "recorded".
  const db = fakeDb({ rpc: [new Error('a'), new Error('b')], pointer: CLEAR });
  const { reply, courier } = await run({ db });
  assert.equal(reply.cancelled, false);
  assert.equal(reply.needsReconciliation, true);
  assert.equal(reply.courierCancelled, true);
  assert.equal(reply.outcome, 'unheard_pointer_clear');
  assert.equal(db.log.rpc.length, 2, 'never a third call');
  assert.equal(courier.calls.length, 1);
  assert.equal(db.log.writes.length, 0);
});

test('two unheard RPC answers + the pointer retained => reconciliation', async () => {
  const db = fakeDb({ rpc: [new Error('a'), { data: null, error: null }], pointer: RETAINED });
  const { reply, courier } = await run({ db });
  assert.equal(reply.cancelled, false);
  assert.equal(reply.needsReconciliation, true);
  assert.equal(reply.outcome, 'unheard_pointer_set');
  assert.equal(db.log.rpc.length, 2);
  assert.equal(courier.calls.length, 1);
  assert.equal(db.log.writes.length, 0);
});

test('two unheard RPC answers + an unreadable order => reconciliation', async () => {
  for (const pointer of [new Error('down'), { data: null, error: { message: 'x' } }]) {
    const db = fakeDb({ rpc: [new Error('a'), new Error('b')], pointer });
    const { reply } = await run({ db });
    assert.equal(reply.cancelled, false);
    assert.equal(reply.needsReconciliation, true);
    assert.equal(reply.outcome, 'unheard');
    assert.equal(db.log.writes.length, 0);
  }
});

test('a HEARD refusal is never retried -- only an unheard answer is', async () => {
  for (const o of REFUSAL) {
    const db = fakeDb({ rpc: [heard(o), heard('cancelled')] });
    const { reply } = await run({ db });
    assert.equal(db.log.rpc.length, 1, o);
    assert.equal(reply.cancelled, false, o);
  }
});

// ── already_cancelled changed nothing, so it needs the pointer's word ──────

test('already_cancelled + pointer clear => success', async () => {
  const db = fakeDb({ rpc: heard('already_cancelled'), pointer: CLEAR });
  const { reply } = await run({ db });
  assert.equal(reply.cancelled, true);
  assert.equal(db.log.reads.length, 1);
  assert.equal(db.log.writes.length, 0);
});

test('already_cancelled + the AWB retained => reconciliation, not success', async () => {
  const db = fakeDb({ rpc: heard('already_cancelled'), pointer: RETAINED });
  const { reply } = await run({ db });
  assert.equal(reply.cancelled, false);
  assert.equal(reply.needsReconciliation, true);
  assert.equal(reply.outcome, 'already_cancelled_awb_retained');
  assert.equal(db.log.writes.length, 0);
});

test('already_cancelled + an unreadable pointer => reconciliation', async () => {
  for (const pointer of [new Error('down'), { data: null, error: { message: 'x' } }]) {
    const db = fakeDb({ rpc: heard('already_cancelled'), pointer });
    const { reply } = await run({ db });
    assert.equal(reply.cancelled, false);
    assert.equal(reply.needsReconciliation, true);
    assert.equal(reply.outcome, 'already_cancelled_unverified');
    assert.equal(db.log.writes.length, 0);
  }
});

test('already_cancelled is not success on its own -- the reply table never says so', () => {
  assert.equal(cancelOutcomeReply('already_cancelled', 'Shadowfax').cancelled, false);
});

// ── across every scenario ───────────────────────────────────────────────────

const SCENARIOS = [
  ['cancelled', { rpc: heard('cancelled') }],
  ['pointer was clear', { rpc: heard('cancelled_pointer_was_clear') }],
  ['already_cancelled, clear', { rpc: heard('already_cancelled'), pointer: CLEAR }],
  ['already_cancelled, retained', { rpc: heard('already_cancelled'), pointer: RETAINED }],
  ['already_cancelled, unreadable', { rpc: heard('already_cancelled'), pointer: new Error('x') }],
  ['unheard then cancelled', { rpc: [new Error('a'), heard('cancelled')] }],
  ['unheard then already_cancelled', { rpc: [new Error('a'), heard('already_cancelled')], pointer: CLEAR }],
  ['unheard then pointer-was-clear', { rpc: [new Error('a'), heard('cancelled_pointer_was_clear')] }],
  ['unheard twice, clear', { rpc: [new Error('a'), new Error('b')], pointer: CLEAR }],
  ['unheard twice, retained', { rpc: [new Error('a'), new Error('b')], pointer: RETAINED }],
  ['unheard twice, unreadable', { rpc: [new Error('a'), new Error('b')], pointer: new Error('x') }],
  ...REFUSAL.map((o) => [o, { rpc: heard(o) }]),
];

test('the courier is called exactly ONCE in every RPC scenario, retried or not', async () => {
  for (const [label, opts] of SCENARIOS) {
    const { courier } = await run({ db: fakeDb(opts) });
    assert.equal(courier.calls.length, 1, label);
  }
});

test('no fallback order write in ANY scenario, and never more than two RPC calls', async () => {
  for (const [label, opts] of SCENARIOS) {
    const db = fakeDb(opts);
    await run({ db });
    assert.equal(db.log.writes.length, 0, label);
    assert.ok(db.log.rpc.length <= 2, label);
    assert.ok(db.log.rpc.every((r) => r.name === 'cancel_current_shipment'), label);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Nothing leaks
// ═══════════════════════════════════════════════════════════════════════════

test('no reply carries the token or a raw provider body', async () => {
  const leaky = { responseCode: 400, responseMsg: 'Order cannot be cancelled', secret_field: 'tok-SECRET-123' };
  const replies = [
    (await run({ courier: fakeCourier(200, leaky) })).reply,
    (await run({ courier: fakeCourier(new Error('tok-SECRET-123')) })).reply,
    (await run({ courier: fakeCourier(500, '<html>tok-SECRET-123 stack trace</html>') })).reply,
    (await run()).reply,
  ];
  for (const r of replies) {
    const s = JSON.stringify(r);
    assert.equal(s.includes('tok-SECRET-123'), false, s);
    assert.equal(s.includes('secret_field'), false, s);
  }
});

test('the courier message shown to the merchant is bounded and plain', () => {
  const long = { responseCode: 400, responseMsg: `x${'y'.repeat(500)}<script>` };
  const said = providerSays(JSON.stringify(long));
  assert.ok(said.length <= 120);
  assert.equal(/[<>]/.test(said), false);
  assert.equal(providerSays('<remark>Cannot be cancelled</remark>'), 'Cannot be cancelled');
  assert.equal(providerSays('<html>502 Bad Gateway</html>'), '');
});

// ═══════════════════════════════════════════════════════════════════════════
// SOURCE-PINNED -- the wiring inside serve()
// ═══════════════════════════════════════════════════════════════════════════

test('source: the direct orders.awb = null writes are gone', () => {
  assert.equal(/update\(\{\s*awb:\s*null/.test(OPS), false);
  // the only remaining writes in shipping-ops are the two tracking status saves
  const updates = [...OPS_CODE.matchAll(/\.update\(([^)]*)\)/g)].map((m) => m[1].trim());
  assert.deepEqual(updates, ['{ shipment_status: st }', '{ shipment_status: st }']);
});

test('source: cancel_current_shipment is the only RPC a cancellation calls', () => {
  assert.equal([...OPS_CODE.matchAll(/\.rpc\('cancel_current_shipment'/g)].length, 1);
  assert.equal([...OPS_CODE.matchAll(/\.rpc\('/g)].length, 2, 'verify_store_pin and cancel_current_shipment');
});

test('source: one cancel path, dispatched before the provider split', () => {
  assert.equal([...OPS_CODE.matchAll(/action === 'cancel'/g)].length, 1);
  const cancel = OPS_CODE.indexOf("if (action === 'cancel')");
  const split = OPS_CODE.indexOf('if (isShadowfax)');
  assert.ok(cancel > 0 && split > cancel, 'cancel is handled before either courier branch');
  assert.match(OPS_CODE.slice(cancel, cancel + 300), /cancelShipment\(/);
});

test('source: the order read includes shipment_outcome, which the gate needs', () => {
  assert.match(OPS, /\.select\('awb, courier, shipment_status, shipment_outcome'\)/);
});

test('source: the loose success tests are gone from the code', () => {
  assert.equal(/\/cancel\/i/.test(OPS_CODE), false);
  assert.equal(/cancell\?ed/.test(OPS_CODE), false);
  assert.equal(/"status"\\s\*:\\s\*true/.test(OPS_CODE), false);
});

test('source: the ledger is reached only through the RPC, never read or written directly', () => {
  assert.equal(OPS.includes('shipment_attempts'), false);
});

test("drift: the terminal gate reads the status exactly as B1's derivation does", () => {
  const fn = OPS.slice(OPS.indexOf('function terminalEvidence('), OPS.indexOf('function shadowfaxCancelConfirmed('));
  const at = (re) => fn.search(re);
  // the same three patterns ...
  assert.ok(fn.includes('/(rto|rts|return)/i') && B1.includes("'(rto|rts|return)'"));
  assert.ok(fn.includes('/\\blost\\b/i') && B1.includes("'\\mlost\\M'"));
  assert.ok(fn.includes('/\\bdelivered\\b/i') && B1.includes("'\\mdelivered\\M'"));
  assert.ok(fn.includes('/(undeliver|not deliver)/i') && B1.includes("'(undeliver|not deliver)'"));
  // ... in the same order: return family, then lost, then delivered
  assert.ok(at(/rto\|rts\|return/) < at(/\\blost\\b/));
  assert.ok(at(/\\blost\\b/) < at(/\\bdelivered\\b/));
  // and the outcome is consulted before any of them
  assert.ok(at(/outcome === 'delivered'/) < at(/rto\|rts\|return/));
});

test('scope: shipping-book books (B2B) but never cancels a current shipment', () => {
  assert.equal(BOOK.includes('cancel_current_shipment'), false, 'cancellation stays in shipping-ops');
  assert.ok(BOOK.includes('function cancelAtCourier('), 'shipping-book only cancels its own duplicates');
});

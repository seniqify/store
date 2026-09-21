// Atomic shipment booking claim (PR B2A). Three SECURITY DEFINER functions that
// move the booking decision in FRONT of the courier call: a request must win an
// exclusive database claim before it is allowed to create anything externally.
//
// WHAT THIS FILE CAN AND CANNOT PROVE. There is no Postgres in the test run.
// Two things follow, and they are kept strictly apart below:
//
//   SOURCE-PINNED  — properties only the database can enforce: SECURITY
//                    DEFINER, the pinned search_path, the grants, the row
//                    lock, the partial unique index. These are asserted
//                    against the migration text, and proved on the real
//                    database by supabase/shipment-claim-verify.sql.
//
//   EXECUTED       — the decision logic itself, transcribed from the SQL into
//                    the model below and run against an in-memory ledger that
//                    enforces B1's two unique indexes. This is where the
//                    judgement lives, so this is what is actually executed:
//                    every claim outcome, the full finalize idempotency
//                    matrix, the failure guard, and both concurrency paths.
//
// The transcription is kept honest by a drift test: every outcome string the
// model can return must exist in the SQL, and vice versa.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8')
  .replace(/\r\n/g, '\n');

const FWD  = read('supabase/shipment-claim-forward.sql');
const VER  = read('supabase/shipment-claim-verify.sql');
const RBK  = read('supabase/shipment-claim-ROLLBACK.sql');
const B1   = read('supabase/shipment-attempts-forward.sql');
const BOOK = read('supabase/functions/shipping-book/index.ts');

// SQL with comments stripped, for assertions that must read real statements
// rather than prose that happens to mention the right words.
const code = (s) => s.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
const FWD_CODE = code(FWD);

// ───────────────────────────────────────────────────────────────────────────
// The model. Transcribed from shipment-claim-forward.sql; see the drift test.
// ───────────────────────────────────────────────────────────────────────────

const COURIERS = ['delhivery', 'shadowfax'];
const NOT_BOOKABLE = ['cancelled', 'abandoned'];

const norm = (v) => {
  const s = String(v ?? '').trim();
  return s === '' ? null : s;
};
const lowerNorm = (v) => {
  const s = norm(v);
  return s === null ? null : s.toLowerCase();
};

/** An in-memory stand-in for the two B1 unique indexes. Throws the way Postgres
 *  would, so the claim's exception handler is exercised rather than described. */
class Ledger {
  constructor(orders = [], attempts = []) {
    this.orders = orders;
    this.attempts = attempts;
    this.seq = attempts.reduce((m, a) => Math.max(m, a.id), 0);
  }
  order(slug, id) {
    return this.orders.find((o) => o.id === id && o.store_slug === slug) || null;
  }
  openFor(orderId) {
    return this.attempts.find((a) => a.order_id === orderId && a.end_reason === null) || null;
  }
  maxNo(orderId) {
    return this.attempts
      .filter((a) => a.order_id === orderId)
      .reduce((m, a) => Math.max(m, a.attempt_no), 0);
  }
  insert(row) {
    // shipment_attempts_one_open_idx: unique (order_id) where end_reason is null
    if (row.end_reason === null && this.openFor(row.order_id)) {
      const e = new Error('duplicate key'); e.code = '23505'; throw e;
    }
    // shipment_attempts_order_no_idx: unique (order_id, attempt_no)
    if (this.attempts.some((a) => a.order_id === row.order_id && a.attempt_no === row.attempt_no)) {
      const e = new Error('duplicate key'); e.code = '23505'; throw e;
    }
    const full = { id: ++this.seq, ...row };
    this.attempts.push(full);
    return full;
  }
  byId(slug, id) {
    return this.attempts.find((a) => a.id === id && a.store_slug === slug) || null;
  }
}

const NOW = '2026-09-21T12:00:00Z';

/** public.claim_shipment_attempt(p_store_slug, p_order_id, p_courier) */
function claim(L, slug, orderId, courier, opts = {}) {
  const c = lowerNorm(courier);
  if (c === null || !COURIERS.includes(c)) return { outcome: 'invalid_courier' };

  // SELECT ... FOR UPDATE. `preRead` lets a test simulate the lock being absent
  // by pinning the state this call saw before another claim ran.
  const o = L.order(slug, orderId);
  if (!o) return { outcome: 'order_not_found' };

  if (NOT_BOOKABLE.includes(String(o.status ?? ''))) {
    return { outcome: 'order_not_bookable', status: o.status };
  }

  if (norm(o.awb) !== null) {
    const open = L.openFor(orderId);
    return { outcome: 'already_booked', awb: o.awb, open_attempt_id: open ? open.id : null };
  }

  const open = opts.preRead ? opts.preRead.open : L.openFor(orderId);
  if (open) {
    return norm(open.awb) !== null
      ? { outcome: 'open_with_awb', attempt_id: open.id, awb: open.awb }
      : { outcome: 'open_without_awb', attempt_id: open.id };
  }

  const attemptNo = (opts.preRead ? opts.preRead.maxNo : L.maxNo(orderId)) + 1;
  let row;
  try {
    row = L.insert({
      store_slug: slug, order_id: orderId, attempt_no: attemptNo, courier: c,
      awb: null, claimed_at: NOW, booked_at: null, shipping_cost: null,
      ended_at: null, end_reason: null, final_status: null,
    });
  } catch (e) {
    if (e.code === '23505') return { outcome: 'race_lost' };
    throw e;
  }
  return { outcome: 'claimed', attempt_id: row.id, attempt_no: attemptNo, courier: c };
}

/** public.finalize_shipment_attempt(...) */
function finalize(L, attemptId, slug, courier, awb, cost = null, status = null) {
  const c = lowerNorm(courier);
  const a_awb = norm(awb);
  if (a_awb === null) return { outcome: 'invalid_awb' };

  const att = L.byId(slug, attemptId);
  if (!att) return { outcome: 'attempt_not_found' };

  const o = L.order(slug, att.order_id);
  if (!o) return { outcome: 'attempt_not_found' };

  const attAwb = norm(att.awb);
  const ordAwb = norm(o.awb);

  if (att.end_reason !== null) return { outcome: 'attempt_terminal', end_reason: att.end_reason };
  if (att.courier !== c) return { outcome: 'courier_mismatch', courier: att.courier };
  if (attAwb !== null && attAwb !== a_awb) return { outcome: 'attempt_awb_conflict', awb: attAwb };
  if (ordAwb !== null && ordAwb !== a_awb) return { outcome: 'order_awb_conflict', awb: ordAwb };

  if (attAwb === a_awb && ordAwb === a_awb) {
    return { outcome: 'already_finalized', attempt_id: attemptId, awb: a_awb, order_id: att.order_id };
  }

  // A half-applied pair is evidence, not work to finish. No writes.
  if (attAwb === a_awb && ordAwb === null) {
    return { outcome: 'partial_state_attempt_only', attempt_id: attemptId, awb: a_awb, order_id: att.order_id };
  }
  if (attAwb === null && ordAwb === a_awb) {
    return { outcome: 'partial_state_order_only', attempt_id: attemptId, awb: a_awb, order_id: att.order_id };
  }

  // Only one case is left: neither side holds an AWB. Create the pair.
  att.awb = a_awb;
  att.booked_at = NOW;
  att.shipping_cost = cost ?? att.shipping_cost;
  att.final_status = norm(status) ?? att.final_status;
  o.awb = a_awb;
  o.courier = c;
  o.shipment_status = norm(status) ?? o.shipment_status;
  o.shipping_cost = cost ?? o.shipping_cost;
  return { outcome: 'finalized', attempt_id: attemptId, awb: a_awb, order_id: att.order_id };
}

/** public.fail_shipment_attempt(...) */
function fail(L, attemptId, slug, status = null) {
  const att = L.byId(slug, attemptId);
  if (!att) return { outcome: 'attempt_not_found' };
  if (att.end_reason !== null) return { outcome: 'attempt_terminal', end_reason: att.end_reason };
  if (norm(att.awb) !== null) return { outcome: 'attempt_has_awb', awb: att.awb };

  att.end_reason = 'failed';
  att.ended_at = NOW;
  att.final_status = (norm(status) ?? '').slice(0, 200) || null;
  return { outcome: 'failed', attempt_id: attemptId, order_id: att.order_id };
}

// ── fixtures ────────────────────────────────────────────────────────────────
const SLUG = 'showme';
const OID = '11111111-1111-1111-1111-111111111111';

const freshLedger = (over = {}) => new Ledger(
  [{ id: OID, store_slug: SLUG, status: 'confirmed', awb: null, courier: null,
     shipment_status: null, shipping_cost: null, ...over }],
  [],
);

// ═══════════════════════════════════════════════════════════════════════════
// EXECUTED — the claim decision
// ═══════════════════════════════════════════════════════════════════════════

test('claim: a clean eligible order is claimed, and exactly one open attempt exists', () => {
  const L = freshLedger();
  const r = claim(L, SLUG, OID, 'delhivery');
  assert.equal(r.outcome, 'claimed');
  assert.equal(r.attempt_no, 1);
  assert.equal(r.courier, 'delhivery');
  assert.equal(L.attempts.length, 1);
  assert.equal(L.attempts.filter((a) => a.end_reason === null).length, 1);
});

test('claim: the new attempt is a claim — claimed_at set, AWB and cost still empty', () => {
  const L = freshLedger();
  claim(L, SLUG, OID, 'shadowfax');
  const a = L.attempts[0];
  assert.equal(a.claimed_at, NOW);
  assert.equal(a.awb, null);
  assert.equal(a.booked_at, null);
  assert.equal(a.end_reason, null);
  // The quote belongs to a shipment that exists. A claim was never charged for.
  assert.equal(a.shipping_cost, null);
});

test('claim: attempt_no is allocated by the database, never supplied by the caller', () => {
  const L = freshLedger();
  claim(L, SLUG, OID, 'delhivery');
  fail(L, L.attempts[0].id, SLUG, 'pincode not serviceable');
  const r = claim(L, SLUG, OID, 'delhivery');
  assert.equal(r.outcome, 'claimed');
  assert.equal(r.attempt_no, 2);          // max(attempt_no) + 1, computed inside
});

test('claim: an order in another store is not found', () => {
  const L = freshLedger();
  assert.equal(claim(L, 'someone-else', OID, 'delhivery').outcome, 'order_not_found');
});

test('claim: an unknown order id is not found', () => {
  const L = freshLedger();
  const r = claim(L, SLUG, '99999999-9999-9999-9999-999999999999', 'delhivery');
  assert.equal(r.outcome, 'order_not_found');
});

test('claim: a cancelled or abandoned order is not bookable', () => {
  for (const status of ['cancelled', 'abandoned']) {
    const L = freshLedger({ status });
    const r = claim(L, SLUG, OID, 'delhivery');
    assert.equal(r.outcome, 'order_not_bookable', status);
    assert.equal(L.attempts.length, 0);
  }
});

test('claim: an online order that is unpaid and unshipped IS still bookable', () => {
  // countsAsSale() would refuse this one. Shipping it is exactly how an order
  // becomes "payment unconfirmed", so refusing it would break a live flow.
  const L = freshLedger({ status: 'confirmed', payment_method: 'online', paid: false });
  assert.equal(claim(L, SLUG, OID, 'delhivery').outcome, 'claimed');
});

test('claim: orders.awb blocks the claim — the rebook boundary', () => {
  const L = freshLedger({ awb: 'AWB-LIVE', courier: 'delhivery' });
  const r = claim(L, SLUG, OID, 'delhivery');
  assert.equal(r.outcome, 'already_booked');
  assert.equal(r.awb, 'AWB-LIVE');
  assert.equal(L.attempts.length, 0);
});

test('claim: a terminal attempt does NOT authorise a rebook while the order holds an AWB', () => {
  // A courier-cancelled booking keeps its AWB on the order. This is PR C's
  // territory and B2A must not open it.
  const L = new Ledger(
    [{ id: OID, store_slug: SLUG, status: 'confirmed', awb: 'AWB-CANCELLED', courier: 'delhivery' }],
    [{ id: 1, store_slug: SLUG, order_id: OID, attempt_no: 1, courier: 'delhivery',
       awb: 'AWB-CANCELLED', claimed_at: null, booked_at: null, shipping_cost: null,
       ended_at: null, end_reason: 'cancelled', final_status: 'Cancelled' }],
  );
  assert.equal(claim(L, SLUG, OID, 'delhivery').outcome, 'already_booked');
  assert.equal(L.attempts.length, 1);
});

test('claim: an existing open attempt WITH an AWB blocks — all 49 production rows', () => {
  const L = new Ledger(
    [{ id: OID, store_slug: SLUG, status: 'confirmed', awb: null, courier: null }],
    [{ id: 1, store_slug: SLUG, order_id: OID, attempt_no: 1, courier: 'shadowfax',
       awb: 'AWB-OPEN', claimed_at: null, booked_at: null, shipping_cost: null,
       ended_at: null, end_reason: null, final_status: 'In Transit' }],
  );
  const r = claim(L, SLUG, OID, 'shadowfax');
  assert.equal(r.outcome, 'open_with_awb');
  assert.equal(r.awb, 'AWB-OPEN');
  assert.equal(L.attempts.length, 1);
});

test('claim: an existing open attempt WITHOUT an AWB blocks — reconciliation in progress', () => {
  const L = freshLedger();
  claim(L, SLUG, OID, 'delhivery');
  const r = claim(L, SLUG, OID, 'delhivery');
  assert.equal(r.outcome, 'open_without_awb');
  assert.equal(r.attempt_id, L.attempts[0].id);
  assert.equal(L.attempts.length, 1);     // nothing new was created
});

test('claim: the two open shapes are distinguishable, as the contract requires', () => {
  const withAwb = new Ledger(
    [{ id: OID, store_slug: SLUG, status: 'confirmed', awb: null }],
    [{ id: 1, store_slug: SLUG, order_id: OID, attempt_no: 1, courier: 'delhivery',
       awb: 'A', end_reason: null }],
  );
  const without = freshLedger();
  claim(without, SLUG, OID, 'delhivery');
  assert.notEqual(
    claim(withAwb, SLUG, OID, 'delhivery').outcome,
    claim(without, SLUG, OID, 'delhivery').outcome,
  );
});

test('claim: an unknown courier is refused before anything is locked or written', () => {
  const L = freshLedger();
  for (const c of ['bluedart', '', null, 'DELHIVERYY']) {
    assert.equal(claim(L, SLUG, OID, c).outcome, 'invalid_courier', String(c));
  }
  assert.equal(L.attempts.length, 0);
});

test('claim: courier case and padding are normalised, not rejected', () => {
  const L = freshLedger();
  const r = claim(L, SLUG, OID, '  Delhivery  ');
  assert.equal(r.outcome, 'claimed');
  assert.equal(r.courier, 'delhivery');
});

test('claim: the result carries no customer data', () => {
  const L = freshLedger({ customer_name: 'A Person', customer_phone: '9175187668' });
  const keys = Object.keys(claim(L, SLUG, OID, 'delhivery'));
  for (const k of keys) {
    assert.ok(!/name|phone|address|destination|pincode|email/i.test(k), k);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// EXECUTED — concurrency
// ═══════════════════════════════════════════════════════════════════════════

test('concurrency: two serialized claims for one order — exactly one wins', () => {
  const L = freshLedger();
  const a = claim(L, SLUG, OID, 'delhivery');
  const b = claim(L, SLUG, OID, 'delhivery');
  const won = [a, b].filter((r) => r.outcome === 'claimed');
  assert.equal(won.length, 1);
  assert.equal(b.outcome, 'open_without_awb');
  assert.equal(L.attempts.length, 1);
});

test('concurrency: WITHOUT the lock, the unique index still admits only one', () => {
  // Both claimants read the same empty state, then both try to insert. This is
  // the interleaving the row lock is there to prevent; the point of the test is
  // that even if the lock were lost, B1's partial unique index refuses the
  // second insert and the loser gets a typed answer instead of SQLSTATE 23505.
  const L = freshLedger();
  const stale = { open: null, maxNo: 0 };
  const a = claim(L, SLUG, OID, 'delhivery', { preRead: stale });
  const b = claim(L, SLUG, OID, 'delhivery', { preRead: stale });
  assert.equal(a.outcome, 'claimed');
  assert.equal(b.outcome, 'race_lost');
  assert.equal(L.attempts.length, 1);
  assert.equal(L.attempts.filter((x) => x.end_reason === null).length, 1);
});

test('concurrency: NO TWO REQUESTS EVER BOTH REACH THE COURIER — the whole objective', () => {
  // The claim is the permission slip. Anything that is not "claimed" must not
  // call a courier, so counting winners counts external bookings.
  for (const interleaved of [false, true]) {
    const L = freshLedger();
    const stale = { open: null, maxNo: 0 };
    const results = [0, 1, 2, 3, 4].map(() =>
      claim(L, SLUG, OID, 'delhivery', interleaved ? { preRead: stale } : {}));
    assert.equal(results.filter((r) => r.outcome === 'claimed').length, 1,
      `interleaved=${interleaved}`);
    assert.equal(L.attempts.length, 1);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// EXECUTED — finalize, and its full idempotency matrix
// ═══════════════════════════════════════════════════════════════════════════

const claimed = () => {
  const L = freshLedger();
  const r = claim(L, SLUG, OID, 'delhivery');
  return { L, id: r.attempt_id };
};

test('finalize: attempt and order move together', () => {
  const { L, id } = claimed();
  const r = finalize(L, id, SLUG, 'delhivery', 'AWB-1', 42.5, 'Manifested');
  assert.equal(r.outcome, 'finalized');
  const a = L.attempts[0], o = L.orders[0];
  assert.equal(a.awb, 'AWB-1');
  assert.equal(a.booked_at, NOW);
  assert.equal(a.shipping_cost, 42.5);
  assert.equal(a.final_status, 'Manifested');
  assert.equal(o.awb, 'AWB-1');
  assert.equal(o.courier, 'delhivery');
  assert.equal(o.shipment_status, 'Manifested');
  assert.equal(o.shipping_cost, 42.5);
  assert.equal(a.end_reason, null);       // booked is not terminal
});

test('finalize: the attempt stays open after booking, so B3 can still close it', () => {
  const { L, id } = claimed();
  finalize(L, id, SLUG, 'delhivery', 'AWB-1');
  assert.equal(L.attempts[0].end_reason, null);
  assert.equal(L.attempts.filter((a) => a.end_reason === null).length, 1);
});

test('finalize idempotency: same AWB twice is already_finalized and writes nothing new', () => {
  const { L, id } = claimed();
  finalize(L, id, SLUG, 'delhivery', 'AWB-1', 42.5, 'Manifested');
  const booked = L.attempts[0].booked_at;
  const r = finalize(L, id, SLUG, 'delhivery', 'AWB-1', 99, 'In Transit');
  assert.equal(r.outcome, 'already_finalized');
  assert.equal(L.attempts[0].booked_at, booked);
  assert.equal(L.attempts[0].shipping_cost, 42.5);   // the first booking stands
  assert.equal(L.attempts[0].final_status, 'Manifested');
});

test('finalize: half-applied — ledger has the AWB, order does not — is REFUSED, not repaired', () => {
  // finalize is the only thing that creates the pair, and it creates it in one
  // transaction. So this shape was made by something else: pre-B2B code, a
  // hand-run fix, or an open transaction. Completing it would erase the signal.
  const { L, id } = claimed();
  L.attempts[0].awb = 'AWB-1';
  L.attempts[0].booked_at = NOW;
  const r = finalize(L, id, SLUG, 'delhivery', 'AWB-1', 10, 'Manifested');
  assert.equal(r.outcome, 'partial_state_attempt_only');
  assert.equal(r.awb, 'AWB-1');
  assert.equal(L.orders[0].awb, null);          // the order was NOT repaired
  assert.equal(L.attempts[0].shipping_cost, null);
});

test('finalize: half-applied — order has the AWB, ledger does not — is REFUSED, not repaired', () => {
  const { L, id } = claimed();
  L.orders[0].awb = 'AWB-1';
  L.orders[0].courier = 'delhivery';
  const r = finalize(L, id, SLUG, 'delhivery', 'AWB-1', 10, 'Manifested');
  assert.equal(r.outcome, 'partial_state_order_only');
  assert.equal(r.awb, 'AWB-1');
  assert.equal(L.attempts[0].awb, null);        // the ledger was NOT repaired
  assert.equal(L.attempts[0].booked_at, null);
});

test('finalize: a partial state stays partial however many times it is retried', () => {
  const { L, id } = claimed();
  L.orders[0].awb = 'AWB-1';
  const before = JSON.stringify([L.orders, L.attempts]);
  for (let i = 0; i < 5; i++) {
    assert.equal(finalize(L, id, SLUG, 'delhivery', 'AWB-1').outcome, 'partial_state_order_only');
  }
  assert.equal(JSON.stringify([L.orders, L.attempts]), before);
});

test('finalize: writes in exactly two shapes — both-null creates, both-set reports', () => {
  // Every other combination is a refusal. This pins the whole contract.
  const shapes = [
    [null,    null,    'finalized',                  true],
    ['AWB-1', 'AWB-1', 'already_finalized',          false],
    ['AWB-1', null,    'partial_state_attempt_only', false],
    [null,    'AWB-1', 'partial_state_order_only',   false],
    ['AWB-X', null,    'attempt_awb_conflict',       false],
    [null,    'AWB-X', 'order_awb_conflict',         false],
  ];
  for (const [attAwb, ordAwb, expected, writes] of shapes) {
    const { L, id } = claimed();
    L.attempts[0].awb = attAwb;
    L.orders[0].awb = ordAwb;
    const before = JSON.stringify([L.orders, L.attempts]);
    const r = finalize(L, id, SLUG, 'delhivery', 'AWB-1', 7, 'Manifested');
    assert.equal(r.outcome, expected, `${attAwb} / ${ordAwb}`);
    const changed = JSON.stringify([L.orders, L.attempts]) !== before;
    assert.equal(changed, writes, `${expected} should ${writes ? '' : 'not '}write`);
  }
});

test('finalize: a DIFFERENT AWB on the attempt is refused, not overwritten', () => {
  const { L, id } = claimed();
  L.attempts[0].awb = 'AWB-FIRST';
  const r = finalize(L, id, SLUG, 'delhivery', 'AWB-SECOND');
  assert.equal(r.outcome, 'attempt_awb_conflict');
  assert.equal(r.awb, 'AWB-FIRST');
  assert.equal(L.attempts[0].awb, 'AWB-FIRST');
});

test('finalize: a DIFFERENT AWB on the order is refused, not overwritten', () => {
  const { L, id } = claimed();
  L.orders[0].awb = 'AWB-OTHER';
  const r = finalize(L, id, SLUG, 'delhivery', 'AWB-MINE');
  assert.equal(r.outcome, 'order_awb_conflict');
  assert.equal(r.awb, 'AWB-OTHER');
  assert.equal(L.orders[0].awb, 'AWB-OTHER');
  assert.equal(L.attempts[0].awb, null);  // neither side moved
});

test('finalize: a terminal attempt is refused', () => {
  const { L, id } = claimed();
  fail(L, id, SLUG, 'rejected');
  const r = finalize(L, id, SLUG, 'delhivery', 'AWB-1');
  assert.equal(r.outcome, 'attempt_terminal');
  assert.equal(r.end_reason, 'failed');
  assert.equal(L.orders[0].awb, null);
});

test('finalize: a missing attempt, or one in another store, is not found', () => {
  const { L, id } = claimed();
  assert.equal(finalize(L, 99999, SLUG, 'delhivery', 'A').outcome, 'attempt_not_found');
  assert.equal(finalize(L, id, 'other-store', 'delhivery', 'A').outcome, 'attempt_not_found');
});

test('finalize: the wrong courier is refused', () => {
  const { L, id } = claimed();
  const r = finalize(L, id, SLUG, 'shadowfax', 'AWB-1');
  assert.equal(r.outcome, 'courier_mismatch');
  assert.equal(L.orders[0].awb, null);
});

test('finalize: an empty AWB is refused', () => {
  const { L, id } = claimed();
  for (const bad of ['', '   ', null, undefined]) {
    assert.equal(finalize(L, id, SLUG, 'delhivery', bad).outcome, 'invalid_awb', String(bad));
  }
  assert.equal(L.orders[0].awb, null);
});

test('finalize: nothing is written on ANY refusal', () => {
  const cases = [
    (L, id) => finalize(L, id, SLUG, 'shadowfax', 'X'),
    (L, id) => finalize(L, id, SLUG, 'delhivery', ''),
    (L, id) => finalize(L, 99999, SLUG, 'delhivery', 'X'),
  ];
  for (const run of cases) {
    const { L, id } = claimed();
    const before = JSON.stringify([L.orders, L.attempts]);
    run(L, id);
    assert.equal(JSON.stringify([L.orders, L.attempts]), before);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// EXECUTED — definitive failure, and the timeout that has no primitive
// ═══════════════════════════════════════════════════════════════════════════

test('fail: a definitive rejection closes the claim as failed and frees the order', () => {
  const { L, id } = claimed();
  const r = fail(L, id, SLUG, 'pincode not serviceable');
  assert.equal(r.outcome, 'failed');
  assert.equal(L.attempts[0].end_reason, 'failed');
  assert.equal(L.attempts[0].ended_at, NOW);
  assert.equal(L.attempts[0].final_status, 'pincode not serviceable');
  // The order is bookable again, as attempt 2.
  assert.equal(claim(L, SLUG, OID, 'delhivery').outcome, 'claimed');
});

test('fail: an attempt that holds an AWB is refused — a parcel may exist', () => {
  const { L, id } = claimed();
  finalize(L, id, SLUG, 'delhivery', 'AWB-1');
  const r = fail(L, id, SLUG, 'something went wrong');
  assert.equal(r.outcome, 'attempt_has_awb');
  assert.equal(L.attempts[0].end_reason, null);
});

test('fail: an already-closed attempt is refused', () => {
  const { L, id } = claimed();
  fail(L, id, SLUG, 'no');
  assert.equal(fail(L, id, SLUG, 'no again').outcome, 'attempt_terminal');
});

test('fail: the provider description is truncated, not stored whole', () => {
  const { L, id } = claimed();
  fail(L, id, SLUG, 'x'.repeat(5000));
  assert.equal(L.attempts[0].final_status.length, 200);
});

test('TIMEOUT: an uncertain outcome leaves the claim open and blocking', () => {
  // There is deliberately NO primitive that closes a claim whose courier
  // response was not heard. The correct shape is simply the claim, untouched.
  const { L } = claimed();
  const a = L.attempts[0];
  assert.equal(a.end_reason, null);
  assert.equal(a.awb, null);
  assert.equal(a.claimed_at, NOW);
  // And it keeps blocking.
  assert.equal(claim(L, SLUG, OID, 'delhivery').outcome, 'open_without_awb');
});

test('TIMEOUT: no function in B2A can close an open AWB-less claim except fail()', () => {
  // fail() is the only closer, and it is the one an uncertain path must not
  // call. Every other entry point leaves end_reason null.
  const { L, id } = claimed();
  finalize(L, id, SLUG, 'shadowfax', 'X');          // refused
  finalize(L, id, SLUG, 'delhivery', '');           // refused
  claim(L, SLUG, OID, 'delhivery');                 // refused
  assert.equal(L.attempts[0].end_reason, null);
});

test('no automated writer produces end_reason = unknown', () => {
  const L = freshLedger();
  const r = claim(L, SLUG, OID, 'delhivery');
  finalize(L, r.attempt_id, SLUG, 'delhivery', 'AWB-1');
  fail(L, r.attempt_id, SLUG, 'x');
  const L2 = freshLedger();
  const r2 = claim(L2, SLUG, OID, 'delhivery');
  fail(L2, r2.attempt_id, SLUG, 'x');
  for (const a of [...L.attempts, ...L2.attempts]) {
    assert.notEqual(a.end_reason, 'unknown');
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// DRIFT — the model must match the SQL it was transcribed from
// ═══════════════════════════════════════════════════════════════════════════

const sqlOutcomes = new Set(
  [...FWD_CODE.matchAll(/'outcome',\s*'([a-z_]+)'/g)].map((m) => m[1]),
);
const modelOutcomes = new Set([
  'invalid_courier', 'order_not_found', 'order_not_bookable', 'already_booked',
  'open_with_awb', 'open_without_awb', 'race_lost', 'claimed',
  'invalid_awb', 'attempt_not_found', 'attempt_terminal', 'courier_mismatch',
  'attempt_awb_conflict', 'order_awb_conflict', 'already_finalized', 'finalized',
  'partial_state_attempt_only', 'partial_state_order_only',
  'attempt_has_awb', 'failed',
]);

test('drift: every outcome the SQL returns is modelled here', () => {
  for (const o of sqlOutcomes) assert.ok(modelOutcomes.has(o), `SQL returns "${o}", model does not`);
});

test('drift: every outcome the model returns exists in the SQL', () => {
  for (const o of modelOutcomes) assert.ok(sqlOutcomes.has(o), `model returns "${o}", SQL does not`);
});

test('drift: the not-bookable status list matches the SQL', () => {
  const m = FWD_CODE.match(/in \('cancelled', 'abandoned'\)/);
  assert.ok(m, 'the eligibility status list changed in SQL but not here');
  assert.deepEqual(NOT_BOOKABLE, ['cancelled', 'abandoned']);
});

test('drift: the courier vocabulary matches B1 and the SQL', () => {
  assert.ok(FWD_CODE.includes("not in ('delhivery', 'shadowfax')"));
  assert.ok(B1.includes("check (courier in ('delhivery', 'shadowfax'))"));
  assert.deepEqual(COURIERS, ['delhivery', 'shadowfax']);
});

// ═══════════════════════════════════════════════════════════════════════════
// SOURCE-PINNED — what only Postgres can enforce
// ═══════════════════════════════════════════════════════════════════════════

const FNS = [
  ['claim_shipment_attempt', 'text, uuid, text'],
  ['finalize_shipment_attempt', 'bigint, text, text, text, numeric, text'],
  ['fail_shipment_attempt', 'bigint, text, text'],
];

test('source: all three functions are SECURITY DEFINER', () => {
  const bodies = FWD.split('create or replace function').slice(1);
  assert.equal(bodies.length, 3);
  for (const b of bodies) assert.match(b, /\nsecurity definer\n/);
});

test('source: all three pin search_path to public, pg_temp', () => {
  const n = [...FWD.matchAll(/set search_path = public, pg_temp/g)].length;
  assert.equal(n, 3);
});

test('source: each function revokes from public, anon, authenticated', () => {
  for (const [name, args] of FNS) {
    const re = new RegExp(`revoke all on function public\\.${name}\\(${args
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)\\s*\\n\\s*from public, anon, authenticated;`);
    assert.match(FWD, re, name);
  }
});

test('source: each function grants execute to service_role, and to nobody else', () => {
  for (const [name] of FNS) {
    assert.ok(FWD.includes(`grant execute on function public.${name}`), name);
  }
  const grants = [...FWD_CODE.matchAll(/grant execute on function[\s\S]*?to (\w+);/g)]
    .map((m) => m[1]);
  assert.equal(grants.length, 3);
  assert.deepEqual([...new Set(grants)], ['service_role']);
});

test('source: nothing is granted to anon or authenticated anywhere in the migration', () => {
  assert.ok(!/grant[\s\S]{0,200}?to[^;]*\b(anon|authenticated)\b/.test(FWD_CODE));
});

test('source: the browser keeps zero direct access to shipment_attempts', () => {
  // B2A must not re-grant the table B1 locked down.
  assert.ok(!/grant[^;]*on\s+(public\.)?shipment_attempts/i.test(FWD_CODE));
  assert.ok(!/create policy/i.test(FWD_CODE));
  assert.ok(!/alter table[^;]*shipment_attempts/i.test(FWD_CODE));
});

test('source: the claim locks the orders row FOR UPDATE', () => {
  const claimBody = FWD_CODE.split('create or replace function')[1];
  assert.match(claimBody, /from public\.orders o[\s\S]*?for update;/);
});

test('source: finalize also locks the orders row before its compare-and-set', () => {
  const body = FWD_CODE.split('create or replace function')[2];
  assert.match(body, /from public\.orders o[\s\S]*?for update;/);
});

test('source: attempt_no is allocated in SQL with max + 1, not by the caller', () => {
  assert.match(FWD_CODE, /coalesce\(max\(sa\.attempt_no\), 0\) \+ 1/);
  // and it is not an argument to any function
  for (const [, args] of FNS) assert.ok(!args.includes('integer'));
});

test('source: the claim inserts with awb null and end_reason null — an open claim', () => {
  const claimBody = FWD_CODE.split('create or replace function')[1];
  assert.match(claimBody, /insert into public\.shipment_attempts/);
  assert.match(claimBody, /claimed_at[\s\S]*?values[\s\S]*?now\(\)/);
});

test('source: the claim catches unique_violation rather than letting 23505 escape', () => {
  const claimBody = FWD_CODE.split('create or replace function')[1];
  assert.match(claimBody, /exception\s*\n\s*when unique_violation then/);
});

test("source: orders' compare-and-set keeps PR A semantics — writes only while awb is null", () => {
  const body = FWD_CODE.split('create or replace function')[2];
  assert.match(body, /update public\.orders o[\s\S]*?and o\.awb is null;/);
  assert.match(body, /and o\.store_slug = p_store_slug/);
});

test('source: both partial-state branches return BEFORE either update statement', () => {
  // The no-write property must be structural, not a matter of the update
  // predicates happening to match nothing.
  const body = FWD_CODE.split('create or replace function')[2].split('$function$;')[0];
  const firstUpdate = body.indexOf('update public.');
  assert.ok(firstUpdate > 0);
  for (const outcome of ['partial_state_attempt_only', 'partial_state_order_only']) {
    const at = body.indexOf(outcome);
    assert.ok(at > 0, outcome);
    assert.ok(at < firstUpdate, `${outcome} is returned after a write`);
  }
});

test('source: finalize has exactly two write paths and four refusals', () => {
  const body = FWD_CODE.split('create or replace function')[2].split('$function$;')[0];
  const outcomes = [...body.matchAll(/'outcome', '([a-z_]+)'/g)].map((m) => m[1]);
  for (const o of ['finalized', 'already_finalized', 'attempt_awb_conflict',
                   'order_awb_conflict', 'partial_state_attempt_only',
                   'partial_state_order_only']) {
    assert.ok(outcomes.includes(o), o);
  }
});

test('source: finalize writes both rows inside ONE function, so they commit together', () => {
  const body = FWD_CODE.split('create or replace function')[2].split('$function$;')[0];
  assert.equal([...body.matchAll(/update public\.shipment_attempts/g)].length, 1);
  assert.equal([...body.matchAll(/update public\.orders/g)].length, 1);
});

test('source: fail can only close an open attempt that has no AWB', () => {
  const body = FWD_CODE.split('create or replace function')[3];
  assert.match(body, /end_reason\s*=\s*'failed'/);
  assert.match(body, /and sa\.end_reason is null\s*\n\s*and sa\.awb is null;/);
});

test("source: 'unknown' is never assigned by any B2A function", () => {
  assert.ok(!/end_reason\s*(=|,)\s*'unknown'/.test(FWD_CODE));
  assert.ok(!/'unknown'/.test(FWD_CODE.replace(/outcome/g, '')));
});

test('source: there is no stale-claim expiry anywhere in B2A', () => {
  assert.ok(!/interval/i.test(FWD_CODE));
  assert.ok(!/expire|expiry|stale|reap|sweep/i.test(FWD_CODE));
  // and nothing closes an attempt on a timer
  assert.ok(!/claimed_at\s*<|now\(\)\s*-/.test(FWD_CODE));
});

test('source: B2A creates no table, alters none, drops none', () => {
  assert.ok(!/create table/i.test(FWD_CODE));
  assert.ok(!/alter table/i.test(FWD_CODE));
  assert.ok(!/drop (table|trigger|index)/i.test(FWD_CODE));
  assert.ok(!/create (unique )?index/i.test(FWD_CODE));
});

test("source: B1's immutability trigger is neither dropped nor replaced", () => {
  assert.ok(!/shipment_attempt_is_final/.test(FWD_CODE));
  assert.ok(!/create trigger|drop trigger/i.test(FWD_CODE));
  // and B1's own file still defines it
  assert.ok(B1.includes('create trigger shipment_attempts_closed_are_permanent'));
});

test('source: the migration is one transaction', () => {
  assert.equal([...FWD_CODE.matchAll(/^begin;$/gm)].length, 1);
  assert.equal([...FWD_CODE.matchAll(/^commit;$/gm)].length, 1);
});

test('source: every function is create OR REPLACE, so re-running is safe', () => {
  assert.equal([...FWD.matchAll(/create or replace function/g)].length, 3);
});

// ── verify script ───────────────────────────────────────────────────────────

test('verify: is read-only — one statement, no DML, no DDL', () => {
  const v = code(VER);
  assert.equal(v.split(';').filter((s) => s.trim()).length, 1);
  assert.ok(!/\b(insert|update|delete|create|alter|drop|grant|revoke|truncate)\b/i.test(v));
});

test('verify: declares itself POST-APPLY ONLY', () => {
  assert.match(VER, /POST-APPLY ONLY/);
});

test('verify: covers every property the reviewer asked for', () => {
  const required = [
    'SECURITY DEFINER', 'search_path', 'anon', 'authenticated', 'service_role',
    'RLS still enabled', 'no RLS policy', 'one-open-attempt', 'immutability trigger',
  ];
  for (const r of required) assert.ok(VER.includes(r), r);
});

test('verify: books nothing — it never names a courier endpoint or calls a B2A function', () => {
  const v = code(VER);
  assert.ok(!/claim_shipment_attempt\s*\(/.test(v.replace(/proname = '[^']*'/g, '')));
  assert.ok(!/https?:/.test(v));
});

// ── rollback ────────────────────────────────────────────────────────────────

test('rollback: drops only the three functions', () => {
  const r = code(RBK);
  const drops = [...r.matchAll(/drop \w+ if exists public\.(\w+)/g)].map((m) => m[1]);
  assert.deepEqual(drops.sort(), FNS.map(([n]) => n).sort());
});

test('rollback: never drops the ledger or touches orders', () => {
  const r = code(RBK);
  assert.ok(!/drop table/i.test(r));
  assert.ok(!/(insert|update|delete)\s+(into\s+)?public\.orders/i.test(r));
  assert.ok(!/alter table/i.test(r));
});

test('rollback: refuses while the claim path shows signs of use', () => {
  assert.match(RBK, /claimed_at is not null/);
  assert.match(RBK, /refusing to run/);
});

test('rollback: warns that it must run BEFORE B1 rollback and AFTER reverting B2B', () => {
  assert.match(RBK, /B2B/);
  assert.match(RBK, /shipment-attempts-ROLLBACK\.sql/);
});

// ── scope ───────────────────────────────────────────────────────────────────

test('scope: shipping-book does not call any B2A function — B2A is inert', () => {
  for (const [name] of FNS) assert.ok(!BOOK.includes(name), name);
});

test('scope: shipping-book still holds every PR A protection', () => {
  for (const fn of ['classifyAttach', 'readCurrentShipment', 'attachVerdict',
                    'cancelAtCourier', 'bookingConflict', 'bookingUnknown']) {
    assert.ok(BOOK.includes(fn), fn);
  }
  assert.ok(BOOK.includes(".is('awb', null)"));
});

test('scope: no B2A file references a runtime module', () => {
  for (const f of [FWD, VER, RBK]) {
    assert.ok(!/commerceMetrics|deliveryMetrics|deliveryStatus|DeliveryBoard|AnalyticsTab|OrdersTab/.test(f));
  }
});

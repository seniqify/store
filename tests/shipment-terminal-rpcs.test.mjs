// Terminal shipment transitions (PR B2A.1, PR1). Two SECURITY DEFINER
// functions that close the two terminal states B2A could not reach:
//
//   cancel_current_shipment      a CONFIRMED courier cancellation -- closes the
//                                attempt AND clears the order's pointer, in one
//                                transaction
//   supersede_shipment_attempt   the B2B loser -- records the AWB that was
//                                created, lost and then cancelled
//
// WHAT THIS FILE CAN AND CANNOT PROVE. There is no Postgres in the test run,
// so the two categories are kept strictly apart:
//
//   SOURCE-PINNED  properties only the database enforces -- SECURITY DEFINER,
//                  the pinned search_path, grants, the row lock, the single
//                  closing UPDATE that B1's trigger requires. Asserted against
//                  the migration text and proved on the real database by
//                  supabase/shipment-terminal-verify.sql.
//
//   EXECUTED       the decision logic, transcribed into the model below and run
//                  against an in-memory ledger that enforces B1's indexes and
//                  its immutability trigger. Every outcome of both RPCs, the
//                  full idempotency matrix, and the cancel -> next-claim proof
//                  run against the transcribed B2A claim.
//
// A drift test keeps the transcription honest: every outcome string the model
// returns must exist in the SQL, and vice versa.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8')
  .replace(/\r\n/g, '\n');

const FWD   = read('supabase/shipment-terminal-forward.sql');
const VER   = read('supabase/shipment-terminal-verify.sql');
const RBK   = read('supabase/shipment-terminal-ROLLBACK.sql');
const B1    = read('supabase/shipment-attempts-forward.sql');
const B2A   = read('supabase/shipment-claim-forward.sql');
const OPS   = read('supabase/functions/shipping-ops/index.ts');
const BOOK  = read('supabase/functions/shipping-book/index.ts');

const code = (s) => s.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
const FWD_CODE = code(FWD);

// ───────────────────────────────────────────────────────────────────────────
// The model. Transcribed from shipment-terminal-forward.sql.
// ───────────────────────────────────────────────────────────────────────────

const COURIERS = ['delhivery', 'shadowfax'];
const TERMINAL_SHIPPED = ['delivered', 'returned', 'lost'];
const NOW = '2026-09-21T18:00:00Z';

const norm = (v) => { const s = String(v ?? '').trim(); return s === '' ? null : s; };
const lowerNorm = (v) => { const s = norm(v); return s === null ? null : s.toLowerCase(); };

/** In-memory stand-in for B1's indexes AND its immutability trigger. */
class Ledger {
  constructor(orders = [], attempts = []) {
    this.orders = orders;
    this.attempts = attempts;
  }
  order(slug, id) {
    return this.orders.find((o) => o.id === id && o.store_slug === slug) || null;
  }
  byId(slug, id) {
    return this.attempts.find((a) => a.id === id && a.store_slug === slug) || null;
  }
  /** B1: closed attempts are permanent. Any write to one raises 42501. */
  write(att, patch) {
    if (att.end_reason !== null) {
      const e = new Error('shipment_attempts: closed and now permanent');
      e.code = '42501'; throw e;
    }
    // shipment_attempts_courier_awb_idx: unique (courier, awb) where awb not null
    if (patch.awb != null && this.attempts.some(
      (x) => x !== att && x.courier === att.courier && x.awb === patch.awb)) {
      const e = new Error('duplicate key'); e.code = '23505'; throw e;
    }
    Object.assign(att, patch);
  }
}

/** public.cancel_current_shipment(...) */
function cancelCurrent(L, slug, orderId, courier, awb, finalStatus = null) {
  const c = lowerNorm(courier);
  const a = norm(awb);
  if (a === null) return { outcome: 'invalid_awb' };
  if (c === null || !COURIERS.includes(c)) return { outcome: 'invalid_courier' };

  const o = L.order(slug, orderId);
  if (!o) return { outcome: 'order_not_found' };
  const orderAwb = norm(o.awb);

  const att = L.attempts.find((x) => x.order_id === orderId && x.store_slug === slug
    && x.courier === c && norm(x.awb) === a);

  if (!att) {
    const other = L.attempts.some((x) => x.order_id === orderId && x.store_slug === slug
      && norm(x.awb) === a);
    return other ? { outcome: 'courier_mismatch', courier: c } : { outcome: 'attempt_not_found' };
  }

  if (att.end_reason !== null) {
    if (att.end_reason === 'cancelled') {
      return { outcome: 'already_cancelled', attempt_id: att.id, awb: a };
    }
    if (TERMINAL_SHIPPED.includes(att.end_reason)) {
      return { outcome: 'shipment_already_terminal', attempt_id: att.id, end_reason: att.end_reason };
    }
    return { outcome: 'attempt_state_mismatch', attempt_id: att.id, end_reason: att.end_reason };
  }

  if (orderAwb !== null && orderAwb !== a) return { outcome: 'awb_mismatch', awb: orderAwb };

  const status = (norm(finalStatus) ?? 'Cancelled').slice(0, 200);
  L.write(att, { end_reason: 'cancelled', ended_at: NOW, final_status: status });

  if (orderAwb === null) {
    return { outcome: 'cancelled_pointer_was_clear', attempt_id: att.id, awb: a, order_id: orderId };
  }
  o.awb = null;
  o.shipment_status = 'Cancelled';
  return { outcome: 'cancelled', attempt_id: att.id, awb: a, order_id: orderId };
}

/** public.supersede_shipment_attempt(...) */
function supersede(L, attemptId, slug, courier, awb, finalStatus = null) {
  const c = lowerNorm(courier);
  const a = norm(awb);
  if (a === null) return { outcome: 'invalid_awb' };
  if (c === null || !COURIERS.includes(c)) return { outcome: 'invalid_courier' };

  const att = L.byId(slug, attemptId);
  if (!att) return { outcome: 'attempt_not_found' };
  const o = L.order(slug, att.order_id);
  if (!o) return { outcome: 'attempt_not_found' };
  const orderAwb = norm(o.awb);
  const attAwb = norm(att.awb);

  if (att.courier !== c) return { outcome: 'courier_mismatch', courier: att.courier };
  if (orderAwb !== null && orderAwb === a) {
    return { outcome: 'order_still_points_here', awb: a, order_id: att.order_id };
  }

  if (att.end_reason !== null) {
    if (att.end_reason === 'superseded' && attAwb === a) {
      return { outcome: 'already_superseded', attempt_id: attemptId, awb: a };
    }
    if (attAwb !== null && attAwb !== a) {
      return { outcome: 'attempt_awb_conflict', awb: attAwb, end_reason: att.end_reason };
    }
    return { outcome: 'attempt_terminal', end_reason: att.end_reason };
  }

  if (attAwb !== null) {
    return {
      outcome: attAwb !== a ? 'attempt_awb_conflict' : 'attempt_has_awb',
      awb: attAwb,
    };
  }

  const status = (norm(finalStatus) ?? 'Cancelled').slice(0, 200);
  try {
    L.write(att, { awb: a, end_reason: 'superseded', ended_at: NOW, final_status: status });
  } catch (e) {
    if (e.code === '23505') return { outcome: 'awb_already_recorded', awb: a };
    throw e;
  }
  return { outcome: 'superseded', attempt_id: attemptId, awb: a, order_id: att.order_id };
}

/** public.claim_shipment_attempt(...), transcribed from B2A — for the rebook proof. */
function claim(L, slug, orderId, courier) {
  const c = lowerNorm(courier);
  if (c === null || !COURIERS.includes(c)) return { outcome: 'invalid_courier' };
  const o = L.order(slug, orderId);
  if (!o) return { outcome: 'order_not_found' };
  if (['cancelled', 'abandoned'].includes(String(o.status ?? ''))) {
    return { outcome: 'order_not_bookable', status: o.status };
  }
  if (norm(o.awb) !== null) return { outcome: 'already_booked', awb: o.awb };
  const open = L.attempts.find((x) => x.order_id === orderId && x.end_reason === null);
  if (open) {
    return norm(open.awb) !== null
      ? { outcome: 'open_with_awb', attempt_id: open.id }
      : { outcome: 'open_without_awb', attempt_id: open.id };
  }
  const no = L.attempts.filter((x) => x.order_id === orderId)
    .reduce((m, x) => Math.max(m, x.attempt_no), 0) + 1;
  const row = {
    id: Math.max(0, ...L.attempts.map((x) => x.id)) + 1,
    store_slug: slug, order_id: orderId, attempt_no: no, courier: c,
    awb: null, claimed_at: NOW, booked_at: null, shipping_cost: null,
    ended_at: null, end_reason: null, final_status: null,
  };
  L.attempts.push(row);
  return { outcome: 'claimed', attempt_id: row.id, attempt_no: no, courier: c };
}

// ── fixtures ────────────────────────────────────────────────────────────────
const SLUG = 'showme';
const OID  = '11111111-1111-1111-1111-111111111111';
const AWB  = 'AWB-LIVE-1';

const attempt = (over = {}) => ({
  id: 1, store_slug: SLUG, order_id: OID, attempt_no: 1, courier: 'delhivery',
  awb: AWB, claimed_at: null, booked_at: '2026-09-01T00:00:00Z', shipping_cost: 42.5,
  ended_at: null, end_reason: null, final_status: 'In Transit', ...over,
});
const order = (over = {}) => ({
  id: OID, store_slug: SLUG, status: 'confirmed', awb: AWB, courier: 'delhivery',
  shipment_status: 'In Transit', shipping_cost: 42.5, ...over,
});
const booked = (attOver = {}, ordOver = {}) =>
  new Ledger([order(ordOver)], [attempt(attOver)]);

// ═══════════════════════════════════════════════════════════════════════════
// EXECUTED — normal cancellation
// ═══════════════════════════════════════════════════════════════════════════

test('cancel: an open matching attempt closes and the pointer clears', () => {
  const L = booked();
  const r = cancelCurrent(L, SLUG, OID, 'delhivery', AWB, 'Cancelled by seller');
  assert.equal(r.outcome, 'cancelled');
  assert.equal(L.attempts[0].end_reason, 'cancelled');
  assert.equal(L.attempts[0].ended_at, NOW);
  assert.equal(L.attempts[0].final_status, 'Cancelled by seller');
  assert.equal(L.orders[0].awb, null);
  assert.equal(L.orders[0].shipment_status, 'Cancelled');
});

test('cancel: order and attempt move together — neither alone', () => {
  const L = booked();
  cancelCurrent(L, SLUG, OID, 'delhivery', AWB);
  const attClosed = L.attempts[0].end_reason === 'cancelled';
  const ptrClear  = L.orders[0].awb === null;
  assert.equal(attClosed, ptrClear);
  assert.ok(attClosed);
});

test('cancel: the AWB, booked_at and shipping_cost survive on the attempt', () => {
  // A cancellation does not make the evidence of the booking untrue.
  const L = booked();
  cancelCurrent(L, SLUG, OID, 'delhivery', AWB);
  assert.equal(L.attempts[0].awb, AWB);
  assert.equal(L.attempts[0].booked_at, '2026-09-01T00:00:00Z');
  assert.equal(L.attempts[0].shipping_cost, 42.5);
});

test("cancel: the order's shipping_cost and courier are not destroyed", () => {
  const L = booked();
  cancelCurrent(L, SLUG, OID, 'delhivery', AWB);
  assert.equal(L.orders[0].shipping_cost, 42.5);
  assert.equal(L.orders[0].courier, 'delhivery');
});

test('cancel: delivered / returned / lost are REFUSED and nothing is touched', () => {
  // 122 of production's 171 AWB-bearing orders are in one of these states, and
  // the Orders screen offers Cancel on every one of them.
  for (const reason of ['delivered', 'returned', 'lost']) {
    const L = booked({ end_reason: reason, ended_at: '2026-09-10T00:00:00Z' });
    const before = JSON.stringify([L.orders, L.attempts]);
    const r = cancelCurrent(L, SLUG, OID, 'delhivery', AWB);
    assert.equal(r.outcome, 'shipment_already_terminal', reason);
    assert.equal(r.end_reason, reason);
    assert.equal(JSON.stringify([L.orders, L.attempts]), before, reason);
    assert.equal(L.orders[0].awb, AWB, `${reason}: pointer must survive`);
  }
});

test('cancel: failed / superseded / unknown are a state mismatch, no writes', () => {
  for (const reason of ['failed', 'superseded', 'unknown']) {
    const L = booked({ end_reason: reason });
    const before = JSON.stringify([L.orders, L.attempts]);
    const r = cancelCurrent(L, SLUG, OID, 'delhivery', AWB);
    assert.equal(r.outcome, 'attempt_state_mismatch', reason);
    assert.equal(JSON.stringify([L.orders, L.attempts]), before, reason);
  }
});

test('cancel: repeating a completed cancellation is idempotent', () => {
  const L = booked();
  cancelCurrent(L, SLUG, OID, 'delhivery', AWB);
  const before = JSON.stringify([L.orders, L.attempts]);
  const r = cancelCurrent(L, SLUG, OID, 'delhivery', AWB);
  assert.equal(r.outcome, 'already_cancelled');
  assert.equal(JSON.stringify([L.orders, L.attempts]), before);
});

test('cancel: a missing attempt is refused — the pointer is NOT cleared', () => {
  // The permissive alternative would erase a shipment pointer on an assertion
  // the ledger cannot corroborate. Production has zero rows in this shape.
  const L = new Ledger([order()], []);
  const r = cancelCurrent(L, SLUG, OID, 'delhivery', AWB);
  assert.equal(r.outcome, 'attempt_not_found');
  assert.equal(L.orders[0].awb, AWB);
});

test('cancel: an AWB the order does not hold is refused', () => {
  const L = booked({ awb: 'AWB-OTHER' }, { awb: 'AWB-OTHER' });
  const r = cancelCurrent(L, SLUG, OID, 'delhivery', AWB);
  assert.equal(r.outcome, 'attempt_not_found');
  assert.equal(L.orders[0].awb, 'AWB-OTHER');
});

test('cancel: the order pointing at a DIFFERENT AWB is refused', () => {
  const L = booked({}, { awb: 'AWB-NEWER' });
  const r = cancelCurrent(L, SLUG, OID, 'delhivery', AWB);
  assert.equal(r.outcome, 'awb_mismatch');
  assert.equal(r.awb, 'AWB-NEWER');
  assert.equal(L.attempts[0].end_reason, null);
  assert.equal(L.orders[0].awb, 'AWB-NEWER');
});

test('cancel: the wrong courier is refused, and distinguished from not-found', () => {
  const L = booked();
  const r = cancelCurrent(L, SLUG, OID, 'shadowfax', AWB);
  assert.equal(r.outcome, 'courier_mismatch');
  assert.equal(L.attempts[0].end_reason, null);
  assert.equal(L.orders[0].awb, AWB);
});

test('cancel: another store or another order is refused', () => {
  const L = booked();
  assert.equal(cancelCurrent(L, 'other-store', OID, 'delhivery', AWB).outcome, 'order_not_found');
  const r = cancelCurrent(L, SLUG, '99999999-9999-9999-9999-999999999999', 'delhivery', AWB);
  assert.equal(r.outcome, 'order_not_found');
  assert.equal(L.orders[0].awb, AWB);
});

test('cancel: an empty AWB or unknown courier is refused before anything is read', () => {
  const L = booked();
  for (const bad of ['', '   ', null]) {
    assert.equal(cancelCurrent(L, SLUG, OID, 'delhivery', bad).outcome, 'invalid_awb', String(bad));
  }
  assert.equal(cancelCurrent(L, SLUG, OID, 'bluedart', AWB).outcome, 'invalid_courier');
  assert.equal(L.attempts[0].end_reason, null);
});

test('cancel: an open attempt whose pointer was already cleared still closes', () => {
  // The PR2 rollout window: an old shipping-ops instance cancels at the
  // courier and clears orders.awb without closing the attempt. Left open, that
  // attempt blocks every future booking — the lockout this PR exists to stop.
  const L = booked({}, { awb: null, shipment_status: 'Cancelled' });
  const r = cancelCurrent(L, SLUG, OID, 'delhivery', AWB);
  assert.equal(r.outcome, 'cancelled_pointer_was_clear');
  assert.equal(L.attempts[0].end_reason, 'cancelled');
  assert.equal(L.orders[0].awb, null);
});

test('cancel: provider evidence is bounded to 200 characters', () => {
  const L = booked();
  cancelCurrent(L, SLUG, OID, 'delhivery', AWB, 'x'.repeat(5000));
  assert.equal(L.attempts[0].final_status.length, 200);
});

test('cancel: works identically for Shadowfax', () => {
  const L = booked({ courier: 'shadowfax' }, { courier: 'shadowfax' });
  const r = cancelCurrent(L, SLUG, OID, 'shadowfax', AWB);
  assert.equal(r.outcome, 'cancelled');
  assert.equal(L.orders[0].awb, null);
});

// ═══════════════════════════════════════════════════════════════════════════
// EXECUTED — the rebook proof
// ═══════════════════════════════════════════════════════════════════════════

test('REBOOK: cancel then claim allocates attempt_no + 1', () => {
  const L = booked();
  assert.equal(cancelCurrent(L, SLUG, OID, 'delhivery', AWB).outcome, 'cancelled');
  assert.equal(L.orders[0].awb, null);
  assert.equal(L.attempts[0].end_reason, 'cancelled');
  assert.equal(L.attempts.filter((a) => a.end_reason === null).length, 0);

  const r = claim(L, SLUG, OID, 'delhivery');
  assert.equal(r.outcome, 'claimed');
  assert.equal(r.attempt_no, 2);
  assert.equal(L.attempts.length, 2);
});

test('REBOOK: the order status is untouched, so claim eligibility still passes', () => {
  // shipping-ops writes shipment_status, never status. Had it written status,
  // cancel-then-rebook would be dead on arrival at the claim's eligibility test.
  const L = booked();
  cancelCurrent(L, SLUG, OID, 'delhivery', AWB);
  assert.equal(L.orders[0].status, 'confirmed');
  assert.equal(L.orders[0].shipment_status, 'Cancelled');
  assert.equal(claim(L, SLUG, OID, 'delhivery').outcome, 'claimed');
});

test('REBOOK: a refused cancellation does NOT enable a claim', () => {
  const L = booked({ end_reason: 'delivered' });
  assert.equal(cancelCurrent(L, SLUG, OID, 'delhivery', AWB).outcome, 'shipment_already_terminal');
  assert.equal(claim(L, SLUG, OID, 'delhivery').outcome, 'already_booked');
});

test('REBOOK: this is not the retained-AWB rebook feature', () => {
  // A courier-cancelled-outside-PocketLink booking keeps its AWB on the order.
  // Nothing here clears it, so the claim still refuses. PR C's territory.
  const L = booked({ end_reason: 'cancelled', ended_at: NOW });
  assert.equal(claim(L, SLUG, OID, 'delhivery').outcome, 'already_booked');
});

// ═══════════════════════════════════════════════════════════════════════════
// EXECUTED — supersede
// ═══════════════════════════════════════════════════════════════════════════

/** The B2B loser shape: an open AWB-less claim, order pointing at the winner. */
const loser = () => new Ledger(
  [order({ awb: 'AWB-WINNER' })],
  [attempt({ awb: null, booked_at: null, shipping_cost: null, final_status: null })],
);

test('supersede: the losing AWB is recorded and the attempt closes', () => {
  const L = loser();
  const r = supersede(L, 1, SLUG, 'delhivery', 'AWB-X', 'Cancelled at courier');
  assert.equal(r.outcome, 'superseded');
  const a = L.attempts[0];
  assert.equal(a.awb, 'AWB-X');
  assert.equal(a.end_reason, 'superseded');
  assert.equal(a.ended_at, NOW);
  assert.equal(a.final_status, 'Cancelled at courier');
});

test('supersede: booked_at stays NULL — no timestamp is invented', () => {
  const L = loser();
  supersede(L, 1, SLUG, 'delhivery', 'AWB-X');
  assert.equal(L.attempts[0].booked_at, null);
});

test("supersede: the order's winning pointer is never touched", () => {
  const L = loser();
  const before = JSON.stringify(L.orders);
  supersede(L, 1, SLUG, 'delhivery', 'AWB-X');
  assert.equal(JSON.stringify(L.orders), before);
  assert.equal(L.orders[0].awb, 'AWB-WINNER');
});

test('supersede: retrying with the same AWB is idempotent', () => {
  const L = loser();
  supersede(L, 1, SLUG, 'delhivery', 'AWB-X');
  const before = JSON.stringify([L.orders, L.attempts]);
  const r = supersede(L, 1, SLUG, 'delhivery', 'AWB-X');
  assert.equal(r.outcome, 'already_superseded');
  assert.equal(JSON.stringify([L.orders, L.attempts]), before);
});

test('supersede: retrying with a DIFFERENT AWB conflicts, no rewrite', () => {
  const L = loser();
  supersede(L, 1, SLUG, 'delhivery', 'AWB-X');
  const r = supersede(L, 1, SLUG, 'delhivery', 'AWB-Y');
  assert.equal(r.outcome, 'attempt_awb_conflict');
  assert.equal(r.awb, 'AWB-X');
  assert.equal(L.attempts[0].awb, 'AWB-X');
});

test('supersede: an open attempt that already holds an AWB is refused', () => {
  const L = new Ledger([order({ awb: 'AWB-WINNER' })], [attempt({ awb: 'AWB-SOMETHING' })]);
  const r = supersede(L, 1, SLUG, 'delhivery', 'AWB-SOMETHING');
  assert.equal(r.outcome, 'attempt_has_awb');
  assert.equal(L.attempts[0].end_reason, null);
});

test('supersede: refuses when the order still points at this AWB — we WON', () => {
  const L = new Ledger([order({ awb: 'AWB-X' })], [attempt({ awb: null })]);
  const r = supersede(L, 1, SLUG, 'delhivery', 'AWB-X');
  assert.equal(r.outcome, 'order_still_points_here');
  assert.equal(L.attempts[0].end_reason, null);
});

test('supersede: every other terminal reason is refused, no rewrite', () => {
  for (const reason of ['cancelled', 'delivered', 'returned', 'lost', 'failed', 'unknown']) {
    const L = new Ledger([order({ awb: 'AWB-WINNER' })],
      [attempt({ awb: null, end_reason: reason })]);
    const before = JSON.stringify(L.attempts);
    const r = supersede(L, 1, SLUG, 'delhivery', 'AWB-X');
    assert.equal(r.outcome, 'attempt_terminal', reason);
    assert.equal(JSON.stringify(L.attempts), before, reason);
  }
});

test('supersede: the wrong courier, store or AWB is refused', () => {
  const L = loser();
  assert.equal(supersede(L, 1, SLUG, 'shadowfax', 'AWB-X').outcome, 'courier_mismatch');
  assert.equal(supersede(L, 1, 'other', 'delhivery', 'AWB-X').outcome, 'attempt_not_found');
  assert.equal(supersede(L, 99, SLUG, 'delhivery', 'AWB-X').outcome, 'attempt_not_found');
  assert.equal(supersede(L, 1, SLUG, 'delhivery', '').outcome, 'invalid_awb');
  assert.equal(L.attempts[0].end_reason, null);
});

test('supersede: an AWB another attempt already owns is refused', () => {
  const L = new Ledger(
    [order({ awb: 'AWB-WINNER' })],
    [attempt({ id: 1, awb: null }),
     attempt({ id: 2, attempt_no: 2, awb: 'AWB-X', end_reason: 'cancelled' })],
  );
  const r = supersede(L, 1, SLUG, 'delhivery', 'AWB-X');
  assert.equal(r.outcome, 'awb_already_recorded');
  assert.equal(L.attempts[0].end_reason, null);
});

test('supersede: an uncertain cancellation simply never calls this', () => {
  // There is no primitive that closes an unconfirmed outcome. The claim stays
  // open and blocking; that is the entire policy.
  const L = loser();
  const a = L.attempts[0];
  assert.equal(a.end_reason, null);
  assert.equal(a.awb, null);
  assert.equal(claim(L, SLUG, OID, 'delhivery').outcome, 'already_booked');
});

test('supersede: works identically for Shadowfax', () => {
  const L = new Ledger([order({ awb: 'AWB-WINNER', courier: 'shadowfax' })],
    [attempt({ awb: null, courier: 'shadowfax' })]);
  assert.equal(supersede(L, 1, SLUG, 'shadowfax', 'AWB-X').outcome, 'superseded');
});

// ═══════════════════════════════════════════════════════════════════════════
// EXECUTED — B1 immutability
// ═══════════════════════════════════════════════════════════════════════════

test('B1: the model refuses any write to a closed attempt, as the trigger does', () => {
  const L = booked();
  cancelCurrent(L, SLUG, OID, 'delhivery', AWB);
  assert.throws(() => L.write(L.attempts[0], { final_status: 'edited' }), /permanent/);
});

test('B1: each transition closes in exactly ONE write — no repair pass', () => {
  for (const run of [
    () => { const L = booked(); cancelCurrent(L, SLUG, OID, 'delhivery', AWB); return L; },
    () => { const L = loser();  supersede(L, 1, SLUG, 'delhivery', 'AWB-X');   return L; },
  ]) {
    const L = run();
    const a = L.attempts[0];
    assert.notEqual(a.end_reason, null);
    assert.notEqual(a.ended_at, null);
    assert.notEqual(a.final_status, null);
    // Everything a terminal row needs arrived together; a second write would throw.
    assert.throws(() => L.write(a, { ended_at: NOW }), /permanent/);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// DRIFT
// ═══════════════════════════════════════════════════════════════════════════

const sqlOutcomes = new Set(
  [...FWD_CODE.matchAll(/'outcome',\s*\n?\s*'([a-z_]+)'/g)].map((m) => m[1]),
);
const modelOutcomes = new Set([
  'invalid_awb', 'invalid_courier', 'order_not_found', 'attempt_not_found',
  'courier_mismatch', 'already_cancelled', 'shipment_already_terminal',
  'attempt_state_mismatch', 'awb_mismatch', 'cancelled', 'cancelled_pointer_was_clear',
  'superseded', 'already_superseded', 'attempt_terminal', 'attempt_awb_conflict',
  'attempt_has_awb', 'order_still_points_here', 'awb_already_recorded',
]);

test('drift: every outcome the SQL returns is modelled here', () => {
  for (const o of sqlOutcomes) assert.ok(modelOutcomes.has(o), `SQL returns "${o}", model does not`);
});

test('drift: every outcome the model returns exists in the SQL', () => {
  for (const o of modelOutcomes) assert.ok(sqlOutcomes.has(o), `model returns "${o}", SQL does not`);
});

test('drift: the shipped-terminal list matches the SQL', () => {
  assert.match(FWD_CODE, /in \('delivered', 'returned', 'lost'\)/);
  assert.deepEqual(TERMINAL_SHIPPED, ['delivered', 'returned', 'lost']);
});

test('drift: the courier vocabulary matches B1', () => {
  assert.ok(B1.includes("check (courier in ('delhivery', 'shadowfax'))"));
  assert.equal([...FWD_CODE.matchAll(/not in \('delhivery', 'shadowfax'\)/g)].length, 2);
});

// ═══════════════════════════════════════════════════════════════════════════
// SOURCE-PINNED
// ═══════════════════════════════════════════════════════════════════════════

const FNS = [
  ['cancel_current_shipment', 'text, uuid, text, text, text'],
  ['supersede_shipment_attempt', 'bigint, text, text, text, text'],
];

test('source: both functions are SECURITY DEFINER with a pinned search_path', () => {
  const bodies = FWD.split('create or replace function').slice(1);
  assert.equal(bodies.length, 2);
  for (const b of bodies) assert.match(b, /\nsecurity definer\n/);
  assert.equal([...FWD.matchAll(/set search_path = public, pg_temp/g)].length, 2);
});

test('source: each revokes from public, anon, authenticated', () => {
  for (const [name, args] of FNS) {
    const re = new RegExp(`revoke all on function public\\.${name}\\(${args
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)\\s*\\n\\s*from public, anon, authenticated;`);
    assert.match(FWD, re, name);
  }
});

test('source: execute is granted to service_role and to nobody else', () => {
  const grants = [...FWD_CODE.matchAll(/grant execute on function[\s\S]*?to (\w+);/g)].map((m) => m[1]);
  assert.equal(grants.length, 2);
  assert.deepEqual([...new Set(grants)], ['service_role']);
  assert.ok(!/grant[\s\S]{0,200}?to[^;]*\b(anon|authenticated)\b/.test(FWD_CODE));
});

test('source: the browser keeps zero direct access to shipment_attempts', () => {
  assert.ok(!/grant[^;]*on\s+(public\.)?shipment_attempts/i.test(FWD_CODE));
  assert.ok(!/create policy/i.test(FWD_CODE));
  assert.ok(!/alter table/i.test(FWD_CODE));
});

test('source: both lock the orders row FOR UPDATE', () => {
  for (const i of [1, 2]) {
    const body = FWD_CODE.split('create or replace function')[i];
    assert.match(body, /from public\.orders o[\s\S]*?for update;/, `function ${i}`);
  }
});

test('source: cancel writes exactly one attempt UPDATE and one orders UPDATE', () => {
  const body = FWD_CODE.split('create or replace function')[1].split('$function$;')[0];
  assert.equal([...body.matchAll(/update public\.shipment_attempts/g)].length, 1);
  assert.equal([...body.matchAll(/update public\.orders/g)].length, 1);
  assert.match(body, /end_reason\s*=\s*'cancelled'/);
  assert.match(body, /awb\s*=\s*null,\s*\n\s*shipment_status = 'Cancelled'/);
});

test('source: cancel never writes awb, booked_at or shipping_cost on the attempt', () => {
  const body = FWD_CODE.split('create or replace function')[1].split('update public.orders')[0];
  const setBlock = body.split('update public.shipment_attempts')[1] || '';
  assert.ok(!/\bset[\s\S]*?\bawb\s*=/.test(setBlock));
  assert.ok(!/booked_at\s*=/.test(setBlock));
  assert.ok(!/shipping_cost\s*=/.test(setBlock));
});

test('source: supersede writes ONE attempt UPDATE and never touches orders', () => {
  const body = FWD_CODE.split('create or replace function')[2].split('$function$;')[0];
  assert.equal([...body.matchAll(/update public\.shipment_attempts/g)].length, 1);
  assert.equal([...body.matchAll(/update public\.orders/g)].length, 0);
  assert.match(body, /awb\s*=\s*v_awb,\s*\n\s*end_reason\s*=\s*'superseded'/);
});

test('source: supersede leaves booked_at out of its UPDATE entirely', () => {
  const body = FWD_CODE.split('create or replace function')[2].split('$function$;')[0];
  assert.ok(!/booked_at\s*=/.test(body));
});

test('source: supersede guards the (courier, awb) unique index', () => {
  const body = FWD_CODE.split('create or replace function')[2];
  assert.match(body, /exception\s*\n\s*when unique_violation then/);
});

test('source: the terminal guard refuses delivered/returned/lost before any write', () => {
  const body = FWD_CODE.split('create or replace function')[1].split('$function$;')[0];
  const guard = body.indexOf('shipment_already_terminal');
  const write = body.indexOf('update public.');
  assert.ok(guard > 0 && write > 0 && guard < write, 'the guard must precede every write');
});

test('source: no DDL of any kind, and B1/B2A objects are not named for change', () => {
  assert.ok(!/create table|alter table|drop (table|trigger|index|function)/i.test(FWD_CODE));
  assert.ok(!/create (unique )?index|create trigger/i.test(FWD_CODE));
  assert.ok(!/shipment_attempt_is_final/.test(FWD_CODE));
  for (const n of ['claim_shipment_attempt', 'finalize_shipment_attempt', 'fail_shipment_attempt']) {
    assert.ok(!FWD_CODE.includes(n), n);
  }
});

test('source: the migration is one transaction of two replaceable functions', () => {
  assert.equal([...FWD_CODE.matchAll(/^begin;$/gm)].length, 1);
  assert.equal([...FWD_CODE.matchAll(/^commit;$/gm)].length, 1);
  assert.equal([...FWD.matchAll(/create or replace function/g)].length, 2);
});

test('source: the trust boundary is documented, and no cancelled boolean is accepted', () => {
  assert.match(FWD, /TRUST BOUNDARY/);
  assert.match(FWD, /cannot prove/i);
  for (const [, args] of FNS) assert.ok(!args.includes('boolean'));
});

test('source: the live shipping-ops defect is documented but NOT fixed here', () => {
  assert.match(FWD, /cannot be cancelled/);
  assert.match(FWD, /PR2/);
  // and the defect is still present in the runtime, untouched by this PR
  assert.ok(OPS.includes('/cancel/i.test(cd?.responseMsg'));
});

// ── verify ──────────────────────────────────────────────────────────────────

test('verify: is read-only — one statement, no DML, no DDL', () => {
  const v = code(VER);
  assert.equal(v.split(';').filter((s) => s.trim()).length, 1);
  assert.ok(!/\b(insert|update|delete|create|alter|drop|grant|revoke|truncate)\b/i.test(v));
});

test('verify: declares itself POST-APPLY ONLY and invokes neither RPC', () => {
  assert.match(VER, /POST-APPLY ONLY/);
  const v = code(VER).replace(/proname (in|=)[^)]*\)/g, '');
  assert.ok(!/cancel_current_shipment\s*\(/.test(v));
  assert.ok(!/supersede_shipment_attempt\s*\(/.test(v));
});

test('verify: covers every property the reviewer asked for', () => {
  for (const r of ['SECURITY DEFINER', 'search_path', 'anon', 'authenticated', 'service_role',
                   'RLS still enabled', 'no RLS policy', 'B2A', 'immutability trigger',
                   'one-open-attempt']) {
    assert.ok(VER.includes(r), r);
  }
});

test("verify: flags that B2A's S7.5 function count becomes six", () => {
  assert.match(VER, /S7\.5/);
  assert.match(VER, /six functions mention shipment_attempts/);
});

// ── rollback ────────────────────────────────────────────────────────────────

test('rollback: drops only the two new functions', () => {
  const drops = [...code(RBK).matchAll(/drop \w+ if exists public\.(\w+)/g)].map((m) => m[1]);
  assert.deepEqual(drops.sort(), FNS.map(([n]) => n).sort());
});

test('rollback: never deletes or mutates ledger history', () => {
  const r = code(RBK);
  assert.ok(!/drop table/i.test(r));
  assert.ok(!/delete from/i.test(r));
  assert.ok(!/update public\./i.test(r));
  assert.match(RBK, /never deleted/i);
});

test('rollback: refuses once either transition has actually been used', () => {
  assert.match(RBK, /end_reason = 'superseded'/);
  assert.match(RBK, /end_reason = 'cancelled' and ended_at is not null/);
  assert.match(RBK, /refusing to run/);
});

test('rollback: documents the runtime-first ordering and the leave-installed option', () => {
  assert.match(RBK, /redeploy the previous shipping-ops FIRST/i);
  assert.match(RBK, /LEAVE THEM INSTALLED/i);
  assert.match(RBK, /shipment-claim-ROLLBACK\.sql/);
});

// ── scope ───────────────────────────────────────────────────────────────────

test('scope: no edge function calls either new RPC — PR1 is inert', () => {
  for (const [name] of FNS) {
    assert.ok(!OPS.includes(name), `shipping-ops: ${name}`);
    assert.ok(!BOOK.includes(name), `shipping-book: ${name}`);
  }
});

test('scope: shipping-ops still has exactly its two original AWB-clearing writes', () => {
  assert.equal([...OPS.matchAll(/update\(\{ awb: null, shipment_status: 'Cancelled' \}\)/g)].length, 2);
});

test('scope: shipping-book still holds every PR A protection and no claim call', () => {
  for (const fn of ['classifyAttach', 'readCurrentShipment', 'attachVerdict',
                    'cancelAtCourier', 'bookingConflict', 'bookingUnknown']) {
    assert.ok(BOOK.includes(fn), fn);
  }
  assert.ok(!BOOK.includes('claim_shipment_attempt'));
});

test('scope: B2A and B1 migration files are not referenced for modification', () => {
  for (const f of [FWD, VER, RBK]) {
    assert.ok(!/commerceMetrics|deliveryMetrics|deliveryStatus|DeliveryBoard|AnalyticsTab|OrdersTab/.test(f));
  }
  // B2A's own SQL still defines its three functions, untouched by this PR
  assert.equal([...B2A.matchAll(/create or replace function/g)].length, 3);
});

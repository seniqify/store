// Pre-B2B ledger gap repair (B2A.1 follow-up). B1 filled shipment_attempts
// once; nothing has written it since, so every shipment booked after B1 has an
// AWB and no ledger row. The repair writes exactly those -- AWB-bearing orders
// with a delhivery/shadowfax courier and no row -- under B1's truth rules, and
// deliberately excludes every order WITHOUT an AWB.
//
// WHAT THIS FILE CAN AND CANNOT PROVE. There is no Postgres in the test run.
//
//   EXECUTED       the selection and the derivation, transcribed into the model
//                  below and run against production-shaped fixtures: the 41
//                  post-B1 bookings, the ambiguous cancelled-then-delivered
//                  order, B1-era history, and the refusal cases.
//
//   SOURCE-PINNED  the SQL itself: the exact predicate, B1's derivation copied
//                  byte-for-byte, the truth rules, no writes outside one
//                  INSERT, and a read-only verify.
//
// The SQL was also executed end to end against real Postgres (PGlite) during
// review, with the schema built from the real B1/B2A/B2A.1 migrations; that
// harness is not part of this suite because it would add a dependency.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8')
  .replace(/\r\n/g, '\n');

const REPAIR = read('supabase/shipment-attempts-gap-repair.sql');
const VERIFY = read('supabase/shipment-attempts-gap-verify.sql');
const B1     = read('supabase/shipment-attempts-forward.sql');
const OPS    = read('supabase/functions/shipping-ops/index.ts');
const BOOK   = read('supabase/functions/shipping-book/index.ts');

const code = (s) => s.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
const REPAIR_CODE = code(REPAIR);
const VERIFY_CODE = code(VERIFY);
const squash = (s) => s.replace(/\s+/g, ' ').trim();

// ───────────────────────────────────────────────────────────────────────────
// The model. Transcribed from shipment-attempts-gap-repair.sql.
// ───────────────────────────────────────────────────────────────────────────

const VALID = ['delhivery', 'shadowfax'];
const norm = (v) => { const s = String(v ?? '').trim(); return s === '' ? null : s; };
/** lower(btrim(coalesce(o.courier, ''))) */
const courierOf = (o) => String(o.courier ?? '').trim().toLowerCase();

/** B1's end_reason derivation -- drift-pinned against both SQL files below. */
const endReason = (o) => {
  const st = String(o.shipment_status ?? '');
  if (o.shipment_outcome === 'delivered') return 'delivered';
  if (o.shipment_outcome === 'returned') return 'returned';
  if (o.shipment_outcome === 'lost') return 'lost';
  if (/(rto|rts|return)/i.test(st)) return 'returned';
  if (/\blost\b/i.test(st)) return 'lost';
  if (/\bdelivered\b/i.test(st) && !/(undeliver|not deliver)/i.test(st)) return 'delivered';
  if (/cancel/i.test(st)) return 'cancelled';
  return null;
};

const hasRow = (o, attempts) => attempts.some((a) => a.order_id === o.id);

/** The repair's candidate predicate. */
const isCandidate = (o, attempts) =>
  norm(o.awb) !== null && VALID.includes(courierOf(o)) && !hasRow(o, attempts);

/** B1's backfill predicate, unchanged -- what re-running B1 would write. */
const b1WouldWrite = (o, attempts) =>
  (o.awb != null || o.courier != null) && courierOf(o) !== '' && !hasRow(o, attempts);

/** The repair: preflight, then one all-or-nothing insert. */
function repair(orders, attempts) {
  const cand = orders.filter((o) => isCandidate(o, attempts));
  const key = (o) => `${courierOf(o)}|${norm(o.awb)}`;
  const counts = new Map();
  for (const o of cand) counts.set(key(o), (counts.get(key(o)) || 0) + 1);
  if ([...counts.values()].some((n) => n > 1)) throw new Error('refused: repeated (courier, AWB)');
  if (cand.some((o) => attempts.some((a) => a.courier === courierOf(o) && a.awb === norm(o.awb)))) {
    throw new Error('refused: AWB already in the ledger');
  }
  if (cand.some((o) => !o.store_slug)) throw new Error('refused: no store');

  let id = attempts.reduce((m, a) => Math.max(m, a.id), 0);
  const written = cand.map((o) => {
    const r = endReason(o);
    return {
      id: ++id, store_slug: o.store_slug, order_id: o.id, attempt_no: 1,
      courier: courierOf(o), awb: norm(o.awb),
      claimed_at: null, booked_at: null,
      shipping_cost: o.shipping_cost ?? null,
      ended_at: r === 'delivered' ? (o.delivered_at ?? null)
        : (r === 'returned' || r === 'lost') ? (o.returned_at ?? null) : null,
      end_reason: r,
      final_status: norm(o.shipment_status),
    };
  });
  attempts.push(...written);
  return written;
}

// ── production-shaped fixtures, from the 2026-09-25 diagnostic ──────────────
let seq = 0;
const oid = () => `order-${++seq}`;
const B1_TIME = '2026-09-21T12:26:00Z';

function production() {
  const orders = [];
  const attempts = [];
  const ledger = (o, reason) => {
    orders.push(o);
    attempts.push({
      id: attempts.length + 1, store_slug: o.store_slug, order_id: o.id, attempt_no: 1,
      courier: courierOf(o), awb: norm(o.awb), claimed_at: null, booked_at: null,
      shipping_cost: o.shipping_cost ?? null, ended_at: null, end_reason: reason,
      final_status: norm(o.shipment_status),
    });
  };
  // B1-era history: open and terminal, all already in the ledger
  for (let i = 0; i < 5; i++) {
    ledger({ id: oid(), store_slug: 'store-a', awb: `OLD-OPEN-${i}`, courier: 'shadowfax',
      shipment_status: 'In Transit', shipping_cost: 60 }, null);
  }
  ledger({ id: oid(), store_slug: 'store-a', awb: 'OLD-DLV', courier: 'delhivery',
    shipment_status: 'Delivered', shipment_outcome: 'delivered' }, 'delivered');
  // B1's two in-app cancellations: courier kept, AWB cleared
  for (let i = 0; i < 2; i++) {
    ledger({ id: oid(), store_slug: 'store-b', awb: null, courier: 'shadowfax',
      shipment_status: 'Cancelled' }, 'cancelled');
  }
  // a local delivery: no courier at all, never a ledger candidate
  orders.push({ id: oid(), store_slug: 'store-b', awb: null, courier: null,
    shipment_outcome: 'delivered' });

  // the 41 post-B1 bookings: 40 Shadowfax, 1 Delhivery, two stores
  const statuses = ['Bag In Transit', 'Picked', 'Bag Received'];
  const gaps = [];
  for (let i = 0; i < 40; i++) {
    gaps.push({ id: oid(), store_slug: i % 2 ? 'store-x' : 'store-y', awb: `SFX-${i}`,
      courier: 'shadowfax', shipment_status: statuses[i % 3], shipping_cost: 55,
      created_at: i < 4 ? '2026-09-21T11:04:00Z' : '2026-09-22T09:00:00Z' });
  }
  gaps.push({ id: oid(), store_slug: 'store-y', awb: 'DLV-1', courier: 'delhivery',
    shipment_status: 'Manifested', shipping_cost: 70 });
  // one the seller has since marked delivered: outcome outranks the raw status
  Object.assign(gaps[5], { shipment_outcome: 'delivered', delivered_at: '2026-09-23T18:30:00Z' });
  orders.push(...gaps);

  // THE AMBIGUOUS ORDER: booked after B1, cancelled in the app (AWB cleared,
  // courier kept), later marked delivered.
  const ambiguous = { id: oid(), store_slug: 'store-x', awb: null, courier: 'shadowfax',
    shipment_status: 'Cancelled', shipment_outcome: 'delivered',
    delivered_at: '2026-09-24T10:00:00Z' };
  orders.push(ambiguous);

  return { orders, attempts, gaps, ambiguous };
}

// ═══════════════════════════════════════════════════════════════════════════
// EXECUTED — what the repair writes
// ═══════════════════════════════════════════════════════════════════════════

test('writes exactly the 41 proven gaps: 40 Shadowfax + 1 Delhivery, 40 open + 1 delivered', () => {
  const { orders, attempts } = production();
  const w = repair(orders, attempts);
  assert.equal(w.length, 41);
  assert.equal(w.filter((a) => a.courier === 'shadowfax').length, 40);
  assert.equal(w.filter((a) => a.courier === 'delhivery').length, 1);
  assert.equal(w.filter((a) => a.end_reason === null).length, 40);
  assert.equal(w.filter((a) => a.end_reason === 'delivered').length, 1);
});

test('the ambiguous cancelled-then-delivered no-AWB order is NOT written', () => {
  const { orders, attempts, ambiguous } = production();
  repair(orders, attempts);
  assert.equal(attempts.filter((a) => a.order_id === ambiguous.id).length, 0);
});

test('...whereas re-running B1 unchanged WOULD write it, frozen as "delivered, no AWB"', () => {
  // The reason the repair is not simply B1 re-run.
  const { orders, attempts, ambiguous } = production();
  const b1 = orders.filter((o) => b1WouldWrite(o, attempts));
  assert.equal(b1.length, 42);
  assert.ok(b1.includes(ambiguous));
  assert.equal(endReason(ambiguous), 'delivered');
  assert.equal(norm(ambiguous.awb), null);
});

test('every order without an AWB is excluded, including blank and whitespace AWBs', () => {
  const orders = [
    { id: 'a', store_slug: 's', awb: null,  courier: 'shadowfax', shipment_status: 'Cancelled' },
    { id: 'b', store_slug: 's', awb: '',    courier: 'shadowfax', shipment_status: 'Picked' },
    { id: 'c', store_slug: 's', awb: '   ', courier: 'delhivery', shipment_status: 'Picked' },
  ];
  assert.equal(repair(orders, []).length, 0);
});

test('courier must normalise to exactly delhivery or shadowfax', () => {
  const orders = [
    { id: 'a', store_slug: 's', awb: 'A1', courier: '  Shadowfax ', shipment_status: 'Picked' },
    { id: 'b', store_slug: 's', awb: 'B1', courier: 'DELHIVERY',     shipment_status: 'Picked' },
    { id: 'c', store_slug: 's', awb: 'C1', courier: 'bluedart',      shipment_status: 'Picked' },
    { id: 'd', store_slug: 's', awb: 'D1', courier: '',              shipment_status: 'Picked' },
    { id: 'e', store_slug: 's', awb: 'E1', courier: null,            shipment_status: 'Picked' },
  ];
  const w = repair(orders, []);
  assert.deepEqual(w.map((a) => [a.order_id, a.courier]), [['a', 'shadowfax'], ['b', 'delhivery']]);
});

test("B1's truth rules: attempt 1, no invented claim or booking time, quote copied", () => {
  const { orders, attempts } = production();
  for (const a of repair(orders, attempts)) {
    assert.equal(a.attempt_no, 1);
    assert.equal(a.claimed_at, null);
    assert.equal(a.booked_at, null);
    const o = orders.find((x) => x.id === a.order_id);
    assert.equal(a.shipping_cost, o.shipping_cost ?? null);
    assert.equal(a.final_status, norm(o.shipment_status));
    assert.equal(a.awb, norm(o.awb));
  }
});

test('terminal times come only from delivered_at / returned_at -- never invented', () => {
  const orders = [
    { id: 'open', store_slug: 's', awb: 'O', courier: 'shadowfax', shipment_status: 'Picked' },
    { id: 'dlv',  store_slug: 's', awb: 'D', courier: 'shadowfax', shipment_outcome: 'delivered',
      delivered_at: '2026-09-23T18:30:00Z' },
    { id: 'dlv-no-time', store_slug: 's', awb: 'N', courier: 'shadowfax', shipment_outcome: 'delivered' },
    { id: 'rto', store_slug: 's', awb: 'R', courier: 'delhivery', shipment_status: 'RTO Delivered',
      returned_at: '2026-09-24T08:00:00Z' },
  ];
  const w = Object.fromEntries(repair(orders, []).map((a) => [a.order_id, a]));
  assert.equal(w.open.ended_at, null);
  assert.equal(w.dlv.ended_at, '2026-09-23T18:30:00Z');
  assert.equal(w['dlv-no-time'].end_reason, 'delivered');
  assert.equal(w['dlv-no-time'].ended_at, null);         // a reason without a time, as B1 allows
  assert.equal(w.rto.end_reason, 'returned');
  assert.equal(w.rto.ended_at, '2026-09-24T08:00:00Z');
});

test("shipment_outcome outranks the raw status, exactly as B1 decided", () => {
  // The one production gap whose seller marked it delivered while the courier
  // status still reads in transit.
  const o = { id: 'x', store_slug: 's', awb: 'X', courier: 'shadowfax',
    shipment_status: 'Bag In Transit', shipment_outcome: 'delivered' };
  assert.equal(repair([o], [])[0].end_reason, 'delivered');
});

test('existing attempts, open or closed, are never modified', () => {
  const { orders, attempts } = production();
  const before = JSON.stringify(attempts);
  const n = attempts.length;
  repair(orders, attempts);
  assert.equal(JSON.stringify(attempts.slice(0, n)), before);
});

test('idempotent: a second run writes nothing', () => {
  const { orders, attempts } = production();
  repair(orders, attempts);
  const total = attempts.length;
  assert.equal(repair(orders, attempts).length, 0);
  assert.equal(attempts.length, total);
});

test('a booking made after the first run is written by the next run, and nothing else', () => {
  const { orders, attempts } = production();
  repair(orders, attempts);
  orders.push({ id: 'late', store_slug: 's', awb: 'SFX-LATE', courier: 'shadowfax', shipment_status: 'Picked' });
  const w = repair(orders, attempts);
  assert.deepEqual(w.map((a) => a.order_id), ['late']);
});

test('may write more than 41 -- every later booking is a gap of the same shape', () => {
  const { orders, attempts } = production();
  for (let i = 0; i < 3; i++) {
    orders.push({ id: `more-${i}`, store_slug: 's', awb: `MORE-${i}`, courier: 'shadowfax',
      shipment_status: 'Picked' });
  }
  assert.equal(repair(orders, attempts).length, 44);
});

test('refuses, writing nothing, when two gap orders share a (courier, AWB)', () => {
  const { orders, attempts } = production();
  orders.push({ id: 'd1', store_slug: 's', awb: 'DUP', courier: 'shadowfax', shipment_status: 'Picked' });
  orders.push({ id: 'd2', store_slug: 's', awb: 'DUP', courier: 'Shadowfax', shipment_status: 'Picked' });
  const before = JSON.stringify(attempts);
  assert.throws(() => repair(orders, attempts), /repeated/);
  assert.equal(JSON.stringify(attempts), before);
});

test('refuses, writing nothing, when a gap AWB is already held by a ledger row', () => {
  const { orders, attempts } = production();
  orders.push({ id: 't', store_slug: 's', awb: 'OLD-OPEN-0', courier: 'shadowfax', shipment_status: 'Picked' });
  const before = JSON.stringify(attempts);
  assert.throws(() => repair(orders, attempts), /already in the ledger/);
  assert.equal(JSON.stringify(attempts), before);
});

test('refuses, writing nothing, when a gap order has no store', () => {
  const orders = [{ id: 'n', store_slug: null, awb: 'N1', courier: 'shadowfax', shipment_status: 'Picked' }];
  const attempts = [];
  assert.throws(() => repair(orders, attempts), /no store/);
  assert.equal(attempts.length, 0);
});

test('the repair never produces an AWB-less row', () => {
  const { orders, attempts } = production();
  assert.equal(repair(orders, attempts).filter((a) => a.awb === null).length, 0);
});

// ═══════════════════════════════════════════════════════════════════════════
// DRIFT — the model and both SQL files must agree with B1
// ═══════════════════════════════════════════════════════════════════════════

const caseBlock = (sql) => {
  const m = code(sql).match(/case\s+when o\.shipment_outcome = 'delivered'[\s\S]*?else null\s+end/);
  assert.ok(m, 'derivation CASE not found');
  return squash(m[0]);
};

test("drift: the repair's derivation is B1's, byte-for-byte after whitespace", () => {
  assert.equal(caseBlock(REPAIR), caseBlock(B1));
});

test("drift: the verify's freshness derivation is B1's too", () => {
  assert.equal(caseBlock(VERIFY), caseBlock(B1));
});

test('drift: the JS transcription matches the SQL branch for branch', () => {
  const sql = caseBlock(REPAIR);
  for (const frag of [
    "o.shipment_outcome = 'delivered' then 'delivered'",
    "o.shipment_outcome = 'returned' then 'returned'",
    "o.shipment_outcome = 'lost' then 'lost'",
    "~* '(rto|rts|return)' then 'returned'",
    "~* '\\mlost\\M' then 'lost'",
    "~* '\\mdelivered\\M' and coalesce(o.shipment_status, '') !~* '(undeliver|not deliver)' then 'delivered'",
    "~* 'cancel' then 'cancelled'",
  ]) {
    assert.ok(sql.includes(frag), frag);
  }
  // and the transcription behaves as those branches say
  assert.equal(endReason({ shipment_status: 'Undelivered - customer not available' }), null);
  assert.equal(endReason({ shipment_status: 'RTO In Transit' }), 'returned');
  assert.equal(endReason({ shipment_status: 'Cancelled' }), 'cancelled');
});

// ═══════════════════════════════════════════════════════════════════════════
// SOURCE-PINNED — the repair SQL
// ═══════════════════════════════════════════════════════════════════════════

const PREDICATE = squash(`
   where nullif(btrim(coalesce(o.awb, '')), '') is not null
     and lower(btrim(coalesce(o.courier, ''))) in ('delhivery', 'shadowfax')
     and not exists (select 1 from public.shipment_attempts sa where sa.order_id = o.id)`);

test('source: the candidate predicate is exactly the three agreed conditions', () => {
  assert.ok(squash(REPAIR_CODE).includes(PREDICATE));
});

test('source: the preflight and the insert use the identical predicate', () => {
  const hits = squash(REPAIR_CODE).split(PREDICATE).length - 1;
  assert.equal(hits, 2);
});

test("source: B1's no-AWB branch -- 'or o.courier is not null' -- is absent", () => {
  assert.ok(!/o\.awb is not null or o\.courier is not null/.test(REPAIR_CODE));
  assert.ok(!/or\s+o\.courier\s+is\s+not\s+null/.test(REPAIR_CODE));
  // while B1's own file still has it: B1 was not edited
  assert.ok(/where \(o\.awb is not null or o\.courier is not null\)/.test(B1));
});

test('source: the insert writes attempt 1 with no claim or booking time', () => {
  const ins = REPAIR_CODE.slice(REPAIR_CODE.indexOf('insert into public.shipment_attempts'));
  assert.match(ins, /\(store_slug, order_id, attempt_no, courier, awb,\s*claimed_at, booked_at, shipping_cost, ended_at, end_reason, final_status\)/);
  assert.match(ins, /c\.id,\s*1,\s*c\.courier,\s*c\.awb,\s*null,[^\n]*\n\s*null,[^\n]*\n\s*c\.shipping_cost,/);
});

test('source: terminal times map only to delivered_at / returned_at', () => {
  const ins = REPAIR_CODE.slice(REPAIR_CODE.indexOf('insert into public.shipment_attempts'));
  assert.match(ins, /case c\.reason\s+when 'delivered' then c\.delivered_at\s+when 'returned'\s+then c\.returned_at\s+when 'lost'\s+then c\.returned_at\s+else null/);
});

test('source: nothing is timestamped now -- no invented times anywhere', () => {
  // String literals are blanked first: the verify's labels say things like
  // "ledger rows now (173 before the repair)", which is English, not now().
  const noLiterals = (s) => s.replace(/'(?:[^']|'')*'/g, "''");
  for (const f of [noLiterals(REPAIR_CODE), noLiterals(VERIFY_CODE)]) {
    assert.ok(!/\b(now|clock_timestamp|statement_timestamp|transaction_timestamp)\s*\(/i.test(f));
    assert.ok(!/\b(current_timestamp|localtimestamp)\b/i.test(f));
  }
});

test('source: exactly one INSERT, into the ledger, and no other write of any kind', () => {
  assert.equal([...REPAIR_CODE.matchAll(/\binsert\s+into\b/gi)].length, 1);
  assert.match(REPAIR_CODE, /insert into public\.shipment_attempts/);
  assert.ok(!/\b(update|delete|truncate|merge)\b/i.test(REPAIR_CODE));
  assert.ok(!/\b(create|alter|drop|grant|revoke)\b/i.test(REPAIR_CODE));
  assert.ok(!/on\s+conflict/i.test(REPAIR_CODE));
});

test('source: public.orders is only ever read', () => {
  assert.ok(!/(insert\s+into|update)\s+public\.orders/i.test(REPAIR_CODE));
});

test('source: the preflight refuses with a plain "Nothing was written" message', () => {
  const pre = REPAIR_CODE.slice(REPAIR_CODE.indexOf('do $preflight$'),
    REPAIR_CODE.indexOf('$preflight$;') + 12);
  assert.ok(pre.length > 100);
  assert.equal([...pre.matchAll(/raise exception/g)].length, 4);
  assert.equal([...pre.matchAll(/Nothing was written\./g)].length, 4);
  assert.match(pre, /to_regclass\('public\.shipment_attempts'\) is null/);
});

test('source: the report is the last statement, so the SQL Editor shows it', () => {
  assert.ok(REPAIR_CODE.trim().endsWith('order by seq;'));
  assert.ok(!/^\s*(begin|commit)\s*;/im.test(REPAIR_CODE));
});

test('source: the repair reports before / written / after', () => {
  for (const g of ["'1 before'", "'2 written'", "'3 after'"]) assert.ok(REPAIR_CODE.includes(g), g);
  assert.match(REPAIR_CODE, /returning courier, awb, end_reason/);
});

test('source: the PR2 note is documented -- an order-side terminal gate, not B3', () => {
  assert.match(REPAIR, /NOTE FOR PR2/);
  assert.match(REPAIR, /shipment_outcome in \('delivered', 'returned', 'lost'\)/);
  assert.match(REPAIR, /BEFORE contacting\s+-- the courier/);
  assert.match(REPAIR, /explicitly positive/);
  assert.match(REPAIR, /It is NOT B3/);
});

// ═══════════════════════════════════════════════════════════════════════════
// SOURCE-PINNED — the verify SQL
// ═══════════════════════════════════════════════════════════════════════════

test('verify: is read-only -- one statement, no DML, no DDL', () => {
  assert.equal(VERIFY_CODE.split(';').filter((s) => s.trim()).length, 1);
  assert.ok(!/\b(insert|update|delete|truncate|merge|create|alter|drop|grant|revoke)\b/i.test(VERIFY_CODE));
});

test('verify: declares itself POST-APPLY ONLY and invokes no RPC', () => {
  assert.match(VERIFY, /POST-APPLY ONLY/);
  const body = VERIFY_CODE.replace(/p\.proname in \([^)]*\)/g, '');
  for (const fn of ['claim_shipment_attempt', 'finalize_shipment_attempt', 'fail_shipment_attempt',
                    'cancel_current_shipment', 'supersede_shipment_attempt']) {
    assert.ok(!new RegExp(`${fn}\\s*\\(`).test(body), fn);
  }
});

test('verify: proves every property the brief asked for', () => {
  const need = [
    'R1 orders with an AWB and a delhivery/shadowfax courier but no ledger row',
    'R3 orders with a courier but NO AWB',
    "R4 every AWB-less ledger row is one of B1''s historical cancellations",
    'I1 no two rows share (order_id, attempt_no)',
    'I2 no two rows share (courier, awb)',
    'I3 at most one OPEN attempt per order',
    'S1 all five ledger RPCs exist exactly once',
    'S2 all five are SECURITY DEFINER',
    'S3 all five pin search_path',
    'S4 PUBLIC cannot execute', 'S5 anon cannot execute', 'S6 authenticated cannot execute',
    'S7 service_role can execute all five',
    'S8 shipment_attempts RLS still enabled', 'S9 still no RLS policy',
    'S14 immutability trigger', 'C1 ledger rows now (173 before the repair)',
  ];
  for (const n of need) assert.ok(VERIFY.includes(n), n);
});

test('verify: names all five RPCs it checks', () => {
  for (const fn of ['claim_shipment_attempt', 'finalize_shipment_attempt', 'fail_shipment_attempt',
                    'cancel_current_shipment', 'supersede_shipment_attempt']) {
    assert.ok(VERIFY_CODE.includes(`'${fn}'`), fn);
  }
});

test('verify: no string literal hides a semicolon', () => {
  const lits = [...VERIFY_CODE.matchAll(/'(?:[^']|'')*'/g)].map((m) => m[0]);
  assert.ok(lits.every((s) => !s.includes(';')));
});

// ═══════════════════════════════════════════════════════════════════════════
// EXECUTED — R4 under SQL's three-valued logic
// ═══════════════════════════════════════════════════════════════════════════
// Postgres evaluates a WHERE clause in three values: TRUE, FALSE and UNKNOWN
// (NULL), and keeps a row only when the clause is TRUE. JavaScript's own
// booleans would hide exactly the defect being fixed, so R4 is evaluated here
// with SQL's rules instead.
const T = true, F = false, U = null;
const and3 = (...xs) => (xs.includes(F) ? F : xs.includes(U) ? U : T);
const or3  = (...xs) => (xs.includes(T) ? T : xs.includes(U) ? U : F);
const not3 = (x) => (x === U ? U : !x);
const eq3  = (x, y) => (x == null || y == null ? U : x === y);      // SQL  =
const isNull = (x) => x == null;                                    // SQL  IS NULL  -- never UNKNOWN
const notDistinct = (x, y) => (x == null ? y == null : y != null && x === y); // IS NOT DISTINCT FROM
const whereKeeps = (v) => v === T;

/** R4 as first written -- the defect. */
const r4Before = (a) => and3(
  isNull(a.awb),
  isNull(a.claimed_at),
  not3(and3(eq3(a.end_reason, 'cancelled'), isNull(a.ended_at))),
);

/** R4 as fixed -- transcribed from shipment-attempts-gap-verify.sql. */
const r4 = (a) => and3(
  isNull(a.awb),
  not3(or3(
    and3(notDistinct(a.end_reason, 'cancelled'), isNull(a.ended_at), isNull(a.claimed_at)),
    !isNull(a.claimed_at),
  )),
);

const row = (over) => ({ awb: null, claimed_at: null, end_reason: null, ended_at: null, ...over });

test('R4: an AWB-less, unclaimed row with end_reason NULL is in the FAIL population', () => {
  const malformed = row({});
  assert.equal(whereKeeps(r4(malformed)), true);
});

test('R4: ...which the original predicate silently dropped as UNKNOWN', () => {
  // The defect, reproduced: NOT (NULL AND TRUE) is NULL, and WHERE drops NULL.
  const malformed = row({});
  assert.equal(r4Before(malformed), U);
  assert.equal(whereKeeps(r4Before(malformed)), false);
});

test("R4: B1's historical cancellation is still accepted", () => {
  assert.equal(whereKeeps(r4(row({ end_reason: 'cancelled' }))), false);
});

test('R4: a B2B claim is still accepted -- open, failed, or closed any other way', () => {
  for (const end_reason of [null, 'failed', 'cancelled', 'superseded']) {
    const claim = row({ claimed_at: '2026-09-26T10:00:00Z', end_reason,
      ended_at: end_reason ? '2026-09-26T10:05:00Z' : null });
    assert.equal(whereKeeps(r4(claim)), false, String(end_reason));
  }
});

test('R4: the ambiguous shape -- AWB-less, unclaimed, "delivered" -- would FAIL', () => {
  // What re-running B1 unchanged would have written for the excluded order.
  const frozen = row({ end_reason: 'delivered', ended_at: '2026-09-24T10:00:00Z' });
  assert.equal(whereKeeps(r4(frozen)), true);
});

test("R4: a cancellation WITH an end time is not B1's shape, and FAILS", () => {
  assert.equal(whereKeeps(r4(row({ end_reason: 'cancelled', ended_at: '2026-09-26T10:00:00Z' }))), true);
});

test('R4: rows that carry an AWB are never in its population', () => {
  for (const end_reason of [null, 'delivered', 'cancelled']) {
    assert.equal(whereKeeps(r4(row({ awb: 'X1', end_reason }))), false, String(end_reason));
  }
});

test('R4: the fixed predicate is never UNKNOWN, for any combination of its columns', () => {
  let cases = 0;
  for (const awb of [null, 'X1']) {
    for (const claimed_at of [null, '2026-09-26T10:00:00Z']) {
      for (const end_reason of [null, 'cancelled', 'delivered', 'returned', 'lost',
                                'failed', 'superseded', 'unknown']) {
        for (const ended_at of [null, '2026-09-26T10:05:00Z']) {
          const v = r4({ awb, claimed_at, end_reason, ended_at });
          assert.notEqual(v, U, JSON.stringify({ awb, claimed_at, end_reason, ended_at }));
          cases++;
        }
      }
    }
  }
  assert.equal(cases, 64);
});

// ═══════════════════════════════════════════════════════════════════════════
// SOURCE-PINNED — R4's SQL, and the repair left untouched
// ═══════════════════════════════════════════════════════════════════════════

const R4_WHERE = squash(`
                where a.awb is null
                  and not (
                        (a.end_reason is not distinct from 'cancelled'
                         and a.ended_at is null
                         and a.claimed_at is null)
                     or a.claimed_at is not null
                  )`);

test('source: R4 uses the NULL-safe predicate, for its check and for its FAIL count', () => {
  assert.equal(squash(VERIFY_CODE).split(R4_WHERE).length - 1, 2);
});

test('source: the NULL-unsafe original is gone', () => {
  assert.ok(!/not \(a\.end_reason = 'cancelled'/.test(VERIFY_CODE));
  assert.ok(!/a\.end_reason = 'cancelled'/.test(VERIFY_CODE));
});

test('source: R4 is transcribed faithfully -- every operand of the model is in the SQL', () => {
  for (const frag of ['a.awb is null', "a.end_reason is not distinct from 'cancelled'",
                      'a.ended_at is null', 'a.claimed_at is null', 'a.claimed_at is not null']) {
    assert.ok(R4_WHERE.includes(frag), frag);
  }
});

test('source: the reviewed repair SQL is byte-for-byte unchanged', () => {
  // Pinned to the version reviewed in PR #25. The repair writes production
  // ledger history that can never be edited; changing it must be a deliberate,
  // reviewed act that updates this hash in the same commit.
  const sha = createHash('sha256').update(REPAIR).digest('hex');
  assert.equal(sha, '407a77f2aaf04ff852c6943fb22f8220f16883bafed876da404ebb1a788c6faa');
});

// ═══════════════════════════════════════════════════════════════════════════
// SCOPE
// ═══════════════════════════════════════════════════════════════════════════

test('scope: no edge function references the repair', () => {
  for (const src of [OPS, BOOK]) assert.ok(!/gap-repair|gap_repair/.test(src));
});

test('scope: PR2 -- shipping-ops clears the AWB only through cancel_current_shipment', () => {
  assert.equal([...OPS.matchAll(/update\(\{ awb: null, shipment_status: 'Cancelled' \}\)/g)].length, 0);
  assert.ok(OPS.includes("rpc('cancel_current_shipment'"));
});

test('scope: shipping-book still books without a claim -- B2B is not started', () => {
  assert.ok(!BOOK.includes('claim_shipment_attempt'));
});

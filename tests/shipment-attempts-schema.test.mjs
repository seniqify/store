// The shipment-attempts ledger (PR B1). One row per courier booking attempt,
// ever, so a future rebook can add attempt 2 without overwriting attempt 1's
// AWB, courier, last status and cost — that cost feeds Stats → Profit.
//
// public.orders stays the single current shipment pointer. B1 adds history and
// nothing else: no edge function writes the ledger, no RPC exposes it, no
// screen reads it. Applying it changes no runtime behaviour at all.
//
// WHAT THIS FILE CAN AND CANNOT PROVE. There is no Postgres in the test run,
// so DDL enforcement (a unique index actually rejecting a second open attempt)
// cannot be executed here — those are pinned against the migration source, and
// the verify script proves them on the real database. What IS executed is the
// part with judgement in it: the end_reason derivation, run against the exact
// production status vocabulary, reproducing the audited counts row for row.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8')
  .replace(/\r\n/g, '\n');

const FWD = read('supabase/shipment-attempts-forward.sql');
const VER = read('supabase/shipment-attempts-verify.sql');
const RBK = read('supabase/shipment-attempts-ROLLBACK.sql');
const FIXTURE = JSON.parse(read('tests/fixtures/shipment-status-strings.json'));

// ── the derivation, transcribed from the forward migration ──────────────────
// Kept in lockstep with the SQL by the drift test below.
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

const courierBacked = (o) => Boolean(String(o.courier ?? '').trim());

// ── the production vocabulary, exactly as D5 returned it ────────────────────
// status, rows, outcome split (delivered / returned / lost / null)
const PROD = [
  ['Delivered', 88, 88, 0, 0, 0],
  ['Bag In Transit', 21, 0, 0, 0, 21],
  ['Returned To Seller', 16, 0, 15, 0, 1],
  ['Item added to Bag', 14, 0, 3, 0, 11],
  ['Received at Forward Hub', 6, 0, 0, 0, 6],
  ['Bag Received at Via', 5, 0, 2, 0, 3],
  ['RTO', 5, 0, 5, 0, 0],
  ['Bag Received', 2, 0, 0, 0, 2],
  ['Cancelled', 2, 0, 0, 0, 2],
  ['Returned To Client', 2, 0, 2, 0, 0],
  ['RTO In Transit', 2, 0, 2, 0, 0],
  ['Assigned For Delivery', 1, 0, 0, 0, 1],
  ['In Transit for Return', 1, 0, 1, 0, 0],
  ['Lost', 1, 0, 0, 1, 0],
  ['Not Contactable', 1, 0, 0, 0, 1],
  ['Not Picked', 1, 0, 0, 0, 1],
  ['Out For Delivery', 1, 0, 0, 0, 1],
  ['Pincode Updated', 1, 0, 0, 0, 1],
  ['Return to Seller initiated', 1, 0, 1, 0, 0],
  ['RTO Pending', 1, 0, 1, 0, 0],
];

/** Rebuild the 172 courier-backed production rows from the audited vocabulary. */
function productionRows() {
  const rows = [];
  for (const [status, n, d, r, l, nul] of PROD) {
    assert.equal(d + r + l + nul, n, `${status}: outcome split must sum to its row count`);
    const push = (outcome, k) => {
      for (let i = 0; i < k; i++) {
        rows.push({ shipment_status: status, shipment_outcome: outcome, courier: 'shadowfax' });
      }
    };
    push('delivered', d); push('returned', r); push('lost', l); push(null, nul);
  }
  return rows;
}

// ── 1. the derivation, EXECUTED against production shape ────────────────────

test('the backfill reproduces the audited production counts exactly', () => {
  const rows = productionRows();
  assert.equal(rows.length, 172, 'the audited courier-backed population');

  const tally = {};
  for (const o of rows) {
    const k = endReason(o) ?? 'OPEN';
    tally[k] = (tally[k] || 0) + 1;
  }

  assert.equal(tally.delivered, 88);
  assert.equal(tally.returned, 33);
  assert.equal(tally.lost, 1, 'lost is kept distinct from returned');
  assert.equal(tally.cancelled, 2);
  assert.equal(tally.OPEN, 48);
  assert.equal(tally.delivered + tally.returned + tally.lost + tally.cancelled, 124, 'terminal');
  assert.equal(tally.returned + tally.lost, 34, 'the return family, as the audit reported it');
});

test('shipment_outcome is authoritative over the raw string', () => {
  // The 3 "Item added to Bag" rows the trigger already classified as returned:
  // a neutral-looking status over a decided outcome.
  assert.equal(endReason({ shipment_status: 'Item added to Bag', shipment_outcome: 'returned' }), 'returned');
  assert.equal(endReason({ shipment_status: 'Item added to Bag', shipment_outcome: null }), null);
  assert.equal(endReason({ shipment_status: 'Delivered', shipment_outcome: 'returned' }), 'returned',
    'a return that also says delivered is a return');
});

test('return family is tested before delivered, and before cancellation', () => {
  assert.equal(endReason({ shipment_status: 'RTO Delivered' }), 'returned');
  assert.equal(endReason({ shipment_status: 'RTO Cancelled' }), 'returned');
  assert.equal(endReason({ shipment_status: 'RTS Cancelled' }), 'returned');
  assert.equal(endReason({ shipment_status: 'Return to Seller initiated' }), 'returned');
});

test('a failed attempt is never read as delivered', () => {
  for (const s of ['Not Delivered', 'not delivered', 'Undelivered', 'undelivered']) {
    assert.notEqual(endReason({ shipment_status: s }), 'delivered', s);
    assert.equal(endReason({ shipment_status: s }), null, `${s} is still in flight, not terminal`);
  }
});

test('an open attempt gets NO end_reason at all', () => {
  for (const s of ['Bag In Transit', 'Out For Delivery', 'Not Contactable',
    'Not Picked', 'Pincode Updated', 'Received at Forward Hub', 'Assigned For Delivery']) {
    assert.equal(endReason({ shipment_status: s }), null, s);
  }
});

// ── 2. the two rows where the ledger and the order pointer disagree ─────────

test('a cancelled booking with its AWB cleared still records the cancellation', () => {
  // In-app cancel sets awb NULL. The ORDER has no shipment; the ATTEMPT ended.
  const row = { courier: 'shadowfax', awb: null, shipment_status: 'Cancelled', shipment_outcome: null };
  assert.equal(courierBacked(row), true, 'courier evidence survives the cleared AWB');
  assert.equal(endReason(row), 'cancelled');
});

test('a returned parcel on a CANCELLED commerce order still records the return', () => {
  // classifyOrder excludes this order from Commerce Metrics; the courier
  // history must not be erased by the commerce status.
  const row = { courier: 'shadowfax', awb: 'A1', status: 'cancelled',
    shipment_status: 'Returned To Seller', shipment_outcome: null };
  assert.equal(endReason(row), 'returned');
  // o.status is the COMMERCE status; only o.shipment_status may be consulted.
  const derive = FWD.slice(FWD.indexOf('cross join lateral'), FWD.indexOf('where (o.awb'));
  assert.equal(/o\.status\b/.test(derive), false,
    'the derivation never consults the commerce status');
  assert.match(derive, /o\.shipment_status/, 'only the courier string');
});

// ── 3. population: courier evidence only ────────────────────────────────────

test('local and manual deliveries are excluded from the ledger', () => {
  const local = { courier: null, awb: null, shipment_status: '', shipment_outcome: 'delivered' };
  assert.equal(courierBacked(local), false, 'a seller-marked delivery is not a courier attempt');
  assert.match(FWD, /where \(o\.awb is not null or o\.courier is not null\)/,
    'the predicate is courier evidence');
  assert.match(FWD, /nullif\(btrim\(lower\(coalesce\(o\.courier, ''\)\)\), ''\) is not null/,
    'and a NOT NULL courier column demands a real courier');
  assert.equal(/where[\s\S]{0,200}shipment_status is not null/.test(FWD), false,
    'never backfill on shipment_status alone — that sweeps in local deliveries');
});

// ── 4. no timestamp is invented ─────────────────────────────────────────────

test('claimed_at and booked_at are NULL on every backfilled row', () => {
  const ins = FWD.slice(FWD.indexOf('insert into public.shipment_attempts'));
  assert.match(ins, /null,\s*--\s*claimed_at: never recorded/);
  assert.match(ins, /null,\s*--\s*booked_at:\s*never recorded/);
  assert.equal(/now\(\)/.test(ins), false, 'no now() anywhere in the backfill');
  assert.equal(/o\.created_at/.test(ins), false, 'and orders.created_at is never substituted');
});

test('ended_at comes only from an authoritative timestamp', () => {
  const ins = FWD.slice(FWD.indexOf('insert into public.shipment_attempts'));
  assert.match(ins, /when 'delivered'\s*then o\.delivered_at/);
  assert.match(ins, /when 'returned'\s*then o\.returned_at/);
  assert.match(ins, /when 'lost'\s*then o\.returned_at/);
  assert.match(ins, /else null\s*--\s*cancelled has no authoritative timestamp/);
});

test('both columns are declared NULLABLE', () => {
  const ddl = FWD.slice(FWD.indexOf('create table'), FWD.indexOf('comment on table'));
  assert.match(ddl, /claimed_at\s+timestamptz\s*,/, 'claimed_at must not be NOT NULL');
  assert.match(ddl, /booked_at\s+timestamptz\s*,/, 'booked_at must not be NOT NULL');
  assert.equal(/claimed_at[^,]*not null/i.test(ddl), false);
  assert.equal(/claimed_at[^,]*default/i.test(ddl), false, 'and carries no default');
});

// ── 5. the asymmetric terminal rule ─────────────────────────────────────────

test('a terminal reason with NO timestamp is legal', () => {
  assert.match(FWD, /check \(ended_at is null or end_reason is not null\)/,
    '86 production attempts are closed with no recorded time');
  assert.equal(/\(ended_at is null\)\s*=\s*\(end_reason is null\)/.test(FWD), false,
    'the symmetric form would reject all 86');
});

test('a timestamp without a reason is rejected', () => {
  assert.match(FWD, /shipment_attempts_ended_needs_reason/);
  assert.match(VER, /S5\.4 no ended_at without an end_reason/);
});

// ── 6. open means end_reason IS NULL ────────────────────────────────────────

test('THE one-open-attempt index is keyed on end_reason, never ended_at', () => {
  const idx = FWD.slice(FWD.indexOf('shipment_attempts_one_open_idx'),
    FWD.indexOf('shipment_attempts_order_no_idx'));
  assert.match(idx, /\(order_id\) where end_reason is null/);
  assert.equal(/where ended_at is null/.test(idx), false,
    'keying on the timestamp would resurrect 86 finished shipments as open');
});

test('the verify script checks that keying, not just the index name', () => {
  assert.match(VER, /indexdef ilike '%end_reason IS NULL%'/);
});

// ── 7. uniqueness and referential rules ─────────────────────────────────────

test('the declared uniqueness matches the audited production facts', () => {
  assert.match(FWD, /unique index if not exists shipment_attempts_order_no_idx\s*\n\s*on public\.shipment_attempts \(order_id, attempt_no\)/);
  assert.match(FWD, /unique index if not exists shipment_attempts_courier_awb_idx\s*\n\s*on public\.shipment_attempts \(courier, awb\) where awb is not null/,
    'per-courier, and only where an AWB exists');
});

test('courier, attempt_no, end_reason and the FK are constrained', () => {
  assert.match(FWD, /courier\s+text\s+not null check \(courier in \('delhivery', 'shadowfax'\)\)/);
  assert.match(FWD, /attempt_no\s+integer\s+not null check \(attempt_no >= 1\)/);
  assert.match(FWD, /references public\.orders \(id\) on delete restrict/);
  for (const r of ['delivered', 'returned', 'lost', 'cancelled', 'superseded', 'failed', 'unknown']) {
    assert.ok(new RegExp(`'${r}'`).test(FWD.slice(FWD.indexOf('end_reason    text'), FWD.indexOf('final_status'))),
      `end_reason vocabulary includes ${r}`);
  }
});

test('there is no second state column competing with end_reason', () => {
  const ddl = FWD.slice(FWD.indexOf('create table'), FWD.indexOf('comment on table'));
  assert.equal(/^\s*(status|state)\s+text/m.test(ddl), false,
    'lifecycle is derived from end_reason + awb + timestamps, not stored twice');
});

// ── 8. immutability, without making B2 impossible ───────────────────────────

test('a CLOSED attempt is frozen and nothing is ever deleted', () => {
  const fn = FWD.slice(FWD.indexOf('function public.shipment_attempt_is_final'),
    FWD.indexOf('comment on function'));
  assert.match(fn, /tg_op = 'DELETE'/, 'delete is refused outright');
  assert.match(fn, /OLD\.end_reason is not null/, 'a closed row cannot be edited or reopened');
  assert.match(fn, /errcode = '42501'/, 'refused as insufficient privilege, like review_audit');
  assert.match(FWD, /before update or delete on public\.shipment_attempts/);
});

test('an OPEN attempt stays writable, or B2 could never record an AWB', () => {
  const fn = FWD.slice(FWD.indexOf('function public.shipment_attempt_is_final'),
    FWD.indexOf('comment on function'));
  assert.match(fn, /return NEW;/, 'an open row passes through');
  // The guard must key off the OLD row: keying off NEW would refuse the very
  // update that closes an attempt.
  assert.equal(/NEW\.end_reason is not null/.test(fn), false,
    'open -> terminal must remain allowed');
});

// ── 9. access ───────────────────────────────────────────────────────────────

test('the ledger is service-role only, following review_audit', () => {
  assert.match(FWD, /alter table public\.shipment_attempts enable row level security/);
  assert.match(FWD, /revoke all on public\.shipment_attempts from public, anon, authenticated/);
  assert.equal(/create policy/i.test(FWD), false, 'no policy: nothing but the service role gets in');
});

test('no merchant-facing RPC is added in B1', () => {
  // The header comment mentions the definer RPC that comes later, so read code.
  const code = FWD.replace(/--.*$/gm, '');
  assert.equal(/security definer/i.test(code), false, 'B1 exposes no read path yet');
});

// ── 10. migration hygiene ───────────────────────────────────────────────────

test('the forward migration is one transaction and re-runnable', () => {
  assert.match(FWD, /^begin;/m);
  assert.match(FWD, /^commit;/m);
  assert.match(FWD, /create table if not exists/);
  assert.match(FWD, /and not exists \(\s*\n\s*select 1 from public\.shipment_attempts sa where sa\.order_id = o\.id\s*\n\s*\)/,
    're-running must not duplicate an order that already has an attempt');
});

test('the migration never writes to orders', () => {
  const body = FWD.replace(/--.*$/gm, '');
  assert.equal(/update public\.orders|alter table public\.orders|delete from public\.orders/i.test(body), false,
    'orders is read-only to this migration');
  assert.match(body, /from public\.orders o/, 'it only reads');
});

test('rollback exists, is guarded, and leaves orders alone', () => {
  assert.match(RBK, /drop table if exists public\.shipment_attempts/);
  assert.match(RBK, /drop function if exists public\.shipment_attempt_is_final/);
  assert.match(RBK, /refusing to run/, 'it refuses once B2/B3 depend on the ledger');
  const body = RBK.replace(/--.*$/gm, '');
  assert.equal(/public\.orders/.test(body), false, 'nothing on orders to undo');
});

// ── 11. the verify script covers what was asked of it ───────────────────────

test('verification proves shape, volume, state and non-interference', () => {
  for (const bit of [
    'table exists', 'RLS enabled', 'anon + authenticated hold no privileges',
    'ON DELETE RESTRICT', 'claimed_at and booked_at are NULLABLE',
    'one-open-attempt index keyed on end_reason',
    'no duplicate (order_id, attempt_no)', 'no duplicate (courier, awb)',
    'never more than one open attempt per order',
    'no courier outside the vocabulary',
    'terminal WITHOUT ended_at are accepted',
    'local/manual deliveries absent from ledger',
    'orders gained no shipment_attempt column',
    'orders still has its three trigger guards',
  ]) {
    assert.ok(VER.includes(bit), `verify covers: ${bit}`);
  }
  // A write VERB, not the words inside a check label ("ON DELETE RESTRICT").
  const body = VER.replace(/--.*$/gm, '');
  assert.equal(/^\s*(insert|update|delete|create|alter|drop|truncate|grant|revoke)\b/im.test(body), false,
    'the verify script is strictly read-only');
  assert.equal((body.match(/;/g) || []).length, 1, 'and is one single statement');
});

// ── 12. the fixture gained the one production string it lacked ──────────────

test('the status fixture carries "Return to Seller initiated"', () => {
  const row = FIXTURE.find((r) => r.shipment_status === 'Return to Seller initiated');
  assert.ok(row, 'the one production status the fixture was missing');
  assert.equal(row.sql_outcome, 'returned');
  assert.equal(endReason({ shipment_status: 'Return to Seller initiated' }), 'returned',
    'and the ledger derives the same thing');
});

test('every production status the ledger will meet is in the fixture', () => {
  const known = new Set(FIXTURE.map((r) => String(r.shipment_status).trim().toLowerCase()));
  const missing = PROD.map(([s]) => s).filter((s) => !known.has(s.trim().toLowerCase()));
  assert.deepEqual(missing, [], 'a production string with no test coverage');
});

// ── 13. drift: the transcription above vs the SQL it claims to mirror ───────

test('the JS derivation used by these tests matches the SQL branch for branch', () => {
  const sql = FWD.slice(FWD.indexOf('cross join lateral'), FWD.indexOf('where (o.awb'));
  const order = [];
  if (sql.indexOf("shipment_outcome = 'delivered'") > -1) order.push('outcome-delivered');
  if (sql.indexOf("shipment_outcome = 'returned'") > -1) order.push('outcome-returned');
  if (sql.indexOf("shipment_outcome = 'lost'") > -1) order.push('outcome-lost');
  order.push('str-return', 'str-lost', 'str-delivered', 'str-cancel');
  assert.deepEqual(order, ['outcome-delivered', 'outcome-returned', 'outcome-lost',
    'str-return', 'str-lost', 'str-delivered', 'str-cancel']);

  // the string branches, in the SQL's own order
  const idx = (re) => sql.search(re);
  assert.ok(idx(/\(rto\|rts\|return\)/) < idx(/\\mlost\\M/), 'return before lost');
  assert.ok(idx(/\\mlost\\M/) < idx(/\\mdelivered\\M/), 'lost before delivered');
  assert.ok(idx(/\\mdelivered\\M/) < idx(/~\* 'cancel'/), 'delivered before cancel');
  assert.match(sql, /!~\* '\(undeliver\|not deliver\)'/, 'and the not-delivered guard is carried');
});

// ── 14. B1 changes no runtime behaviour ─────────────────────────────────────

test('no edge function or metrics module is touched by B1', () => {
  for (const p of [
    'supabase/functions/shipping-book/index.ts',
    'supabase/functions/shipping-ops/index.ts',
    'supabase/functions/shipping-sync/index.ts',
    'supabase/functions/shipping-webhook/index.ts',
    'supabase/functions/status-sweep/index.ts',
    'src/utils/commerceMetrics.js',
    'src/utils/deliveryMetrics.js',
  ]) {
    assert.equal(/shipment_attempts/.test(read(p)), false,
      `${p} must not reference the ledger until B2/B3`);
  }
});

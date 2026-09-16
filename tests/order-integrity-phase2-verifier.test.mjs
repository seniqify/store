// The phase-2 verifier has to execute in BOTH schema states — before the
// migration is installed and after — because its whole job is the before/after
// comparison. The merged version could not: PostgreSQL resolves relation and
// function names while PARSING, so a statement that mentions
// public.order_integrity fails with 42P01 before that table exists, even inside
// a CASE branch that would never be taken.
//
// Regex for "to_regclass appears somewhere" would not have caught it and would
// not catch the next one. What these tests do instead is read the file the way
// the parser does: strip the parts PostgreSQL does not resolve at parse time
// (comments, and the string literals that query_to_xml is handed), and then
// require that no phase-2 object is named in what is left. Anything a future
// edit adds in a resolvable position fails here, whatever it looks like.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8');
const VERIFY = read('supabase/order-integrity-phase2-verify.sql');

/** Everything PostgreSQL resolves while parsing this statement: comments and
 *  single-quoted literals removed, since a name inside a literal is just text
 *  until something executes it. */
function parseTimeSql(sql) {
  let out = '';
  for (let i = 0; i < sql.length; i++) {
    if (sql[i] === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
      out += '\n';
    } else if (sql[i] === "'") {
      const end = sql.indexOf("'", i + 1);
      i = end === -1 ? sql.length : end;
      out += "'LITERAL'";
    } else {
      out += sql[i];
    }
  }
  return out;
}

/** Objects the migration creates. None of them exists when the verifier runs
 *  for the baseline, so none may appear where the parser will resolve it. */
const PHASE2_OBJECTS = [
  'order_requests',
  'order_integrity',
  'order_pricing_shadow',
  'store_pricing_fingerprint',
  'create_order_secure',
];

const PARSE_TIME = parseTimeSql(VERIFY);

// ── the rule, stated as one test ─────────────────────────────────────────────

test('no phase-2 object is named where PostgreSQL would resolve it at parse time', () => {
  const offenders = [];
  for (const name of PHASE2_OBJECTS) {
    let at = PARSE_TIME.indexOf(name);
    while (at !== -1) {
      // Show the surrounding text so a failure names the line, not just the word.
      const line = PARSE_TIME.slice(0, at).split('\n').length;
      offenders.push(`${name} at line ${line}: ${PARSE_TIME.slice(Math.max(0, at - 60), at + 40).trim().replace(/\s+/g, ' ')}`);
      at = PARSE_TIME.indexOf(name, at + 1);
    }
  }
  assert.deepEqual(offenders, [],
    'these would make the verifier crash before the migration is installed');
});

test('the objects ARE still reached — through text, which the parser does not follow', () => {
  // The counterpart to the rule above: it must not pass by simply dropping the
  // checks. Every object still appears, inside a literal.
  for (const name of PHASE2_OBJECTS.filter((n) => n !== 'order_requests')) {
    assert.ok(VERIFY.includes(name), `${name} must still be checked`);
  }
  assert.match(VERIFY, /to_regclass\('public\.order_integrity'\)/);
  assert.match(VERIFY, /to_regclass\('public\.order_pricing_shadow'\)/);
  assert.match(VERIFY, /to_regprocedure\('public\.store_pricing_fingerprint\(text\)'\)/);
  assert.match(VERIFY, /query_to_xml\(/);
});

// ── the specific references that crashed, one test each ──────────────────────

test('V1.4 no longer casts a possibly-absent table to regclass', () => {
  assert.equal(/'public\.order_integrity'::regclass/.test(VERIFY), false,
    'the cast throws 42P01 when the table is absent');
  const row = VERIFY.slice(VERIFY.indexOf('V1.4'), VERIFY.indexOf('-- -- V2'));
  assert.match(row, /to_regclass\('public\.order_integrity'\) is null/);
  assert.match(row, /N\/A - Phase 2 not installed/);
  assert.match(row, /conrelid = to_regclass\('public\.order_integrity'\)/);
});

test('V2.3 calls the function through text, not by name', () => {
  const row = VERIFY.slice(VERIFY.indexOf('V2.3'), VERIFY.indexOf('-- -- V3'));
  // Slice the already-parsed file rather than re-parsing a fragment: a fragment
  // that begins inside a string literal would start in the wrong quoting state.
  const parsedRow = PARSE_TIME.slice(PARSE_TIME.indexOf('V2.3'), PARSE_TIME.indexOf('-- -- V3'));
  assert.equal(/store_pricing_fingerprint\s*\(/.test(parsedRow), false,
    'a direct call is resolved at parse time and fails before the function exists');
  assert.match(row, /to_regprocedure\('public\.store_pricing_fingerprint\(text\)'\) is null/);
  assert.match(row, /query_to_xml\(/);
  assert.match(row, /N\/A - Phase 2 not installed/);
});

test('V5.4 and V5.5 count through text, not a static FROM', () => {
  const rows = VERIFY.slice(VERIFY.indexOf('V5.4'));
  const parsed = PARSE_TIME.slice(PARSE_TIME.indexOf('V5.4'));
  assert.equal(/from public\.order_integrity/.test(parsed), false);
  assert.equal(/from public\.order_pricing_shadow/.test(parsed), false);
  for (const guard of [/to_regclass\('public\.order_integrity'\) is null/,
                       /to_regclass\('public\.order_pricing_shadow'\) is null/]) {
    assert.match(rows, guard);
  }
  assert.equal((rows.match(/N\/A - Phase 2 not installed/g) || []).length, 2);
});

test('V3.3 disambiguates oid and no longer passes for a function that is absent', () => {
  // Two bugs in one row: `select oid` is ambiguous across pg_proc and
  // pg_namespace, and when the function was missing the subquery was NULL, the
  // regex was NULL, and the CASE fell through to ELSE and reported PASS.
  const row = VERIFY.slice(VERIFY.indexOf('V3.3'), VERIFY.indexOf('V3.4'));
  assert.equal(/\(select oid from pg_proc/.test(row), false, 'ambiguous column reference');
  assert.match(row, /select pg_get_function_arguments\(p\.oid\)/);
  assert.match(row, /to_regprocedure\('public\.create_order_secure\(/);
  assert.match(row, /N\/A - Phase 2 not installed/);
});

test('every row that inspects a phase-2 object names the absent case explicitly', () => {
  // Otherwise a row can report PASS or a wrong reason for something that does
  // not exist, which is what V3.3-V3.6 did.
  for (const id of ['V1.4', 'V2.3', 'V3.3', 'V3.4', 'V3.5', 'V3.6', 'V5.4', 'V5.5']) {
    const start = VERIFY.indexOf(`'${id} `);
    assert.ok(start > -1, `${id} must exist`);
    const row = VERIFY.slice(start, start + 1400);
    const end = row.indexOf('union all');
    assert.match(end === -1 ? row : row.slice(0, end), /N\/A - Phase 2 not installed|FAIL - not found/,
      `${id} must say what it means when phase 2 is absent`);
  }
});

// ── the properties that made it safe in the first place ──────────────────────

test('it is still one read-only SELECT', () => {
  const code = parseTimeSql(VERIFY);
  assert.equal(/\b(insert|update|delete|alter|drop|create|grant|revoke|truncate|begin|commit|set\s+role)\b/i.test(code),
    false, 'nothing that changes the database');
  assert.equal((code.match(/;/g) || []).length, 1, 'exactly one statement');
  assert.match(code, /^\s*with /i);
});

test('query_to_xml is only ever handed a SELECT', () => {
  // It executes whatever string it is given, so what goes in matters.
  const noComments = VERIFY.replace(/--.*$/gm, '');
  const calls = [...noComments.matchAll(/query_to_xml\(\s*((?:'[^']*'\s*(?:\|\|\s*)?)+)/g)];
  assert.ok(calls.length >= 3, 'the three dynamic reads');
  for (const [, arg] of calls) {
    const sql = arg.replace(/'/g, '').replace(/\s*\|\|\s*/g, '').trim();
    assert.match(sql, /^select /i, `not a select: ${sql}`);
    assert.equal(/\b(insert|update|delete|drop|alter|create|grant|revoke|truncate)\b/i.test(sql), false, sql);
  }
});

test('every V1-V5 check from the merged version is still present', () => {
  // The fix must not have quietly dropped a check to make the file run.
  for (const id of ['V1.1', 'V1.2', 'V1.3', 'V1.4', 'V2.1', 'V2.2', 'V2.3',
                    'V3.1', 'V3.2', 'V3.3', 'V3.4', 'V3.5', 'V3.6',
                    'V4.1', 'V5.1', 'V5.2', 'V5.3', 'V5.4', 'V5.5']) {
    assert.ok(VERIFY.includes(`'${id} `), `${id} is missing`);
  }
});

test('the V5 checks still assert that nothing live was disturbed', () => {
  assert.match(VERIFY, /V5\.1 the storefront can still insert orders \(policy intact\)/);
  assert.match(VERIFY, /V5\.2 the old stock trigger is still in place/);
  assert.match(VERIFY, /V5\.3 the phase-1 payment guard is still in place/);
  // These read pg_policies and pg_trigger, which always exist, so they are
  // meaningful in both schema states and must NOT be guarded into N/A.
  const v5 = VERIFY.slice(VERIFY.indexOf('V5.1'), VERIFY.indexOf('V5.4'));
  assert.equal(/N\/A - Phase 2 not installed/.test(v5), false);
});

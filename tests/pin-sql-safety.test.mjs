// The PIN-throttle bypass closure, checked mechanically.
//
// None of this SQL can be run from here, so these tests check the properties a
// reviewer would otherwise have to hold in their head across 500 lines — and
// that a later edit cannot quietly undo.
//
//   supabase/pin-bypass-closure-forward.sql   changes production
//   supabase/pin-bypass-closure-verify.sql    one SELECT, read-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8');

const FWD    = read('supabase/pin-bypass-closure-forward.sql');
const VERIFY = read('supabase/pin-bypass-closure-verify.sql');
const OTPFN  = read('supabase/functions/send-otp/index.ts');

/** Strip -- comments, '...' literals and $function$...$function$ bodies. */
function stripToCode(sql) {
  let out = '';
  for (let i = 0; i < sql.length; i++) {
    if (sql[i] === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
      out += '\n';
    } else if (sql.startsWith('$function$', i)) {
      const end = sql.indexOf('$function$', i + 10);
      i = end === -1 ? sql.length : end + 9;
      out += ' $BODY$ ';
    } else if (sql[i] === "'") {
      i++;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") { i += 2; continue; }
        if (sql[i] === "'") break;
        i++;
      }
      out += "''";
    } else {
      out += sql[i];
    }
  }
  return out;
}

/** The argument list of one CREATE OR REPLACE FUNCTION, whitespace-normalised. */
function signature(sql, name) {
  const at = sql.indexOf(`create or replace function public.${name}(`);
  if (at === -1) return null;
  let i = sql.indexOf('(', at), depth = 0, start = i + 1;
  for (; i < sql.length; i++) {
    if (sql[i] === '(') depth++;
    else if (sql[i] === ')' && --depth === 0) break;
  }
  return sql.slice(start, i).replace(/\s+/g, ' ').trim();
}

// The thirteen, with the signatures the live database reports. A CREATE OR
// REPLACE whose argument list drifts by one type does not replace anything — it
// creates an OVERLOAD, and the vulnerable original stays exactly where it was,
// still reachable, still anon-executable. That is the failure this guards.
const SIGNATURES = {
  verify_store_pin:      'p_slug text, p_hashed_pin text',
  get_store_orders:      'p_slug text, p_hashed_pin text',
  get_store_reviews:     'p_slug text, p_hashed_pin text',
  get_store_ai_searches: 'p_slug text, p_hashed_pin text',
  get_store_whatsapp:    'p_slug text, p_hashed_pin text',
  new_orders_since:      'p_slug text, p_hashed_pin text, p_since timestamp with time zone',
  set_store_whatsapp:    'p_slug text, p_hashed_pin text, p_template_url text, p_api_key text, p_var_templates jsonb',
  update_order_status:   'p_slug text, p_hashed_pin text, p_order_id uuid, p_status text',
  set_order_paid:        'p_slug text, p_hashed_pin text, p_order_id uuid, p_paid boolean',
  set_review_status:     'p_slug text, p_hashed_pin text, p_review_id uuid, p_status text',
  delete_review:         'p_slug text, p_hashed_pin text, p_review_id uuid',
  update_store_config:   'p_slug text, p_hashed_pin text, p_config jsonb',
  reset_store_pin:       'p_slug text, p_whatsapp text, p_code text, p_new_hashed_pin text',
};

/** The eleven that were guessing oracles — everything except the two verifiers. */
const GATED = Object.keys(SIGNATURES)
  .filter((n) => n !== 'verify_store_pin' && n !== 'reset_store_pin');

// ── Signatures, so CREATE OR REPLACE actually replaces ──────────────────────

test('every signature matches the one deployed', () => {
  for (const [name, args] of Object.entries(SIGNATURES)) {
    assert.equal(signature(FWD, name), args, `${name} signature drifted — this would create an overload`);
  }
});

test('all thirteen functions are in the migration', () => {
  assert.equal((FWD.match(/^create or replace function/gim) || []).length, 13);
});

// ── Every oracle now goes through the throttle ──────────────────────────────

test('each of the eleven calls verify_store_pin', () => {
  for (const name of GATED) {
    const at = FWD.indexOf(`create or replace function public.${name}(`);
    const end = FWD.indexOf('$function$;', at);
    const body = FWD.slice(at, end);
    assert.match(body, /public\.verify_store_pin\(p_slug, p_hashed_pin\)/,
      `${name} does not delegate to the throttle`);
  }
});

test('the only surviving inline PIN comparison is inside verify_store_pin', () => {
  // Comments are allowed to quote the old pattern — that is how the file
  // explains itself. Code is not.
  const code = stripToCode(FWD);
  assert.equal(/pin = p_hashed_pin/.test(code), false,
    'an inline comparison survives outside a function body');

  const at = FWD.indexOf('create or replace function public.verify_store_pin(');
  const verifier = FWD.slice(at, FWD.indexOf('$function$;', at));
  assert.match(verifier, /where slug = p_slug and pin = p_hashed_pin/,
    'the verifier itself must still compare the hash');

  // Exactly one in a real body, and it is the verifier's.
  const inBodies = (FWD.match(/pin = p_hashed_pin/g) || []).length;
  const inComments = (FWD.match(/^--.*pin = p_hashed_pin/gm) || []).length;
  assert.equal(inBodies - inComments, 1, 'expected exactly one live comparison');
});

test('the throttle call is never inside a WHERE clause', () => {
  // verify_store_pin is VOLATILE, so the planner cannot hoist it out of a row
  // filter. Four of these were LANGUAGE sql with the check in a WHERE; a naive
  // swap would have made get_store_orders record one attempt per row returned.
  assert.equal(/and\s+public\.verify_store_pin/i.test(FWD), false,
    'the check must run once, before the query — not per row');
  assert.equal(/where[\s\S]{0,120}public\.verify_store_pin/i.test(stripToCode(FWD)), false);
});

test('nothing that calls the verifier is declared STABLE or IMMUTABLE', () => {
  for (const name of [...GATED, 'verify_store_pin', 'reset_store_pin']) {
    const at = FWD.indexOf(`create or replace function public.${name}(`);
    const head = FWD.slice(at, FWD.indexOf('as $function$', at));
    assert.match(head, /\bvolatile\b/, `${name} must be VOLATILE to record an attempt`);
    assert.equal(/\b(stable|immutable)\b/.test(head), false, `${name} cannot write`);
  }
});

// ── search_path ─────────────────────────────────────────────────────────────

test('search_path names pg_temp explicitly, and last', () => {
  // PostgreSQL searches the session temp schema FIRST, ahead of pg_catalog,
  // whenever pg_temp is not listed. `SET search_path TO 'public'` alone — which
  // seven of these carried — therefore leaves temp objects shadowing anything
  // unqualified inside a SECURITY DEFINER function owned by postgres.
  assert.equal((FWD.match(/^set search_path = public, pg_temp$/gm) || []).length, 13);
  assert.equal(/set search_path (to|=) '?public'?\s*$/m.test(FWD), false,
    'pg_temp must be named, or it is searched first');
});

test('every function stays SECURITY DEFINER', () => {
  assert.equal((FWD.match(/^security definer$/gm) || []).length, 13);
});

// ── Separate budgets for PIN and OTP ────────────────────────────────────────

test('the ledger gains a kind column, constrained', () => {
  assert.match(FWD, /add column if not exists kind text not null default 'pin'/);
  assert.match(FWD, /check \(kind in \('pin', 'otp'\)\)/);
});

test('PIN and OTP attempts are counted separately', () => {
  // Otherwise flooding the reset flow locks a merchant out of PIN entry — and
  // the reset flow is the way back in for a merchant locked out of the PIN.
  assert.match(FWD, /and kind = 'pin'[\s\S]*?and not success/);
  assert.match(FWD, /and kind = 'otp'[\s\S]*?and not success/);
});

test('reset_store_pin charges an attempt for every refusal', () => {
  const at = FWD.indexOf('create or replace function public.reset_store_pin(');
  const body = FWD.slice(at, FWD.indexOf('$function$;', at));
  // Lockout, unknown store, wrong WhatsApp number, wrong code — four refusals,
  // four ledger writes, so none of them can be probed for free.
  // Three refusal paths — lockout, store/number mismatch, wrong code — each
  // writing to the ledger, so none of them can be probed for free.
  assert.equal((body.match(/insert into public\.pin_attempts/g) || []).length, 3);
  assert.match(body, /expires_at > now\(\)/, 'the OTP expiry check must survive');
});

test('verify_store_pin records failures only', () => {
  const at = FWD.indexOf('create or replace function public.verify_store_pin(');
  const body = FWD.slice(at, FWD.indexOf('$function$;', at));
  assert.match(body, /values \(p_slug, v_ip, false, 'pin'\)/);
  assert.equal(/values \(p_slug, v_ip, v_ok/.test(body), false,
    'new_orders_since polls this every 15s — a write per success is ~4/min/seller');
  assert.match(body, /delete from public\.pin_attempts/, 'a correct PIN still clears the slate');
});

// ── The verify file writes nothing ──────────────────────────────────────────

test('the verification file contains no mutating statement', () => {
  const code = stripToCode(VERIFY);
  const found = ['create', 'insert', 'update', 'delete', 'grant', 'revoke',
                 'drop', 'alter', 'truncate', 'begin', 'commit', 'rollback']
    .filter((v) => new RegExp(`\\b${v}\\b`, 'i').test(code));
  assert.deepEqual(found, [], `must be read-only, found: ${found.join(', ')}`);
  assert.equal(/\bset\s+(local\s+)?role\b/i.test(code), false);
});

test('the verification file is a single statement', () => {
  assert.equal((stripToCode(VERIFY).match(/;/g) || []).length, 1);
});

test('the verification file asserts that anon KEEPS its access', () => {
  // Merchants have no login — Manage runs as anon and the PIN is the gate.
  // Revoking EXECUTE here would break every seller, so the check records it as
  // information rather than something to "fix".
  assert.match(VERIFY, /anon can still execute all eleven, as it must/);
});

// ── The migration is one transaction ────────────────────────────────────────

test('the migration commits or does nothing', () => {
  assert.equal((FWD.match(/^begin;$/gm) || []).length, 1);
  assert.equal((FWD.match(/^commit;$/gm) || []).length, 1);
  assert.equal((FWD.match(/\$function\$/g) || []).length % 2, 0, 'unbalanced dollar quoting');
});

test('the migration ships no rollback, and says why', () => {
  assert.match(FWD, /ships no rollback of its own, because reverting\s*--\s*means restoring the bypasses/);
  assert.match(FWD, /BEFORE YOU APPLY: capture the current definitions/);
});

// ── The OTP itself ──────────────────────────────────────────────────────────

/** The TypeScript with // and * comment lines removed. */
const otpCode = OTPFN.split(/\r?\n/)
  .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
  .join(' ');

test('the OTP comes from a CSPRNG, not Math.random', () => {
  // Checked against code only: the helper's own comment quotes the old line,
  // which is how it explains what changed.
  assert.equal(/Math\.random/.test(otpCode), false,
    'Math.random is not cryptographic, and this code guards reset_store_pin');
  assert.match(OTPFN, /crypto\.getRandomValues/);
  assert.match(OTPFN, /const otp\s*=\s*secureOtp\(\);/);
});

test('the OTP is drawn without modulo bias', () => {
  // 2^32 is not a multiple of 900000, so a plain modulo would favour the low
  // ~62% of the range. Rejection sampling discards the short tail.
  assert.match(OTPFN, /Math\.floor\(0xFFFFFFFF \/ span\) \* span/);
  assert.match(OTPFN, /while \(x >= limit\)/);
});

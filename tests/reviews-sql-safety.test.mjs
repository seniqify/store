// Verified-purchase reviews, checked mechanically.
//
// None of this SQL can run from here, so these tests pin the properties a
// reviewer would otherwise have to hold in their head — and that a later edit
// cannot quietly undo:
//
//   supabase/reviews-verified-forward.sql    changes production
//   supabase/reviews-verified-verify.sql     one SELECT, read-only
//   supabase/reviews-verified-rollback.sql   emergency undo
//   supabase/reviews-inspect.sql             one SELECT, read-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

const FWD = read('supabase/reviews-verified-forward.sql');
const RB  = read('supabase/reviews-verified-rollback.sql');
const VER = read('supabase/reviews-verified-verify.sql');
const INS = read('supabase/reviews-inspect.sql');

/**
 * Remove -- comments and '...' literals. Dollar-quoted blocks ($function$,
 * $q$, $preflight$ …) are replaced by a marker, or kept when keepDollar is set.
 */
function stripToCode(sql, { keepDollar = false } = {}) {
  let out = '';
  for (let i = 0; i < sql.length; i++) {
    if (sql[i] === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(i, i + 40));
    if (tag) {
      const end = sql.indexOf(tag[0], i + tag[0].length);
      if (keepDollar) {
        const inner = sql.slice(i + tag[0].length, end === -1 ? sql.length : end);
        out += ' ' + stripToCode(inner) + ' ';
      } else {
        out += ' $BODY$ ';
      }
      i = end === -1 ? sql.length : end + tag[0].length - 1;
      continue;
    }
    if (sql[i] === "'") {
      i++;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") { i += 2; continue; }
        if (sql[i] === "'") break;
        i++;
      }
      out += "''";
      continue;
    }
    out += sql[i];
  }
  return out;
}

const squash = (s) => s.replace(/\s+/g, ' ').trim().toLowerCase();

/** { name: 'type, type' } for every function a file creates. */
function declaredFunctions(sql) {
  const out = {};
  const re = /create or replace function public\.(\w+)\s*\(([\s\S]*?)\)\s*returns/gi;
  for (const m of sql.matchAll(re)) {
    const types = m[2].split(',').map((p) => p.trim()).filter(Boolean)
      .map((p) => squash(p.replace(/\bdefault\b[\s\S]*$/i, '')).split(' ').slice(1).join(' '));
    out[m[1]] = types.join(', ');
  }
  return out;
}

/** Header (signature → `as $function$`) and body of one function. */
function fn(sql, name) {
  const at = sql.indexOf(`create or replace function public.${name}(`);
  assert.notEqual(at, -1, `${name} is not created`);
  const open = sql.indexOf('$function$', at);
  const close = sql.indexOf('$function$', open + 10);
  return { header: sql.slice(at, open), body: sql.slice(open + 10, close) };
}

const SIGNATURES = {
  issue_review_invite:         'text, text, uuid',
  get_review_invite:           'text',
  submit_review:               'text, integer, integer, text, text, boolean',
  get_owner_reviews:           'text, text',
  reply_to_review:             'text, text, uuid, text',
  report_review:               'text, text, uuid, text',
  admin_list_review_reports:   '',
  admin_resolve_review_report: 'bigint, text, text',
  review_product_id:           'jsonb, jsonb',
  review_rows_are_permanent:   '',
};
const HELPERS = ['review_product_id', 'review_rows_are_permanent'];
const SELLER  = ['issue_review_invite', 'get_owner_reviews', 'reply_to_review', 'report_review'];
const ADMIN   = ['admin_list_review_reports', 'admin_resolve_review_report'];
const ANON    = ['get_review_invite', 'submit_review', ...SELLER];

// ── Forward migration ─────────────────────────────────────────────────────

test('the forward migration is one transaction', () => {
  const code = stripToCode(FWD);
  assert.equal((code.match(/^\s*begin;\s*$/gim) || []).length, 1);
  assert.equal((code.match(/^\s*commit;\s*$/gim) || []).length, 1);
  assert.equal(/\brollback\s*;/i.test(code), false);
});

test('it creates exactly the ten functions, with these signatures', () => {
  assert.deepEqual(declaredFunctions(FWD), SIGNATURES);
});

test('every function pins search_path to public, pg_temp', () => {
  for (const name of Object.keys(SIGNATURES)) {
    assert.match(fn(FWD, name).header, /set search_path = public, pg_temp\s*$/m, `${name} search_path`);
  }
});

test('only the eight callable functions are SECURITY DEFINER', () => {
  for (const name of Object.keys(SIGNATURES)) {
    const definer = /security definer/i.test(fn(FWD, name).header);
    assert.equal(definer, !HELPERS.includes(name), `${name} security`);
  }
});

test('Supabase\'s default EXECUTE grant is revoked from every function', () => {
  const code = squash(stripToCode(FWD)).replace(/\s/g, '');
  for (const [name, types] of Object.entries(SIGNATURES)) {
    const want = `revokeallonfunctionpublic.${name}(${types.replace(/\s/g, '')})frompublic,anon,authenticated;`;
    assert.ok(code.includes(want), `${name} is not revoked`);
  }
});

test('EXECUTE is granted to exactly who should call each function', () => {
  const grants = {};
  for (const m of stripToCode(FWD).matchAll(/grant execute on function public\.(\w+)\(([^)]*)\)\s+to\s+([^;]+);/gi)) {
    assert.equal(squash(m[2]), SIGNATURES[m[1]], `${m[1]} grant signature drifted`);
    grants[m[1]] = squash(m[3]);
  }
  for (const name of ANON)    assert.equal(grants[name], 'anon, authenticated', `${name}`);
  for (const name of ADMIN)   assert.equal(grants[name], 'authenticated', `${name} must not be anon`);
  for (const name of HELPERS) assert.equal(grants[name], undefined, `${name} must not be callable`);
});

test('seller functions check the PIN through the throttle before anything else', () => {
  for (const name of SELLER) {
    const body = fn(FWD, name).body;
    const afterBegin = body.slice(body.search(/\nbegin\n/) + 7).trim();
    assert.ok(afterBegin.startsWith('if not public.verify_store_pin(p_slug, p_hashed_pin) then'),
      `${name} does something before the PIN check`);
    assert.equal(/\.pin\s*=\s*p_hashed_pin/.test(body), false, `${name} compares the PIN inline`);
  }
});

test('admin functions require a crm_team admin before anything else', () => {
  for (const name of ADMIN) {
    const body = fn(FWD, name).body;
    const afterBegin = body.slice(body.search(/\nbegin\n/) + 7).trim();
    assert.ok(afterBegin.startsWith('if not exists (select 1 from public.crm_team t'), `${name} is not gated first`);
    assert.match(body, /t\.user_id = auth\.uid\(\) and t\.role = 'admin'/);
  }
});

test('a review can be created only by submit_review, from an invite', () => {
  const inserts = FWD.match(/insert into public\.product_reviews\b/g) || [];
  assert.equal(inserts.length, 2, 'the legacy copy and submit_review, nothing else');
  const { body } = fn(FWD, 'submit_review');
  assert.match(body, /insert into public\.product_reviews/);
  assert.match(body, /'published', true, v_ads\)/, 'verified and published are set by the server');
  for (const name of Object.keys(SIGNATURES).filter((n) => n !== 'submit_review')) {
    assert.equal(/insert into public\.product_reviews/.test(fn(FWD, name).body), false, `${name} writes reviews`);
  }
});

test('submit_review cannot be told the store, product, order, status or verified flag', () => {
  const params = /public\.submit_review\s*\(([\s\S]*?)\)\s*returns/i.exec(FWD)[1];
  assert.equal(/slug|store|product|order|verified|status/i.test(params), false, params);
});

test('nothing is ever erased: no DELETE of reviews, reports or audit; audit never updated', () => {
  const code = stripToCode(FWD, { keepDollar: true });
  assert.equal(/delete\s+from\s+public\.(product_reviews|review_reports|review_audit)\b/i.test(code), false);
  assert.equal(/update\s+public\.review_audit\b/i.test(code), false);
  assert.equal(/\btruncate\b/i.test(code), false);
  assert.match(FWD, /create trigger product_reviews_no_delete\s+before delete on public\.product_reviews/);
  assert.match(FWD, /create trigger review_reports_no_delete\s+before delete on public\.review_reports/);
  assert.match(FWD, /create trigger review_audit_append_only\s+before update or delete on public\.review_audit/);
});

test('reporting a review does not hide it', () => {
  const { body } = fn(FWD, 'report_review');
  assert.equal(/update public\.product_reviews/.test(body), false, 'report_review must not change the review');
});

test('too-long input is refused, never silently cut down', () => {
  const code = stripToCode(FWD, { keepDollar: true });
  assert.equal(/\b(left|substr|substring)\s*\(/i.test(code), false);
  assert.match(fn(FWD, 'submit_review').body, /char_length\(v_body\) > 1000 then\s+raise exception/);
  assert.match(fn(FWD, 'reply_to_review').body, /char_length\(v_reply\) > 500 then\s+raise exception/);
});

test('pgcrypto is always called schema-qualified', () => {
  const code = stripToCode(FWD, { keepDollar: true });
  assert.equal(/(?<!extensions\.)\b(digest|gen_random_bytes)\s*\(/i.test(code), false);
});

test('only the raw token hash is stored, and the token is long enough', () => {
  const { body } = fn(FWD, 'issue_review_invite');
  assert.match(body, /extensions\.gen_random_bytes\(24\)/);
  assert.match(body, /encode\(extensions\.digest\(v_raw, 'sha256'\), 'hex'\)/);
  assert.equal(/values\s*\(v_raw/.test(body), false, 'the raw token must never be inserted');
});

test('the browser can read only the safe review columns', () => {
  const m = /grant select \(([^)]*)\)\s+on public\.product_reviews to anon, authenticated;/.exec(FWD);
  assert.ok(m, 'column grant missing');
  const cols = m[1].split(',').map((c) => c.trim());
  for (const secret of ['customer_key', 'order_id', 'item_index', 'consent_advertising',
                        'removed_reason', 'removed_at', 'legacy_review_id']) {
    assert.equal(cols.includes(secret), false, `${secret} must not be public`);
  }
  for (const needed of ['rating', 'status', 'body', 'display_name', 'verified_purchase']) {
    assert.ok(cols.includes(needed), `${needed} must be public`);
  }
  // The client asks for exactly granted columns; anything else fails the query.
  const svc = read('src/utils/reviewService.js');
  const asked = /const PUBLIC_COLUMNS =\s*([\s\S]*?);/.exec(svc)[1].replace(/['+\s]/g, '').split(',').filter(Boolean);
  for (const c of asked) assert.ok(cols.includes(c), `reviewService asks for ungranted column ${c}`);
});

test('every new table has RLS on and client access revoked', () => {
  for (const t of ['product_reviews', 'review_invites', 'review_reports', 'review_audit', 'reviews_access_preserved']) {
    assert.match(FWD, new RegExp(`alter table public\\.${t}\\s+enable row level security;`), `${t} RLS`);
    assert.match(FWD, new RegExp(`revoke all on public\\.${t}\\s+from public, anon, authenticated;`), `${t} revoke`);
  }
});

test('the old table is closed only after its access rules are saved', () => {
  const saved = FWD.indexOf('insert into public.reviews_access_preserved');
  const dropped = FWD.indexOf("execute format('drop policy %I on public.reviews'");
  assert.ok(saved > -1 && dropped > -1 && saved < dropped);
  assert.match(FWD, /revoke all on public\.reviews from public, anon, authenticated;/);
  for (const sig of ['delete_review(text, text, uuid)', 'set_review_status(text, text, uuid, text)', 'get_store_reviews(text, text)']) {
    assert.ok(FWD.includes(`drop function if exists public.${sig};`), `${sig} not retired`);
  }
});

test('legacy reviews are copied unpublished and unverified, with the original row kept', () => {
  const at = FWD.indexOf('insert into public.product_reviews');
  const legacy = FWD.slice(at, FWD.indexOf(';', at));
  assert.match(legacy, /'legacy_unpublished',\s*false,/);
  assert.match(FWD, /'migrated', 'system',[\s\S]{0,200}to_jsonb\(r\)/);
});

// ── Read-only files ───────────────────────────────────────────────────────

const MUTATING = ['create', 'insert', 'update', 'delete', 'grant', 'revoke', 'drop', 'alter',
                  'truncate', 'begin', 'commit', 'rollback', 'copy', 'call', 'do'];

for (const [label, sql] of [['verify', VER], ['inspect', INS]]) {
  test(`the ${label} file is one read-only SELECT`, () => {
    const code = stripToCode(sql, { keepDollar: true });
    const found = MUTATING.filter((w) => new RegExp(`\\b${w}\\b`, 'i').test(code));
    assert.deepEqual(found, [], `must be read-only, found: ${found.join(', ')}`);
    assert.equal(/\bset\s+(local\s+)?role\b/i.test(code), false);
    assert.equal((code.match(/;/g) || []).length, 1, 'exactly one statement');
  });
}

test('the verify file runs before the migration too: new tables are never named directly', () => {
  const code = stripToCode(VER);   // strings and $q$ removed
  assert.equal(/public\.(product_reviews|review_invites|review_reports|review_audit|reviews_access_preserved)\b/i.test(code),
    false, 'reach new tables through to_regclass or query_to_xml only');
});

// ── Rollback ──────────────────────────────────────────────────────────────

test('the rollback is one transaction and says what it reopens', () => {
  const code = stripToCode(RB);
  assert.equal((code.match(/^\s*begin;\s*$/gim) || []).length, 1);
  assert.equal((code.match(/^\s*commit;\s*$/gim) || []).length, 1);
  assert.match(RB, /THIS REOPENS THE FAKE-REVIEW HOLE/);
});

test('the rollback preserves new reviews before dropping anything', () => {
  const keep = RB.indexOf("create table if not exists public.%I as select * from public.%I");
  const drop = RB.indexOf('drop table if exists public.product_reviews');
  assert.ok(keep > -1 && drop > -1 && keep < drop);
  assert.match(RB, /revoke all on public\.%I from public, anon, authenticated/);
});

test('the rollback drops every forward function under its exact signature', () => {
  for (const [name, types] of Object.entries(SIGNATURES)) {
    assert.ok(RB.includes(`drop function if exists public.${name}(${types});`), `${name} not dropped`);
  }
});

test('the restored seller functions keep the PIN throttle', () => {
  assert.deepEqual(declaredFunctions(RB), {
    get_store_reviews: 'text, text',
    set_review_status: 'text, text, uuid, text',
    delete_review:     'text, text, uuid',
  });
  for (const name of ['get_store_reviews', 'set_review_status', 'delete_review']) {
    const f = fn(RB, name);
    assert.match(f.body, /if not public\.verify_store_pin\(p_slug, p_hashed_pin\) then/, name);
    assert.match(f.header, /set search_path = public, pg_temp/, name);
  }
});

// ── The website matches the database ──────────────────────────────────────

function walk(dir) {
  const out = [];
  for (const e of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${e}`;
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...walk(rel));
    else if (/\.(jsx?|mjs|ts)$/.test(e)) out.push(rel);
  }
  return out;
}

test('no client code touches the old reviews table or the retired functions', () => {
  const offenders = [];
  for (const file of [...walk('src'), ...walk('api')]) {
    const text = read(file);
    if (/from\(\s*['"]reviews['"]\s*\)|rest\/v1\/reviews\?|['"](delete_review|set_review_status|get_store_reviews)['"]/.test(text)) {
      offenders.push(file);
    }
  }
  assert.deepEqual(offenders, []);
});

test('the storefront has no public review form any more', () => {
  const sr = read('src/components/store/StoreReviews.jsx');
  assert.equal(/submitReview|<textarea|<input/.test(sr), false);
});

test('new order lines carry the product id the review is tied to', () => {
  const os = read('src/utils/orderService.js');
  assert.equal((os.match(/productId: lineProductId\(i\)/g) || []).length, 2);
});

test('the Manage review button only appears on delivered orders with an amount', () => {
  const ot = read('src/components/manage/OrdersTab.jsx');
  assert.match(ot, /\{!leads && o\.status === 'delivered' && phone && Number\(o\.total\) > 0 && \(\s*<AskReviewButton/);
});

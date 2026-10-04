// Automatic cart reminders (supabase/cart-reminders-*.sql, the cart-reminders
// edge function, the /cart/<token> link and the Abandoned-tab switch).
// The SQL runs in PGlite on top of the real wallet migration, under
// Supabase-like default grants. Consent has its own PR and tests; here
// whatsapp_consent_granted is a stand-in driven by a test table.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { restoreCartLines, saveRestoreIntent, takeRestoreIntent } from '../src/utils/cartRestore.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(`${ROOT}${p}`, 'utf8').replace(/\r\n/g, '\n');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const FORWARD = read('supabase/cart-reminders-forward.sql');
const ROLLBACK = read('supabase/cart-reminders-ROLLBACK.sql');
const VERIFY = read('supabase/cart-reminders-verify.sql');
const SCHEDULE = read('supabase/cart-reminders-schedule.sql');
const WALLET = read('supabase/wallet-forward.sql');
const EDGE = read('supabase/functions/cart-reminders/index.ts');

// 12:00 IST today: inside sending hours whatever time the suite runs.
const NOON = `(date_trunc('day', now() at time zone 'Asia/Kolkata') + interval '12 hours') at time zone 'Asia/Kolkata'`;
const ITEMS = [
  { productId: 'p1', name: 'Krupa Six-Fragrance Combo', price: 280, qty: 1, variant: null },
  { productId: 'p2', name: 'Dhoop\tSticks\nLarge', price: 10, qty: 2, variant: 'Rose' },
];

async function world({ install = true, consent = true, wallet = true } = {}) {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
    grant usage on schema public to anon, authenticated, service_role;
    create table public.stores (slug text primary key, config jsonb not null default '{}');
    insert into public.stores values ('krupa', '{"businessName":"Krupa Agarbatti Work"}'), ('other', '{}');
    create table public.orders (
      id uuid primary key default gen_random_uuid(), store_slug text not null, status text,
      customer_name text, customer_phone text, destination text, items jsonb, total numeric,
      created_at timestamptz not null default now());
    create table public.automation_secrets (name text primary key, secret text not null, created_at timestamptz default now());
    create function public.verify_store_pin(p_slug text, p_hashed_pin text) returns boolean
      language sql volatile as $$ select p_hashed_pin = 'good' $$;
    create table public.test_consent (store_slug text, phone text);`);
  if (consent) {
    await db.exec(`create function public.whatsapp_consent_granted(p_slug text, p_phone text) returns boolean
      language sql stable as $$ select exists (select 1 from public.test_consent c where c.store_slug = p_slug and c.phone = p_phone) $$;`);
  }
  if (wallet) await db.exec(WALLET);
  if (install) await db.exec(FORWARD);
  return db;
}
const val = async (db, sql, params = []) => Object.values((await db.query(sql, params)).rows[0] ?? {})[0];
async function shop(db, { slug = 'krupa', on = true, balance = 15000, phone = '9822555192', consent = true } = {}) {
  if (on) await db.query(`insert into public.store_message_settings (store_slug, cart_reminders) values ($1, true)
                          on conflict (store_slug) do update set cart_reminders = true`, [slug]);
  if (balance) await db.query(`select public.wallet_adjust($1, $2, 'test credit')`, [slug, balance]);
  if (consent) await db.query('insert into public.test_consent values ($1, $2)', [slug, phone]);
}
async function abandoned(db, { slug = 'krupa', phone = '9822555192', name = 'Asha Patil', ago = '2 hours', items = ITEMS, total = 300, status = 'abandoned' } = {}) {
  return val(db, `insert into public.orders (store_slug, status, customer_name, customer_phone, destination, items, total, created_at)
                  values ($1, $2, $3, $4, 'Plot 12, Solapur', $5::jsonb, $6, ${NOON} - $7::interval) returning id`,
  [slug, status, name, phone, JSON.stringify(items), total, ago]);
}
const due = async (db, at = NOON) => (await db.query(`select abandoned_order_id from public.cart_reminders_due(50, ${at})`)).rows.map((r) => r.abandoned_order_id);
const claim = (db, id) => val(db, 'select public.cart_reminder_claim($1)', [id]);
const finish = (db, id, sent, status = 200, error = null) => val(db, 'select public.cart_reminder_finish($1, $2, $3, $4)', [id, sent, status, error]);
const balance = async (db, slug = 'krupa') => Number(await val(db, 'select balance_paise from public.store_wallets where store_slug = $1', [slug]) ?? 0);

// ═══ the happy path ══════════════════════════════════════════════════════════

test('a cart left two hours ago by a customer who agreed: listed, charged Rs 1.50 once, and the exact message', async () => {
  const db = await world();
  await shop(db);
  const id = await abandoned(db);
  assert.deepEqual(await due(db), [id]);

  const c = await claim(db, id);
  assert.equal(c.ok, true);
  assert.equal(c.receiver, '919822555192');
  assert.match(c.values['5'], /^cart\/[0-9a-f]{20}$/);
  assert.deepEqual({ ...c.values, 5: 'cart/…' }, {
    1: 'Asha', 2: 'Krupa Six-Fragrance Combo + 1 more', 3: 'Krupa Agarbatti Work', 4: '300', 5: 'cart/…',
  });
  assert.equal(await balance(db), 14850);
  const debit = (await db.query(`select note, amount_paise from public.wallet_ledger where kind = 'debit'`)).rows;
  assert.deepEqual(debit, [{ note: 'Cart reminder · Asha', amount_paise: -150 }]);

  assert.deepEqual(await finish(db, c.reminder_id, true), { ok: true, already: false, status: 'sent' });
  assert.deepEqual(await due(db), [], 'never twice');
  assert.equal((await claim(db, id)).reason, 'already');
  assert.equal(await balance(db), 14850, 'charged once');
  await db.close();
});

// ═══ who does NOT get one ════════════════════════════════════════════════════

test('every rule keeps a cart off the list', async () => {
  const cases = [
    ['the shop has reminders off',          { shop: { on: false } }],
    ['the customer did not agree',          { shop: { consent: false } }],
    ['the wallet cannot pay for one',       { shop: { balance: 149 } }],
    ['left under an hour ago',              { cart: { ago: '30 minutes' } }],
    ['left over a day ago',                 { cart: { ago: '25 hours' } }],
    ['not a valid Indian mobile',           { cart: { phone: '1234567890' }, shop: { phone: '1234567890' } }],
  ];
  for (const [why, opt] of cases) {
    const db = await world();
    await shop(db, opt.shop);
    await abandoned(db, opt.cart);
    assert.deepEqual(await due(db), [], why);
    await db.close();
  }
});

test('never between 9 pm and 9 am IST — a late cart waits for the morning', async () => {
  const db = await world();
  await shop(db);
  const id = await abandoned(db, { ago: '5 hours' });          // 07:00 IST
  const at = (h, m = 0) => `(date_trunc('day', now() at time zone 'Asia/Kolkata') + interval '${h} hours ${m} minutes') at time zone 'Asia/Kolkata'`;
  assert.deepEqual(await due(db, at(8, 59)), []);
  assert.deepEqual(await due(db, at(21, 0)), []);
  assert.deepEqual(await due(db, at(9, 0)), [id]);
  assert.deepEqual(await due(db, at(20, 59)), [id]);
  await db.close();
});

test('a customer who has ordered since gets nothing — cancelled and any status count as ordering', async () => {
  for (const status of ['new', 'cancelled', 'Confirmed', null]) {
    const db = await world();
    await shop(db);
    await abandoned(db, { ago: '3 hours' });
    await abandoned(db, { ago: '1 hours', status });
    assert.deepEqual(await due(db), [], String(status));
    await db.close();
  }
});

test('one reminder per customer per shop per week, from their LATEST cart', async () => {
  const db = await world();
  await shop(db);
  await abandoned(db, { ago: '5 hours', total: 100 });
  const latest = await abandoned(db, { ago: '2 hours', total: 300 });
  assert.deepEqual(await due(db), [latest], 'the newest cart, once');
  const c = await claim(db, latest);
  await finish(db, c.reminder_id, true);
  // A new cart the next day: still inside the week.
  const next = await abandoned(db, { ago: '70 minutes' });
  assert.deepEqual(await due(db), []);
  assert.equal((await claim(db, next)).reason, 'recent');
  assert.equal(await balance(db), 14850);
  await db.close();
});

test('the claim re-checks everything: an order placed after the list was made means no message and no charge', async () => {
  const db = await world();
  await shop(db);
  const id = await abandoned(db);
  assert.deepEqual(await due(db), [id]);
  await db.query(`insert into public.orders (store_slug, status, customer_phone, created_at) values ('krupa', 'new', '9822555192', now())`);
  assert.deepEqual(await claim(db, id), { ok: false, reason: 'ordered' });
  assert.equal(await balance(db), 15000);
  assert.equal(Number(await val(db, 'select count(*) from public.cart_reminders')), 0);
  // ...and the same for a switch turned off, consent withdrawn, or an empty wallet.
  await db.query(`delete from public.orders where status = 'new'`);
  await db.query(`update public.store_message_settings set cart_reminders = false`);
  assert.equal((await claim(db, id)).reason, 'off');
  await db.query(`update public.store_message_settings set cart_reminders = true`);
  await db.query(`delete from public.test_consent`);
  assert.equal((await claim(db, id)).reason, 'no_consent');
  await db.query(`insert into public.test_consent values ('krupa', '9822555192')`);
  await db.query(`select public.wallet_adjust('krupa', -14900, 'drain')`);
  assert.equal((await claim(db, id)).reason, 'no_balance');
  assert.equal(Number(await val(db, 'select count(*) from public.cart_reminders')), 0, 'nothing recorded unless paid');
  await db.close();
});

// ═══ money back ══════════════════════════════════════════════════════════════

test('a message the provider refuses is refunded, once', async () => {
  const db = await world();
  await shop(db);
  const c = await claim(db, await abandoned(db));
  assert.equal(await balance(db), 14850);
  assert.deepEqual(await finish(db, c.reminder_id, false, 422, 'Missing values for keys: 5'), { ok: true, already: false, status: 'failed' });
  assert.equal(await balance(db), 15000);
  assert.deepEqual(await finish(db, c.reminder_id, false, 422, 'again'), { ok: true, already: true, status: 'failed' });
  assert.equal(await balance(db), 15000, 'refunded once');
  const r = (await db.query('select status, provider_status, error from public.cart_reminders')).rows[0];
  assert.deepEqual(r, { status: 'failed', provider_status: 422, error: 'Missing values for keys: 5' });
  await db.close();
});

test('a reminder whose result never came back is refunded after 30 minutes; a fresh one is left alone', async () => {
  const db = await world();
  await shop(db, { phone: '9822555192' });
  await shop(db, { phone: '9000000001', on: false, balance: 0 });
  const old = await claim(db, await abandoned(db));
  const fresh = await claim(db, await abandoned(db, { phone: '9000000001' }));
  await db.query(`update public.cart_reminders set created_at = now() - interval '31 minutes' where id = $1`, [old.reminder_id]);
  assert.equal(await balance(db), 15000 - 300);
  assert.equal(Number(await val(db, 'select public.cart_reminders_expire_stuck()')), 1);
  assert.equal(await balance(db), 15000 - 150);
  const st = Object.fromEntries((await db.query('select id, status from public.cart_reminders')).rows.map((r) => [r.id, r.status]));
  assert.deepEqual([st[old.reminder_id], st[fresh.reminder_id]], ['failed', 'sending']);
  await db.close();
});

// ═══ the link ════════════════════════════════════════════════════════════════

test('the link gives the shop and the items, nothing personal, and notes the first click', async () => {
  const db = await world();
  await shop(db);
  const c = await claim(db, await abandoned(db));
  const token = c.values['5'].slice('cart/'.length);
  assert.equal(await val(db, 'select public.get_cart_reminder($1)', [token]), null, 'not until it was actually sent');
  await finish(db, c.reminder_id, true);

  const r = await val(db, 'select public.get_cart_reminder($1)', [token]);
  assert.equal(r.store_slug, 'krupa');
  assert.deepEqual(r.items.map((i) => [i.productId, i.qty, i.variant]), [['p1', 1, null], ['p2', 2, 'Rose']]);
  assert.ok(!/9822555192|Asha|Solapur|"price"/.test(JSON.stringify(r)), 'no phone, name, address or price');
  const first = await val(db, 'select clicked_at from public.cart_reminders');
  await val(db, 'select public.get_cart_reminder($1)', [token]);
  assert.equal(String(await val(db, 'select clicked_at from public.cart_reminders')), String(first), 'first click kept');

  for (const bad of ['', 'nope', `${token}x`, token.toUpperCase(), 'f'.repeat(20)]) {
    assert.equal(await val(db, 'select public.get_cart_reminder($1)', [bad]), null, bad);
  }
  await db.query(`update public.cart_reminders set created_at = now() - interval '31 days'`);
  assert.equal(await val(db, 'select public.get_cart_reminder($1)', [token]), null, 'expires after 30 days');
  await db.close();
});

// ═══ the shop's switch and results ═══════════════════════════════════════════

test('the switch and the results need the PIN; recovered = a real order within 7 days of the reminder', async () => {
  const db = await world();
  await shop(db, { on: false });
  assert.equal(await val(db, `select public.set_cart_reminders('krupa', 'wrong', true)`), null);
  assert.equal(await val(db, `select public.get_cart_reminder_summary('krupa', 'wrong')`), null);
  assert.equal(await val(db, `select public.set_cart_reminders('krupa', 'good', true)`), true);

  const c = await claim(db, await abandoned(db));
  await finish(db, c.reminder_id, true);
  await val(db, 'select public.get_cart_reminder($1)', [c.values['5'].slice(5)]);
  await db.query(`insert into public.orders (store_slug, status, customer_phone, total, created_at)
                  values ('krupa', 'cancelled', '9822555192', 999, now() + interval '1 hour'),
                         ('krupa', 'new', '9822555192', 300, now() + interval '2 hours'),
                         ('krupa', 'new', '9822555192', 500, now() + interval '3 hours'),
                         ('krupa', 'new', '9822555192', 700, now() + interval '8 days')`);
  const s = await val(db, `select public.get_cart_reminder_summary('krupa', 'good')`);
  assert.deepEqual({ ...s, last_sent_at: Boolean(s.last_sent_at) }, {
    enabled: true, sent_30d: 1, clicked_30d: 1, recovered_30d: 1, recovered_value_30d: 300, last_sent_at: true,
  });
  assert.equal(await val(db, `select public.set_cart_reminders('krupa', 'good', false)`), false);
  assert.equal((await val(db, `select public.get_cart_reminder_summary('krupa', 'good')`)).enabled, false);
  await db.close();
});

test('template values: no line breaks, tabs or runs of spaces, never empty, capped', async () => {
  const db = await world();
  const p = (v, max, fb) => val(db, 'select public.cart_reminder_param($1, $2, $3)', [v, max, fb]);
  assert.equal(await p('Dhoop\tSticks\nLarge   pack', 60, 'x'), 'Dhoop Sticks Large pack');
  assert.equal(await p('   ', 60, 'there'), 'there');
  assert.equal(await p(null, 60, 'there'), 'there');
  assert.equal(await p('x'.repeat(100), 40, 'y'), 'x'.repeat(40));
  // A nameless customer and an empty cart still make a valid message.
  await shop(db);
  const c = await claim(db, await abandoned(db, { name: '', items: [], total: 249.5 }));
  assert.deepEqual([c.values['1'], c.values['2'], c.values['4']], ['there', 'your items', '249.50']);
  await db.close();
});

// ═══ access ══════════════════════════════════════════════════════════════════

test('the browser can open a link and use the PIN-checked switch, but cannot list, claim, finish or read', async () => {
  const db = await world();
  await shop(db);
  const id = await abandoned(db);
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    for (const t of ['cart_reminders', 'store_message_settings']) {
      await assert.rejects(db.query(`select * from public.${t}`), /permission denied/, `${role} ${t}`);
    }
    await assert.rejects(db.query('select * from public.cart_reminders_due(50, now())'), /permission denied/);
    await assert.rejects(db.query('select public.cart_reminder_claim($1)', [id]), /permission denied/);
    await assert.rejects(db.query(`select public.cart_reminder_finish(gen_random_uuid(), true, 200, null)`), /permission denied/);
    await assert.rejects(db.query('select public.cart_reminders_expire_stuck()'), /permission denied/);
    await assert.rejects(db.query(`select public.cart_reminder_param('a', 1, 'b')`), /permission denied/);
    assert.equal(await val(db, `select public.get_cart_reminder('0123456789abcdef0123')`), null);
    assert.equal(await val(db, `select public.set_cart_reminders('krupa', 'good', true)`), true);
    await db.exec('reset role');
  }
  await db.close();
});

// ═══ migration hygiene ═══════════════════════════════════════════════════════

test('forward needs the wallet and consent first, and re-runs harmlessly', async () => {
  const noWallet = await world({ install: false, wallet: false });
  await assert.rejects(noWallet.exec(FORWARD), /run supabase\/wallet-forward\.sql first/);
  await noWallet.close();
  const noConsent = await world({ install: false, consent: false });
  await assert.rejects(noConsent.exec(FORWARD), /run supabase\/whatsapp-consent-forward\.sql first/);
  await noConsent.close();

  const db = await world();
  await shop(db);
  const secret = await val(db, `select secret from public.automation_secrets where name = 'cart-reminders'`);
  assert.match(secret, /^[0-9a-f]{64}$/);
  await db.exec(FORWARD);
  assert.equal(await val(db, `select secret from public.automation_secrets where name = 'cart-reminders'`), secret, 'secret kept');
  assert.equal(await val(db, `select cart_reminders from public.store_message_settings where store_slug = 'krupa'`), true, 'settings kept');
  await db.close();
});

test('verifier passes; rollback refuses once reminders exist and removes an unused install cleanly', async () => {
  const db = await world();
  await shop(db);
  const v = Object.fromEntries((await db.query(VERIFY)).rows.map((r) => [r.grp, r.result]));
  for (const c of ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8']) assert.equal(v[c], 'PASS', c);
  assert.equal(v.I2, 'none');
  await claim(db, await abandoned(db));
  await assert.rejects(db.exec(ROLLBACK), /REFUSED - cart_reminders holds 1 reminders/);
  await db.exec('rollback');
  await db.close();

  const empty = await world();
  await empty.exec(ROLLBACK);
  await empty.exec(ROLLBACK);
  assert.equal(await val(empty, `select to_regclass('public.cart_reminders')`), null);
  assert.equal(await val(empty, `select to_regprocedure('public.cart_reminder_claim(uuid)')`), null);
  assert.equal(Number(await val(empty, `select count(*) from public.automation_secrets where name = 'cart-reminders'`)), 0);
  await empty.close();
});

test('the schedule: every 15 minutes, secret read from the database, never written in the job', () => {
  assert.match(SCHEDULE, /'pocketlink-cart-reminders',\s*'\*\/15 \* \* \* \*'/);
  assert.match(SCHEDULE, /functions\/v1\/cart-reminders/);
  assert.match(SCHEDULE, /\(select secret from public\.automation_secrets where name = 'cart-reminders'\)/);
  assert.match(ROLLBACK.slice(0, ROLLBACK.indexOf('begin;')), /cron\.unschedule/, 'the rollback stops sending before anything that can refuse');
});

// ═══ the edge function ═══════════════════════════════════════════════════════

test('cart-reminders checks its secret first and claims nothing when the template is not set up', () => {
  const src = strip(EDGE);
  const secret = src.indexOf("eq('name', 'cart-reminders')");
  const unauthorized = src.indexOf("json({ error: 'unauthorized' }, 401)");
  const notConfigured = src.indexOf("json({ skipped: 'not_configured' })");
  const firstClaim = src.indexOf("rpc('cart_reminder_claim'");
  assert.ok(secret > 0 && secret < unauthorized && unauthorized < notConfigured && notConfigured < firstClaim);
  assert.match(src, /if \(!sameSecret\(/);
});

test('the template URL is a secret: read from the environment only, never logged, never in the repo', () => {
  const src = strip(EDGE);
  assert.match(src, /Deno\.env\.get\('SENIQIFY_CART_REMINDER_TEMPLATE_URL'\)/);
  assert.ok(!/console\.[a-z]+\([^)]*templateUrl/.test(src), 'never logged');
  const stack = ['src', 'supabase', 'api', 'tests'];
  const leaks = [];
  while (stack.length) {
    const dir = stack.pop();
    for (const name of readdirSync(`${ROOT}${dir}`)) {
      const p = `${dir}/${name}`;
      if (statSync(`${ROOT}${p}`).isDirectory()) { if (name !== 'node_modules') stack.push(p); continue; }
      if (/a92d0b06-b88e-46ed-a626/.test(readFileSync(`${ROOT}${p}`, 'utf8')) && p !== 'tests/cart-reminders.test.mjs') leaks.push(p);
    }
  }
  assert.deepEqual(leaks, []);
});

test('every claimed reminder is sent exactly as the database built it, and its result is always recorded', () => {
  const src = strip(EDGE);
  assert.match(src, /body: JSON\.stringify\(\{ receiver: claim\.receiver, values: claim\.values \}\)/);
  const loop = src.slice(src.indexOf("rpc('cart_reminder_claim'"));
  assert.ok(loop.indexOf('await fetch(templateUrl') < loop.indexOf("rpc('cart_reminder_finish'"));
  assert.match(loop, /p_sent: sent/);
  assert.ok(src.indexOf("rpc('cart_reminders_expire_stuck')") < src.indexOf("rpc('cart_reminders_due'"));
});

// ═══ refilling the cart ══════════════════════════════════════════════════════

const PRODUCTS = [
  { id: 'p1', name: 'Combo', price: 280 },
  { id: 'p2', name: 'Dhoop', price: 10, variants: { label: 'Scent', options: [{ name: 'Rose', price: 12 }, { name: 'Sandal', price: 15 }] } },
  { id: 'p3', name: 'Gone soon', price: 50, stock: 2 },
  { id: 'p4', name: 'Sold out', price: 50, stock: 0 },
  { id: 'p5', name: 'Hidden', price: 50, inStock: false },
  { id: 'p6', name: 'Now has options', price: 50, variants: { label: 'Size', options: [{ name: 'S', price: 50 }] } },
];

test('the cart is rebuilt from today\'s catalogue: same lines the product card adds, current prices', () => {
  const { lines, missing } = restoreCartLines(PRODUCTS, [
    { productId: 'p1', qty: 1 },
    { productId: 'p2', qty: 2, variant: 'Rose' },
    { productId: 'p3', qty: 5 },
  ]);
  assert.equal(missing, 0);
  assert.deepEqual(lines.map(({ line, qty }) => [line.id, line.price, qty]), [
    ['p1', 280, 1], ['p2::Rose', 12, 2], ['p3', 50, 2],
  ]);
  assert.equal(lines[1].line.variant, 'Rose');
});

test('anything that cannot be restored exactly is left out, never guessed', () => {
  const { lines, missing } = restoreCartLines(PRODUCTS, [
    { productId: 'nope', qty: 1 },                      // deleted
    { productId: 'p4', qty: 1 },                        // out of stock
    { productId: 'p5', qty: 1 },                        // switched off
    { productId: 'p2', qty: 1, variant: 'Jasmine' },    // option removed
    { productId: 'p6', qty: 1 },                        // options added since
    { productId: 'p1', qty: 500 },                      // kept, capped
  ]);
  assert.equal(missing, 5);
  assert.deepEqual(lines.map(({ line, qty }) => [line.id, qty]), [['p1', 99]]);
  assert.deepEqual(restoreCartLines(null, null), { lines: [], missing: 0 });
});

test('the hand-over: for that shop only, once, and only for ten minutes', () => {
  const m = new Map();
  const s = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
  saveRestoreIntent('krupa', [{ productId: 'p1', qty: 1 }], s, 1000);
  assert.equal(takeRestoreIntent('other', s, 2000), null, 'another shop leaves it alone');
  assert.deepEqual(takeRestoreIntent('krupa', s, 2000), [{ productId: 'p1', qty: 1 }]);
  assert.equal(takeRestoreIntent('krupa', s, 3000), null, 'once');
  saveRestoreIntent('krupa', [], s, 0);
  assert.equal(takeRestoreIntent('krupa', s, 10 * 60 * 1000 + 1), null, 'stale');
  assert.equal(takeRestoreIntent('krupa', { getItem: () => { throw new Error('blocked'); } }), null);
});

test('the link page, the shop page and the Abandoned tab are wired', () => {
  const app = read('src/App.jsx');
  assert.match(app, /<Route path="\/cart\/:token"\s+element=\{<CartRestore \/>\} \/>/);
  const page = strip(read('src/pages/CartRestore.jsx'));
  assert.match(page, /fetchCartReminder\(token\)/);
  assert.match(page, /saveRestoreIntent\(r\.store_slug, r\.items\)/);
  assert.match(page, /navigate\(storePath\(r\.store_slug\), \{ replace: true \}\)/);
  const home = strip(read('src/pages/Home.jsx'));
  assert.match(home, /takeRestoreIntent\(config\.slug\)/);
  assert.match(home, /restoreCartLines\(saleProducts, items\)/, 'sale prices, as the grid shows them');
  assert.match(read('src/utils/slugify.js'), /'cart', 'order', 'confirm', 'review'/);
  // The switch now lives in the RecoveryCard ("Win back these carts").
  assert.match(read('src/components/manage/AbandonedTab.jsx'), /<RecoveryCard slug=\{slug\} pin=\{pin\}/);
  const card = strip(read('src/components/manage/RecoveryCard.jsx'));
  assert.match(card, /setCartReminders\(slug, pin, !summary\.data\.enabled\)/);
  assert.match(card, /role="switch" aria-checked=\{on\}/);
});

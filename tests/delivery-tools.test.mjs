// Delivery tools (supabase/delivery-tools-*.sql, edge function ship-updates,
// the redesigned Delivery tab). The SQL runs in PGlite on top of the real
// wallet + cart-reminders migrations, under Supabase-like default grants.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';
import { PGlite } from '@electric-sql/pglite';
import { classifyBucket } from '../src/utils/deliveryStatus.js';
import { customerHistory, rtoRisk, RTO_DEFAULTS } from '../src/utils/rtoRisk.js';
import { matchRemittance, xlsxText } from '../src/utils/remittanceReport.js';
import { courierOptions, autoPickCourier } from '../src/utils/courierChoice.js';
import { isWalletRefusal } from '../src/utils/courierAlerts.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = (p) => readFileSync(`${ROOT}${p}`, 'utf8').replace(/\r\n/g, '\n');
const FORWARD = read('supabase/delivery-tools-forward.sql');
const ROLLBACK = read('supabase/delivery-tools-ROLLBACK.sql');
const VERIFY = read('supabase/delivery-tools-verify.sql');
const WALLET = read('supabase/wallet-forward.sql');
const REMINDERS = read('supabase/cart-reminders-forward.sql');
const EDGE = read('supabase/functions/ship-updates/index.ts');
const OPS = read('supabase/functions/shipping-ops/index.ts');

// 12:00 IST today: inside sending hours whatever time the suite runs.
const NOON = `(date_trunc('day', now() at time zone 'Asia/Kolkata') + interval '12 hours') at time zone 'Asia/Kolkata'`;
const MIDNIGHT = `(date_trunc('day', now() at time zone 'Asia/Kolkata') + interval '23 hours') at time zone 'Asia/Kolkata'`;

async function world() {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
    grant usage on schema public to anon, authenticated, service_role;
    create table public.stores (slug text primary key, config jsonb not null default '{}');
    insert into public.stores values ('kul', '{"businessName":"Kulkarni  Sweets"}'), ('other', '{}');
    create table public.orders (
      id uuid primary key default gen_random_uuid(), store_slug text not null, status text default 'new',
      customer_name text, customer_phone text, destination text, items jsonb, total numeric,
      payment_method text, paid boolean default false, paid_via text, paid_at timestamptz,
      awb text, courier text, shipment_status text, shipment_outcome text,
      confirm_token uuid default gen_random_uuid(),
      created_at timestamptz not null default now());
    create table public.automation_secrets (name text primary key, secret text not null, created_at timestamptz default now());
    create function public.verify_store_pin(p_slug text, p_hashed_pin text) returns boolean
      language sql volatile as $$ select p_hashed_pin = 'good' $$;
    create function public.whatsapp_consent_granted(p_slug text, p_phone text) returns boolean language sql stable as $$ select true $$;
    create table public.test_stop (store_slug text, phone text);
    create function public.whatsapp_opted_out(p_slug text, p_phone text) returns boolean language sql stable as
      $$ select exists (select 1 from public.test_stop s where s.store_slug = p_slug and s.phone = p_phone) $$;`);
  await db.exec(WALLET);
  await db.exec(REMINDERS);
  await db.exec(FORWARD);
  return db;
}
const val = async (db, sql, params = []) => Object.values((await db.query(sql, params)).rows[0] ?? {})[0];
const balance = (db, slug = 'kul') => val(db, 'select balance_paise from public.store_wallets where store_slug = $1', [slug]);
async function turnOn(db, { slug = 'kul', credit = 1000, events = null, since = `${NOON} - interval '1 day'` } = {}) {
  await db.query(`select public.set_ship_updates($1, 'good', true, $2)`, [slug, events]);
  await db.query(`update public.store_message_settings set ship_updates_since = ${since} where store_slug = $1`, [slug]);
  if (credit) await db.query(`select public.wallet_adjust($1, $2, 'test credit')`, [slug, credit]);
}
async function order(db, o = {}) {
  const r = { slug: 'kul', name: 'Sameer  Joshi', phone: '9822555192', status: 'new', total: 780, pay: 'cod',
    awb: '149088234402', courier: 'delhivery', ship: 'In Transit', ago: '2 hours', ...o };
  return val(db, `insert into public.orders (store_slug, status, customer_name, customer_phone, destination, total, payment_method,
                    awb, courier, shipment_status, created_at)
                  values ($1, $2, $3, $4, 'Flat 4, Shivaji Nagar, Pune - 411005', $5, $6, $7, $8, $9, ${NOON} - $10::interval) returning id`,
  [r.slug, r.status, r.name, r.phone, r.total, r.pay, r.awb, r.courier, r.ship, r.ago]);
}
const due = async (db, at = NOON) => (await db.query(`select order_id, event from public.ship_updates_due(50, ${at})`)).rows;
const claim = (db, id, event) => val(db, 'select public.ship_update_claim($1, $2)', [id, event]);
const finish = (db, id, sent) => val(db, 'select public.ship_update_finish($1, $2, 200, null)', [id, sent]);

// ── the status reading is the app's ───────────────────────────────────────────
const STATUSES = ['Delivered', 'delivered', 'RTO Delivered', 'RTO In Transit', 'Cancelled', 'Not Delivered', 'Undelivered',
  'Not Contactable', 'nc', 'cnr', 'Customer refused', 'Address issue', 'Pending', 'Out For Delivery', 'ofd', 'Dispatched',
  'Manifested', 'new', 'Out for pickup', 'Not Picked', 'In Transit', 'Picked', 'bag_in_transit', 'Reached hub', 'Lost', ''];
const EXPECT = { delivered: 'delivered', ofd: 'ofd', transit: 'shipped', pickup: null, cancelled: null };

test('ship_update_event agrees with the Delivery board on every status', async () => {
  const db = await world();
  for (const s of STATUSES) {
    const bucket = classifyBucket({ shipment_status: s });
    const isReturn = /rto|rts|return|\blost\b/i.test(s);
    const want = bucket === 'attention' ? (isReturn ? null : 'failed') : EXPECT[bucket];
    assert.equal(await val(db, 'select public.ship_update_event($1)', [s]), want, `status "${s}" (${bucket})`);
  }
});

// ── automatic shipping updates: who, when, and paying for it ─────────────────
test('off by default; on: the current step is due, claimed for Rs 0.50, sent once', async () => {
  const db = await world();
  const id = await order(db);
  await db.query(`select public.wallet_adjust('kul', 1000, 'credit')`);
  assert.deepEqual(await due(db), [], 'nothing while the shop has not turned it on');
  await turnOn(db, { credit: 0 });
  assert.deepEqual((await due(db)).map((r) => [r.order_id, r.event]), [[id, 'shipped']]);

  const c = await claim(db, id, 'shipped');
  assert.equal(c.ok, true);
  assert.equal(c.receiver, '919822555192');
  const token = await val(db, 'select confirm_token from public.orders where id = $1', [id]);
  assert.deepEqual(c.values, { 1: 'Sameer', 2: 'Kulkarni Sweets', 3: 'Delhivery', 4: '149088234402', 5: `order/${token}` });
  assert.equal(await balance(db), 950, 'Rs 0.50 debited in the claim');
  assert.deepEqual(await due(db), [], 'never due twice');
  assert.equal((await claim(db, id, 'shipped')).reason, 'already');
  await finish(db, c.message_id, true);
  assert.equal(await balance(db), 950);
});

test('a refused send is refunded; a lost answer is refunded after 30 minutes', async () => {
  const db = await world();
  await turnOn(db);
  const a = await order(db);
  const b = await order(db, { phone: '9822555193', awb: '149088234403' });
  const ca = await claim(db, a, 'shipped');
  const cb = await claim(db, b, 'shipped');
  assert.equal(await balance(db), 900);
  await finish(db, ca.message_id, false);
  assert.equal(await balance(db), 950);
  await db.query(`update public.shipping_messages set created_at = now() - interval '31 minutes' where id = $1`, [cb.message_id]);
  assert.equal(await val(db, 'select public.ship_updates_expire_stuck()'), 1);
  assert.equal(await balance(db), 1000);
  assert.equal(await val(db, 'select status from public.shipping_messages where id = $1', [cb.message_id]), 'failed');
});

test('out for delivery says what to pay; paid orders say nothing to pay', async () => {
  const db = await world();
  await turnOn(db);
  const cod = await order(db, { ship: 'Out For Delivery' });
  const paid = await order(db, { ship: 'Dispatched', pay: 'online', phone: '9822555194', awb: 'X1' });
  await db.query('update public.orders set paid = true where id = $1', [paid]);
  assert.equal((await claim(db, cod, 'ofd')).values['3'], '₹780');
  assert.equal((await claim(db, paid, 'ofd')).values['3'], '₹0 (already paid)');
});

test('only the current step, only orders placed after it was turned on, only by day, never to a Stop', async () => {
  const db = await world();
  await turnOn(db, { since: `${NOON} - interval '3 hours'` });
  const old = await order(db, { ago: '5 hours' });
  const fresh = await order(db, { ship: 'Delivered', phone: '9822555195', awb: 'D1' });
  const stopped = await order(db, { phone: '9822555196', awb: 'S1' });
  await db.query(`insert into public.test_stop values ('kul', '9822555196')`);
  assert.deepEqual((await due(db)).map((r) => [r.order_id, r.event]).sort(), [[fresh, 'delivered'], [stopped, 'shipped']].sort());
  assert.equal((await claim(db, old, 'shipped')).reason, 'before_on');
  assert.equal((await claim(db, fresh, 'shipped')).reason, 'moved_on', 'a parcel past a step never gets the old message');
  assert.equal((await claim(db, stopped, 'shipped')).reason, 'opted_out');
  assert.deepEqual(await due(db, MIDNIGHT), [], 'nothing at night');
  assert.equal(await balance(db), 1000, 'refusals cost nothing');
});

test('a step the shop switched off, an empty wallet, or a cancelled order is never sent', async () => {
  const db = await world();
  await turnOn(db, { events: ['shipped', 'delivered'], credit: 0 });
  const ofd = await order(db, { ship: 'Out For Delivery' });
  const ship = await order(db, { phone: '9822555197', awb: 'A2' });
  assert.deepEqual(await due(db), [], 'no wallet, nothing due');
  await db.query(`select public.wallet_adjust('kul', 30, 'credit')`);
  assert.deepEqual(await due(db), [], 'less than one message in the wallet');
  await db.query(`select public.wallet_adjust('kul', 70, 'credit')`);
  assert.deepEqual((await due(db)).map((r) => r.order_id), [ship]);
  assert.equal((await claim(db, ofd, 'ofd')).reason, 'off');
  await db.query(`update public.orders set status = 'cancelled' where id = $1`, [ship]);
  assert.equal((await claim(db, ship, 'shipped')).reason, 'not_shipping');
});

test('the switch: PIN-checked, keeps "since" while on, restarts it when turned on again', async () => {
  const db = await world();
  assert.equal(await val(db, `select public.set_ship_updates('kul', 'bad', true, null)`), null);
  await db.query(`select public.set_ship_updates('kul', 'good', true, array['shipped','bogus','ofd'])`);
  const s1 = await val(db, `select public.get_ship_updates('kul', 'good')`);
  assert.equal(s1.enabled, true);
  assert.deepEqual(s1.events, ['ofd', 'shipped']);
  await db.query(`update public.store_message_settings set ship_updates_since = '2026-01-01' where store_slug = 'kul'`);
  await db.query(`select public.set_ship_updates('kul', 'good', true, array['shipped'])`);
  assert.equal(await val(db, `select to_char(ship_updates_since, 'YYYY-MM-DD') from public.store_message_settings where store_slug = 'kul'`), '2026-01-01');
  await db.query(`select public.set_ship_updates('kul', 'good', false, array['shipped'])`);
  await db.query(`select public.set_ship_updates('kul', 'good', true, array['shipped'])`);
  assert.equal(await val(db, `select ship_updates_since > now() - interval '1 minute' from public.store_message_settings where store_slug = 'kul'`), true);
  assert.equal(await val(db, `select public.get_ship_updates('kul', 'bad')`), null);
});

// ── COD money ────────────────────────────────────────────────────────────────
test('COD money lists courier-collected cash until marked received', async () => {
  const db = await world();
  const a = await order(db, { ship: 'Delivered' });
  const b = await order(db, { ship: 'Delivered', courier: 'shadowfax', awb: 'SF1', total: 640 });
  const self = await order(db, { awb: null, ship: null, phone: '9822555198' });
  await db.query(`update public.orders set paid = true, paid_via = 'cod_delivery', paid_at = now() - interval '3 days' where id = any($1)`, [[a, b, self]]);
  const r = await val(db, `select public.get_cod_remittance('kul', 'good')`);
  assert.deepEqual(r.owed.map((x) => x.id).sort(), [a, b].sort(), 'own delivery boy orders are not courier money');
  assert.equal(await val(db, `select public.mark_cod_remitted('kul', 'bad', $1, true)`, [[a]]), null);
  assert.equal(await val(db, `select public.mark_cod_remitted('other', 'good', $1, true)`, [[a]]), 0, 'another shop cannot mark it');
  assert.equal(await val(db, `select public.mark_cod_remitted('kul', 'good', $1, true)`, [[a, self]]), 1);
  const r2 = await val(db, `select public.get_cod_remittance('kul', 'good')`);
  assert.deepEqual(r2.owed.map((x) => x.id), [b]);
  assert.equal(Number(r2.received_month), 780);
  assert.equal(await val(db, `select public.mark_cod_remitted('kul', 'good', $1, false)`, [[a]]), 1, 'undo');
});

// ── missed delivery ──────────────────────────────────────────────────────────
test('the buyer answers a missed delivery only while it is missed', async () => {
  const db = await world();
  const id = await order(db, { ship: 'In Transit' });
  const token = await val(db, 'select confirm_token from public.orders where id = $1', [id]);
  assert.equal((await val(db, 'select public.set_delivery_choice($1, $2, null)', [token, 'reattempt'])).reason, 'not_now');
  await db.query(`update public.orders set shipment_status = 'Not Contactable' where id = $1`, [id]);
  assert.equal((await val(db, 'select public.get_delivery_choice($1)', [token])).can_choose, true);
  assert.equal((await val(db, 'select public.set_delivery_choice($1, $2, $3)', [token, 'address', 'short'])).reason, 'need_address');
  assert.equal((await val(db, 'select public.set_delivery_choice($1, $2, null)', [token, 'teleport'])).reason, 'bad_input');
  assert.equal((await val(db, 'select public.set_delivery_choice($1, $2, $3)', [token, 'address', '  Flat 9,   Lane 2, Kothrud  '])).ok, true);
  const row = (await db.query('select delivery_choice, delivery_choice_address from public.orders where id = $1', [id])).rows[0];
  assert.deepEqual(row, { delivery_choice: 'address', delivery_choice_address: 'Flat 9, Lane 2, Kothrud' });
  assert.equal((await val(db, 'select public.set_delivery_choice($1, $2, null)', ['00000000-0000-0000-0000-000000000000', 'reattempt'])).reason, 'not_found');
});

// ── pay-online discount ──────────────────────────────────────────────────────
test('the pay-online discount: once, unpaid COD not shipped, sane amounts only', async () => {
  const db = await world();
  const id = await order(db, { awb: null, ship: null, total: 1240 });
  const disc = (d, slug = 'kul', pin = 'good', oid = id) => val(db, 'select public.seller_prepay_discount($1, $2, $3, $4)', [slug, pin, oid, d]);
  assert.equal(await disc(20, 'kul', 'bad'), null);
  assert.equal((await disc(20, 'other')).reason, 'not_found');
  assert.equal((await disc(0)).reason, 'bad_amount');
  assert.equal((await disc(2.5)).reason, 'bad_amount');
  assert.equal((await disc(501)).reason, 'bad_amount');
  const ok = await disc(20);
  assert.equal(ok.ok, true);
  assert.equal(Number(ok.total), 1220);
  const again = await disc(50);
  assert.equal(again.already, true, 'only once');
  assert.equal(Number(await val(db, 'select total from public.orders where id = $1', [id])), 1220);
  const shipped = await order(db, { phone: '9822555199', awb: 'Z1' });
  assert.equal((await disc(20, 'kul', 'good', shipped)).reason, 'not_allowed');
});

// ── who may call what ────────────────────────────────────────────────────────
test('grants: the sweep is server-only; the verifier passes; the rollback undoes it', async () => {
  const db = await world();
  for (const fn of ['ship_updates_due(integer, timestamptz)', 'ship_update_claim(uuid, text)', 'ship_update_finish(uuid, boolean, integer, text)', 'ship_updates_expire_stuck()']) {
    assert.equal(await val(db, `select has_function_privilege('anon', 'public.${fn}', 'EXECUTE')`), false, fn);
  }
  for (const fn of ['set_delivery_choice(uuid, text, text)', 'get_cod_remittance(text, text)', 'seller_prepay_discount(text, text, uuid, numeric)']) {
    assert.equal(await val(db, `select has_function_privilege('anon', 'public.${fn}', 'EXECUTE')`), true, fn);
  }
  assert.equal(await val(db, `select has_table_privilege('anon', 'public.shipping_messages', 'SELECT')`), false);
  const rows = (await db.query(VERIFY)).rows;
  assert.deepEqual(rows.filter((r) => r.result !== 'PASS').map((r) => r.check_name), []);
  await db.exec(FORWARD);   // idempotent
  await db.exec(ROLLBACK);
  assert.equal(await val(db, `select to_regclass('public.shipping_messages')`), null);
});

test('the rollback refuses while shops have paid-for messages', async () => {
  const db = await world();
  await turnOn(db);
  await claim(db, await order(db), 'shipped');
  await assert.rejects(db.exec(ROLLBACK), /REFUSED/);
});

// ── the edge functions ───────────────────────────────────────────────────────
test('ship-updates: secret-gated, never claims a step without its template, never logs a template URL', () => {
  assert.match(EDGE, /\.from\('automation_secrets'\)\.select\('secret'\)\.eq\('name', 'ship-updates'\)/);
  assert.match(EDGE, /if \(!sameSecret\(/);
  assert.match(EDGE, /const templateUrl = templates\[row\.event\];\s*if \(!templateUrl\) \{ skip\('no_template'\); continue; \}\s*const \{ data: claim/);
  assert.equal(/console\.[a-z]+\([^)]*templateUrl/.test(EDGE), false);
  assert.match(EDGE, /rpc\('ship_update_finish'/);
});

test('shipping-ops: reattempt goes to Delhivery only, and only marks a buyer answer as sent', () => {
  assert.match(OPS, /if \(action === 'reattempt'\) return json\(\{ error: 'Shadowfax doesn’t take a reattempt request/);
  assert.match(OPS, /act: 'RE-ATTEMPT'/);
  assert.match(OPS, /update\(\{ delivery_choice_sent_at: new Date\(\)\.toISOString\(\) \}\)\s*\.eq\('id', orderId\)\.eq\('store_slug', slug\)\.not\('delivery_choice', 'is', null\)/);
});

// ── app logic ────────────────────────────────────────────────────────────────
const at = (d) => new Date(Date.UTC(2026, 10, d)).toISOString();
test('RTO risk: new big COD, no house number, refused before; a known customer is low risk', () => {
  const orders = [
    { id: 'o1', customer_phone: '9822555192', payment_method: 'cod', total: 1240, destination: 'Shivaji Nagar, Pune - 411005', created_at: at(9) },
    { id: 'o2', customer_phone: '9000000001', payment_method: 'cod', total: 400, destination: 'Flat 2, MG Road, Pune - 411001', created_at: at(1), shipment_outcome: 'returned' },
    { id: 'o3', customer_phone: '+91 90000 00001', payment_method: 'cod', total: 420, destination: 'Flat 2, MG Road, Pune - 411001', created_at: at(9) },
    { id: 'o4', customer_phone: '9111111111', payment_method: 'cod', total: 300, destination: 'Flat 1, Road, Solapur - 413004', created_at: at(2) },
    { id: 'o5', customer_phone: '9111111111', payment_method: 'cod', total: 300, destination: 'Flat 1, Road, Solapur - 413004', created_at: at(9) },
    { id: 'o6', customer_phone: '9222222222', payment_method: 'online', paid: true, total: 5000, destination: 'Near temple, Latur - 413512', created_at: at(9) },
  ];
  const h = customerHistory(orders);
  const r1 = rtoRisk(orders[0], h);
  assert.equal(r1.level, 'high');
  assert.deepEqual(r1.reasons, ['First order from this number, cash on delivery above ₹1,000', 'Address has no house or flat number']);
  assert.deepEqual(rtoRisk(orders[2], h).reasons, ['Refused or returned an order before']);
  assert.equal(rtoRisk(orders[4], h).level, 'low');
  assert.equal(rtoRisk(orders[5], h).level, 'none', 'paid online is never judged');
  assert.equal(rtoRisk(orders[0], h, { ...RTO_DEFAULTS, on: false }).level, 'none');
  assert.deepEqual(rtoRisk(orders[0], h, { ...RTO_DEFAULTS, address: false }).reasons.length, 1);
  assert.equal(rtoRisk({ ...orders[0], awb: 'X' }, h).level, 'none', 'already shipped');
});

test('remittance report: matched by AWB in any cell, CSV or Excel', async () => {
  const owed = [{ id: 'a', awb: '149088234120', amount: 920 }, { id: 'b', awb: 'SF2210486122', amount: 640 }, { id: 'c', awb: '1490882341', amount: 10 }];
  const csv = 'Waybill,COD Amount,Remitted On\n149088234120,920,09-11-2026\n"sf2210486122",640,09-11-2026\n';
  const m = matchRemittance(owed, csv);
  assert.deepEqual(m.paid.map((x) => x.id), ['a', 'b']);
  assert.deepEqual(m.missing.map((x) => x.id), ['c'], 'a shorter AWB inside a longer one is not a match');

  // A minimal .xlsx: one deflated sharedStrings.xml in a zip.
  const xml = Buffer.from('<sst><si><t>AWB</t></si><si><t>149088234120</t></si></sst>');
  const data = deflateRawSync(xml);
  const name = Buffer.from('xl/sharedStrings.xml');
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8);
  local.writeUInt32LE(data.length, 18); local.writeUInt32LE(xml.length, 22); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10);
  central.writeUInt32LE(data.length, 20); central.writeUInt32LE(xml.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(0, 42);
  const cdStart = local.length + name.length + data.length;
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length + name.length, 12); eocd.writeUInt32LE(cdStart, 16);
  const zip = Buffer.concat([local, name, data, central, name, eocd]);
  const text = await xlsxText(zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.length));
  assert.deepEqual(matchRemittance(owed, text).paid.map((x) => x.id), ['a']);
  await assert.rejects(xlsxText(new ArrayBuffer(40)), /not a valid Excel/);
});

test('a courier with an empty wallet is never picked in Book courier', () => {
  const rates = { shadowfax: { serviceable: true, cod: true, amount: 58 }, delhivery: { serviceable: true, cod: true, amount: 62 } };
  const opts = courierOptions(['shadowfax', 'delhivery'], rates, 'COD', 'shadowfax', { shadowfax: { at: 'x' } });
  assert.deepEqual(opts.map((x) => [x.key, x.usable, x.noWallet]), [['shadowfax', false, true], ['delhivery', true, false]]);
  assert.equal(autoPickCourier(opts), 'delhivery');
  assert.equal(isWalletRefusal('Insufficient wallet balance'), true);
  assert.equal(isWalletRefusal('Invalid Delivery Pincode. Pincode 431209 is not serviceble'), false);
});

test('the Delivery tab is five views and the courier connection lives in its Settings', () => {
  const MS = read('src/pages/ManageStore.jsx');
  assert.match(MS, /\['ship', 'Ship'\], \['track', 'Track'\], \['money', 'COD'\], \['wa', 'WhatsApp'\], \['settings', 'Settings'\]/);
  assert.match(MS, /<ShippingConnect config=\{config\} pin=\{pin\} themeColor=\{themeColor\} onConfig=\{onChange\} \/>/);
  assert.equal((MS.match(/<ShippingConnect /g) || []).length, 1, 'only one place to connect couriers');
  assert.match(MS, /mode="ship"/);
});

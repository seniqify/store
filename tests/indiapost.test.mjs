// India Post (Speed Post) sheet (founder, 2026-11-27: "build it start"): the
// shop downloads India Post's bulk-booking Excel filled from its orders and
// uploads it on the India Post portal. SQL tested on local Postgres outside
// this suite (31 checks).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  IP_COLUMNS, barcodeCheckDigit, makeBarcode, barcodeState, nextSerial, mobile10, mobileOk, stateFromPin,
  splitDestination, ipSettings, settingsProblems, orderPin, sheetRows, rowProblems, duplicateBarcodes, sheetCells, sheetFileName, refBaseOf,
} from '../src/utils/indiaPost.js';
import { xlsxBytes } from '../src/utils/xlsxWrite.js';
import { xlsxText } from '../src/utils/remittanceReport.js';
import { courierInfo } from '../src/utils/deliveryStatus.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('barcodes: India Post check digit, as on a real accepted sheet', () => {
  assert.equal(barcodeCheckDigit('74401001'), 4);
  assert.equal(barcodeCheckDigit('74401002'), 8);
  assert.equal(makeBarcode('EM', 74401001), 'EM744010014IN');
  assert.equal(makeBarcode('EM', 10000001), 'EM100000017IN');
  assert.equal(barcodeState('em744010014in'), 'ok');
  assert.equal(barcodeState('EM744010015IN'), 'digit');
  assert.equal(barcodeState('EM74401001IN'), 'format');
  assert.equal(barcodeState(''), 'empty');
});

test('the next barcode never repeats one already on an order', () => {
  const ip = { nextBarcode: 'EM100000017IN' };
  assert.deepEqual(nextSerial(ip, []), { prefix: 'EM', serial: 10000001 });
  const used = [{ courier: 'indiapost', awb: 'EM100000034IN' }, { courier: 'delhivery', awb: 'EM100000099IN' }, { courier: 'indiapost', awb: 'ET100000099IN' }];
  assert.deepEqual(nextSerial(ip, used), { prefix: 'EM', serial: 10000004 });
  assert.equal(nextSerial({ nextBarcode: 'bad' }, []), null);
});

test('people and places', () => {
  assert.equal(mobile10('+91 98500 10421'), '9850010421');
  assert.equal(mobile10('09850010421'), '9850010421');
  assert.equal(mobileOk('9850010421'), true);
  assert.equal(mobileOk('5123407180'), false);
  assert.deepEqual(['413512', '403001', '500001', '110001', '795001', '160017', '600001'].map(stateFromPin),
    ['Maharashtra', 'Goa', 'Telangana', 'Delhi', 'Manipur', 'Chandigarh', 'Tamil Nadu']);
  assert.deepEqual(splitDestination('Ganesh Nagar, near Hanuman Mandir, Latur - 413512', '413512'), { line1: 'Ganesh Nagar, near Hanuman Mandir', line2: '', city: 'Latur' });
  const long = splitDestination('Flat 12, Shree Ganesh Apartment, Behind Old Market Yard, Near Bus Stand, Pandharpur - 413304', '413304');
  assert.equal(long.city, 'Pandharpur');
  assert.ok(long.line1 && long.line2 && long.line1.length <= 60 && long.line2.length <= 60, JSON.stringify(long));
  assert.equal(orderPin({ destination: 'Plot 12, Beed - 431122' }), '431122');
});

test('settings: sender from the shop; what is missing is named', () => {
  const ip = ipSettings({ businessName: 'Kulkarni Sweets', address: 'Shop 4, Navi Peth, Solapur', whatsappNumber: '919822000011', shipping: { pickupPincode: '413002' } });
  assert.deepEqual([ip.sender.name, ip.sender.line1, ip.sender.city, ip.sender.state, ip.sender.pin, ip.sender.mobile], ['Kulkarni Sweets', 'Shop 4, Navi Peth', 'Solapur', 'Maharashtra', '413002', '9822000011']);
  assert.deepEqual([ip.priority, ip.registration, ip.otp, ip.ack, ip.handover, ip.box.l], [true, true, true, false, 'drop', 23]);
  assert.deepEqual(settingsProblems(ip), ['next barcode']);
  assert.deepEqual(settingsProblems({ ...ip, barcodeMode: 'stickers' }), []);
});

const ORDERS = [
  { id: 'o1', customer_name: 'Sunita Pawar', customer_phone: '919850010421', destination: 'Ganesh Nagar, near Hanuman Mandir, Latur - 413512', pincode: '413512', payment_method: 'cod', total: 420, paid: false },
  { id: 'o2', customer_name: 'Rahul Shinde', customer_phone: '9730022416', destination: 'Plot 12, Shivaji Chowk, Beed - 431122', payment_method: 'online', total: 650, paid: true },
  { id: 'o3', customer_name: 'Pooja Deshmukh', customer_phone: '5123407180', destination: 'Station Road, Dharashiv - 413501', payment_method: 'cod', total: 870, paid: false },
];
const IP = ipSettings({ businessName: 'Kulkarni Sweets', address: 'Shop 4, Navi Peth, Solapur', whatsappNumber: '9822000011', shipping: { pickupPincode: '413002' }, delivery: { indiaPost: { nextBarcode: 'EM100000017IN' } } });

test('rows: everything from the order; barcodes in sequence; problems in words', () => {
  const rows = sheetRows(ORDERS, IP, { grams: (o) => ({ o1: 620, o2: 1180, o3: 1450 })[o.id], place: { 413512: { city: 'Latur', state: 'Maharashtra' } } });
  assert.deepEqual(rows.map((r) => r.barcode), ['EM100000017IN', 'EM100000025IN', 'EM100000034IN']);
  assert.deepEqual([rows[0].city, rows[0].state, rows[0].pin, rows[0].mobile, rows[0].cod, rows[0].codValue], ['LATUR', 'MAHARASHTRA', '413512', '9850010421', true, 420]);
  assert.deepEqual([rows[1].city, rows[1].state, rows[1].cod, rows[1].codValue], ['BEED', 'MAHARASHTRA', false, 0], 'no lookup answer: city from the address, state from the PIN');
  assert.deepEqual(Object.keys(rowProblems(rows[2])), ['mobile']);
  assert.deepEqual(rowProblems(rows[0]), {});
  assert.equal(rowProblems({ ...rows[0], barcode: 'EM100000018IN' }).barcode, 'The last digit does not match: check the barcode');
  assert.deepEqual([...duplicateBarcodes([{ barcode: 'A' }, { barcode: 'a' }, { barcode: 'B' }])], ['A']);
  const noCod = sheetRows(ORDERS, IP, { codAllowed: false });
  assert.equal(rowProblems(noCod[0]).cod, 'COD needs an India Post contract (Settings)');
  const stickers = sheetRows(ORDERS, { ...IP, barcodeMode: 'stickers' });
  assert.equal(rowProblems(stickers[0]).barcode, 'Type the barcode from the sticker');
});

test('the file: 48 columns in India Post order, numbers and TRUE/FALSE typed, opens as Excel', async () => {
  assert.equal(IP_COLUMNS.length, 48);
  assert.equal(IP_COLUMNS.filter(([, red]) => red).length, 19);
  const rows = sheetRows(ORDERS.slice(0, 2), IP, { grams: () => 500 });
  const cells = sheetCells(rows, IP, { refBase: '261127' });
  assert.equal(cells.length, 3);
  assert.ok(cells.every((r) => r.length === 48));
  const col = (h) => IP_COLUMNS.findIndex(([x]) => x === h);
  const r1 = cells[1];
  assert.deepEqual(r1[col('BARCODE NO')], { t: 's', v: 'EM100000017IN' });
  assert.deepEqual(r1[col('PHYSICAL WEIGHT')], { t: 'n', v: 500 });
  assert.deepEqual(r1[col('SENDER NAME')], { t: 's', v: 'KULKARNI SWEETS' });
  assert.deepEqual(r1[col('RECEIVER PINCODE')], { t: 'n', v: 413512 });
  assert.deepEqual(r1[col('DROP OFF PINCODE')], { t: 'n', v: 413002 });
  assert.deepEqual(r1[col('PICKUP ADDRESS FLAG')], { t: 'b', v: false });
  assert.deepEqual(r1[col('PRIORITY FLAG')], { t: 'b', v: true });
  assert.deepEqual([r1[col('CODR/COD')].v, r1[col('VALUE FOR CODR/COD')].v], ['COD', 420]);
  assert.deepEqual([cells[2][col('CODR/COD')].v, cells[2][col('VALUE FOR CODR/COD')].v], ['', 0]);
  assert.deepEqual(r1[col('BULK REFERENCE')], { t: 'n', v: 261127001 });
  assert.equal(cells[0][col('ACK')].red, true);
  const bytes = xlsxBytes(cells);
  assert.equal(bytes[0], 0x50); assert.equal(bytes[1], 0x4b);
  const text = await xlsxText(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  for (const t of ['SERIAL NUMBER', 'OTP BASED DELIVERY', 'EM100000017IN', 'Sunita Pawar', 'KULKARNI SWEETS', '413512']) assert.ok(text.includes(t), t);
  assert.equal(sheetFileName('Kulkarni Sweets', Date.parse('2026-11-27T06:00:00Z')), 'SpeedPost-KulkarniSweets-27Nov.xlsx');
  assert.equal(refBaseOf(Date.parse('2026-11-27T06:00:00Z')), '261127');
});

test('India Post is a courier everywhere orders are shown', () => {
  assert.deepEqual([courierInfo('indiapost').key, courierInfo('indiapost').name], ['indiapost', 'India Post']);
  const sql = read('supabase/indiapost-sheet-forward.sql').replace(/--.*$/gm, '');
  assert.match(sql, /verify_store_pin\(p_slug, p_hashed_pin\)/);
  assert.match(sql, /when 'indiapost' then 'India Post Speed Post'/);
  assert.match(sql, /set awb = v_bc, courier = 'indiapost', shipment_status = 'In Transit'/);
  for (const f of ['shipping-sync', 'status-sweep']) {
    assert.match(read(`supabase/functions/${f}/index.ts`), /String\(o\.courier \|\| 'delhivery'\)\.toLowerCase\(\) === 'delhivery'/, `${f} asks Delhivery only about its own parcels`);
  }
});

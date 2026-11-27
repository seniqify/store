// India Post (Speed Post) bulk-booking sheet. India Post's office did not take
// up the API, so a shop books Speed Post by uploading India Post's bulk Excel
// on the India Post portal. This fills that sheet from the shop's orders:
// receiver from the order, sender and fixed choices from Delivery -> Settings
// -> India Post, weight from the products' packed weights, barcodes from the
// shop's India Post series (or typed from a sticker roll).
// Pure; tested in tests/indiapost.test.mjs. The database marks the parcels
// shipped afterwards (supabase/indiapost-sheet-forward.sql).

// The columns, in India Post's order, as on a sheet a shop uploaded
// (2026-11-27 screenshot). true = required (red heading in India Post's file).
// Change a heading here if India Post's template spells it differently.
export const IP_COLUMNS = Object.freeze([
  ['SERIAL NUMBER', true], ['BARCODE NO', true], ['PHYSICAL WEIGHT', true], ['SHAPE OF ARTICLE', false],
  ['LENGTH', false], ['BREADTH/DIAMETER', false], ['HEIGHT', false], ['PRIORITY FLAG', false],
  ['DELIVERY INSTRUCTION', false], ['INSTRUCTION RTS', false], ['SENDER NAME', true], ['SENDER COMPANY', false],
  ['SENDER ADD LINE 1', true], ['SENDER ADD LINE 2', false], ['SENDER CITY', true], ['SENDER STATE', true],
  ['SENDER PINCODE', true], ['SENDER EMAILID', false], ['SENDER ALT CONTACT', false], ['SENDER KYC', false],
  ['SENDER TAX', false], ['RECEIVER NAME', true], ['RECEIVER COMPANY', false], ['RECEIVER ADD LINE 1', true],
  ['RECEIVER ADD LINE 2', false], ['RECEIVER CITY', true], ['RECEIVER STATE', true], ['RECEIVER PINCODE', true],
  ['RECEIVER EMAILID', false], ['RECEIVER ALT CONTACT', false], ['RECEIVER KYC', false], ['RECEIVER TAX REF', false],
  ['ALT ADDRESS FLAG', true], ['PICKUP ADDRESS FLAG', true], ['DROP OFF PINCODE', true], ['DROPOFF/PICKUP OFFICE ID', false],
  ['SENDER MOBILE NO', true], ['RECEIVER MOBILE NO', true], ['PREPAYMENT CODE', false], ['VALUE OF PREPAYMENT', false],
  ['CODR/COD', false], ['VALUE FOR CODR/COD', false], ['INSURANCE TYPE', false], ['VALUE OF INSURANCE', false],
  ['ACK', true], ['REGISTRATION', false], ['OTP BASED DELIVERY', false], ['BULK REFERENCE', false],
]);

const digits = (v) => String(v ?? '').replace(/\D/g, '');
/** India Post's own tracking page (it has no link per parcel). */
export const IP_TRACK_URL = 'https://www.indiapost.gov.in/';

const clean = (v, max = 100) => String(v ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, max);

// ── Barcodes ────────────────────────────────────────────────────────────────
/** India Post's check digit for an 8-digit serial: x 8 6 4 2 3 5 9 7, sum mod 11. */
export function barcodeCheckDigit(serial8) {
  const s = digits(serial8);
  if (s.length !== 8) return null;
  const w = [8, 6, 4, 2, 3, 5, 9, 7];
  const r = s.split('').reduce((a, d, i) => a + Number(d) * w[i], 0) % 11;
  return r === 0 ? 5 : r === 1 ? 0 : 11 - r;
}
/** 'EM' + 74401001 -> 'EM744010014IN'. */
export function makeBarcode(prefix, serial) {
  const s = String(Math.trunc(Number(serial) || 0)).padStart(8, '0');
  if (s.length !== 8 || !/^[A-Z]{2}$/.test(prefix || '')) return '';
  return `${prefix}${s}${barcodeCheckDigit(s)}IN`;
}
/** 'ok' | 'digit' (last digit wrong) | 'format' | 'empty'. */
export function barcodeState(v) {
  const b = String(v || '').toUpperCase().replace(/\s/g, '');
  if (!b) return 'empty';
  const m = /^([A-Z]{2})(\d{8})(\d)IN$/.exec(b);
  if (!m) return 'format';
  return barcodeCheckDigit(m[2]) === Number(m[3]) ? 'ok' : 'digit';
}
/** The parts of a barcode, or null. */
export function barcodeParts(v) {
  const m = /^([A-Z]{2})(\d{8})(\d)IN$/.exec(String(v || '').toUpperCase().replace(/\s/g, ''));
  return m ? { prefix: m[1], serial: Number(m[2]) } : null;
}
/**
 * Where the next sheet starts: the later of the saved "next barcode" and one
 * past the highest barcode of this series already on the shop's orders, so a
 * barcode is never handed out twice even if a save was missed.
 */
export function nextSerial(settings, orders = []) {
  const start = barcodeParts(settings?.nextBarcode);
  if (!start) return null;
  let next = start.serial;
  for (const o of orders) {
    if (String(o?.courier || '').toLowerCase() !== 'indiapost') continue;
    const p = barcodeParts(o?.awb);
    if (p && p.prefix === start.prefix && p.serial >= next) next = p.serial + 1;
  }
  return { prefix: start.prefix, serial: next };
}

// ── People and places ───────────────────────────────────────────────────────
/** A 10-digit Indian mobile, or ''. */
export const mobile10 = (v) => digits(v).replace(/^(91|0)(?=\d{10}$)/, '').slice(-10);
/** India Post takes 10 digits starting 6, 7, 8 or 9. */
export const mobileOk = (v) => /^[6-9]\d{9}$/.test(String(v || ''));

// PIN -> state by its first digits (India Post's postal circles). Three-digit
// entries override the two-digit ones. Only a fallback: the PIN lookup gives
// the exact state and district when it answers.
const STATE2 = {
  11: 'Delhi', 12: 'Haryana', 13: 'Haryana', 14: 'Punjab', 15: 'Punjab', 16: 'Punjab', 17: 'Himachal Pradesh', 18: 'Jammu and Kashmir', 19: 'Jammu and Kashmir',
  20: 'Uttar Pradesh', 21: 'Uttar Pradesh', 22: 'Uttar Pradesh', 23: 'Uttar Pradesh', 24: 'Uttar Pradesh', 25: 'Uttar Pradesh', 26: 'Uttar Pradesh', 27: 'Uttar Pradesh', 28: 'Uttar Pradesh',
  30: 'Rajasthan', 31: 'Rajasthan', 32: 'Rajasthan', 33: 'Rajasthan', 34: 'Rajasthan', 36: 'Gujarat', 37: 'Gujarat', 38: 'Gujarat', 39: 'Gujarat',
  40: 'Maharashtra', 41: 'Maharashtra', 42: 'Maharashtra', 43: 'Maharashtra', 44: 'Maharashtra', 45: 'Madhya Pradesh', 46: 'Madhya Pradesh', 47: 'Madhya Pradesh', 48: 'Madhya Pradesh', 49: 'Chhattisgarh',
  50: 'Telangana', 51: 'Andhra Pradesh', 52: 'Andhra Pradesh', 53: 'Andhra Pradesh', 56: 'Karnataka', 57: 'Karnataka', 58: 'Karnataka', 59: 'Karnataka',
  60: 'Tamil Nadu', 61: 'Tamil Nadu', 62: 'Tamil Nadu', 63: 'Tamil Nadu', 64: 'Tamil Nadu', 67: 'Kerala', 68: 'Kerala', 69: 'Kerala',
  70: 'West Bengal', 71: 'West Bengal', 72: 'West Bengal', 73: 'West Bengal', 74: 'West Bengal', 75: 'Odisha', 76: 'Odisha', 77: 'Odisha', 78: 'Assam', 79: 'Assam',
  80: 'Bihar', 81: 'Bihar', 82: 'Jharkhand', 83: 'Jharkhand', 84: 'Bihar', 85: 'Bihar',
};
const STATE3 = {
  160: 'Chandigarh', 194: 'Ladakh', 244: 'Uttarakhand', 246: 'Uttarakhand', 247: 'Uttarakhand', 248: 'Uttarakhand', 249: 'Uttarakhand', 262: 'Uttarakhand', 263: 'Uttarakhand',
  396: 'Dadra and Nagar Haveli and Daman and Diu', 403: 'Goa', 500: 'Telangana', 501: 'Telangana', 502: 'Telangana', 503: 'Telangana', 504: 'Telangana', 505: 'Telangana', 506: 'Telangana', 507: 'Telangana', 508: 'Telangana', 509: 'Telangana',
  605: 'Puducherry', 682: 'Kerala', 737: 'Sikkim', 744: 'Andaman and Nicobar Islands', 790: 'Arunachal Pradesh', 791: 'Arunachal Pradesh', 792: 'Arunachal Pradesh',
  793: 'Meghalaya', 794: 'Meghalaya', 795: 'Manipur', 796: 'Mizoram', 797: 'Nagaland', 798: 'Nagaland', 799: 'Tripura',
  814: 'Jharkhand', 815: 'Jharkhand', 816: 'Jharkhand',
};
/** The state a PIN belongs to, from its first digits; '' if unknown. */
export function stateFromPin(pin) {
  const p = digits(pin);
  if (p.length !== 6) return '';
  return STATE3[p.slice(0, 3)] || STATE2[p.slice(0, 2)] || '';
}

/**
 * The address a buyer typed at checkout is stored as one line:
 * "house, street, area, City - 413512". Split it into India Post's two
 * address lines and the city the buyer typed.
 */
export function splitDestination(dest, pin) {
  let s = clean(dest, 400);
  const p = digits(pin);
  if (p) s = s.replace(new RegExp(`[\\s,–-]*${p}\\s*$`), '').trim();
  s = s.replace(/[\s,–-]+$/, '').trim();
  const parts = s.split(',').map((x) => x.trim()).filter(Boolean);
  const city = parts.length > 1 ? parts.pop() : '';
  const addr = parts.join(', ');
  if (addr.length <= 60) return { line1: addr || city, line2: '', city };
  // Two lines: break at the comma nearest the middle.
  const mid = addr.length / 2;
  let cut = -1;
  for (let i = addr.indexOf(','); i >= 0; i = addr.indexOf(',', i + 1)) if (cut < 0 || Math.abs(i - mid) < Math.abs(cut - mid)) cut = i;
  if (cut < 0) return { line1: addr.slice(0, 100), line2: addr.slice(100, 200), city };
  return { line1: addr.slice(0, cut).trim(), line2: addr.slice(cut + 1).trim(), city };
}

// ── Settings (Delivery -> Settings -> India Post) ───────────────────────────
export const IP_DEFAULTS = Object.freeze({
  on: true, handover: 'drop', dropPin: '', officeId: '', box: { l: 23, b: 10, h: 5 },
  barcodeMode: 'series', nextBarcode: '', priority: true, registration: true, otp: true, ack: false, cod: true,
});

/** India Post settings with defaults; the sender filled from the shop where empty. */
export function ipSettings(config = {}) {
  const ip = { ...IP_DEFAULTS, ...(config?.delivery?.indiaPost || {}) };
  const s = ip.sender || {};
  const pin = digits(s.pin || config?.shipping?.pickupPincode || '').slice(0, 6);
  const addr = splitDestination(config?.address || '', pin);
  return {
    ...ip,
    box: { ...IP_DEFAULTS.box, ...(ip.box || {}) },
    sender: {
      name: clean(s.name || config?.businessName || '', 80),
      company: clean(s.company ?? config?.businessName ?? '', 80),
      line1: clean(s.line1 || addr.line1 || '', 100),
      line2: clean(s.line2 ?? addr.line2 ?? '', 100),
      city: clean(s.city || config?.city || addr.city || config?.shipping?.district || '', 60),
      state: clean(s.state || config?.state || stateFromPin(pin), 60),
      pin,
      mobile: mobile10(s.mobile || config?.whatsappNumber || ''),
      email: clean(s.email || '', 100),
    },
  };
}

/** What is missing in the settings before a sheet can be made. */
export function settingsProblems(ip) {
  const s = ip?.sender || {};
  const out = [];
  if (!s.name) out.push('sender name');
  if (!s.line1) out.push('sender address');
  if (!s.city) out.push('sender city');
  if (!s.state) out.push('sender state');
  if (!/^\d{6}$/.test(s.pin || '')) out.push('sender PIN');
  if (!mobileOk(s.mobile)) out.push('sender mobile');
  if (ip?.barcodeMode === 'series' && barcodeState(ip?.nextBarcode) !== 'ok') out.push('next barcode');
  return out;
}

// ── The sheet ───────────────────────────────────────────────────────────────
/** Orders that can go by Speed Post: not sent, not cancelled, with a 6-digit PIN. */
export function orderPin(o) {
  const p = digits(o?.pincode);
  if (p.length === 6) return p;
  const m = String(o?.destination || '').match(/\b\d{6}\b/g);
  return m ? m[m.length - 1] : '';
}

/** One editable row per order. `grams(o)` gives its weight; `place` is { [pin]: { city, state } } from the PIN lookup. */
export function sheetRows(orders, ip, { grams = () => 500, place = {}, codAllowed = true } = {}) {
  const start = ip?.barcodeMode === 'series' ? barcodeParts(ip?.nextBarcode) : null;
  let serial = start ? start.serial : 0;
  return (orders || []).map((o) => {
    const pin = orderPin(o);
    const d = splitDestination(o.destination, pin);
    const looked = place[pin] || {};
    const isCod = String(o.payment_method || '').toLowerCase() === 'cod' && !o.paid;
    const barcode = start ? makeBarcode(start.prefix, serial++) : '';
    return {
      orderId: o.id,
      name: clean(o.customer_name, 80),
      line1: d.line1,
      line2: d.line2,
      city: clean(looked.city || d.city, 60).toUpperCase(),
      state: clean(looked.state || stateFromPin(pin), 60).toUpperCase(),
      pin,
      mobile: mobile10(o.customer_phone),
      barcode,
      weight: String(Math.max(1, Math.round(Number(grams(o)) || 0))),
      cod: isCod && codAllowed,
      codValue: isCod ? Math.round(Number(o.total) || 0) : 0,
      codBlocked: isCod && !codAllowed,
      total: Math.round(Number(o.total) || 0),
    };
  });
}

/** What is wrong with a row, in words, keyed by field. */
export function rowProblems(r) {
  const p = {};
  const bs = barcodeState(r.barcode);
  if (bs === 'empty') p.barcode = 'Type the barcode from the sticker';
  else if (bs === 'format') p.barcode = 'Looks like EM123456789IN: 2 letters, 9 digits, IN';
  else if (bs === 'digit') p.barcode = 'The last digit does not match: check the barcode';
  if (!(Number(r.weight) > 0)) p.weight = 'Weight in grams';
  if (!mobileOk(r.mobile)) p.mobile = '10 digits, starting 6, 7, 8 or 9';
  if (!r.name) p.name = 'Receiver name';
  if (!r.line1) p.line1 = 'Address';
  if (!r.city) p.city = 'City';
  if (!r.state) p.state = 'State';
  if (!/^\d{6}$/.test(r.pin || '')) p.pin = '6-digit PIN';
  if (r.codBlocked) p.cod = 'COD needs an India Post contract (Settings)';
  return p;
}

/** Barcodes repeated inside the sheet. */
export function duplicateBarcodes(rows) {
  const seen = new Map();
  for (const r of rows || []) {
    const b = String(r.barcode || '').toUpperCase().replace(/\s/g, '');
    if (b) seen.set(b, (seen.get(b) || 0) + 1);
  }
  return new Set([...seen].filter(([, n]) => n > 1).map(([b]) => b));
}

/**
 * The cells of the Excel file: a heading row, then one row per parcel.
 * Each cell is { t: 's' | 'n' | 'b', v, red? }. Numbers stay numbers and
 * TRUE/FALSE stay true/false, as in India Post's own sheet.
 */
export function sheetCells(rows, ip, { refBase = '' } = {}) {
  const s = ip.sender;
  const S = (v) => ({ t: 's', v: v == null ? '' : String(v) });
  const N = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? S('') : { t: 'n', v: Number(v) });
  const B = (v) => ({ t: 'b', v: Boolean(v) });
  const head = IP_COLUMNS.map(([h, red]) => ({ t: 's', v: h, red }));
  const body = rows.map((r, i) => [
    N(i + 1), S(String(r.barcode).toUpperCase().replace(/\s/g, '')), N(r.weight), S(''),
    N(ip.box.l), N(ip.box.b), N(ip.box.h), B(ip.priority),
    S(''), S(''), S(s.name.toUpperCase()), S(s.company.toUpperCase()),
    S(s.line1.toUpperCase()), S(s.line2.toUpperCase()), S(s.city.toUpperCase()), S(s.state.toUpperCase()),
    N(s.pin), S(s.email), S(''), S(''),
    S(''), S(r.name), S(''), S(r.line1),
    S(r.line2), S(r.city.toUpperCase()), S(r.state.toUpperCase()), N(r.pin),
    S(''), S(''), S(''), S(''),
    B(false), B(ip.handover === 'pickup'), N(digits(ip.dropPin) || s.pin), S(ip.officeId || ''),
    N(s.mobile), N(r.mobile), S(''), S(''),
    S(r.cod ? 'COD' : ''), N(r.cod ? r.codValue : 0), S(''), S(''),
    B(ip.ack), B(ip.registration), B(ip.otp), refBase ? N(`${refBase}${String(i + 1).padStart(3, '0')}`) : S(''),
  ]);
  return [head, ...body];
}

/** 'SpeedPost-KulkarniSweets-27Nov.xlsx'. */
export function sheetFileName(shopName, ms = Date.now()) {
  const d = new Date(ms + 330 * 60000);
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
  const name = String(shopName || 'Shop').replace(/[^A-Za-z0-9]+/g, '').slice(0, 30) || 'Shop';
  return `SpeedPost-${name}-${d.getUTCDate()}${mon}.xlsx`;
}
/** A number for BULK REFERENCE: yymmdd, then 001, 002... */
export function refBaseOf(ms = Date.now()) {
  const d = new Date(ms + 330 * 60000);
  return `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}

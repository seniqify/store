// The PocketLink sales team member who brought a shop: their code comes in
// on their own sign-up link (/start?ref=CODE) or is typed by the owner, is
// remembered on this device for 30 days, and is saved with the new shop
// (config.salesRef). The database reads it once, when the shop is created,
// to give that person the lead and, when the shop pays, the win.
const KEY = 'pocketlink_sales_ref';
const KEEP_MS = 30 * 86400000;

/** 'ab-12c d' -> 'AB12CD'; '' when it cannot be a code. */
export function cleanRef(v) {
  const s = String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return s.length >= 4 && s.length <= 10 ? s : '';
}

export function saveSalesRef(code) {
  const c = cleanRef(code);
  try {
    if (c) localStorage.setItem(KEY, JSON.stringify({ code: c, at: Date.now() }));
    else localStorage.removeItem(KEY);
  } catch { /* private mode */ }
  return c;
}

export function readSalesRef(now = Date.now()) {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (v && cleanRef(v.code) && now - Number(v.at) < KEEP_MS) return cleanRef(v.code);
  } catch { /* ignore */ }
  return '';
}

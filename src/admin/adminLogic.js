// PocketLink Admin: pure rules shared by the screens (and tested). The
// database decides who may do what (supabase/admin-part1-forward.sql); CAN
// here only hides buttons a role could not use anyway.

export const ROLE_LABEL = Object.freeze({ owner: 'Owner', admin: 'Admin', support: 'Support', finance: 'Finance', viewer: 'Viewer' });

/** The same table as public.admin_can() in the database. */
export const CAN = Object.freeze({
  see: ['owner', 'admin', 'support', 'finance', 'viewer'],
  see_private: ['owner', 'admin', 'support', 'finance'],
  edit_store: ['owner', 'admin', 'support'],
  plan: ['owner', 'admin', 'finance'],
  pause: ['owner', 'admin'],
  delete: ['owner'],
  money: ['owner', 'admin', 'finance', 'viewer'],
  people: ['owner', 'admin'],
  system: ['owner'],
});
export const canDo = (role, what) => Boolean(CAN[what]?.includes(role));

export const STATE = Object.freeze({
  active: { label: 'Active', tone: 'ok' },
  ending: { label: 'Ends soon', tone: 'warn' },
  renewal_missing: { label: 'Renewal not received', tone: 'bad' },
  ended: { label: 'Plan ended', tone: 'off' },
  free: { label: 'Free', tone: 'info' },
  paused: { label: 'Paused', tone: 'warn' },
  deleted: { label: 'Deleted', tone: 'bad' },
});
export const stateOf = (key) => STATE[key] || STATE.free;

export const PAID_PLANS = Object.freeze(['starter', 'pro', 'business', 'premium', 'premium_plus']);
export const isPaid = (plan) => PAID_PLANS.includes(plan);
export const planLabel = (plan) => (isPaid(plan) ? (plan === 'premium' ? 'PocketLink Pro' : `Pro (old plan: ${plan})`) : 'Free');

export const PAYS_BY = Object.freeze({ razorpay: 'Auto-pay', cash: 'Cash', bank: 'Bank transfer', free: 'Free of charge' });
export const paysBy = (key) => PAYS_BY[key] || (key ? String(key) : 'None');

export const inr = (n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;

/** '12 Aug 2027' in India time, or '' for nothing / not a date. */
export function dayLabel(iso) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  return new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
}
/** '12 Aug 2027, 4:05 pm' in India time. */
export function whenLabel(iso) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  return new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
}
/** Whole days from now to a date (negative when past), or null. */
export function daysLeft(iso, now = Date.now()) {
  const t = Date.parse(iso || '');
  return Number.isFinite(t) ? Math.ceil((t - now) / 86400000) : null;
}

/**
 * A new end date: `days` after the later of now and the current end, at
 * midnight India time of that day. Extending a lapsed plan starts from today.
 */
export function extendedEnd(currentIso, days, now = Date.now()) {
  const cur = Date.parse(currentIso || '');
  const from = Number.isFinite(cur) && cur > now ? cur : now;
  return endOfIndiaDay(from + days * 86400000);
}
/** Like extendedEnd, by calendar years: 12 Aug 2027 + 1 year = 12 Aug 2028 (leap years too). */
export function extendedByYears(currentIso, years, now = Date.now()) {
  const cur = Date.parse(currentIso || '');
  const from = Number.isFinite(cur) && cur > now ? cur : now;
  const day = new Date(from + 330 * 60000).toISOString().slice(0, 10);
  const [y, m, d] = day.split('-').map(Number);
  const next = new Date(Date.UTC(y + years, m - 1, d));
  if (next.getUTCMonth() !== m - 1) next.setUTCDate(0);   // 29 Feb into a non-leap year: 28 Feb
  return new Date(Date.parse(next.toISOString().slice(0, 10) + 'T23:59:59.000Z') - 330 * 60000).toISOString();
}
/** A count with Indian digit groups: 2,060 · 1,24,000. */
export const num = (n) => (Number(n) || 0).toLocaleString('en-IN');
/** The end of the India day (23:59:59) that `ms` falls in, as ISO. */
export function endOfIndiaDay(ms) {
  const ist = new Date(ms + 330 * 60000);
  const day = ist.toISOString().slice(0, 10);
  return new Date(Date.parse(`${day}T23:59:59.000Z`) - 330 * 60000).toISOString();
}
/** A 'YYYY-MM-DD' date input as the end of that India day, or null. */
export function dateInputEnd(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? new Date(Date.parse(`${value}T23:59:59.000Z`) - 330 * 60000).toISOString() : null;
}

export const STORE_TABS = Object.freeze([
  ['all', 'All'], ['paying', 'Paying'], ['ending', 'Ends soon'], ['renewal_missing', 'Renewal not received'],
  ['ended', 'Plan ended'], ['free', 'Free'], ['paused', 'Paused'], ['deleted', 'Deleted'],
]);
const inTab = (row, tab) => (tab === 'all' ? row.state !== 'deleted'
  : tab === 'paying' ? row.state === 'active' || row.state === 'ending'
    : row.state === tab);
export function tabCounts(rows) {
  return Object.fromEntries(STORE_TABS.map(([k]) => [k, (rows || []).filter((r) => inTab(r, k)).length]));
}

/** The stores list after tab, search, city and sort. */
export function filterStores(rows, { tab = 'all', q = '', city = '', sort = 'newest' } = {}) {
  const needle = String(q || '').trim().toLowerCase();
  const digits = needle.replace(/\D/g, '');
  const out = (rows || []).filter((r) => inTab(r, tab)
    && (!city || (r.city || '').toLowerCase() === city.toLowerCase())
    && (!needle || [r.name, r.slug, r.city, r.business_type].some((v) => String(v || '').toLowerCase().includes(needle))
      || (digits.length >= 4 && [r.owner_phone, r.whatsapp].some((v) => String(v || '').replace(/\D/g, '').includes(digits)))));
  const by = {
    newest: (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
    orders: (a, b) => (b.orders_30 - a.orders_30) || (Number(b.sales_30) - Number(a.sales_30)),
    ending: (a, b) => (Date.parse(a.plan_expires_at || '') || Infinity) - (Date.parse(b.plan_expires_at || '') || Infinity),
    name: (a, b) => String(a.name).localeCompare(String(b.name)),
  }[sort] || (() => 0);
  return out.sort(by);
}

/** Cities that appear, most shops first. */
export function citiesOf(rows) {
  const c = new Map();
  for (const r of rows || []) if (r.city) c.set(r.city, (c.get(r.city) || 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
}

/** Rows to CSV text (a header row first). Cells are quoted; formulas are defused. */
export function toCsv(rows) {
  const cell = (v) => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  return rows.map((r) => r.map(cell).join(',')).join('\r\n');
}

/** Only the keys of `next` whose value differs from `cur` (for the edit form). */
export function changedKeys(cur, next) {
  const out = {};
  for (const [k, v] of Object.entries(next || {})) {
    const a = cur?.[k] ?? null;
    const b = v === '' ? null : v;
    if (JSON.stringify(a) !== JSON.stringify(b)) out[k] = b;
  }
  return out;
}

/** Plain words for an audit row's action. */
export const ACTION_LABEL = Object.freeze({
  edit: 'Changed shop details', plan: 'Changed the plan', paused: 'Paused the shop', deleted: 'Deleted the shop', open: 'Opened the shop again',
});
export const actionLabel = (a) => ACTION_LABEL[a] || a;

/** "before → after" in words for a log row. */
export function diffLine(before, after) {
  const keys = [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])].filter((k) => !['paid_by', 'amount'].includes(k));
  const show = (v) => (v == null || v === '' ? 'nothing' : typeof v === 'object' ? (v.mode ? `look ${v.mode}` : JSON.stringify(v)) : String(v));
  const parts = keys.map((k) => `${k}: ${show(before?.[k])} → ${show(after?.[k])}`);
  if (after?.paid_by) parts.push(`paid by ${paysBy(after.paid_by)}${after.amount ? ` ${inr(after.amount)}` : ''}`);
  return parts.join(' · ');
}

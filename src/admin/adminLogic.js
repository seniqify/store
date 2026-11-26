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
  salary: ['owner', 'finance'],
  salary_approve: ['owner'],
});
export const canDo = (role, what) => Boolean(CAN[what]?.includes(role));

/** Sales CRM roles in words. */
export const SALES_ROLE = Object.freeze({ manager: 'Sales manager', caller: 'Calling executive', field: 'Field executive', ads: 'Ads & leads executive' });

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
  autopay_stopped: 'Stopped auto-pay', refund: 'Refunded', coins: 'Gave or took back Coins', pin_reset: 'Reset the dashboard PIN',
  person_added: 'Added a person', person_changed: 'Changed a person', person_removed: 'Removed a person', hub_removed: 'Removed an old Hub login',
  password: 'Made a new password', reset_2step: 'Reset 2-step sign-in', review_kept: 'Kept a reported review', review_removed: 'Removed a reported review',
  switch_on: 'Turned a switch on', switch_off: 'Turned a switch off', switch_text: 'Changed a switch’s text',
  job_run: 'Ran a job now', job_paused: 'Paused a job', job_resumed: 'Resumed a job',
  purged: 'Removed a shop for good', purge_photos: 'Removed a shop’s photos',
  salary_drafts: 'Made the salary drafts', salary_draft_removed: 'Removed a salary draft', salary_line_added: 'Added a bonus or deduction',
  salary_line_removed: 'Removed a bonus or deduction', salary_approved: 'Approved salaries', salary_unapproved: 'Sent a salary back to draft',
  salary_paid: 'Marked a salary paid', salary_unpaid: 'Undid a salary payment', salary_rules: 'Changed the salary rules',
  salary_person: 'Set a salary', salary_advance: 'Noted a salary advance', salary_advance_removed: 'Removed a salary advance',
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

// ── Part 3: System and switches ───────────────────────────────────────────
/** The platform switches, in the order shown. The database holds their state. */
export const SWITCHES = Object.freeze([
  { key: 'signups', name: 'New shops can sign up', sub: 'Off: the sign-up page says new sign-ups are paused. A number that already paid still gets its shop; existing shops and renewals are never affected.', text: false },
  { key: 'banner', name: 'Banner on every shop dashboard', sub: 'Shows the text below at the top of every shop owner’s dashboard.', text: true, placeholder: 'e.g. Diwali offer: 2 months free on the yearly plan' },
  { key: 'maintenance', name: 'Maintenance mode', sub: 'Shop dashboards show “Back in a few minutes”. Shop pages stay open and keep taking orders.', text: true, placeholder: 'Optional: your own message for shop owners' },
]);

/** Scheduled jobs by their name in the database: [plain name, what it does]. */
export const JOB_INFO = Object.freeze({
  'pocketlink-cart-reminders': ['Cart reminders', 'WhatsApp reminders to buyers who left a cart'],
  'pocketlink-ship-updates': ['Parcel updates to buyers', 'Shipped, out for delivery and delivered messages'],
  'pocketlink-status-sweep': ['Order and payment check', 'Brings order and payment states up to date'],
  'pocketlink-review-asks': ['Review requests', 'Asks buyers for a review after delivery'],
  'pocketlink-subscription-sync': ['Renewals check', 'Reads every auto-pay from Razorpay and fixes plan dates'],
  'sales-rotate-slow-leads': ['Move uncalled leads', 'Gives a lead to another caller when nobody called it'],
  'sales-incentive-check': ['Incentive 30-day check', 'Confirms incentives for shops still paying after 30 days'],
  'sales-report-daily': ['Daily sales report', 'WhatsApp summary to sales managers'],
  'sales-report-weekly': ['Weekly sales report', 'Monday WhatsApp summary to sales managers'],
  'meta-insights-daily': ['Facebook ad numbers', 'Saves each shop’s daily ad results from Facebook'],
});
export const jobLabel = (name) => JOB_INFO[name]?.[0] || name;
export const jobWhat = (name) => JOB_INFO[name]?.[1] || '';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** A UTC hour and minute as India time: { label: '7:00 pm', shift: days moved }. */
function istClock(h, m) {
  const total = h * 60 + m + 330;
  const t = total % 1440;
  const hh = Math.floor(t / 60);
  return { label: `${hh % 12 || 12}:${String(t % 60).padStart(2, '0')} ${hh < 12 ? 'am' : 'pm'}`, shift: total >= 1440 ? 1 : 0 };
}
/** A cron schedule (UTC, as the database runs it) in plain words, India time. Unknown shapes come back as they are. */
export function cronWords(expr) {
  const s = String(expr || '').trim();
  const sec = /^(\d+) seconds?$/.exec(s);
  if (sec) return `every ${sec[1]} seconds`;
  const parts = s.split(/\s+/);
  if (parts.length !== 5) return s;
  const [mi, h, dom, mon, dow] = parts;
  if (dom !== '*' || mon !== '*') return s;
  const every = /^\*\/(\d+)$/.exec(mi);
  if (h === '*' && dow === '*' && (mi === '*' || every)) return !every || every[1] === '1' ? 'every minute' : `every ${every[1]} minutes`;
  if (h === '*' && dow === '*' && /^\d+$/.test(mi)) return `every hour, at :${String((Number(mi) + 30) % 60).padStart(2, '0')}`;
  if (/^\d+$/.test(mi) && /^\d+$/.test(h)) {
    const t = istClock(Number(h), Number(mi));
    if (dow === '*') return `every day, ${t.label}`;
    if (/^[0-6]$/.test(dow)) return `every ${DAYS[(Number(dow) + t.shift) % 7]}, ${t.label}`;
  }
  return s;
}

/** How a job is doing, for its chip. */
export function jobState(j) {
  if (!j.active) return { label: 'Paused', tone: 'off' };
  if (j.last_status === 'failed') return { label: 'Failed', tone: 'bad' };
  if (j.last_status === 'succeeded') return { label: 'Done', tone: 'ok' };
  if (j.last_status === 'running' || j.last_status === 'starting') return { label: 'Running', tone: 'info' };
  return { label: j.last_status ? String(j.last_status) : 'No run in 8 days', tone: 'warn' };
}

/** A deleted shop's place on the way to "removed for good". */
export function purgeState(row, now = Date.now()) {
  if (row?.purged_at) return { key: 'purged', label: `Removed for good ${dayLabel(row.purged_at)}`, tone: 'off' };
  const days = daysLeft(row?.ready_at, now);
  if (days == null || days <= 0) return { key: 'ready', label: 'Can be removed for good', tone: 'warn' };
  return { key: 'waiting', label: `Kept until ${dayLabel(row.ready_at)} (${days} ${days === 1 ? 'day' : 'days'})`, tone: 'info' };
}

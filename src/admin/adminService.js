// PocketLink Admin data layer. Every read and change is a database function
// that checks the caller's admin role AND that this session passed 2-step
// sign-in (supabase/admin-part1-forward.sql); nothing here is trusted.
import { supabase } from '../lib/supabase';

const fail = (error) => { throw new Error(error?.message || 'Something went wrong'); };

export async function adminSession() {
  const { data } = await supabase.auth.getSession();
  return data?.session ?? null;
}
export function onAdminAuthChange(cb) {
  const { data } = supabase.auth.onAuthStateChange((_e, session) => cb(session));
  return () => data?.subscription?.unsubscribe();
}
export async function adminSignIn(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Wrong email or password.' : error.message);
}
export async function adminSignOut() { await supabase.auth.signOut(); }

// ── 2-step sign-in (an authenticator app code) ────────────────────────────
/** { verified: [factor], level: 'aal1'|'aal2' } */
export async function twoStepState() {
  const [{ data: aal }, { data: f }] = await Promise.all([
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    supabase.auth.mfa.listFactors(),
  ]);
  return { level: aal?.currentLevel || 'aal1', verified: (f?.totp || []).filter((x) => x.status === 'verified') };
}
/** Start adding an authenticator app: { factorId, qr (an SVG data URL), secret }. */
export async function twoStepEnroll() {
  const { data: f } = await supabase.auth.mfa.listFactors();
  for (const x of f?.all || []) if (x.status !== 'verified') await supabase.auth.mfa.unenroll({ factorId: x.id });
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'PocketLink Admin' });
  if (error) fail(error);
  return { factorId: data.id, qr: safeSvgUrl(data.totp?.qr_code), secret: data.totp?.secret };
}
/** An SVG data URL with its markup encoded, so a '#' colour cannot cut the picture short. */
export function safeSvgUrl(url) {
  const m = /^data:image\/svg\+xml;(?:charset=)?utf-?8,(<[\s\S]*)$/i.exec(String(url || ''));
  return m ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(m[1])}` : url;
}
export async function twoStepVerify(factorId, code) {
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: String(code).replace(/\D/g, '') });
  if (error) throw new Error(/invalid|expired/i.test(error.message) ? 'That code is not right. Use the newest code in your app.' : error.message);
}

// ── Reads ─────────────────────────────────────────────────────────────────
const rpc = async (name, args) => {
  const { data, error } = await supabase.rpc(name, args);
  if (error) fail(error);
  return data;
};
export const adminMe = () => rpc('admin_me');
export const adminHome = () => rpc('admin_home');
export const adminStores = async () => (await rpc('admin_stores')) || [];
export const adminStore = (slug) => rpc('admin_store', { p_slug: slug });
export const adminBilling = () => rpc('admin_billing');
export const adminLog = async (kind = null, before = null) => (await rpc('admin_audit_list', { p_kind: kind, p_before: before })) || [];

// ── Changes (each one is written to the audit log by the database) ─────────
export const storeUpdate = (slug, patch, reason) => rpc('admin_store_update', { p_slug: slug, p_patch: patch, p_reason: reason || null });
export const setPlan = (slug, { plan, expiresAt, paidBy, amount, reason }) => rpc('admin_set_plan', {
  p_slug: slug, p_plan: plan, p_expires_at: expiresAt, p_paid_by: paidBy, p_amount: amount ?? 0, p_reason: reason,
});
export const setStatus = (slug, status, reason, confirm = null) => rpc('admin_set_status', { p_slug: slug, p_status: status, p_reason: reason, p_confirm: confirm });

/** Save rows as a CSV file. */
export function downloadCsv(name, text) {
  const blob = new Blob([String.fromCharCode(0xfeff) + text], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ── Part 2 ────────────────────────────────────────────────────────────────
/** Call an Admin edge function; its { error } becomes a thrown message. */
async function fn(name, body) {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let msg = error.message || 'Something went wrong';
    try { const b = await error.context?.json?.(); if (b?.error) msg = b.error; } catch { /* keep msg */ }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}
export const peopleList = () => rpc('admin_people');
export const teamSave = (userId, name, role, active, reason) => rpc('admin_team_save', { p_user: userId, p_name: name, p_role: role, p_active: active, p_reason: reason || null });
export const teamRemove = (userId, reason) => rpc('admin_team_remove', { p_user: userId, p_reason: reason });
export const hubRemove = (userId, reason) => rpc('admin_hub_remove', { p_user: userId, p_reason: reason });
export const personAdd = (email, name, role, reason) => fn('admin-people', { action: 'add', email, name, role, reason });
export const personPassword = (userId, reason) => fn('admin-people', { action: 'password', userId, reason });
export const personReset2Step = (userId, reason) => fn('admin-people', { action: 'reset_2step', userId, reason });

export const ordersList = async (days, status, slug) => (await rpc('admin_orders', { p_days: days, p_status: status || null, p_slug: slug || null })) || [];
export const ordersSummary = () => rpc('admin_orders_summary');
export const reviewReports = async () => (await rpc('admin_review_reports')) || [];
export const reviewDecide = (reportId, decision, note) => rpc('admin_review_decide', { p_report: reportId, p_decision: decision, p_note: note || null });

export const coinsSummary = () => rpc('admin_coins_summary');
export const coinsAdjust = (slug, coins, reason) => rpc('admin_coins', { p_slug: slug, p_coins: coins, p_reason: reason });
export const storeCoins = async (slug) => (await rpc('admin_store_coins', { p_slug: slug })) || [];

/** A new shop PIN, hashed in the browser exactly like the owner's own PIN. */
export async function resetPin(slug, pin, reason) {
  const { hashPin } = await import('../utils/pinHash.js');
  return rpc('admin_reset_pin', { p_slug: slug, p_new_hashed_pin: await hashPin(pin), p_reason: reason });
}

export const razorpayStatus = (slug) => fn('admin-billing', { action: 'status', slug });
export const razorpayStop = (slug, atEnd, reason) => fn('admin-billing', { action: 'cancel', slug, atEnd, reason });
export const razorpayRefund = (slug, paymentId, amountPaise, reason) => fn('admin-billing', { action: 'refund', slug, paymentId, amountPaise, reason });

// ── Part 3: System and switches ───────────────────────────────────────────
export const switchesList = async () => (await rpc('admin_switches')) || [];
export const switchSet = (key, on, note, reason) => rpc('admin_switch_set', { p_key: key, p_on: on, p_note: note ?? null, p_reason: reason });
export const jobsList = async () => (await rpc('admin_jobs')) || [];
export const jobRun = (id, reason) => rpc('admin_job_run', { p_job: id, p_reason: reason });
export const jobPause = (id, active, reason) => rpc('admin_job_pause', { p_job: id, p_active: active, p_reason: reason });
export const purgeList = async () => (await rpc('admin_purge_list')) || [];
/** Remove a deleted shop for good: the database checks and erases, then its photos go. */
export const purgeStore = (slug, confirm, reason) => fn('admin-system', { action: 'purge', slug, confirm, reason });
export const systemKeys = () => fn('admin-system', { action: 'keys' });
export const systemPing = () => fn('admin-system', { action: 'ping' });

// ── Salary: worked out in the browser (utils/payroll.js), checked and kept by
//    the database (supabase/salary-forward.sql). Nothing here moves money. ──
export const payrollInputs = (month) => rpc('admin_payroll_inputs', { p_month: month });
export const payrollSaveDrafts = (month, slips, reason) => rpc('admin_payroll_save_drafts', { p_month: month, p_slips: slips, p_reason: reason || null });
export const payrollDraftRemove = (id, reason) => rpc('admin_payroll_draft_remove', { p_slip: id, p_reason: reason });
export const payrollLineAdd = (id, kind, amount, reason) => rpc('admin_payroll_line_add', { p_slip: id, p_kind: kind, p_amount: amount, p_reason: reason });
export const payrollLineRemove = (id, index, reason) => rpc('admin_payroll_line_remove', { p_slip: id, p_index: index, p_reason: reason || null });
export const payrollApprove = (month, ids, reason) => rpc('admin_payroll_approve', { p_month: month, p_ids: ids || null, p_reason: reason || null });
export const payrollUnapprove = (id, reason) => rpc('admin_payroll_unapprove', { p_slip: id, p_reason: reason });
export const payrollMarkPaid = (id, method, ref, paidOn, reason) => rpc('admin_payroll_mark_paid', { p_slip: id, p_method: method, p_ref: ref || null, p_paid_on: paidOn, p_reason: reason || null });
export const payrollUndoPaid = (id, reason) => rpc('admin_payroll_undo_paid', { p_slip: id, p_reason: reason });
export const payrollSettingsSave = (value, reason) => rpc('admin_payroll_settings_save', { p_value: value, p_reason: reason || null });
export const payrollPersonSave = (userId, f, reason) => rpc('admin_payroll_person_save', {
  p_user: userId, p_base: f.base, p_joined: f.joined, p_employee_no: f.employeeNo || null, p_pay_to: f.payTo || null,
  p_prof_tax: f.profTax, p_active: f.active, p_reason: reason || null,
});
export const payrollAdvanceAdd = (userId, amount, givenOn, perMonth, note) => rpc('admin_payroll_advance_add', {
  p_user: userId, p_amount: amount, p_given_on: givenOn, p_per_month: perMonth || null, p_note: note,
});
export const payrollAdvanceRemove = (id, reason) => rpc('admin_payroll_advance_remove', { p_id: id, p_reason: reason });
/** The WhatsApp "salary paid" message (sent only when its template is set). */
export const payrollNotify = (slipId) => fn('admin-salary', { action: 'notify', slipId });

// Sales CRM data layer. Every read and write is held to the signed-in person's
// role by the database itself (supabase/sales-crm-forward.sql): a manager sees
// every lead, a caller or field executive only their own, and no CRM login can
// read shops or orders at all. Lists are read page by page: the Supabase API
// stops at 1,000 rows a request.
import { supabase } from '../lib/supabase';
import { readAllRowsOrEmpty } from '../utils/rpcPages.js';
import { istDate } from './crmLogic.js';

const fail = (error) => { throw new Error(error?.message || 'Something went wrong. Try again.'); };

// ── Session ─────────────────────────────────────────────────────────────────
export async function crmSession() {
  const { data } = await supabase.auth.getSession();
  return data?.session ?? null;
}
export function onCrmAuthChange(cb) {
  const { data } = supabase.auth.onAuthStateChange((_e, session) => cb(session));
  return () => data?.subscription?.unsubscribe();
}
export async function crmSignIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email: String(email).trim(), password });
  if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Wrong email or password.' : error.message);
  return data.session;
}
export async function crmSignOut() { await supabase.auth.signOut(); }
export async function crmResetPassword(email) {
  const redirectTo = `${window.location.origin}${window.location.pathname.startsWith('/crm') ? '/crm' : ''}/`;
  const { error } = await supabase.auth.resetPasswordForEmail(String(email).trim(), { redirectTo });
  if (error) fail(error);
}
export async function crmSetPassword(password) {
  const { error } = await supabase.auth.updateUser({ password });
  if (error) fail(error);
}

// ── Staff ───────────────────────────────────────────────────────────────────
/** The signed-in person's staff row, or null when they are not on the sales team. */
export async function fetchMe(userId) {
  const { data, error } = await supabase.from('sales_staff').select('*').eq('user_id', userId).maybeSingle();
  if (error) return null;
  return data && data.active ? data : null;
}
export async function fetchStaff() {
  const { data, error } = await supabase.from('sales_staff').select('*').order('name');
  return error ? [] : data || [];
}
export async function updateStaff(userId, patch) {
  const { error } = await supabase.from('sales_staff').update(patch).eq('user_id', userId);
  if (error) fail(error);
}
/** Manager only: create a login and a staff row (edge function, service role). */
export async function addStaff(person) {
  const { data, error } = await supabase.functions.invoke('sales-staff', { body: { action: 'create', ...person } });
  if (error) fail(error);
  if (data?.error) throw new Error(data.error);
  return data;
}
export async function resetStaffPassword(userId, password) {
  const { data, error } = await supabase.functions.invoke('sales-staff', { body: { action: 'password', user_id: userId, password } });
  if (error) fail(error);
  if (data?.error) throw new Error(data.error);
}

// ── Leads ───────────────────────────────────────────────────────────────────
const LEAD_COLS = 'id, created_at, updated_at, shop_name, owner_name, phone, business_type, city, area, source, source_detail, stage, heat, won_plan, won_amount, lost_reason, signed_up, next_action_at, next_action, assigned_to, created_by, last_activity_at, call_attempts';

/** Every lead the person may see (the database decides which). */
export async function listLeads() {
  return readAllRowsOrEmpty((c) => supabase.from('sales_leads').select(LEAD_COLS, c ? { count: 'exact' } : undefined),
    { order: [['created_at', true], ['id', true]], key: 'id' });
}
export async function getLead(id) {
  const { data, error } = await supabase.from('sales_leads').select(LEAD_COLS).eq('id', id).maybeSingle();
  if (error) fail(error);
  return data;
}
export async function addLead(lead) {
  const { data, error } = await supabase.from('sales_leads').insert(lead).select(LEAD_COLS).single();
  if (error) {
    if (error.code === '23505') throw new Error('This number is already a lead.');
    fail(error);
  }
  return data;
}
export async function updateLead(id, patch) {
  const { data, error } = await supabase.from('sales_leads').update(patch).eq('id', id).select(LEAD_COLS).maybeSingle();
  if (error) fail(error);
  return data;
}
/** Is this number already a lead? [{ lead_id, shop_name, stage, owner_name, mine }] */
export async function lookupPhone(phone) {
  const { data, error } = await supabase.rpc('sales_phone_lookup', { p_phone: phone });
  return error ? [] : data || [];
}
export async function assignLeads(ids, to) {
  const { data, error } = await supabase.rpc('sales_assign', { p_leads: ids, p_to: to });
  if (error) fail(error);
  return data;
}

// ── Activity ────────────────────────────────────────────────────────────────
export async function listActivities(leadId) {
  const { data, error } = await supabase.from('sales_activities').select('*').eq('lead_id', leadId).order('created_at', { ascending: false }).limit(200);
  return error ? [] : data || [];
}
/** Activity since an instant (today's numbers). */
export async function activitiesSince(iso) {
  return readAllRowsOrEmpty((c) => supabase.from('sales_activities')
    .select('id, lead_id, staff_id, kind, outcome, created_at', c ? { count: 'exact' } : undefined)
    .gte('created_at', iso), { order: [['created_at', true], ['id', true]], key: 'id' });
}
/** One call / visit / note, and the lead moves on, in one step (sales_log). */
export async function logActivity(a) {
  const { data, error } = await supabase.rpc('sales_log', {
    p_lead: a.leadId, p_kind: a.kind, p_outcome: a.outcome ?? null, p_note: a.note ?? null,
    p_stage: a.stage ?? null, p_next_at: a.nextAt ?? null, p_next: a.next ?? null,
    p_lat: a.lat ?? null, p_lng: a.lng ?? null, p_acc: a.acc ?? null, p_photo: a.photo ?? null,
    p_duration: a.duration ?? null, p_lost: a.lost ?? null,
  });
  if (error) fail(error);
  return data;
}

// ── Visit photos ────────────────────────────────────────────────────────────
/** Shrink a camera photo to at most 1280 px, JPEG. */
export async function shrinkPhoto(file, max = 1280) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return await new Promise((res) => c.toBlob((b) => res(b || file), 'image/jpeg', 0.8));
  } catch {
    return file;
  } finally {
    URL.revokeObjectURL(url);
  }
}
export async function uploadVisitPhoto(userId, file) {
  const blob = await shrinkPhoto(file);
  const path = `${userId}/${istDate()}/${crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage.from('sales-visits').upload(path, blob, { contentType: 'image/jpeg', upsert: false });
  if (error) fail(error);
  return path;
}
export async function photoUrl(path) {
  const { data } = await supabase.storage.from('sales-visits').createSignedUrl(path, 3600);
  return data?.signedUrl || '';
}

/** The phone's location: { lat, lng, acc } or an Error with a plain reason. */
export function getLocation({ timeout = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('This phone cannot share its location.')); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy) }),
      (e) => reject(new Error(e.code === 1 ? 'Allow location for this site in the browser, then try again.' : 'Location not found yet. Step outside and try again.')),
      { enableHighAccuracy: true, timeout, maximumAge: 30000 },
    );
  });
}

// ── Attendance ──────────────────────────────────────────────────────────────
export async function touch() { try { await supabase.rpc('sales_touch'); } catch { /* best effort */ } }
export async function startOrEndDay(action, loc) {
  const { error } = await supabase.rpc('sales_day', { p_action: action, p_lat: loc.lat, p_lng: loc.lng, p_acc: loc.acc ?? null });
  if (error) fail(error);
}
export async function attendanceBetween(from, to) {
  return readAllRowsOrEmpty((c) => supabase.from('sales_attendance').select('*', c ? { count: 'exact' } : undefined)
    .gte('day', from).lte('day', to), { order: [['day', true], ['staff_id', true]] });
}
export async function setAttendanceOverride(staffId, day, status, note) {
  const { error } = await supabase.from('sales_attendance').upsert({ staff_id: staffId, day, status_override: status || null, note: note || null }, { onConflict: 'staff_id,day' });
  if (error) fail(error);
}
export async function listHolidays() {
  const { data, error } = await supabase.from('sales_holidays').select('*').order('day');
  return error ? [] : data || [];
}
export async function addHoliday(day, name) {
  const { error } = await supabase.from('sales_holidays').insert({ day, name });
  if (error) fail(error);
}
export async function removeHoliday(day) {
  const { error } = await supabase.from('sales_holidays').delete().eq('day', day);
  if (error) fail(error);
}
export async function listLeave() {
  const { data, error } = await supabase.from('sales_leave').select('*').order('from_day', { ascending: false }).limit(500);
  return error ? [] : data || [];
}
export async function askLeave(staffId, from, to, reason) {
  const { error } = await supabase.from('sales_leave').insert({ staff_id: staffId, from_day: from, to_day: to, reason });
  if (error) fail(error);
}
export async function decideLeave(id, status, managerId) {
  const { error } = await supabase.from('sales_leave').update({ status, decided_by: managerId, decided_at: new Date().toISOString() }).eq('id', id);
  if (error) fail(error);
}

import { supabase } from '../lib/supabase';
import { hashPin } from './pinHash';

/**
 * Hisaab's own records: the shop's expenses and its monthly sales goal
 * (supabase/hisaab-forward.sql). Every call is PIN-checked in the database;
 * the tables themselves are closed to the browser.
 */

const EMPTY = { expenses: [], goals: [] };

/** 'YYYY-MM' -> 'YYYY-MM-01', the database's month key. */
const monthDate = (month) => `${String(month).slice(0, 7)}-01`;

/**
 * The whole book. Same envelope as fetchOrderFacts: { ok: true, data } or
 * { ok: false, data: EMPTY }, because "no expenses yet" and "could not load
 * them" must not look alike - You kept would read high on a failed load.
 */
export async function fetchHisaab(slug, pin) {
  try {
    const hashed = await hashPin(pin);
    const { data, error } = await supabase.rpc('get_store_hisaab', { p_slug: slug, p_hashed_pin: hashed });
    if (error || !data || !Array.isArray(data.expenses) || !Array.isArray(data.goals)) {
      return { ok: false, data: EMPTY };
    }
    return { ok: true, data: { expenses: data.expenses, goals: data.goals } };
  } catch {
    return { ok: false, data: EMPTY };
  }
}

/** Resolves the new expense's id, or null when it was not saved. */
export async function addExpense(slug, pin, { spentOn, amount, category, note = '', paidWith = 'cash', repeats = false }) {
  try {
    const hashed = await hashPin(pin);
    const { data, error } = await supabase.rpc('add_store_expense', {
      p_slug: slug, p_hashed_pin: hashed, p_spent_on: spentOn, p_amount: amount,
      p_category: category, p_note: note, p_paid_with: paidWith, p_repeats: repeats,
    });
    return error || !data ? null : data;
  } catch {
    return null;
  }
}

export async function deleteExpense(slug, pin, id) {
  try {
    const hashed = await hashPin(pin);
    const { data, error } = await supabase.rpc('delete_store_expense', { p_slug: slug, p_hashed_pin: hashed, p_id: id });
    return !error && data === true;
  } catch {
    return false;
  }
}

/** A repeating expense counts up to and including `lastMonth` ('YYYY-MM'), then stops. */
export async function stopExpense(slug, pin, id, lastMonth) {
  try {
    const hashed = await hashPin(pin);
    const { data, error } = await supabase.rpc('stop_store_expense', {
      p_slug: slug, p_hashed_pin: hashed, p_id: id, p_last_month: monthDate(lastMonth),
    });
    return !error && data === true;
  } catch {
    return false;
  }
}

/** The sales goal from `month` ('YYYY-MM') on; 0 clears it. */
export async function setSalesGoal(slug, pin, month, amount) {
  try {
    const hashed = await hashPin(pin);
    const { data, error } = await supabase.rpc('set_store_sales_goal', {
      p_slug: slug, p_hashed_pin: hashed, p_month: monthDate(month), p_amount: amount,
    });
    return !error && data === true;
  } catch {
    return false;
  }
}

/**
 * Read a bill photo (a JPEG data URL) with AI: /api/bill-read. Resolves
 * { amount, date, vendor, category } with any field possibly null, or
 * { error } - the owner then types it. The photo is read, never stored.
 */
export async function readBill(slug, pin, image) {
  try {
    const hashed = await hashPin(pin);
    const r = await fetch('/api/bill-read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, hashedPin: hashed, image }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || data?.error) return { error: data?.error || `http_${r.status}` };
    return data;
  } catch {
    return { error: 'failed' };
  }
}

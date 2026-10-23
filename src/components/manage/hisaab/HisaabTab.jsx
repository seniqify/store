import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  buildHisaab, buildDayBook, comingUp, availableMonths, recentExpenses, hisaabCsv, monthLabel, todayKey,
} from '../../../utils/hisaabMetrics';
import { fetchHisaab, addExpense, deleteExpense, stopExpense, setSalesGoal, readBill } from '../../../utils/hisaabService';
import { downloadCsv } from '../../../utils/exportCustomers';
import { slugify } from '../../../utils/slugify';
import HisaabHome from './HisaabHome';
import ProductProfit from './ProductProfit';
import MoneyInOut from './MoneyInOut';
import AddExpense from './AddExpense';

/**
 * Payments → Hisaab (Payments redesign part 2, founder-approved 2026-10-23).
 *
 * The orders come from PaymentsTab, which already loads them for the Money
 * screens: Hisaab needs their items, so it uses the detailed feed. This
 * component loads the shop's own book (expenses and goals), holds the month
 * in view, and runs every action. The screens only present.
 */
export default function HisaabTab({
  slug, pin, themeColor = '#0d9488', storeName = '', orders, listPartial = false, comingIn, loadedAt,
  products = [], packagingCost = 0, deliveryCost = 0, onGoTab, onOpenMoney,
}) {
  const [book, setBook] = useState(null);           // { ok, data: { expenses, goals } }
  const [view, setView] = useState({ name: 'home', arg: null });
  const [month, setMonth] = useState(null);         // null = this month
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    setBook(await fetchHisaab(slug, pin));
  }, [slug, pin]);
  useEffect(() => { load(); }, [load]);

  const expenses = book?.data.expenses || [];
  const goals = book?.data.goals || [];
  const today = todayKey(loadedAt);
  const m = month || today?.slice(0, 7);
  const costs = { products, packagingCost, deliveryCost };

  const h = useMemo(
    () => buildHisaab({ orders: orders || [], expenses, goals, ...costs, now: loadedAt, month: m }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [orders, expenses, goals, products, packagingCost, deliveryCost, loadedAt, m],
  );
  const months = useMemo(() => availableMonths({ orders: orders || [], expenses, now: loadedAt }), [orders, expenses, loadedAt]);
  const days = useMemo(
    () => buildDayBook({ orders: orders || [], expenses, ...costs, now: loadedAt, month: m }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [orders, expenses, products, packagingCost, deliveryCost, loadedAt, m],
  );
  const upcoming = useMemo(() => comingUp({ expenses, now: loadedAt }), [expenses, loadedAt]);
  const onItsWay = {
    count: (comingIn?.with_courier?.count || 0) + (comingIn?.with_rider?.count || 0),
    amount: (comingIn?.with_courier?.amount || 0) + (comingIn?.with_rider?.amount || 0),
  };

  const open = (name, arg = null) => {
    setView({ name, arg }); setNote('');
    try { window.scrollTo({ top: 0 }); } catch { /* not in a browser */ }
  };
  const home = () => open('home');

  async function save(expense) {
    setBusy(true); setNote('');
    const id = await addExpense(slug, pin, expense);
    setBusy(false);
    if (!id) { setNote('Could not save that expense. Check the amount and date, then try again.'); return; }
    await load();
    // Land on the month the expense counts in, so the owner sees it.
    if (expense.spentOn.slice(0, 7) !== m) setMonth(expense.spentOn.slice(0, 7));
    open('home');
    setNote(`Saved ${expense.note || 'the expense'}.`);
  }

  async function remove(e) {
    const what = e.note || 'this expense';
    const msg = e.repeats_monthly ? `Delete ${what} from every month it counted in?` : `Delete ${what}?`;
    if (!window.confirm(msg)) return;
    setBusy(true); setNote('');
    const ok = await deleteExpense(slug, pin, e.id);
    setBusy(false);
    setNote(ok ? 'Expense deleted.' : 'Could not delete that expense.');
    await load();
  }

  async function stop(e, lastMonth) {
    if (!window.confirm(`Stop ${e.note || 'this expense'} after ${monthLabel(lastMonth)}? Months up to then keep it.`)) return;
    setBusy(true); setNote('');
    const ok = await stopExpense(slug, pin, e.id, lastMonth);
    setBusy(false);
    setNote(ok ? `It stops after ${monthLabel(lastMonth)}.` : 'Could not change that expense.');
    await load();
  }

  async function saveGoal(amount) {
    const ok = await setSalesGoal(slug, pin, m, amount);
    setNote(ok ? (amount > 0 ? 'Goal saved.' : 'Goal removed.') : 'Could not save the goal.');
    if (ok) await load();
    return ok;
  }

  function download() {
    const csv = hisaabCsv({ hisaab: h, orders: orders || [], expenses });
    const name = slugify(storeName || slug) || 'shop';
    downloadCsv(`${name}-hisaab-${m}.csv`, csv);
  }

  if (book === null || !loadedAt) {
    return (
      <div className="space-y-3">
        <div className="h-11 w-40 rounded-xl bg-white border border-gray-100 animate-pulse" />
        <div className="h-64 rounded-[22px] bg-white border border-gray-100 animate-pulse" />
        <div className="h-28 rounded-2xl bg-white border border-gray-100 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {note && (
        <p className="text-xs font-semibold text-gray-700 bg-white border border-gray-100 rounded-xl px-3 py-2.5" role="status">{note}</p>
      )}
      {view.name === 'products' ? (
        <ProductProfit h={h} focus={view.arg} themeColor={themeColor} onBack={home} onGoTab={onGoTab} />
      ) : view.name === 'flow' ? (
        <MoneyInOut h={h} days={days} upcoming={upcoming} onItsWay={onItsWay} themeColor={themeColor} busy={busy}
                    onBack={home} onAdd={() => open('add')} onOpenMoney={onOpenMoney} onDelete={remove} onStop={stop} />
      ) : view.name === 'add' ? (
        <AddExpense today={today} recent={recentExpenses(expenses)} packagingCost={packagingCost} themeColor={themeColor}
                    saving={busy} onBack={home} onSave={save} onReadBill={(image) => readBill(slug, pin, image)} />
      ) : (
        <HisaabHome h={h} months={months} month={m} setMonth={setMonth} themeColor={themeColor}
                    bookOk={book.ok} listPartial={listPartial} onOpen={open} onOpenMoney={onOpenMoney}
                    onGoTab={onGoTab} onSaveGoal={saveGoal} onDownload={download} onRetry={load} />
      )}
    </div>
  );
}

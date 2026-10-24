import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, Check, ChevronLeft, ChevronRight, FileSpreadsheet, FileText, AlertTriangle } from 'lucide-react';
import { formatINR } from '../../../utils/currency';
import { todayKey, shiftMonth, daysInMonth, monthLabel } from '../../../utils/hisaabMetrics';
import {
  buildStatement, statementPresets, firstSaleDay, statementCsv, statementFileName, maskPhone,
  rangeLabel, dateLabel, daysBetween, PAY_FILTERS,
} from '../../../utils/salesStatement';
import { openStatement } from '../../../utils/statementPdf';
import { downloadCsv } from '../../../utils/exportCustomers';

/**
 * Payments → Hisaab → Sales statement (founder-approved mockup 2026-10-24).
 * Like a bank statement: From and To dates, each opening a calendar, quick
 * picks under them, and every order between the two as an A4 PDF (opened in
 * a new window to save, the same as the delivery slip) or an Excel file.
 *
 * Every figure is from buildStatement. The parent owns loading.
 */

const rs = (n) => formatINR(Math.round(Number(n) || 0));
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const chip = (active) => ['min-h-[40px] px-3.5 rounded-full text-[13px] border transition',
  active ? 'bg-gray-900 border-gray-900 text-white font-bold' : 'bg-white border-gray-200 text-gray-700 font-semibold'].join(' ');
const WEEK = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

function madeAtLabel(now) {
  const d = new Date(now || Date.now());
  const time = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true })
    .format(d).replace(/\s?([ap])\.?m\.?$/i, (x, a) => ` ${a.toLowerCase()}m`);
  return `${dateLabel(todayKey(d.getTime()))}, ${time}`;
}

function Toggle({ on, onChange, title, sub, disabled = false, themeColor }) {
  return (
    <div className="flex items-center justify-between gap-3 py-3 border-t border-gray-100 first:border-t-0">
      <div className="min-w-0">
        <p className="text-sm font-bold text-gray-900">{title}</p>
        <p className="text-xs text-gray-500 leading-snug">{sub}</p>
      </div>
      <button type="button" role="switch" aria-checked={on} aria-label={title} disabled={disabled} onClick={() => onChange(!on)}
              className="relative w-11 h-6 rounded-full transition-colors flex-shrink-0 disabled:opacity-50"
              style={{ backgroundColor: on ? themeColor : '#d1d5db' }}>
        <span className={['absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform', on ? 'translate-x-5' : ''].join(' ')} />
      </button>
    </div>
  );
}

/** The calendar sheet: pick From, it moves on to To, as bank apps do.
 *  Keyed on `which`, so each opens on its own date's month. */
function DateSheet({ which, from, to, min, max, onPick, onSwitch, onClose }) {
  const [month, setMonth] = useState((which === 'from' ? from : to).slice(0, 7));
  const panel = useRef(null);
  useEffect(() => {
    panel.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const lead = (new Date(`${month}-01T12:00:00Z`).getUTCDay() + 6) % 7;     // weeks start on Monday
  const days = Array.from({ length: daysInMonth(month) }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
  const prevOk = month > min.slice(0, 7);
  const nextOk = month < max.slice(0, 7);
  const label = which === 'from' ? 'Statement from' : 'Statement to';

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
      <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label={label}
           className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-xl px-4 pt-3 pb-6 outline-none"
           onClick={(e) => e.stopPropagation()}>
        <div className="w-10 h-1 rounded-full bg-gray-200 mx-auto mb-3 sm:hidden" />
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs text-gray-500">{which === 'from' ? 'Pick the first day' : 'Pick the last day'}</p>
            <p className="text-[17px] font-extrabold text-gray-900">{label}</p>
          </div>
          <button type="button" onClick={onClose} className="min-h-[40px] px-4 rounded-xl bg-gray-100 text-[13.5px] font-extrabold text-gray-900">Done</button>
        </div>
        <div className="grid grid-cols-2 gap-2 mt-3">
          {[['from', 'From', from], ['to', 'To', to]].map(([k, l, v]) => (
            <button key={k} type="button" onClick={() => onSwitch(k)} aria-pressed={which === k}
                    className={`text-left px-3 py-2 rounded-xl border-[1.5px] ${which === k ? 'border-gray-900 bg-gray-50' : 'border-gray-200 bg-white'}`}>
              <span className="block text-[11px] font-bold text-gray-500">{l}</span>
              <span className="block text-sm font-extrabold text-gray-900 whitespace-nowrap">{dateLabel(v)}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between mt-3">
          <button type="button" disabled={!prevOk} onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month"
                  className="w-11 h-10 flex items-center justify-center rounded-xl text-gray-700 disabled:opacity-25"><ChevronLeft size={20} /></button>
          <p className="text-[15px] font-extrabold text-gray-900">{monthLabel(month)} {month.slice(0, 4)}</p>
          <button type="button" disabled={!nextOk} onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month"
                  className="w-11 h-10 flex items-center justify-center rounded-xl text-gray-700 disabled:opacity-25"><ChevronRight size={20} /></button>
        </div>
        <div className="grid grid-cols-7 text-center mt-1 text-[11px] font-bold text-gray-400">
          {WEEK.map((d, i) => <span key={i} className="py-1.5">{d}</span>)}
        </div>
        <div className="grid grid-cols-7 gap-y-1 text-center">
          {Array.from({ length: lead }, (_, i) => <span key={`l${i}`} />)}
          {days.map((k) => {
            const off = k < min || k > max || (which === 'to' && k < from);
            const sel = k === from || k === to;
            const inside = !sel && k > from && k < to;
            return (
              <button key={k} type="button" disabled={off} onClick={() => onPick(k)} aria-label={dateLabel(k)} aria-pressed={sel}
                      className={['h-10 text-sm', sel ? 'rounded-xl bg-gray-900 text-white font-extrabold'
                        : inside ? 'bg-gray-100 text-gray-900 font-semibold' : 'rounded-xl text-gray-900 font-semibold',
                      k === max && !sel ? 'ring-[1.5px] ring-inset ring-emerald-600 rounded-xl' : '',
                      'disabled:text-gray-300 disabled:cursor-not-allowed'].join(' ')}>
                {Number(k.slice(8, 10))}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-gray-500 text-center mt-3">Your shop&rsquo;s first sale was on {dateLabel(min)}.</p>
      </div>
    </div>,
    document.body,
  );
}

export default function SalesStatement({
  orders = [], expenses = [], bookOk = true, products = [], packagingCost = 0, deliveryCost = 0,
  now, store = {}, slug = '', themeColor = '#0d9488', listPartial = false, onBack,
}) {
  const today = todayKey(now);
  const presets = useMemo(() => statementPresets(today), [today]);
  const first = useMemo(() => firstSaleDay(orders) || today, [orders, today]);
  const [range, setRange] = useState(() => ({ from: presets[0]?.from || today, to: presets[0]?.to || today }));
  const [pay, setPay] = useState('all');
  const [showCosts, setShowCosts] = useState(true);
  const [withExpenses, setWithExpenses] = useState(false);
  const [showPhones, setShowPhones] = useState(false);
  const [sheet, setSheet] = useState(null);          // null | 'from' | 'to'
  const [note, setNote] = useState('');
  const closeSheet = useCallback(() => setSheet(null), []);

  const st = useMemo(
    () => buildStatement({ orders, expenses, products, packagingCost, deliveryCost, from: range.from, to: range.to, pay, now }),
    [orders, expenses, products, packagingCost, deliveryCost, range, pay, now],
  );
  const t = st.totals;
  const active = presets.find((p) => p.from === range.from && p.to === range.to)?.id;
  const anything = t.count > 0 || st.cancelled.length > 0;
  const name = store.businessName || slug;
  const options = { showCosts, showPhones, withExpenses: withExpenses && bookOk };

  const pick = (k) => {
    if (sheet === 'from') { setRange((r) => ({ from: k, to: r.to < k ? k : r.to })); setSheet('to'); }
    else { setRange((r) => ({ ...r, to: k })); setSheet(null); }
  };
  const makePdf = () => {
    setNote('');
    const opened = openStatement(st, { store, slug, ...options, madeAt: madeAtLabel(now) });
    if (!opened) setNote('Your browser stopped the new window. Allow pop-ups for PocketLink, then tap Make PDF again.');
  };
  const makeExcel = () => {
    downloadCsv(`${statementFileName(name, st.from, st.to)}.csv`, statementCsv(st, options));
    setNote('Saved the Excel file to your Downloads.');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 -ml-2">
        <button type="button" onClick={onBack} aria-label="Back to Hisaab"
                className="w-11 h-11 flex items-center justify-center text-gray-700 rounded-xl hover:bg-gray-100">
          <ChevronLeft size={22} />
        </button>
        <h2 className="text-lg font-extrabold text-gray-900">Sales statement</h2>
      </div>
      <p className="text-[13px] text-gray-500 -mt-2">Every order between two dates, as a PDF</p>

      <section className="rounded-2xl border border-gray-100 bg-white shadow-sm p-4">
        <p className="text-xs font-bold uppercase tracking-widest text-gray-500">Statement period</p>
        <div className="grid grid-cols-2 gap-2.5 mt-3">
          {[['from', 'From', range.from], ['to', 'To', range.to]].map(([k, l, v]) => (
            <button key={k} type="button" onClick={() => setSheet(k)} aria-label={`${l} date, ${dateLabel(v)}`}
                    className={`text-left px-3 py-2.5 rounded-[14px] border-[1.5px] bg-white min-h-[64px] min-w-0 ${sheet === k ? 'border-gray-900' : 'border-gray-200'}`}>
              <span className="block text-[11.5px] font-bold text-gray-500">{l}</span>
              <span className="flex items-center gap-1.5 mt-0.5 text-[15px] font-extrabold text-gray-900 whitespace-nowrap">
                <CalendarDays size={16} className="text-emerald-700 flex-shrink-0" />{dateLabel(v)}
              </span>
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-500 mt-2">{plural(daysBetween(range.from, range.to), 'day', 'days')} · tap a date to change it</p>
        <p className="text-xs font-bold uppercase tracking-widest text-gray-500 mt-4">Quick pick</p>
        <div className="flex flex-wrap gap-2 mt-2.5">
          {presets.map((p) => (
            <button key={p.id} type="button" aria-pressed={active === p.id} onClick={() => setRange({ from: p.from, to: p.to })} className={chip(active === p.id)}>
              {p.label}
            </button>
          ))}
        </div>
      </section>

      {t.count > 0 ? (
        <section className="rounded-[22px] bg-emerald-900 text-white px-5 py-4" aria-live="polite">
          <p className="text-xs font-bold text-emerald-200">{rangeLabel(st.from, st.to)}</p>
          <p className="mt-1"><span className="text-[30px] font-black tracking-tight tabular-nums">{rs(t.sold)}</span>
            <span className="text-sm text-emerald-100"> sold in {plural(t.count, 'order', 'orders')}</span></p>
          <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-white/15">
            {[['Received', rs(t.received)], ['Not paid yet', rs(t.unpaid)],
              showCosts ? ['Profit', rs(t.profit)] : ['Came back', String(t.returnedCount)]].map(([l, v]) => (
              <div key={l}><p className="text-[11px] font-semibold text-emerald-200">{l}</p><p className="text-[15px] font-extrabold tabular-nums">{v}</p></div>
            ))}
          </div>
        </section>
      ) : (
        <section className="rounded-2xl bg-gray-100 px-5 py-4" aria-live="polite">
          <p className="text-xs font-bold text-gray-500">{rangeLabel(st.from, st.to)}</p>
          <p className="text-base font-extrabold text-gray-900 mt-1">No orders in these dates</p>
          {st.cancelled.length > 0 && <p className="text-xs text-gray-500 mt-0.5">{plural(st.cancelled.length, 'order was', 'orders were')} cancelled.</p>}
        </section>
      )}

      {showCosts && t.costMissingCount > 0 && (
        <div className="rounded-2xl border border-amber-100 bg-amber-50/60 px-4 py-3 flex items-center gap-3">
          <AlertTriangle size={18} className="text-amber-500 flex-shrink-0" />
          <p className="text-xs text-gray-700">{plural(t.costMissingCount, 'order has', 'orders have')} a product with no cost price, so the profit reads higher than it really is.</p>
        </div>
      )}

      <section className="rounded-2xl border border-gray-100 bg-white shadow-sm px-4 pt-4 pb-1">
        <p className="text-xs font-bold uppercase tracking-widest text-gray-500">Payment mode</p>
        <div className="flex flex-wrap gap-2 mt-2.5">
          {PAY_FILTERS.map((p) => (
            <button key={p.key} type="button" aria-pressed={pay === p.key} onClick={() => setPay(p.key)} className={chip(pay === p.key)}>{p.label}</button>
          ))}
        </div>
        <div className="mt-2">
          <Toggle on={showCosts} onChange={setShowCosts} themeColor={themeColor} title="Show my costs and profit"
                  sub="Turn off before you send it to someone outside the shop." />
          <Toggle on={withExpenses && bookOk} onChange={setWithExpenses} disabled={!bookOk || !showCosts} themeColor={themeColor}
                  title="Take away shop expenses"
                  sub={bookOk ? 'Rent, salary and other expenses you added in Hisaab.' : 'Your expenses didn’t load, so they can’t be added.'} />
          <Toggle on={showPhones} onChange={setShowPhones} themeColor={themeColor} title="Show full phone numbers"
                  sub={`Off: numbers show as ${maskPhone('9822041421')}.`} />
        </div>
      </section>

      <section className="rounded-2xl border border-gray-100 bg-white shadow-sm p-4">
        <p className="text-xs font-bold uppercase tracking-widest text-gray-500">In the PDF</p>
        <ul className="mt-2.5 space-y-2">
          {[`Summary: sales, money received, not paid yet${showCosts ? ', profit' : ''}`,
            `Every order: date, customer and place, what they ordered, payment mode, delivery${showCosts ? ', courier cost and profit' : ''}`,
            'Products sold, and orders that came back or were cancelled'].map((line) => (
            <li key={line} className="flex gap-2 text-[13px] text-gray-700"><Check size={16} className="text-emerald-600 flex-shrink-0 mt-0.5" />{line}</li>
          ))}
        </ul>
      </section>

      {listPartial && (
        <p className="text-[11px] text-gray-500 text-center">Some older orders didn&rsquo;t load, so this statement may be missing a few.</p>
      )}
      {note && <p className="text-xs font-semibold text-gray-700 bg-white border border-gray-100 rounded-xl px-3 py-2.5" role="status">{note}</p>}

      <div className="grid grid-cols-[1fr_auto] gap-2.5">
        <button type="button" onClick={makePdf} disabled={!anything}
                className="min-h-[52px] rounded-[14px] flex items-center justify-center gap-2 text-[15px] font-extrabold text-white disabled:opacity-50 active:scale-[0.98]"
                style={{ backgroundColor: themeColor }}>
          <FileText size={18} /> Make PDF
        </button>
        <button type="button" onClick={makeExcel} disabled={!anything}
                className="min-h-[52px] px-4 rounded-[14px] border-[1.5px] border-gray-200 bg-white flex items-center justify-center gap-2 text-sm font-extrabold text-gray-900 disabled:opacity-50 active:scale-[0.98]">
          <FileSpreadsheet size={18} /> Excel
        </button>
      </div>
      <p className="text-[11px] text-gray-500 text-center -mt-2">The PDF opens in a new tab. Tap Save as PDF there.</p>

      {sheet && (
        <DateSheet key={sheet} which={sheet} from={range.from} to={range.to} min={first} max={today}
                   onPick={pick} onSwitch={setSheet} onClose={closeSheet} />
      )}
    </div>
  );
}

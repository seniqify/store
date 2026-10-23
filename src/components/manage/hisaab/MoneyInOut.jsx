import { useState } from 'react';
import { ChevronLeft, ChevronDown, ChevronRight, Truck, Repeat, Plus } from 'lucide-react';
import { formatINR } from '../../../utils/currency';
import { monthLabel, dayLabel, CATEGORY_LABEL } from '../../../utils/hisaabMetrics';

/**
 * Payments → Hisaab → Money in & out: what is due in the next few days, and
 * the day book - every rupee in and out of the month, day by day.
 *
 * In is money received (dated by paid_at). Out is the shop's own expenses and
 * the courier and packing Hisaab counts for that day's orders. Tapping an
 * expense the owner added offers to delete it, or stop it repeating.
 */

const rs = (n) => formatINR(Math.round(Number(n) || 0));
const net = (n) => (n < 0 ? `− ${rs(-n)}` : `+ ${rs(n)}`);
const weekday = (key) => new Date(`${key}T12:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'UTC' });
const time = (ms) => new Date(ms).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });

function ExpenseRow({ x, month, isCurrent, busy, onDelete, onStop }) {
  const [open, setOpen] = useState(false);
  const e = x.expense;
  const stopped = e.repeats_monthly && e.ends_on;
  const sub = [CATEGORY_LABEL[e.category] || 'Other', e.paid_with === 'bank' ? 'UPI / bank' : 'cash',
    e.repeats_monthly ? (stopped ? `until ${monthLabel(String(e.ends_on).slice(0, 7))}` : 'every month') : null].filter(Boolean).join(' · ');
  return (
    <div>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
              className="w-full flex items-center justify-between gap-3 py-2.5 text-left">
        <span className="min-w-0">
          <span className="block text-sm text-gray-900 truncate">{x.label}</span>
          <span className="block text-xs text-gray-500">{sub}</span>
        </span>
        <b className="text-sm text-rose-800 tabular-nums flex-shrink-0">− {rs(x.amount)}</b>
      </button>
      {open && (
        <div className="flex flex-wrap gap-2 pb-3">
          {e.repeats_monthly && !stopped && (
            <button type="button" disabled={busy} onClick={() => onStop(e, month)}
                    className="min-h-[40px] px-3 rounded-xl border-[1.5px] border-gray-200 bg-white text-xs font-bold text-gray-800 disabled:opacity-50">
              Stop after {isCurrent ? 'this month' : monthLabel(month)}
            </button>
          )}
          <button type="button" disabled={busy} onClick={() => onDelete(e)}
                  className="min-h-[40px] px-3 rounded-xl border-[1.5px] border-rose-200 bg-white text-xs font-bold text-rose-700 disabled:opacity-50">
            {e.repeats_monthly ? 'Delete from every month' : 'Delete'}
          </button>
        </div>
      )}
    </div>
  );
}

export default function MoneyInOut({
  h, days, upcoming, onItsWay, themeColor = '#0d9488', busy = false,
  onBack, onAdd, onOpenMoney, onDelete, onStop,
}) {
  const [openDays, setOpenDays] = useState(() => new Set(days.slice(0, 2).map((d) => d.key)));
  const toggle = (key) => setOpenDays((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const label = monthLabel(h.month, h.today?.slice(0, 7));
  const upOut = upcoming.reduce((s, x) => s + x.amount, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 -ml-2">
        <button type="button" onClick={onBack} aria-label="Back to Hisaab"
                className="w-11 h-11 flex items-center justify-center text-gray-700 rounded-xl hover:bg-gray-100">
          <ChevronLeft size={22} />
        </button>
        <h2 className="text-lg font-extrabold text-gray-900">Money in &amp; out</h2>
      </div>

      {/* On its way: not dated, so not in a day */}
      {h.isCurrent && onItsWay.count > 0 && (
        <button type="button" onClick={() => onOpenMoney?.('coming')}
                className="w-full flex items-center gap-3 p-4 rounded-2xl border border-gray-100 bg-white shadow-sm text-left">
          <span className="w-10 h-10 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center flex-shrink-0"><Truck size={19} /></span>
          <span className="flex-grow min-w-0">
            <span className="block text-sm font-bold text-gray-900">{rs(onItsWay.amount)} on its way to you</span>
            <span className="block text-xs text-gray-600">{onItsWay.count} {onItsWay.count === 1 ? 'parcel' : 'parcels'} with the courier or your delivery boy, paid to you after delivery.</span>
          </span>
          <ChevronRight size={16} className="text-gray-400 flex-shrink-0" />
        </button>
      )}

      {h.isCurrent && upcoming.length > 0 && (
        <section className="rounded-2xl border border-gray-100 bg-white shadow-sm p-4">
          <h3 className="text-base font-extrabold text-gray-900">Coming up in the next 7 days</h3>
          <p className="text-[13px] text-gray-500 mt-0.5">− {rs(upOut)} going out</p>
          <ul className="mt-3 space-y-3">
            {upcoming.map((x) => (
              <li key={`${x.expense.id}-${x.key}`} className="flex items-center gap-3">
                <span className="w-11 text-center flex-shrink-0">
                  <b className="block text-sm text-gray-900">{weekday(x.key)}</b>
                  <span className="block text-[11px] text-gray-500">{dayLabel(x.key)}</span>
                </span>
                <span className="flex-grow min-w-0">
                  <span className="block text-sm font-bold text-gray-900 truncate">{x.label}</span>
                  <span className="text-xs text-gray-500 inline-flex items-center gap-1"><Repeat size={11} /> Repeats every month</span>
                </span>
                <b className="text-sm text-rose-800 tabular-nums flex-shrink-0">− {rs(x.amount)}</b>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
        <div className="px-4 pt-4 pb-2 flex items-baseline justify-between gap-3">
          <h3 className="text-base font-extrabold text-gray-900">Day book</h3>
          <span className="text-xs text-gray-500">{label}{h.isCurrent ? ' so far' : ''}, day by day</span>
        </div>
        {days.length === 0 ? (
          <p className="px-4 pb-5 text-sm text-gray-500">Nothing came in or went out in {label} yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {days.map((d) => {
              const isOpen = openDays.has(d.key);
              const isToday = d.key === h.today;
              return (
                <li key={d.key}>
                  <button type="button" onClick={() => toggle(d.key)} aria-expanded={isOpen}
                          className={`w-full min-h-[48px] px-4 flex items-center justify-between gap-3 text-left ${isOpen ? 'bg-gray-50' : ''}`}>
                    <span className="text-[13px] font-bold text-gray-900">{isToday ? 'Today · ' : ''}{weekday(d.key)} {dayLabel(d.key)}</span>
                    <span className="flex items-center gap-2">
                      <span className={`text-[13px] font-extrabold tabular-nums ${d.net < 0 ? 'text-rose-800' : 'text-emerald-700'}`}>{net(d.net)}</span>
                      <ChevronDown size={14} className={`text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                    </span>
                  </button>
                  {isOpen && (
                    <div className="px-4 pb-1 divide-y divide-gray-100">
                      {d.entries.map((x, i) => (
                        x.kind === 'expense' ? (
                          <ExpenseRow key={`${x.expense.id}-${i}`} x={x} month={h.month} isCurrent={h.isCurrent}
                                      busy={busy} onDelete={onDelete} onStop={onStop} />
                        ) : (
                          <div key={`${x.kind}-${i}`} className="flex items-center justify-between gap-3 py-2.5">
                            <span className="min-w-0">
                              <span className="block text-sm text-gray-900 truncate">{x.kind === 'in' ? x.who : x.label}</span>
                              <span className="block text-xs text-gray-500">{x.kind === 'in' ? `${time(x.at)} · ${x.label}` : 'counted for you'}</span>
                            </span>
                            <b className={`text-sm tabular-nums flex-shrink-0 ${x.kind === 'in' ? 'text-emerald-700' : 'text-gray-600'}`}>
                              {x.kind === 'in' ? '+' : '−'} {rs(x.amount)}
                            </b>
                          </div>
                        )
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <p className="text-[11px] text-gray-500 text-center -mt-1">Money in is dated by when it was paid; courier and packing by the day the order came.</p>

      <button type="button" onClick={onAdd}
              className="w-full min-h-[52px] rounded-[14px] flex items-center justify-center gap-2 text-sm font-extrabold text-white active:scale-[0.98]"
              style={{ backgroundColor: themeColor }}>
        <Plus size={18} strokeWidth={2.5} /> Money out: add an expense
      </button>
    </div>
  );
}

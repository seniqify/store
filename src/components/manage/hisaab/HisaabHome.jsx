import { useState } from 'react';
import { ChevronDown, ChevronRight, Flag, Pencil, TrendingDown, TrendingUp, Check, CalendarDays, Plus, FileSpreadsheet, FileText, AlertTriangle, Truck } from 'lucide-react';
import { formatINR } from '../../../utils/currency';
import { monthLabel, dayLabel } from '../../../utils/hisaabMetrics';

/**
 * Payments → Hisaab: the home screen (Payments redesign part 2, founder-
 * approved 2026-10-23). "Is my shop really making money?"
 *
 *   1. You kept, and where every ₹100 sold went.
 *   2. The day the month's expenses were paid off.
 *   3. The month's sales goal.
 *   4. The same days last month.
 *   5. Worth knowing: a product that loses money, returns, delivery.
 *   6. Sales statement, Money in & out, Add expense, and the month's file
 *      for the CA.
 *
 * Every figure is from buildHisaab. Pure presentation: the parent owns
 * loading and every action.
 */

const rs = (n) => formatINR(Math.round(Number(n) || 0));
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// The ₹100 bar, in the order the approved design shows it.
const PARTS = [
  { key: 'productCost', label: 'Product cost', color: '#94a3b8' },
  { key: 'returns', label: 'Returns', color: '#fb7185' },
  { key: 'courier', label: 'Courier', color: '#fbbf24' },
  { key: 'expenses', label: 'Shop expenses', color: '#c4b5fd' },
  { key: 'packing', label: 'Packing', color: '#e5e7eb' },
];

function Change({ value, goodWhenUp = true }) {
  if (value == null || value === 0) return null;
  const up = value > 0;
  const good = up === goodWhenUp;
  return (
    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${good ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`}>
      {up ? '↑' : '↓'} {Math.abs(value)}%
    </span>
  );
}

function GoalCard({ h, label, themeColor, onSaveGoal }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const goal = h.goal;

  const start = () => { setValue(goal ? String(Math.round(goal.amount)) : ''); setEditing(true); };
  const save = async (amount) => {
    setSaving(true);
    const ok = await onSaveGoal(amount);
    setSaving(false);
    if (ok) setEditing(false);
  };
  const amount = Number(String(value).replace(/[^\d.]/g, ''));

  if (editing) {
    return (
      <section className="rounded-2xl border border-gray-100 bg-white shadow-sm p-4">
        <label className="block text-sm font-extrabold text-gray-900" htmlFor="hisaab-goal">{label} goal: how much to sell?</label>
        <div className="mt-3 flex items-center gap-2 rounded-xl border-[1.5px] border-gray-200 px-3 focus-within:border-gray-900">
          <span className="text-lg font-extrabold text-gray-500">₹</span>
          <input id="hisaab-goal" type="text" inputMode="numeric" autoFocus value={value}
                 onChange={(e) => setValue(e.target.value.replace(/[^\d]/g, '').slice(0, 9))}
                 className="w-full min-h-[48px] text-lg font-extrabold text-gray-900 outline-none bg-transparent" placeholder="50000" />
        </div>
        <p className="text-[11px] text-gray-500 mt-2">It carries on to the next months until you change it.</p>
        <div className="flex gap-2 mt-3">
          <button type="button" disabled={saving || !(amount > 0)} onClick={() => save(amount)}
                  className="flex-grow min-h-[44px] rounded-xl text-sm font-bold text-white disabled:opacity-50 active:scale-[0.98]"
                  style={{ backgroundColor: themeColor }}>
            {saving ? 'Saving…' : 'Save goal'}
          </button>
          <button type="button" disabled={saving} onClick={() => setEditing(false)}
                  className="min-h-[44px] px-4 rounded-xl border-[1.5px] border-gray-200 text-sm font-bold text-gray-800">
            Cancel
          </button>
        </div>
        {goal && (
          <button type="button" disabled={saving} onClick={() => save(0)}
                  className="mt-2 w-full min-h-[40px] text-xs font-bold text-rose-700">
            Remove the goal
          </button>
        )}
      </section>
    );
  }

  if (!goal) {
    return (
      <button type="button" onClick={start}
              className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl border border-gray-100 bg-white shadow-sm text-left">
        <span className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center flex-shrink-0"><Flag size={18} /></span>
        <span className="flex-grow min-w-0">
          <span className="block text-sm font-bold text-gray-900">Set a goal for {label}</span>
          <span className="block text-xs text-gray-500">See each day how much more to sell to reach it.</span>
        </span>
        <ChevronRight size={16} className="text-gray-400 flex-shrink-0" />
      </button>
    );
  }

  const pct = Math.round(goal.progress * 100);
  return (
    <section className="rounded-2xl border border-gray-100 bg-white shadow-sm p-4">
      <div className="flex items-center justify-between">
        <span className="text-[15px] font-extrabold text-gray-900">{label} goal: sell {rs(goal.amount)}</span>
        <button type="button" onClick={start} aria-label="Change goal"
                className="w-11 h-11 -my-2.5 -mr-3 flex items-center justify-center text-gray-500 rounded-xl hover:bg-gray-50">
          <Pencil size={16} />
        </button>
      </div>
      <div className="h-3 mt-3 rounded-full bg-gray-200 overflow-hidden" role="progressbar" aria-valuenow={Math.min(100, pct)} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-3 rounded-full bg-emerald-600" style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <div className="flex justify-between gap-3 mt-2 text-[13px]">
        <span className="font-bold text-gray-900 tabular-nums">{rs(h.sold.amount)} · {pct}%</span>
        <span className="text-gray-600 text-right">
          {goal.reached ? <span className="inline-flex items-center gap-1 font-bold text-emerald-700"><Check size={14} /> Reached</span>
            : !h.isCurrent ? `Short by ${rs(goal.left)}`
            : goal.perDay != null ? `${rs(goal.perDay)} a day for ${plural(goal.daysLeft, 'day', 'days')}`
            : `${rs(goal.left)} more today`}
        </span>
      </div>
    </section>
  );
}

export default function HisaabHome({
  h, months, month, setMonth, themeColor = '#0d9488', bookOk = true, listPartial = false,
  onOpen, onOpenMoney, onGoTab, onSaveGoal, onDownload, onRetry,
}) {
  const label = monthLabel(h.month, h.today?.slice(0, 7));
  const sold = h.sold.amount;
  const noCosts = !h.coverage.anyCost;
  const someMissing = !noCosts && h.coverage.unknownValue > 0;
  const lost = h.kept < 0;
  const be = h.breakEven;
  const c = h.compare;
  const prevLabel = monthLabel(c.month, h.today?.slice(0, 7));
  // Where a day boundary sits on the month bar: at(0) is the 1st's start.
  const at = (days) => `${(days / h.daysInMonth) * 100}%`;
  const beDay = be.day ? Number(be.day.slice(8, 10)) : null;

  return (
    <div className="space-y-4">
      {/* Month */}
      <div className="flex items-center justify-between gap-3">
        <label className="relative inline-flex items-center">
          <span className="sr-only">Month</span>
          <select value={month} onChange={(e) => setMonth(e.target.value)}
                  className="appearance-none min-h-[44px] pl-3.5 pr-9 rounded-xl border-[1.5px] border-gray-200 bg-white text-[15px] font-extrabold text-gray-900">
            {months.map((m) => <option key={m} value={m}>{monthLabel(m, h.today?.slice(0, 7))}</option>)}
          </select>
          <ChevronDown size={16} className="absolute right-3 pointer-events-none text-gray-700" />
        </label>
        <span className="text-xs text-gray-500">
          {h.isCurrent ? `so far · day ${h.cutoffDay} of ${h.daysInMonth}` : 'whole month'}
        </span>
      </div>

      {!bookOk && (
        <div className="rounded-2xl border border-amber-100 bg-amber-50/60 px-4 py-3.5 flex items-center gap-3" role="alert">
          <AlertTriangle size={18} className="text-amber-500 flex-shrink-0" />
          <div className="min-w-0 flex-grow">
            <p className="text-sm font-bold text-gray-900">Your expenses didn&rsquo;t load</p>
            <p className="text-xs text-gray-500 mt-0.5">So what you kept isn&rsquo;t shown. Your sales are below.</p>
          </div>
          <button type="button" onClick={onRetry}
                  className="flex-shrink-0 text-xs font-bold px-3 py-2 rounded-xl text-white active:scale-[0.98]"
                  style={{ backgroundColor: themeColor }}>
            Try again
          </button>
        </div>
      )}

      {/* 1. You kept */}
      <section className="rounded-[22px] bg-emerald-900 text-white px-5 pt-5 pb-5">
        {noCosts || !bookOk || sold <= 0 ? (
          <>
            <p className="text-xs font-bold uppercase tracking-widest text-emerald-200">You sold</p>
            <p className="text-[40px] font-black tracking-tight leading-tight mt-1 tabular-nums">{rs(sold)}</p>
            <p className="text-sm text-emerald-100 mt-0.5">
              {sold > 0 ? `in ${plural(h.sold.count, 'order', 'orders')}` : h.isCurrent ? `No sales in ${label} yet.` : `No sales in ${label}.`}
            </p>
          </>
        ) : (
          <>
            <p className="text-xs font-bold uppercase tracking-widest text-emerald-200">{lost ? 'You lost' : 'You kept'}</p>
            <p className={`text-[40px] font-black tracking-tight leading-tight mt-1 tabular-nums ${lost ? 'text-rose-200' : ''}`}>{rs(Math.abs(h.kept))}</p>
            <p className="text-sm text-emerald-100 mt-0.5">from {rs(sold)} sold in {plural(h.sold.count, 'order', 'orders')}</p>
            <div className="h-px bg-white/15 my-4" />
            <p className="text-sm font-bold">Out of every ₹100 you sold</p>
            <div className="flex gap-[3px] h-[30px] mt-3" role="img"
                 aria-label={[...PARTS.map((p) => `${p.label} ₹${h.per100[p.key]}`), `You keep ₹${h.per100.kept}`].join(', ')}>
              {PARTS.filter((p) => h.split[p.key] > 0).map((p, i) => (
                <div key={p.key} className={i === 0 ? 'rounded-l-lg' : 'rounded-[3px]'} style={{ flex: h.split[p.key], backgroundColor: p.color }} />
              ))}
              {h.split.kept > 0 && (
                <div className="rounded-r-lg flex items-center justify-center text-[11px] font-black text-emerald-950"
                     style={{ flex: h.split.kept, backgroundColor: '#34d399' }}>
                  {h.per100.kept >= 8 ? `₹${h.per100.kept}` : ''}
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-x-3.5 gap-y-2.5 mt-3.5 text-[13px]">
              {PARTS.filter((p) => h.split[p.key] > 0).map((p) => (
                <span key={p.key} className="flex items-center gap-2 text-gray-200">
                  <span className="w-2.5 h-2.5 rounded-[3px] flex-shrink-0" style={{ backgroundColor: p.color }} />
                  {p.label}<b className="ml-auto text-white tabular-nums">₹{h.per100[p.key]}</b>
                </span>
              ))}
              {lost ? (
                <span className="flex items-center gap-2 font-extrabold text-rose-200">
                  <span className="w-2.5 h-2.5 rounded-[3px] flex-shrink-0 bg-rose-300" />
                  You lose<b className="ml-auto tabular-nums">₹{Math.round((-h.kept / sold) * 100)}</b>
                </span>
              ) : (
                <span className="flex items-center gap-2 font-extrabold text-emerald-300">
                  <span className="w-2.5 h-2.5 rounded-[3px] flex-shrink-0 bg-emerald-400" />
                  You keep<b className="ml-auto tabular-nums">₹{h.per100.kept}</b>
                </span>
              )}
            </div>
          </>
        )}
      </section>

      {/* Cost prices missing: You kept would read high, so say so beside it */}
      {(noCosts || someMissing) && sold > 0 && (
        <div className="rounded-2xl border border-amber-100 bg-amber-50/60 px-4 py-3.5 flex items-center gap-3">
          <span className="min-w-0 flex-grow">
            <span className="block text-sm font-bold text-gray-900">
              {noCosts ? 'Add what each product costs you' : `${plural(h.coverage.unknownProducts.length, 'product has', 'products have')} no cost price`}
            </span>
            <span className="block text-xs text-gray-600 mt-0.5">
              {noCosts ? 'Then Hisaab shows what you really keep from every sale.'
                : `${rs(h.coverage.unknownValue)} of sales are counted with no product cost, so you really kept less.`}
            </span>
          </span>
          <button type="button" onClick={() => onGoTab?.('products')}
                  className="flex-shrink-0 min-h-[40px] px-3 rounded-xl border-[1.5px] border-gray-200 bg-white text-xs font-bold text-gray-900 active:scale-95">
            Add costs
          </button>
        </div>
      )}

      {/* 2. Break-even */}
      {bookOk && !noCosts && sold > 0 && (be.hasExpenses ? (
        <section className="rounded-2xl border border-gray-100 bg-white shadow-sm p-4">
          <div className="flex items-start gap-2.5">
            <span className={`w-9 h-9 rounded-[10px] flex items-center justify-center flex-shrink-0 ${be.inProfit ? 'bg-emerald-50 text-emerald-700' : 'bg-violet-50 text-violet-700'}`}>
              <Flag size={18} />
            </span>
            <span className="min-w-0">
              <span className="block text-[15px] font-extrabold text-gray-900">
                {be.inProfit ? `In profit since ${dayLabel(be.day)}` : `${rs(be.short)} more to cover your expenses`}
              </span>
              <span className="block text-xs text-gray-600 mt-0.5">
                {be.inProfit
                  ? `Your ${rs(be.expenses)} of shop expenses ${h.isCurrent ? 'were' : 'was'} paid off that day. Every order since adds to what you keep.`
                  : `Shop expenses this month: ${rs(be.expenses)}. The profit on each order pays them off.`}
              </span>
            </span>
          </div>
          <div className="relative h-3 mt-4 rounded-full bg-gray-200 overflow-hidden" aria-hidden="true">
            <div className="absolute inset-y-0 left-0 bg-violet-300" style={{ width: at(beDay ? beDay - 1 : h.cutoffDay) }} />
            {beDay && <div className="absolute inset-y-0 bg-emerald-600" style={{ left: at(beDay - 1), width: at(h.cutoffDay - beDay + 1) }} />}
          </div>
          <div className="relative h-[18px] mt-1.5 text-[11px] text-gray-500">
            <span className="absolute left-0">{dayLabel(`${h.month}-01`)}</span>
            {beDay && beDay > 3 && beDay < h.cutoffDay - 3 && (
              <span className="absolute -translate-x-1/2 font-bold text-emerald-700" style={{ left: at(beDay - 1) }}>{beDay}</span>
            )}
            {h.isCurrent && h.cutoffDay > 4 && h.cutoffDay < h.daysInMonth - 3 && (
              <span className="absolute -translate-x-1/2 font-bold text-gray-900" style={{ left: at(h.cutoffDay) }}>Today</span>
            )}
            <span className="absolute right-0">{h.daysInMonth}</span>
          </div>
        </section>
      ) : (
        <button type="button" onClick={() => onOpen('add')}
                className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl border border-gray-100 bg-white shadow-sm text-left">
          <span className="w-10 h-10 rounded-xl bg-violet-50 text-violet-700 flex items-center justify-center flex-shrink-0"><Plus size={18} /></span>
          <span className="flex-grow min-w-0">
            <span className="block text-sm font-bold text-gray-900">Add rent, ads and other expenses</span>
            <span className="block text-xs text-gray-500">Then Hisaab shows the day each month starts making you money.</span>
          </span>
          <ChevronRight size={16} className="text-gray-400 flex-shrink-0" />
        </button>
      ))}

      {/* 3. Goal */}
      {bookOk && <GoalCard key={h.month} h={h} label={label} themeColor={themeColor} onSaveGoal={onSaveGoal} />}

      {/* 4. The same days last month */}
      {sold > 0 && c.hasData && (
        <section className="rounded-2xl border border-gray-100 bg-white shadow-sm px-4 pt-4 pb-1">
          <p className="text-[13px] text-gray-500">
            Compared with {c.wholeMonth ? prevLabel : `1–${c.toDay} ${dayLabel(`${c.month}-01`).split(' ')[1] || prevLabel}`}
          </p>
          <div className="mt-1">
            <div className="flex items-center justify-between min-h-[44px] border-b border-gray-100">
              <span className="text-sm text-gray-800">Sold</span>
              <span className="flex items-center gap-2.5"><b className="text-sm tabular-nums">{rs(c.sold.now)}</b><Change value={c.sold.change} /></span>
            </div>
            {bookOk && !noCosts && (
              <div className="flex items-center justify-between min-h-[44px] border-b border-gray-100">
                <span className="text-sm text-gray-800">You kept</span>
                <span className="flex items-center gap-2.5">
                  <b className={`text-sm tabular-nums ${c.kept.now < 0 ? 'text-rose-800' : ''}`}>{c.kept.now < 0 ? `− ${rs(-c.kept.now)}` : rs(c.kept.now)}</b>
                  <Change value={c.kept.change} />
                </span>
              </div>
            )}
            {c.returnsPer100.now != null && c.returnsPer100.was != null && (c.returnsPer100.now > 0 || c.returnsPer100.was > 0) && (
              <div className="flex items-center justify-between min-h-[44px]">
                <span className="text-sm text-gray-800">Returns per ₹100</span>
                <span className="flex items-center gap-2.5">
                  <b className="text-sm tabular-nums">₹{c.returnsPer100.now} <span className="font-medium text-gray-500">(was ₹{c.returnsPer100.was})</span></b>
                  {c.returnsPer100.now !== c.returnsPer100.was && (
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${c.returnsPer100.now < c.returnsPer100.was ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`}>
                      {c.returnsPer100.now < c.returnsPer100.was ? 'better' : 'worse'}
                    </span>
                  )}
                </span>
              </div>
            )}
          </div>
        </section>
      )}

      {/* 5. Worth knowing */}
      {h.insights.length > 0 && (
        <section className="space-y-2.5">
          <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500 px-1">Worth knowing</p>
          {h.insights.map((x) => {
            const Icon = x.kind === 'delivery' ? Truck : x.tone === 'good' ? Check : x.kind === 'returns' ? TrendingUp : TrendingDown;
            const go = x.kind === 'losing' ? () => onOpen('products', x.product)
              : x.kind === 'returns' ? () => onOpenMoney?.('returns')
              : () => onGoTab?.('delivery');
            return (
              <button key={x.kind} type="button" onClick={go}
                      className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl text-left ${x.tone === 'good' ? 'bg-emerald-50' : 'bg-rose-50'}`}>
                <span className={`w-9 h-9 rounded-[10px] bg-white flex items-center justify-center flex-shrink-0 ${x.tone === 'good' ? 'text-emerald-700' : 'text-rose-800'}`}>
                  <Icon size={18} />
                </span>
                <span className="flex-grow min-w-0">
                  <span className="block text-sm font-extrabold text-gray-900">{x.title}</span>
                  <span className="block text-xs text-gray-600">{x.sub}</span>
                </span>
                <ChevronRight size={16} className="text-gray-400 flex-shrink-0" />
              </button>
            );
          })}
        </section>
      )}

      {/* 6. Actions */}
      <button type="button" onClick={() => onOpen('statement')}
              className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl border border-gray-100 bg-white shadow-sm text-left">
        <span className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center flex-shrink-0"><FileText size={18} /></span>
        <span className="flex-grow min-w-0">
          <span className="block text-sm font-bold text-gray-900">
            Sales statement <span className="ml-1 align-[1px] text-[10px] font-extrabold uppercase tracking-wide bg-emerald-100 text-emerald-900 px-1.5 py-0.5 rounded-full">New</span>
          </span>
          <span className="block text-xs text-gray-500">Like a bank statement: pick From and To dates, get every order as a PDF.</span>
        </span>
        <ChevronRight size={16} className="text-gray-400 flex-shrink-0" />
      </button>
      {!noCosts && h.products.some((p) => p.costKnown) && (
        <button type="button" onClick={() => onOpen('products')}
                className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl border border-gray-100 bg-white shadow-sm text-left">
          <span className="flex-grow min-w-0">
            <span className="block text-sm font-bold text-gray-900">Which products make you money</span>
            <span className="block text-xs text-gray-500">What you keep on each one sold</span>
          </span>
          <ChevronRight size={16} className="text-gray-400 flex-shrink-0" />
        </button>
      )}
      <div className="grid grid-cols-2 gap-2.5">
        <button type="button" onClick={() => onOpen('flow')}
                className="min-h-[52px] rounded-[14px] border-[1.5px] border-gray-200 bg-white flex items-center justify-center gap-2 text-sm font-extrabold text-gray-900 active:scale-[0.98]">
          <CalendarDays size={18} /> Money in &amp; out
        </button>
        <button type="button" onClick={() => onOpen('add')} disabled={!bookOk}
                className="min-h-[52px] rounded-[14px] flex items-center justify-center gap-2 text-sm font-extrabold text-white active:scale-[0.98] disabled:opacity-50"
                style={{ backgroundColor: themeColor }}>
          <Plus size={18} strokeWidth={2.5} /> Add expense
        </button>
      </div>

      {sold > 0 && (
        <section className="flex items-center gap-3 p-4 rounded-2xl border-[1.5px] border-dashed border-gray-300">
          <span className="flex-grow min-w-0">
            <span className="block text-sm font-extrabold text-gray-900">{label}&rsquo;s file for your CA</span>
            <span className="block text-xs text-gray-600">Every sale and expense{h.isCurrent ? ' so far' : ''}, and the summary. Opens in Excel.</span>
          </span>
          <button type="button" onClick={onDownload} disabled={!bookOk}
                  className="flex-shrink-0 min-h-[44px] px-3.5 rounded-xl border-[1.5px] border-gray-200 bg-white text-[13px] font-bold text-gray-900 inline-flex items-center gap-1.5 disabled:opacity-50">
            <FileSpreadsheet size={15} /> Download
          </button>
        </section>
      )}

      {listPartial && (
        <p className="text-[11px] text-gray-500 text-center">Some older orders didn&rsquo;t load, so older months may be missing a few.</p>
      )}
    </div>
  );
}

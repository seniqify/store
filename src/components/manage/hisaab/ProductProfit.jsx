import { useState } from 'react';
import { ChevronLeft, ChevronDown } from 'lucide-react';
import { formatINR } from '../../../utils/currency';
import { monthLabel, fixesFor, THIN_MARGIN } from '../../../utils/hisaabMetrics';

/**
 * Payments → Hisaab → Which products make you money: what the shop keeps on
 * each one sold (or over the month) after the product's share of product cost,
 * courier, packing and returns. From buildProductProfit; the parts of each
 * breakdown add up to the rupee.
 */

const rs = (n) => formatINR(Math.round(Number(n) || 0));
const signed = (n) => (n < 0 ? `− ${rs(-n)}` : rs(n));
const SHOW = 6;

function Breakdown({ p, themeColor, onGoTab }) {
  const e = p.each;
  const fixes = fixesFor(p);
  const lose = e.kept < 0;
  const backRate = p.units > 0 && p.returnedUnits > 0 ? Math.round(p.units / p.returnedUnits) : null;
  const rows = [
    ['Buyer pays', e.buyerPays, false],
    ['Product cost', e.productCost, true],
    ['Courier', e.courier, true],
    ['Packing', e.packing, true],
    [backRate ? `Returns (1 in ${backRate} comes back)` : 'Returns', e.returns, true],
  ].filter(([, v, neg], i) => i === 0 || (neg && v > 0));

  return (
    <div className="mt-3 rounded-2xl bg-gray-50 p-3.5">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-extrabold text-gray-900">{lose ? `Why ${p.name} loses money` : `Where the money goes on one ${p.name}`}</span>
        <span className="text-[11px] text-gray-500 flex-shrink-0 ml-2">on one sold</span>
      </div>
      <div className="mt-2">
        {rows.map(([label, v, neg]) => (
          <div key={label} className="flex justify-between py-1.5 text-[13px] border-b border-gray-200/70">
            <span className="text-gray-700">{label}</span>
            <span className={`tabular-nums ${neg ? 'text-gray-700' : 'font-bold text-gray-900'}`}>{neg ? `− ${rs(v)}` : rs(v)}</span>
          </div>
        ))}
        <div className="flex justify-between pt-2 text-sm">
          <span className="font-extrabold text-gray-900">{lose ? 'You lose' : 'You keep'}</span>
          <span className={`font-extrabold tabular-nums ${lose ? 'text-rose-800' : 'text-emerald-700'}`}>{signed(e.kept)}</span>
        </div>
      </div>
      {fixes.length > 0 && (
        <>
          <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500 mt-3.5">Ways to fix it</p>
          <div className="mt-2 space-y-2">
            {fixes.map((f) => (
              f.kind === 'price' ? (
                <button key="price" type="button" onClick={() => onGoTab?.('products')}
                        className="w-full min-h-[48px] px-3.5 rounded-xl border-[1.5px] border-gray-200 bg-white flex items-center justify-between text-left active:scale-[0.99]">
                  <span className="text-sm font-bold text-gray-900">Make it {rs(f.price)}</span>
                  <span className="text-xs font-bold" style={{ color: themeColor }}>keep {signed(f.keeps)}</span>
                </button>
              ) : (
                <div key="bundle" className="min-h-[48px] px-3.5 py-2.5 rounded-xl border-[1.5px] border-gray-200 bg-white">
                  <span className="block text-sm font-bold text-gray-900">Sell it only with another product</span>
                  <span className="block text-xs text-gray-600">On its own it pays a whole courier charge. In a bigger order it shares one.</span>
                </div>
              )
            ))}
          </div>
          <p className="text-[11px] text-gray-500 mt-2">Prices change in Products. Nothing changes from here.</p>
        </>
      )}
    </div>
  );
}

export default function ProductProfit({ h, focus = null, themeColor = '#0d9488', onBack, onGoTab }) {
  const [whole, setWhole] = useState(false);
  const known = h.products.filter((p) => p.costKnown);
  const unknown = h.products.filter((p) => !p.costKnown);
  const worst = known.filter((p) => p.each.kept < 0).sort((a, b) => a.month.kept - b.month.kept)[0];
  const [open, setOpen] = useState(focus || worst?.name || null);
  const [all, setAll] = useState(false);
  const value = (p) => (whole ? p.month.kept : p.each.kept);
  const sorted = [...known].sort((a, b) => value(b) - value(a));
  // Keep the opened product in view even past the first few.
  const shown = all ? sorted : sorted.filter((p, i) => i < SHOW || p.name === open);
  const max = Math.max(1, ...sorted.map((p) => Math.abs(value(p))));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 -ml-2">
        <button type="button" onClick={onBack} aria-label="Back to Hisaab"
                className="w-11 h-11 flex items-center justify-center text-gray-700 rounded-xl hover:bg-gray-100">
          <ChevronLeft size={22} />
        </button>
        <h2 className="text-lg font-extrabold text-gray-900">Which products make you money</h2>
      </div>
      <p className="text-[13px] text-gray-500 -mt-2">
        {monthLabel(h.month, h.today?.slice(0, 7))}{h.isCurrent ? ' so far' : ''} · after product cost, courier, packing and returns
      </p>

      <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-gray-100" role="group" aria-label="Show">
        {[[false, 'Each one sold'], [true, 'Whole month']].map(([v, label]) => (
          <button key={label} type="button" aria-pressed={whole === v} onClick={() => setWhole(v)}
                  className={`min-h-[40px] rounded-lg text-[13px] font-bold transition ${whole === v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
            {label}
          </button>
        ))}
      </div>

      {known.length === 0 ? (
        <div className="text-center py-10 px-4 rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50/50">
          <p className="text-sm font-semibold text-gray-700">No product with a cost price sold this month</p>
          <p className="text-xs text-gray-400 mt-1">Add what each product costs you to see what it earns.</p>
        </div>
      ) : (
        <section className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden divide-y divide-gray-100">
          {shown.map((p) => {
            const v = value(p);
            const lose = p.each.kept < 0;
            const thin = !lose && p.margin < THIN_MARGIN;
            const isOpen = open === p.name;
            return (
              <div key={p.name} className="px-4 py-3">
                <button type="button" onClick={() => setOpen(isOpen ? null : p.name)} aria-expanded={isOpen}
                        className="w-full text-left">
                  <span className="flex items-center justify-between gap-3">
                    <span className="min-w-0 text-sm font-bold text-gray-900 flex items-center gap-2">
                      <span className="truncate">{p.name}</span>
                      {lose && <span className="flex-shrink-0 text-[11px] font-bold px-2 py-0.5 rounded-full bg-rose-50 text-rose-800">loses money</span>}
                      {thin && <span className="flex-shrink-0 text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-800">thin</span>}
                    </span>
                    <span className={`flex-shrink-0 text-sm font-extrabold tabular-nums ${v < 0 ? 'text-rose-800' : 'text-gray-900'}`}>{signed(v)}</span>
                  </span>
                  <span className="flex items-center gap-3 mt-2">
                    <span className="flex-grow h-2 rounded-full bg-gray-100 overflow-hidden">
                      <span className="block h-2 rounded-full"
                            style={{ width: `${Math.max(3, (Math.abs(v) / max) * 100)}%`, backgroundColor: lose ? '#be123c' : thin ? '#f59e0b' : '#059669' }} />
                    </span>
                    <span className="text-xs text-gray-500 flex-shrink-0 w-16 text-right">{p.units} sold</span>
                    <ChevronDown size={14} className={`text-gray-400 flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                  </span>
                </button>
                {isOpen && <Breakdown p={p} themeColor={themeColor} onGoTab={onGoTab} />}
              </div>
            );
          })}
        </section>
      )}

      {!all && sorted.length > shown.length && (
        <button type="button" onClick={() => setAll(true)}
                className="w-full min-h-[44px] text-sm font-bold" style={{ color: themeColor }}>
          Show {sorted.length - shown.length} more {sorted.length - shown.length === 1 ? 'product' : 'products'}
        </button>
      )}

      {unknown.length > 0 && (
        <div className="rounded-2xl border border-amber-100 bg-amber-50/60 px-4 py-3.5 flex items-center gap-3">
          <span className="min-w-0 flex-grow">
            <span className="block text-sm font-bold text-gray-900">No cost price yet</span>
            <span className="block text-xs text-gray-600 mt-0.5 truncate">{unknown.map((p) => p.name).join(', ')}</span>
          </span>
          <button type="button" onClick={() => onGoTab?.('products')}
                  className="flex-shrink-0 min-h-[40px] px-3 rounded-xl border-[1.5px] border-gray-200 bg-white text-xs font-bold text-gray-900 active:scale-95">
            Add costs
          </button>
        </div>
      )}

      {h.expenses.total > 0 && (
        <p className="text-xs text-gray-500 text-center">Shop expenses ({rs(h.expenses.total)}) are not split across products.</p>
      )}
    </div>
  );
}

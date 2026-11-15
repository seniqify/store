import { useState, useEffect } from 'react';
import { ChevronRight } from 'lucide-react';
import { fetchOrders, setOrderStatus } from '../../utils/orderService';
import { paymentChip } from '../../utils/orderCard';
import { stageOf, orderRef } from '../../utils/homeOrders';
import { formatINR } from '../../utils/currency';

/**
 * Home → "Latest orders": the newest few orders with a name, an amount, where
 * each one stands and one button. It is a LIST, never a source of figures: every
 * number on Home comes from the uncapped facts feed (overviewMetrics). This reads
 * only the first page of get_store_orders (reuse: [] skips paging the history).
 */
const STAGE = {
  new:        { label: 'New',        color: '#b45309', bg: '#fef3c7' },
  to_ship:    { label: 'To ship',    color: '#047857', bg: '#d1fae5' },
  not_paid:   { label: 'Not paid',   color: '#4b5563', bg: '#f3f4f6' },
  on_the_way: { label: 'On the way', color: '#4338ca', bg: '#e0e7ff' },
  delivered:  { label: 'Delivered',  color: '#1d4ed8', bg: '#dbeafe' },
  returned:   { label: 'Returned',   color: '#b91c1c', bg: '#fee2e2' },
  cancelled:  { label: 'Cancelled',  color: '#4b5563', bg: '#f3f4f6' },
};
const TONE = { paid: 'text-emerald-700', due: 'text-amber-700', bad: 'text-red-700', muted: 'text-gray-500' };

function when(iso, now) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t) || !now) return '';
  const s = Math.max(0, Math.floor((now - t) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
  return new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
}

function Pill({ stage }) {
  const s = STAGE[stage];
  return (
    <span className="inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full text-[12px] font-bold whitespace-nowrap"
          style={{ background: s.bg, color: s.color }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: s.color }} />{s.label}
    </span>
  );
}

export default function HomeLatestOrders({ slug, pin, products = [], colors, onOpen, onSeeAll, noun = 'order', count = 6 }) {
  const [rows, setRows] = useState(null);       // null = loading, false = could not load
  const [busy, setBusy] = useState(null);
  const [loadedAt, setLoadedAt] = useState(0);   // the clock, read when rows land
  // Read the newest page; the answer lands in a promise callback, so a slow
  // read for an old slug/PIN can never overwrite a newer one.
  const read = () => fetchOrders(slug, pin, { reuse: [] }).then((list) => ({ list, at: Date.now() }));
  const land = ({ list, at }) => { setLoadedAt(at); setRows(Array.isArray(list) ? list : false); };
  useEffect(() => {
    let alive = true;
    fetchOrders(slug, pin, { reuse: [] }).then((list) => { if (alive) land({ list, at: Date.now() }); });
    return () => { alive = false; };
  }, [slug, pin]);

  const imageFor = (o) => {
    const name = Array.isArray(o.items) ? o.items[0]?.name : null;
    const p = name && products.find((x) => x?.name === name);
    const img = p && (p.image || (Array.isArray(p.images) ? p.images[0] : null));
    return typeof img === 'string' && img ? img : null;
  };
  const accept = async (o) => {
    setBusy(o.id);
    await setOrderStatus(slug, pin, o.id, 'confirmed');
    land(await read());
    setBusy(null);
  };
  const action = (o, stage) => {
    if (stage === 'new') {
      return (
        <button type="button" disabled={busy === o.id} onClick={(e) => { e.stopPropagation(); accept(o); }}
          className="h-8 px-3 rounded-lg text-white text-[13px] font-bold disabled:opacity-60 active:scale-[0.98] transition"
          style={{ backgroundColor: colors.button }}>
          {busy === o.id ? 'Accepting…' : 'Accept'}
        </button>
      );
    }
    return (
      <button type="button" onClick={(e) => { e.stopPropagation(); onOpen(o); }}
        className="h-8 px-3 rounded-lg border border-gray-200 bg-white text-[13px] font-bold text-gray-800 hover:bg-gray-50">
        {stage === 'to_ship' ? 'Ship' : 'Open'}
      </button>
    );
  };

  const list = Array.isArray(rows) ? rows.slice(0, count) : [];
  const header = (
    <div className="flex items-center justify-between px-5 pt-4 pb-2">
      <span className="text-[11px] font-bold uppercase tracking-widest text-gray-500">Latest {noun}s</span>
      <button type="button" onClick={onSeeAll} className="text-[13px] font-bold" style={{ color: colors.button }}>See all</button>
    </div>
  );

  return (
    <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
      {header}
      {rows === null && <div className="px-5 pb-5 space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-11 rounded-xl bg-gray-50 animate-pulse" />)}</div>}
      {rows === false && <p className="px-5 pb-5 text-sm text-gray-500">Couldn&rsquo;t load the latest {noun}s. Open {noun}s to see them.</p>}
      {Array.isArray(rows) && list.length === 0 && <p className="px-5 pb-5 text-sm text-gray-500">No {noun}s yet. Share your page to get the first one.</p>}

      {/* Phone: one row each */}
      {list.length > 0 && (
        <ul className="lg:hidden divide-y divide-gray-100">
          {list.map((o) => {
            const stage = stageOf(o); const img = imageFor(o);
            return (
              <li key={o.id}>
                <button type="button" onClick={() => onOpen(o)} className="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-gray-50">
                  {img ? <img src={img} alt="" className="w-11 h-11 rounded-lg object-cover bg-gray-100 flex-shrink-0" />
                    : <span className="w-11 h-11 rounded-lg bg-gray-100 flex-shrink-0" />}
                  <span className="flex-1 min-w-0">
                    <span className="block font-bold text-[15px] text-gray-900 truncate">{o.customer_name || 'Customer'}</span>
                    <span className="block text-[12px] text-gray-500 truncate">#{orderRef(o).toUpperCase()} · {when(o.created_at, loadedAt)}</span>
                  </span>
                  <span className="text-right flex-shrink-0">
                    <span className="block font-extrabold tabular-nums text-gray-900">{formatINR(Number(o.total) || 0)}</span>
                    <Pill stage={stage} />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* Computer: a table */}
      {list.length > 0 && (
        <div className="hidden lg:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-[0.1em] text-gray-500">
                <th className="font-bold px-5 py-2">{noun === 'lead' ? 'Lead' : 'Order'}</th>
                <th className="font-bold py-2">Customer</th>
                <th className="font-bold py-2 text-right pr-6">Amount</th>
                <th className="font-bold py-2">Payment</th>
                <th className="font-bold py-2">Status</th>
                <th className="py-2 pr-5" />
              </tr>
            </thead>
            <tbody>
              {list.map((o) => {
                const stage = stageOf(o); const pay = paymentChip(o); const img = imageFor(o);
                const items = Array.isArray(o.items) ? o.items.map((i) => i?.name).filter(Boolean).join(', ') : '';
                return (
                  <tr key={o.id} onClick={() => onOpen(o)} className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer">
                    <td className="px-5 py-3"><p className="font-bold">#{orderRef(o).toUpperCase()}</p><p className="text-xs text-gray-500">{when(o.created_at, loadedAt)}</p></td>
                    <td className="py-3">
                      <div className="flex items-center gap-2.5">
                        {img ? <img src={img} alt="" className="w-[34px] h-[34px] rounded-lg object-cover bg-gray-100 flex-shrink-0" />
                          : <span className="w-[34px] h-[34px] rounded-lg bg-gray-100 flex-shrink-0" />}
                        <div className="min-w-0">
                          <p className="font-semibold truncate max-w-[200px]">{o.customer_name || 'Customer'}</p>
                          <p className="text-xs text-gray-500 truncate max-w-[200px]">{items}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 text-right pr-6 font-extrabold tabular-nums">{formatINR(Number(o.total) || 0)}</td>
                    <td className={`py-3 text-[12px] font-bold ${TONE[pay.tone] || 'text-gray-600'}`}>{pay.text}</td>
                    <td className="py-3"><Pill stage={stage} /></td>
                    <td className="py-3 pr-5 text-right">{action(o, stage)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {list.length > 0 && (
        <button type="button" onClick={onSeeAll}
          className="lg:hidden w-full flex items-center justify-center gap-1 py-3 border-t border-gray-100 text-[13px] font-bold"
          style={{ color: colors.button }}>
          See all {noun}s <ChevronRight size={15} />
        </button>
      )}
    </div>
  );
}

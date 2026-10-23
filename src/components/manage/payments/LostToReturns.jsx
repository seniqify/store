import { ChevronLeft, Truck, MessageCircleQuestion, MapPin } from 'lucide-react';
import { formatINR } from '../../../utils/currency';
import { orderCity } from '../../../utils/returnsInsights';

/**
 * Payments → Money → Lost to returns: the parcels that came back.
 *
 * The headline (₹ and parcels) and the months are buildMoneyHome over the
 * uncapped facts feed. The "what it cost you" lines need the courier charge,
 * the buyer's confirmation and the address, so they come from the detailed
 * rows (returnsInsights).
 */

const rs = (n) => formatINR(Math.round(Number(n) || 0));
const MONTH = (key) => {
  const t = Date.parse(`${key}-15T12:00:00Z`);
  return Number.isNaN(t) ? key : new Date(t).toLocaleDateString('en-IN', { month: 'short', timeZone: 'UTC' });
};
const courierName = (c) => {
  const k = String(c || '').toLowerCase();
  if (k.includes('delhivery')) return 'Delhivery';
  if (k.includes('shadowfax')) return 'Shadowfax';
  return c ? c.charAt(0).toUpperCase() + c.slice(1) : '';
};

export default function LostToReturns({ totals, returns, insights, list, listPartial = false, onBack, onGoTab }) {
  const months = returns.months;
  const max = Math.max(1, ...months.map((m) => m.amount));
  const ratePct = Math.round(returns.rate * 100);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 -ml-2">
        <button type="button" onClick={onBack} aria-label="Back to Payments"
                className="w-11 h-11 flex items-center justify-center text-gray-700 rounded-xl hover:bg-gray-100">
          <ChevronLeft size={22} />
        </button>
        <h2 className="text-lg font-extrabold text-gray-900">Lost to returns</h2>
      </div>

      {totals.count === 0 ? (
        <div className="text-center py-10 px-4 rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50/50">
          <p className="text-sm font-semibold text-gray-700">No parcel has come back</p>
          <p className="text-xs text-gray-400 mt-1">Every order you sent reached the buyer or is still on its way.</p>
        </div>
      ) : (
      <section className="rounded-2xl border border-gray-100 bg-white shadow-sm p-4">
        <p className="flex items-baseline gap-2">
          <span className="text-[26px] font-extrabold text-rose-800 tabular-nums">{rs(totals.amount)}</span>
          <span className="text-[13px] text-gray-500">{totals.count} {totals.count === 1 ? 'parcel' : 'parcels'} came back</span>
        </p>
        {returns.shipped > 0 && (
          <p className="text-[13px] text-gray-600 mt-1">{ratePct}% of the parcels you sent.</p>
        )}

        <div className="grid grid-cols-4 gap-2.5 items-end h-[150px] mt-5" role="img"
             aria-label={months.map((m) => `${MONTH(m.key)}: ${rs(m.amount)}, ${m.count} parcels`).join('; ')}>
          {months.map((m, i) => (
            <div key={m.key} className="flex flex-col items-center justify-end gap-1.5 h-full">
              <span className={`text-[11px] font-bold ${i === months.length - 1 ? 'text-rose-800' : 'text-gray-700'}`}>{m.amount ? rs(m.amount) : '—'}</span>
              <div className="w-full rounded-t-lg rounded-b-sm"
                   style={{ height: `${Math.max(4, Math.round((m.amount / max) * 100))}px`, backgroundColor: i === months.length - 1 ? '#9f1239' : '#fecdd3' }} />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-4 gap-2.5 mt-1.5 text-center text-xs text-gray-500">
          {months.map((m, i) => (
            <span key={m.key} className={i === months.length - 1 ? 'font-bold text-gray-900' : ''}>{MONTH(m.key)} · {m.count}</span>
          ))}
        </div>
        <p className="text-[11px] text-gray-400 mt-2">By the month the order was placed.</p>
      </section>
      )}

      {(insights.chargedParcels > 0 || insights.cod > 0 || insights.cities.length > 0) && (
        <section className="rounded-2xl border border-gray-100 bg-white shadow-sm p-4 space-y-4">
          <h3 className="text-base font-extrabold text-gray-900">What returns cost you</h3>
          {insights.chargedParcels > 0 && (
            <div className="flex gap-3">
              <span className="w-10 h-10 rounded-xl bg-rose-50 text-rose-800 flex items-center justify-center flex-shrink-0"><Truck size={19} /></span>
              <span>
                <span className="block text-sm font-bold text-gray-900">{rs(insights.courierCharges)} in courier charges</span>
                <span className="block text-xs text-gray-600">Paid on {insights.chargedParcels} of these parcels, and a parcel that comes back earns nothing.</span>
              </span>
            </div>
          )}
          {insights.cod > 0 && (
            <div className="flex gap-3">
              <span className="w-10 h-10 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center flex-shrink-0"><MessageCircleQuestion size={19} /></span>
              <span className="flex-grow">
                <span className="block text-sm font-bold text-gray-900">{insights.unconfirmed} of {insights.cod} never confirmed</span>
                <span className="block text-xs text-gray-600">Cash-on-delivery buyers who didn&rsquo;t tap &ldquo;Confirm my order&rdquo; on WhatsApp before you shipped.</span>
                <button type="button" onClick={() => onGoTab?.('orders')}
                        className="mt-2 min-h-[40px] px-3 rounded-xl border-[1.5px] border-gray-200 text-xs font-bold text-gray-800 bg-white active:scale-95">
                  See orders in Orders
                </button>
              </span>
            </div>
          )}
          {insights.cities.length > 0 && (
            <div className="flex gap-3">
              <span className="w-10 h-10 rounded-xl bg-gray-100 text-gray-600 flex items-center justify-center flex-shrink-0"><MapPin size={19} /></span>
              <span>
                <span className="block text-sm font-bold text-gray-900">Most came back from</span>
                <span className="block text-xs text-gray-600">{insights.cities.map((c) => `${c.city} ${c.count}`).join(' · ')}</span>
              </span>
            </div>
          )}
        </section>
      )}

      {list.length > 0 && (
        <section className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
          <p className="px-4 py-3 text-[11px] font-bold uppercase tracking-widest text-gray-500 border-b border-gray-100">Latest returns</p>
          <ul className="divide-y divide-gray-100">
            {list.slice(0, 10).map(({ order: o, amount }) => {
              const t = Date.parse(o.created_at);
              const placed = Number.isNaN(t) ? '' : new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
              const bits = [orderCity(o.destination), courierName(o.courier), placed && `ordered ${placed}`].filter(Boolean);
              return (
                <li key={o.id} className="px-4 py-3 flex items-center justify-between gap-3">
                  <span className="min-w-0">
                    <span className="block text-sm font-bold text-gray-900 truncate">{o.customer_name || 'Customer'}</span>
                    <span className="block text-xs text-gray-500 truncate">{bits.join(' · ')}</span>
                  </span>
                  <span className="text-sm font-extrabold text-rose-800 tabular-nums flex-shrink-0">{rs(amount)}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {listPartial && (
        <p className="text-[11px] text-gray-500 text-center">Some older orders didn&rsquo;t load, so the lines above may be missing a few. The totals count all of them.</p>
      )}
    </div>
  );
}

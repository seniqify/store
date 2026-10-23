import { useState, useMemo } from 'react';
import { ChevronLeft, Info, MessageCircle, Link2, Loader2, Check } from 'lucide-react';
import { formatINR } from '../../../utils/currency';
import { prettyStatus } from '../../../utils/deliveryStatus';
import { COMING_IN_KEYS } from '../../../utils/paymentsMetrics';

/**
 * Payments → Money → Coming in: the unpaid sales, by where the money is now
 * (comingInBucket). The tab counts and amounts come from buildMoneyHome over
 * the uncapped facts feed; the rows from the detailed list.
 *
 * Money is never marked collected by hand here. Marking an order delivered is
 * what records cash on delivery as collected (orders_payment_automation), the
 * same as it is everywhere else in Manage.
 */

const TABS = {
  with_rider:   { label: 'With delivery boy', note: 'Your delivery boy has these. Mark them delivered once the cash is with you, and they move to In your hand.' },
  not_shipped:  { label: 'Not shipped', note: 'Not sent yet. Ship them from Orders. Already handed one over yourself? Mark it delivered.' },
  stuck:        { label: 'Stuck', note: 'The courier reports a problem with these. Sort them out in Delivery so they reach the buyer.' },
  to_check:     { label: 'Payment to check', note: 'The money may already be on its way: a payment link is out, or the payment needs confirming.' },
  with_courier: { label: 'With courier', note: 'On the way. Nothing to do: the courier pays you after delivery.' },
};

const rs = (n) => formatINR(Math.round(Number(n) || 0));
const placedOn = (o) => {
  const t = Date.parse(o?.created_at);
  return Number.isNaN(t) ? '' : new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};
const waiting = (d) => (d === null || d === undefined ? '' : d === 0 ? 'today' : d === 1 ? '1 day' : `${d} days`);

export default function ComingIn({
  totals, lists, initialTab, themeColor = '#0d9488', listPartial = false,
  reasonLabel, razorpayConnected = false, busy = '',
  onBack, onMarkDelivered, onCancel, onSendLink, onGoTab,
}) {
  const firstWithRows = COMING_IN_KEYS.find((k) => totals[k]?.count > 0) || 'with_rider';
  const [tab, setTab] = useState(initialTab && TABS[initialTab] ? initialTab : firstWithRows);
  const rows = useMemo(() => lists[tab] || [], [lists, tab]);
  // Delivery-boy orders start ticked: the usual case is "all of these came back paid".
  const [unticked, setUnticked] = useState(() => new Set());
  const ticked = useMemo(() => rows.filter((r) => !unticked.has(r.order.id)), [rows, unticked]);
  const tickedSum = ticked.reduce((s, r) => s + r.amount, 0);
  const total = Object.values(totals).reduce((s, b) => s + (b?.amount || 0), 0);
  const count = Object.values(totals).reduce((s, b) => s + (b?.count || 0), 0);

  const toggle = (id) => setUnticked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 -ml-2">
        <button type="button" onClick={onBack} aria-label="Back to Payments"
                className="w-11 h-11 flex items-center justify-center text-gray-700 rounded-xl hover:bg-gray-100">
          <ChevronLeft size={22} />
        </button>
        <h2 className="text-lg font-extrabold text-gray-900">Coming in</h2>
      </div>

      <section className="rounded-2xl border border-gray-100 bg-white shadow-sm p-4">
        <p className="flex items-baseline gap-2">
          <span className="text-[26px] font-extrabold text-amber-700 tabular-nums">{rs(total)}</span>
          <span className="text-[13px] text-gray-500">{count} {count === 1 ? 'order' : 'orders'}</span>
        </p>
        <p className="text-[13px] text-gray-600 mt-1">Sold, not paid yet. Here is where each rupee is right now.</p>
      </section>

      <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-1 px-1" role="tablist" aria-label="Where the money is">
        {COMING_IN_KEYS.filter((k) => totals[k]?.count > 0 || k === tab).map((k) => {
          const active = k === tab;
          return (
            <button key={k} type="button" role="tab" aria-selected={active} onClick={() => { setTab(k); setUnticked(new Set()); }}
                    className={['flex-shrink-0 min-h-[36px] px-3.5 rounded-full text-xs border transition',
                      active ? 'bg-gray-900 border-gray-900 text-white font-bold' : 'bg-white border-gray-200 text-gray-600 font-semibold'].join(' ')}>
              {TABS[k].label} · {totals[k]?.count || 0}
            </button>
          );
        })}
      </div>

      <div className="flex gap-2.5 px-3.5 py-3 rounded-xl bg-gray-50 text-[13px] text-gray-700 leading-relaxed">
        <Info size={17} className="flex-shrink-0 mt-0.5 text-gray-400" />
        <span>{TABS[tab].note}</span>
      </div>

      <section className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
        {tab === 'with_rider' && rows.length > 0 && (
          <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100">
            <span className="text-[13px] font-semibold text-gray-700 min-h-[44px] flex items-center">{ticked.length} of {rows.length} ticked</span>
            <span className="text-[13px] font-extrabold tabular-nums">{rs(tickedSum)}</span>
          </div>
        )}
        {rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-gray-400">Nothing here right now.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {rows.map(({ order: o, amount, ageDays }) => {
              const phone = String(o.customer_phone || '').replace(/\D/g, '').slice(-10);
              const late = ageDays !== null && ageDays > 7;
              return (
                <li key={o.id} className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    {tab === 'with_rider' && (
                      <input type="checkbox" checked={!unticked.has(o.id)} onChange={() => toggle(o.id)}
                             aria-label={`Tick ${o.customer_name || 'customer'}`}
                             className="w-[18px] h-[18px] flex-shrink-0" style={{ accentColor: themeColor }} />
                    )}
                    <div className="flex-grow min-w-0">
                      <p className="text-sm font-bold text-gray-900 truncate">{o.customer_name || 'Customer'}</p>
                      <p className={`text-xs ${late ? 'text-amber-700' : 'text-gray-500'}`}>
                        Placed {placedOn(o)}{ageDays !== null && ` · waiting ${waiting(ageDays)}`}
                        {(tab === 'stuck' || tab === 'with_courier') && o.shipment_status ? ` · ${prettyStatus(o.shipment_status)}` : ''}
                      </p>
                    </div>
                    <p className="text-sm font-extrabold text-gray-900 tabular-nums flex-shrink-0">{rs(amount)}</p>
                  </div>

                  {tab === 'to_check' && reasonLabel && (
                    <p className="text-[11px] font-bold text-indigo-700 mt-1.5">{reasonLabel(o)}</p>
                  )}

                  {tab === 'not_shipped' && (
                    <div className="flex gap-2 mt-2.5">
                      <button type="button" disabled={busy === o.id} onClick={() => onMarkDelivered([o])}
                              className="min-h-[40px] px-3 rounded-xl border-[1.5px] border-gray-200 text-xs font-bold text-gray-800 bg-white active:scale-95 disabled:opacity-50 inline-flex items-center gap-1.5">
                        {busy === o.id ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Delivered
                      </button>
                      <button type="button" onClick={() => onGoTab?.('orders')}
                              className="min-h-[40px] px-3 rounded-xl border-[1.5px] border-gray-200 text-xs font-bold text-gray-800 bg-white active:scale-95">
                        Ship from Orders
                      </button>
                      {late && (
                        <button type="button" disabled={busy === o.id} onClick={() => onCancel([o])}
                                className="min-h-[40px] px-3 rounded-xl border-[1.5px] border-gray-200 text-xs font-bold text-rose-800 bg-white active:scale-95 disabled:opacity-50">
                          Cancel
                        </button>
                      )}
                    </div>
                  )}

                  {(tab === 'stuck' || tab === 'with_courier') && (
                    <button type="button" onClick={() => onGoTab?.('delivery')}
                            className="mt-2.5 min-h-[40px] px-3 rounded-xl border-[1.5px] border-gray-200 text-xs font-bold text-gray-800 bg-white active:scale-95">
                      {tab === 'stuck' ? 'Fix in Delivery' : 'Track in Delivery'}
                    </button>
                  )}

                  {tab === 'to_check' && (
                    <div className="flex gap-2 mt-2.5">
                      {razorpayConnected && !o.awb && (
                        <button type="button" disabled={busy === o.id} onClick={() => onSendLink(o)}
                                className="min-h-[40px] px-3 rounded-xl border-[1.5px] border-gray-200 text-xs font-bold text-gray-800 bg-white active:scale-95 disabled:opacity-50 inline-flex items-center gap-1.5">
                          <Link2 size={13} /> {busy === o.id ? 'Creating…' : o.payment_link_id ? 'Resend link' : 'Send payment link'}
                        </button>
                      )}
                      {phone && (
                        <a href={`https://wa.me/91${phone}`} target="_blank" rel="noopener noreferrer"
                           className="min-h-[40px] px-3 rounded-xl border border-emerald-200 bg-emerald-50 text-xs font-bold text-emerald-700 active:scale-95 inline-flex items-center gap-1.5">
                          <MessageCircle size={13} /> Chat
                        </a>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {tab === 'with_rider' && ticked.length > 0 && (
        <div className="space-y-1.5">
          <button type="button" disabled={Boolean(busy)} onClick={() => onMarkDelivered(ticked.map((r) => r.order))}
                  className="w-full min-h-[52px] rounded-2xl text-white text-[15px] font-extrabold inline-flex items-center justify-center gap-2 active:scale-[0.99] disabled:opacity-60"
                  style={{ backgroundColor: themeColor }}>
            {busy ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
            Mark {ticked.length} delivered · {rs(tickedSum)}
          </button>
          <p className="text-xs text-gray-500 text-center">Cash on delivery counts as paid once an order is delivered.</p>
        </div>
      )}

      {listPartial && (
        <p className="text-[11px] text-gray-500 text-center">Some older orders didn&rsquo;t load, so a list may be missing a few. The totals above count all of them.</p>
      )}
    </div>
  );
}

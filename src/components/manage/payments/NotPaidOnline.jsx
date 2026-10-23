import { useState } from 'react';
import { ChevronLeft, MessageCircle, Link2, Loader2, Banknote } from 'lucide-react';
import { formatINR } from '../../../utils/currency';
import { NOT_PAID_RECENT_DAYS } from '../../../utils/paymentsMetrics';

/**
 * Payments → Money → Online payments that didn't go through.
 *
 * The buyer chose to pay online and left before paying. That is not money
 * they owe, so these orders are kept out of sales and out of Coming in
 * (classifyOrder: payment_incomplete). Here the shop can still save the sale -
 * a payment link, or cash on delivery once the buyer agrees - or clear the old
 * ones away.
 */

const rs = (n) => formatINR(Math.round(Number(n) || 0));
const when = (o, d) => {
  if (d === 0) return 'today';
  if (d === 1) return 'yesterday';
  const t = Date.parse(o?.created_at);
  return Number.isNaN(t) ? '' : new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};
const itemsText = (o) => (Array.isArray(o?.items) ? o.items : [])
  .map((i) => `${i?.name || 'Item'}${i?.qty > 1 ? ` × ${i.qty}` : ''}`).join(', ');

export default function NotPaidOnline({
  totals, lists, themeColor = '#0d9488', razorpayConnected = false, busy = '', listPartial = false,
  onBack, onSendLink, onSwitchToCod, onCancel,
}) {
  const [tab, setTab] = useState(totals.recent.count > 0 || totals.older.count === 0 ? 'recent' : 'older');
  const rows = lists[tab] || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 -ml-2">
        <button type="button" onClick={onBack} aria-label="Back to Payments"
                className="w-11 h-11 flex items-center justify-center text-gray-700 rounded-xl hover:bg-gray-100">
          <ChevronLeft size={22} />
        </button>
        <h2 className="text-lg font-extrabold text-gray-900">Payment didn&rsquo;t go through</h2>
      </div>

      <section className="rounded-2xl border border-gray-100 bg-white shadow-sm p-4">
        <p className="flex items-baseline gap-2">
          <span className="text-[26px] font-extrabold text-gray-700 tabular-nums">{totals.all.count} {totals.all.count === 1 ? 'order' : 'orders'}</span>
          <span className="text-[13px] text-gray-500">{rs(totals.all.amount)}</span>
        </p>
        <p className="text-[13px] text-gray-600 mt-1.5 leading-relaxed">
          These buyers chose to pay online and left before paying. It isn&rsquo;t money they owe you, so it is kept out of your sales and out of <b>Coming in</b>.
        </p>
      </section>

      <div className="flex gap-2" role="tablist" aria-label="How old">
        {[['recent', `Last ${NOT_PAID_RECENT_DAYS} days`], ['older', 'Older']].map(([k, label]) => {
          const active = k === tab;
          return (
            <button key={k} type="button" role="tab" aria-selected={active} onClick={() => setTab(k)}
                    className={['min-h-[36px] px-3.5 rounded-full text-xs border transition',
                      active ? 'bg-gray-900 border-gray-900 text-white font-bold' : 'bg-white border-gray-200 text-gray-600 font-semibold'].join(' ')}>
              {label} · {totals[k].count}
            </button>
          );
        })}
      </div>

      {tab === 'recent' && rows.length > 0 && (
        <p className="text-[13px] text-gray-700">Still worth a nudge: send a payment link, or switch it to cash on delivery once the buyer agrees on WhatsApp.</p>
      )}

      <section className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
        {rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-gray-400">Nothing here.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {rows.map(({ order: o, amount, ageDays }) => {
              const phone = String(o.customer_phone || '').replace(/\D/g, '').slice(-10);
              const items = itemsText(o);
              return (
                <li key={o.id} className="px-4 py-3.5 space-y-2.5">
                  <div className="flex justify-between items-baseline gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-gray-900 truncate">{o.customer_name || 'Customer'}</p>
                      <p className="text-xs text-gray-500 truncate">{when(o, ageDays)}{items ? ` · ${items}` : ''}</p>
                    </div>
                    <p className="text-sm font-extrabold text-gray-900 tabular-nums flex-shrink-0">{rs(amount)}</p>
                  </div>
                  {o.payment_link_id && (
                    <p className="text-[11px] font-bold text-indigo-700 inline-flex items-center gap-1"><Link2 size={11} /> Payment link sent · not paid yet</p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {razorpayConnected && (
                      <button type="button" disabled={busy === o.id} onClick={() => onSendLink(o)}
                              className="min-h-[40px] px-3 rounded-xl border-[1.5px] text-xs font-bold bg-white active:scale-95 disabled:opacity-50 inline-flex items-center gap-1.5"
                              style={{ borderColor: themeColor, color: themeColor }}>
                        <Link2 size={13} /> {busy === o.id ? 'Creating…' : o.payment_link_id ? 'Resend link' : 'Send payment link'}
                      </button>
                    )}
                    <button type="button" disabled={busy === o.id} onClick={() => onSwitchToCod(o)}
                            className="min-h-[40px] px-3 rounded-xl border-[1.5px] border-gray-200 text-xs font-bold text-gray-800 bg-white active:scale-95 disabled:opacity-50 inline-flex items-center gap-1.5">
                      <Banknote size={13} /> Switch to COD
                    </button>
                    {phone && (
                      <a href={`https://wa.me/91${phone}`} target="_blank" rel="noopener noreferrer"
                         className="min-h-[40px] px-3 rounded-xl border border-emerald-200 bg-emerald-50 text-xs font-bold text-emerald-700 active:scale-95 inline-flex items-center gap-1.5">
                        <MessageCircle size={13} /> Chat
                      </a>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {tab === 'older' && rows.length > 0 && (
        <section className="flex items-center gap-3 px-4 py-3.5 rounded-2xl border-[1.5px] border-dashed border-gray-300">
          <span className="flex-grow min-w-0">
            <span className="block text-sm font-bold text-gray-900">{rows.length} older than {NOT_PAID_RECENT_DAYS} days</span>
            <span className="block text-xs text-gray-600">They are unlikely to pay now. Cancel them so your lists stay clean.</span>
          </span>
          <button type="button" disabled={Boolean(busy)} onClick={() => onCancel(rows.map((r) => r.order))}
                  className="flex-shrink-0 min-h-[44px] px-3.5 rounded-xl border-[1.5px] border-gray-200 bg-white text-[13px] font-bold text-rose-800 active:scale-95 disabled:opacity-50 inline-flex items-center gap-1.5">
            {busy === 'bulk' && <Loader2 size={14} className="animate-spin" />} Cancel {rows.length}
          </button>
        </section>
      )}

      {listPartial && (
        <p className="text-[11px] text-gray-500 text-center">Some older orders didn&rsquo;t load, so this list may be missing a few.</p>
      )}
    </div>
  );
}

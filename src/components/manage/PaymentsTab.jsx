import { useState, useEffect, useCallback, useMemo } from 'react';
import { RefreshCw, Wallet, Clock, MessageCircle, Check, Link2 } from 'lucide-react';
import { fetchOrders, setOrderPaid } from '../../utils/orderService';
import { formatINR } from '../../utils/currency';
import { buildPayments, KIND_LABEL } from '../../utils/paymentsLedger';
import { createPaymentLink, checkPaymentLinks, paymentLinkMessage } from '../../utils/paymentLinks';

const RANGES = [{ days: 1, label: 'Today' }, { days: 7, label: '7 days' }, { days: 30, label: '30 days' }];

const REASON = {
  link_pending:  { label: 'Payment link sent, not paid yet', cls: 'bg-indigo-50 text-indigo-700 border-indigo-100' },
  incomplete:    { label: 'Payment not completed',           cls: 'bg-rose-50 text-rose-700 border-rose-100' },
  cod_delivered: { label: 'Delivered, COD not marked collected', cls: 'bg-amber-50 text-amber-800 border-amber-100' },
};

const KIND_CHIP = {
  online:        'bg-emerald-100 text-emerald-700',
  link:          'bg-emerald-100 text-emerald-700',
  cod_collected: 'bg-sky-100 text-sky-700',
  marked:        'bg-gray-100 text-gray-600',
};

function fmtWhen(ms, timeKnown) {
  try {
    const d = new Date(ms);
    const day = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    return timeKnown ? `${day}, ${d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}` : `${day} (order date)`;
  } catch {
    return '';
  }
}

function dayLabel(at) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - at) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return new Date(at).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}

function Tile({ label, value, sub, tone = 'text-gray-900' }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-3.5 py-3">
      <p className={`text-2xl font-extrabold leading-none tabular-nums ${tone}`}>{value}</p>
      <p className="text-[11px] font-semibold text-gray-500 mt-1.5">{label}</p>
      {sub && <p className="text-[10.5px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

/**
 * PaymentsTab — the store's money, separate from order status.
 * What came in (online and COD) per day, what COD is still out, and the orders
 * whose payment needs the seller: unfinished online payments, open payment
 * links, and delivered COD not yet marked collected.
 */
export default function PaymentsTab({ slug, pin, themeColor = '#0d9488', storeName = '', razorpayConnected = false }) {
  const [orders, setOrders] = useState(null);   // null = loading
  const [range, setRange]   = useState(1);
  const [busy, setBusy]     = useState('');     // order id, or 'all'
  const [note, setNote]     = useState('');

  const load = useCallback(async () => { setOrders(await fetchOrders(slug, pin)); }, [slug, pin]);

  // Customers may have paid a link since the last visit: ask Razorpay once on open.
  useEffect(() => {
    let alive = true;
    (async () => {
      const first = await fetchOrders(slug, pin);
      if (!alive) return;
      setOrders(first);
      const open = first.filter((o) => !o.paid && o.payment_link_id).map((o) => o.id);
      if (!razorpayConnected || !open.length) return;
      try {
        const results = await checkPaymentLinks(slug, pin, open);
        if (alive && results.some((r) => r.status === 'paid')) setOrders(await fetchOrders(slug, pin));
      } catch { /* the list is still correct as of the last check */ }
    })();
    return () => { alive = false; };
  }, [slug, pin, razorpayConnected]);

  const p = useMemo(() => (orders ? buildPayments(orders, { days: range }) : null), [orders, range]);

  async function markCollected(o) {
    setBusy(o.id); setNote('');
    await setOrderPaid(slug, pin, o.id, true);
    await load();
    setBusy('');
    setNote(`Marked ${formatINR(o.total)} from ${o.customer_name || 'the customer'} as collected.`);
  }

  async function sendLink(o) {
    setBusy(o.id); setNote('');
    // Open the tab inside the tap: browsers block window.open after an await.
    const win = window.open('', '_blank');
    if (win) win.opener = null;
    try {
      const r = await createPaymentLink(slug, pin, o.id);
      if (r.paid) {
        if (win) win.close();
        setNote('That order is already paid.');
        await load();
        return;
      }
      const phone = String(o.customer_phone || '').replace(/\D/g, '').slice(-10);
      const text = paymentLinkMessage({ customerName: o.customer_name, storeName, total: o.total, url: r.url });
      const wa = `https://wa.me/${phone ? `91${phone}` : ''}?text=${encodeURIComponent(text)}`;
      if (win) win.location.href = wa; else window.location.href = wa;
      await load();
    } catch (e) {
      if (win) win.close();
      setNote(e.message || 'Could not create the payment link.');
    } finally {
      setBusy('');
    }
  }

  async function checkLinks(list) {
    setBusy(list.length === 1 ? list[0].id : 'all'); setNote('');
    try {
      const results = await checkPaymentLinks(slug, pin, list.map((o) => o.id));
      const paid = results.filter((r) => r.status === 'paid').length;
      setNote(paid ? `${paid} payment${paid === 1 ? '' : 's'} confirmed by Razorpay.` : 'Not paid yet.');
      await load();
    } catch (e) {
      setNote(e.message || 'Could not check with Razorpay.');
    } finally {
      setBusy('');
    }
  }

  if (!p) {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-20 rounded-2xl bg-white border border-gray-100 animate-pulse" />)}
        </div>
        <div className="h-40 rounded-2xl bg-white border border-gray-100 animate-pulse" />
      </div>
    );
  }

  const rangeLabel = RANGES.find((r) => r.days === range)?.label.toLowerCase();
  const openLinks = p.attention.filter((a) => a.reason === 'link_pending').map((a) => a.order);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold text-gray-900 flex items-center gap-2">
            <Wallet size={18} style={{ color: themeColor }} /> Payments
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">Money received, separate from order status</p>
        </div>
        <button type="button" onClick={load}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-600 border border-gray-200 rounded-xl px-3 py-2 hover:bg-gray-50 active:scale-95 transition">
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      <div className="flex gap-1.5" role="tablist" aria-label="Period">
        {RANGES.map((r) => {
          const active = r.days === range;
          return (
            <button key={r.days} type="button" role="tab" aria-selected={active} onClick={() => setRange(r.days)}
                    className={['px-3 py-1.5 rounded-full text-xs font-bold border transition',
                      active ? 'text-white border-transparent' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'].join(' ')}
                    style={active ? { backgroundColor: themeColor } : undefined}>
              {r.label}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Tile label={`Received ${rangeLabel === 'today' ? 'today' : `in ${rangeLabel}`}`} value={formatINR(Math.round(p.received.total))}
              sub={`${formatINR(Math.round(p.received.online))} online · ${formatINR(Math.round(p.received.cod))} COD`} tone="text-emerald-700" />
        <Tile label="COD still to collect" value={formatINR(Math.round(p.codDue.amount))}
              sub={`${p.codDue.count} order${p.codDue.count === 1 ? '' : 's'}, all dates`} tone="text-amber-700" />
        <Tile label="Online (Razorpay)" value={formatINR(Math.round(p.received.online))}
              sub={`${p.received.onlineCount} payment${p.received.onlineCount === 1 ? '' : 's'}`} />
        <Tile label="COD collected" value={formatINR(Math.round(p.received.cod))}
              sub={p.received.otherCount ? `+ ${formatINR(Math.round(p.received.other))} marked paid by you` : `${p.received.codCount} order${p.received.codCount === 1 ? '' : 's'}`} />
      </div>

      {note && (
        <p className="text-xs font-semibold text-gray-700 bg-white border border-gray-100 rounded-xl px-3 py-2.5" role="status">{note}</p>
      )}

      {/* Needs attention */}
      <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-100">
          <p className="text-sm font-extrabold text-gray-900">Needs attention {p.attention.length > 0 && <span className="text-gray-400">({p.attention.length})</span>}</p>
          {razorpayConnected && openLinks.length > 1 && (
            <button type="button" disabled={busy === 'all'} onClick={() => checkLinks(openLinks)}
                    className="text-[11px] font-bold text-indigo-700 hover:underline disabled:opacity-50">
              {busy === 'all' ? 'Checking…' : 'Check all links'}
            </button>
          )}
        </div>
        {p.attention.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-gray-400">Nothing to chase. Every open order is COD in transit or paid.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {p.attention.map(({ order: o, reason, amount }) => {
              const r = REASON[reason];
              const phone = String(o.customer_phone || '').replace(/\D/g, '').slice(-10);
              const canLink = razorpayConnected && !o.awb && reason !== 'cod_delivered';
              return (
                <li key={o.id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-bold text-gray-900 truncate">{o.customer_name || 'Customer'}</p>
                    <p className="text-sm font-extrabold text-gray-900 tabular-nums flex-shrink-0">{formatINR(amount)}</p>
                  </div>
                  <span className={`inline-block mt-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${r.cls}`}>{r.label}</span>
                  <div className="flex flex-wrap gap-2 mt-2.5">
                    {reason === 'cod_delivered' && (
                      <button type="button" disabled={busy === o.id} onClick={() => markCollected(o)}
                              className="inline-flex items-center gap-1.5 text-xs font-bold text-white px-3 py-1.5 rounded-lg active:scale-95 disabled:opacity-50"
                              style={{ backgroundColor: themeColor }}>
                        <Check size={13} /> {busy === o.id ? 'Saving…' : 'Mark collected'}
                      </button>
                    )}
                    {reason === 'link_pending' && razorpayConnected && (
                      <button type="button" disabled={busy === o.id} onClick={() => checkLinks([o])}
                              className="inline-flex items-center gap-1.5 text-xs font-bold text-indigo-700 border border-indigo-200 bg-indigo-50 px-3 py-1.5 rounded-lg active:scale-95 disabled:opacity-50">
                        <RefreshCw size={12} /> {busy === o.id ? 'Checking…' : 'Check payment'}
                      </button>
                    )}
                    {canLink && (
                      <button type="button" disabled={busy === o.id} onClick={() => sendLink(o)}
                              className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-700 border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50 active:scale-95 disabled:opacity-50">
                        <Link2 size={12} /> {reason === 'link_pending' ? 'Resend link' : 'Send payment link'}
                      </button>
                    )}
                    {phone && (
                      <a href={`https://wa.me/91${phone}`} target="_blank" rel="noopener noreferrer"
                         className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 border border-emerald-200 bg-emerald-50 px-3 py-1.5 rounded-lg hover:bg-emerald-100 active:scale-95">
                        <MessageCircle size={12} /> Chat
                      </a>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {!razorpayConnected && (
          <p className="px-4 py-2.5 text-[11px] text-gray-500 bg-gray-50 border-t border-gray-100">
            Connect Razorpay in Settings to send COD customers a link to pay online.
          </p>
        )}
      </div>

      {/* Daily money */}
      <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
        <p className="px-4 py-3 text-sm font-extrabold text-gray-900 border-b border-gray-100">Daily money</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10.5px] uppercase tracking-wide text-gray-400">
                <th className="text-left font-bold px-4 py-2">Day</th>
                <th className="text-right font-bold px-3 py-2">Online</th>
                <th className="text-right font-bold px-3 py-2">COD</th>
                <th className="text-right font-bold px-4 py-2">Total</th>
              </tr>
            </thead>
            <tbody>
              {p.ledger.map((d) => (
                <tr key={d.key} className="border-t border-gray-100">
                  <td className="px-4 py-2.5 text-gray-700 whitespace-nowrap">{dayLabel(d.at)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">{d.online ? formatINR(Math.round(d.online)) : '—'}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">{d.cod ? formatINR(Math.round(d.cod)) : '—'}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-extrabold text-gray-900">{d.total ? formatINR(Math.round(d.total)) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {p.received.other > 0 && (
          <p className="px-4 py-2 text-[11px] text-gray-400 border-t border-gray-100">
            Totals include {formatINR(Math.round(p.received.other))} you marked paid without a method (UPI, bank transfer).
          </p>
        )}
      </div>

      {/* Recent payments */}
      <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
        <p className="px-4 py-3 text-sm font-extrabold text-gray-900 border-b border-gray-100">Payments received {rangeLabel === 'today' ? 'today' : `in ${rangeLabel}`}</p>
        {p.recent.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-gray-400">No payments in this period yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {p.recent.map(({ order: o, kind, at, amount, timeKnown }) => (
              <li key={o.id} className="px-4 py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-gray-900 truncate">{o.customer_name || 'Customer'}</p>
                  <p className="text-[11px] text-gray-400 inline-flex items-center gap-1"><Clock size={10} /> {fmtWhen(at, timeKnown)}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-extrabold text-gray-900 tabular-nums">{formatINR(amount)}</p>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${KIND_CHIP[kind] || 'bg-gray-100 text-gray-600'}`}>{KIND_LABEL[kind]}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

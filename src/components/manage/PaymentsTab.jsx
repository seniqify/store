import { useState, useEffect, useCallback, useMemo } from 'react';
import { RefreshCw, Wallet, Clock, MessageCircle, Link2, BadgeCheck } from 'lucide-react';
import { fetchOrders, fetchOrderFacts } from '../../utils/orderService';
import { formatINR } from '../../utils/currency';
import { buildPaymentsLists, KIND_LABEL, isAtDetailedCap, DETAILED_ORDER_CAP } from '../../utils/paymentsLedger';
import { buildPaymentsMetrics, PAYMENT_RANGES, periodKeys } from '../../utils/paymentsMetrics';
import { createPaymentLink, checkPaymentLinks, reconcileOnlinePayments, findPaymentOrphans, paymentLinkMessage } from '../../utils/paymentLinks';
import { syncDeliveryStatuses } from '../../utils/shippingConnect';
import { prettyStatus } from '../../utils/deliveryStatus';

const RANGES = PAYMENT_RANGES;

const REASON = {
  link_pending:   { label: 'Payment link sent, not paid yet', cls: 'bg-indigo-50 text-indigo-700 border-indigo-100' },
  incomplete:     { label: 'Payment not completed',           cls: 'bg-rose-50 text-rose-700 border-rose-100' },
  unconfirmed:    { label: 'Shipped, Razorpay payment not confirmed yet', cls: 'bg-amber-50 text-amber-800 border-amber-100' },
  delivery_issue: { label: 'Delivery problem',                cls: 'bg-amber-50 text-amber-800 border-amber-100' },
};

const KIND_CHIP = {
  online:        'bg-emerald-100 text-emerald-700',
  link:          'bg-emerald-100 text-emerald-700',
  cod_collected: 'bg-sky-100 text-sky-700',
  marked:        'bg-gray-100 text-gray-600',
};

function fmtWhen(ms) {
  try {
    const d = new Date(ms);
    const day = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    return `${day}, ${d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}`;
  } catch {
    return '';
  }
}

/**
 * Label a merchant civil day. The key is already the merchant's own date, so it
 * is read back at midday UTC purely to format it - no timezone is applied to it
 * a second time.
 */
function dayLabel(key, todayKey, yesterdayKey) {
  if (key === todayKey) return 'Today';
  if (key === yesterdayKey) return 'Yesterday';
  const t = Date.parse(`${key}T12:00:00Z`);
  if (Number.isNaN(t)) return key;
  return new Date(t).toLocaleDateString('en-IN', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
  });
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
 * PaymentsTab — the store's money, separate from order status, kept up to date
 * automatically. Opening the tab refreshes courier statuses and asks Razorpay
 * about unconfirmed payments; a scheduled sweep does the same every 30 minutes
 * (status-sweep). COD becomes collected on delivery and returned when it comes
 * back, without anyone marking it.
 */
export default function PaymentsTab({ slug, pin, themeColor = '#0d9488', storeName = '', razorpayConnected = false, hasCourier = false }) {
  // TWO feeds, kept apart on purpose.
  //  facts  - get_store_order_facts: UNCAPPED, PII-free. EVERY money total.
  //  orders - get_store_orders: newest 500, detailed. The two worklists only,
  //           because they show a customer's name and hand off to WhatsApp.
  // A sum over the capped feed is a wrong number with a confident face, so the
  // two are never mixed.
  const [factsResult, setFactsResult] = useState(null);   // { ok, data, reason }
  const [rawCount, setRawCount] = useState(0);
  const [loadedAt, setLoadedAt] = useState(null);
  const [orders, setOrders]   = useState(null);   // null = loading
  const [range, setRange]     = useState(1);
  const [busy, setBusy]       = useState('');     // order id being actioned
  const [note, setNote]       = useState('');
  const [syncing, setSyncing] = useState(false);
  const [checkedAt, setCheckedAt] = useState(null);
  const [orphans, setOrphans] = useState([]);   // paid on Razorpay, order never saved

  const load = useCallback(async () => {
    const [facts, detailed] = await Promise.all([
      fetchOrderFacts(slug, pin), fetchOrders(slug, pin, { includeAbandoned: true }),
    ]);
    setFactsResult(facts);
    setRawCount(detailed.length);
    setOrders(detailed);
    setLoadedAt(Date.now());
  }, [slug, pin]);

  // Show what we have at once, then refresh from couriers and Razorpay and re-read.
  const refresh = useCallback(async (alive = () => true) => {
    const [firstFacts, first] = await Promise.all([
      fetchOrderFacts(slug, pin), fetchOrders(slug, pin, { includeAbandoned: true }),
    ]);
    if (!alive()) return;
    setFactsResult(firstFacts);
    setRawCount(first.length);
    setOrders(first);
    setLoadedAt(Date.now());
    const jobs = [];
    if (hasCourier) jobs.push(syncDeliveryStatuses(slug, pin));
    if (razorpayConnected) {
      const openLinks = first.filter((o) => !o.paid && o.payment_link_id).map((o) => o.id);
      if (openLinks.length) jobs.push(checkPaymentLinks(slug, pin, openLinks).catch(() => []));
      if (first.some((o) => !o.paid && String(o.payment_method).toLowerCase() === 'online' && !o.payment_ref)) {
        jobs.push(reconcileOnlinePayments(slug, pin).catch(() => []));
      }
      jobs.push(findPaymentOrphans(slug, pin).then((list) => { if (alive()) setOrphans(list); }));
    }
    if (!jobs.length) { setCheckedAt(new Date()); return; }
    setSyncing(true);
    await Promise.allSettled(jobs);
    if (!alive()) return;
    const [freshFacts, fresh] = await Promise.all([
      fetchOrderFacts(slug, pin), fetchOrders(slug, pin, { includeAbandoned: true }),
    ]);
    setFactsResult(freshFacts);
    setRawCount(fresh.length);
    setOrders(fresh);
    setLoadedAt(Date.now());
    setSyncing(false);
    setCheckedAt(new Date());
  }, [slug, pin, hasCourier, razorpayConnected]);

  useEffect(() => {
    let live = true;
    refresh(() => live);
    return () => { live = false; };
  }, [refresh]);

  // Accounting: built ONLY from a successful facts read. On failure the rows
  // are empty and this computes zeroes, which is why the render below refuses
  // to show them.
  const acc = useMemo(
    () => buildPaymentsMetrics(factsResult?.ok ? factsResult.data : [], {
      now: loadedAt, days: range,
    }),
    [factsResult, loadedAt, range],
  );
  const accountingOk = factsResult?.ok === true;
  // Worklists: detailed rows, capped, never summed.
  const lists = useMemo(
    () => buildPaymentsLists(orders || [], { periodKeys: periodKeys(loadedAt, range) }),
    [orders, loadedAt, range],
  );
  const listsCapped = isAtDetailedCap(rawCount);

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

  if (orders === null || factsResult === null) {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-20 rounded-2xl bg-white border border-gray-100 animate-pulse" />)}
        </div>
        <div className="h-40 rounded-2xl bg-white border border-gray-100 animate-pulse" />
      </div>
    );
  }

  const yesterdayKey = periodKeys(loadedAt, 2)[0] ?? null;
  const rangeLabel = RANGES.find((r) => r.days === range)?.label.toLowerCase();
  const inWords = rangeLabel === 'today' ? 'today' : `in ${rangeLabel}`;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold text-gray-900 flex items-center gap-2">
            <Wallet size={18} style={{ color: themeColor }} /> Payments
          </h2>
          <p className="text-xs text-gray-400 mt-0.5 inline-flex items-center gap-1" role="status">
            {syncing ? (
              <><RefreshCw size={11} className="animate-spin" /> Updating from {[hasCourier && 'courier', razorpayConnected && 'Razorpay'].filter(Boolean).join(' and ')}…</>
            ) : checkedAt ? (
              <><BadgeCheck size={12} className="text-emerald-600" /> Up to date · {checkedAt.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</>
            ) : 'Money received, updated automatically'}
          </p>
        </div>
        <button type="button" onClick={() => refresh()} disabled={syncing}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-600 border border-gray-200 rounded-xl px-3 py-2 hover:bg-gray-50 active:scale-95 transition disabled:opacity-50">
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

      {/* Money. A failed read shows a retry, never a row of zeroes - the
          worklists below stay usable either way. */}
      {!accountingOk ? (
        <div className="rounded-2xl border border-amber-100 bg-amber-50/60 px-4 py-3.5 flex items-center gap-3" role="alert">
          <Wallet size={18} className="text-amber-500 flex-shrink-0" />
          <div className="min-w-0 flex-grow">
            <p className="text-sm font-bold text-gray-900">Money figures unavailable</p>
            <p className="text-xs text-gray-500 mt-0.5">Your payments are safe &mdash; this screen couldn&rsquo;t reach them.</p>
          </div>
          <button type="button" onClick={() => refresh()}
                  className="flex-shrink-0 text-xs font-bold px-3 py-2 rounded-xl text-white active:scale-[0.98] transition-transform"
                  style={{ backgroundColor: themeColor }}>
            Try again
          </button>
        </div>
      ) : (<>
      <div className="grid grid-cols-2 gap-3">
        {/* FLOWS - dated by the event itself, and only inside the period. */}
        <Tile label={`Received ${inWords}`} value={formatINR(Math.round(acc.period.received.amount))}
              sub={`${acc.period.received.count} payment${acc.period.received.count === 1 ? '' : 's'} with a recorded date`}
              tone="text-emerald-700" />
        <Tile label={`Returned ${inWords}`} value={formatINR(Math.round(acc.period.returned.amount))}
              sub={`${acc.period.returned.count} order${acc.period.returned.count === 1 ? '' : 's'} came back`}
              tone={acc.period.returned.count ? 'text-rose-700' : 'text-gray-900'} />
        {/* BALANCES - current state. These do not move when the period changes. */}
        <Tile label="Still to collect" value={formatINR(Math.round(acc.balances.outstanding.amount))}
              sub={`${acc.balances.outstanding.count} order${acc.balances.outstanding.count === 1 ? '' : 's'} · all time`}
              tone="text-amber-700" />
        <Tile label="Written off" value={formatINR(Math.round(acc.balances.writtenOff.amount))}
              sub={`${acc.balances.writtenOff.count} returned · all time`} />
      </div>

      {/* Collected money whose payment date was never recorded. Kept out of
          every period on purpose: we do not know when it arrived, and saying
          otherwise would put real money in a month it may not belong to. */}
      {acc.balances.undatedCollected.amount > 0 && (
        <p className="text-[11px] text-gray-500 bg-white border border-gray-100 rounded-xl px-3 py-2.5">
          <span className="font-bold text-gray-700">{formatINR(Math.round(acc.balances.undatedCollected.amount))} collected</span>
          {' '}&mdash; payment date not recorded, so it is not in any period above
          ({acc.balances.undatedCollected.count} order{acc.balances.undatedCollected.count === 1 ? '' : 's'}).
        </p>
      )}

      {/* All-time reconciliation. Quiet, and deliberately not a fifth headline. */}
      <div className="rounded-2xl border border-gray-100 bg-white shadow-sm px-4 py-3">
        <p className="text-[10.5px] font-bold uppercase tracking-widest text-gray-400">All time</p>
        <dl className="mt-2 space-y-1.5 text-[12.5px]">
          <div className="flex justify-between gap-3"><dt className="text-gray-500">Collected</dt>
            <dd className="font-bold text-gray-800 tabular-nums">{formatINR(Math.round(acc.balances.collected.amount))}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-gray-500">Still to collect</dt>
            <dd className="font-bold text-gray-800 tabular-nums">{formatINR(Math.round(acc.balances.outstanding.amount))}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-gray-500">Written off</dt>
            <dd className="font-bold text-gray-800 tabular-nums">{formatINR(Math.round(acc.balances.writtenOff.amount))}</dd></div>
          <div className="flex justify-between gap-3 border-t border-gray-100 pt-1.5"><dt className="font-bold text-gray-700">Gross sales</dt>
            <dd className="font-extrabold text-gray-900 tabular-nums">{formatINR(Math.round(acc.balances.grossSales))}</dd></div>
        </dl>
        <p className="text-[10.5px] text-gray-400 mt-2">
          {formatINR(Math.round(acc.channels.cod.amount))} cash on delivery ·{' '}
          {formatINR(Math.round(acc.channels.online.amount))} online ·{' '}
          {formatINR(Math.round(acc.channels.other.amount))} recorded another way
        </p>
      </div>
      </>)}

      {note && (
        <p className="text-xs font-semibold text-gray-700 bg-white border border-gray-100 rounded-xl px-3 py-2.5" role="status">{note}</p>
      )}

      {/* Money without an order: paid on Razorpay, but the order never saved */}
      {orphans.length > 0 && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 shadow-sm overflow-hidden" role="alert">
          <p className="px-4 py-3 text-sm font-extrabold text-rose-800 border-b border-rose-100">
            Paid on Razorpay, but the order didn’t save ({orphans.length})
          </p>
          <ul className="divide-y divide-rose-100">
            {orphans.map((x) => {
              const phone = String(x.cart?.customer_phone || '').replace(/\D/g, '').slice(-10);
              return (
                <li key={x.payment_id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-bold text-gray-900 truncate">{x.cart?.customer_name || 'Customer'}</p>
                    <p className="text-sm font-extrabold text-gray-900 tabular-nums flex-shrink-0">{formatINR(x.amount)}</p>
                  </div>
                  <p className="text-[11px] text-rose-800 mt-0.5">
                    {fmtWhen(new Date(x.paid_at).getTime(), true)} · Razorpay {x.payment_id}
                  </p>
                  <p className="text-xs text-gray-700 mt-1 leading-relaxed">
                    {x.cart ? <>Cart: {x.cart.items}</> : 'No matching cart found. Check the payment in your Razorpay dashboard.'}
                  </p>
                  <p className="text-[11px] text-gray-500 mt-1">The customer’s money arrived. Contact them to confirm their order and address.</p>
                  {phone && (
                    <a href={`https://wa.me/91${phone}`} target="_blank" rel="noopener noreferrer"
                       className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 border border-emerald-200 bg-white px-3 py-1.5 rounded-lg hover:bg-emerald-50 active:scale-95">
                      <MessageCircle size={12} /> Chat
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Needs attention: only what a system cannot finish on its own */}
      <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
        <p className="px-4 py-3 text-sm font-extrabold text-gray-900 border-b border-gray-100">
          Needs attention {lists.attention.length > 0 && <span className="text-gray-400">({lists.attention.length})</span>}
        </p>
        {lists.attention.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-gray-400">Nothing to chase. Payments and deliveries are on track.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {lists.attention.map(({ order: o, reason, amount }) => {
              const r = REASON[reason];
              const phone = String(o.customer_phone || '').replace(/\D/g, '').slice(-10);
              const canLink = razorpayConnected && !o.awb && reason !== 'delivery_issue';
              return (
                <li key={`${o.id}-${reason}`} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-bold text-gray-900 truncate">{o.customer_name || 'Customer'}</p>
                    <p className="text-sm font-extrabold text-gray-900 tabular-nums flex-shrink-0">{formatINR(amount)}</p>
                  </div>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${r.cls}`}>{r.label}</span>
                    {reason === 'delivery_issue' && (
                      <span className="text-[11px] text-gray-500">Courier: {prettyStatus(o.shipment_status)}</span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2 mt-2.5">
                    {canLink && (
                      <button type="button" disabled={busy === o.id} onClick={() => sendLink(o)}
                              className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-700 border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50 active:scale-95 disabled:opacity-50">
                        <Link2 size={12} /> {busy === o.id ? 'Creating…' : reason === 'link_pending' ? 'Resend link' : 'Send payment link'}
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
      </div>

      {/* Daily money */}
      <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
        <p className="px-4 py-3 text-sm font-extrabold text-gray-900 border-b border-gray-100">Daily money</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10.5px] uppercase tracking-wide text-gray-400">
                <th className="text-left font-bold px-4 py-2">Day</th>
                <th className="text-right font-bold px-3 py-2">Payments</th>
                <th className="text-right font-bold px-4 py-2">Received</th>
              </tr>
            </thead>
            <tbody>
              {[...acc.period.daily].reverse().map((d) => (
                <tr key={d.key} className="border-t border-gray-100">
                  <td className="px-4 py-2.5 text-gray-700 whitespace-nowrap">{dayLabel(d.key, acc.period.to, yesterdayKey)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-gray-700">{d.count || '—'}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-extrabold text-gray-900">{d.amount ? formatINR(Math.round(d.amount)) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="px-4 py-2 text-[11px] text-gray-400 border-t border-gray-100">
          Only payments with a recorded date appear here.
        </p>
      </div>

      {/* Recent payments */}
      <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
        <p className="px-4 py-3 text-sm font-extrabold text-gray-900 border-b border-gray-100">Payments received {inWords}</p>
        {lists.recent.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-gray-400">No payments in this period yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {lists.recent.map(({ order: o, kind, at, amount }) => (
              <li key={o.id} className="px-4 py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-gray-900 truncate">{o.customer_name || 'Customer'}</p>
                  <p className="text-[11px] text-gray-400 inline-flex items-center gap-1"><Clock size={10} /> {fmtWhen(at)}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-extrabold text-gray-900 tabular-nums">{formatINR(amount)}</p>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${KIND_CHIP[kind] || 'bg-gray-100 text-gray-600'}`}>{KIND_LABEL[kind]}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="px-4 py-2 text-[11px] text-gray-400 border-t border-gray-100">
          COD is counted as collected when the courier or your delivery marks it delivered, and as returned when it comes back. Nothing to mark.
          {listsCapped && ` This list reads your newest ${DETAILED_ORDER_CAP} orders; the totals above read all of them.`}
        </p>
      </div>
    </div>
  );
}

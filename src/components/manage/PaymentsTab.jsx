import { useState, useEffect, useCallback, useMemo } from 'react';
import { RefreshCw, Wallet, MessageCircle, BadgeCheck } from 'lucide-react';
import { fetchOrders, fetchOrderFacts, setOrderStatus, switchOrderToCod } from '../../utils/orderService';
import { formatINR } from '../../utils/currency';
import { buildPaymentsLists, buildMoneyLists, KIND_LABEL, isPartialList } from '../../utils/paymentsLedger';
import { buildMoneyHome, periodKeys } from '../../utils/paymentsMetrics';
import { returnsInsights } from '../../utils/returnsInsights';
import { isPaymentUnconfirmed } from '../../utils/orderState';
import { hasSales } from '../../utils/hisaabMetrics';
import { createPaymentLink, checkPaymentLinks, reconcileOnlinePayments, findPaymentOrphans, paymentLinkMessage } from '../../utils/paymentLinks';
import { syncDeliveryStatuses } from '../../utils/shippingConnect';
import MoneyHome from './payments/MoneyHome';
import ComingIn from './payments/ComingIn';
import NotPaidOnline from './payments/NotPaidOnline';
import LostToReturns from './payments/LostToReturns';
import HisaabTab from './hisaab/HisaabTab';

// Why a "Payment to check" order is waiting.
const REASON = {
  link_pending:   { label: 'Payment link sent, not paid yet', cls: 'bg-indigo-50 text-indigo-700 border-indigo-100' },
  incomplete:     { label: 'Payment not completed',           cls: 'bg-rose-50 text-rose-700 border-rose-100' },
  unconfirmed:    { label: 'Shipped, Razorpay payment not confirmed yet', cls: 'bg-amber-50 text-amber-800 border-amber-100' },
  delivery_issue: { label: 'Delivery problem',                cls: 'bg-amber-50 text-amber-800 border-amber-100' },
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
 * PaymentsTab — the store's money, separate from order status, kept up to date
 * automatically. Opening the tab refreshes courier statuses and asks Razorpay
 * about unconfirmed payments; a scheduled sweep does the same every 30 minutes
 * (status-sweep). COD becomes collected on delivery and returned when it comes
 * back, without anyone marking it.
 *
 * The Money screens (Payments redesign, founder-approved 2026-10-23): a home
 * screen (MoneyHome) and three it opens - Coming in, Online payments that
 * didn't go through, and Lost to returns. This component loads, refreshes and
 * runs every action; the screens only present.
 *
 * Hisaab (part 2) is the second section: what the shop keeps after every
 * cost. It reuses the detailed orders loaded here and loads its own book.
 */
export default function PaymentsTab({
  slug, pin, themeColor = '#0d9488', storeName = '', razorpayConnected = false, hasCourier = false, onGoTab,
  products = [], packagingCost = 0, deliveryCost = 0, store = {},
}) {
  // TWO feeds, kept apart on purpose.
  //  facts  - get_store_order_facts: UNCAPPED, PII-free. EVERY money total.
  //  orders - fetchOrders: every order, detailed. The two worklists only,
  //           because they show a customer's name and hand off to WhatsApp.
  // That feed pages and can come back partial; a sum over it could be a wrong
  // number with a confident face, so the two are never mixed.
  const [factsResult, setFactsResult] = useState(null);   // { ok, data, reason }
  const [listPartial, setListPartial] = useState(false);
  const [loadedAt, setLoadedAt] = useState(null);
  const [orders, setOrders]   = useState(null);   // null = loading
  const [range, setRange]     = useState(7);
  const [section, setSection] = useState('money');   // 'money' | 'hisaab'
  // Which Money screen: home, or one it opened (with an optional starting list).
  const [view, setView]       = useState({ name: 'home', tab: null });
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
    setListPartial(isPartialList(detailed));
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
    setListPartial(isPartialList(first));
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
    setListPartial(isPartialList(fresh));
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
    () => buildMoneyHome(factsResult?.ok ? factsResult.data : [], {
      now: loadedAt, days: range,
    }),
    [factsResult, loadedAt, range],
  );
  const accountingOk = factsResult?.ok === true;
  // Worklists: detailed rows, never summed.
  const lists = useMemo(
    () => buildPaymentsLists(orders || [], { periodKeys: periodKeys(loadedAt, range) }),
    [orders, loadedAt, range],
  );
  const money = useMemo(() => buildMoneyLists(orders || [], { now: loadedAt }), [orders, loadedAt]);
  const returned = useMemo(() => returnsInsights(money.returns), [money]);
  const received = useMemo(
    () => lists.recent.map((r) => ({ ...r, label: KIND_LABEL[r.kind] || 'Paid' })),
    [lists],
  );

  const open = (name, tab = null) => {
    setView({ name, tab });
    try { window.scrollTo({ top: 0 }); } catch { /* not in a browser */ }
  };
  // Hisaab opens a Money screen (Lost to returns, Coming in) in place.
  const openMoney = (name, tab = null) => { setSection('money'); open(name, tab); };
  // fetchOrders answers [] when it fails. With sales on record and no sale in
  // the detailed list, Hisaab would read "no sales": say it did not load.
  const salesMissing = accountingOk && acc.canonical.population.revenueOrders.count > 0 && !hasSales(orders);

  const reasonLabel = (o) => (isPaymentUnconfirmed(o) ? REASON.unconfirmed.label
    : o?.payment_link_id ? REASON.link_pending.label
    : 'Delivered, no payment recorded yet');

  // Status drives the money, as everywhere in Manage: a delivered cash-on-
  // delivery order is recorded as paid by orders_payment_automation.
  async function markDelivered(list) {
    if (!list.length) return;
    if (list.length > 1 && !window.confirm(`Mark ${list.length} orders delivered? Cash on delivery counts as paid.`)) return;
    setBusy(list.length > 1 ? 'bulk' : list[0].id); setNote('');
    for (const o of list) await setOrderStatus(slug, pin, o.id, 'delivered');
    setNote(list.length > 1 ? `${list.length} orders marked delivered.` : `${list[0].customer_name || 'The order'} marked delivered.`);
    setBusy('');
    await load();
  }

  async function cancelOrders(list) {
    if (!list.length) return;
    const msg = list.length > 1
      ? `Cancel ${list.length} orders? You can still open them in Orders.`
      : `Cancel ${list[0].customer_name || 'this'}'s order? You can still open it in Orders.`;
    if (!window.confirm(msg)) return;
    setBusy(list.length > 1 ? 'bulk' : list[0].id); setNote('');
    for (const o of list) await setOrderStatus(slug, pin, o.id, 'cancelled');
    setNote(list.length > 1 ? `${list.length} orders cancelled.` : 'Order cancelled.');
    setBusy('');
    await load();
  }

  async function switchToCod(o) {
    if (!window.confirm(`Switch ${o.customer_name || 'this'}'s order to cash on delivery? Do this only after the buyer agrees on WhatsApp.`)) return;
    setBusy(o.id); setNote('');
    const ok = await switchOrderToCod(slug, pin, o.id);
    setNote(ok ? 'Switched to cash on delivery. It is now in Coming in.' : 'Could not switch that order. It may already be paid or cancelled.');
    setBusy('');
    await load();
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

      <div className="grid grid-cols-2 border-b border-gray-200 -mt-1" role="tablist" aria-label="Payments sections">
        {[['money', 'Money'], ['hisaab', 'Hisaab']].map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={section === k}
                  onClick={() => { setSection(k); if (k === 'money') setView({ name: 'home', tab: null }); }}
                  className={['min-h-[48px] text-sm border-b-[3px] -mb-px transition-colors',
                    section === k ? 'font-extrabold' : 'font-semibold text-gray-500 border-transparent'].join(' ')}
                  style={section === k ? { color: themeColor, borderColor: themeColor } : undefined}>
            {label}
          </button>
        ))}
      </div>

      {note && section === 'money' && (
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

      {/* Hisaab: what the shop kept. It loads its own book. */}
      {section === 'hisaab' && (
        salesMissing ? (
          <div className="rounded-2xl border border-amber-100 bg-amber-50/60 px-4 py-3.5 flex items-center gap-3" role="alert">
            <Wallet size={18} className="text-amber-500 flex-shrink-0" />
            <div className="min-w-0 flex-grow">
              <p className="text-sm font-bold text-gray-900">Your orders didn&rsquo;t load</p>
              <p className="text-xs text-gray-500 mt-0.5">Hisaab needs them to work out what you kept.</p>
            </div>
            <button type="button" onClick={() => refresh()}
                    className="flex-shrink-0 text-xs font-bold px-3 py-2 rounded-xl text-white active:scale-[0.98] transition-transform"
                    style={{ backgroundColor: themeColor }}>
              Try again
            </button>
          </div>
        ) : (
          <HisaabTab slug={slug} pin={pin} themeColor={themeColor} storeName={storeName} orders={orders}
                     listPartial={listPartial} comingIn={accountingOk ? acc.comingIn : null} loadedAt={loadedAt}
                     products={products} packagingCost={packagingCost} deliveryCost={deliveryCost} store={store}
                     onGoTab={onGoTab} onOpenMoney={openMoney} />
        )
      )}

      {/* Money. A failed read shows a retry, never a row of zeroes. */}
      {section === 'money' && (<>
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
      ) : view.name === 'coming' ? (
        <ComingIn totals={acc.comingIn} lists={money.comingIn} initialTab={view.tab} themeColor={themeColor}
                  listPartial={listPartial} reasonLabel={reasonLabel} razorpayConnected={razorpayConnected} busy={busy}
                  onBack={() => open('home')} onMarkDelivered={markDelivered} onCancel={cancelOrders}
                  onSendLink={sendLink} onGoTab={onGoTab} />
      ) : view.name === 'notpaid' ? (
        <NotPaidOnline totals={acc.notPaid} lists={money.notPaid} themeColor={themeColor}
                       razorpayConnected={razorpayConnected} busy={busy} listPartial={listPartial}
                       onBack={() => open('home')} onSendLink={sendLink} onSwitchToCod={switchToCod} onCancel={cancelOrders} />
      ) : view.name === 'returns' ? (
        <LostToReturns totals={acc.balances.writtenOff} returns={acc.returns} insights={returned} list={money.returns}
                       listPartial={listPartial} onBack={() => open('home')} onGoTab={onGoTab} />
      ) : (
        <MoneyHome acc={acc} range={range} setRange={setRange} themeColor={themeColor} onOpen={open} received={received} />
      )}
      </>)}

      {listPartial && section === 'money' && view.name === 'home' && (
        <p className="text-[11px] text-gray-500 text-center">Some older orders didn&rsquo;t load, so a list may be missing a few. The totals above count all of them.</p>
      )}
    </div>
  );
}

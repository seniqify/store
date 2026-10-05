import { useState, useEffect, useCallback, useRef } from 'react';
import {
  RefreshCw, Phone, MessageCircle, MapPin, Clock, ShoppingBag, Printer, Check, Truck, CalendarDays, MoreHorizontal, Search, X, Star,
  Bike, Link2, RotateCcw, AlertTriangle, CheckCircle2,
} from 'lucide-react';
import { fetchOrders, setOrderStatus, setOrderPaid } from '../../utils/orderService';
import { shipmentOp } from '../../utils/shippingConnect';
import ShipBookModal from './ShipBookModal';
import { formatINR } from '../../utils/currency';
import { openDeliverySlip } from '../../utils/deliverySlip';
import { unitCostForItem } from '../../utils/variants';
import {
  listableRows, isAtDetailedCap, isOrdersUnpaid, countUnpaid, statusCounts,
  paymentLabelState, orderDayKey, todayKeys, dayCounts, DETAILED_ORDER_CAP,
} from '../../utils/ordersView';
import { createPaymentLink, paymentLinkMessage } from '../../utils/paymentLinks';
import { createReviewInvite } from '../../utils/reviewService';
import { reviewLink, reviewInviteMessage } from '../../utils/reviewShape';
import {
  STAGE_TABS, orderStage, stageTab, tabCounts, orderSteps, nextStep, needsCallFirst, courierProgress, paymentChip,
} from '../../utils/orderCard';
import { BUCKET_META, courierInfo } from '../../utils/deliveryStatus';

// Two vocabularies over the same rows: product stores see Orders (delivery
// lifecycle); service stores see Leads (inquiry lifecycle). Same status keys in
// the DB, different labels + WhatsApp messages.
const STATUS_ORDERS = {
  new:        { label: 'New',             emoji: '🆕', cls: 'bg-amber-100 text-amber-700' },
  confirmed:  { label: 'Confirmed',       emoji: '✅', cls: 'bg-emerald-100 text-emerald-700' },
  dispatched: { label: 'Out for delivery', emoji: '🛵', cls: 'bg-indigo-100 text-indigo-700' },
  delivered:  { label: 'Delivered',       emoji: '📦', cls: 'bg-blue-100 text-blue-700' },
  cancelled:  { label: 'Cancelled',       emoji: '🚫', cls: 'bg-gray-100 text-gray-500' },
};
const STATUS_LEADS = {
  new:        { label: 'New',       emoji: '🆕', cls: 'bg-amber-100 text-amber-700' },
  confirmed:  { label: 'Contacted', emoji: '💬', cls: 'bg-emerald-100 text-emerald-700' },
  dispatched: { label: 'In talks',  emoji: '🤝', cls: 'bg-indigo-100 text-indigo-700' },
  delivered:  { label: 'Won',       emoji: '🎉', cls: 'bg-blue-100 text-blue-700' },
  cancelled:  { label: 'Lost',      emoji: '✖️', cls: 'bg-gray-100 text-gray-500' },
};
const FILTERS_ORDERS = ['all', 'new', 'confirmed', 'dispatched', 'delivered', 'cancelled'];
const FILTERS_LEADS  = ['all', 'new', 'confirmed', 'delivered', 'cancelled'];

// Accent colour per status — drives the card's left stripe + progress fill.
const STATUS_COLOR = {
  new:        '#d97706',   // amber-600
  confirmed:  '#059669',   // emerald-600
  dispatched: '#4f46e5',   // indigo-600
  delivered:  '#2563eb',   // blue-600
  cancelled:  '#9ca3af',   // gray-400
};

// Customer-facing WhatsApp update for each status change. Sent from the owner's
// own number via a prefilled wa.me link (one tap) — no API needed.
function updateMsg(status, o, storeName, leads = false) {
  const name = o.customer_name?.trim() || 'there';
  const at   = storeName ? ` at ${storeName}` : '';
  if (leads) {
    switch (status) {
      case 'confirmed':
        return `Hi ${name}, thank you for your inquiry${at}! 🙏 I'd love to understand your requirements better — when is a good time to talk?`;
      case 'delivered':
        return `Hi ${name}, wonderful — we're all set to go ahead${at}! Thank you for choosing us 🙏`;
      default:
        return `Hi ${name}, thank you for your inquiry${at}! 🙏`;
    }
  }
  switch (status) {
    case 'confirmed':
      return `Hi ${name}, your order${at} is confirmed ✅ We're preparing it now and will let you know when it's on the way. Thank you! 🙏`;
    case 'dispatched':
      return `Hi ${name}, good news — your order${at} is out for delivery 🛵 It'll reach you shortly!`;
    case 'delivered':
      return `Hi ${name}, your order${at} has been delivered 📦 Thank you for shopping with us — we'd love to serve you again! 🙏`;
    default:
      return `Hi ${name}, thank you for your order${at}! 🙏`;
  }
}

function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);  if (h < 24) return `${h} hr ago`;
  const d = Math.floor(h / 24);  if (d < 7)  return `${d} day${d > 1 ? 's' : ''} ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export default function OrdersTab({ slug, pin, themeColor = '#0d9488', storeName = '', mode = 'orders', riders = [], payInfo = {}, store = {} }) {
  const leads   = mode === 'leads';
  const STATUS  = leads ? STATUS_LEADS : STATUS_ORDERS;
  const FILTERS = leads ? FILTERS_LEADS : FILTERS_ORDERS;
  const noun    = leads ? 'lead' : 'order';

  const [orders,     setOrders]     = useState(null);   // null = loading
  // Orders open on "To ship" -- the work still to do. Leads keep their status chips.
  const [filter,     setFilter]     = useState(leads ? 'all' : 'to_ship');
  const [query,      setQuery]      = useState('');     // find one customer / order fast
  const [dateFilter, setDateFilter] = useState('all');  // all | today | yesterday | 'YYYY-MM-DD'
  const [unpaidOnly, setUnpaidOnly] = useState(false);
  const [busy,       setBusy]       = useState(false);
  const dateRef = useRef(null);

  const [refreshing, setRefreshing] = useState(false);
  // Real orders loaded (abandoned checkouts excluded) - what the order limit
  // counts, so a full page can be told from a short one.
  const [orderRows,  setOrderRows]  = useState(0);
  // The clock, read once when rows land rather than during render, so "Today"
  // does not quietly change meaning between two renders of the same list.
  const [loadedAt,   setLoadedAt]   = useState(null);

  // Initial load shows the skeleton; refresh() updates in place (no flash) so it
  // can run silently on a timer / focus without disrupting the list.
  // get_store_orders caps real orders and abandoned checkouts separately, so the
  // order limit is measured on the listable rows alone. The list itself still
  // shows only what it always did.
  const take = useCallback(async () => {
    const raw = await fetchOrders(slug, pin, { includeAbandoned: true });
    const rows = listableRows(raw);
    setOrderRows(rows.length);
    setLoadedAt(Date.now());
    return rows;
  }, [slug, pin]);

  const load = useCallback(async () => {
    setOrders(null);
    setOrders(await take());
  }, [take]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try { setOrders(await take()); } finally { setRefreshing(false); }
  }, [take]);

  useEffect(() => { load(); }, [load]);

  // Live updates: a new order placed while this tab is open used to require a
  // manual refresh (it wouldn't just appear). Now we refetch when the tab regains
  // focus and gently poll (~20s) while it's visible.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    const id = setInterval(onVisible, 20000);
    return () => {
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(id);
    };
  }, [refresh]);

  async function changeStatus(id, status) {
    setBusy(true);
    setOrders((os) => os.map((o) => (o.id === id ? { ...o, status } : o)));
    await setOrderStatus(slug, pin, id, status);
    setBusy(false);
    // The database fills in what follows from a status (orders_payment_automation:
    // delivered COD -> paid, delivered_at), so read the row back.
    if (!leads) refresh();
  }

  async function markPaid(id, paid) {
    setBusy(true);
    setOrders((os) => os.map((o) => (o.id === id ? { ...o, paid } : o)));
    await setOrderPaid(slug, pin, id, paid);
    setBusy(false);
  }

  // Counts over the LOADED list - this screen answers "how many can I open?",
  // never "what are my books?". Accounting totals live on Home/Stats/Payments.
  const counts = statusCounts(orders || []);
  const stages = tabCounts(orders || []);
  // Unpaid = a real order whose money has not arrived. The SAME predicate runs
  // the filter below, so the chip's number and the rows it opens cannot diverge.
  const unpaidCount = countUnpaid(orders || [], { leads });
  const atCap = isAtDetailedCap(orderRows);

  // Date filtering - collapse the endless list to a single day. Keys are the
  // MERCHANT's civil date (Asia/Kolkata), so "Today" means their today wherever
  // they happen to be looking from.
  const dateKey  = (iso) => orderDayKey(iso);
  const { today: todayKey, yesterday: yestKey } = todayKeys(loadedAt);
  const dateCounts = dayCounts(orders || []);
  const isSpecificDate = dateFilter !== 'all' && dateFilter !== 'today' && dateFilter !== 'yesterday';
  const matchDate = (o) => {
    if (dateFilter === 'all') return true;
    const k = dateKey(o.created_at);
    if (dateFilter === 'today')     return k === todayKey;
    if (dateFilter === 'yesterday') return k === yestKey;
    return k === dateFilter;
  };
  const prettyDate = (ymd) => new Date(ymd + 'T00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

  // ── Search — the way to find ONE customer without scrolling ────────────────
  // A search deliberately IGNORES the date/status/unpaid chips and looks at every
  // order. Searching a name while "Today" is selected and getting nothing is the
  // exact frustration this is here to remove — if the order exists, it is found.
  const q         = query.trim().toLowerCase();
  const qDigits   = q.replace(/\D/g, '');
  const searching = q.length > 0;
  // The short reference the customer sees on their order page / WhatsApp
  // ("Order #A7F2C"), so a seller can paste back whatever the buyer quotes.
  const orderRef  = (o) => String(o.id || '').replace(/[^a-z0-9]/gi, '').slice(0, 5);
  const matchQuery = (o) => {
    if (!searching) return true;
    // Phone: compare digits only, so "98765 43210" and "+919876543210" both hit.
    if (qDigits.length >= 3 && String(o.customer_phone || '').replace(/\D/g, '').includes(qDigits)) return true;
    const hay = [
      o.customer_name, o.destination, o.awb, o.courier, orderRef(o),
      ...(Array.isArray(o.items) ? o.items.map((i) => i?.name) : []),
    ].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(q);
  };

  const filtered = searching
    ? (orders || []).filter(matchQuery)
    : (orders || [])
        .filter((o) => (filter === 'all' ? true : leads ? o.status === filter : stageTab(orderStage(o)) === filter))
        .filter((o) => (unpaidOnly ? isOrdersUnpaid(o) : true))
        .filter(matchDate);

  // ── Loading ──
  if (orders === null) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-2xl border border-gray-100 bg-white p-4 animate-pulse">
            <div className="h-3.5 w-1/3 bg-gray-200 rounded mb-3" />
            <div className="h-3 w-2/3 bg-gray-100 rounded mb-2" />
            <div className="h-9 bg-gray-100 rounded-xl mt-3" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-extrabold text-gray-900 flex items-center gap-2">
            {leads
              ? <MessageCircle size={18} style={{ color: themeColor }} />
              : <ShoppingBag size={18} style={{ color: themeColor }} />}
            {leads ? 'Leads' : 'Orders'}
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">
            {orders.length === 0 ? `No ${noun}s yet`
              : leads ? `${orders.length} total · ${counts.new || 0} new`
              : `${stages.to_ship} to ship · ${stages.on_the_way} on the way`}
          </p>
          {atCap && (
            <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1 mt-1.5 inline-block">
              Showing the newest {DETAILED_ORDER_CAP} {noun}s
            </p>
          )}
        </div>
        <button onClick={refresh} disabled={refreshing}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-600 border border-gray-200
                     rounded-xl px-3 py-2 hover:bg-gray-50 active:scale-95 transition disabled:opacity-60">
          <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Empty state */}
      {orders.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50/50 p-10 text-center">
          <div className="text-4xl mb-3">{leads ? '💼' : '🧾'}</div>
          <p className="font-bold text-gray-800">No {noun}s yet</p>
          <p className="text-sm text-gray-400 mt-1 max-w-xs mx-auto">
            {leads
              ? 'When a customer requests a quote from your page, it\'ll show up here — with their details, budget and requirements.'
              : 'When a customer places an order from your page, it\'ll show up here — with their details and items.'}
          </p>
          <p className="text-xs text-gray-400 mt-3">Tip: share your page link on WhatsApp & Instagram to get your first {noun}.</p>
        </div>
      ) : (
        <>
          {/* Search — find one customer or order without scrolling the whole list */}
          <div className="flex items-center gap-2 bg-white rounded-xl border border-gray-200 px-3 py-2">
            <Search size={15} className="text-gray-400 flex-shrink-0" />
            <input value={query} onChange={(e) => setQuery(e.target.value)}
                   placeholder={leads ? 'Search name, number or requirement…' : 'Search name, number, item or order #…'}
                   className="flex-1 min-w-0 bg-transparent text-sm text-gray-900 placeholder-gray-400 focus:outline-none" />
            {searching && (
              <button onClick={() => setQuery('')} aria-label="Clear search"
                className="flex-shrink-0 w-5 h-5 grid place-items-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600">
                <X size={13} />
              </button>
            )}
          </div>

          {/* Say plainly that a search spans everything, so an empty result is trusted. */}
          {searching && (
            <p className="text-[11px] text-gray-400 px-1 -mt-1">
              {filtered.length === 0
                ? <>No {noun} matches “{query.trim()}”.</>
                : <><b className="text-gray-600">{filtered.length}</b> {filtered.length === 1 ? noun : `${noun}s`} found — searching all dates and statuses.</>}
            </p>
          )}

          {/* Chips are hidden while searching — a search overrides them, so leaving
              them looking active would misrepresent what the list is showing. */}
          {!searching && (<>
          {/* Date filter — Today / Yesterday / pick any day, so the list isn't endless */}
          <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-1 px-1">
            {[
              { key: 'all',       label: 'All dates', n: orders.length },
              { key: 'today',     label: 'Today',     n: dateCounts[todayKey] || 0 },
              { key: 'yesterday', label: 'Yesterday', n: dateCounts[yestKey] || 0 },
            ].map(({ key, label, n }) => {
              const active = dateFilter === key;
              return (
                <button key={key} onClick={() => setDateFilter(key)}
                  className={[
                    'flex-shrink-0 px-3.5 py-1.5 rounded-full text-xs font-semibold border transition',
                    active ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300',
                  ].join(' ')}>
                  {label}{n > 0 && <span className={active ? 'opacity-70' : 'text-gray-400'}> ({n})</span>}
                </button>
              );
            })}
            {/* Calendar — jump to any specific day */}
            <label
              onClick={() => { try { dateRef.current?.showPicker(); } catch { /* older browsers just focus the input */ } }}
              className={[
                'flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border cursor-pointer transition',
                isSpecificDate ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300',
              ].join(' ')}>
              <CalendarDays size={13} />
              {isSpecificDate ? prettyDate(dateFilter) : 'Pick a date'}
              <input ref={dateRef} type="date" max={todayKey} tabIndex={-1}
                value={isSpecificDate ? dateFilter : ''}
                onChange={(e) => setDateFilter(e.target.value || 'all')}
                className="sr-only" />
            </label>
          </div>

          {/* Stage tabs (orders): where each order stands, read from what happened. */}
          {!leads && (
            <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-1 px-1" role="tablist" aria-label="Order stages">
              {[...STAGE_TABS.filter((t) => t.key === 'to_ship' || t.key === 'on_the_way' || t.key === 'delivered'
                  || stages[t.key] > 0 || filter === t.key),
                { key: 'all', label: 'All' }].map(({ key, label }) => {
                const active = filter === key;
                const n = key === 'all' ? orders.length : stages[key];
                return (
                  <button key={key} type="button" role="tab" aria-selected={active} onClick={() => setFilter(key)}
                    className={[
                      'flex-shrink-0 px-3.5 py-1.5 rounded-full text-xs font-semibold border transition',
                      active ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300',
                    ].join(' ')}>
                    {label}{n > 0 && <span className={active ? 'opacity-70' : 'text-gray-400'}> · {n}</span>}
                  </button>
                );
              })}
            </div>
          )}

          {/* Filter chips */}
          <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-1 px-1">
            {leads && FILTERS.map((f) => {
              const active = filter === f;
              const n = f === 'all' ? orders.length : (counts[f] || 0);
              const label = f === 'all' ? 'All' : STATUS[f].label;
              return (
                <button key={f} onClick={() => setFilter(f)}
                  className={[
                    'flex-shrink-0 px-3.5 py-1.5 rounded-full text-xs font-semibold border transition',
                    active ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300',
                  ].join(' ')}>
                  {f !== 'all' && <span className="mr-1">{STATUS[f].emoji}</span>}{label} {n > 0 && <span className={active ? 'opacity-70' : 'text-gray-400'}>({n})</span>}
                </button>
              );
            })}
            {/* Payment filter (orders only) — jump to what's still owed. */}
            {!leads && unpaidCount > 0 && (
              <button onClick={() => setUnpaidOnly((v) => !v)}
                className={[
                  'flex-shrink-0 px-3.5 py-1.5 rounded-full text-xs font-bold border transition',
                  unpaidOnly ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-amber-600 border-amber-200 hover:bg-amber-50',
                ].join(' ')}>
                💰 Unpaid <span className={unpaidOnly ? 'opacity-80' : 'text-amber-400'}>({unpaidCount})</span>
              </button>
            )}
          </div>
          </>)}

          {/* How updates work */}
          <p className="flex items-center gap-1.5 text-[11px] text-gray-400 px-1">
            <MessageCircle size={12} className="text-emerald-500 flex-shrink-0" />
            {leads
              ? 'Status buttons just update the lead. Tap “Send update” to WhatsApp the customer a ready-made note — only when you want.'
              : 'Orders move by themselves: the buyer confirms on WhatsApp, the courier updates delivery, and delivered cash-on-delivery turns Paid.'}
          </p>

          {/* Order / lead cards */}
          <div className="space-y-3">
            {filtered.map((o) => (leads
              ? <LeadCard key={o.id} o={o} busy={busy} themeColor={themeColor} slug={slug} pin={pin}
                          storeName={storeName} onStatus={changeStatus} onPaid={markPaid} leads riders={riders} payInfo={payInfo} store={store} />
              : <OrderCard key={o.id} o={o} busy={busy} themeColor={themeColor} slug={slug} pin={pin} now={loadedAt}
                           storeName={storeName} onStatus={changeStatus} onPaid={markPaid} riders={riders} payInfo={payInfo} store={store} />
            ))}
            {/* The searching case already has its own message above the list. */}
            {filtered.length === 0 && !searching && (
              <p className="text-center text-sm text-gray-400 py-8">
                {leads
                  ? <>No {filter === 'all' ? '' : `${STATUS[filter]?.label.toLowerCase()} `}{noun}s</>
                  : filter === 'to_ship' ? <>Nothing to ship</>
                  : <>No {filter === 'all' ? '' : `${(STAGE_TABS.find((t) => t.key === filter)?.label || '').toLowerCase()} `}orders</>}
                {dateFilter === 'all' ? '' : dateFilter === 'today' ? ' today' : dateFilter === 'yesterday' ? ' yesterday' : ` on ${prettyDate(dateFilter)}`}.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// One-tap dispatch: prefilled WhatsApp to the store's delivery boy (set in
// Settings). Without a saved number it opens WhatsApp's chat picker instead.
function riderLink(o, storeName, phone, riderPhone) {
  const msg = [
    `🛵 *Delivery* — ${storeName || 'Store'}`,
    `👤 ${o.customer_name || 'Customer'}${phone ? ` · +91 ${phone}` : ''}`,
    `📍 ${o.destination || 'Address on order'}`,
    Array.isArray(o.items) && o.items.length
      ? `🛍️ ${o.items.map((it) => `${it.qty}× ${it.name}`).join(', ')}`
      : `🛍️ ${o.item_count} item${o.item_count === 1 ? '' : 's'}`,
    o.payment_method === 'cod'
      ? `💰 COLLECT ₹${Number(o.total).toLocaleString('en-IN')} (cash on delivery)`
      : `💰 ₹${Number(o.total).toLocaleString('en-IN')} — ${(o.payment_method || 'paid').toUpperCase()}`,
  ].join('\n');
  return riderPhone
    ? `https://wa.me/91${riderPhone}?text=${encodeURIComponent(msg)}`
    : `https://wa.me/?text=${encodeURIComponent(msg)}`;
}

// "Request payment" — prefilled with the details matching the payment mode
// the customer chose at checkout. Deliberately plain text: no emoji (they
// mangle to � on some WhatsApp clients) and no upi:// link (WhatsApp doesn't
// linkify that scheme, so it renders as scammy-looking URL garbage).
// COD orders don't get the button; cash changes hands at the door.
function paymentRequestMessage(o, storeName, payInfo = {}) {
  if (o.payment_method === 'cod' || !(Number(o.total) > 0)) return null;
  const totalStr = `₹${Number(o.total).toLocaleString('en-IN')}`;
  const head = `Hi ${o.customer_name || 'there'}, this is *${storeName || 'our store'}*.\n` +
               `Your order of *${totalStr}* is confirmed.\n\n`;
  const tail = `\n\nOnce paid, kindly send the screenshot here and we will process your order right away. Thank you!`;
  const wantsUpi  = o.payment_method === 'upi' || o.payment_method === 'qr';
  const bank      = payInfo.bank;
  const hasBank   = Boolean(bank?.accountNumber);
  if ((wantsUpi || !hasBank) && payInfo.upi) {
    return head +
      `Please pay using UPI (GPay / PhonePe / Paytm):\n` +
      `UPI ID: *${payInfo.upi}*` +
      tail;
  }
  if (hasBank) {
    return head +
      `Please pay by bank transfer:\n` +
      (bank.accountName ? `Account Name: ${bank.accountName}\n` : '') +
      `Account No: ${bank.accountNumber}\n` +
      (bank.ifsc ? `IFSC: ${bank.ifsc}\n` : '') +
      (bank.bankName ? `Bank: ${bank.bankName}` : '').trim() +
      tail;
  }
  return null;   // no payment details saved in Settings yet
}

// Per-order profit (owner-only) — goods revenue minus this order's cost of
// goods, the ACTUAL courier charge saved at booking (order.shipping_cost, else
// the store's flat delivery cost), and the flat packaging cost. Known only when
// every item in the order has a cost price set, so the number is complete and
// honest. Mirrors the aggregate maths in Stats → Profit. Revenue is what the
// store actually COLLECTS (the order total, delivery and COD fees included).
function orderProfit(o, store = {}) {
  const prodByName = {};
  for (const p of (store.products || [])) { if (p && p.name) prodByName[p.name] = p; }
  const items = Array.isArray(o.items) ? o.items : [];
  let goods = 0, cogs = 0, uncovered = 0;
  for (const it of items) {
    const qty = Number(it.qty) || 0;
    goods += (Number(it.price) || 0) * qty;
    const c = unitCostForItem(prodByName[it.name], it);
    if (c != null) cogs += c * qty; else if (qty) uncovered++;
  }
  const delivery = Number(o.shipping_cost) > 0 ? Number(o.shipping_cost)
                 : Number(store.cart?.deliveryCost) > 0 ? Number(store.cart.deliveryCost) : 0;
  const packing  = Number(store.cart?.packagingCost) > 0 ? Number(store.cart.packagingCost) : 0;
  const collected = Number(o.total) > 0 ? Number(o.total) : goods;
  const known = items.length > 0 && uncovered === 0 && goods > 0 && o.status !== 'cancelled';
  return { known, profit: collected - cogs - delivery - packing, collected, cogs, delivery, packing };
}

// "Ask for a review" — creates a one-order review link on the server (PIN-gated,
// delivered orders only) and opens WhatsApp with it prefilled. Each tap makes a
// fresh link and retires the previous one, so a lost or forwarded link can be
// replaced.
function AskReviewButton({ o, slug, pin, storeName, phone, primary = false, themeColor }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState('');

  async function ask() {
    setErr('');
    setBusy(true);
    // Open the tab inside the tap: browsers block window.open after an await.
    const win = window.open('', '_blank');
    if (win) win.opener = null;
    try {
      const token = await createReviewInvite(slug, pin, o.id);
      const text = reviewInviteMessage({
        customerName: o.customer_name, storeName, link: reviewLink(window.location.origin, token),
      });
      const url = `https://wa.me/91${phone}?text=${encodeURIComponent(text)}`;
      if (win) win.location.href = url; else window.location.href = url;
    } catch (e) {
      if (win) win.close();
      setErr(e.message || 'Could not create the review link.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button type="button" onClick={ask} disabled={busy}
        className={primary
          ? 'w-full h-12 inline-flex items-center justify-center gap-2 rounded-xl text-[15px] font-bold text-white active:scale-[0.98] disabled:opacity-60'
          : 'w-full inline-flex items-center justify-center gap-1.5 text-xs font-semibold text-amber-800 border border-amber-200 bg-amber-50 py-2 rounded-xl hover:bg-amber-100 active:scale-95 disabled:opacity-60'}
        style={primary ? { backgroundColor: themeColor } : undefined}
        title="Sends the customer a review link for this order only — nothing sends until you press send in WhatsApp">
        <Star size={primary ? 17 : 13} /> {busy ? 'Creating link…' : 'Ask for a review'}
      </button>
      {err && <p className="text-[11px] text-red-500 mt-1" role="alert">{err}</p>}
    </div>
  );
}

// Leads (service businesses) keep the status-button card: a lead is moved along
// by the conversation, not by a courier. Orders use OrderCard below.
function LeadCard({ o, busy, themeColor, slug, pin, storeName, onStatus, onPaid, leads = false, riders = [], payInfo = {}, store = {} }) {
  const STATUS = leads ? STATUS_LEADS : STATUS_ORDERS;
  const st = STATUS[o.status] || STATUS.new;
  const phone = (o.customer_phone || '').replace(/\D/g, '');
  const [moreOpen, setMoreOpen] = useState(false);
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkMsg, setLinkMsg]   = useState('');
  // The customer chose Pay Online and left before paying. Flagged, not hidden:
  // if money did arrive, the seller taps the chip to mark it paid.
  // One canonical decision for the payment chip, in a stated precedence. It used
  // to be decided here with a COD-only return test that read shipment_outcome
  // alone, so a returned UPI order - or one whose only evidence was a
  // "Returned To Seller" status string - showed as a plain Unpaid.
  const payState = paymentLabelState(o, { leads });
  const payIncomplete  = payState === 'incomplete';
  const payUnconfirmed = payState === 'unconfirmed';
  const codReturned    = payState === 'returned';

  // Per-order profit (owner-only) — goods revenue minus this order's cost of
  // goods, the ACTUAL courier charge saved at booking (order.shipping_cost, else
  // the store's flat delivery cost), and the flat packaging cost. Shown only when
  // every item in the order has a cost price set, so the number is complete and
  // honest. Mirrors the aggregate maths in Stats → Profit.
  const prodByName = {};
  for (const p of (store.products || [])) { if (p && p.name) prodByName[p.name] = p; }
  const oItems = Array.isArray(o.items) ? o.items : [];
  let pGoods = 0, pCogs = 0, pUncovered = 0;
  for (const it of oItems) {
    const qty = Number(it.qty) || 0;
    pGoods += (Number(it.price) || 0) * qty;
    // Per-variant cost: the picked option's own cost, else the product base cost.
    const c = unitCostForItem(prodByName[it.name], it);
    if (c != null) pCogs += c * qty; else if (qty) pUncovered++;
  }
  const pDelivery = Number(o.shipping_cost) > 0 ? Number(o.shipping_cost)
                  : Number(store.cart?.deliveryCost) > 0 ? Number(store.cart.deliveryCost) : 0;
  const pPacking  = Number(store.cart?.packagingCost) > 0 ? Number(store.cart.packagingCost) : 0;
  // Revenue is what the store actually COLLECTS — the order total (product +
  // the delivery fee + COD fee the customer pays, less any discount) — NOT the
  // product subtotal. Using product-only revenue subtracts the courier charge
  // without ever crediting the delivery/COD fee the customer paid toward it,
  // which understates (or flips negative) the real profit.
  const pCollected = Number(o.total) > 0 ? Number(o.total) : pGoods;
  const pProfit    = pCollected - pCogs - pDelivery - pPacking;
  const showProfit = !leads && oItems.length > 0 && pUncovered === 0 && pGoods > 0 && o.status !== 'cancelled';

  const riderWa = (p) => riderLink(o, storeName, phone, p);
  const dispatchRiders = riders.filter((r) => r?.phone);
  const totalStr = `₹${Number(o.total).toLocaleString('en-IN')}`;
  const payMsg = leads ? null : paymentRequestMessage(o, storeName, payInfo);
  const waMsg = encodeURIComponent(
    `Hi ${o.customer_name || 'there'}, thank you for your ${leads ? 'inquiry' : 'order'}${storeName ? ` at ${storeName}` : ''}! 🙏`
  );
  // wa.me link prefilled with the status-update message for `status`.
  const waUpdate = (status) => `https://wa.me/91${phone}?text=${encodeURIComponent(updateMsg(status, o, storeName, leads))}`;

  // Advancing an order is JUST the status change — accepting no longer auto-opens
  // WhatsApp. Notifying the customer is a separate, optional step ("Send update"
  // below), so accepting an order never forces a message to go out.
  function Advance({ to, label, style, className, full }) {
    const size = full ? 'w-full justify-center py-2.5 text-sm' : 'px-3 py-2 text-xs';
    const cls = `inline-flex items-center gap-1.5 font-bold text-white rounded-xl active:scale-95 disabled:opacity-50 ${size} ${className || ''}`;
    return (
      <button type="button" disabled={busy} onClick={() => onStatus(o.id, to)} className={cls} style={style}>
        {label}
      </button>
    );
  }

  // Optional, explicit customer notification for the order's CURRENT status —
  // decoupled from advancing it. Returns a button label, or null when there's no
  // ready-made message worth sending for this status.
  function sendUpdateLabel(status) {
    if (leads) {
      if (status === 'confirmed') return 'Send reply on WhatsApp';
      if (status === 'delivered') return 'Send “we’re on!” message';
      return null;
    }
    if (status === 'confirmed')  return 'Send confirmation to customer';
    if (status === 'dispatched') return 'Send “out for delivery” update';
    if (status === 'delivered')  return 'Send delivered update';
    return null;
  }

  // What goes in the "More" menu (secondary tools), gated by state.
  const canRequestPay = Boolean(payMsg) && Boolean(phone) && o.status !== 'cancelled';
  const canDispatch   = !leads && o.status !== 'cancelled' && o.status !== 'delivered';
  const canCancel     = o.status === 'new' || o.status === 'confirmed' || o.status === 'dispatched';
  // A Razorpay link for this order's exact amount: turns COD (or an unfinished
  // online payment) into prepaid. Not once a courier has it booked as COD.
  const canPayLink    = !leads && !o.paid && Boolean(store.payments?.razorpay) && Boolean(phone)
                        && !o.awb && Number(o.total) > 0 && o.status !== 'cancelled';
  const hasMore       = canRequestPay || canPayLink || canDispatch || canCancel || o.status === 'cancelled';

  async function sendPayLink() {
    setMoreOpen(false); setLinkMsg(''); setLinkBusy(true);
    // Open the tab inside the tap: browsers block window.open after an await.
    const win = window.open('', '_blank');
    if (win) win.opener = null;
    try {
      const r = await createPaymentLink(slug, pin, o.id);
      if (r.paid) { if (win) win.close(); setLinkMsg('This order is already paid — tap Refresh.'); return; }
      const text = paymentLinkMessage({ customerName: o.customer_name, storeName, total: o.total, url: r.url });
      const wa = `https://wa.me/91${phone}?text=${encodeURIComponent(text)}`;
      if (win) win.location.href = wa; else window.location.href = wa;
    } catch (e) {
      if (win) win.close();
      setLinkMsg(e.message || 'Could not create the payment link.');
    } finally {
      setLinkBusy(false);
    }
  }

  // Status progress (New → … → Delivered/Won). Cancelled sits off the path.
  const accent     = STATUS_COLOR[o.status] || STATUS_COLOR.new;
  const steps      = ['new', 'confirmed', 'dispatched', 'delivered'];
  const stepLabels = leads ? ['New', 'Contacted', 'In talks', 'Won'] : ['New', 'Confirmed', 'Out', 'Delivered'];
  const stepIdx    = steps.indexOf(o.status);

  const toolBtn = 'flex-1 flex flex-col items-center gap-1 py-2 rounded-xl border border-gray-200 text-[10px] font-bold hover:bg-gray-50 active:scale-95';
  const moreItem = 'w-full flex items-center gap-2.5 px-3.5 py-2.5 text-xs font-semibold hover:bg-gray-50 border-t border-gray-100 first:border-t-0';

  return (
    <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
      {/* Header — status accent · who + meta · amount + paid */}
      <div className="flex items-start gap-3 px-4 pt-4">
        <span className="w-1 self-stretch rounded-full flex-shrink-0" style={{ backgroundColor: accent }} />
        <div className="flex-1 min-w-0">
          <p className="font-extrabold text-gray-900 leading-tight truncate">{o.customer_name || 'Customer'}</p>
          <div className="flex items-center gap-x-2 gap-y-0.5 mt-1 text-[11px] text-gray-400 flex-wrap">
            <span className="inline-flex items-center gap-1"><Clock size={10} /> {timeAgo(o.created_at)}</span>
            {o.destination && (<><span className="w-0.5 h-0.5 rounded-full bg-gray-300" /><span className="inline-flex items-center gap-0.5 min-w-0"><MapPin size={10} /><span className="truncate max-w-[8.5rem]">{o.destination}</span></span></>)}
            {phone && (<><span className="w-0.5 h-0.5 rounded-full bg-gray-300" /><span className="tabular-nums">+91 {phone}</span></>)}
            {o.payment_method && (<><span className="w-0.5 h-0.5 rounded-full bg-gray-300" /><span className="uppercase font-semibold text-gray-400">{o.payment_method}</span></>)}
            {/* Buyer confirmation — the RTO / fake-order signal. We show ONLY the
                confirmed state: until the WhatsApp confirm button is live for every
                new order, an "awaiting" chip would light up every historical order
                for no reason. */}
            {!leads && o.customer_confirmed_at && (<><span className="w-0.5 h-0.5 rounded-full bg-gray-300" />
              <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700"
                    title={`Buyer confirmed this order on ${new Date(o.customer_confirmed_at).toLocaleString('en-IN')}`}>
                <Check size={9} strokeWidth={3} /> Buyer confirmed
              </span></>)}
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          {!leads ? (
            <>
              <p className="text-xl font-extrabold text-gray-900 tabular-nums leading-none">{formatINR(o.total || 0)}</p>
              <button type="button" onClick={() => onPaid(o.id, !o.paid)} disabled={busy}
                className={[
                  'mt-1.5 inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full active:scale-95 disabled:opacity-50 transition',
                  o.paid ? 'bg-emerald-100 text-emerald-700'
                    : payIncomplete ? 'bg-rose-50 text-rose-700 border border-rose-200'
                    : 'bg-amber-50 text-amber-700 border border-amber-200',
                ].join(' ')}
                title={o.paid ? 'Paid — tap to mark unpaid'
                  : payIncomplete ? 'The customer left the online payment without paying. Tap if you were paid another way.'
                  : 'Tap once you’ve received payment'}>
                {o.paid ? <><Check size={10} strokeWidth={3} /> Paid</> : codReturned ? '↩ Returned' : payIncomplete ? '● Payment not completed' : payUnconfirmed ? '● Payment not confirmed' : '● Unpaid'}
              </button>
            </>
          ) : (
            <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${st.cls}`}>{st.emoji} {st.label}</span>
          )}
        </div>
      </div>

      {/* Status progress strip */}
      {o.status === 'cancelled' ? (
        <div className="px-4 pt-2.5"><span className="text-[11px] font-bold text-gray-400">🚫 {leads ? 'Marked lost' : 'Cancelled'}</span></div>
      ) : (
        <div className="px-4 pt-3">
          <div className="flex items-center gap-1.5">
            {steps.map((s, i) => (
              <span key={s} className="flex-1 h-1 rounded-full" style={{ backgroundColor: i <= stepIdx ? accent : '#e5e7eb' }} />
            ))}
          </div>
          <div className="flex justify-between mt-1">
            {stepLabels.map((lbl, i) => (
              <span key={lbl} className="text-[8.5px] font-bold uppercase tracking-wide"
                    style={{ color: i === stepIdx ? accent : '#cbd5d0' }}>{lbl}</span>
            ))}
          </div>
        </div>
      )}

      {/* Items in full — every line stays on the card (no collapse) */}
      <div className="px-4 pt-3">
        {oItems.map((it, i) => (
          <div key={i} className="flex items-center justify-between gap-3 text-xs py-0.5">
            <span className="truncate text-gray-600">
              {leads ? '💼 ' : ''}{it.name}{it.variant ? ` (${it.variant})` : it.size ? ` (${it.size})` : ''}{leads ? '' : ` × ${it.qty}`}
            </span>
            {!leads && <span className="tabular-nums flex-shrink-0 font-semibold text-gray-700">{formatINR((it.price || 0) * (it.qty || 0))}</span>}
          </div>
        ))}
        {leads && <p className="text-[11px] text-gray-400 mt-1">{o.item_count} service{o.item_count === 1 ? '' : 's'} requested</p>}
      </div>

      {/* Per-order profit — the real earning on this order, delivery included */}
      {showProfit && (
        <div className="px-4 pt-2.5">
          <div className="rounded-xl bg-emerald-50/70 border border-emerald-100 px-3 py-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-emerald-800 inline-flex items-center gap-1">💰 Your profit</span>
              <span className="text-sm font-extrabold tabular-nums" style={{ color: pProfit >= 0 ? '#15803d' : '#dc2626' }}>
                {formatINR(Math.round(pProfit))}
              </span>
            </div>
            <p className="text-[10px] text-emerald-700/80 mt-0.5 tabular-nums leading-snug">
              {formatINR(Math.round(pCollected))} collected − {formatINR(Math.round(pCogs))} cost
              {pDelivery > 0 ? ` − ${formatINR(Math.round(pDelivery))} delivery` : ''}
              {pPacking > 0 ? ` − ${formatINR(Math.round(pPacking))} packing` : ''}
            </p>
          </div>
        </div>
      )}

      {o.notes && (
        <p className="px-4 pt-2 text-xs text-gray-500"><span className="font-semibold text-gray-600">Note:</span> {o.notes}</p>
      )}

      {/* Primary next step (pure status change) + optional customer update + courier */}
      <div className="px-4 pt-3 space-y-2">
        {leads ? (
          <>
            {o.status === 'new' && (<Advance to="confirmed" label="Mark contacted" full style={{ backgroundColor: themeColor }} />)}
            {(o.status === 'confirmed' || o.status === 'dispatched') && (<Advance to="delivered" label="Mark won 🎉" full className="bg-blue-600 hover:bg-blue-700" />)}
          </>
        ) : (
          <>
            {o.status === 'new' && !payIncomplete && (<Advance to="confirmed" label="✅ Accept order" full style={{ backgroundColor: themeColor }} />)}
            {o.status === 'new' && payIncomplete && (
              <p className="text-xs text-rose-800 bg-rose-50 border border-rose-100 rounded-xl px-3 py-2.5 leading-relaxed">
                The customer chose <b>Pay Online</b> but didn’t finish paying, so this isn’t a sale yet. Chat with them to help them pay, or cancel it from More.
              </p>
            )}
            {o.status === 'confirmed' && (<Advance to="dispatched" label="🛵 Out for delivery" full className="bg-indigo-600 hover:bg-indigo-700" />)}
            {o.status === 'dispatched' && (<Advance to="delivered" label="📦 Mark delivered" full className="bg-blue-600 hover:bg-blue-700" />)}
          </>
        )}

        {phone && sendUpdateLabel(o.status) && (
          <a href={waUpdate(o.status)} target="_blank" rel="noopener noreferrer"
             className="w-full inline-flex items-center justify-center gap-1.5 text-xs font-semibold text-emerald-700 border border-emerald-200 bg-emerald-50 py-2 rounded-xl hover:bg-emerald-100 active:scale-95"
             title="Opens WhatsApp with a ready-made message — nothing sends until you press send">
            <MessageCircle size={13} /> {sendUpdateLabel(o.status)}
          </a>
        )}

        {!leads && o.status === 'delivered' && phone && Number(o.total) > 0 && (
          <AskReviewButton o={o} slug={slug} pin={pin} storeName={storeName} phone={phone} />
        )}

        {!leads && (store.shipping?.delhivery || store.shipping?.shadowfax) && o.destination && !/pickup/i.test(o.destination) && o.status !== 'cancelled' && (
          <ShipBlock o={o} slug={slug} pin={pin} themeColor={themeColor} courier={o.courier || store.shipping?.courier} />
        )}
      </div>

      {(linkBusy || linkMsg) && (
        <p className="px-4 pt-2 text-[11px] font-semibold text-gray-600" role="status">{linkBusy ? 'Creating payment link…' : linkMsg}</p>
      )}

      {/* Tool row — Chat · Call · Slip · More (secondary tools live under More) */}
      <div className="px-4 py-3 mt-2.5 border-t border-gray-100">
        <div className="flex items-stretch gap-2">
          {phone && (
            <a href={`https://wa.me/91${phone}?text=${waMsg}`} target="_blank" rel="noopener noreferrer"
               className={`${toolBtn} text-emerald-600`} title="Chat with the customer on WhatsApp">
              <MessageCircle size={16} /> Chat
            </a>
          )}
          {phone && (
            <a href={`tel:+91${phone}`} className={`${toolBtn} text-gray-600`}>
              <Phone size={15} /> Call
            </a>
          )}
          {!leads && (
            <button type="button" onClick={() => openDeliverySlip(o, store)}
              className={`${toolBtn} text-gray-600`} title="Print a delivery / packing slip">
              <Printer size={15} /> Slip
            </button>
          )}
          {hasMore && (
            <div className="flex-1 relative">
              <button type="button" onClick={() => setMoreOpen((v) => !v)}
                className={`${toolBtn} text-gray-600 w-full`} aria-haspopup="menu" aria-expanded={moreOpen}>
                <MoreHorizontal size={16} /> More
              </button>
              {moreOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setMoreOpen(false)} aria-hidden="true" />
                  <div className="absolute right-0 bottom-full mb-2 w-56 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden z-20" role="menu">
                    {canRequestPay && (
                      <a href={`https://wa.me/91${phone}?text=${encodeURIComponent(payMsg)}`} target="_blank" rel="noopener noreferrer"
                         onClick={() => setMoreOpen(false)} className={`${moreItem} text-gray-700`}
                         title="Opens WhatsApp with your payment details + amount prefilled">
                        <span className="text-sm">💰</span> Request payment · {totalStr}
                      </a>
                    )}
                    {canPayLink && (
                      <button type="button" disabled={linkBusy} onClick={sendPayLink}
                        className={`${moreItem} text-gray-700 disabled:opacity-50`}
                        title="Sends a Razorpay link for this order's exact amount. The order turns Paid when Razorpay confirms it.">
                        <span className="text-sm">💳</span> {o.payment_link_url ? 'Resend payment link' : 'Send payment link'}
                      </button>
                    )}
                    {canDispatch && (dispatchRiders.length > 1
                      ? dispatchRiders.map((r) => (
                          <a key={r.phone} href={riderWa(r.phone)} target="_blank" rel="noopener noreferrer"
                             onClick={() => setMoreOpen(false)} className={`${moreItem} text-gray-700`}>
                            <span className="text-sm">🛵</span> Send to {r.name?.trim() || `…${r.phone.slice(-4)}`}
                          </a>
                        ))
                      : (
                        <a href={riderWa(dispatchRiders[0]?.phone)} target="_blank" rel="noopener noreferrer"
                           onClick={() => setMoreOpen(false)} className={`${moreItem} text-gray-700`}
                           title={dispatchRiders.length ? 'Opens WhatsApp to your delivery boy, address prefilled' : 'Opens WhatsApp — pick your delivery boy (save his number in Delivery for one tap)'}>
                          <span className="text-sm">🛵</span> Send to delivery boy
                        </a>
                      ))}
                    {canCancel && (
                      <button type="button" disabled={busy} onClick={() => { setMoreOpen(false); onStatus(o.id, 'cancelled'); }}
                        className={`${moreItem} text-red-500 disabled:opacity-50`}
                        title={leads ? 'Mark this lead as lost' : 'Cancel — removes it from Sales & Profit. The customer is NOT messaged. Restore anytime.'}>
                        <span className="text-sm">🚫</span> {leads ? 'Mark lost' : 'Cancel order'}
                      </button>
                    )}
                    {o.status === 'cancelled' && (
                      <button type="button" disabled={busy} onClick={() => { setMoreOpen(false); onStatus(o.id, 'new'); }}
                        className={`${moreItem} text-gray-700 disabled:opacity-50`}
                        title={leads ? 'Reopen this lead' : 'Restore — counts in Sales & Profit again.'}>
                        <span className="text-sm">↩️</span> {leads ? 'Reopen lead' : 'Restore order'}
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Courier booking state for one order: Book → AWB, then Label / Track / Cancel.
// What this card did itself (a booking, a cancel, a tracking refresh) overrides
// the loaded row until the list catches up; otherwise the row is the truth, so a
// status the courier pushed in the background shows on the next refresh.
function useShipment(o, slug, pin, courier) {
  const isSfx = String(courier || '').toLowerCase() === 'shadowfax';
  const cName = isSfx ? 'Shadowfax' : 'Delhivery';
  const [over, setOver]     = useState(null);    // { awb, status } set by this card
  const [busy, setBusy]     = useState('');
  const [err, setErr]       = useState('');
  const [modal, setModal]   = useState(false);   // 2-step book modal
  const [pickup, setPickup] = useState(null);    // pickup result from booking
  const awb    = over ? over.awb : (o.awb || null);
  const status = over?.status ?? o.shipment_status ?? '';

  async function run(kind, fn) {
    setErr(''); setBusy(kind);
    try { return await fn(); }
    catch (e) { setErr(e.message || 'Something went wrong.'); }
    finally { setBusy(''); }
  }
  const label  = () => run('label', async () => { const r = await shipmentOp(slug, pin, o.id, 'label'); if (r.labelUrl) window.open(r.labelUrl, '_blank', 'noopener'); });
  const track  = () => run('track', async () => { const r = await shipmentOp(slug, pin, o.id, 'track'); setOver({ awb, status: r.status || status }); });
  const cancel = () => { if (!window.confirm(`Cancel this ${cName} shipment?`)) return; run('cancel', async () => { const r = await shipmentOp(slug, pin, o.id, 'cancel'); if (r.cancelled) setOver({ awb: null, status: 'Cancelled' }); else setErr(`${cName} could not cancel it.`); }); };
  const booked = (r) => { setOver({ awb: r.awb, status: r.status || 'Manifested' }); setPickup(r.pickup || null); setModal(false); };
  return { isSfx, cName, awb, status, busy, err, modal, setModal, pickup, label, track, cancel, booked };
}

const STAGE_PILL = {
  to_ship:    { label: 'To ship',           cls: 'bg-amber-50 text-amber-800' },
  not_paid:   { label: 'Not a sale yet',    cls: 'bg-rose-50 text-rose-700' },
  with_rider: { label: 'With delivery boy', cls: 'bg-blue-50 text-blue-700' },
  delivered:  { label: 'Delivered',         cls: 'bg-emerald-50 text-emerald-700' },
  returned:   { label: 'Returned',          cls: 'bg-gray-100 text-gray-600' },
  cancelled:  { label: 'Cancelled',         cls: 'bg-gray-100 text-gray-600' },
};
const PAY_CHIP = {
  paid:  'bg-emerald-100 text-emerald-700',
  bad:   'bg-rose-50 text-rose-700 border border-rose-200',
  muted: 'bg-gray-100 text-gray-600',
  due:   'bg-amber-50 text-amber-700 border border-amber-200',
};
const NEXT_HINT = {
  book: 'Next: ship it', rider: 'Next: hand it over', picked_up: 'Next: when they collect it',
  pay_link: 'Next: get paid', request_pay: 'Next: get paid', delivered: 'Next: when it reaches them',
  received: 'Next: when the money arrives', review: 'Next: win the next order',
};

// The order card: one next step (founder-approved mockup, 2026-10-05). Where the
// order stands is read from what happened (src/utils/orderCard.js); the shop is
// shown a button only when there is something for it to do.
function OrderCard({ o, busy, themeColor, slug, pin, storeName, onStatus, onPaid, riders = [], payInfo = {}, store = {}, now }) {
  const phone = (o.customer_phone || '').replace(/\D/g, '');
  const firstName = String(o.customer_name || '').trim().split(/\s+/)[0] || 'the customer';
  const [moreOpen, setMoreOpen] = useState(false);
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkMsg, setLinkMsg]   = useState('');

  const ship = useShipment(o, slug, pin, o.courier || store.shipping?.courier);
  const live = { ...o, awb: ship.awb, shipment_status: ship.status };
  const stage = orderStage(live);
  const pickupOrder = /pickup/i.test(o.destination || '');
  const courierConnected = Boolean(store.shipping?.delhivery || store.shipping?.shadowfax) && Boolean(o.destination) && !pickupOrder;
  const isCod = String(o.payment_method || '').toLowerCase() === 'cod';
  const totalStr = `₹${Number(o.total).toLocaleString('en-IN')}`;
  const payMsg = paymentRequestMessage(o, storeName, payInfo);
  const dispatchRiders = riders.filter((r) => r?.phone);
  const riderWa = (p) => riderLink(o, storeName, phone, p);
  const canRequestPay = Boolean(payMsg) && Boolean(phone) && stage !== 'cancelled';
  const canPayLink = !o.paid && Boolean(store.payments?.razorpay) && Boolean(phone)
                     && !ship.awb && Number(o.total) > 0 && stage !== 'cancelled';
  const step = nextStep(live, {
    courier: courierConnected ? ship.cName : null, pickup: pickupOrder, canPayLink, canRequestPay, now,
  });
  const callFirst = needsCallFirst(live, now);
  const prog = stage === 'courier' ? courierProgress(live) : null;
  const pill = stage === 'courier'
    ? { label: BUCKET_META[prog.bucket]?.label || 'On the way', cls: BUCKET_META[prog.bucket]?.chip || 'bg-blue-50 text-blue-700' }
    : STAGE_PILL[stage];
  const pay = paymentChip(live);
  const steps = orderSteps(live, (iso) => (iso ? timeAgo(iso) : ''));
  const nowColor = stage === 'not_paid' ? '#be123c' : callFirst || (stage === 'to_ship' && steps[1].state === 'now') ? '#d97706' : themeColor;
  const pnl = orderProfit(o, store);   // this one order only
  const facts = [
    o.customer_confirmed_at && 'Buyer confirmed on WhatsApp',
    o.paid && (o.paid_via === 'razorpay' || o.paid_via === 'payment_link') && 'Paid online',
    o.paid && o.paid_via === 'cod_delivery' && ship.awb && `Cash collected by ${courierInfo(o.courier).name}`,
  ].filter(Boolean);

  async function sendPayLink() {
    setMoreOpen(false); setLinkMsg(''); setLinkBusy(true);
    // Open the tab inside the tap: browsers block window.open after an await.
    const win = window.open('', '_blank');
    if (win) win.opener = null;
    try {
      const r = await createPaymentLink(slug, pin, o.id);
      if (r.paid) { if (win) win.close(); setLinkMsg('This order is already paid — tap Refresh.'); return; }
      const text = paymentLinkMessage({ customerName: o.customer_name, storeName, total: o.total, url: r.url });
      const wa = `https://wa.me/91${phone}?text=${encodeURIComponent(text)}`;
      if (win) win.location.href = wa; else window.location.href = wa;
    } catch (e) {
      if (win) win.close();
      setLinkMsg(e.message || 'Could not create the payment link.');
    } finally {
      setLinkBusy(false);
    }
  }

  const primaryCls = 'w-full h-12 inline-flex items-center justify-center gap-2 rounded-xl text-[15px] font-bold text-white active:scale-[0.98] disabled:opacity-50';
  const altCls = 'w-full h-11 inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white text-[13.5px] font-semibold text-gray-700 hover:bg-gray-50 active:scale-[0.98] disabled:opacity-50';
  // One action button. `main` = the card's single filled button.
  function action(kind, main) {
    const cls = main ? primaryCls : altCls;
    const style = main ? { backgroundColor: themeColor } : undefined;
    const icon = main ? 17 : 15;
    switch (kind) {
      case 'book':
        return <button type="button" onClick={() => ship.setModal(true)} className={cls} style={style}><Truck size={icon} /> Book {ship.cName}</button>;
      case 'rider':
        return (
          <a href={riderWa(dispatchRiders.length === 1 ? dispatchRiders[0].phone : null)} target="_blank" rel="noopener noreferrer"
             onClick={() => onStatus(o.id, 'dispatched')} className={cls} style={style}
             title="Opens WhatsApp to your delivery boy with the address, and moves the order to On the way">
            <Bike size={icon} /> {main ? 'Send to delivery boy' : 'Deliver it yourself'}
          </a>
        );
      case 'picked_up':
        return <button type="button" disabled={busy} onClick={() => onStatus(o.id, 'delivered')} className={cls} style={style}><Check size={icon} /> Mark picked up</button>;
      case 'pay_link':
        return <button type="button" disabled={linkBusy} onClick={sendPayLink} className={cls} style={style}><Link2 size={icon} /> {linkBusy ? 'Creating link…' : o.payment_link_url ? 'Resend payment link' : 'Send payment link'}</button>;
      case 'request_pay':
        return <a href={`https://wa.me/91${phone}?text=${encodeURIComponent(payMsg)}`} target="_blank" rel="noopener noreferrer" className={cls} style={style}><MessageCircle size={icon} /> Request payment · {totalStr}</a>;
      case 'delivered':
        return (
          <button type="button" disabled={busy} onClick={() => onStatus(o.id, 'delivered')} className={cls} style={style}
            title={isCod && !o.paid ? 'Marks it delivered — the cash your delivery boy collected is marked received too' : undefined}>
            <Check size={icon} /> {isCod && !o.paid ? `Delivered · ${totalStr} collected` : 'Mark delivered'}
          </button>
        );
      case 'received':
        return <button type="button" disabled={busy} onClick={() => onPaid(o.id, true)} className={cls} style={style}><Check size={icon} /> Mark {totalStr} received</button>;
      case 'review':
        return phone && Number(o.total) > 0
          ? <AskReviewButton o={o} slug={slug} pin={pin} storeName={storeName} phone={phone} primary={main} themeColor={themeColor} />
          : null;
      case 'call':
        return phone ? <a href={`tel:+91${phone}`} className={cls} style={style}><Phone size={icon} /> {stage === 'to_ship' ? `Call ${firstName} first` : `Call ${firstName}`}</a> : null;
      case 'restore':
        return <button type="button" disabled={busy} onClick={() => onStatus(o.id, 'new')} className={cls} style={style}><RotateCcw size={icon} /> Restore order</button>;
      default:
        return null;
    }
  }

  // "More": every other tool, minus whatever is already the card's button.
  const shown = new Set([step.primary, step.alt]);
  const moreRiders = (stage === 'to_ship' || stage === 'with_rider') && !(dispatchRiders.length <= 1 && shown.has('rider'));
  const canCancel = o.status !== 'cancelled' && stage !== 'delivered' && stage !== 'returned';
  const toolBtn = 'flex-1 flex flex-col items-center justify-center gap-1 h-[52px] rounded-xl border border-gray-200 text-[10.5px] font-bold hover:bg-gray-50 active:scale-95';
  const moreItem = 'w-full flex items-center gap-2.5 px-3.5 py-2.5 text-xs font-semibold hover:bg-gray-50 border-t border-gray-100 first:border-t-0';
  const calm = (tone, text) => (
    <p className={`mx-4 mt-3 flex gap-2 items-start rounded-xl px-3 py-2.5 text-[12.5px] leading-snug ${tone === 'gray' ? 'bg-gray-50 text-gray-600' : 'bg-emerald-50 text-emerald-800'}`}>
      <CheckCircle2 size={15} className="flex-shrink-0 mt-px" /> <span>{text}</span>
    </p>
  );
  const alert = (tone, text) => (
    <p className={`mx-4 mt-3 flex gap-2 items-start rounded-xl border px-3 py-2.5 text-[12.5px] leading-snug ${
      tone === 'red' ? 'bg-rose-50 border-rose-200 text-rose-800' : tone === 'gray' ? 'bg-gray-50 border-gray-200 text-gray-700' : 'bg-amber-50 border-amber-200 text-amber-900'}`}
      role="note">
      <AlertTriangle size={15} className="flex-shrink-0 mt-px" /> <span>{text}</span>
    </p>
  );

  return (
    <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
      {ship.modal && (
        <ShipBookModal o={o} slug={slug} pin={pin} themeColor={themeColor} courier={o.courier || store.shipping?.courier}
          onClose={() => ship.setModal(false)} onBooked={ship.booked} />
      )}

      {/* Who · when · where — and the money */}
      <div className="flex items-start gap-3 px-4 pt-4">
        <div className="flex-1 min-w-0">
          <p className="font-extrabold text-gray-900 leading-tight truncate">{o.customer_name || 'Customer'}</p>
          <div className="flex items-center gap-x-2 gap-y-0.5 mt-1 text-[11px] text-gray-500 flex-wrap">
            <span className="inline-flex items-center gap-1"><Clock size={10} /> {timeAgo(o.created_at)}</span>
            {o.destination && (<><span className="w-0.5 h-0.5 rounded-full bg-gray-300" /><span className="inline-flex items-center gap-0.5 min-w-0"><MapPin size={10} /><span className="truncate max-w-[9.5rem]">{o.destination}</span></span></>)}
            {phone && (<><span className="w-0.5 h-0.5 rounded-full bg-gray-300" /><span className="tabular-nums">+91 {phone}</span></>)}
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-xl font-extrabold text-gray-900 tabular-nums leading-none">{formatINR(o.total || 0)}</p>
          <button type="button" onClick={() => onPaid(o.id, !o.paid)} disabled={busy}
            className={`mt-1.5 inline-flex items-center gap-1 text-[10.5px] font-bold px-2 py-0.5 rounded-full active:scale-95 disabled:opacity-50 transition ${PAY_CHIP[pay.tone]}`}
            title={o.paid ? 'Paid — tap to mark unpaid' : 'Tap once you’ve received payment'}>
            {pay.tone === 'paid' && <Check size={10} strokeWidth={3} />} {pay.text}
          </button>
        </div>
      </div>

      {/* Where it stands, and what is already known */}
      <div className="flex flex-wrap gap-1.5 px-4 pt-2.5">
        <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full ${pill.cls}`}>
          <span className="w-1.5 h-1.5 rounded-full bg-current" /> {pill.label}
        </span>
        {facts.map((f) => (
          <span key={f} className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-full bg-emerald-50 text-emerald-700">
            <Check size={11} strokeWidth={3} /> {f}
          </span>
        ))}
      </div>

      {/* Progress: filled in by what happened, never by a button */}
      {stage !== 'cancelled' && (
        <ol className="grid grid-cols-4 px-4 pt-3.5" aria-label="Order progress">
          {steps.map((s, i) => {
            const nxt = steps[i + 1];
            const ring = s.state === 'done' ? themeColor : s.state === 'now' ? nowColor : s.state === 'stop' ? '#9ca3af' : '#d1d5db';
            return (
              <li key={s.key} className="min-w-0 flex flex-col gap-0.5">
                <div className="flex items-center">
                  <span className="w-[18px] h-[18px] rounded-full border-2 grid place-items-center flex-shrink-0"
                        style={{ borderColor: ring, backgroundColor: s.state === 'done' ? themeColor : '#fff' }}>
                    {s.state === 'done' && <Check size={10} strokeWidth={4} className="text-white" />}
                  </span>
                  {nxt && <span className="flex-1 h-0.5 mx-1 rounded" style={{ backgroundColor: s.state === 'done' && nxt.state === 'done' ? themeColor : '#e5e7eb' }} />}
                </div>
                <span className={`text-[11px] font-bold ${s.state === 'pending' || s.state === 'stop' ? 'text-gray-400' : 'text-gray-900'}`}>{s.label}</span>
                <span className="text-[10.5px] text-gray-500 leading-tight pr-1 truncate">{s.sub || ' '}</span>
              </li>
            );
          })}
        </ol>
      )}

      {/* Items, profit, note */}
      <div className="px-4 pt-3">
        {(Array.isArray(o.items) ? o.items : []).map((it, i) => (
          <div key={i} className="flex items-center justify-between gap-3 text-[13px] py-0.5">
            <span className="truncate text-gray-700">
              {it.name}{it.variant ? ` (${it.variant})` : it.size ? ` (${it.size})` : ''} <span className="text-gray-500">× {it.qty}</span>
            </span>
            <span className="tabular-nums flex-shrink-0 font-semibold text-gray-900">{formatINR((it.price || 0) * (it.qty || 0))}</span>
          </div>
        ))}
        {pnl.known && (
          <p className="mt-1 text-xs font-bold tabular-nums" style={{ color: pnl.profit >= 0 ? '#047857' : '#dc2626' }}>
            Profit {formatINR(Math.round(pnl.profit))}
            <span className="font-medium text-gray-500">
              {' '}· {formatINR(Math.round(pnl.collected))} collected − {formatINR(Math.round(pnl.cogs))} cost
              {pnl.delivery > 0 ? ` − ${formatINR(Math.round(pnl.delivery))} delivery` : ''}
              {pnl.packing > 0 ? ` − ${formatINR(Math.round(pnl.packing))} packing` : ''}
            </span>
          </p>
        )}
        {o.notes && <p className="mt-1 text-xs text-gray-600"><span className="font-semibold text-gray-700">Note:</span> {o.notes}</p>}
      </div>

      {/* What is going on, when the shop needs to know */}
      {callFirst && alert('amber', 'Not confirmed on WhatsApp yet. Unconfirmed cash-on-delivery orders are often refused at the door — call before you ship.')}
      {stage === 'not_paid' && alert('red', `${firstName === 'the customer' ? 'The customer' : firstName} chose Pay Online but left before paying, so this is not a sale yet. Send a payment link — it turns Paid by itself when they pay.`)}

      {stage === 'courier' && (
        <div className="mx-4 mt-3 rounded-xl border border-gray-100 bg-gray-50/70 p-3 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-[13px] font-bold text-gray-900"><Truck size={15} style={{ color: themeColor }} /> {ship.cName}</span>
            <span className="text-[11px] font-mono text-gray-500">AWB {ship.awb}</span>
          </div>
          <p className="flex items-center gap-1.5 text-xs text-gray-700">
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: BUCKET_META[prog.bucket]?.stripe || '#9ca3af' }} /> {prog.label}
          </p>
          {ship.pickup && (ship.pickup.scheduled
            ? <p className="text-[11px] text-green-700">🚚 {ship.pickup.covered ? (ship.isSfx ? 'Pickup requested' : 'Added to today’s pickup') : `Pickup scheduled${ship.pickup.date ? ` · ${ship.pickup.date}` : ''}`} — {ship.cName} will collect</p>
            : <p className="text-[11px] text-amber-700">⚠️ Auto-pickup didn’t schedule — raise a pickup in {ship.cName} for this parcel.</p>)}
          <div className="flex items-center gap-2 pt-0.5">
            {!ship.isSfx && (
              <button type="button" disabled={!!ship.busy} onClick={ship.label}
                className="flex-1 h-9 inline-flex items-center justify-center gap-1 text-[11.5px] font-semibold text-gray-700 border border-gray-200 bg-white rounded-lg disabled:opacity-50">
                <Printer size={12} /> {ship.busy === 'label' ? '…' : 'Label'}
              </button>
            )}
            <button type="button" disabled={!!ship.busy} onClick={ship.track}
              className="flex-1 h-9 text-[11.5px] font-semibold text-gray-700 border border-gray-200 bg-white rounded-lg disabled:opacity-50">
              {ship.busy === 'track' ? '…' : 'Track'}
            </button>
            <button type="button" disabled={!!ship.busy} onClick={ship.cancel}
              className="h-9 px-3 text-[11.5px] font-semibold text-red-600 rounded-lg hover:bg-red-50 disabled:opacity-50">
              {ship.busy === 'cancel' ? '…' : 'Cancel shipment'}
            </button>
          </div>
          {ship.isSfx && <span className="block text-[10.5px] text-gray-500 leading-tight">The pickup rider carries the label.</span>}
          {ship.err && <p className="text-[11px] text-red-600">{ship.err}</p>}
        </div>
      )}
      {stage === 'courier' && (prog.bucket === 'cancelled'
        ? alert('gray', `${ship.cName} cancelled this booking at their end. Contact support to ship it again.`)
        : prog.problem
          ? alert('amber', `Delivery problem: ${prog.label}. Call ${firstName} to sort it out, or ${ship.cName} may send it back.`)
          : calm('green', prog.bucket === 'pickup' ? `Nothing to do. Pack it — ${ship.cName} collects it.`
            : prog.bucket === 'ofd' ? `Nothing to do. ${ship.cName} is delivering it today.`
            : 'Nothing to do. It is on the way — tracking updates by itself.'))}

      {stage === 'with_rider' && (
        <div className="mx-4 mt-3 rounded-xl border border-gray-100 bg-gray-50/70 p-3">
          <p className="inline-flex items-center gap-1.5 text-[13px] font-bold text-gray-900"><Bike size={15} style={{ color: themeColor }} /> With your delivery boy</p>
          {isCod && !o.paid && <p className="text-xs text-gray-700 mt-1">Collect {totalStr} cash on delivery</p>}
        </div>
      )}
      {stage === 'returned' && calm('gray', 'It came back to you. No money is due on it.')}
      {stage === 'cancelled' && calm('gray', 'Not counted in your sales. The customer was not messaged.')}
      {stage === 'to_ship' && !ship.awb && ship.err && <p className="px-4 pt-2 text-[11px] text-red-600">{ship.err}</p>}

      {/* The one next step */}
      {step.primary && action(step.primary, true) && (
        <div className="px-4 pt-3.5">
          <p className="text-[10.5px] font-bold uppercase tracking-wider text-gray-500 mb-1.5">{NEXT_HINT[step.primary]}</p>
          {action(step.primary, true)}
        </div>
      )}
      {step.alt && action(step.alt, false) && <div className="px-4 pt-2">{action(step.alt, false)}</div>}

      {(linkBusy || linkMsg) && (
        <p className="px-4 pt-2 text-[11px] font-semibold text-gray-600" role="status">{linkBusy ? 'Creating payment link…' : linkMsg}</p>
      )}

      {/* Tool row — WhatsApp · Call · Slip · More */}
      <div className="px-4 py-3 mt-3.5 border-t border-gray-100">
        <div className="flex items-stretch gap-2">
          {phone && (
            <a href={`https://wa.me/91${phone}?text=${encodeURIComponent(`Hi ${o.customer_name || 'there'}, thank you for your order${storeName ? ` at ${storeName}` : ''}! 🙏`)}`}
               target="_blank" rel="noopener noreferrer" className={`${toolBtn} text-emerald-700`} title="Chat with the customer on WhatsApp">
              <MessageCircle size={17} /> WhatsApp
            </a>
          )}
          {phone && (<a href={`tel:+91${phone}`} className={`${toolBtn} text-gray-600`}><Phone size={16} /> Call</a>)}
          <button type="button" onClick={() => openDeliverySlip(o, store)} className={`${toolBtn} text-gray-600`} title="Print a delivery / packing slip">
            <Printer size={16} /> Slip
          </button>
          <div className="flex-1 relative">
            <button type="button" onClick={() => setMoreOpen((v) => !v)}
              className={`${toolBtn} text-gray-600 w-full`} aria-haspopup="menu" aria-expanded={moreOpen}>
              <MoreHorizontal size={17} /> More
            </button>
            {moreOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMoreOpen(false)} aria-hidden="true" />
                <div className="absolute right-0 bottom-full mb-2 w-60 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden z-20" role="menu">
                  {canRequestPay && !shown.has('request_pay') && (
                    <a href={`https://wa.me/91${phone}?text=${encodeURIComponent(payMsg)}`} target="_blank" rel="noopener noreferrer"
                       onClick={() => setMoreOpen(false)} className={`${moreItem} text-gray-700`}>
                      <span className="text-sm">💰</span> Request payment · {totalStr}
                    </a>
                  )}
                  {canPayLink && !shown.has('pay_link') && (
                    <button type="button" disabled={linkBusy} onClick={sendPayLink} className={`${moreItem} text-gray-700 disabled:opacity-50`}>
                      <span className="text-sm">💳</span> {o.payment_link_url ? 'Resend payment link' : 'Send payment link'}
                    </button>
                  )}
                  {moreRiders && (dispatchRiders.length > 1
                    ? dispatchRiders.map((r) => (
                        <a key={r.phone} href={riderWa(r.phone)} target="_blank" rel="noopener noreferrer"
                           onClick={() => { setMoreOpen(false); if (stage === 'to_ship') onStatus(o.id, 'dispatched'); }} className={`${moreItem} text-gray-700`}>
                          <span className="text-sm">🛵</span> Send to {r.name?.trim() || `…${r.phone.slice(-4)}`}
                        </a>
                      ))
                    : (
                      <a href={riderWa(dispatchRiders[0]?.phone)} target="_blank" rel="noopener noreferrer"
                         onClick={() => { setMoreOpen(false); if (stage === 'to_ship') onStatus(o.id, 'dispatched'); }} className={`${moreItem} text-gray-700`}>
                        <span className="text-sm">🛵</span> Send to delivery boy
                      </a>
                    ))}
                  {stage === 'courier' && (
                    <button type="button" disabled={busy} onClick={() => { setMoreOpen(false); onStatus(o.id, 'delivered'); }}
                      className={`${moreItem} text-gray-700 disabled:opacity-50`}
                      title="Only if the courier's tracking is stuck: marks it delivered (cash on delivery counts as collected)">
                      <span className="text-sm">✅</span> Mark delivered
                    </button>
                  )}
                  {canCancel && (
                    <button type="button" disabled={busy} onClick={() => { setMoreOpen(false); onStatus(o.id, 'cancelled'); }}
                      className={`${moreItem} text-red-600 disabled:opacity-50`}
                      title="Cancel — removes it from Sales & Profit. The customer is NOT messaged. Restore anytime.">
                      <span className="text-sm">🚫</span> Cancel order
                    </button>
                  )}
                  {o.status === 'cancelled' && (
                    <button type="button" disabled={busy} onClick={() => { setMoreOpen(false); onStatus(o.id, 'new'); }}
                      className={`${moreItem} text-gray-700 disabled:opacity-50`}>
                      <span className="text-sm">↩️</span> Restore order
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Courier shipping controls for one order (the lead card's old layout).
function ShipBlock({ o, slug, pin, themeColor, courier }) {
  const { isSfx, cName, awb, status, busy, err, modal, setModal, pickup, label, track, cancel, booked } = useShipment(o, slug, pin, courier);

  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50/70 p-2.5">
      {modal && (
        <ShipBookModal o={o} slug={slug} pin={pin} themeColor={themeColor} courier={courier}
          onClose={() => setModal(false)}
          onBooked={booked} />
      )}
      {!awb ? (
        <button onClick={() => setModal(true)}
          className="w-full inline-flex items-center justify-center gap-1.5 text-xs font-bold text-white py-2 rounded-lg active:scale-95"
          style={{ backgroundColor: themeColor }}>
          <Truck size={13} /> Book {cName}
        </button>
      ) : (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-700">
              <Truck size={13} style={{ color: themeColor }} /> {cName}
            </span>
            <span className="text-[11px] font-mono text-gray-500">AWB {awb}</span>
          </div>
          {status && <p className="text-[11px] text-gray-500">Status: <b className="text-gray-700">{status}</b></p>}
          {pickup && (
            pickup.scheduled
              ? <p className="text-[11px] text-green-700">🚚 {pickup.covered ? (isSfx ? 'Pickup requested' : 'Added to today’s pickup') : `Pickup scheduled${pickup.date ? ` · ${pickup.date}` : ''}`} — {cName} will collect</p>
              : <p className="text-[11px] text-amber-700">⚠️ Auto-pickup didn’t schedule — raise a pickup in {cName} for this parcel.</p>
          )}
          {isSfx ? (
            <div className="space-y-1">
              <div className="flex items-center gap-1.5">
                <button disabled={!!busy} onClick={track}
                  className="flex-1 inline-flex items-center justify-center gap-1 text-[11px] font-semibold text-gray-600 border border-gray-200 py-1.5 rounded-lg hover:bg-white disabled:opacity-50">
                  {busy === 'track' ? '…' : 'Track'}
                </button>
                <button disabled={!!busy} onClick={cancel}
                  className="text-[11px] font-semibold text-red-500 px-2 py-1.5 rounded-lg hover:bg-red-50 disabled:opacity-50">
                  {busy === 'cancel' ? '…' : 'Cancel'}
                </button>
              </div>
              <span className="block text-[10px] text-gray-400 leading-tight">🏷️ The pickup rider carries the label.</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <button disabled={!!busy} onClick={label}
                className="flex-1 inline-flex items-center justify-center gap-1 text-[11px] font-semibold text-gray-600 border border-gray-200 py-1.5 rounded-lg hover:bg-white disabled:opacity-50">
                <Printer size={12} /> {busy === 'label' ? '…' : 'Label'}
              </button>
              <button disabled={!!busy} onClick={track}
                className="flex-1 inline-flex items-center justify-center gap-1 text-[11px] font-semibold text-gray-600 border border-gray-200 py-1.5 rounded-lg hover:bg-white disabled:opacity-50">
                {busy === 'track' ? '…' : 'Track'}
              </button>
              <button disabled={!!busy} onClick={cancel}
                className="text-[11px] font-semibold text-red-500 px-2 py-1.5 rounded-lg hover:bg-red-50 disabled:opacity-50">
                {busy === 'cancel' ? '…' : 'Cancel'}
              </button>
            </div>
          )}
        </div>
      )}
      {err && <p className="text-[11px] text-red-500 mt-1.5">{err}</p>}
    </div>
  );
}

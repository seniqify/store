import { useState, useEffect, useCallback, useRef } from 'react';
import { RefreshCw, Phone, MessageCircle, MapPin, Clock, ShoppingBag, Printer, Check, Truck, CalendarDays, MoreHorizontal } from 'lucide-react';
import { fetchOrders, setOrderStatus, setOrderPaid } from '../../utils/orderService';
import { shipmentOp } from '../../utils/shippingConnect';
import ShipBookModal from './ShipBookModal';
import { formatINR } from '../../utils/currency';
import { openDeliverySlip } from '../../utils/deliverySlip';
import { unitCostForItem } from '../../utils/variants';

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
  const [filter,     setFilter]     = useState('all');
  const [dateFilter, setDateFilter] = useState('all');  // all | today | yesterday | 'YYYY-MM-DD'
  const [unpaidOnly, setUnpaidOnly] = useState(false);
  const [busy,       setBusy]       = useState(false);
  const dateRef = useRef(null);

  const [refreshing, setRefreshing] = useState(false);

  // Initial load shows the skeleton; refresh() updates in place (no flash) so it
  // can run silently on a timer / focus without disrupting the list.
  const load = useCallback(async () => {
    setOrders(null);
    setOrders(await fetchOrders(slug, pin));
  }, [slug, pin]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try { setOrders(await fetchOrders(slug, pin)); } finally { setRefreshing(false); }
  }, [slug, pin]);

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
  }

  async function markPaid(id, paid) {
    setBusy(true);
    setOrders((os) => os.map((o) => (o.id === id ? { ...o, paid } : o)));
    await setOrderPaid(slug, pin, id, paid);
    setBusy(false);
  }

  const counts   = (orders || []).reduce((m, o) => { m[o.status] = (m[o.status] || 0) + 1; return m; }, {});
  // Unpaid = an order not yet marked paid. Leads carry no payment, so never counted.
  const unpaidCount = leads ? 0 : (orders || []).filter((o) => !o.paid).length;

  // Date filtering — collapse the endless list to a single day. Keys are the
  // LOCAL calendar date (merchant's own timezone) so "Today" means their today.
  const dateKey  = (iso) => { try { return new Date(iso).toLocaleDateString('en-CA'); } catch { return ''; } };
  const todayKey = new Date().toLocaleDateString('en-CA');
  const yestKey  = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toLocaleDateString('en-CA'); })();
  const dateCounts = (orders || []).reduce((m, o) => { const k = dateKey(o.created_at); if (k) m[k] = (m[k] || 0) + 1; return m; }, {});
  const isSpecificDate = dateFilter !== 'all' && dateFilter !== 'today' && dateFilter !== 'yesterday';
  const matchDate = (o) => {
    if (dateFilter === 'all') return true;
    const k = dateKey(o.created_at);
    if (dateFilter === 'today')     return k === todayKey;
    if (dateFilter === 'yesterday') return k === yestKey;
    return k === dateFilter;
  };
  const prettyDate = (ymd) => new Date(ymd + 'T00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

  const filtered = (orders || [])
    .filter((o) => (filter === 'all' ? true : o.status === filter))
    .filter((o) => (unpaidOnly ? !o.paid : true))
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
            {orders.length === 0 ? `No ${noun}s yet` : `${orders.length} total · ${counts.new || 0} new`}
          </p>
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

          {/* Filter chips */}
          <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-1 px-1">
            {FILTERS.map((f) => {
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

          {/* How updates work */}
          <p className="flex items-center gap-1.5 text-[11px] text-gray-400 px-1">
            <MessageCircle size={12} className="text-emerald-500 flex-shrink-0" />
            Status buttons just update the order. Tap “Send update” to WhatsApp the customer a ready-made note — only when you want.
          </p>

          {/* Order / lead cards */}
          <div className="space-y-3">
            {filtered.map((o) => (
              <OrderCard key={o.id} o={o} busy={busy} themeColor={themeColor} slug={slug} pin={pin}
                         storeName={storeName} onStatus={changeStatus} onPaid={markPaid} leads={leads} riders={riders} payInfo={payInfo} store={store} />
            ))}
            {filtered.length === 0 && (
              <p className="text-center text-sm text-gray-400 py-8">
                No {filter === 'all' ? '' : `${STATUS[filter]?.label.toLowerCase()} `}{noun}s
                {dateFilter === 'all' ? '' : dateFilter === 'today' ? ' today' : dateFilter === 'yesterday' ? ' yesterday' : ` on ${prettyDate(dateFilter)}`}.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function OrderCard({ o, busy, themeColor, slug, pin, storeName, onStatus, onPaid, leads = false, riders = [], payInfo = {}, store = {} }) {
  const STATUS = leads ? STATUS_LEADS : STATUS_ORDERS;
  const st = STATUS[o.status] || STATUS.new;
  const phone = (o.customer_phone || '').replace(/\D/g, '');
  const [moreOpen, setMoreOpen] = useState(false);

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

  // One-tap dispatch: prefilled WhatsApp to the store's delivery boy (set in
  // Settings). Without a saved number it opens WhatsApp's chat picker instead.
  const riderMsg = [
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
  const riderWa = (p) => p
    ? `https://wa.me/91${p}?text=${encodeURIComponent(riderMsg)}`
    : `https://wa.me/?text=${encodeURIComponent(riderMsg)}`;
  const dispatchRiders = riders.filter((r) => r?.phone);

  // "Request payment" — prefilled with the details matching the payment mode
  // the customer chose at checkout. Deliberately plain text: no emoji (they
  // mangle to � on some WhatsApp clients) and no upi:// link (WhatsApp doesn't
  // linkify that scheme, so it renders as scammy-looking URL garbage).
  // COD orders don't get the button; cash changes hands at the door.
  const totalStr = `₹${Number(o.total).toLocaleString('en-IN')}`;
  const payMsg = (() => {
    if (leads || o.payment_method === 'cod' || !(Number(o.total) > 0)) return null;
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
  })();
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
  const hasMore       = canRequestPay || canDispatch || canCancel || o.status === 'cancelled';

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
                  o.paid ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-50 text-amber-700 border border-amber-200',
                ].join(' ')}
                title={o.paid ? 'Paid — tap to mark unpaid' : 'Tap once you’ve received payment'}>
                {o.paid ? <><Check size={10} strokeWidth={3} /> Paid</> : '● Unpaid'}
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
            {o.status === 'new' && (<Advance to="confirmed" label="✅ Accept order" full style={{ backgroundColor: themeColor }} />)}
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

        {!leads && (store.shipping?.delhivery || store.shipping?.shadowfax) && o.destination && !/pickup/i.test(o.destination) && o.status !== 'cancelled' && (
          <ShipBlock o={o} slug={slug} pin={pin} themeColor={themeColor} courier={o.courier || store.shipping?.courier} />
        )}
      </div>

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

// Courier shipping controls for one order: Book → AWB, then Label / Track / Cancel.
function ShipBlock({ o, slug, pin, themeColor, courier }) {
  const isSfx = String(courier || '').toLowerCase() === 'shadowfax';
  const cName = isSfx ? 'Shadowfax' : 'Delhivery';
  const [awb, setAwb]       = useState(o.awb || null);
  const [status, setStatus] = useState(o.shipment_status || '');
  const [busy, setBusy]     = useState('');
  const [err, setErr]       = useState('');
  const [modal, setModal]   = useState(false);   // 2-step book modal
  const [pickup, setPickup] = useState(null);    // pickup result from booking

  async function run(kind, fn) {
    setErr(''); setBusy(kind);
    try { return await fn(); }
    catch (e) { setErr(e.message || 'Something went wrong.'); }
    finally { setBusy(''); }
  }
  const label  = () => run('label', async () => { const r = await shipmentOp(slug, pin, o.id, 'label'); if (r.labelUrl) window.open(r.labelUrl, '_blank', 'noopener'); });
  const track  = () => run('track', async () => { const r = await shipmentOp(slug, pin, o.id, 'track'); setStatus(r.status || status); });
  const cancel = () => { if (!window.confirm(`Cancel this ${cName} shipment?`)) return; run('cancel', async () => { const r = await shipmentOp(slug, pin, o.id, 'cancel'); if (r.cancelled) { setAwb(null); setStatus('Cancelled'); } else setErr(`${cName} could not cancel it.`); }); };

  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50/70 p-2.5">
      {modal && (
        <ShipBookModal o={o} slug={slug} pin={pin} themeColor={themeColor} courier={courier}
          onClose={() => setModal(false)}
          onBooked={(r) => { setAwb(r.awb); setStatus(r.status || 'Manifested'); setPickup(r.pickup || null); setModal(false); }} />
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

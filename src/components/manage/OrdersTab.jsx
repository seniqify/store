import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Phone, MessageCircle, MapPin, Clock, ShoppingBag, Printer, Check, Truck } from 'lucide-react';
import { fetchOrders, setOrderStatus, setOrderPaid } from '../../utils/orderService';
import { shipmentOp } from '../../utils/shippingConnect';
import ShipBookModal from './ShipBookModal';
import { formatINR } from '../../utils/currency';
import { openDeliverySlip } from '../../utils/deliverySlip';

// Two vocabularies over the same rows: product stores see Orders (delivery
// lifecycle); service stores see Leads (inquiry lifecycle). Same status keys in
// the DB, different labels + WhatsApp messages.
const STATUS_ORDERS = {
  new:        { label: 'New',             emoji: '🆕', cls: 'bg-amber-100 text-amber-700' },
  confirmed:  { label: 'Confirmed',       emoji: '✅', cls: 'bg-emerald-100 text-emerald-700' },
  dispatched: { label: 'Out for delivery', emoji: '🛵', cls: 'bg-indigo-100 text-indigo-700' },
  delivered:  { label: 'Delivered',       emoji: '📦', cls: 'bg-blue-100 text-blue-700' },
  cancelled:  { label: 'Cancelled',       emoji: '✖️', cls: 'bg-gray-100 text-gray-500' },
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
  const [unpaidOnly, setUnpaidOnly] = useState(false);
  const [busy,       setBusy]       = useState(false);

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
  const filtered = (orders || [])
    .filter((o) => (filter === 'all' ? true : o.status === filter))
    .filter((o) => (unpaidOnly ? !o.paid : true));

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
            Each status button opens WhatsApp so you can send the customer a ready-made update.
          </p>

          {/* Order / lead cards */}
          <div className="space-y-3">
            {filtered.map((o) => (
              <OrderCard key={o.id} o={o} busy={busy} themeColor={themeColor} slug={slug} pin={pin}
                         storeName={storeName} onStatus={changeStatus} onPaid={markPaid} leads={leads} riders={riders} payInfo={payInfo} store={store} />
            ))}
            {filtered.length === 0 && (
              <p className="text-center text-sm text-gray-400 py-8">No {STATUS[filter]?.label.toLowerCase()} {noun}s.</p>
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

  // Advance the order to `to` and, when we have the customer's number, open
  // WhatsApp prefilled with that status's update so the owner can send it in one
  // tap (the anchor's href is the user gesture; onClick persists the new status).
  function Advance({ to, label, style, className, full }) {
    const size = full ? 'w-full justify-center py-2.5 text-sm' : 'px-3 py-2 text-xs';
    const cls = `inline-flex items-center gap-1.5 font-bold text-white rounded-xl active:scale-95 disabled:opacity-50 ${size} ${className || ''}`;
    return phone ? (
      <a href={waUpdate(to)} target="_blank" rel="noopener noreferrer" onClick={() => onStatus(o.id, to)}
         className={cls} style={style} title="Opens WhatsApp to notify the customer">
        <MessageCircle size={14} /> {label}
      </a>
    ) : (
      <button disabled={busy} onClick={() => onStatus(o.id, to)} className={cls} style={style}>
        {label}
      </button>
    );
  }

  return (
    <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
      {/* Top: time + payment status + fulfilment status */}
      <div className="flex items-center justify-between gap-2 px-4 pt-3.5">
        <span className="inline-flex items-center gap-1 text-[11px] text-gray-400 flex-shrink-0">
          <Clock size={11} /> {timeAgo(o.created_at)}
        </span>
        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          {/* Paid / Unpaid — one tap for the owner to record payment received
              (cash collected for COD, or UPI/bank credit for prepaid). */}
          {!leads && (
            <button type="button" onClick={() => onPaid(o.id, !o.paid)} disabled={busy}
              className={[
                'inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full active:scale-95 disabled:opacity-50 transition',
                o.paid ? 'bg-emerald-100 text-emerald-700'
                       : 'bg-white text-amber-600 border border-amber-300 hover:bg-amber-50',
              ].join(' ')}
              title={o.paid ? 'Paid — tap to mark unpaid' : 'Tap once you’ve received payment'}>
              {o.paid ? <><Check size={11} strokeWidth={3} /> Paid</> : '💰 Mark paid'}
            </button>
          )}
          <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${st.cls}`}>{st.emoji} {st.label}</span>
        </div>
      </div>

      {/* Customer */}
      <div className="px-4 pt-2">
        <p className="font-extrabold text-gray-900 leading-tight">{o.customer_name || 'Customer'}</p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-gray-500">
          {phone && <span className="tabular-nums">+91 {phone}</span>}
          {o.destination && <span className="inline-flex items-center gap-1"><MapPin size={11} /> {o.destination}</span>}
          {o.payment_method && <span className="bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">{o.payment_method.toUpperCase()}</span>}
        </div>
      </div>

      {/* Request payment — matches the mode the customer picked at checkout */}
      {payMsg && phone && o.status !== 'cancelled' && (
        <div className="px-4 mt-2.5">
          <a href={`https://wa.me/91${phone}?text=${encodeURIComponent(payMsg)}`}
             target="_blank" rel="noopener noreferrer"
             className="w-full inline-flex items-center justify-center gap-1.5 text-xs font-bold text-white py-2 rounded-xl active:scale-95"
             style={{ backgroundColor: '#25D366' }}
             title="Opens WhatsApp with your payment details and the amount prefilled">
            💰 Request payment · {totalStr}
          </a>
        </div>
      )}

      {/* Print a delivery / packing slip for the parcel (orders only). */}
      {!leads && (
        <div className="px-4 mt-2.5">
          <button type="button" onClick={() => openDeliverySlip(o, store)}
            className="w-full inline-flex items-center justify-center gap-1.5 text-xs font-semibold
                       text-gray-600 border border-gray-200 py-2 rounded-xl hover:bg-gray-50 active:scale-95"
            title="Open a print-ready delivery slip (print or save as PDF)">
            <Printer size={13} /> Print delivery slip
          </button>
        </div>
      )}

      {/* Dispatch to the store's own delivery boys (orders only). One rider =
          one-tap button; several = a button each; none saved = WhatsApp picker. */}
      {!leads && (
        <div className="px-4 mt-2.5">
          {dispatchRiders.length > 1 ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-semibold text-gray-400">🛵 Send to:</span>
              {dispatchRiders.map((r) => (
                <a key={r.phone} href={riderWa(r.phone)} target="_blank" rel="noopener noreferrer"
                   className="text-xs font-semibold text-gray-600 border border-gray-200 px-3 py-1.5
                              rounded-xl hover:bg-gray-50 active:scale-95"
                   title="Opens WhatsApp with the delivery details prefilled">
                  {r.name?.trim() || `…${r.phone.slice(-4)}`}
                </a>
              ))}
            </div>
          ) : (
            <a href={riderWa(dispatchRiders[0]?.phone)} target="_blank" rel="noopener noreferrer"
               className="w-full inline-flex items-center justify-center gap-1.5 text-xs font-semibold
                          text-gray-600 border border-gray-200 py-2 rounded-xl hover:bg-gray-50 active:scale-95"
               title={dispatchRiders.length ? 'Opens WhatsApp to your delivery boy with the address prefilled' : 'Opens WhatsApp — pick your delivery boy’s chat (save his number in the Delivery tab for one tap)'}>
              🛵 Send to delivery boy
            </a>
          )}
        </div>
      )}

      {/* Items (orders) / requested services (leads — a quote isn't a sale, so no ₹ totals) */}
      <div className="px-4 mt-3 rounded-xl bg-gray-50 mx-4 py-2.5 sm:mx-0 sm:rounded-none sm:bg-transparent sm:px-4">
        {(o.items || []).map((it, i) => (
          <div key={i} className="flex items-center justify-between text-xs text-gray-600 py-0.5">
            <span className="truncate pr-2">
              {leads ? '💼 ' : ''}{it.name}{it.variant ? ` (${it.variant})` : it.size ? ` (${it.size})` : ''}{leads ? '' : ` × ${it.qty}`}
            </span>
            {!leads && <span className="tabular-nums flex-shrink-0">{formatINR((it.price || 0) * (it.qty || 0))}</span>}
          </div>
        ))}
        <div className="flex items-center justify-between pt-2 mt-1 border-t border-dashed border-gray-200">
          {leads ? (
            <span className="text-xs font-semibold text-gray-500">
              {o.item_count} service{o.item_count === 1 ? '' : 's'} requested
            </span>
          ) : (
            <>
              <span className="text-xs font-semibold text-gray-500">{o.item_count} item{o.item_count === 1 ? '' : 's'} · Total</span>
              <span className="font-extrabold tabular-nums" style={{ color: themeColor }}>{formatINR(o.total || 0)}</span>
            </>
          )}
        </div>
      </div>

      {o.notes && (
        <p className="px-4 mt-2 text-xs text-gray-500"><span className="font-semibold text-gray-600">Note:</span> {o.notes}</p>
      )}

      {/* Actions — primary next step on top (full width), contact + cancel below */}
      <div className="px-4 py-3 mt-2 border-t border-gray-100 space-y-2">
        {leads ? (
          <>
            {o.status === 'new' && (
              <Advance to="confirmed" label="Reply & mark contacted" full style={{ backgroundColor: themeColor }} />
            )}
            {(o.status === 'confirmed' || o.status === 'dispatched') && (
              <Advance to="delivered" label="Mark won 🎉" full className="bg-blue-600 hover:bg-blue-700" />
            )}
          </>
        ) : (
          <>
            {o.status === 'new' && (
              <Advance to="confirmed" label="Confirm & notify" full style={{ backgroundColor: themeColor }} />
            )}
            {o.status === 'confirmed' && (
              <Advance to="dispatched" label="Out for delivery" full className="bg-indigo-600 hover:bg-indigo-700" />
            )}
            {o.status === 'dispatched' && (
              <Advance to="delivered" label="Mark Delivered" full className="bg-blue-600 hover:bg-blue-700" />
            )}
            {o.status === 'delivered' && phone && (
              <a href={waUpdate('delivered')} target="_blank" rel="noopener noreferrer"
                 className="w-full inline-flex items-center justify-center gap-1.5 text-xs font-semibold text-gray-600 border border-gray-200 py-2.5 rounded-xl hover:bg-gray-50 active:scale-95">
                <MessageCircle size={13} /> Re-send delivered update
              </a>
            )}
          </>
        )}

        {/* Delhivery shipping — for delivery orders when the store is connected */}
        {!leads && store.shipping?.delhivery && o.destination && !/pickup/i.test(o.destination) && o.status !== 'cancelled' && (
          <ShipBlock o={o} slug={slug} pin={pin} themeColor={themeColor} />
        )}

        {/* Contact the customer + cancel/reopen */}
        <div className="flex items-center gap-2">
          {phone && (
            <>
              <a href={`https://wa.me/91${phone}?text=${waMsg}`} target="_blank" rel="noopener noreferrer"
                 className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs font-bold text-white py-2 rounded-xl active:scale-95"
                 style={{ backgroundColor: '#25D366' }}>
                <MessageCircle size={14} /> WhatsApp
              </a>
              <a href={`tel:+91${phone}`}
                 className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs font-semibold text-gray-600 border border-gray-200 py-2 rounded-xl hover:bg-gray-50 active:scale-95">
                <Phone size={13} /> Call
              </a>
            </>
          )}
          {(o.status === 'new' || o.status === 'confirmed' || o.status === 'dispatched') && (
            <button disabled={busy} onClick={() => onStatus(o.id, 'cancelled')}
              className="flex-shrink-0 text-xs font-semibold text-red-500 px-3 py-2 rounded-xl hover:bg-red-50 active:scale-95 disabled:opacity-50">
              {leads ? 'Mark lost' : 'Cancel'}
            </button>
          )}
          {o.status === 'cancelled' && (
            <button disabled={busy} onClick={() => onStatus(o.id, 'new')}
              className="flex-shrink-0 text-xs font-semibold text-gray-500 px-3 py-2 rounded-xl border border-gray-200 hover:bg-gray-100 active:scale-95 disabled:opacity-50">
              Reopen {leads ? 'lead' : 'order'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Delhivery shipping controls for one order: Book → AWB, then Label / Track / Cancel.
function ShipBlock({ o, slug, pin, themeColor }) {
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
  const cancel = () => { if (!window.confirm('Cancel this Delhivery shipment?')) return; run('cancel', async () => { const r = await shipmentOp(slug, pin, o.id, 'cancel'); if (r.cancelled) { setAwb(null); setStatus('Cancelled'); } else setErr('Delhivery could not cancel it.'); }); };

  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50/70 p-2.5">
      {modal && (
        <ShipBookModal o={o} slug={slug} pin={pin} themeColor={themeColor}
          onClose={() => setModal(false)}
          onBooked={(r) => { setAwb(r.awb); setStatus(r.status || 'Manifested'); setPickup(r.pickup || null); setModal(false); }} />
      )}
      {!awb ? (
        <button onClick={() => setModal(true)}
          className="w-full inline-flex items-center justify-center gap-1.5 text-xs font-bold text-white py-2 rounded-lg active:scale-95"
          style={{ backgroundColor: themeColor }}>
          <Truck size={13} /> Book Delhivery
        </button>
      ) : (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-700">
              <Truck size={13} style={{ color: themeColor }} /> Delhivery
            </span>
            <span className="text-[11px] font-mono text-gray-500">AWB {awb}</span>
          </div>
          {status && <p className="text-[11px] text-gray-500">Status: <b className="text-gray-700">{status}</b></p>}
          {pickup && (
            pickup.scheduled
              ? <p className="text-[11px] text-green-700">🚚 {pickup.covered ? 'Added to today’s pickup' : `Pickup scheduled${pickup.date ? ` · ${pickup.date}` : ''}`} — courier will collect</p>
              : <p className="text-[11px] text-amber-700">⚠️ Auto-pickup didn’t schedule — raise a pickup in Delhivery for this parcel.</p>
          )}
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
        </div>
      )}
      {err && <p className="text-[11px] text-red-500 mt-1.5">{err}</p>}
    </div>
  );
}

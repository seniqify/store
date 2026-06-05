import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Phone, MessageCircle, MapPin, Clock, ShoppingBag } from 'lucide-react';
import { fetchOrders, setOrderStatus } from '../../utils/orderService';
import { formatINR } from '../../utils/currency';

const STATUS = {
  new:       { label: 'New',       emoji: '🆕', cls: 'bg-amber-100 text-amber-700' },
  confirmed: { label: 'Confirmed', emoji: '✅', cls: 'bg-emerald-100 text-emerald-700' },
  delivered: { label: 'Delivered', emoji: '📦', cls: 'bg-blue-100 text-blue-700' },
  cancelled: { label: 'Cancelled', emoji: '✖️', cls: 'bg-gray-100 text-gray-500' },
};
const FILTERS = ['all', 'new', 'confirmed', 'delivered', 'cancelled'];

function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);  if (h < 24) return `${h} hr ago`;
  const d = Math.floor(h / 24);  if (d < 7)  return `${d} day${d > 1 ? 's' : ''} ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export default function OrdersTab({ slug, pin, themeColor = '#0d9488', storeName = '' }) {
  const [orders,  setOrders]  = useState(null);   // null = loading
  const [filter,  setFilter]  = useState('all');
  const [busy,    setBusy]    = useState(false);

  const load = useCallback(async () => {
    setOrders(null);
    setOrders(await fetchOrders(slug, pin));
  }, [slug, pin]);

  useEffect(() => { load(); }, [load]);

  async function changeStatus(id, status) {
    setBusy(true);
    setOrders((os) => os.map((o) => (o.id === id ? { ...o, status } : o)));
    await setOrderStatus(slug, pin, id, status);
    setBusy(false);
  }

  const counts = (orders || []).reduce((m, o) => { m[o.status] = (m[o.status] || 0) + 1; return m; }, {});
  const filtered = filter === 'all' ? (orders || []) : (orders || []).filter((o) => o.status === filter);

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
            <ShoppingBag size={18} style={{ color: themeColor }} /> Orders
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">
            {orders.length === 0 ? 'No orders yet' : `${orders.length} total · ${counts.new || 0} new`}
          </p>
        </div>
        <button onClick={load}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-600 border border-gray-200
                     rounded-xl px-3 py-2 hover:bg-gray-50 active:scale-95 transition">
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {/* Empty state */}
      {orders.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50/50 p-10 text-center">
          <div className="text-4xl mb-3">🧾</div>
          <p className="font-bold text-gray-800">No orders yet</p>
          <p className="text-sm text-gray-400 mt-1 max-w-xs mx-auto">
            When a customer places an order from your page, it'll show up here — with their details and items.
          </p>
          <p className="text-xs text-gray-400 mt-3">Tip: share your page link on WhatsApp & Instagram to get your first order.</p>
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
          </div>

          {/* Order cards */}
          <div className="space-y-3">
            {filtered.map((o) => (
              <OrderCard key={o.id} o={o} busy={busy} themeColor={themeColor}
                         storeName={storeName} onStatus={changeStatus} />
            ))}
            {filtered.length === 0 && (
              <p className="text-center text-sm text-gray-400 py-8">No {STATUS[filter]?.label.toLowerCase()} orders.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function OrderCard({ o, busy, themeColor, storeName, onStatus }) {
  const st = STATUS[o.status] || STATUS.new;
  const phone = (o.customer_phone || '').replace(/\D/g, '');
  const waMsg = encodeURIComponent(
    `Hi ${o.customer_name || 'there'}, thank you for your order${storeName ? ` at ${storeName}` : ''}! 🙏`
  );

  return (
    <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
      {/* Top: time + status */}
      <div className="flex items-center justify-between px-4 pt-3.5">
        <span className="inline-flex items-center gap-1 text-[11px] text-gray-400">
          <Clock size={11} /> {timeAgo(o.created_at)}
        </span>
        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${st.cls}`}>{st.emoji} {st.label}</span>
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

      {/* Items */}
      <div className="px-4 mt-3 rounded-xl bg-gray-50 mx-4 py-2.5 sm:mx-0 sm:rounded-none sm:bg-transparent sm:px-4">
        {(o.items || []).map((it, i) => (
          <div key={i} className="flex items-center justify-between text-xs text-gray-600 py-0.5">
            <span className="truncate pr-2">{it.name}{it.variant ? ` (${it.variant})` : it.size ? ` (${it.size})` : ''} × {it.qty}</span>
            <span className="tabular-nums flex-shrink-0">{formatINR((it.price || 0) * (it.qty || 0))}</span>
          </div>
        ))}
        <div className="flex items-center justify-between pt-2 mt-1 border-t border-dashed border-gray-200">
          <span className="text-xs font-semibold text-gray-500">{o.item_count} item{o.item_count === 1 ? '' : 's'} · Total</span>
          <span className="font-extrabold tabular-nums" style={{ color: themeColor }}>{formatINR(o.total || 0)}</span>
        </div>
      </div>

      {o.notes && (
        <p className="px-4 mt-2 text-xs text-gray-500"><span className="font-semibold text-gray-600">Note:</span> {o.notes}</p>
      )}

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 mt-2 border-t border-gray-100">
        {phone && (
          <>
            <a href={`https://wa.me/91${phone}?text=${waMsg}`} target="_blank" rel="noopener noreferrer"
               className="inline-flex items-center gap-1.5 text-xs font-bold text-white px-3 py-2 rounded-xl active:scale-95"
               style={{ backgroundColor: '#25D366' }}>
              <MessageCircle size={14} /> WhatsApp
            </a>
            <a href={`tel:+91${phone}`}
               className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-600 border border-gray-200 px-3 py-2 rounded-xl hover:bg-gray-50 active:scale-95">
              <Phone size={13} /> Call
            </a>
          </>
        )}
        <div className="flex gap-2 ml-auto">
          {o.status === 'new' && (
            <button disabled={busy} onClick={() => onStatus(o.id, 'confirmed')}
              className="text-xs font-bold text-white px-3 py-2 rounded-xl active:scale-95 disabled:opacity-50" style={{ backgroundColor: themeColor }}>
              ✅ Confirm
            </button>
          )}
          {o.status === 'confirmed' && (
            <button disabled={busy} onClick={() => onStatus(o.id, 'delivered')}
              className="text-xs font-bold text-white px-3 py-2 rounded-xl active:scale-95 disabled:opacity-50 bg-blue-600 hover:bg-blue-700">
              📦 Mark Delivered
            </button>
          )}
          {(o.status === 'new' || o.status === 'confirmed') && (
            <button disabled={busy} onClick={() => onStatus(o.id, 'cancelled')}
              className="text-xs font-semibold text-red-500 px-2.5 py-2 rounded-xl hover:bg-red-50 active:scale-95 disabled:opacity-50">
              Cancel
            </button>
          )}
          {o.status === 'cancelled' && (
            <button disabled={busy} onClick={() => onStatus(o.id, 'new')}
              className="text-xs font-semibold text-gray-500 px-2.5 py-2 rounded-xl hover:bg-gray-100 active:scale-95 disabled:opacity-50">
              Reopen
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

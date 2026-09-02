import { useState, useEffect, useCallback } from 'react';
import { ShoppingCart, Clock, MessageCircle, Sparkles } from 'lucide-react';
import { fetchOrders } from '../../utils/orderService';
import { formatINR } from '../../utils/currency';

/**
 * Abandoned checkouts — customers who typed their phone number at checkout but
 * never sent the order. Growth+ feature: paid stores see the list with a
 * one-tap WhatsApp recovery nudge; Free stores see the count + upgrade tease.
 *
 * "Recovered" is derived, not stored: an abandoned entry disappears once the
 * same phone places a real order at/after the abandoned time.
 */

function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);  if (h < 24) return `${h} hr ago`;
  const d = Math.floor(h / 24);
  return d < 7 ? `${d} day${d > 1 ? 's' : ''} ago`
               : new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export default function AbandonedTab({ slug, pin, themeColor = '#0d9488', storeName = '', allowed = false, waPhone = '' }) {
  const [rows, setRows] = useState(null);   // null = loading

  const load = useCallback(async () => {
    setRows(null);
    const all = await fetchOrders(slug, pin, { includeAbandoned: true });
    const real = all.filter((o) => o.status !== 'abandoned');
    const cutoff = Date.now() - 30 * 86400000;
    setRows(
      all.filter((o) =>
        o.status === 'abandoned' &&
        new Date(o.created_at).getTime() > cutoff &&
        // recovered → same phone completed an order at/after this attempt
        !real.some((r) => r.customer_phone === o.customer_phone &&
                          new Date(r.created_at) >= new Date(o.created_at)))
         .slice(0, 50),
    );
  }, [slug, pin]);

  useEffect(() => { load(); }, [load]);

  if (rows === null) {
    return (
      <div className="space-y-3">
        {[0, 1].map((i) => (
          <div key={i} className="rounded-2xl border border-gray-100 bg-white p-4 animate-pulse">
            <div className="h-3.5 w-1/3 bg-gray-200 rounded mb-3" />
            <div className="h-3 w-2/3 bg-gray-100 rounded" />
          </div>
        ))}
      </div>
    );
  }

  // ── Free plan: tease with the real count, sell the recovery ────────────────
  if (!allowed) {
    return (
      <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
        <div className="px-5 py-4" style={{ background: `linear-gradient(135deg, ${themeColor}14, transparent)` }}>
          <div className="flex items-center gap-2">
            <Sparkles size={16} style={{ color: themeColor }} />
            <h2 className="text-base font-extrabold text-gray-900">Win back lost orders</h2>
          </div>
        </div>
        <div className="px-5 py-5 space-y-3">
          <p className="text-sm text-gray-600">
            {rows.length > 0
              ? <><b>{rows.length} customer{rows.length === 1 ? '' : 's'}</b> started an order at {storeName || 'your store'} in the last 30 days but never sent it — name, number and cart already captured.</>
              : <>When a customer types their number at checkout but doesn’t finish, they’ll show up here — with their cart, ready for a one-tap WhatsApp nudge.</>}
          </p>
          <ul className="space-y-1.5 text-sm text-gray-500">
            <li>💰 See who they are and what they wanted to buy</li>
            <li>💬 One tap sends a friendly “complete your order?” on WhatsApp</li>
            <li>📈 Recovered orders usually pay for the plan by themselves</li>
          </ul>
          <a href="/plans"
             onClick={() => sessionStorage.setItem('pocketlink_verified_phone', String(waPhone || '').replace(/\D/g, ''))}
             className="w-full inline-flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold text-white
                        transition-all hover:opacity-90 active:scale-[0.98] shadow-sm"
             style={{ backgroundColor: themeColor }}>
            Activate your plan — ₹1,099/mo →
          </a>
        </div>
      </div>
    );
  }

  // ── Paid: the recovery list ─────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-extrabold text-gray-900 flex items-center gap-2">
          <ShoppingCart size={18} className="text-gray-400" /> Abandoned checkouts
          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">{rows.length}</span>
        </h2>
        <p className="text-xs text-gray-400 mt-0.5">
          Started an order, typed their number, never sent it. A friendly nudge recovers a surprising number of these.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="text-center py-10 px-4 rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50/50">
          <div className="text-3xl mb-2">🎉</div>
          <p className="text-sm font-semibold text-gray-700">Nothing abandoned right now</p>
          <p className="text-xs text-gray-400 mt-1">Customers who bail at checkout will appear here for the last 30 days.</p>
        </div>
      ) : (
        rows.map((o) => {
          const nudge =
            `Hi${o.customer_name ? ` ${o.customer_name}` : ''}! 😊 You started an order at ${storeName || 'our store'}` +
            ` — ${(o.items || []).map((i) => `${i.qty}× ${i.name}`).join(', ')} (${formatINR(o.total)}).` +
            ` Want me to confirm it for you? Happy to help!`;
          return (
            <div key={o.id} className="rounded-2xl border border-gray-100 bg-white shadow-sm p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-extrabold text-gray-900 leading-tight truncate">{o.customer_name || 'Customer'}</p>
                  <p className="text-xs text-gray-500 mt-0.5 tabular-nums">+91 {o.customer_phone}</p>
                </div>
                <span className="inline-flex items-center gap-1 text-[11px] text-gray-400 flex-shrink-0">
                  <Clock size={11} /> {timeAgo(o.created_at)}
                </span>
              </div>
              <div className="mt-2.5 rounded-xl bg-gray-50 px-3 py-2">
                {(o.items || []).map((it, i) => (
                  <div key={i} className="flex items-center justify-between text-xs text-gray-600 py-0.5">
                    <span className="truncate pr-2">{it.name}{it.variant ? ` (${it.variant})` : ''} × {it.qty}</span>
                    <span className="tabular-nums flex-shrink-0">{formatINR((it.price || 0) * (it.qty || 0))}</span>
                  </div>
                ))}
                <div className="flex items-center justify-between pt-1.5 mt-1 border-t border-dashed border-gray-200 text-xs font-semibold text-gray-700">
                  <span>Cart value</span><span className="tabular-nums">{formatINR(o.total)}</span>
                </div>
              </div>
              <a href={`https://wa.me/91${o.customer_phone}?text=${encodeURIComponent(nudge)}`}
                 target="_blank" rel="noopener noreferrer"
                 className="mt-3 w-full inline-flex items-center justify-center gap-1.5 text-xs font-bold text-white py-2.5
                            rounded-xl active:scale-95" style={{ backgroundColor: '#25D366' }}>
                <MessageCircle size={14} /> Win them back on WhatsApp
              </a>
            </div>
          );
        })
      )}
    </div>
  );
}

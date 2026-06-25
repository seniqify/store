import { useState, useEffect, useCallback } from 'react';
import { TrendingUp, TrendingDown, Lock, Sparkles, Clock } from 'lucide-react';
import { fetchOrders } from '../../utils/orderService';
import { fetchViewStats } from '../../utils/viewService';
import { formatINR } from '../../utils/currency';

const DAY = 86400000;
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const fmtHour = (h) => { const m = h % 12 === 0 ? 12 : h % 12; return `${m}${h < 12 ? 'am' : 'pm'}`; };

/**
 * Sales analytics — derived entirely from the orders table (no extra setup).
 * Both paid tiers include analytics: Standard sees the core dashboard; Premium
 * (`advanced`) also gets behavioural insights — returning customers, peak hours,
 * best day and the revenue trend. A lapsed/unpaid page sees an upsell.
 */
export default function AnalyticsTab({ slug, pin, themeColor = '#0d9488', enabled = false, advanced = false }) {
  const [orders, setOrders] = useState(null);
  const [views,  setViews]  = useState(null);

  const load = useCallback(async () => {
    if (!enabled) return;
    const [o, v] = await Promise.all([fetchOrders(slug, pin), fetchViewStats(slug)]);
    setOrders(o);
    setViews(v);
  }, [slug, pin, enabled]);

  useEffect(() => { load(); }, [load]);

  // ── Upsell (lapsed / unpaid page) ──
  if (!enabled) {
    return (
      <div className="rounded-2xl border border-gray-100 bg-white shadow-sm p-8 text-center">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-gray-100 flex items-center justify-center mb-3">
          <Lock size={22} className="text-gray-400" />
        </div>
        <h3 className="font-extrabold text-gray-900">Sales analytics needs an active plan</h3>
        <p className="text-sm text-gray-500 mt-1.5 max-w-xs mx-auto">
          See your revenue, best-selling products, daily order trends and more. Renew your plan to unlock it.
        </p>
        <a href="/plans"
           onClick={() => sessionStorage.setItem('pocketlink_verified_phone', '')}
           className="inline-flex items-center gap-2 mt-5 text-white font-bold text-sm px-6 py-3 rounded-xl shadow-lg"
           style={{ backgroundColor: themeColor }}>
          See plans →
        </a>
      </div>
    );
  }

  if (orders === null) {
    return (
      <div className="grid grid-cols-2 gap-3">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-24 rounded-2xl bg-white border border-gray-100 animate-pulse" />)}
      </div>
    );
  }

  // ── Compute metrics ──
  const valid   = orders.filter((o) => o.status !== 'cancelled');
  const revenue = valid.reduce((s, o) => s + (Number(o.total) || 0), 0);
  const count   = valid.length;
  const aov     = count ? revenue / count : 0;
  const now     = Date.now();
  const thisWeek = valid.filter((o) => now - new Date(o.created_at).getTime() < 7 * DAY).length;
  const lastWeek = valid.filter((o) => { const d = now - new Date(o.created_at).getTime(); return d >= 7 * DAY && d < 14 * DAY; }).length;
  const wow = lastWeek ? Math.round(((thisWeek - lastWeek) / lastWeek) * 100) : (thisWeek ? 100 : 0);
  const customers = new Set(valid.map((o) => o.customer_phone).filter(Boolean)).size;

  // Reach → orders funnel. Compared on the same 7-day window so it's apples-to-
  // apples (views only started logging recently). Capped at 100% for sanity.
  const totalViews = views?.total ?? 0;
  const weekViews  = views?.week  ?? 0;
  const conv = weekViews > 0 ? Math.min(100, Math.round((thisWeek / weekViews) * 100)) : null;

  // Orders per day, last 14 days
  const days = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(now - (13 - i) * DAY);
    const key = d.toDateString();
    const n = valid.filter((o) => new Date(o.created_at).toDateString() === key).length;
    return { label: d.toLocaleDateString('en-IN', { day: 'numeric' }), n };
  });
  const maxDay = Math.max(1, ...days.map((d) => d.n));

  // Top products by revenue
  const pmap = {};
  for (const o of valid) for (const it of (o.items || [])) {
    const k = it.name || 'Item';
    pmap[k] = pmap[k] || { qty: 0, rev: 0 };
    pmap[k].qty += it.qty || 0;
    pmap[k].rev += (it.price || 0) * (it.qty || 0);
  }
  const top = Object.entries(pmap).sort((a, b) => b[1].rev - a[1].rev).slice(0, 5);
  const topMax = Math.max(1, ...top.map(([, v]) => v.rev));

  // ── Advanced (Premium) metrics — behaviour from the same orders ──
  // Returning customers: buyers (by phone) with more than one order.
  const byPhone = {};
  for (const o of valid) { if (o.customer_phone) byPhone[o.customer_phone] = (byPhone[o.customer_phone] || 0) + 1; }
  const returning  = Object.values(byPhone).filter((n) => n > 1).length;
  const repeatRate = customers ? Math.round((returning / customers) * 100) : 0;

  // Peak ordering hours (0–23) and busiest weekday.
  const hours = Array(24).fill(0);
  const dows  = Array(7).fill(0);
  for (const o of valid) {
    const d = new Date(o.created_at);
    hours[d.getHours()]++;
    dows[d.getDay()]++;
  }
  const peakHour = hours.some((n) => n > 0) ? hours.indexOf(Math.max(...hours)) : null;
  const maxHour  = Math.max(1, ...hours);
  const bestDow  = dows.some((n) => n > 0) ? dows.indexOf(Math.max(...dows)) : null;

  // Revenue over the last 14 days (parallels the orders-per-day chart).
  const revDays = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(now - (13 - i) * DAY);
    const key = d.toDateString();
    const rev = valid.filter((o) => new Date(o.created_at).toDateString() === key)
                     .reduce((s, o) => s + (Number(o.total) || 0), 0);
    return { label: d.toLocaleDateString('en-IN', { day: 'numeric' }), rev };
  });
  const maxRev = Math.max(1, ...revDays.map((d) => d.rev));

  if (orders.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50/50 p-10 text-center">
        <div className="text-4xl mb-3">📊</div>
        <p className="font-bold text-gray-800">No data yet</p>
        <p className="text-sm text-gray-400 mt-1">Your sales stats will appear here once you start getting orders.</p>
      </div>
    );
  }

  const Stat = ({ label, value, sub }) => (
    <div className="rounded-2xl border border-gray-100 bg-white shadow-sm p-4">
      <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">{label}</p>
      <p className="text-xl font-extrabold text-gray-900 mt-1 tabular-nums">{value}</p>
      {sub && <div className="mt-0.5">{sub}</div>}
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Revenue" value={formatINR(revenue)} sub={<span className="text-[11px] text-gray-400">across {count} orders</span>} />
        <Stat label="Orders" value={count} sub={
          <span className={['text-[11px] font-semibold inline-flex items-center gap-0.5', wow >= 0 ? 'text-emerald-600' : 'text-red-500'].join(' ')}>
            {wow >= 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}{Math.abs(wow)}% vs last week
          </span>
        } />
        <Stat label="Avg order" value={formatINR(Math.round(aov))} />
        <Stat label="Customers" value={customers} sub={<span className="text-[11px] text-gray-400">unique buyers</span>} />
        <Stat label="Page views" value={totalViews.toLocaleString('en-IN')} sub={<span className="text-[11px] text-gray-400">{weekViews.toLocaleString('en-IN')} this week</span>} />
        <Stat label="Conversion" value={conv === null ? '—' : `${conv}%`} sub={<span className="text-[11px] text-gray-400">visitors → orders (7d)</span>} />
      </div>

      {/* Orders over time */}
      <div className="rounded-2xl border border-gray-100 bg-white shadow-sm p-4">
        <p className="text-sm font-bold text-gray-900 mb-3">Orders · last 14 days</p>
        <div className="flex items-end gap-1.5 h-28">
          {days.map((d, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-1">
              <div className="w-full rounded-t-md transition-all" title={`${d.n} orders`}
                   style={{ height: `${(d.n / maxDay) * 100}%`, minHeight: d.n ? 4 : 2,
                            backgroundColor: d.n ? themeColor : '#e5e7eb' }} />
              <span className="text-[8px] text-gray-300">{d.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Top products */}
      <div className="rounded-2xl border border-gray-100 bg-white shadow-sm p-4">
        <p className="text-sm font-bold text-gray-900 mb-3">Top products</p>
        <div className="space-y-2.5">
          {top.length === 0 && <p className="text-xs text-gray-400">No products sold yet.</p>}
          {top.map(([name, v], i) => (
            <div key={name}>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="font-semibold text-gray-700 truncate pr-2">{i + 1}. {name}</span>
                <span className="text-gray-500 flex-shrink-0 tabular-nums">{v.qty} sold · {formatINR(v.rev)}</span>
              </div>
              <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${(v.rev / topMax) * 100}%`, backgroundColor: themeColor }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {advanced ? (
        <>
          {/* ── Advanced insights (Premium) ── */}
          <div className="flex items-center gap-2 pt-1">
            <Sparkles size={15} style={{ color: themeColor }} />
            <h3 className="text-sm font-extrabold text-gray-900">Advanced insights</h3>
            <span className="text-[10px] font-bold uppercase tracking-wide text-white px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: themeColor }}>Premium</span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Stat label="Returning customers" value={returning}
                  sub={<span className="text-[11px] text-gray-400">{repeatRate}% of buyers reorder</span>} />
            <Stat label="Busiest day" value={bestDow === null ? '—' : DOW[bestDow]}
                  sub={<span className="text-[11px] text-gray-400">most orders land here</span>} />
          </div>

          {/* Revenue trend */}
          <div className="rounded-2xl border border-gray-100 bg-white shadow-sm p-4">
            <p className="text-sm font-bold text-gray-900 mb-3">Revenue · last 14 days</p>
            <div className="flex items-end gap-1.5 h-28">
              {revDays.map((d, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full rounded-t-md transition-all" title={formatINR(d.rev)}
                       style={{ height: `${(d.rev / maxRev) * 100}%`, minHeight: d.rev ? 4 : 2,
                                backgroundColor: d.rev ? themeColor : '#e5e7eb' }} />
                  <span className="text-[8px] text-gray-300">{d.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Peak ordering hours */}
          <div className="rounded-2xl border border-gray-100 bg-white shadow-sm p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-bold text-gray-900 flex items-center gap-1.5">
                <Clock size={14} className="text-gray-400" /> Peak ordering hours
              </p>
              {peakHour !== null && (
                <span className="text-[11px] font-semibold" style={{ color: themeColor }}>Busiest ~{fmtHour(peakHour)}</span>
              )}
            </div>
            <div className="flex items-end gap-[3px] h-20">
              {hours.map((n, h) => (
                <div key={h} className="flex-1 rounded-t-sm transition-all" title={`${fmtHour(h)} · ${n} order${n === 1 ? '' : 's'}`}
                     style={{ height: `${(n / maxHour) * 100}%`, minHeight: n ? 3 : 1,
                              backgroundColor: h === peakHour ? themeColor : `${themeColor}33` }} />
              ))}
            </div>
            <div className="flex justify-between text-[8px] text-gray-300 mt-1">
              <span>12am</span><span>6am</span><span>12pm</span><span>6pm</span><span>11pm</span>
            </div>
          </div>
        </>
      ) : (
        /* ── Standard → tease the Premium insights ── */
        <div className="rounded-2xl border border-dashed p-5 text-center"
             style={{ borderColor: `${themeColor}55`, background: `${themeColor}08` }}>
          <div className="w-11 h-11 mx-auto rounded-2xl flex items-center justify-center mb-2"
               style={{ backgroundColor: `${themeColor}1a` }}>
            <Sparkles size={18} style={{ color: themeColor }} />
          </div>
          <p className="font-extrabold text-gray-900 text-sm">Unlock advanced insights</p>
          <p className="text-xs text-gray-500 mt-1 max-w-xs mx-auto">
            See returning customers, peak ordering hours, your busiest day and revenue trends with Premium.
          </p>
          <a href="/plans" onClick={() => sessionStorage.setItem('pocketlink_verified_phone', '')}
             className="inline-flex items-center gap-1.5 mt-4 text-white font-bold text-xs px-5 py-2.5 rounded-xl shadow-sm"
             style={{ backgroundColor: themeColor }}>
            Upgrade to Premium →
          </a>
        </div>
      )}
    </div>
  );
}

import { useState, useEffect, useCallback } from 'react';
import { TrendingUp, TrendingDown, Lock, Sparkles, Clock, Wallet } from 'lucide-react';
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
export default function AnalyticsTab({ slug, pin, themeColor = '#0d9488', enabled = false, advanced = false, products = [], packagingCost = 0, deliveryCost = 0, onGoTab }) {
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

  // ── Profit Brain — real profit from per-product cost prices. Profit is computed
  // only over items whose product has a cost set, so the number is honest (an
  // unpriced product is excluded, not counted as pure profit). Item-level: profit
  // on the goods themselves (before delivery/gateway costs), which is what the
  // seller most needs and what we can compute cleanly. ──
  const costByName = {};
  let productsWithCost = 0;
  for (const p of (products || [])) {
    if (p && p.name) {
      const c = Number(p.cost);
      if (Number.isFinite(c) && c > 0) { costByName[p.name] = c; productsWithCost++; }
    }
  }
  const totalProducts = (products || []).filter((p) => p && p.name).length;

  const profByProd = {};
  let soldRevenue = 0, cogs = 0, uncoveredUnits = 0;
  for (const o of valid) for (const it of (o.items || [])) {
    const qty = Number(it.qty) || 0;
    const rev = (Number(it.price) || 0) * qty;
    const unitCost = costByName[it.name];
    if (unitCost != null) {
      const c = unitCost * qty;
      soldRevenue += rev; cogs += c;
      const k = it.name;
      profByProd[k] = profByProd[k] || { rev: 0, cost: 0, qty: 0 };
      profByProd[k].rev += rev; profByProd[k].cost += c; profByProd[k].qty += qty;
    } else if (qty) { uncoveredUnits += qty; }
  }
  const grossProfit = soldRevenue - cogs;
  const margin = soldRevenue > 0 ? Math.round((grossProfit / soldRevenue) * 100) : 0;
  const hasCostData = productsWithCost > 0 && soldRevenue > 0;
  const profRanked = Object.entries(profByProd)
    .map(([name, v]) => ({ name, profit: v.rev - v.cost, margin: v.rev > 0 ? Math.round(((v.rev - v.cost) / v.rev) * 100) : 0 }))
    .sort((a, b) => b.profit - a.profit);
  const bestProfMax = Math.max(1, ...profRanked.map((p) => Math.abs(p.profit)));
  const thin = profRanked.filter((p) => p.margin < 15);

  // ── Operating costs → real profit. Packaging is a flat spend on every order;
  // delivery uses the ACTUAL courier charge saved at booking (order.shipping_cost)
  // and falls back to the store's flat "delivery cost / order" for orders not booked
  // through PocketLink. deliveryCharged (order.shipping) is what customers paid for
  // delivery — comparing the two surfaces a hidden delivery loss. ──
  const pkgPer  = Number(packagingCost) > 0 ? Number(packagingCost) : 0;
  const dlvFlat = Number(deliveryCost)  > 0 ? Number(deliveryCost)  : 0;
  let deliverySpend = 0, deliveryKnown = 0, deliveryCharged = 0;
  for (const o of valid) {
    const sc = Number(o.shipping_cost);
    if (Number.isFinite(sc) && sc > 0) { deliverySpend += sc; deliveryKnown++; }
    else if (dlvFlat > 0)              { deliverySpend += dlvFlat; }
    deliveryCharged += Number(o.shipping) || 0;
  }
  const packagingSpend = pkgPer * count;
  const operatingCosts = packagingSpend + deliverySpend;
  const hasOpCosts     = hasCostData && operatingCosts > 0;
  const netProfit      = grossProfit - operatingCosts;
  const netMargin      = soldRevenue > 0 ? Math.round((netProfit / soldRevenue) * 100) : 0;
  // Headline flips to the after-costs number once any operating cost is known.
  const headProfit = hasOpCosts ? netProfit : grossProfit;
  const headMargin = hasOpCosts ? netMargin : margin;
  const deliveryLoss = hasOpCosts && deliverySpend > 0 && (deliverySpend - deliveryCharged) >= 20;
  const pnl = [
    { label: 'Sales', v: soldRevenue, neg: false },
    { label: 'Cost of goods', v: cogs, neg: true },
    ...(packagingSpend > 0 ? [{ label: 'Packaging', v: packagingSpend, neg: true }] : []),
    ...(deliverySpend  > 0 ? [{ label: 'Delivery',  v: deliverySpend,  neg: true }] : []),
  ];

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

      {/* ── Profit Brain ── */}
      {productsWithCost === 0 ? (
        <div className="rounded-2xl border-2 border-dashed p-5" style={{ borderColor: `${themeColor}55`, background: `${themeColor}08` }}>
          <div className="flex items-center gap-2 mb-1.5">
            <Wallet size={18} style={{ color: themeColor }} />
            <p className="font-extrabold text-gray-900 text-sm">See your real profit</p>
          </div>
          <p className="text-xs text-gray-500 max-w-sm">
            Add a <b>cost price</b> to your products and PocketLink shows exactly what you <b>earn</b> — not just what you sell. Takes a minute.
          </p>
          <button onClick={() => onGoTab?.('products')}
            className="mt-3 inline-flex items-center gap-1.5 text-white font-bold text-xs px-4 py-2 rounded-xl active:scale-95"
            style={{ backgroundColor: themeColor }}>
            Add cost prices →
          </button>
        </div>
      ) : (
        <div className="rounded-2xl border border-gray-100 bg-white shadow-sm p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-bold text-gray-900 flex items-center gap-1.5">
              <Wallet size={15} style={{ color: themeColor }} /> Profit
            </p>
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full"
                  style={{ color: headProfit >= 0 ? '#15803d' : '#b91c1c', background: headProfit >= 0 ? '#dcfce7' : '#fee2e2' }}>
              {headMargin}% margin
            </span>
          </div>
          <div>
            <p className="text-3xl font-extrabold tabular-nums leading-none"
               style={{ color: headProfit >= 0 ? '#16a34a' : '#dc2626' }}>
              {formatINR(Math.round(headProfit))}
            </p>
            <p className="text-[11px] text-gray-400 mt-1">{hasOpCosts ? 'net profit after costs' : 'net profit on goods sold'}</p>
          </div>

          {/* Receipt-style breakdown — Sales minus each cost */}
          <div className="mt-3 border-t border-gray-100 pt-3 space-y-1.5">
            {pnl.map((r) => (
              <div key={r.label} className="flex items-center justify-between text-[12px]">
                <span className="text-gray-500">{r.label}</span>
                <span className="tabular-nums font-semibold text-gray-700">{r.neg ? '−' : ''}{formatINR(Math.round(r.v))}</span>
              </div>
            ))}
          </div>

          {deliveryLoss && (
            <p className="mt-3 text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-1.5 leading-snug">
              🚚 <b>Delivery is eating your profit</b> — you collected {formatINR(Math.round(deliveryCharged))} for delivery but paid couriers {formatINR(Math.round(deliverySpend))}. Consider a small delivery fee or a free-delivery minimum.
            </p>
          )}
          {uncoveredUnits > 0 && (
            <p className="mt-3 text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-1.5">
              ⚠️ {productsWithCost} of {totalProducts} products have a cost price — add the rest for full accuracy.
              <button onClick={() => onGoTab?.('products')} className="ml-1 font-bold underline" style={{ color: themeColor }}>Fix →</button>
            </p>
          )}
          {!hasOpCosts && (
            <button onClick={() => onGoTab?.('delivery')}
              className="mt-3 text-[11px] font-bold active:scale-95" style={{ color: themeColor }}>
              + Add packaging &amp; delivery costs for true profit →
            </button>
          )}
          <p className="mt-2 text-[10px] text-gray-400">
            {hasOpCosts
              ? 'Includes cost of goods, packaging & courier charges. Payment-gateway fees not counted.'
              : 'Profit on the items themselves — add packaging & delivery costs to see profit after everything.'}
          </p>
        </div>
      )}

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

      {/* Profit by product — best earners + thin-margin flags */}
      {hasCostData && profRanked.length > 0 && (
        <div className="rounded-2xl border border-gray-100 bg-white shadow-sm p-4">
          <p className="text-sm font-bold text-gray-900 mb-3">Profit by product</p>
          <div className="space-y-2.5">
            {profRanked.slice(0, 6).map((p) => (
              <div key={p.name}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="font-semibold text-gray-700 truncate pr-2">{p.name}</span>
                  <span className="flex-shrink-0 tabular-nums inline-flex items-center gap-1.5">
                    <span className="font-bold" style={{ color: p.profit >= 0 ? '#16a34a' : '#dc2626' }}>{formatINR(Math.round(p.profit))}</span>
                    <span className={['text-[10px] font-bold px-1.5 py-0.5 rounded', p.margin < 15 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-50 text-emerald-600'].join(' ')}>{p.margin}%</span>
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${(Math.abs(p.profit) / bestProfMax) * 100}%`, backgroundColor: p.profit >= 0 ? themeColor : '#dc2626' }} />
                </div>
              </div>
            ))}
          </div>
          {thin.length > 0 && (
            <p className="mt-3 text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-1.5 leading-snug">
              💡 <b>Thin margin:</b> {thin.slice(0, 3).map((p) => p.name).join(', ')}{thin.length > 3 ? ` +${thin.length - 3} more` : ''} — under 15%. Consider raising the price or bundling a combo.
            </p>
          )}
        </div>
      )}

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

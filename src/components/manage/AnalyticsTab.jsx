import { useState, useEffect, useCallback, useMemo, useRef, useId } from 'react';
import { isPaymentIncomplete } from '../../utils/orderState';
import { TrendingUp, TrendingDown, Lock, Sparkles, Clock, Wallet } from 'lucide-react';
import { fetchOrders, fetchOrderFacts } from '../../utils/orderService';
import { buildStatsMetrics, chartDayLabel } from '../../utils/statsMetrics';
import { fetchViewStats } from '../../utils/viewService';
import { formatINR } from '../../utils/currency';
import { unitCostForItem, hasAnyCost } from '../../utils/variants';
import { pinColors } from '../../utils/pinGate';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// The merchant's clock. Day and hour buckets are theirs, not the browser's.
const STORE_TZ = 'Asia/Kolkata';
const fmtHour = (h) => { const m = h % 12 === 0 ? 12 : h % 12; return `${m}${h < 12 ? 'am' : 'pm'}`; };
// Products listed before "Show all".
const PRODUCT_ROWS = 8;

/**
 * Sales analytics — derived entirely from the orders table (no extra setup).
 * Both paid tiers include analytics: Standard sees the core dashboard; Premium
 * (`advanced`) also gets behavioural insights — returning customers, peak hours,
 * best day and the revenue trend. A lapsed/unpaid page sees an upsell.
 */
export default function AnalyticsTab({ slug, pin, themeColor = '#0d9488', enabled = false, advanced = false, products = [], packagingCost = 0, deliveryCost = 0, onGoTab }) {
  // TWO feeds, deliberately.
  //  facts  - get_store_order_facts: UNCAPPED and PII-free. Every accounting
  //           scalar on this screen is built from it, through commerceMetrics.
  //  orders - fetchOrders: every real order. It is the only feed carrying
  //           items and phone numbers, so top products, profit and customer
  //           counts need it. It pages and can come back partial (an older
  //           page failed) - and then those sections say so on screen.
  // The facts RESULT, not its rows: { ok, data, reason }. Keeping the envelope
  // is the whole point - see the failure branch below.
  const [factsResult, setFactsResult] = useState(null);
  const [orders, setOrders] = useState(null);
  const [views,  setViews]  = useState(null);
  // The one clock reading on this screen, taken when the feed lands rather than
  // during render, so the rolling windows are stable across re-renders and the
  // numbers describe a single moment.
  const [loadedAt, setLoadedAt] = useState(null);
  // The chart: how many days back, and sales or orders (sales per day is Premium).
  const [range, setRange] = useState(14);
  const [chartKind, setChartKind] = useState('sales');
  const [showAllProducts, setShowAllProducts] = useState(false);

  const load = useCallback(async () => {
    if (!enabled) return;
    const [f, o, v] = await Promise.all([
      fetchOrderFacts(slug, pin), fetchOrders(slug, pin), fetchViewStats(slug),
    ]);
    setFactsResult(f);
    setOrders(o);
    setViews(v);
    setLoadedAt(Date.now());
  }, [slug, pin, enabled]);

  useEffect(() => { load(); }, [load]);

  // Hooks must run in the same order on every render, so this sits ABOVE the
  // upsell and loading returns below. buildStatsMetrics is total: a null feed
  // gives zeroes rather than throwing, and the result is simply unused until
  // the data arrives.
  // Only ever built from a SUCCESSFUL facts read. On failure the rows are empty
  // and this computes zeroes - which is exactly why the render below refuses to
  // show them and returns the error state instead.
  const stats = useMemo(
    () => buildStatsMetrics(factsResult?.ok ? factsResult.data : [], {
      timeZone: STORE_TZ, now: loadedAt, chartDays: range,
    }),
    [factsResult, loadedAt, range],
  );

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

  if (orders === null || factsResult === null) {
    return (
      <div className="grid grid-cols-2 gap-3">
        {[0, 1, 2, 3].map((i) => <div key={i} className="h-24 rounded-2xl bg-white border border-gray-100 animate-pulse" />)}
      </div>
    );
  }

  // ── The accounting feed failed: say so, do NOT show zero ──────────────
  // An empty result and a failed one both compute to 0, and for an accounting
  // screen that is the difference between "you have made no sales" and "we
  // could not reach the server". Falling back to the detailed feed here would
  // be worse still: it is capped at 500 rows, so it would quietly under-report
  // real money as if it were the total. Show nothing and offer a retry.
  if (!factsResult.ok) {
    return (
      <div className="rounded-2xl border border-gray-100 bg-white shadow-sm p-8 text-center">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-amber-50 flex items-center justify-center mb-3">
          <Wallet size={22} className="text-amber-500" />
        </div>
        <h3 className="font-extrabold text-gray-900">Couldn&rsquo;t load your sales figures</h3>
        <p className="text-sm text-gray-500 mt-1.5 max-w-xs mx-auto">
          Your orders are safe &mdash; this screen just couldn&rsquo;t reach them. Check your
          connection and try again.
        </p>
        <button type="button" onClick={load}
          className="inline-flex items-center gap-2 mt-5 text-white font-bold text-sm px-6 py-3 rounded-xl shadow-lg active:scale-[0.98] transition-transform"
          style={{ backgroundColor: themeColor }}>
          Try again
        </button>
      </div>
    );
  }

  // ── Canonical accounting ──────────────────────────────────────────────
  // Revenue, order count, AOV, both charts and the busy-time histograms come
  // from commerceMetrics over the UNCAPPED facts feed. No population, filter or
  // classification is defined here - see src/utils/statsMetrics.js.
  //
  // Gross Sales, Sales Orders and Average Order Value are ALL-TIME AGGREGATES:
  // every order the store has taken, never range-scoped, and this screen has no
  // date selector to say otherwise. They are not balances - that word belongs to
  // the position metrics (Collected / Outstanding / Written Off) on Payments.
  //
  // Only the two charts and the week-on-week comparison are flows, and each is
  // bounded by an explicit range.
  const revenue  = stats.revenue;
  const count    = stats.orders;
  const aov      = stats.aov;
  // The till-date total, the same number as Orders -> All dates. Revenue and
  // the average are over `count`: cancelled and unpaid orders earned nothing.
  const placed   = stats.placed;
  const notCounted = [
    stats.cancelledOrders > 0 && `${stats.cancelledOrders} cancelled`,
    stats.unpaidOrders > 0 && `${stats.unpaidOrders} payment not completed`,
  ].filter(Boolean).join(' · ');
  const thisWeek = stats.thisWeekOrders;
  const wow      = stats.wow;

  // ── Detailed-order metrics: every order, unless a page failed ─────────
  // Everything below needs items or a phone number, which the facts feed does
  // not carry, so it stays on fetchOrders. Kept separate from the numbers
  // above on purpose: do not mix a possibly partial figure into a complete one.
  const valid   = orders.filter((o) => o.status !== 'cancelled' && !isPaymentIncomplete(o));
  const capped  = orders.partial === true;   // fetchOrders: an older page failed
  const customers = new Set(valid.map((o) => o.customer_phone).filter(Boolean)).size;

  // Reach → orders funnel. Compared on the same 7-day window so it's apples-to-
  // apples (views only started logging recently). Capped at 100% for sanity.
  const totalViews = views?.total ?? 0;
  const weekViews  = views?.week  ?? 0;
  const conv = weekViews > 0 ? Math.min(100, Math.round((thisWeek / weekViews) * 100)) : null;

  // Top products by revenue
  const pmap = {};
  for (const o of valid) for (const it of (o.items || [])) {
    const k = it.name || 'Item';
    pmap[k] = pmap[k] || { qty: 0, rev: 0 };
    pmap[k].qty += it.qty || 0;
    pmap[k].rev += (it.price || 0) * (it.qty || 0);
  }

  // ── Profit Brain — real profit from per-product cost prices. Profit is computed
  // only over items whose product has a cost set, so the number is honest (an
  // unpriced product is excluded, not counted as pure profit). Item-level: profit
  // on the goods themselves (before delivery/gateway costs), which is what the
  // seller most needs and what we can compute cleanly. ──
  const prodByName = {};
  let productsWithCost = 0;
  for (const p of (products || [])) {
    if (p && p.name) {
      prodByName[p.name] = p;
      if (hasAnyCost(p)) productsWithCost++;   // base cost OR any variant cost
    }
  }
  const totalProducts = (products || []).filter((p) => p && p.name).length;

  const profByProd = {};
  let soldRevenue = 0, cogs = 0, uncoveredUnits = 0;
  for (const o of valid) for (const it of (o.items || [])) {
    const qty = Number(it.qty) || 0;
    const rev = (Number(it.price) || 0) * qty;
    // Per-variant cost: a picked option's own cost, else the product's base cost.
    const unitCost = unitCostForItem(prodByName[it.name], it);
    if (unitCost != null) {
      const c = unitCost * qty;
      soldRevenue += rev; cogs += c;
      const k = it.name;
      profByProd[k] = profByProd[k] || { rev: 0, cost: 0, qty: 0 };
      profByProd[k].rev += rev; profByProd[k].cost += c; profByProd[k].qty += qty;
    } else if (qty) { uncoveredUnits += qty; }
  }
  const grossProfit = soldRevenue - cogs;
  const hasCostData = productsWithCost > 0 && soldRevenue > 0;
  const profRanked = Object.entries(profByProd)
    .map(([name, v]) => ({ name, profit: v.rev - v.cost, margin: v.rev > 0 ? Math.round(((v.rev - v.cost) / v.rev) * 100) : 0 }))
    .sort((a, b) => b.profit - a.profit);
  const thin = profRanked.filter((p) => p.margin < 15);

  // ── Operating costs → real profit. Packaging is a flat spend on every order;
  // delivery uses the ACTUAL courier charge saved at booking (order.shipping_cost)
  // and falls back to the store's flat "delivery cost / order" for orders not booked
  // through PocketLink. deliveryCharged (order.shipping) is what customers paid for
  // delivery — comparing the two surfaces a hidden delivery loss. ──
  const pkgPer  = Number(packagingCost) > 0 ? Number(packagingCost) : 0;
  const dlvFlat = Number(deliveryCost)  > 0 ? Number(deliveryCost)  : 0;
  let deliverySpend = 0, deliveryKnown = 0, deliveryCharged = 0, codCharged = 0, pkgCharged = 0;
  for (const o of valid) {
    const sc = Number(o.shipping_cost);
    if (Number.isFinite(sc) && sc > 0) { deliverySpend += sc; deliveryKnown++; }
    else if (dlvFlat > 0)              { deliverySpend += dlvFlat; }
    deliveryCharged += Number(o.shipping)  || 0;   // delivery fee the customer paid
    codCharged      += Number(o.cod_fee)   || 0;   // COD fee the customer paid
    pkgCharged      += Number(o.packaging) || 0;   // packaging fee the customer paid
  }
  const packagingSpend = pkgPer * count;
  const operatingCosts = packagingSpend + deliverySpend;
  const hasOpCostsSet  = hasCostData && operatingCosts > 0;
  // Fees the customer pays on top of the goods (delivery + COD + packaging) are
  // revenue that offsets the courier / packaging spend — credit them, otherwise
  // the courier charge is subtracted for free and profit reads too low (even
  // negative), the same bug the per-order card had. Mirrors OrdersTab (o.total).
  const feesCharged    = deliveryCharged + codCharged + pkgCharged;
  const netProfit      = grossProfit + feesCharged - operatingCosts;
  const netRevenue     = soldRevenue + feesCharged;
  const netMargin      = netRevenue > 0 ? Math.round((netProfit / netRevenue) * 100) : 0;
  // Headline is always the true number (goods margin + fees − costs); with no
  // costs or fees it equals the goods-only profit, still nudging owners to add costs.
  const headProfit = netProfit;
  const headMargin = netMargin;
  const deliveryLoss = hasOpCostsSet && deliverySpend > 0 && (deliverySpend - deliveryCharged) >= 20;
  const pnl = [
    { label: 'Sales', v: soldRevenue, neg: false },
    ...(feesCharged   > 0 ? [{ label: 'Delivery & COD fees', v: feesCharged,   neg: false }] : []),
    { label: 'Cost of goods', v: cogs, neg: true },
    ...(packagingSpend > 0 ? [{ label: 'Packaging',     v: packagingSpend, neg: true }] : []),
    ...(deliverySpend  > 0 ? [{ label: 'Delivery cost', v: deliverySpend,  neg: true }] : []),
  ];

  // ── Advanced (Premium) metrics — behaviour from the same orders ──
  // Returning customers: buyers (by phone) with more than one order.
  const byPhone = {};
  for (const o of valid) { if (o.customer_phone) byPhone[o.customer_phone] = (byPhone[o.customer_phone] || 0) + 1; }
  const returning  = Object.values(byPhone).filter((n) => n > 1).length;
  const repeatRate = customers ? Math.round((returning / customers) * 100) : 0;

  // Peak ordering hour and busiest weekday - canonical, in the STORE's clock
  // rather than whatever zone the browser happens to be in, and over every
  // order rather than the newest 500.
  const hours    = stats.hours;
  const peakHour = stats.peakHour;
  const maxHour  = Math.max(1, ...hours);
  const bestDow  = stats.busiestWeekday;

  // The canonical feed is the population of record and is a superset of the
  // detailed one, so "nothing here yet" is its answer to give. Reaching this
  // line at all means the read succeeded.
  if (factsResult.data.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50/50 p-10 text-center">
        <div className="text-4xl mb-3">📊</div>
        <p className="font-bold text-gray-800">No data yet</p>
        <p className="text-sm text-gray-400 mt-1">Your sales stats will appear here once you start getting orders.</p>
      </div>
    );
  }

  // Says, on the sections that cannot see past the cap, that they cannot.
  // Only present when older orders failed to load, so a complete list - the
  // normal case - sees nothing extra. An element,
  // not a component, so it is not redeclared on every render.
  const capNote = capped ? (
    <span className="text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-100 px-2 py-0.5 rounded-lg whitespace-nowrap">
      last {orders.length} orders
    </span>
  ) : null;

  const Stat = ({ label, value, sub, tone }) => (
    <div className="rounded-2xl border border-gray-100 bg-white shadow-sm p-4 min-w-0">
      <p className="text-[11px] font-bold text-gray-500 uppercase tracking-[0.12em]">{label}</p>
      <p className="text-[22px] font-extrabold mt-2 leading-none tabular-nums" style={{ color: tone || '#111827' }}>{value}</p>
      {sub && <div className="mt-1.5">{sub}</div>}
    </div>
  );
  const card = 'rounded-2xl border border-gray-100 bg-white shadow-sm';
  const btn = pinColors(themeColor).button;
  // The chart: sales per day (Premium) or orders per day, over the chosen days.
  const showSales = advanced && chartKind === 'sales';
  const points = stats.days.map((d) => ({ key: d.key, label: chartDayLabel(d.key), v: showSales ? d.revenue : d.orders }));
  const periodTotal = points.reduce((s, p) => s + p.v, 0);
  // Products: what sold most, with the profit on it where a cost price is set.
  const productRows = Object.entries(pmap).sort((a, b) => b[1].rev - a[1].rev).map(([name, v]) => {
    const pr = profByProd[name];
    return { name, qty: v.qty, rev: v.rev, profit: pr ? pr.rev - pr.cost : null, margin: pr && pr.rev > 0 ? Math.round(((pr.rev - pr.cost) / pr.rev) * 100) : null };
  });
  const prodShown = showAllProducts ? productRows : productRows.slice(0, PRODUCT_ROWS);
  const imgFor = (name) => { const p = prodByName[name]; return p?.image || (Array.isArray(p?.images) ? p.images[0] : '') || ''; };

  return (
    <div className="space-y-5">
      {/* The four numbers that matter: two across on a phone, four on a computer */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Revenue" value={formatINR(revenue)} sub={<span className="text-[12px] font-semibold text-gray-500">from {count} orders</span>} tone="#047857" />
        <Stat label="Total orders" value={placed} sub={<>
          <span className={['text-[12px] font-semibold inline-flex items-center gap-0.5', wow >= 0 ? 'text-emerald-700' : 'text-red-600'].join(' ')}>
            {wow >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}{Math.abs(wow)}% vs last week
          </span>
          {notCounted && <span className="block text-[11px] text-gray-400 mt-0.5">{notCounted}</span>}
        </>} />
        <Stat label="Page visits" value={totalViews.toLocaleString('en-IN')} sub={
          <span className="text-[12px] font-semibold text-gray-500">
            {weekViews.toLocaleString('en-IN')} this week{conv === null ? '' : ` · ${conv}% bought`}
          </span>} />
        <Stat label="Real profit" value={productsWithCost === 0 ? '—' : formatINR(Math.round(headProfit))}
          tone={productsWithCost === 0 ? '#9ca3af' : headProfit >= 0 ? btn : '#dc2626'}
          sub={productsWithCost === 0 ? (
            <button type="button" onClick={() => onGoTab?.('products')} className="text-[12px] font-bold" style={{ color: btn }}>Add cost prices →</button>
          ) : <span className="text-[12px] font-semibold text-gray-500">{headMargin}% of sales{hasOpCostsSet ? ' · after costs' : ''}</span>} />
      </div>

      {/* ── Every day, as a line you can read off with the pointer ─────────── */}
      <div className={`${card} p-5`}>
        <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
          <div>
            <h3 className="text-[15px] font-extrabold text-gray-900">{showSales ? 'Sales every day' : 'Orders every day'}</h3>
            <p className="text-[12px] text-gray-500 mt-0.5">
              {showSales ? formatINR(Math.round(periodTotal)) : `${periodTotal} order${periodTotal === 1 ? '' : 's'}`} in the last {range} days · move over the chart to see each day
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {advanced && (
              <Seg value={chartKind} onChange={setChartKind} options={[['sales', 'Sales'], ['orders', 'Orders']]} />
            )}
            <Seg value={range} onChange={setRange} options={[[7, '7 days'], [14, '14 days'], [30, '30 days']]} />
          </div>
        </div>
        <DailyChart points={points} money={showSales} color={themeColor} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2 items-start">
        {/* ── Where the money goes: the hisaab, line by line ─────────────────── */}
        {productsWithCost === 0 ? (
          <div className="rounded-2xl border-2 border-dashed p-5" style={{ borderColor: `${themeColor}55`, background: `${themeColor}08` }}>
            <div className="flex items-center gap-2 mb-1.5">
              <Wallet size={18} style={{ color: btn }} />
              <p className="font-extrabold text-gray-900 text-[15px]">See your real profit</p>
            </div>
            <p className="text-[13px] text-gray-500 max-w-sm">
              Add a <b>cost price</b> to your products and PocketLink shows exactly what you <b>earn</b> — not just what you sell. Takes a minute.
            </p>
            <button onClick={() => onGoTab?.('products')}
              className="mt-3 inline-flex items-center gap-1.5 text-white font-bold text-[13px] px-4 py-2 rounded-xl active:scale-95"
              style={{ backgroundColor: btn }}>
              Add cost prices →
            </button>
          </div>
        ) : (
          <div className={`${card} p-5`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-[15px] font-extrabold text-gray-900">Where your money goes</h3>
                <p className="text-[12px] text-gray-500 mt-0.5">Profit after every cost, like a real hisaab</p>
              </div>
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full flex-shrink-0"
                    style={{ color: headProfit >= 0 ? '#15803d' : '#b91c1c', background: headProfit >= 0 ? '#dcfce7' : '#fee2e2' }}>
                {headMargin}% margin
              </span>
            </div>

            {/* Receipt-style breakdown — Sales minus each cost */}
            <div className="mt-3">
              {pnl.map((r) => (
                <div key={r.label} className="flex items-center justify-between py-2 border-b border-gray-100 text-[14px]">
                  <span className={r.neg ? 'text-gray-500' : 'text-gray-900'}>{r.label}</span>
                  <span className={`tabular-nums font-semibold ${r.neg ? 'text-gray-500' : 'text-gray-900'}`}>{r.neg ? '− ' : ''}{formatINR(Math.round(r.v))}</span>
                </div>
              ))}
              <div className="flex items-center justify-between pt-3 text-[16px] font-extrabold">
                <span className="text-gray-900">You keep</span>
                <span className="tabular-nums" style={{ color: headProfit >= 0 ? btn : '#dc2626' }}>{formatINR(Math.round(headProfit))}</span>
              </div>
            </div>

            {deliveryLoss && (
              <p className="mt-3 text-[12px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-1.5 leading-snug">
                🚚 <b>Delivery is eating your profit</b> — you collected {formatINR(Math.round(deliveryCharged))} for delivery but paid couriers {formatINR(Math.round(deliverySpend))}. Consider a small delivery fee or a free-delivery minimum.
              </p>
            )}
            {uncoveredUnits > 0 && (
              <p className="mt-3 text-[12px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-1.5">
                ⚠️ {productsWithCost} of {totalProducts} products have a cost price — add the rest for full accuracy.
                <button onClick={() => onGoTab?.('products')} className="ml-1 font-bold underline" style={{ color: btn }}>Fix →</button>
              </p>
            )}
            {!hasOpCostsSet && (
              <button onClick={() => onGoTab?.('delivery')}
                className="mt-3 text-[12px] font-bold active:scale-95" style={{ color: btn }}>
                + Add packaging &amp; delivery costs for true profit →
              </button>
            )}
            <p className="mt-2 text-[11px] text-gray-400">
              {hasOpCostsSet
                ? 'Counts delivery & COD fees you charged as income, minus cost of goods, packaging & courier. Payment-gateway fees not counted.'
                : 'Profit on the items themselves — add packaging & delivery costs to see profit after everything.'}
              {' '}Cancelled orders are excluded from Sales &amp; Profit.{capped ? ` Counts the last ${orders.length} orders.` : ''}
            </p>
          </div>
        )}

        {/* ── Your buyers: who comes back, when they order ───────────────────── */}
        <div className={`${card} p-5`}>
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-[15px] font-extrabold text-gray-900">Your buyers</h3>
            {capNote}
          </div>
          <div className="grid grid-cols-2 gap-2.5 mt-3">
            <div className="rounded-xl bg-gray-50 p-3">
              <p className="font-extrabold tabular-nums text-[18px] text-gray-900">{formatINR(Math.round(aov))}</p>
              <p className="text-[11.5px] text-gray-500 font-semibold">Average order</p>
            </div>
            <div className="rounded-xl bg-gray-50 p-3">
              <p className="font-extrabold tabular-nums text-[18px] text-gray-900">{customers}</p>
              <p className="text-[11.5px] text-gray-500 font-semibold">Customers · unique buyers</p>
            </div>
            {advanced && (<>
              <div className="rounded-xl bg-gray-50 p-3">
                <p className="font-extrabold tabular-nums text-[18px] text-gray-900">{returning}</p>
                <p className="text-[11.5px] text-gray-500 font-semibold">Returning · {repeatRate}% reorder</p>
              </div>
              <div className="rounded-xl bg-gray-50 p-3">
                <p className="font-extrabold text-[18px] text-gray-900">{bestDow === null ? '—' : DOW[bestDow]}</p>
                <p className="text-[11.5px] text-gray-500 font-semibold">Busiest day</p>
              </div>
            </>)}
          </div>

          {advanced ? (
            <div className="mt-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[13px] font-bold text-gray-800 flex items-center gap-1.5">
                  <Clock size={14} className="text-gray-400" /> When orders come in
                </p>
                {peakHour !== null && (
                  <span className="text-[12px] font-semibold text-gray-600">Busiest ~{fmtHour(peakHour)}</span>
                )}
              </div>
              <div className="flex items-end gap-[2px] h-20">
                {hours.map((n, h) => (
                  <div key={h} className="flex-1 rounded-t-[3px]" title={`${fmtHour(h)} · ${n} order${n === 1 ? '' : 's'}`}
                       style={{ height: `${(n / maxHour) * 100}%`, minHeight: n ? 3 : 1,
                                backgroundColor: h === peakHour ? themeColor : `${themeColor}40` }} />
                ))}
              </div>
              <div className="flex justify-between text-[10.5px] text-gray-400 mt-1">
                <span>12am</span><span>6am</span><span>12pm</span><span>6pm</span><span>11pm</span>
              </div>
            </div>
          ) : (
            /* ── Standard → tease the Premium insights ── */
            <div className="mt-4 rounded-xl border border-dashed p-4 text-center"
                 style={{ borderColor: `${themeColor}55`, background: `${themeColor}08` }}>
              <Sparkles size={18} className="mx-auto" style={{ color: btn }} />
              <p className="font-extrabold text-gray-900 text-sm mt-1.5">Unlock advanced insights</p>
              <p className="text-xs text-gray-500 mt-1 max-w-xs mx-auto">
                See returning customers, peak ordering hours, your busiest day and sales every day with Premium.
              </p>
              <a href="/plans" onClick={() => sessionStorage.setItem('pocketlink_verified_phone', '')}
                 className="inline-flex items-center gap-1.5 mt-3 text-white font-bold text-xs px-5 py-2.5 rounded-xl shadow-sm"
                 style={{ backgroundColor: btn }}>
                Upgrade to Premium →
              </a>
            </div>
          )}
        </div>
      </div>

      {/* ── Products: what sold, and what each one earns ─────────────────────── */}
      <div className={card}>
        <div className="flex items-center justify-between gap-2 px-5 pt-4 pb-2">
          <h3 className="text-[15px] font-extrabold text-gray-900">Products</h3>
          {capNote}
        </div>
        {productRows.length === 0 ? (
          <p className="px-5 pb-5 text-[13px] text-gray-400">No products sold yet.</p>
        ) : (<>
          {/* Phone: one stacked row per product, nothing to slide sideways. */}
          <ul className="sm:hidden divide-y divide-gray-100 border-t border-gray-100">
            {prodShown.map((p) => (
              <li key={p.name} className="flex items-center gap-3 px-4 py-3">
                {imgFor(p.name)
                  ? <img src={imgFor(p.name)} alt="" className="w-10 h-10 rounded-lg object-cover bg-gray-100 flex-shrink-0" />
                  : <span className="w-10 h-10 rounded-lg bg-gray-100 flex-shrink-0" />}
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-[14px] text-gray-800 truncate">{p.name}</p>
                  <p className="text-[12.5px] text-gray-500 tabular-nums">{p.qty} sold · <b className="text-gray-900">{formatINR(Math.round(p.rev))}</b></p>
                </div>
                {p.profit !== null && (
                  <div className="text-right flex-shrink-0">
                    <p className="font-bold text-[14px] tabular-nums" style={{ color: p.profit >= 0 ? '#15803d' : '#dc2626' }}>{formatINR(Math.round(p.profit))}</p>
                    <span className={['text-[10.5px] font-bold px-1.5 py-0.5 rounded', p.margin < 15 ? 'bg-amber-100 text-amber-800' : 'bg-emerald-50 text-emerald-700'].join(' ')}>{p.margin}% profit</span>
                  </div>
                )}
              </li>
            ))}
          </ul>
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-sm min-w-[440px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-[0.1em] text-gray-500">
                  <th className="font-bold px-5 py-2">Product</th>
                  <th className="font-bold py-2 pl-3 text-right">Sold</th>
                  <th className="font-bold py-2 pl-4 text-right">Sales</th>
                  <th className="font-bold py-2 pl-4 text-right pr-5">Profit</th>
                </tr>
              </thead>
              <tbody>
                {prodShown.map((p) => (
                  <tr key={p.name} className="border-t border-gray-100">
                    <td className="px-5 py-2.5">
                      <div className="flex items-center gap-2.5 min-w-0">
                        {imgFor(p.name)
                          ? <img src={imgFor(p.name)} alt="" className="w-8 h-8 rounded-lg object-cover bg-gray-100 flex-shrink-0" />
                          : <span className="w-8 h-8 rounded-lg bg-gray-100 flex-shrink-0" />}
                        <span className="font-semibold text-gray-800 truncate">{p.name}</span>
                      </div>
                    </td>
                    <td className="py-2.5 pl-3 text-right tabular-nums text-gray-700">{p.qty}</td>
                    <td className="py-2.5 pl-4 text-right tabular-nums font-bold text-gray-900">{formatINR(Math.round(p.rev))}</td>
                    <td className="py-2.5 pl-4 text-right pr-5 tabular-nums whitespace-nowrap">
                      {p.profit === null ? <span className="text-gray-300">—</span> : (
                        <span className="inline-flex items-center gap-1.5 justify-end">
                          <span className="font-bold" style={{ color: p.profit >= 0 ? '#15803d' : '#dc2626' }}>{formatINR(Math.round(p.profit))}</span>
                          <span className={['text-[10.5px] font-bold px-1.5 py-0.5 rounded', p.margin < 15 ? 'bg-amber-100 text-amber-800' : 'bg-emerald-50 text-emerald-700'].join(' ')}>{p.margin}%</span>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>)}
        {productRows.length > PRODUCT_ROWS && (
          <div className="px-5 py-3 border-t border-gray-100">
            <button type="button" onClick={() => setShowAllProducts((v) => !v)} className="text-[13px] font-bold" style={{ color: btn }}>
              {showAllProducts ? 'Show fewer' : `Show all ${productRows.length} products`}
            </button>
          </div>
        )}
        {hasCostData && thin.length > 0 && (
          <p className="mx-5 mb-4 text-[12px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-1.5 leading-snug">
            💡 <b>Thin margin:</b> {thin.slice(0, 3).map((p) => p.name).join(', ')}{thin.length > 3 ? ` +${thin.length - 3} more` : ''} — under 15%. Consider raising the price or bundling a combo.
          </p>
        )}
      </div>
    </div>
  );
}

// A small segmented switch (the prototype's): one of a few choices, the picked one raised.
function Seg({ value, options, onChange }) {
  return (
    <div className="inline-flex p-1 rounded-xl bg-gray-100 gap-1" role="tablist">
      {options.map(([v, label]) => (
        <button key={v} type="button" role="tab" aria-selected={value === v} onClick={() => onChange(v)}
          className={['h-8 px-3 rounded-lg text-[13px] font-bold whitespace-nowrap transition',
            value === v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'].join(' ')}>
          {label}
        </button>
      ))}
    </div>
  );
}

// A round top for the y axis: 1, 2 or 5 times a power of ten, so the gridlines
// land on plain numbers. Counts keep an even top so the middle line is whole.
function niceMax(v, money) {
  if (!(v > 0)) return money ? 1000 : 4;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / exp;
  let m = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * exp;
  if (!money) { m = Math.max(2, Math.ceil(m)); if (m % 2) m += 1; }
  return m;
}
const shortINR = (t) => (t >= 1000 ? `₹${Math.round((t / 1000) * 10) / 10}k` : `₹${Math.round(t)}`);
const fullDay = (key) => {
  const t = Date.parse(`${key}T12:00:00Z`);
  return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : key;
};

// One series over the days: a 2px line, a soft area under it, three faint
// gridlines, the last day marked. The pointer (or a finger) reads any day off it.
function DailyChart({ points, money, color }) {
  const ref = useRef(null);
  const [w, setW] = useState(640);
  const [hov, setHov] = useState(null);
  const gid = `area-${useId().replace(/[^a-z0-9]/gi, '')}`;
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver((e) => setW(Math.max(260, Math.floor(e[0].contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const n = points.length;
  if (n === 0) return <div ref={ref} className="h-[220px] grid place-items-center text-[13px] text-gray-400">No days to show yet</div>;
  const H = 220;
  const pad = { l: 46, r: 14, t: 16, b: 28 };
  const max = niceMax(Math.max(0, ...points.map((p) => p.v)), money);
  const last = n - 1;
  const x = (i) => pad.l + (n === 1 ? (w - pad.l - pad.r) / 2 : (i * (w - pad.l - pad.r)) / last);
  const y = (v) => pad.t + (1 - v / max) * (H - pad.t - pad.b);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ');
  const area = `${line} L${x(last).toFixed(1)} ${H - pad.b} L${x(0).toFixed(1)} ${H - pad.b} Z`;
  const ticks = [0, max / 2, max];
  const every = Math.max(1, Math.ceil(n / (w < 420 ? 4 : 7)));
  const hi = hov === null ? last : hov;
  const pick = (clientX, rect) => {
    const i = Math.round(((clientX - rect.left - pad.l) / Math.max(1, w - pad.l - pad.r)) * last);
    setHov(Math.max(0, Math.min(last, i)));
  };
  const val = (v) => (money ? formatINR(Math.round(v)) : `${v} order${v === 1 ? '' : 's'}`);
  return (
    <div ref={ref} className="relative w-full select-none">
      <svg width={w} height={H} role="img" aria-label={money ? 'Sales every day' : 'Orders every day'} className="block touch-pan-y"
           onPointerMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
           onPointerDown={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
           onPointerLeave={() => setHov(null)}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity="0.24" />
            <stop offset="1" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} stroke="#eef0ef" strokeWidth="1" />
            <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#6b7280">{money ? shortINR(t) : t}</text>
          </g>
        ))}
        <path d={area} fill={`url(#${gid})`} />
        <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => ((last - i) % every === 0 ? (
          <text key={p.key} x={x(i)} y={H - 8} textAnchor={i === last ? 'end' : i === 0 ? 'start' : 'middle'} fontSize="11" fill="#6b7280">
            {i === last ? 'Today' : fullDay(p.key)}
          </text>
        ) : null))}
        <line x1={x(hi)} x2={x(hi)} y1={pad.t} y2={H - pad.b} stroke="#d1d5db" strokeDasharray="3 3" />
        <circle cx={x(hi)} cy={y(points[hi].v)} r="5" fill={color} stroke="#fff" strokeWidth="2.5" />
      </svg>
      <div className="absolute top-0 px-2.5 py-1.5 rounded-lg bg-gray-900 text-white text-[12px] font-bold pointer-events-none whitespace-nowrap"
           style={{ left: Math.min(Math.max(x(hi) - 60, 0), Math.max(0, w - 140)) }}>
        {hi === last ? 'Today' : fullDay(points[hi].key)}: {val(points[hi].v)}
      </div>
    </div>
  );
}

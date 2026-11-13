import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ShoppingBag, ShoppingCart, Package, Star, Wallet, Truck, Coins, Eye, TrendingUp,
  Plus, Share2, Percent, RefreshCw, ChevronRight, Sparkles,
} from 'lucide-react';
import { fetchOrderFacts, fetchAbandonedCarts } from '../../utils/orderService';
import { fetchReviews } from '../../utils/reviewService';
import { fetchViewStats } from '../../utils/viewService';
import { fetchProductSales } from '../../utils/salesService';
import { getOrderMessageUsage } from '../../utils/deliveryTools';
import { coinsOf, formatCoins } from '../../utils/walletPacks';
import { buildOverviewExtras } from '../../utils/overviewStats';
import { buildOverviewMetrics, WEEKDAY_LETTERS } from '../../utils/overviewMetrics';
import { summarizeAbandoned } from '../../utils/abandonedCarts';
import { formatINR } from '../../utils/currency';
import { publicStoreUrl } from '../../utils/storeUrls';
import { shellColors } from '../../utils/dashboardShell';
import HomeLatestOrders from './HomeLatestOrders';
import { orderRef } from '../../utils/homeOrders';

// The merchant's clock. Every order-derived day boundary on this screen is
// theirs, not the browser's.
const STORE_TZ = 'Asia/Kolkata';

/**
 * OverviewTab — the Manage "Home" dashboard (redesigned 2026-11-13 from the
 * approved prototype).
 *
 * Answers the one question a shopkeeper opens the app for: "what needs me right
 * now?" Today's numbers, a "needs your attention" list where every row has its
 * own button, the latest orders, the week's sales, delivery queues, WhatsApp
 * Coins and best sellers. `onGoTab(key)` switches the active Manage tab;
 * `onFind(tab, text)` opens a tab with its search box filled in.
 */
export default function OverviewTab({ slug, pin, config = {}, themeColor = '#0d9488', businessName = '', onGoTab, onFind, domain = null }) {
  // The facts RESULT, not its rows: { ok, data, reason }. An empty list is a
  // real answer - this store has taken no orders - and a failed read is not an
  // answer at all. Home must never show the two the same way.
  //
  // Home's accounting reads ONLY the uncapped, PII-free facts feed. Every sales
  // figure needs nothing but created_at, status, total, paid and the shipment
  // columns. The latest-orders list (HomeLatestOrders) is a list, not a figure.
  const [factsResult, setFactsResult] = useState(null);   // null = loading
  // Abandoned carts come from their own feed, the same per-customer list the
  // Abandoned tab shows, so the two screens always agree. Same { ok, data } envelope.
  const [cartsResult, setCartsResult] = useState(null);
  const [reviews, setReviews] = useState([]);
  // Side cards with their own reads; false = could not load, and the card hides.
  const [views, setViews] = useState(null);
  const [usage, setUsage] = useState(null);
  const [sales, setSales] = useState(null);
  // The one clock reading on this screen, taken when the data lands rather than
  // during render, so the day windows are stable across re-renders.
  const [loadedAt, setLoadedAt] = useState(null);
  const [shared, setShared] = useState(false);

  const isService = config.businessType === 'service';
  const noun = isService ? 'lead' : 'order';
  const colors = shellColors(themeColor);

  const load = useCallback(async () => {
    setFactsResult(null);
    const [facts, revs, carts, v, u, s] = await Promise.all([
      fetchOrderFacts(slug, pin),
      fetchReviews(slug),
      isService ? null : fetchAbandonedCarts(slug, pin),
      fetchViewStats(slug).catch(() => null),
      isService ? null : getOrderMessageUsage(slug, pin).catch(() => null),
      fetchProductSales(slug).catch(() => null),
    ]);
    setReviews(revs || []);
    setCartsResult(carts);
    setViews(v || false);
    setUsage(u && !u.error ? u : false);
    setSales(s || false);
    setFactsResult(facts);
    setLoadedAt(Date.now());
  }, [slug, pin, isService]);
  useEffect(() => { load(); }, [load]);

  // Built only from a SUCCESSFUL read. On failure the rows are empty and this
  // computes zeroes, which is exactly why the accounting section below refuses
  // to render them.
  const acc = useMemo(
    () => buildOverviewMetrics(factsResult?.ok ? factsResult.data : [], {
      timeZone: STORE_TZ, now: loadedAt,
    }),
    [factsResult, loadedAt],
  );
  // Stock and reviews come from the store config and the reviews table, not
  // from orders, so they survive an order-feed failure untouched.
  const extras = useMemo(
    () => buildOverviewExtras(config, reviews, loadedAt ?? undefined),
    [config, reviews, loadedAt],
  );
  const accountingOk = factsResult?.ok === true;
  // Same rule for the carts: a failed read shows no row at all, never a zero.
  const carts = useMemo(
    () => summarizeAbandoned(cartsResult?.ok ? cartsResult.data : []),
    [cartsResult],
  );
  const cartsOk = cartsResult?.ok === true;

  // Best sellers: units sold per product (get_product_sales, counts only).
  const best = useMemo(() => {
    if (!sales || !sales.size) return [];
    return (config.products || [])
      .map((p) => ({ p, info: sales.get(p?.name) }))
      .filter((x) => x.info && x.info.sold > 0)
      .sort((a, b) => b.info.sold - a.info.sold)
      .slice(0, 4);
  }, [sales, config.products]);

  // ── Loading skeleton ──
  if (factsResult === null) {
    return (
      <div className="space-y-4">
        <div className="h-9 w-64 rounded-lg bg-white border border-gray-100 animate-pulse" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-24 rounded-2xl bg-white border border-gray-100 animate-pulse" />)}
        </div>
        <div className="h-64 rounded-2xl bg-white border border-gray-100 animate-pulse" />
      </div>
    );
  }

  const hour = Number(new Intl.DateTimeFormat('en-IN', { hour: 'numeric', hourCycle: 'h23', timeZone: STORE_TZ }).format(loadedAt));
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const summary = accountingOk
    ? (acc.newCount
      ? `You have ${plural(acc.newCount, `new ${noun}`, `new ${noun}s`)}${acc.toCollect ? ` and ${formatINR(acc.toCollect)} to collect` : ''}.`
      : `No new ${noun}s waiting. ${acc.todayCount ? `${plural(acc.todayCount, noun, `${noun}s`)} today so far.` : 'Share your page to bring buyers in.'}`)
    : 'Here’s your shop today.';
  const visitsTrend = views && views.lastWeek > 0 ? Math.round(((views.week - views.lastWeek) / views.lastWeek) * 100) : null;

  // The attention list: only rows that need action, most urgent first, each with
  // its own button. Accounting rows are omitted entirely when the order feed
  // failed - an absent row is honest, a zero row is a lie.
  const attention = [];
  if (accountingOk && acc.newCount > 0)
    attention.push({ key: 'new', Icon: ShoppingBag, color: '#b45309', bg: '#fef3c7', primary: true,
      title: plural(acc.newCount, `new ${noun}`, `new ${noun}s`),
      sub: isService ? 'Reply before they go cold' : 'Accept so the customer gets a WhatsApp confirmation',
      cta: isService ? 'Open leads' : 'Open orders', onClick: () => onGoTab?.('orders') });
  if (accountingOk && !isService && acc.shipping.readyToShip > 0)
    attention.push({ key: 'ship', Icon: Truck, color: '#047857', bg: '#d1fae5',
      title: `${acc.shipping.readyToShip} ready to ship`,
      sub: 'Book a courier or send your own delivery boy',
      cta: 'Book courier', onClick: () => onGoTab?.('delivery') });
  if (accountingOk && acc.toCollect > 0)
    attention.push({ key: 'collect', Icon: Wallet, color: '#4338ca', bg: '#e0e7ff',
      title: `${formatINR(acc.toCollect)} to collect`,
      sub: `${plural(acc.unpaidCount, `unpaid ${noun}`, `unpaid ${noun}s`)}`,
      cta: 'View', onClick: () => onGoTab?.(isService ? 'orders' : 'payments') });
  if (cartsOk && !isService && carts.count > 0)
    attention.push({ key: 'abandoned', Icon: ShoppingCart, color: '#be185d', bg: '#fce7f3',
      title: `${carts.count} abandoned ${carts.count === 1 ? 'cart' : 'carts'}`,
      sub: carts.value > 0 ? `${formatINR(carts.value)} left behind · send a WhatsApp reminder` : 'Send a WhatsApp reminder',
      cta: 'Remind', onClick: () => onGoTab?.('abandoned') });
  if (extras.outOfStockCount > 0)
    attention.push({ key: 'stock', Icon: Package, color: '#b91c1c', bg: '#fee2e2',
      title: `${extras.outOfStockCount} out of stock`,
      sub: extras.outOfStockNames.slice(0, 3).join(', ') || 'Restock to keep selling',
      cta: 'Restock', onClick: () => onGoTab?.('products') });
  if (extras.newReviewCount > 0)
    attention.push({ key: 'reviews', Icon: Star, color: '#b45309', bg: '#fef3c7',
      title: plural(extras.newReviewCount, 'new review', 'new reviews'),
      sub: extras.latestReview ? `${extras.latestReview.customer_name || 'A customer'} · ${'★'.repeat(Number(extras.latestReview.rating) || 0)}` : 'Reply to say thank you',
      cta: 'Reply', onClick: () => onGoTab?.('reviews') });

  const weekMax = Math.max(...acc.week.map((d) => d.sales), 1);
  const ship = acc.shipping;

  async function shareStore() {
    const url = publicStoreUrl(slug, {}, domain, window.location.origin);   // their own domain once it is live
    if (navigator.share) { try { await navigator.share({ title: businessName, text: `Order from ${businessName}`, url }); } catch { /* dismissed */ } }
    else { try { await navigator.clipboard?.writeText(url); setShared(true); setTimeout(() => setShared(false), 2500); } catch { /* ignore */ } }
  }
  const openOrder = (o) => (onFind ? onFind('orders', orderRef(o)) : onGoTab?.('orders'));

  return (
    <div className="space-y-4 lg:space-y-6">

      {/* Greeting */}
      <div className="flex items-start lg:items-end lg:flex-wrap justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-[20px] lg:text-[28px] font-extrabold text-gray-900 leading-tight">
            {greeting}, {businessName || 'there'}
          </h2>
          <p className="text-sm text-gray-500 mt-1">{summary}</p>
        </div>
        <div className="flex gap-2 items-center">
          <button type="button" onClick={load} aria-label="Refresh"
            className="w-10 h-10 rounded-xl grid place-items-center text-gray-500 hover:text-gray-800 hover:bg-white active:scale-95 transition">
            <RefreshCw size={16} />
          </button>
          {!isService && (
            <button type="button" onClick={() => onGoTab?.('payments')}
              className="hidden lg:inline-flex h-10 px-4 rounded-xl border border-gray-200 bg-white text-sm font-bold text-gray-800 items-center gap-2 hover:bg-gray-50 active:scale-[0.98] transition">
              <Wallet size={16} />Request payment
            </button>
          )}
          <button type="button" onClick={() => onGoTab?.('products')}
            className="hidden lg:inline-flex h-10 px-4 rounded-xl text-white text-sm font-bold items-center gap-2 shadow-sm hover:opacity-90 active:scale-[0.98] transition"
            style={{ backgroundColor: colors.button }}>
            <Plus size={16} />Add product
          </button>
        </div>
      </div>

      {/* Today. On a phone one big card; on a computer four tiles. Or, if the
          order feed failed, a compact retry in their place. Never a row of
          zeroes: the rest of this screen still works. */}
      {accountingOk ? (
        <>
          <button type="button" onClick={() => onGoTab?.('analytics')}
            className="lg:hidden w-full text-left rounded-2xl p-4 text-white shadow-sm active:scale-[0.99] transition"
            style={{ background: `linear-gradient(135deg, ${colors.button}, #061310)` }}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-widest text-white/75">Sales today</p>
                <p className="text-[32px] font-extrabold tabular-nums leading-tight mt-1">{formatINR(acc.todaySales)}</p>
                <p className="text-[13px] font-semibold text-white/85">
                  {acc.todayDeltaPct != null ? `${acc.todayDeltaPct >= 0 ? '▲' : '▼'} ${Math.abs(acc.todayDeltaPct)}% vs yesterday` : 'This week ' + formatINR(acc.weekTotal)}
                </p>
              </div>
              <div className="w-24 h-12 flex items-end gap-1 flex-shrink-0" aria-hidden="true">
                {acc.week.map((d, i) => (
                  <div key={d.key} className="flex-1 rounded-sm"
                    style={{ height: `${d.sales <= 0 ? 8 : Math.max(14, Math.round((d.sales / weekMax) * 100))}%`, background: i === acc.week.length - 1 ? '#fff' : 'rgba(255,255,255,0.4)' }} />
                ))}
              </div>
            </div>
            <div className="grid grid-cols-3 mt-4 pt-3 border-t border-white/20 text-center">
              <MiniStat label={isService ? 'Leads' : 'Orders'} value={acc.todayCount} />
              <MiniStat label="To collect" value={formatINR(acc.toCollect)} />
              <MiniStat label="Visits" value={views ? views.today : '—'} />
            </div>
          </button>

          <div className="hidden lg:grid grid-cols-2 xl:grid-cols-4 gap-4">
            <StatTile label="Sales today" value={formatINR(acc.todaySales)} Icon={TrendingUp} colors={colors}
              foot={acc.todayDeltaPct != null
                ? <span className={acc.todayDeltaPct >= 0 ? 'text-emerald-700' : 'text-rose-600'}>{acc.todayDeltaPct >= 0 ? '▲' : '▼'} {Math.abs(acc.todayDeltaPct)}% vs yesterday</span>
                : <span className="text-gray-500">Nothing yesterday to compare</span>}
              onClick={() => onGoTab?.('analytics')} />
            <StatTile label={isService ? 'Leads today' : 'Orders today'} value={acc.todayCount} Icon={ShoppingBag} colors={colors}
              foot={acc.newCount ? <span className="text-amber-700">{acc.newCount} new, waiting for you</span> : <span className="text-gray-500">All handled</span>}
              onClick={() => onGoTab?.('orders')} />
            <StatTile label="To collect" value={formatINR(acc.toCollect)} Icon={Wallet} colors={colors}
              foot={acc.unpaidCount ? <span className="text-gray-500">{plural(acc.unpaidCount, `unpaid ${noun}`, `unpaid ${noun}s`)}</span> : <span className="text-emerald-700">All paid</span>}
              onClick={() => onGoTab?.(isService ? 'orders' : 'payments')} />
            <StatTile label="Page visits today" value={views ? views.today : '—'} Icon={Eye} colors={colors}
              foot={views
                ? <span className={visitsTrend != null && visitsTrend < 0 ? 'text-rose-600' : 'text-emerald-700'}>
                    {views.week} this week{visitsTrend != null ? ` · ${visitsTrend >= 0 ? '▲' : '▼'} ${Math.abs(visitsTrend)}%` : ''}
                  </span>
                : <span className="text-gray-500">Visits not available</span>}
              onClick={() => onGoTab?.('analytics')} />
          </div>
        </>
      ) : (
      <div className="rounded-2xl border border-amber-100 bg-amber-50/60 px-4 py-3.5 flex items-center gap-3">
        <Wallet size={18} className="text-amber-500 flex-shrink-0" />
        <div className="min-w-0 flex-grow">
          <p className="text-sm font-bold text-gray-900">Sales figures unavailable</p>
          <p className="text-xs text-gray-500 mt-0.5">Your orders are safe — this screen couldn&rsquo;t reach them.</p>
        </div>
        <button type="button" onClick={load}
          className="flex-shrink-0 text-xs font-bold px-3 py-2 rounded-xl text-white active:scale-[0.98] transition-transform"
          style={{ backgroundColor: colors.button }}>
          Try again
        </button>
      </div>
      )}

      <div className="grid gap-4 lg:gap-6 lg:grid-cols-[minmax(0,1fr)_360px] items-start">
        {/* Left: attention + latest orders */}
        <div className="space-y-4 lg:space-y-6 min-w-0">
          <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
            <div className="flex items-center gap-2 px-5 pt-4 pb-2">
              {attention.length > 0
                ? <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
                : <Sparkles size={13} className="text-emerald-500" />}
              <span className="text-[11px] font-bold uppercase tracking-widest text-gray-500">
                {attention.length > 0 ? 'Needs your attention' : "You're all caught up"}
              </span>
            </div>
            {attention.length === 0 ? (
              <div className="px-5 pb-6 pt-1 text-center">
                <p className="text-sm font-bold text-gray-700">Nothing needs you right now</p>
                <p className="text-xs text-gray-500 mt-0.5">New {noun}s and alerts will show up here.</p>
              </div>
            ) : (
              <ul className="pb-1">{attention.map(({ key, ...row }) => <AttentionRow key={key} {...row} colors={colors} />)}</ul>
            )}
          </div>

          <HomeLatestOrders slug={slug} pin={pin} products={config.products || []} colors={colors} noun={noun}
            onOpen={openOrder} onSeeAll={() => onGoTab?.('orders')} />

          {/* Quick actions (phone; the computer has them next to the greeting) */}
          <div className={`lg:hidden grid gap-2 ${isService ? 'grid-cols-3' : 'grid-cols-4'}`}>
            <QuickAction icon={<Plus size={18} />} label="Add product" onClick={() => onGoTab?.('products')} colors={colors} />
            <QuickAction icon={<Share2 size={17} />} label={shared ? 'Link copied' : 'Share page'} onClick={shareStore} colors={colors} />
            <QuickAction icon={<Percent size={17} />} label="New offer" onClick={() => onGoTab?.('offers')} colors={colors} />
            {!isService && <QuickAction icon={<Wallet size={17} />} label="Ask payment" onClick={() => onGoTab?.('payments')} colors={colors} />}
          </div>
        </div>

        {/* Right: the week, delivery, WhatsApp, best sellers */}
        <div className="space-y-4 lg:space-y-6 min-w-0">
          {/* This week - seven merchant civil days, oldest to today */}
          {accountingOk && (
          <div className="rounded-2xl border border-gray-100 bg-white shadow-sm px-5 py-4">
            <div className="flex items-baseline justify-between">
              <span className="text-[11px] font-bold uppercase tracking-widest text-gray-500">Sales this week</span>
              <button type="button" onClick={() => onGoTab?.('analytics')} className="text-[13px] font-bold" style={{ color: colors.button }}>Stats</button>
            </div>
            <p className="text-[26px] font-extrabold text-gray-900 tabular-nums mt-1">{formatINR(acc.weekTotal)}</p>
            <div className="mt-3 flex items-end gap-2">
              {acc.week.map((d, i) => {
                const isToday = i === acc.week.length - 1;
                const h = d.sales <= 0 ? 6 : Math.max(12, Math.round((d.sales / weekMax) * 100));
                const letter = WEEKDAY_LETTERS[d.weekday] ?? '';
                return (
                  <div key={d.key} className="flex-1 flex flex-col items-center gap-1.5">
                    {/* fixed-height track so the bar's % height has something to resolve against */}
                    <div className="w-full h-24 flex items-end">
                      <div className="w-full rounded-t-md transition-all"
                        style={{ height: `${h}%`, backgroundColor: d.sales <= 0 ? '#e5e7eb' : colors.accent, opacity: isToday || d.sales <= 0 ? 1 : 0.4 }}
                        title={formatINR(d.sales)} />
                    </div>
                    <span className={['text-[11px] font-bold', isToday ? 'text-gray-900' : 'text-gray-400'].join(' ')}>{letter}</span>
                  </div>
                );
              })}
            </div>
          </div>
          )}
          {/* end attention + week grid */}

          {accountingOk && !isService && (
            <SideCard title="Delivery" action="Open" onAction={() => onGoTab?.('delivery')} colors={colors}>
              <div className="grid grid-cols-4 gap-2 text-center">
                {[['To ship', ship.readyToShip, '#047857'], ['On the way', ship.onTheWay, '#4338ca'],
                  ['Delivered', ship.delivered30, '#1d4ed8'], ['Returned', ship.returned30, '#b91c1c']].map(([l, v, c]) => (
                  <div key={l} className="rounded-xl bg-gray-50 py-2.5 px-1">
                    <p className="text-xl font-extrabold tabular-nums" style={{ color: c }}>{v}</p>
                    <p className="text-[11px] font-semibold text-gray-500 leading-tight mt-0.5">{l}</p>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-gray-400 mt-2">Delivered and returned: last 30 days</p>
              {ship.codOnTheWay > 0 && (
                <p className="mt-3 rounded-xl border border-dashed border-gray-200 px-3 py-2.5 text-[13px] text-gray-700">
                  <b>{formatINR(ship.codOnTheWay)}</b> cash on delivery on parcels still on the way
                </p>
              )}
            </SideCard>
          )}

          {usage && (
            <SideCard title="WhatsApp" action="Add Coins" onAction={() => onGoTab?.('whatsapp')} colors={colors}>
              <div className="flex items-baseline gap-2">
                <Coins size={18} className="text-amber-500 self-center" />
                <p className="text-[24px] font-extrabold tabular-nums text-gray-900">{formatCoins(coinsOf(usage.balance_paise))}</p>
              </div>
              {(() => {
                const limit = Number(usage.free_limit) || 500;
                const used = Math.min(limit, Number(usage.free_used) || 0);
                return (
                  <div className="mt-3">
                    <div className="flex justify-between text-[13px] mb-1.5">
                      <span className="font-semibold text-gray-700">Free order confirmations</span>
                      <span className="tabular-nums text-gray-500">{used} of {limit}</span>
                    </div>
                    <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${Math.round((used / limit) * 100)}%`, background: colors.accent }} />
                    </div>
                  </div>
                );
              })()}
            </SideCard>
          )}

          {best.length > 0 && (
            <SideCard title="Best sellers" sub="Units sold" colors={colors}>
              <ul className="space-y-3">
                {best.map(({ p, info }) => {
                  const img = p.image || (Array.isArray(p.images) ? p.images[0] : null);
                  return (
                    <li key={p.id ?? p.name} className="flex items-center gap-3">
                      {img ? <img src={img} alt="" className="w-[38px] h-[38px] rounded-lg object-cover bg-gray-100 flex-shrink-0" />
                        : <span className="w-[38px] h-[38px] rounded-lg bg-gray-100 grid place-items-center flex-shrink-0">{p.emoji || '📦'}</span>}
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between gap-2 text-[13px]">
                          <span className="font-semibold text-gray-800 truncate">{p.name}</span>
                          <span className="font-extrabold tabular-nums text-gray-900">{info.sold}</span>
                        </div>
                        <div className="mt-1.5 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${Math.round((info.sold / best[0].info.sold) * 100)}%`, background: colors.accent }} />
                        </div>
                        {info.soldWeek > 0 && <p className="text-[11px] text-gray-500 mt-1">{info.soldWeek} this week</p>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </SideCard>
          )}
        </div>
      </div>
    </div>
  );
}

// ── pieces ──────────────────────────────────────────────────────────────────

function StatTile({ label, value, foot, Icon, colors, onClick }) {
  return (
    <button type="button" onClick={onClick}
      className="text-left rounded-2xl border border-gray-100 bg-white shadow-sm p-4 hover:shadow transition min-w-0 active:scale-[0.99]">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-gray-500">{label}</span>
        <span className="w-8 h-8 rounded-lg grid place-items-center" style={{ backgroundColor: colors.tint, color: colors.button }}><Icon size={16} /></span>
      </div>
      <p className="text-[26px] leading-none font-extrabold text-gray-900 mt-3 tabular-nums truncate">{value}</p>
      <p className="text-[13px] font-semibold mt-2 truncate">{foot}</p>
    </button>
  );
}

function MiniStat({ label, value }) {
  return (
    <div className="min-w-0">
      <p className="text-[17px] font-extrabold tabular-nums truncate">{value}</p>
      <p className="text-[11px] font-semibold text-white/75">{label}</p>
    </div>
  );
}

function AttentionRow({ Icon, color, bg, title, sub, cta, onClick, primary, colors }) {
  return (
    <li className="flex items-center gap-3 px-4 lg:px-5 py-3 border-t border-gray-100">
      <span className="w-10 h-10 rounded-xl grid place-items-center flex-shrink-0" style={{ background: bg, color }}>
        <Icon size={18} />
      </span>
      <button type="button" onClick={onClick} className="flex-1 min-w-0 text-left">
        <span className="block text-[15px] font-extrabold text-gray-900 leading-tight truncate">{title}</span>
        <span className="block text-[13px] text-gray-500 truncate mt-0.5">{sub}</span>
      </button>
      <button type="button" onClick={onClick}
        className={primary
          ? 'h-9 px-3 rounded-lg text-white text-[13px] font-bold whitespace-nowrap active:scale-[0.98] transition flex-shrink-0'
          : 'h-9 px-3 rounded-lg border border-gray-200 bg-white text-gray-800 text-[13px] font-bold whitespace-nowrap hover:bg-gray-50 active:scale-[0.98] transition flex-shrink-0'}
        style={primary ? { backgroundColor: colors.button } : undefined}>
        {cta}
      </button>
    </li>
  );
}

function SideCard({ title, sub, action, onAction, colors, children }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white shadow-sm px-5 py-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-widest text-gray-500">{title}</span>
          {sub && <p className="text-[12px] text-gray-400">{sub}</p>}
        </div>
        {action && (
          <button type="button" onClick={onAction} className="inline-flex items-center gap-0.5 text-[13px] font-bold" style={{ color: colors.button }}>
            {action}<ChevronRight size={14} />
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

function QuickAction({ icon, label, onClick, colors }) {
  return (
    <button type="button" onClick={onClick}
      className="flex flex-col items-center justify-center gap-1.5 rounded-2xl border border-gray-100 bg-white shadow-sm py-3 px-1 active:scale-[0.97] transition">
      <span className="w-10 h-10 rounded-xl grid place-items-center flex-shrink-0"
        style={{ backgroundColor: colors.tint, color: colors.button }}>
        {icon}
      </span>
      <span className="text-[12px] font-bold text-gray-700 text-center leading-tight">{label}</span>
    </button>
  );
}

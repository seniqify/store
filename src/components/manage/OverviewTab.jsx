import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ShoppingBag, IndianRupee, ShoppingCart, Package, Star, Wallet,
  Plus, Share2, Download, ChevronRight, Sparkles, RefreshCw,
} from 'lucide-react';
import { fetchOrderFacts } from '../../utils/orderService';
import { fetchReviews } from '../../utils/reviewService';
import { buildOverviewExtras } from '../../utils/overviewStats';
import { buildOverviewMetrics, WEEKDAY_LETTERS } from '../../utils/overviewMetrics';
import { formatINR } from '../../utils/currency';

// The merchant's clock. Every order-derived day boundary on this screen is
// theirs, not the browser's.
const STORE_TZ = 'Asia/Kolkata';

/**
 * OverviewTab — the Manage "Home" dashboard.
 *
 * Answers the one question a shopkeeper opens the app for: "what needs me right
 * now?" Shows today's pulse, a prioritised "needs your attention" list (each row
 * deep-links to the tab that fixes it), a 7-day sales sparkline, and quick
 * actions. Built entirely from data the other tabs already compute — no new
 * backend. `onGoTab(key)` switches the active Manage tab.
 */
export default function OverviewTab({ slug, pin, config = {}, themeColor = '#0d9488', businessName = '', onGoTab }) {
  // The facts RESULT, not its rows: { ok, data, reason }. An empty list is a
  // real answer - this store has taken no orders - and a failed read is not an
  // answer at all. Home must never show the two the same way.
  //
  // Home reads ONLY the uncapped, PII-free facts feed. Every figure it shows
  // needs nothing but created_at, status, total, paid and the shipment columns,
  // so it has no reason to touch the capped get_store_orders list at all.
  const [factsResult, setFactsResult] = useState(null);   // null = loading
  const [reviews, setReviews] = useState([]);
  // The one clock reading on this screen, taken when the data lands rather than
  // during render, so the day windows are stable across re-renders.
  const [loadedAt, setLoadedAt] = useState(null);

  const isService = config.businessType === 'service';

  const load = useCallback(async () => {
    setFactsResult(null);
    const [facts, revs] = await Promise.all([
      fetchOrderFacts(slug, pin),
      fetchReviews(slug),
    ]);
    setReviews(revs || []);
    setFactsResult(facts);
    setLoadedAt(Date.now());
  }, [slug, pin]);
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

  // ── Loading skeleton ──
  if (factsResult === null) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 rounded-lg bg-white border border-gray-100 animate-pulse" />
        <div className="grid grid-cols-3 gap-2">
          {[0, 1, 2].map((i) => <div key={i} className="h-20 rounded-2xl bg-white border border-gray-100 animate-pulse" />)}
        </div>
        <div className="h-52 rounded-2xl bg-white border border-gray-100 animate-pulse" />
      </div>
    );
  }

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const dateLine = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' });

  // Build the attention list (only rows that actually need action), most urgent
  // first. The first three rows are accounting and are omitted entirely when the
  // order feed failed - an absent row is honest, a zero row is a lie.
  const attention = [];
  if (accountingOk && acc.newCount > 0)
    attention.push({ key: 'new', emoji: '🟢', tint: 'emerald',
      title: `${acc.newCount} new ${isService ? (acc.newCount === 1 ? 'lead' : 'leads') : (acc.newCount === 1 ? 'order' : 'orders')}`,
      sub: isService ? 'Respond before they go cold' : 'Accept & notify the customer',
      cta: 'Open', onClick: () => onGoTab?.('orders') });
  if (accountingOk && acc.toCollect > 0)
    attention.push({ key: 'collect', emoji: '💰', tint: 'amber',
      title: `${formatINR(acc.toCollect)} to collect`,
      sub: `${acc.unpaidCount} unpaid ${acc.unpaidCount === 1 ? 'order' : 'orders'}`,
      cta: 'View', onClick: () => onGoTab?.('orders') });
  if (accountingOk && !isService && acc.abandonedCount > 0)
    attention.push({ key: 'abandoned', emoji: '🛒', tint: 'rose',
      title: `${acc.abandonedCount} abandoned ${acc.abandonedCount === 1 ? 'cart' : 'carts'}`,
      sub: acc.abandonedValue > 0 ? `${formatINR(acc.abandonedValue)} nearly bought — win back` : 'Win them back',
      cta: 'Recover', onClick: () => onGoTab?.('abandoned') });
  if (extras.outOfStockCount > 0)
    attention.push({ key: 'stock', emoji: '📦', tint: 'blue',
      title: `${extras.outOfStockCount} ${extras.outOfStockCount === 1 ? 'item' : 'items'} out of stock`,
      sub: extras.outOfStockNames.slice(0, 3).join(', ') || 'Restock to keep selling',
      cta: 'Fix', onClick: () => onGoTab?.('products') });
  if (extras.newReviewCount > 0)
    attention.push({ key: 'reviews', emoji: '⭐', tint: 'amber',
      title: `${extras.newReviewCount} new ${extras.newReviewCount === 1 ? 'review' : 'reviews'}`,
      sub: extras.latestReview ? `${extras.latestReview.customer_name || 'A customer'} · ${'★'.repeat(Number(extras.latestReview.rating) || 0)}` : 'See what customers said',
      cta: 'Reply', onClick: () => onGoTab?.('reviews') });

  const weekMax = Math.max(...acc.week.map((d) => d.sales), 1);

  async function shareStore() {
    const url = `${window.location.origin}/${slug}`;
    if (navigator.share) { try { await navigator.share({ title: businessName, text: `Order from ${businessName}`, url }); } catch { /* dismissed */ } }
    else { try { await navigator.clipboard?.writeText(url); } catch { /* ignore */ } }
  }

  return (
    <div className="space-y-4">

      {/* Greeting */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-xl font-extrabold text-gray-900 leading-tight truncate">
            {greeting}, {businessName || 'there'} 👋
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">{dateLine} · here's your shop today</p>
        </div>
        <button onClick={load} aria-label="Refresh"
          className="p-2 -mr-1 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 active:scale-95 transition flex-shrink-0">
          <RefreshCw size={15} />
        </button>
      </div>

      {/* Today snapshot - or, if the order feed failed, a compact retry in its
          place. Never a row of zeroes: the rest of this screen still works. */}
      {accountingOk ? (
      <div className="grid grid-cols-3 gap-2">
        <StatTile label="Today" value={formatINR(acc.todaySales)}
          foot={acc.todayDeltaPct != null
            ? <span className={acc.todayDeltaPct >= 0 ? 'text-emerald-600' : 'text-rose-500'}>
                {acc.todayDeltaPct >= 0 ? '▲' : '▼'} {Math.abs(acc.todayDeltaPct)}% vs yest.
              </span>
            : <span className="text-gray-300">—</span>}
          onClick={() => onGoTab?.('analytics')} />
        <StatTile label={isService ? 'Leads' : 'Orders'} value={acc.todayCount}
          foot={acc.newCount > 0 ? <span style={{ color: themeColor }}>{acc.newCount} new</span> : <span className="text-gray-300">today</span>}
          onClick={() => onGoTab?.('orders')} />
        <StatTile label="To collect" value={formatINR(acc.toCollect)}
          foot={acc.unpaidCount > 0 ? <span className="text-amber-600">{acc.unpaidCount} unpaid</span> : <span className="text-emerald-600">all paid</span>}
          onClick={() => onGoTab?.('orders')} />
      </div>
      ) : (
      <div className="rounded-2xl border border-amber-100 bg-amber-50/60 px-4 py-3.5 flex items-center gap-3">
        <Wallet size={18} className="text-amber-500 flex-shrink-0" />
        <div className="min-w-0 flex-grow">
          <p className="text-sm font-bold text-gray-900">Sales figures unavailable</p>
          <p className="text-xs text-gray-500 mt-0.5">Your orders are safe — this screen couldn&rsquo;t reach them.</p>
        </div>
        <button type="button" onClick={load}
          className="flex-shrink-0 text-xs font-bold px-3 py-2 rounded-xl text-white active:scale-[0.98] transition-transform"
          style={{ backgroundColor: themeColor }}>
          Try again
        </button>
      </div>
      )}

      {/* Attention + week — stacked on mobile, side-by-side on desktop */}
      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">

      {/* Needs your attention */}
      <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
        <div className="flex items-center gap-2 px-4 pt-3.5 pb-2.5">
          {attention.length > 0
            ? <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse" />
            : <Sparkles size={13} className="text-emerald-500" />}
          <span className="text-[11px] font-bold uppercase tracking-widest text-gray-500">
            {attention.length > 0 ? 'Needs your attention' : "You're all caught up"}
          </span>
        </div>

        {attention.length === 0 ? (
          <div className="px-4 pb-5 pt-1 text-center">
            <p className="text-3xl mb-1.5">✨</p>
            <p className="text-sm font-bold text-gray-700">Nothing needs you right now</p>
            <p className="text-xs text-gray-400 mt-0.5">New orders and alerts will show up here.</p>
          </div>
        ) : (
          attention.map(({ key, ...row }) => <AttentionRow key={key} {...row} />)
        )}
      </div>

      {/* This week sparkline - seven merchant civil days, oldest to today */}
      {accountingOk && (
      <div className="rounded-2xl border border-gray-100 bg-white shadow-sm px-4 py-3.5">
        <div className="flex items-baseline justify-between">
          <span className="text-[11px] font-bold uppercase tracking-widest text-gray-400">This week</span>
          <span className="text-base font-extrabold text-gray-900 tabular-nums">{formatINR(acc.weekTotal)}</span>
        </div>
        <div className="mt-3 flex items-end gap-2">
          {acc.week.map((d, i) => {
            const isToday = i === acc.week.length - 1;
            const h = d.sales <= 0 ? 6 : Math.max(12, Math.round((d.sales / weekMax) * 100));
            const letter = WEEKDAY_LETTERS[d.weekday] ?? '';
            return (
              <div key={d.key} className="flex-1 flex flex-col items-center gap-1.5">
                {/* fixed-height track so the bar's % height has something to resolve against */}
                <div className="w-full h-16 flex items-end">
                  <div className="w-full rounded-t-md transition-all"
                    style={{ height: `${h}%`, backgroundColor: d.sales <= 0 ? '#e5e7eb' : themeColor, opacity: isToday || d.sales <= 0 ? 1 : 0.55 }}
                    title={formatINR(d.sales)} />
                </div>
                <span className={['text-[9px] font-bold', isToday ? 'text-gray-700' : 'text-gray-300'].join(' ')}>{letter}</span>
              </div>
            );
          })}
        </div>
      </div>
      )}

      </div>{/* end attention + week grid */}

      {/* Quick actions */}
      <div className="grid grid-cols-3 gap-2">
        <QuickAction icon={<Plus size={17} />} label="Add product" onClick={() => onGoTab?.('products')} themeColor={themeColor} />
        <QuickAction icon={<Share2 size={16} />} label="Share store" onClick={shareStore} themeColor={themeColor} />
        <QuickAction icon={<Download size={16} />} label="Export contacts" onClick={() => onGoTab?.('customers')} themeColor={themeColor} />
      </div>
    </div>
  );
}

// ── pieces ──────────────────────────────────────────────────────────────────

const TINTS = {
  emerald: 'bg-emerald-50',
  amber:   'bg-amber-50',
  rose:    'bg-rose-50',
  blue:    'bg-blue-50',
};

function StatTile({ label, value, foot, onClick }) {
  return (
    <button type="button" onClick={onClick}
      className="text-left rounded-2xl border border-gray-100 bg-white shadow-sm p-3 active:scale-[0.98] transition">
      <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">{label}</p>
      <p className="text-lg font-extrabold text-gray-900 mt-1 tabular-nums leading-none truncate">{value}</p>
      <p className="text-[10px] font-bold mt-1.5 leading-none">{foot}</p>
    </button>
  );
}

function AttentionRow({ emoji, tint, title, sub, cta, onClick }) {
  return (
    <button type="button" onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-2.5 border-t border-gray-100 text-left hover:bg-gray-50/60 active:bg-gray-100 transition">
      <span className={['w-8 h-8 rounded-xl grid place-items-center text-base flex-shrink-0', TINTS[tint] || 'bg-gray-50'].join(' ')}>
        {emoji}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-[13px] font-extrabold text-gray-900 leading-tight truncate">{title}</span>
        <span className="block text-[11px] text-gray-400 truncate mt-0.5">{sub}</span>
      </span>
      <span className="text-[11px] font-bold text-gray-500 flex-shrink-0">{cta}</span>
      <ChevronRight size={15} className="text-gray-300 flex-shrink-0" />
    </button>
  );
}

function QuickAction({ icon, label, onClick, themeColor }) {
  return (
    <button type="button" onClick={onClick}
      className="flex flex-col items-center justify-center gap-1.5 rounded-2xl border border-gray-100 bg-white shadow-sm py-3 px-1 active:scale-[0.97] transition">
      <span className="w-8 h-8 rounded-full grid place-items-center flex-shrink-0"
        style={{ backgroundColor: `${themeColor}14`, color: themeColor }}>
        {icon}
      </span>
      <span className="text-[10px] font-bold text-gray-600 text-center leading-tight">{label}</span>
    </button>
  );
}

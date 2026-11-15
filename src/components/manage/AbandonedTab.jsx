import { useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { ShoppingCart, Sparkles, Loader2, Lock, ChevronRight } from 'lucide-react';
import { fetchAbandonedCarts } from '../../utils/orderService';
import { summarizeAbandoned, ABANDONED_PAGE_SIZE, ABANDONED_WINDOW_DAYS } from '../../utils/abandonedCarts';
import { fetchReminderStatuses, sendRemindersNow } from '../../utils/cartReminderService';
import { statusMap, reminderFor, cartReminderState, reminderCounts, cartOutcome, OUTCOME_FILTERS } from '../../utils/reminderStatus';
import { formatINR } from '../../utils/currency';
import WalletCard from './WalletCard';
import { PRICE } from '../../utils/planLimits';
import RecoveryCard from './RecoveryCard';
import CartChat, { CartThumbs } from './CartChat';
import { useScrollLock } from '../../hooks/useScrollLock';

/**
 * Abandoned carts — customers who typed their phone number at checkout but
 * never sent the order. Growth+ feature: paid stores see the list and win them
 * back; Free stores see the count + upgrade tease.
 *
 * The list opens on "Last 30 days": get_store_abandoned_carts, the same feed as
 * Home's "N abandoned carts" row, so the two numbers are always equal: ONE card
 * per customer (their latest cart), and a customer who has ordered since is not
 * listed. "All time" (founder, 2026-10-22: no caps anywhere) is the same rule
 * with no window, read the first time it is opened. Every customer is
 * reachable: cards render a page at a time behind "Show more", never silently
 * cut off.
 *
 * Winning them back (RecoveryCard): "Send reminder to all" and the automatic
 * switch send the WhatsApp cart reminder from PocketLink, Rs 1.50 each from the
 * wallet; each card shows its reminder state and can send its own.
 *
 * NUMBERS ARE PRIVATE (founder, 2026-10-22): shops copied numbers from here and
 * messaged customers by hand, so nobody topped up. The database no longer sends
 * an abandoned customer's number to the shop at all
 * (supabase/abandoned-private-forward.sql); a card shows the name, the cart and
 * the reminder, and PocketLink's paid reminder is the way to reach them.
 *
 * WHAT THEY DID (founder, 2026-11-15): each cart opens a WhatsApp-style chat
 * (CartChat) with the reminder exactly as it went — English or मराठी — and what
 * the customer did: opened it, ordered, or asked to stop. Each row says it too.
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

const FILTERS = [['all', 'All'], ['none', 'Not reminded'], ['reminded', 'Reminded']];
// The colour of each "what they did" chip on the list.
const OUTCOME_CHIP = {
  none: 'bg-gray-100 text-gray-600', sending: 'bg-blue-50 text-blue-700', sent: 'bg-blue-50 text-blue-700',
  opened: 'bg-amber-50 text-amber-800', won: 'bg-emerald-50 text-emerald-700',
  stopped: 'bg-red-50 text-red-700', failed: 'bg-red-50 text-red-700',
};

// A computer (lg) shows the chat beside the list; a phone opens it full screen.
const WIDE = '(min-width: 1024px)';
function useWide() {
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && Boolean(window.matchMedia?.(WIDE).matches));
  useEffect(() => {
    const m = window.matchMedia?.(WIDE);
    if (!m) return undefined;
    const on = () => setWide(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return wide;
}

// The phone's full-screen chat, with the page behind it held still.
function PhoneChat({ children }) {
  useScrollLock(true);
  return createPortal(
    <div className="fixed inset-0 z-[70] bg-[#efeae2] flex flex-col" role="dialog" aria-modal="true" aria-label="Cart chat">{children}</div>,
    document.body,
  );
}
const RANGES = [['30d', `Last ${ABANDONED_WINDOW_DAYS} days`], ['all', 'All time']];

export default function AbandonedTab({ slug, pin, themeColor = '#0d9488', storeName = '', allowed = false, waPhone = '', products = [] }) {
  const [result, setResult] = useState(null);   // last 30 days. null = loading; else { ok, data }
  const [range, setRange] = useState('30d');     // '30d' (Home's number) | 'all'
  const [allResult, setAllResult] = useState(null); // all time, read when first opened
  const [statuses, setStatuses] = useState([]);
  const [visible, setVisible] = useState(ABANDONED_PAGE_SIZE);
  const [filter, setFilter] = useState('all');
  const [version, setVersion] = useState(0);    // bumped after a send: wallet + results re-read
  const [sending, setSending] = useState({});   // cart id -> 'sending' | 'sent' | a short message
  // The reminder results RecoveryCard reads (won back, the auto switch), for the tiles.
  const [recovery, setRecovery] = useState(null);
  const [openId, setOpenId] = useState(null);   // the cart whose chat is open
  const wide = useWide();

  const load = useCallback(async () => {
    setResult(null);
    setAllResult(null);
    setVisible(ABANDONED_PAGE_SIZE);
    const [carts, st] = await Promise.all([fetchAbandonedCarts(slug, pin), fetchReminderStatuses(slug, pin)]);
    setStatuses(st);
    setResult(carts);
  }, [slug, pin]);

  useEffect(() => { load(); }, [load]);

  // "All time" is read the first time it is opened (and again after a retry),
  // not on every visit: most visits only need the 30 days Home counts.
  useEffect(() => {
    if (range !== 'all' || allResult) return undefined;
    let live = true;
    fetchAbandonedCarts(slug, pin, { allTime: true }).then((r) => { if (live) setAllResult(r); });
    return () => { live = false; };
  }, [range, allResult, slug, pin]);

  function pickRange(key) {
    setRange(key);
    setVisible(ABANDONED_PAGE_SIZE);
  }

  const refreshAfterSend = useCallback(async () => {
    setVersion((v) => v + 1);
    setStatuses(await fetchReminderStatuses(slug, pin));
  }, [slug, pin]);

  const rows = useMemo(() => (result?.ok ? result.data : []), [result]);
  const allTime = range === 'all';
  const loadingAll = allTime && allResult === null;
  // The cards on screen: the 30 days, or every customer still to win back.
  const listed = useMemo(
    () => (allTime ? (allResult?.ok ? allResult.data : []) : rows),
    [allTime, allResult, rows],
  );
  const byCart = useMemo(() => statusMap(statuses), [statuses]);

  async function sendOne(o) {
    setSending((m) => ({ ...m, [o.id]: 'sending' }));
    try {
      const r = await sendRemindersNow({ slug, pin, abandonedId: o.id });
      const msg = r.sent ? 'sent'
        : r.stoppedFor === 'no_balance' ? 'Top up your wallet to send'
        : r.stoppedFor === 'night' ? 'Reminders can be sent 9 am – 9 pm'
        : r.failed ? 'WhatsApp refused it — refunded'
        : 'Can’t be reminded right now';
      setSending((m) => ({ ...m, [o.id]: msg }));
      if (r.sent || r.failed) refreshAfterSend();
    } catch (e) {
      setSending((m) => ({ ...m, [o.id]: e?.message || 'Could not send' }));
    }
  }

  if (result === null) {
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

  // A failed read lists nothing, so the Free tease below falls back to its
  // no-number wording and the paid list shows the retry card — never "0".
  const sum = summarizeAbandoned(rows);

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
              ? <><b>{sum.count} customer{sum.count === 1 ? '' : 's'}</b> started an order at {storeName || 'your store'} in the last {ABANDONED_WINDOW_DAYS} days but never sent it — PocketLink can remind them for you.</>
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
            Activate your plan — ₹{PRICE.monthly.toLocaleString('en-IN')}/mo →
          </a>
        </div>
      </div>
    );
  }

  // ── Paid: win them back ─────────────────────────────────────────────────────
  if (!result.ok) {
    return (
      <div className="rounded-2xl border border-amber-100 bg-amber-50/60 px-4 py-3.5 flex items-center gap-3">
        <ShoppingCart size={18} className="text-amber-500 flex-shrink-0" />
        <div className="min-w-0 flex-grow">
          <p className="text-sm font-bold text-gray-900">Abandoned carts unavailable</p>
          <p className="text-xs text-gray-500 mt-0.5">Nothing is lost — this screen couldn&rsquo;t reach them.</p>
        </div>
        <button type="button" onClick={load}
          className="flex-shrink-0 text-xs font-bold px-3 py-2 rounded-xl text-white active:scale-[0.98] transition-transform"
          style={{ backgroundColor: themeColor }}>
          Try again
        </button>
      </div>
    );
  }

  const now = Date.now();
  const shownSum = summarizeAbandoned(listed);
  const allFailed = allTime && allResult !== null && !allResult.ok;
  const counts = reminderCounts(listed, byCart, now);
  const filtered = filter === 'all' ? listed : listed.filter((o) => {
    const r = reminderFor(byCart, o);
    if (filter === 'none' || filter === 'reminded') {
      const k = cartReminderState(o, r, now).key;
      return filter === 'none' ? k === 'none' : k !== 'none';
    }
    return cartOutcome(o, r).key === filter;   // what they did: opened / won / stopped
  });
  const outcomeCount = (key) => listed.filter((o) => cartOutcome(o, reminderFor(byCart, o)).key === key).length;
  // The open chat: the cart, its reminder and what the customer did.
  const openCart = openId ? listed.find((o) => o.id === openId) || null : null;
  const chat = openCart ? (() => {
    const r = reminderFor(byCart, openCart);
    const st = cartReminderState(openCart, r, now);
    const local = sending[openCart.id];
    return (
      <CartChat cart={openCart} reminder={r} outcome={cartOutcome(openCart, r)} storeName={storeName} products={products}
        shopLang={recovery?.lang} canSend={st.canSend && local !== 'sent'} sending={local === 'sending'}
        problem={local && local !== 'sending' && local !== 'sent' ? local : ''} note={st.note}
        onSend={() => sendOne(openCart)} onClose={() => setOpenId(null)} full={!wide} />
    );
  })() : null;
  const shown = filtered.slice(0, visible);
  const remaining = filtered.length - shown.length;
  // The tiles read the 30 days, the same numbers Home shows.
  const counts30 = reminderCounts(rows, byCart, now);
  const won = recovery ? Number(recovery.recovered_value_30d) || 0 : null;

  const tile = 'bg-white rounded-2xl border border-gray-100 shadow-sm p-4 min-w-0';
  const tileLabel = 'text-[11px] font-bold uppercase tracking-[0.12em] text-gray-500';

  return (
    <div className="space-y-5">
      {/* ── The money at a glance (last 30 days) ─────────────────────────────── */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <div className={tile}>
          <p className={tileLabel}>Left behind</p>
          <p className="text-[22px] font-extrabold tabular-nums mt-2 leading-none text-pink-700">{formatINR(sum.value)}</p>
          <p className="text-[12px] text-gray-500 font-semibold mt-1.5">{sum.count} cart{sum.count === 1 ? '' : 's'} · last {ABANDONED_WINDOW_DAYS} days</p>
        </div>
        <div className={tile}>
          <p className={tileLabel}>Not reminded yet</p>
          <p className="text-[22px] font-extrabold tabular-nums mt-2 leading-none text-gray-900">{counts30.notReminded}</p>
          <p className="text-[12px] text-gray-500 font-semibold mt-1.5">{counts30.reminded} already reminded</p>
        </div>
        <div className={tile}>
          <p className={tileLabel}>Won back</p>
          <p className="text-[22px] font-extrabold tabular-nums mt-2 leading-none text-emerald-700">{won === null ? '—' : formatINR(won)}</p>
          <p className="text-[12px] text-gray-500 font-semibold mt-1.5">Bought after a reminder · 30 days</p>
        </div>
        <div className={tile}>
          <p className={tileLabel}>Auto reminder</p>
          <p className="text-[22px] font-extrabold mt-2 leading-none" style={{ color: recovery?.enabled ? themeColor : '#111827' }}>
            {recovery ? (recovery.enabled ? 'On' : 'Off') : '—'}
          </p>
          <p className="text-[12px] text-gray-500 font-semibold mt-1.5">1 hour after they leave</p>
        </div>
      </div>

      {/* Phone: one column (win back, Coins, then the list). Computer: the list on
          the left, win back and Coins in a column on the right. */}
      <div className="space-y-4 lg:space-y-0 lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-6 lg:items-start">
        <div className="space-y-4 lg:col-start-2 lg:row-start-1 lg:sticky lg:top-[88px]">
          {/* On a computer the open cart's chat takes this column; closing it brings win back and Coins back. */}
          {wide && chat ? chat : (
            <>
              {rows.length > 0 && (
                <RecoveryCard slug={slug} pin={pin} themeColor={themeColor} storeName={storeName}
                  sample={rows[0]} version={version} onSent={refreshAfterSend} onSummary={setRecovery} />
              )}
              <WalletCard slug={slug} pin={pin} themeColor={themeColor} storeName={storeName} waPhone={waPhone} compact version={version} />
            </>
          )}
        </div>
        {!wide && chat && <PhoneChat>{chat}</PhoneChat>}

        <section className="lg:col-start-1 lg:row-start-1 bg-white rounded-2xl border border-gray-100 shadow-sm min-w-0 overflow-hidden">
          <header className="px-4 sm:px-5 pt-4 pb-3 space-y-3 border-b border-gray-100">
            <div>
              <h2 className="text-[15px] font-extrabold text-gray-900 flex items-center gap-2">
                <ShoppingCart size={16} className="text-gray-400" /> Carts left behind
                {!loadingAll && !allFailed && (
                  <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">{shownSum.count}</span>
                )}
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">
                {!loadingAll && !allFailed && shownSum.count > 0
                  ? <>{shownSum.count} {shownSum.count === 1 ? 'customer' : 'customers'} · {formatINR(shownSum.value)} in their carts · {allTime ? 'all time' : `last ${ABANDONED_WINDOW_DAYS} days`}</>
                  : 'Started an order, typed their number, never sent it.'}
              </p>
              <p className="text-[11px] text-gray-400 mt-1 inline-flex items-center gap-1">
                <Lock size={11} /> Numbers stay private — PocketLink sends the reminder for you.
              </p>
            </div>

            {/* Window (the 30 days Home counts, or all time) and reminder filter. */}
            <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-1 px-1">
              {RANGES.map(([key, label]) => {
                const active = range === key;
                const n = key === '30d' ? rows.length : allResult?.ok ? allResult.data.length : 0;
                return (
                  <button key={key} type="button" onClick={() => pickRange(key)}
                    className={[
                      'flex-shrink-0 px-3.5 py-1.5 rounded-full text-xs font-semibold border transition',
                      active ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300',
                    ].join(' ')}>
                    {label}{n > 0 && <span className={active ? 'opacity-70' : 'text-gray-400'}> ({n})</span>}
                  </button>
                );
              })}
              {!loadingAll && !allFailed && listed.length > 0 && (
                <>
                  <span className="w-px bg-gray-200 my-1 flex-shrink-0" aria-hidden="true" />
                  {[...FILTERS, ...OUTCOME_FILTERS].map(([key, label]) => {
                    const n = key === 'all' ? counts.all : key === 'none' ? counts.notReminded : key === 'reminded' ? counts.reminded : outcomeCount(key);
                    if (n === 0 && !['all', 'none', 'reminded'].includes(key) && filter !== key) return null;
                    const on = filter === key;
                    return (
                      <button key={key} type="button" onClick={() => { setFilter(key); setVisible(ABANDONED_PAGE_SIZE); }}
                        className={['flex-shrink-0 px-3.5 py-1.5 rounded-full text-xs border transition whitespace-nowrap',
                          on ? 'bg-gray-100 border-gray-400 text-gray-900 font-bold' : 'bg-white border-gray-200 text-gray-600 font-semibold hover:border-gray-300'].join(' ')}>
                        {label} <span className="tabular-nums text-gray-400">{n}</span>
                      </button>
                    );
                  })}
                </>
              )}
            </div>
          </header>

          {loadingAll ? (
            <div className="divide-y divide-gray-100">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex items-center gap-3 px-5 py-4 animate-pulse">
                  <div className="w-10 h-10 rounded-lg bg-gray-100" />
                  <div className="flex-1 space-y-2"><div className="h-3 w-1/3 bg-gray-200 rounded" /><div className="h-3 w-2/3 bg-gray-100 rounded" /></div>
                </div>
              ))}
            </div>
          ) : allFailed ? (
            <div className="m-4 rounded-2xl border border-amber-100 bg-amber-50/60 px-4 py-3.5 flex items-center gap-3">
              <ShoppingCart size={18} className="text-amber-500 flex-shrink-0" />
              <div className="min-w-0 flex-grow">
                <p className="text-sm font-bold text-gray-900">Older abandoned carts unavailable</p>
                <p className="text-xs text-gray-500 mt-0.5">Nothing is lost — this screen couldn&rsquo;t reach them.</p>
              </div>
              <button type="button" onClick={() => setAllResult(null)}
                className="flex-shrink-0 text-xs font-bold px-3 py-2 rounded-xl text-white active:scale-[0.98] transition-transform"
                style={{ backgroundColor: themeColor }}>
                Try again
              </button>
            </div>
          ) : listed.length === 0 ? (
            <div className="text-center py-10 px-4">
              <div className="text-3xl mb-2">🎉</div>
              <p className="text-sm font-semibold text-gray-700">Nothing abandoned right now</p>
              <p className="text-xs text-gray-400 mt-1">
                {allTime
                  ? 'Customers who bail at checkout will appear here until they order.'
                  : <>Customers who bail at checkout will appear here for the last {ABANDONED_WINDOW_DAYS} days.</>}
              </p>
            </div>
          ) : (
            <>
              <ul className="divide-y divide-gray-100">
                {shown.map((o) => {
                  const items = Array.isArray(o.items) ? o.items : [];
                  const st = cartReminderState(o, reminderFor(byCart, o), now);
                  const did = cartOutcome(o, reminderFor(byCart, o));
                  const local = sending[o.id];
                  const problem = local && local !== 'sending' && local !== 'sent' ? local : '';
                  const reminded = local === 'sent' || st.key !== 'none';
                  const line = items.map((it) => `${it.name}${it.variant ? ` (${it.variant})` : ''}${it.qty > 1 ? ` × ${it.qty}` : ''}`).join(', ');
                  return (
                    <li key={o.id} className={['px-4 sm:px-5 py-3.5', openId === o.id ? 'bg-emerald-50/60 shadow-[inset_3px_0_0_#059669]' : ''].join(' ')}>
                      <div className="flex items-center gap-3 flex-wrap sm:flex-nowrap">
                        {/* The cart opens its chat: the reminder and what they did. */}
                        <button type="button" onClick={() => setOpenId(o.id)} aria-label={`Open the chat with ${o.customer_name || 'this customer'}`}
                          className="flex items-center gap-3 flex-1 min-w-[180px] text-left">
                        <CartThumbs items={items} products={products} />
                        <div className="flex-1 min-w-0">
                          <p className="font-bold text-gray-900 truncate">
                            {o.customer_name || 'Customer'}
                            {o.attempts > 1 && (
                              <span className="ml-1.5 text-[11px] font-bold text-gray-400"
                                    title={`Reached checkout on ${o.attempts} different days${allTime ? '' : ` in the last ${ABANDONED_WINDOW_DAYS} days`}`}>
                                Tried {o.attempts}×
                              </span>
                            )}
                          </p>
                          <p className="text-[12.5px] text-gray-500 truncate" title={line}>{line || 'Cart'} · {timeAgo(o.created_at)}</p>
                        </div>
                        <span className="font-extrabold tabular-nums text-gray-900">{formatINR(o.total)}</span>
                        <ChevronRight size={16} className="text-gray-300 flex-shrink-0" />
                        </button>
                        <div className="w-full sm:w-auto flex-shrink-0 flex sm:justify-end">
                          {st.canSend && local !== 'sent' ? (
                            <button type="button" onClick={() => sendOne(o)} disabled={local === 'sending'}
                              className="w-full sm:w-auto h-9 px-3.5 rounded-xl text-[13px] font-extrabold inline-flex items-center justify-center gap-1.5
                                         active:scale-[0.98] transition-transform disabled:opacity-60"
                              style={{ background: `${themeColor}18`, color: themeColor }}>
                              {local === 'sending' && <Loader2 size={14} className="animate-spin" />}
                              Send reminder · ₹1.50
                            </button>
                          ) : (
                            <span className={['inline-flex items-center h-7 px-2.5 rounded-lg text-[12px] font-bold whitespace-nowrap',
                              local === 'sent' ? OUTCOME_CHIP.sent : OUTCOME_CHIP[did.key]].join(' ')}>
                              {local === 'sent' ? 'Reminder sent just now'
                                : did.key === 'won' ? `🎉 Won back ${formatINR(did.total)}` : did.label}
                            </span>
                          )}
                        </div>
                      </div>
                      {/* Why it can't be sent, or what the send said. */}
                      {(problem || (!st.canSend && st.note) || (reminded && local !== 'sent')) && (
                        <p className={`mt-1.5 sm:pl-[52px] text-[11.5px] ${problem ? 'text-amber-700' : 'text-gray-500'}`}>
                          {problem || [reminded ? st.badge : '', !st.canSend ? st.note : ''].filter(Boolean).join(' · ')}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>

              {/* A page size, never a cap: every customer is one tap away. */}
              {remaining > 0 && (
                <div className="flex flex-col items-center gap-2 py-4 border-t border-gray-100">
                  <button type="button"
                    onClick={() => setVisible((v) => v + ABANDONED_PAGE_SIZE)}
                    className="px-6 py-3 rounded-xl bg-white border border-gray-200 text-sm font-bold text-gray-800
                               shadow-sm hover:bg-gray-50 active:scale-[0.98] transition-all">
                    Show {Math.min(ABANDONED_PAGE_SIZE, remaining)} more
                  </button>
                  <p className="text-xs text-gray-400">Showing {shown.length} of {filtered.length} customers</p>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}


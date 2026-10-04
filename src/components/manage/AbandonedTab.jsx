import { useState, useEffect, useCallback, useMemo } from 'react';
import { ShoppingCart, MessageCircle, Sparkles, Loader2 } from 'lucide-react';
import { fetchAbandonedCarts } from '../../utils/orderService';
import { summarizeAbandoned, ABANDONED_PAGE_SIZE, ABANDONED_WINDOW_DAYS } from '../../utils/abandonedCarts';
import { fetchReminderStatuses, sendRemindersNow } from '../../utils/cartReminderService';
import { statusMap, cartReminderState, reminderCounts } from '../../utils/reminderStatus';
import { formatINR } from '../../utils/currency';
import WalletCard from './WalletCard';
import RecoveryCard from './RecoveryCard';

/**
 * Abandoned carts — customers who typed their phone number at checkout but
 * never sent the order. Growth+ feature: paid stores see the list and win them
 * back; Free stores see the count + upgrade tease.
 *
 * The list is get_store_abandoned_carts, the same feed as Home's "N abandoned
 * carts" row, so the two numbers are always equal: ONE card per customer (their
 * latest cart in the last 30 days), and a customer who has ordered since is not
 * listed. Every customer is reachable: cards render a page at a time behind
 * "Show more", never silently cut off.
 *
 * Winning them back (RecoveryCard): "Send reminder to all" and the automatic
 * switch send the WhatsApp cart reminder from PocketLink, Rs 1.50 each from the
 * wallet; each card shows its reminder state and can send its own. The green
 * WhatsApp button stays for a personal note from the shop's own phone.
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

export default function AbandonedTab({ slug, pin, themeColor = '#0d9488', storeName = '', allowed = false, waPhone = '' }) {
  const [result, setResult] = useState(null);   // null = loading; else { ok, data }
  const [statuses, setStatuses] = useState([]);
  const [visible, setVisible] = useState(ABANDONED_PAGE_SIZE);
  const [filter, setFilter] = useState('all');
  const [version, setVersion] = useState(0);    // bumped after a send: wallet + results re-read
  const [sending, setSending] = useState({});   // cart id -> 'sending' | 'sent' | a short message

  const load = useCallback(async () => {
    setResult(null);
    setVisible(ABANDONED_PAGE_SIZE);
    const [carts, st] = await Promise.all([fetchAbandonedCarts(slug, pin), fetchReminderStatuses(slug, pin)]);
    setStatuses(st);
    setResult(carts);
  }, [slug, pin]);

  useEffect(() => { load(); }, [load]);

  const refreshAfterSend = useCallback(async () => {
    setVersion((v) => v + 1);
    setStatuses(await fetchReminderStatuses(slug, pin));
  }, [slug, pin]);

  const rows = useMemo(() => (result?.ok ? result.data : []), [result]);
  const byPhone = useMemo(() => statusMap(statuses), [statuses]);

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
              ? <><b>{sum.count} customer{sum.count === 1 ? '' : 's'}</b> started an order at {storeName || 'your store'} in the last {ABANDONED_WINDOW_DAYS} days but never sent it — name, number and cart already captured.</>
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
  const counts = reminderCounts(rows, byPhone, now);
  const filtered = filter === 'all' ? rows : rows.filter((o) => {
    const k = cartReminderState(o, byPhone.get(String(o.customer_phone)), now).key;
    return filter === 'none' ? k === 'none' : k !== 'none';
  });
  const shown = filtered.slice(0, visible);
  const remaining = filtered.length - shown.length;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-extrabold text-gray-900 flex items-center gap-2">
          <ShoppingCart size={18} className="text-gray-400" /> Abandoned carts
          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">{sum.count}</span>
        </h2>
        <p className="text-xs text-gray-500 mt-0.5">
          {sum.count > 0
            ? <>{sum.count} {sum.count === 1 ? 'customer' : 'customers'} · {formatINR(sum.value)} in their carts · last {ABANDONED_WINDOW_DAYS} days</>
            : 'Started an order, typed their number, never sent it.'}
        </p>
      </div>

      {rows.length > 0 && (
        <RecoveryCard slug={slug} pin={pin} themeColor={themeColor} storeName={storeName}
          sample={rows[0]} version={version} onSent={refreshAfterSend} />
      )}
      <WalletCard slug={slug} pin={pin} themeColor={themeColor} storeName={storeName} waPhone={waPhone} compact version={version} />

      {rows.length === 0 ? (
        <div className="text-center py-10 px-4 rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50/50">
          <div className="text-3xl mb-2">🎉</div>
          <p className="text-sm font-semibold text-gray-700">Nothing abandoned right now</p>
          <p className="text-xs text-gray-400 mt-1">Customers who bail at checkout will appear here for the last {ABANDONED_WINDOW_DAYS} days.</p>
        </div>
      ) : (
        <>
          <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-1 px-1">
            {FILTERS.map(([key, label]) => {
              const n = key === 'all' ? counts.all : key === 'none' ? counts.notReminded : counts.reminded;
              const on = filter === key;
              return (
                <button key={key} type="button" onClick={() => { setFilter(key); setVisible(ABANDONED_PAGE_SIZE); }}
                  className={['h-[34px] px-3.5 rounded-full text-[12.5px] whitespace-nowrap flex-shrink-0',
                    on ? 'bg-gray-900 text-white font-bold' : 'bg-white border border-gray-200 text-gray-700 font-semibold'].join(' ')}>
                  {label} {n}
                </button>
              );
            })}
          </div>

          {shown.map((o) => {
            const items = Array.isArray(o.items) ? o.items : [];
            const st = cartReminderState(o, byPhone.get(String(o.customer_phone)), now);
            const local = sending[o.id];
            const problem = local && local !== 'sending' && local !== 'sent' ? local : '';
            const nudge =
              `Hi${o.customer_name ? ` ${o.customer_name}` : ''}! 😊 You started an order at ${storeName || 'our store'}` +
              ` — ${items.map((i) => `${i.qty}× ${i.name}`).join(', ')} (${formatINR(o.total)}).` +
              ` Want me to confirm it for you? Happy to help!`;
            return (
              <div key={o.id} className="rounded-2xl border border-gray-100 bg-white shadow-sm p-4 space-y-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-extrabold text-gray-900 leading-tight truncate">{o.customer_name || 'Customer'}</p>
                    <p className="text-xs text-gray-500 mt-0.5 tabular-nums">+91 {o.customer_phone} · {timeAgo(o.created_at)}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <span className={['text-[11px] font-bold px-2 py-0.5 rounded-full',
                      local === 'sent' || st.key !== 'none' ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-600'].join(' ')}>
                      {local === 'sent' ? 'Reminder sent just now' : st.badge}
                    </span>
                    {o.attempts > 1 && (
                      <span className="text-[10.5px] font-bold text-gray-500"
                            title={`Reached checkout on ${o.attempts} different days in the last ${ABANDONED_WINDOW_DAYS} days`}>
                        Tried {o.attempts}×
                      </span>
                    )}
                  </div>
                </div>
                <div className="rounded-xl bg-gray-50 px-3 py-2">
                  {items.map((it, i) => (
                    <div key={i} className="flex items-center justify-between text-xs text-gray-600 py-0.5">
                      <span className="truncate pr-2">{it.name}{it.variant ? ` (${it.variant})` : ''} × {it.qty}</span>
                      <span className="tabular-nums flex-shrink-0">{formatINR((it.price || 0) * (it.qty || 0))}</span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between pt-1.5 mt-1 border-t border-dashed border-gray-200 text-xs font-semibold text-gray-700">
                    <span>Cart value</span><span className="tabular-nums">{formatINR(o.total)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {st.canSend && local !== 'sent' ? (
                    <button type="button" onClick={() => sendOne(o)} disabled={local === 'sending'}
                      className="flex-grow h-[42px] rounded-xl border-[1.5px] bg-white text-[13px] font-extrabold inline-flex items-center justify-center gap-1.5
                                 active:scale-[0.98] transition-transform disabled:opacity-60"
                      style={{ borderColor: themeColor, color: themeColor }}>
                      {local === 'sending' && <Loader2 size={14} className="animate-spin" />}
                      Send reminder · ₹1.50
                    </button>
                  ) : (
                    <p className="flex-grow text-[11.5px] text-gray-500">{problem || st.note}</p>
                  )}
                  <a href={`https://wa.me/91${o.customer_phone}?text=${encodeURIComponent(nudge)}`}
                     target="_blank" rel="noopener noreferrer" aria-label={`Message ${o.customer_name || 'customer'} on WhatsApp`}
                     className="w-[42px] h-[42px] rounded-xl inline-flex items-center justify-center text-white flex-shrink-0 active:scale-95"
                     style={{ backgroundColor: '#25D366' }}>
                    <MessageCircle size={18} />
                  </a>
                </div>
                {st.canSend && problem && <p className="text-[11.5px] text-amber-700">{problem}</p>}
              </div>
            );
          })}

          {/* A page size, never a cap: every customer is one tap away. */}
          {remaining > 0 && (
            <div className="flex flex-col items-center gap-2 pt-1">
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
    </div>
  );
}

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { RefreshCw, Star, BadgeCheck, Flag, Reply, ChevronDown, Send } from 'lucide-react';
import { fetchOwnerReviews, replyToReview, reportReview, reviewStats, fetchReviewAsks } from '../../utils/reviewService';
import { fetchOrders } from '../../utils/orderService';
import { buildReviewAsks, withAsk } from '../../utils/reviewAsks';
import { pinColors } from '../../utils/pinGate';
import ReviewAsks from './ReviewAsks';

function Stars({ value = 0, size = 13 }) {
  return (
    <div className="flex items-center" role="img" aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} size={size}
              className={n <= Math.round(value) ? 'fill-amber-400 text-amber-400' : 'fill-gray-200 text-gray-300'} />
      ))}
    </div>
  );
}

function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return '';
  }
}

// A soft colour circle with the reviewer's initials, the same colour every time.
function Avatar({ name = '' }) {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  const initials = ((parts[0]?.[0] || '?') + (parts[1]?.[0] || '')).toUpperCase();
  const hues = [152, 200, 28, 270, 340, 180, 45];
  const h = hues[(String(name).charCodeAt(0) || 0) % hues.length];
  return (
    <span className="w-9 h-9 rounded-full grid place-items-center text-[13px] font-extrabold flex-shrink-0"
          style={{ background: `hsl(${h} 70% 93%)`, color: `hsl(${h} 55% 28%)` }} aria-hidden="true">
      {initials}
    </span>
  );
}

/** One review: reply publicly, or report it to PocketLink. No delete, no hide. */
function ReviewCard({ r, slug, pin, themeColor, onChange }) {
  const [mode, setMode] = useState(null);   // 'reply' | 'report' | null
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState('');
  const removed = r.status === 'removed';
  const btn = pinColors(themeColor).button;

  function open(next) {
    setErr('');
    setMode(next);
    setText(next === 'reply' ? (r.merchant_reply || '') : '');
  }

  async function submit() {
    setErr('');
    if (mode === 'report' && text.trim().length < 5) { setErr('Say why you are reporting it.'); return; }
    setBusy(true);
    try {
      if (mode === 'reply') {
        await replyToReview(slug, pin, r.id, text);
        const reply = text.trim() || null;
        onChange(r.id, { merchant_reply: reply, merchant_replied_at: reply ? new Date().toISOString() : null });
      } else {
        await reportReview(slug, pin, r.id, text);
        onChange(r.id, { open_report: true, report_reason: text.trim() });
      }
      setMode(null);
    } catch (e) {
      setErr(e.message || 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={['rounded-2xl border bg-white shadow-sm p-4', removed ? 'border-gray-200 opacity-70' : 'border-gray-100'].join(' ')}>
      <div className="flex items-start gap-3">
        <Avatar name={r.display_name} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-extrabold text-gray-900 truncate">{r.display_name}</span>
            <Stars value={r.rating} />
            <span className="text-[12px] text-gray-400">{fmtDate(r.submitted_at)}</span>
            {!removed && !r.merchant_reply && (
              <span className="text-[11px] font-bold bg-amber-50 text-amber-800 px-1.5 py-0.5 rounded-md">New</span>
            )}
            {removed && <span className="text-[10px] font-bold bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">Removed by PocketLink</span>}
            {!removed && r.open_report && <span className="text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded">Reported · waiting</span>}
          </div>
          {(r.item_name || r.verified_purchase) && (
            <p className="text-[12px] text-gray-500 mt-0.5 flex items-center gap-1.5 flex-wrap">
              {r.item_name && <span>{r.item_name}{r.variant ? ` (${r.variant})` : ''}</span>}
              {r.item_name && r.verified_purchase && <span aria-hidden="true">·</span>}
              {r.verified_purchase && (
                <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
                  <BadgeCheck size={12} /> Verified order
                </span>
              )}
            </p>
          )}
          {r.body && <p className="text-[14px] text-gray-800 mt-2 leading-relaxed">{r.body}</p>}
          {removed && r.removed_reason && <p className="text-xs text-gray-500 mt-2">Reason: {r.removed_reason}</p>}

          {r.merchant_reply && mode !== 'reply' && (
            <div className="mt-3 rounded-xl bg-gray-50 px-3.5 py-2.5 text-[13px]">
              <p className="font-bold text-gray-700">Your reply</p>
              <p className="text-gray-700 mt-0.5">{r.merchant_reply}</p>
            </div>
          )}

          {mode && (
            <div className="mt-3 space-y-2">
              <textarea rows={3} maxLength={500} value={text} onChange={(e) => setText(e.target.value)}
                        id={`review-${mode}-${r.id}`}
                        placeholder={mode === 'reply'
                          ? 'Thank the customer, or say how you fixed the problem. Everyone can see this.'
                          : 'Why should PocketLink check this review? (for example: not our customer, abusive words)'}
                        className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-gray-300 resize-none" />
              {mode === 'report' && (
                <p className="text-[11px] text-gray-400">The review stays on your page until PocketLink checks it.</p>
              )}
              {err && <p className="text-xs text-red-500" role="alert">{err}</p>}
              <div className="flex gap-2">
                <button type="button" onClick={submit} disabled={busy}
                        className="h-9 px-4 rounded-xl text-[13px] font-bold text-white active:scale-95 disabled:opacity-60"
                        style={{ backgroundColor: mode === 'reply' ? btn : '#b45309' }}>
                  {busy ? 'Saving…' : mode === 'reply' ? (text.trim() ? 'Post reply' : 'Remove reply') : 'Send report'}
                </button>
                <button type="button" onClick={() => setMode(null)} disabled={busy}
                        className="h-9 px-4 rounded-xl text-[13px] font-semibold text-gray-600 hover:bg-gray-100">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {!mode && !removed && (
            <div className="flex items-center gap-2 mt-3">
              <button type="button" onClick={() => open('reply')}
                      className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[13px] font-bold active:scale-95"
                      style={r.merchant_reply ? { border: '1px solid #e5e7eb', color: '#374151' } : { background: `${themeColor}18`, color: btn }}>
                <Reply size={14} /> {r.merchant_reply ? 'Edit reply' : 'Reply'}
              </button>
              {!r.open_report && (
                <button type="button" onClick={() => open('report')}
                        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[13px] font-semibold text-amber-700 hover:bg-amber-50 active:scale-95">
                  <Flag size={14} /> Report
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * ReviewsTab — the seller's view of verified-purchase reviews.
 * Reviews come only from the "Ask for a review" link on a delivered order. The
 * seller can reply or report; PocketLink decides reports. Nothing is deleted.
 *
 * Layout (the approved prototype): the rating panel (average, the 5-to-1 bars,
 * how to get more) on the left on a computer, the reviews beside it.
 *
 * "Ask for reviews" (2026-11-16): delivered orders are listed above the reviews
 * (ReviewAsks), with who was asked and who reviewed, so nobody searches Orders.
 */
export default function ReviewsTab({ slug, pin, themeColor = '#0d9488', businessName = '', products = [], shopPhones = [] }) {
  const [rows, setRows]     = useState(null);   // null = loading
  const [error, setError]   = useState('');
  const [showOld, setShowOld] = useState(false);
  const [filter, setFilter] = useState('all');  // 'all' | 'unreplied'
  const [orders, setOrders] = useState(null);   // delivered orders to ask; null = loading
  const [asks, setAsks]     = useState(null);   // get_review_asks rows; null = loading
  const [asksError, setAsksError] = useState('');
  const askRef = useRef(null);

  const loadAsks = useCallback(async () => {
    setAsks(null);
    setAsksError('');
    const [list, res] = await Promise.all([fetchOrders(slug, pin), fetchReviewAsks(slug, pin)]);
    setOrders(list);
    setAsksError(res.error);
    setAsks(res.rows);
  }, [slug, pin]);

  const load = useCallback(async () => {
    setRows(null);
    loadAsks();
    const res = await fetchOwnerReviews(slug, pin);
    setRows(res.rows);
    setError(res.error);
  }, [slug, pin, loadAsks]);

  useEffect(() => { load(); }, [load]);

  function onChange(id, patch) {
    setRows((rs) => rs.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }

  // The shop's own numbers: orders placed from them can't be reviewed.
  const phonesKey = (shopPhones || []).filter(Boolean).join(',');
  const askData = useMemo(() => (orders && asks && rows && !asksError
    ? buildReviewAsks(orders, asks, rows, { shopPhones: phonesKey ? phonesKey.split(',') : [] })
    : null), [orders, asks, rows, asksError, phonesKey]);
  const onAsked   = useCallback((id) => setAsks((a) => withAsk(a || [], id, { asked: true })), []);
  const onSkipped = useCallback((id) => setAsks((a) => withAsk(a || [], id, { skipped: true })), []);
  const toAskCount = askData ? askData.toAsk.length : 0;

  if (rows === null) {
    return (
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-2xl border border-gray-100 bg-white p-4 animate-pulse">
            <div className="h-3.5 w-1/3 bg-gray-200 rounded mb-3" />
            <div className="h-3 w-2/3 bg-gray-100 rounded" />
          </div>
        ))}
      </div>
    );
  }

  const live    = rows.filter((r) => r.status === 'published' || r.status === 'removed');
  const legacy  = rows.filter((r) => r.status === 'legacy_unpublished');
  const published = rows.filter((r) => r.status === 'published');
  const { avg, count } = reviewStats(published);
  const reported = rows.filter((r) => r.status === 'published' && r.open_report).length;
  const unreplied = published.filter((r) => !r.merchant_reply).length;
  // How many of each star, 5 down to 1, for the bars.
  const dist = [5, 4, 3, 2, 1].map((n) => [n, published.filter((r) => Math.round(Number(r.rating) || 0) === n).length]);
  const listed = filter === 'unreplied' ? live.filter((r) => r.status === 'published' && !r.merchant_reply) : live;
  const btn = pinColors(themeColor).button;

  return (
    <div className="space-y-4 lg:space-y-0 lg:grid lg:grid-cols-[320px_minmax(0,1fr)] lg:gap-6 lg:items-start">
      {/* ── The rating panel ─────────────────────────────────────────────────── */}
      <aside className="space-y-4 lg:sticky lg:top-[88px]">
        <div className="rounded-2xl border border-gray-100 bg-white shadow-sm p-5">
          <div className="flex items-center gap-4">
            <p className="text-[44px] font-extrabold leading-none tabular-nums text-gray-900">{count > 0 ? avg.toFixed(1) : '—'}</p>
            <div>
              <Stars value={avg} size={18} />
              <p className="text-[13px] text-gray-500 mt-1">
                {count > 0 ? `${count} review${count === 1 ? '' : 's'} · all from real orders` : 'No reviews yet'}
              </p>
            </div>
          </div>
          <div className="mt-4 space-y-1.5" aria-label="Reviews by stars">
            {dist.map(([n, k]) => (
              <div key={n} className="flex items-center gap-2 text-[12px]">
                <span className="w-3 font-bold text-gray-600">{n}</span>
                <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
                  <div className="h-full rounded-full bg-amber-400" style={{ width: count ? `${Math.round((k / count) * 100)}%` : '0%' }} />
                </div>
                <span className="w-5 text-right text-gray-500 tabular-nums">{k}</span>
              </div>
            ))}
          </div>
          {reported > 0 && (
            <p className="mt-3 text-[12px] font-semibold text-amber-700">{reported} reported · PocketLink is checking</p>
          )}
          {askData && (
            <div className="mt-4 pt-3.5 border-t border-gray-100 grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-[20px] font-extrabold tabular-nums text-amber-700">{askData.toAsk.length}</p>
                <p className="text-[11.5px] text-gray-500">to ask</p>
              </div>
              <div>
                <p className="text-[20px] font-extrabold tabular-nums text-gray-900">{askData.asked.length}</p>
                <p className="text-[11.5px] text-gray-500">asked, waiting</p>
              </div>
              <div>
                <p className="text-[20px] font-extrabold tabular-nums text-emerald-700">{askData.rate === null ? '—' : `${askData.rate}%`}</p>
                <p className="text-[11.5px] text-gray-500">of asked review</p>
              </div>
            </div>
          )}
          <button type="button" onClick={() => askRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            className="mt-4 w-full h-10 rounded-xl text-[13.5px] font-bold inline-flex items-center justify-center gap-2 active:scale-[0.98] transition"
            style={{ background: `${themeColor}18`, color: btn }}>
            <Send size={15} /> Ask buyers for a review{toAskCount > 0 ? ` · ${toAskCount}` : ''}
          </button>
        </div>

        <div className="hidden lg:block rounded-2xl border border-gray-100 bg-white shadow-sm p-4 space-y-1.5">
          <p className="text-sm font-extrabold text-gray-900">📮 Get verified reviews</p>
          <p className="text-xs text-gray-500 leading-relaxed">
            Every delivered order shows under <b>Ask for reviews</b>. Tap <b>Send one by one</b>: WhatsApp opens with the message ready for each customer. Press send, come back, and the next one is waiting. Each link works for that order only, so every review is from a real purchase and shows under the product they bought.
          </p>
          <p className="text-xs text-gray-500 leading-relaxed">
            You can reply to any review. If one breaks the rules, report it and PocketLink will check it. Reviews can’t be deleted.
          </p>
        </div>
      </aside>

      {/* ── The reviews ──────────────────────────────────────────────────────── */}
      <div className="space-y-3 min-w-0">
        <ReviewAsks data={askData} error={asksError} onRetry={loadAsks} slug={slug} pin={pin}
          storeName={businessName} products={products} themeColor={themeColor}
          onAsked={onAsked} onSkipped={onSkipped} cardRef={askRef} />

        <h2 className="text-[15px] font-extrabold text-gray-900 pt-2">Your reviews</h2>
        <div className="flex items-center gap-2 flex-wrap">
          {[['all', 'All', live.length], ['unreplied', 'Waiting for your reply', unreplied]].map(([k, label, n]) => {
            const on = filter === k;
            return (
              <button key={k} type="button" onClick={() => setFilter(k)} aria-pressed={on}
                className={['px-3.5 py-1.5 rounded-full text-xs font-semibold border transition',
                  on ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'].join(' ')}>
                {label} <span className={on ? 'opacity-70' : 'text-gray-400'}>{n}</span>
              </button>
            );
          })}
          <button onClick={load}
                  className="ml-auto inline-flex items-center gap-1.5 text-xs font-semibold text-gray-600 border border-gray-200 bg-white rounded-xl px-3 py-2 hover:bg-gray-50 active:scale-95 transition">
            <RefreshCw size={13} /> Refresh
          </button>
        </div>

        {error && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800">
            Couldn’t load reviews: {error}
          </div>
        )}

        {live.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-10 text-center">
            <div className="text-4xl mb-3">⭐</div>
            <p className="font-bold text-gray-800">No verified reviews yet</p>
            <p className="text-sm text-gray-400 mt-1 max-w-xs mx-auto">
              Ask a customer whose order was delivered. Their review appears here and on your page.
            </p>
          </div>
        ) : listed.length === 0 ? (
          <div className="rounded-2xl border border-gray-100 bg-white p-8 text-center">
            <p className="font-bold text-gray-800">You have replied to every review</p>
            <button type="button" onClick={() => setFilter('all')} className="mt-2 text-[13px] font-bold" style={{ color: btn }}>Show all</button>
          </div>
        ) : (
          <div className="space-y-3">
            {listed.map((r) => (
              <ReviewCard key={r.id} r={r} slug={slug} pin={pin} themeColor={themeColor} onChange={onChange} />
            ))}
          </div>
        )}

        {legacy.length > 0 && (
          <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
            <button type="button" onClick={() => setShowOld((v) => !v)}
                    className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left" aria-expanded={showOld}>
              <span>
                <span className="block text-sm font-bold text-gray-800">{legacy.length} older review{legacy.length === 1 ? '' : 's'} not shown</span>
                <span className="block text-[11px] text-gray-400 mt-0.5">Written before reviews needed an order, so they can’t be verified. Kept for your records.</span>
              </span>
              <ChevronDown size={16} className={['text-gray-400 transition-transform flex-shrink-0', showOld ? 'rotate-180' : ''].join(' ')} />
            </button>
            {showOld && (
              <ul className="divide-y divide-gray-100 border-t border-gray-100">
                {legacy.map((r) => (
                  <li key={r.id} className="px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-semibold text-gray-700 truncate">{r.display_name}</span>
                      <span className="text-[11px] text-gray-400 flex-shrink-0">{fmtDate(r.submitted_at)}</span>
                    </div>
                    <div className="mt-1"><Stars value={r.rating} /></div>
                    {r.body && <p className="text-xs text-gray-500 mt-1 leading-relaxed">{r.body}</p>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

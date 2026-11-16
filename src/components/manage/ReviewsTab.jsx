import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { RefreshCw, Star, Flag, Reply, ChevronDown } from 'lucide-react';
import {
  fetchOwnerReviews, replyToReview, reportReview, reviewStats, fetchReviewAsks,
  fetchReviewAskAuto, saveReviewAskAuto, reviewAsksReady,
} from '../../utils/reviewService';
import { fetchOrders } from '../../utils/orderService';
import { buildReviewAsks, withAsk, askSourceLabel, daysAgo, orderImage } from '../../utils/reviewAsks';
import { pinColors } from '../../utils/pinGate';
import ReviewAsks from './ReviewAsks';
import { AutoCard, AutoRow, AutoSheet, CustomerPreview } from './ReviewAskAuto';

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

// "today", "3 days ago", then the date.
function whenText(iso) {
  const t = Date.parse(iso ?? '');
  if (!Number.isFinite(t)) return '';
  return Date.now() - t < 7 * 86400000 ? daysAgo(t) : fmtDate(iso);
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
function ReviewCard({ r, slug, pin, themeColor, onChange, source = '' }) {
  const [mode, setMode] = useState(null);   // 'reply' | 'report' | null
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState('');
  const removed = r.status === 'removed';
  const btn = pinColors(themeColor).button;
  const stars = Math.round(Number(r.rating) || 0);

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
    <article className={['rounded-2xl border bg-white shadow-sm p-4', removed ? 'border-gray-200 opacity-70' : 'border-gray-100'].join(' ')}>
      <div className="flex items-center gap-2.5">
        <Avatar name={r.display_name} />
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-bold text-gray-900 flex items-center gap-1.5 min-w-0">
            <span className="truncate">{r.display_name}</span>
            {!removed && !r.merchant_reply && (
              <span className="text-[10.5px] font-bold bg-amber-50 text-amber-800 px-1.5 py-0.5 rounded-md flex-shrink-0">New</span>
            )}
          </p>
          <p className="text-[12px] text-gray-500 truncate">
            {[r.item_name ? `${r.item_name}${r.variant ? ` (${r.variant})` : ''}` : '', whenText(r.submitted_at)].filter(Boolean).join(' · ')}
          </p>
        </div>
        <span className="text-[13px] font-extrabold text-amber-700 flex-shrink-0" role="img" aria-label={`${stars} out of 5 stars`}>
          {'★'.repeat(stars)}{'☆'.repeat(5 - stars)}
        </span>
      </div>
      {(removed || r.open_report) && (
        <p className="mt-2 flex gap-1.5">
          {removed && <span className="text-[10.5px] font-bold bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">Removed by PocketLink</span>}
          {!removed && r.open_report && <span className="text-[10.5px] font-bold bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded">Reported · waiting</span>}
        </p>
      )}
      {r.body && <p className="mt-2.5 text-[13.5px] text-gray-700 leading-relaxed">{r.body}</p>}
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
                    id={`review-${mode}-${r.id}`} aria-label={mode === 'reply' ? 'Your reply' : 'Why report it'}
                    placeholder={mode === 'reply'
                      ? 'Thank the customer, or say how you fixed the problem. Everyone can see this.'
                      : 'Why should PocketLink check this review? (for example: not our customer, abusive words)'}
                    className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-gray-300 resize-none" />
          {mode === 'report' && (
            <p className="text-[11px] text-gray-500">The review stays on your page until PocketLink checks it.</p>
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
        <div className="mt-3 flex items-center gap-2">
          {source && <span className="text-[11.5px] font-bold text-emerald-800 bg-emerald-50 rounded-full px-2.5 py-[3px]">{source}</span>}
          {!r.open_report && (
            <button type="button" onClick={() => open('report')} aria-label="Report this review"
                    className="ml-auto inline-flex items-center gap-1 h-8 px-2 rounded-lg text-[12px] font-semibold text-amber-700 hover:bg-amber-50">
              <Flag size={13} /> Report
            </button>
          )}
          <button type="button" onClick={() => open('reply')}
                  className={['inline-flex items-center gap-1.5 h-8 px-3 rounded-[10px] text-[12.5px] font-bold border border-gray-200 bg-white text-gray-900 hover:bg-gray-50 active:scale-95',
                    r.open_report ? 'ml-auto' : ''].join(' ')}>
            <Reply size={13} /> {r.merchant_reply ? 'Edit reply' : 'Reply'}
          </button>
        </div>
      )}
    </article>
  );
}

/**
 * ReviewsTab — the seller's view of verified-purchase reviews (layout: mockup
 * 4G4RXkGPxexuUZYPDdwZeH, founder 2026-11-16 "i want exactly how to did in mockup").
 *
 *   Computer  left: the rating panel (average, 5-to-1 bars, to ask / asked /
 *             % reviewed) and "Ask automatically". Right: "Ask for reviews"
 *             (ReviewAsks) and the latest reviews, two to a row.
 *   Phone     the rating, "N customers to ask", the "Ask automatically" row
 *             (its own screen), three counts, then the reviews.
 *
 * Reviews come only from a review link for a delivered order. The seller can
 * reply or report; PocketLink decides reports. Nothing is deleted.
 */
export default function ReviewsTab({
  slug, pin, themeColor = '#0d9488', businessName = '', products = [], shopPhones = [], onGoTab = null, onToAsk = null,
}) {
  const [rows, setRows]     = useState(null);   // null = loading
  const [error, setError]   = useState('');
  const [showOld, setShowOld] = useState(false);
  const [filter, setFilter] = useState('all');  // 'all' | 'unreplied'
  const [orders, setOrders] = useState(null);   // delivered orders to ask; null = loading
  const [asks, setAsks]     = useState(null);   // get_review_asks rows; null = loading
  const [asksError, setAsksError] = useState('');
  const [auto, setAuto]     = useState(null);   // get_review_ask_auto; null = loading
  const [autoBusy, setAutoBusy] = useState(false);
  const [autoErr, setAutoErr] = useState('');
  const [ready, setReady]   = useState(false);  // WhatsApp approved the template
  const [autoOpen, setAutoOpen] = useState(false);
  const [preview, setPreview] = useState(null); // 'en' | 'mr' | null
  const [listOpen, setListOpen] = useState(false);
  const [listTab, setListTab] = useState('ask');
  const askRef = useRef(null);

  const loadAsks = useCallback(async () => {
    setAsks(null);
    setAsksError('');
    const [list, res] = await Promise.all([fetchOrders(slug, pin), fetchReviewAsks(slug, pin)]);
    setOrders(list);
    setAsksError(res.error);
    setAsks(res.rows);
  }, [slug, pin]);

  const loadAuto = useCallback(async () => {
    const [a, r] = await Promise.all([fetchReviewAskAuto(slug, pin), reviewAsksReady(slug, pin)]);
    setAuto(a.ok ? a.data : null);
    setAutoErr(a.ok ? '' : 'Couldn’t load the automatic setting.');
    setReady(r.ready);
  }, [slug, pin]);

  const load = useCallback(async () => {
    setRows(null);
    loadAsks();
    loadAuto();
    const res = await fetchOwnerReviews(slug, pin);
    setRows(res.rows);
    setError(res.error);
  }, [slug, pin, loadAsks, loadAuto]);

  useEffect(() => { load(); }, [load]);

  function onChange(id, patch) {
    setRows((rs) => rs.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }

  // The shop's own numbers: orders placed from them can't be reviewed.
  const phonesKey = (shopPhones || []).filter(Boolean).join(',');
  const askData = useMemo(() => (orders && asks && rows && !asksError
    ? buildReviewAsks(orders, asks, rows, { shopPhones: phonesKey ? phonesKey.split(',') : [] })
    : null), [orders, asks, rows, asksError, phonesKey]);
  const onAsked   = useCallback((id, source = null) => setAsks((a) => withAsk(a || [], id, { asked: true, source })), []);
  const onSkipped = useCallback((id) => setAsks((a) => withAsk(a || [], id, { skipped: true })), []);
  const toAsk = askData ? askData.toAsk.length : null;

  // The orange number next to Reviews in the menu follows this screen.
  useEffect(() => { if (toAsk !== null) onToAsk?.(toAsk); }, [toAsk, onToAsk]);

  const saveAuto = useCallback(async (patch) => {
    if (!auto) return;
    const before = auto;
    const next = { ...auto, ...patch };
    setAuto(next);
    setAutoBusy(true);
    setAutoErr('');
    try {
      const saved = await saveReviewAskAuto(slug, pin, next);
      setAuto((a) => ({ ...a, ...saved }));
    } catch (e) {
      setAuto(before);
      setAutoErr(e.message || 'Could not save that.');
    } finally {
      setAutoBusy(false);
    }
  }, [auto, slug, pin]);

  // Whose message the preview shows: the first customer waiting, else a sample.
  const sample = useMemo(() => {
    const o = askData?.toAsk[0]?.o || askData?.asked[0]?.o;
    if (o) return { name: o.customer_name, item: o.items?.[0]?.name, image: orderImage(o, products) };
    const p = (products || [])[0];
    return { name: 'Amit', item: p?.name, image: p?.image || '' };
  }, [askData, products]);

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
  const openList = (t) => { setListTab(t); setListOpen(true); setTimeout(() => askRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); };

  const tile = (k, n, label, color) => (
    <button key={k} type="button" onClick={() => openList(k)}
      className="rounded-[14px] border border-gray-100 bg-white p-2.5 text-center active:scale-[0.98]">
      <span className={`block text-[19px] font-extrabold tabular-nums ${color}`}>{n}</span>
      <span className="block text-[11.5px] text-gray-500">{label}</span>
    </button>
  );

  return (
    <div className="space-y-4 lg:space-y-0 lg:grid lg:grid-cols-[320px_minmax(0,1fr)] lg:gap-6 lg:items-start">
      {/* ── Computer: the rating panel and "Ask automatically" ────────────────── */}
      <aside className="hidden lg:block space-y-4 lg:sticky lg:top-[88px]">
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
        </div>

        <AutoCard auto={auto} ready={ready} busy={autoBusy} err={autoErr} btn={btn}
          onChange={saveAuto} onPreview={() => setPreview(auto?.lang === 'mr' ? 'mr' : 'en')} />
      </aside>

      <div className="space-y-4 lg:space-y-5 min-w-0">
        {/* ── Phone: the rating, in one line ───────────────────────────────────── */}
        <div className="lg:hidden rounded-2xl border border-gray-100 bg-white shadow-sm px-4 py-3 flex items-center gap-3">
          <p className="text-[30px] font-extrabold leading-none tabular-nums text-gray-900">{count > 0 ? avg.toFixed(1) : '—'}</p>
          <div className="min-w-0">
            <Stars value={avg} size={15} />
            <p className="text-[12px] text-gray-500 mt-0.5 truncate">
              {count > 0 ? `${count} review${count === 1 ? '' : 's'} · all from real orders` : 'No reviews yet'}
            </p>
          </div>
        </div>

        <ReviewAsks data={askData} error={asksError} onRetry={loadAsks} slug={slug} pin={pin}
          storeName={businessName} products={products} themeColor={themeColor}
          onAsked={onAsked} onSkipped={onSkipped} cardRef={askRef}
          ready={ready} auto={auto} onSpent={loadAuto}
          listOpen={listOpen} onListOpen={setListOpen} tab={listTab} onTab={setListTab}
          phoneMiddle={(
            <>
              <AutoRow auto={auto} busy={autoBusy} btn={btn} onOpen={() => setAutoOpen(true)} onChange={saveAuto} />
              {askData && (
                <div className="grid grid-cols-3 gap-2">
                  {tile('ask', askData.toAsk.length, 'to ask', 'text-amber-700')}
                  {tile('asked', askData.asked.length, 'asked, waiting', 'text-gray-900')}
                  {tile('reviewed', askData.reviewed.length, 'reviewed', 'text-emerald-700')}
                </div>
              )}
            </>
          )} />

        {/* ── The reviews ──────────────────────────────────────────────────────── */}
        <section className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-[15px] font-extrabold text-gray-900">Latest reviews</h2>
            <span className="text-[12.5px] text-gray-500">from customers you asked</span>
            <div className="ml-auto flex items-center gap-1.5">
              {[['all', 'All', live.length], ['unreplied', 'Waiting for your reply', unreplied]].map(([k, label, n]) => {
                const on = filter === k;
                return (
                  <button key={k} type="button" onClick={() => setFilter(k)} aria-pressed={on}
                    className={['px-3 py-1 rounded-full text-[12px] font-semibold border transition',
                      on ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'].join(' ')}>
                    {label} <span className={on ? 'opacity-70' : 'text-gray-400'}>{n}</span>
                  </button>
                );
              })}
              <button type="button" onClick={load} aria-label="Refresh"
                className="w-8 h-8 grid place-items-center rounded-full border border-gray-200 bg-white text-gray-600 hover:bg-gray-50">
                <RefreshCw size={13} />
              </button>
            </div>
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
              <p className="text-sm text-gray-500 mt-1 max-w-xs mx-auto">
                Ask a customer whose order was delivered. Their review appears here and on your page.
              </p>
            </div>
          ) : listed.length === 0 ? (
            <div className="rounded-2xl border border-gray-100 bg-white p-8 text-center">
              <p className="font-bold text-gray-800">You have replied to every review</p>
              <button type="button" onClick={() => setFilter('all')} className="mt-2 text-[13px] font-bold" style={{ color: btn }}>Show all</button>
            </div>
          ) : (
            <div className="grid gap-3.5 lg:grid-cols-2 lg:items-start">
              {listed.map((r) => (
                <ReviewCard key={r.id} r={r} slug={slug} pin={pin} themeColor={themeColor} onChange={onChange}
                  source={askSourceLabel(asks, r.order_id)} />
              ))}
            </div>
          )}

          {legacy.length > 0 && (
            <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
              <button type="button" onClick={() => setShowOld((v) => !v)}
                      className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left" aria-expanded={showOld}>
                <span>
                  <span className="block text-sm font-bold text-gray-800">{legacy.length} older review{legacy.length === 1 ? '' : 's'} not shown</span>
                  <span className="block text-[11px] text-gray-500 mt-0.5">Written before reviews needed an order, so they can’t be verified. Kept for your records.</span>
                </span>
                <ChevronDown size={16} className={['text-gray-400 transition-transform flex-shrink-0', showOld ? 'rotate-180' : ''].join(' ')} />
              </button>
              {showOld && (
                <ul className="divide-y divide-gray-100 border-t border-gray-100">
                  {legacy.map((r) => (
                    <li key={r.id} className="px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm font-semibold text-gray-700 truncate">{r.display_name}</span>
                        <span className="text-[11px] text-gray-500 flex-shrink-0">{fmtDate(r.submitted_at)}</span>
                      </div>
                      <div className="mt-1"><Stars value={r.rating} /></div>
                      {r.body && <p className="text-xs text-gray-500 mt-1 leading-relaxed">{r.body}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      </div>

      {autoOpen && (
        <AutoSheet auto={auto} ready={ready} busy={autoBusy} err={autoErr} btn={btn}
          onChange={saveAuto} onClose={() => setAutoOpen(false)}
          onPreview={() => setPreview(auto?.lang === 'mr' ? 'mr' : 'en')}
          onAddCoins={() => { setAutoOpen(false); onGoTab?.('whatsapp'); }} />
      )}
      {preview && (
        <CustomerPreview lang={preview} onLang={setPreview} storeName={businessName} sample={sample} onClose={() => setPreview(null)} />
      )}
    </div>
  );
}

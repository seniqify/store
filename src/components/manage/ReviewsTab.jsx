import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Star, BadgeCheck, Flag, Reply, ChevronDown } from 'lucide-react';
import { fetchOwnerReviews, replyToReview, reportReview, reviewStats } from '../../utils/reviewService';

function Stars({ value = 0 }) {
  return (
    <div className="flex items-center" role="img" aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} size={13}
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

/** One review: reply publicly, or report it to PocketLink. No delete, no hide. */
function ReviewCard({ r, slug, pin, themeColor, onChange }) {
  const [mode, setMode] = useState(null);   // 'reply' | 'report' | null
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState('');
  const removed = r.status === 'removed';

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
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <span className="font-extrabold text-gray-900 truncate">{r.display_name}</span>
          {r.verified_purchase && (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full">
              <BadgeCheck size={10} /> Verified
            </span>
          )}
          {removed && <span className="text-[10px] font-bold bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">Removed by PocketLink</span>}
          {!removed && r.open_report && <span className="text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded">Reported · waiting</span>}
        </div>
        <span className="text-[11px] text-gray-400 flex-shrink-0">{fmtDate(r.submitted_at)}</span>
      </div>
      <div className="mt-1.5"><Stars value={r.rating} /></div>
      {r.item_name && <p className="text-[11px] text-gray-400 mt-1">Bought: {r.item_name}{r.variant ? ` (${r.variant})` : ''}</p>}
      {r.body && <p className="text-sm text-gray-600 mt-2 leading-relaxed">{r.body}</p>}
      {removed && r.removed_reason && <p className="text-xs text-gray-500 mt-2">Reason: {r.removed_reason}</p>}

      {r.merchant_reply && mode !== 'reply' && (
        <div className="mt-2 rounded-xl bg-gray-50 border border-gray-100 px-3 py-2">
          <p className="text-[11px] font-bold text-gray-700">Your reply</p>
          <p className="text-xs text-gray-600 mt-0.5">{r.merchant_reply}</p>
        </div>
      )}

      {mode && (
        <div className="mt-3 space-y-2">
          <textarea rows={3} maxLength={mode === 'reply' ? 500 : 500} value={text} onChange={(e) => setText(e.target.value)}
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
                    className="flex-1 py-2 rounded-xl text-xs font-bold text-white active:scale-95 disabled:opacity-60"
                    style={{ backgroundColor: mode === 'reply' ? themeColor : '#b45309' }}>
              {busy ? 'Saving…' : mode === 'reply' ? (text.trim() ? 'Save reply' : 'Remove reply') : 'Send report'}
            </button>
            <button type="button" onClick={() => setMode(null)} disabled={busy}
                    className="px-4 py-2 rounded-xl border border-gray-200 text-xs text-gray-500 hover:text-gray-700">
              Cancel
            </button>
          </div>
        </div>
      )}

      {!mode && !removed && (
        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-100">
          <button type="button" onClick={() => open('reply')}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-600 border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50 active:scale-95">
            <Reply size={13} /> {r.merchant_reply ? 'Edit reply' : 'Reply'}
          </button>
          {!r.open_report && (
            <button type="button" onClick={() => open('report')}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700 px-3 py-1.5 rounded-lg hover:bg-amber-50 active:scale-95 ml-auto">
              <Flag size={13} /> Report
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * ReviewsTab — the seller's view of verified-purchase reviews.
 * Reviews come only from the "Ask for a review" link on a delivered order. The
 * seller can reply or report; PocketLink decides reports. Nothing is deleted.
 */
export default function ReviewsTab({ slug, pin, themeColor = '#0d9488' }) {
  const [rows, setRows]     = useState(null);   // null = loading
  const [error, setError]   = useState('');
  const [showOld, setShowOld] = useState(false);

  const load = useCallback(async () => {
    setRows(null);
    const res = await fetchOwnerReviews(slug, pin);
    setRows(res.rows);
    setError(res.error);
  }, [slug, pin]);

  useEffect(() => { load(); }, [load]);

  function onChange(id, patch) {
    setRows((rs) => rs.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  }

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
  const { avg, count } = reviewStats(rows.filter((r) => r.status === 'published'));
  const reported = rows.filter((r) => r.status === 'published' && r.open_report).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-extrabold text-gray-900 flex items-center gap-2">
            <Star size={18} style={{ color: themeColor }} /> Reviews
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">
            {count > 0 ? `${avg.toFixed(1)} ★ · ${count} verified` : 'No reviews yet'}
            {reported > 0 && ` · ${reported} reported`}
          </p>
        </div>
        <button onClick={load}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-600 border border-gray-200 rounded-xl px-3 py-2 hover:bg-gray-50 active:scale-95 transition">
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      <div className="rounded-2xl border border-gray-100 bg-white shadow-sm p-4 space-y-1.5">
        <p className="text-sm font-extrabold text-gray-900">📮 Get verified reviews</p>
        <p className="text-xs text-gray-500 leading-relaxed">
          Open <b>Orders</b>, find a delivered order and tap <b>Ask for a review</b>. The customer gets a WhatsApp link for that order only, so every review is from a real purchase and shows under the product they bought.
        </p>
        <p className="text-xs text-gray-500 leading-relaxed">
          You can reply to any review. If one breaks the rules, report it and PocketLink will check it. Reviews can’t be deleted.
        </p>
      </div>

      {error && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800">
          Couldn’t load reviews: {error}
        </div>
      )}

      {live.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50/50 p-10 text-center">
          <div className="text-4xl mb-3">⭐</div>
          <p className="font-bold text-gray-800">No verified reviews yet</p>
          <p className="text-sm text-gray-400 mt-1 max-w-xs mx-auto">
            Ask a customer whose order was delivered. Their review appears here and on your page.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {live.map((r) => (
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
  );
}

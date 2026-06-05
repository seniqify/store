import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Star, Eye, EyeOff, Trash2 } from 'lucide-react';
import { fetchAllReviews, setReviewStatus, removeReview, reviewStats } from '../../utils/reviewService';

function Stars({ value = 0 }) {
  return (
    <div className="flex items-center">
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

/**
 * ReviewsTab — owner moderation. Lists every review (approved + hidden) and lets
 * the owner hide/re-publish or delete. Hidden reviews never show on the storefront.
 */
export default function ReviewsTab({ slug, pin, themeColor = '#0d9488' }) {
  const [reviews, setReviews] = useState(null);   // null = loading
  const [busy, setBusy] = useState(null);          // id being mutated

  const load = useCallback(async () => {
    setReviews(null);
    setReviews(await fetchAllReviews(slug, pin));
  }, [slug, pin]);

  useEffect(() => { load(); }, [load]);

  async function toggle(r) {
    const next = r.status === 'hidden' ? 'approved' : 'hidden';
    setBusy(r.id);
    setReviews((rs) => rs.map((x) => (x.id === r.id ? { ...x, status: next } : x)));
    await setReviewStatus(slug, pin, r.id, next);
    setBusy(null);
  }

  async function del(r) {
    setBusy(r.id);
    setReviews((rs) => rs.filter((x) => x.id !== r.id));
    await removeReview(slug, pin, r.id);
    setBusy(null);
  }

  if (reviews === null) {
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

  const visible = reviews.filter((r) => r.status !== 'hidden');
  const { avg, count } = reviewStats(visible);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-extrabold text-gray-900 flex items-center gap-2">
            <Star size={18} style={{ color: themeColor }} /> Reviews
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">
            {count > 0 ? `${avg.toFixed(1)} ★ · ${count} published` : 'No published reviews yet'}
            {reviews.length - visible.length > 0 && ` · ${reviews.length - visible.length} hidden`}
          </p>
        </div>
        <button onClick={load}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-600 border border-gray-200 rounded-xl px-3 py-2 hover:bg-gray-50 active:scale-95 transition">
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {reviews.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50/50 p-10 text-center">
          <div className="text-4xl mb-3">⭐</div>
          <p className="font-bold text-gray-800">No reviews yet</p>
          <p className="text-sm text-gray-400 mt-1 max-w-xs mx-auto">
            When customers rate your page, their reviews show up here. You can hide or delete any review.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {reviews.map((r) => {
            const hidden = r.status === 'hidden';
            return (
              <div key={r.id}
                   className={['rounded-2xl border bg-white shadow-sm p-4', hidden ? 'border-gray-200 opacity-60' : 'border-gray-100'].join(' ')}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-extrabold text-gray-900 truncate">{r.customer_name}</span>
                    {hidden && <span className="text-[10px] font-bold bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">Hidden</span>}
                  </div>
                  <span className="text-[11px] text-gray-400 flex-shrink-0">{fmtDate(r.created_at)}</span>
                </div>
                <div className="mt-1.5"><Stars value={r.rating} /></div>
                {r.comment && <p className="text-sm text-gray-600 mt-2 leading-relaxed">{r.comment}</p>}

                <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-100">
                  <button disabled={busy === r.id} onClick={() => toggle(r)}
                          className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-600 border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50 active:scale-95 disabled:opacity-50">
                    {hidden ? <><Eye size={13} /> Show</> : <><EyeOff size={13} /> Hide</>}
                  </button>
                  <button disabled={busy === r.id} onClick={() => del(r)}
                          className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-500 px-3 py-1.5 rounded-lg hover:bg-red-50 active:scale-95 disabled:opacity-50 ml-auto">
                    <Trash2 size={13} /> Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

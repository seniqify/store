import { useEffect, useState } from 'react';
import { Star, CheckCircle2, MessageSquarePlus } from 'lucide-react';
import { useBusinessConfig } from '../../contexts/BusinessContext';
import { fetchReviews, submitReview, reviewStats } from '../../utils/reviewService';

/** Static / interactive star row. */
function Stars({ value = 0, size = 14, onPick }) {
  return (
    <div className="flex items-center">
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = n <= Math.round(value);
        const star = (
          <Star
            size={size}
            className={filled ? 'fill-amber-400 text-amber-400' : 'fill-gray-200 text-gray-300'}
          />
        );
        return onPick ? (
          <button key={n} type="button" onClick={() => onPick(n)}
                  className="p-0.5 hover:scale-110 transition-transform" aria-label={`${n} star${n > 1 ? 's' : ''}`}>
            {star}
          </button>
        ) : (
          <span key={n}>{star}</span>
        );
      })}
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
 * StoreReviews — customer ratings & reviews for the storefront.
 * Rendered in the shared store shell, so it appears under every template.
 * Self-gates: renders nothing for demo stores (no slug).
 */
export default function StoreReviews() {
  const config = useBusinessConfig();
  const slug = config.slug;
  const primary = config.theme?.primary ?? '#0d9488';

  const [reviews, setReviews] = useState(null);   // null = loading
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!slug) return;
    let alive = true;
    fetchReviews(slug).then((r) => { if (alive) setReviews(r); });
    return () => { alive = false; };
  }, [slug]);

  if (!slug) return null;            // demo stores never show reviews

  const list = reviews || [];
  const { avg, count } = reviewStats(list);

  async function handleSubmit() {
    setError('');
    if (!name.trim())      { setError('Please add your name.'); return; }
    if (rating < 1)        { setError('Please tap a star rating.'); return; }
    setSubmitting(true);
    const ok = await submitReview(slug, { name, rating, comment });
    setSubmitting(false);
    if (!ok) { setError('Could not submit — please try again.'); return; }
    // Optimistically show it at the top.
    setReviews((prev) => [
      { id: `local-${Date.now()}`, customer_name: name.trim(), rating, comment: comment.trim(), created_at: new Date().toISOString() },
      ...(prev || []),
    ]);
    setDone(true);
    setName(''); setRating(0); setComment('');
    setTimeout(() => { setShowForm(false); setDone(false); }, 2200);
  }

  return (
    <section className="w-full max-w-7xl mx-auto px-3 sm:px-4 py-6 sm:py-10">
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">

        {/* Header — aggregate */}
        <div className="flex items-center justify-between gap-4 px-5 sm:px-6 py-5 border-b border-gray-100">
          <div className="flex items-center gap-4">
            <div>
              <h2 className="text-lg font-extrabold text-gray-900">Reviews</h2>
              {count > 0 ? (
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-2xl font-extrabold text-gray-900 tabular-nums">{avg.toFixed(1)}</span>
                  <div>
                    <Stars value={avg} size={14} />
                    <p className="text-[11px] text-gray-400 mt-0.5">{count} review{count === 1 ? '' : 's'}</p>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-gray-400 mt-1">No reviews yet — be the first!</p>
              )}
            </div>
          </div>
          {!showForm && (
            <button type="button" onClick={() => setShowForm(true)}
                    className="flex-shrink-0 inline-flex items-center gap-1.5 text-xs font-bold text-white px-3.5 py-2.5 rounded-xl active:scale-95 transition-transform shadow-sm"
                    style={{ backgroundColor: primary }}>
              <MessageSquarePlus size={14} /> Write a review
            </button>
          )}
        </div>

        {/* Write-a-review form */}
        {showForm && (
          <div className="px-5 sm:px-6 py-5 border-b border-gray-100 bg-gray-50/60">
            {done ? (
              <div className="flex items-center gap-2 text-emerald-600 font-semibold text-sm py-2">
                <CheckCircle2 size={18} /> Thanks for your review!
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-xs font-semibold text-gray-600">Your rating</span>
                  <Stars value={rating} size={26} onPick={setRating} />
                </div>
                <input
                  type="text" placeholder="Your name" maxLength={60}
                  value={name} onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-gray-300"
                />
                <textarea
                  rows={3} maxLength={400} placeholder="Tell others about your experience (optional)"
                  value={comment} onChange={(e) => setComment(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-gray-300 resize-none"
                />
                {error && <p className="text-xs text-red-500">{error}</p>}
                <div className="flex gap-2">
                  <button type="button" onClick={handleSubmit} disabled={submitting}
                          className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white hover:opacity-90 disabled:opacity-60 flex items-center justify-center gap-2"
                          style={{ backgroundColor: primary }}>
                    {submitting ? <><span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Submitting…</> : 'Submit review'}
                  </button>
                  <button type="button" onClick={() => { setShowForm(false); setError(''); }}
                          className="px-4 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-500 hover:text-gray-700">
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Review list */}
        <div className="px-5 sm:px-6 py-2">
          {reviews === null ? (
            <div className="py-8 space-y-3">
              {[0, 1].map((i) => (
                <div key={i} className="animate-pulse">
                  <div className="h-3 w-24 bg-gray-200 rounded mb-2" />
                  <div className="h-3 w-2/3 bg-gray-100 rounded" />
                </div>
              ))}
            </div>
          ) : list.length === 0 ? (
            !showForm && (
              <p className="text-center text-sm text-gray-400 py-8">
                Ordered from here? Share your experience to help others.
              </p>
            )
          ) : (
            <ul className="divide-y divide-gray-100">
              {list.map((r) => (
                <li key={r.id} className="py-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                            style={{ backgroundColor: primary }}>
                        {r.customer_name?.[0]?.toUpperCase() || '🙂'}
                      </span>
                      <span className="text-sm font-bold text-gray-900 truncate">{r.customer_name}</span>
                    </div>
                    <span className="text-[11px] text-gray-400 flex-shrink-0">{fmtDate(r.created_at)}</span>
                  </div>
                  <div className="mt-1.5 ml-10">
                    <Stars value={r.rating} size={13} />
                    {r.comment && <p className="text-sm text-gray-600 mt-1.5 leading-relaxed">{r.comment}</p>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

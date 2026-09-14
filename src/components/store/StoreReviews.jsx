import { useEffect, useState } from 'react';
import { Star, BadgeCheck } from 'lucide-react';
import { useBusinessConfig } from '../../contexts/BusinessContext';
import { fetchReviews, reviewStats } from '../../utils/reviewService';

/** Static star row. */
function Stars({ value = 0, size = 14 }) {
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

/**
 * StoreReviews — verified-purchase reviews on the storefront.
 * Rendered in the shared store shell, so it appears under every template.
 *
 * Read-only on purpose. There is no "Write a review" form: a review can only be
 * written from the link a seller sends for a DELIVERED order (/review/<token>),
 * so every review here is tied to a real order and to what was bought.
 * Self-gates: renders nothing for demo stores (no slug).
 */
export default function StoreReviews() {
  const config = useBusinessConfig();
  const slug = config.slug;
  const primary = config.theme?.primary ?? '#0d9488';

  const [reviews, setReviews] = useState(null);   // null = loading
  const [expanded, setExpanded] = useState(false);
  // Old "?review=1" links (sent before reviews needed an order) still land here.
  const [oldLink, setOldLink] = useState(false);

  useEffect(() => {
    if (!slug) return;
    let alive = true;
    fetchReviews(slug).then((r) => { if (alive) setReviews(r); });
    return () => { alive = false; };
  }, [slug]);

  useEffect(() => {
    if (!slug || typeof window === 'undefined') return;
    if (new URLSearchParams(window.location.search).get('review') !== '1') return;
    setOldLink(true);
    const t = setTimeout(() => {
      document.getElementById('reviews')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 150);
    return () => clearTimeout(t);
  }, [slug]);

  if (!slug) return null;            // demo stores never show reviews

  const list = reviews || [];
  const { avg, count } = reviewStats(list);
  const dist = [5, 4, 3, 2, 1].map((n) => ({
    n,
    c: list.filter((r) => Math.round(Number(r.rating)) === n).length,
  }));
  const PREVIEW = 3;
  const shown   = expanded ? list : list.slice(0, PREVIEW);
  const hidden  = Math.max(0, list.length - PREVIEW);

  return (
    <section id="reviews" className="w-full max-w-7xl mx-auto px-3 sm:px-4 py-6 sm:py-10 scroll-mt-20">
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">

        {/* Header — aggregate score + rating spread */}
        <div className="px-5 sm:px-6 py-5 border-b border-gray-100">
          <h2 className="text-lg font-extrabold text-gray-900">Reviews</h2>
          {count > 0 ? (
            <div className="flex items-center gap-2 mt-1">
              <span className="text-3xl font-extrabold text-gray-900 tabular-nums leading-none">{avg.toFixed(1)}</span>
              <div>
                <Stars value={avg} size={14} />
                <p className="text-[11px] text-gray-400 mt-0.5">
                  {count} verified review{count === 1 ? '' : 's'}
                </p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-400 mt-1">
              {reviews === null ? 'Loading reviews…' : 'No reviews yet.'}
            </p>
          )}

          {count > 0 && (
            <div className="mt-4 flex flex-col gap-1 max-w-xs">
              {dist.map(({ n, c }) => (
                <div key={n} className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-gray-400 tabular-nums w-6 text-right">{n}★</span>
                  <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${(c / count) * 100}%`, backgroundColor: primary }} />
                  </div>
                  <span className="text-[10px] text-gray-400 tabular-nums w-5">{c}</span>
                </div>
              ))}
            </div>
          )}

          <p className="text-[11px] text-gray-400 mt-3 inline-flex items-start gap-1.5">
            <BadgeCheck size={13} className="text-emerald-600 flex-shrink-0 mt-px" />
            Only customers who received an order can review. The store can reply, but can’t edit or delete reviews.
          </p>
          {oldLink && (
            <p className="mt-3 text-xs text-gray-600 bg-gray-50 border border-gray-100 rounded-xl px-3 py-2.5">
              Got this link to leave a review? Reviews are now written from the link the store sends after your order is delivered.
            </p>
          )}
        </div>

        {/* Review list */}
        {reviews === null ? (
          <div className="px-5 sm:px-6 py-8 space-y-3">
            {[0, 1].map((i) => (
              <div key={i} className="animate-pulse">
                <div className="h-3 w-24 bg-gray-200 rounded mb-2" />
                <div className="h-3 w-2/3 bg-gray-100 rounded" />
              </div>
            ))}
          </div>
        ) : list.length > 0 && (
          <div className="px-5 sm:px-6 py-2">
            <ul className={['divide-y divide-gray-100', expanded ? 'max-h-[26rem] overflow-y-auto' : ''].join(' ')}>
              {shown.map((r) => (
                <li key={r.id} className="py-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                            style={{ backgroundColor: primary }}>
                        {r.customer_name?.[0]?.toUpperCase() || '🙂'}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-gray-900 truncate">{r.customer_name}</p>
                        {r.verified && (
                          <p className="text-[10px] font-bold text-emerald-700 inline-flex items-center gap-1">
                            <BadgeCheck size={11} /> Verified purchase
                          </p>
                        )}
                      </div>
                    </div>
                    <span className="text-[11px] text-gray-400 flex-shrink-0">{fmtDate(r.created_at)}</span>
                  </div>
                  <div className="mt-1.5 ml-10">
                    <Stars value={r.rating} size={13} />
                    {r.itemName && (
                      <p className="text-[11px] text-gray-400 mt-1 truncate">
                        Bought: {r.itemName}{r.variant ? ` (${r.variant})` : ''}
                      </p>
                    )}
                    {r.comment && <p className="text-sm text-gray-600 mt-1.5 leading-relaxed line-clamp-3">{r.comment}</p>}
                    {r.edited && <p className="text-[10px] text-gray-400 mt-1">Edited</p>}
                    {r.reply && (
                      <div className="mt-2 rounded-xl bg-gray-50 border border-gray-100 px-3 py-2">
                        <p className="text-[11px] font-bold text-gray-700">Reply from {config.businessName || 'the store'}</p>
                        <p className="text-xs text-gray-600 mt-0.5 leading-relaxed">{r.reply}</p>
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {hidden > 0 && (
              <button type="button" onClick={() => setExpanded((v) => !v)}
                      className="w-full py-3 text-xs font-bold border-t border-gray-100 text-gray-500 hover:text-gray-800 transition-colors">
                {expanded ? 'Show less' : `Show all ${list.length} reviews`}
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

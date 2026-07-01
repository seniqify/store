import { useEffect, useRef, useMemo } from 'react';

/**
 * CategoryCircles — visual category rail: a round avatar (category image, or its
 * emoji on a tint) with the label below and a count badge. Horizontally
 * scrollable (Instagram/Blinkit-style), keeps the active circle in view.
 *
 * Replaces the old pill tabs — categories are the storefront's real navigation,
 * so they read as bright, tappable icons instead of a text heading.
 *
 * Props:
 *   categories  { id, label, emoji, image? }[]  — BUSINESS_CONFIG.categories
 *   products    Product[]                        — for per-category counts
 *   selected    string                           — active category id
 *   onChange    (id: string) => void
 */
export default function CategoryCircles({ categories = [], products = [], selected, onChange }) {
  const railRef = useRef(null);
  const btnRefs = useRef({});

  const counts = useMemo(() => {
    const map = { all: products.length };
    products.forEach((p) => { map[p.category] = (map[p.category] || 0) + 1; });
    return map;
  }, [products]);

  // Keep the active circle scrolled into view.
  useEffect(() => {
    const btn = btnRefs.current[selected];
    const rail = railRef.current;
    if (!btn || !rail) return;
    rail.scrollTo({ left: btn.offsetLeft - rail.offsetWidth / 2 + btn.offsetWidth / 2, behavior: 'smooth' });
  }, [selected]);

  // pt-2/px-1.5 give the active ring (ring-offset) room — an overflow-x scroll
  // container clips vertically too, so without padding the ring's top gets cut.
  return (
    <div ref={railRef} className="flex gap-3 overflow-x-auto scrollbar-hide -mx-1.5 px-1.5 pt-2 pb-1"
         role="tablist" aria-label="Product categories">
      {categories.map((cat) => {
        const isActive = selected === cat.id;
        const count    = counts[cat.id] ?? 0;
        const isEmpty  = count === 0 && cat.id !== 'all';

        return (
          <button
            key={cat.id}
            ref={(el) => { btnRefs.current[cat.id] = el; }}
            role="tab"
            aria-selected={isActive}
            onClick={() => !isEmpty && onChange(cat.id)}
            disabled={isEmpty}
            className={[
              'flex-shrink-0 w-[72px] flex flex-col items-center gap-1.5 select-none',
              'focus:outline-none active:scale-95 transition-transform',
              isEmpty ? 'cursor-not-allowed opacity-40' : 'cursor-pointer',
            ].join(' ')}
          >
            {/* Round avatar */}
            <div className={[
              'w-16 h-16 rounded-full flex items-center justify-center overflow-hidden',
              'transition-all duration-200',
              isActive
                ? 'ring-2 ring-brand ring-offset-2 ring-offset-[#f8fafc] bg-brand/10'
                : 'border border-gray-200 bg-white',
            ].join(' ')}>
              {cat.image ? (
                <img src={cat.image} alt={cat.label} className="w-full h-full object-cover" />
              ) : (
                <span className="text-[26px] leading-none">{cat.emoji || '🛒'}</span>
              )}
            </div>

            {/* Label + count */}
            <div className="w-full text-center leading-tight">
              <p className={[
                'text-[11px] line-clamp-2',
                isActive ? 'font-extrabold text-brand-dark' : 'font-semibold text-gray-700',
              ].join(' ')}>
                {cat.label}
              </p>
              {count > 0 && (
                <p className="text-[10px] font-semibold text-gray-400 tabular-nums mt-0.5">{count}</p>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

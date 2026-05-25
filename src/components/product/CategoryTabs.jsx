import { useEffect, useRef, useMemo } from 'react';

/**
 * CategoryTabs
 * ────────────────────────────────────────────────────────────────────────────
 * Tab-bar component that replaces the old pill-style CategoryFilter.
 *
 * Features:
 *  • Animated sliding underline indicator that moves between tabs
 *  • Per-category product count badge (grayed-out when 0)
 *  • Horizontally scrollable on mobile — active tab always scrolls into view
 *  • Keyboard accessible (arrow keys move between tabs)
 *
 * Props:
 *   categories  { id, label, emoji }[]  — from BUSINESS_CONFIG.categories
 *   products    Product[]               — to compute per-category counts
 *   selected    string                  — active category id
 *   onChange    (id: string) => void
 */
export default function CategoryTabs({ categories = [], products = [], selected, onChange }) {
  const tabsRef   = useRef(null);           // scroll container
  const btnRefs   = useRef({});             // map of id → button DOM node
  const barRef    = useRef(null);           // the sliding underline bar

  // ── Per-category product counts ─────────────────────────────────────────
  const counts = useMemo(() => {
    const map = { all: products.length };
    products.forEach((p) => {
      map[p.category] = (map[p.category] || 0) + 1;
    });
    return map;
  }, [products]);

  // ── Move the sliding underline ──────────────────────────────────────────
  useEffect(() => {
    const btn       = btnRefs.current[selected];
    const container = tabsRef.current;
    const bar       = barRef.current;
    if (!btn || !container || !bar) return;

    // Position + width relative to the scroll container
    const btnLeft  = btn.offsetLeft;
    const btnWidth = btn.offsetWidth;

    bar.style.transform = `translateX(${btnLeft}px)`;
    bar.style.width     = `${btnWidth}px`;

    // Auto-scroll so active tab is visible with a bit of margin
    const scrollLeft  = btnLeft - container.offsetWidth / 2 + btnWidth / 2;
    container.scrollTo({ left: scrollLeft, behavior: 'smooth' });
  }, [selected]);

  // ── Keyboard navigation (← → arrow keys) ────────────────────────────────
  function handleKeyDown(e, currentId) {
    const ids = categories.map((c) => c.id);
    const idx = ids.indexOf(currentId);
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      const next = ids[(idx + 1) % ids.length];
      onChange(next);
      btnRefs.current[next]?.focus();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const prev = ids[(idx - 1 + ids.length) % ids.length];
      onChange(prev);
      btnRefs.current[prev]?.focus();
    }
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      {/* Scroll container */}
      <div
        ref={tabsRef}
        className="flex overflow-x-auto scrollbar-hide relative"
        role="tablist"
        aria-label="Product categories"
      >
        {categories.map((cat) => {
          const isActive = selected === cat.id;
          const count    = counts[cat.id] ?? 0;
          const isEmpty  = count === 0;

          return (
            <button
              key={cat.id}
              ref={(el) => { btnRefs.current[cat.id] = el; }}
              role="tab"
              aria-selected={isActive}
              aria-controls={`panel-${cat.id}`}
              onClick={() => !isEmpty && onChange(cat.id)}
              onKeyDown={(e) => handleKeyDown(e, cat.id)}
              disabled={isEmpty}
              className={[
                // base layout
                'flex-shrink-0 flex items-center gap-1.5 px-4 sm:px-5 py-3.5',
                'text-sm font-medium whitespace-nowrap',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand',
                'transition-colors duration-200 select-none',
                // per-state colours
                isActive
                  ? 'text-brand'
                  : isEmpty
                  ? 'text-gray-300 cursor-not-allowed'
                  : 'text-gray-500 hover:text-gray-800',
              ].join(' ')}
            >
              {/* Emoji */}
              <span className="text-base leading-none">{cat.emoji}</span>

              {/* Label */}
              <span>{cat.label}</span>

              {/* Count badge */}
              <span
                className={[
                  'text-xs px-1.5 py-0.5 rounded-full font-semibold leading-none',
                  isActive
                    ? 'bg-brand/10 text-brand'
                    : isEmpty
                    ? 'bg-gray-100 text-gray-300'
                    : 'bg-gray-100 text-gray-400',
                ].join(' ')}
              >
                {count}
              </span>
            </button>
          );
        })}

        {/* ── Sliding underline indicator ──────────────────────────────── */}
        {/* Positioned at the bottom of the tab bar, moves via JS transform */}
        <div
          ref={barRef}
          className="absolute bottom-0 left-0 h-0.5 bg-brand rounded-full
                     transition-all duration-250 ease-in-out pointer-events-none"
          style={{ width: 0 }}
          aria-hidden="true"
        />
      </div>
    </div>
  );
}

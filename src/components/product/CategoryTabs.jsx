import { useEffect, useRef, useMemo } from 'react';

/**
 * CategoryTabs — horizontal pill/chip category filter.
 *
 * Modern q-commerce style (Blinkit/Swiggy): the active category is a solid
 * brand-filled pill; the rest are clean white outlines. Scrolls horizontally,
 * keeps the active pill in view, and stays keyboard accessible.
 *
 * Props:
 *   categories  { id, label, emoji }[]  — from BUSINESS_CONFIG.categories
 *   products    Product[]               — to compute per-category counts
 *   selected    string                  — active category id
 *   onChange    (id: string) => void
 */
export default function CategoryTabs({ categories = [], products = [], selected, onChange }) {
  const tabsRef = useRef(null);     // scroll container
  const btnRefs = useRef({});       // id → button node

  // Per-category product counts.
  const counts = useMemo(() => {
    const map = { all: products.length };
    products.forEach((p) => { map[p.category] = (map[p.category] || 0) + 1; });
    return map;
  }, [products]);

  // Keep the active pill scrolled into view.
  useEffect(() => {
    const btn = btnRefs.current[selected];
    const container = tabsRef.current;
    if (!btn || !container) return;
    const scrollLeft = btn.offsetLeft - container.offsetWidth / 2 + btn.offsetWidth / 2;
    container.scrollTo({ left: scrollLeft, behavior: 'smooth' });
  }, [selected]);

  // ← → arrow-key navigation between pills.
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
    <div
      ref={tabsRef}
      className="flex gap-2 overflow-x-auto scrollbar-hide -mx-1 px-1 py-1"
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
              'flex-shrink-0 inline-flex items-center gap-1.5 rounded-full border',
              'px-3.5 py-2 text-sm font-semibold whitespace-nowrap select-none',
              'transition-all duration-200 active:scale-95',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
              isActive
                ? 'bg-brand text-white border-transparent shadow-md shadow-brand/25'
                : isEmpty
                ? 'bg-white text-gray-300 border-gray-100 cursor-not-allowed'
                : 'bg-white text-gray-600 border-gray-200 hover:border-brand/40 hover:text-brand',
            ].join(' ')}
          >
            <span className="text-base leading-none">{cat.emoji}</span>
            <span>{cat.label}</span>
            <span className={[
              'text-[11px] font-bold tabular-nums leading-none',
              isActive ? 'text-white/80' : isEmpty ? 'text-gray-300' : 'text-gray-400',
            ].join(' ')}>
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

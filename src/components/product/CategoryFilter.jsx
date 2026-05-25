/**
 * ⚠️  SUPERSEDED — use CategoryTabs instead.
 *     src/components/product/CategoryTabs.jsx
 *
 * CategoryFilter (pill style) is kept for reference only.
 * ProductGrid no longer imports from this file.
 */
export default function CategoryFilter({ categories = [], selected, onChange }) {
  return (
    <div className="flex gap-2 overflow-x-auto scrollbar-hide py-1 px-1 -mx-1">
      {categories.map((cat) => {
        const isActive = selected === cat.id;
        return (
          <button
            key={cat.id}
            onClick={() => onChange(cat.id)}
            className={[
              'flex-shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium',
              'transition-all duration-150 whitespace-nowrap focus:outline-none',
              isActive
                ? 'bg-brand text-white shadow-sm'
                : 'bg-white text-gray-600 border border-gray-200 hover:border-brand hover:text-brand',
            ].join(' ')}
          >
            {cat.emoji && <span className="text-base leading-none">{cat.emoji}</span>}
            {cat.label}
          </button>
        );
      })}
    </div>
  );
}

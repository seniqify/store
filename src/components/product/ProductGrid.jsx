import { useState, useRef } from 'react';
import { Search, X } from 'lucide-react';
import ProductCard from './ProductCard';
import CategoryTabs from './CategoryTabs';
import EmptyState from '../ui/EmptyState';

/**
 * ProductGrid
 * ────────────────────────────────────────────────────────────────────────────
 * Renders CategoryTabs + a responsive grid of ProductCards.
 *
 * Behavior:
 *  • Clicking a category tab filters the grid with a smooth fade-out/in.
 *  • onAddToCart receives (product, qty) — quantity chosen on the card.
 *  • The "active category" label updates in the section heading.
 *
 * Props:
 *   products    Product[]     — BUSINESS_CONFIG.products
 *   categories  Category[]    — BUSINESS_CONFIG.categories
 *   cart        CartItem[]    — for "in cart" state on each card
 *   onAddToCart (product, qty) => void
 */
export default function ProductGrid({
  products = [], categories = [], cart = [], onAddToCart, onIncrease, onDecrease, onSetQty,
  heading = 'Our Products', nounSingular = 'product', nounPlural = 'products',
  searchPlaceholder = 'Search products…',
}) {
  const [activeCategory, setActiveCategory] = useState('all');
  const [fading, setFading]                 = useState(false);
  const [query, setQuery]                   = useState('');
  const pendingCategory                     = useRef(null);

  // ── Animated category switch ───────────────────────────────────────────
  function handleCategoryChange(id) {
    if (id === activeCategory) return;

    pendingCategory.current = id;
    setFading(true);

    // After the fade-out (150 ms), swap the category and fade back in
    setTimeout(() => {
      setActiveCategory(pendingCategory.current);
      setFading(false);
    }, 150);
  }

  // ── Filtered product list (category + search) ──────────────────────────
  const byCategory =
    activeCategory === 'all'
      ? products
      : products.filter((p) => p.category === activeCategory);
  const q = query.trim().toLowerCase();
  const filtered = q
    ? byCategory.filter((p) => p.name.toLowerCase().includes(q))
    : byCategory;

  // ── Cart qty lookup ────────────────────────────────────────────────────
  function getCartQty(id) {
    // Sum the base product line + any variant lines (id "3" or "3::M").
    const prefix = `${id}::`;
    return cart.reduce((s, i) => (i.id === id || String(i.id).startsWith(prefix) ? s + i.qty : s), 0);
  }

  // Category label for the heading
  const activeCatLabel =
    categories.find((c) => c.id === activeCategory)?.label ?? 'All Products';

  return (
    <section className="w-full min-w-0 overflow-hidden">

      {/* Section heading + search */}
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-xl sm:text-2xl font-extrabold text-gray-900 flex items-center gap-2.5">
            <span className="w-1.5 h-6 rounded-full bg-brand inline-block flex-shrink-0" />
            {heading}
          </h2>
          <p className="text-sm text-gray-500 mt-1 ml-4">
            <span
              key={`${activeCategory}-${q}`}   // re-mount to animate count
              className="inline-block animate-in fade-in duration-300"
            >
              <span className="font-semibold text-brand-dark">{filtered.length}</span>
              {' '}{filtered.length === 1 ? nounSingular : nounPlural}
              {q
                ? <> matching “{query.trim()}”</>
                : <> in <span className="font-medium text-gray-700">{activeCatLabel}</span></>}
            </span>
          </p>
        </div>

        {/* Search */}
        <div className="relative w-full sm:w-64 flex-shrink-0">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full pl-9 pr-9 py-2.5 rounded-xl border border-gray-200 bg-white text-sm
                       text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2
                       focus:ring-brand/30 focus:border-brand transition-all"
          />
          {query && (
            <button onClick={() => setQuery('')} aria-label="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors">
              <X size={15} />
            </button>
          )}
        </div>
      </div>

      {/* Category tabs — wired to the animated switch handler */}
      <div className="mb-6">
        <CategoryTabs
          categories={categories}
          products={products}
          selected={activeCategory}
          onChange={handleCategoryChange}
        />
      </div>

      {/* Product grid — fades out briefly on category change */}
      <div
        className={[
          'transition-all duration-150',
          fading ? 'opacity-0 translate-y-1' : 'opacity-100 translate-y-0',
        ].join(' ')}
      >
        {filtered.length === 0 ? (
          <EmptyState
            icon="🔍"
            title={q ? `No ${nounPlural} match “${query.trim()}”` : `No ${nounPlural} in this category`}
            description={q ? 'Try a different search term.' : 'Try a different category or check back later.'}
          />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4 w-full max-w-full">
            {filtered.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                cartQty={getCartQty(product.id)}
                onAddToCart={onAddToCart}
                onIncrease={onIncrease}
                onDecrease={onDecrease}
                onSetQty={onSetQty}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

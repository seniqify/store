import { useState, useRef, useEffect, useMemo } from 'react';
import { Search, X, ChevronDown } from 'lucide-react';
import ProductCard from './ProductCard';
import CategoryCircles from './CategoryCircles';
import EmptyState from '../ui/EmptyState';

// Products shown before a "Show more" tap. Keeps big catalogues fast to render
// and scannable — a 100-item store no longer paints as one endless scroll.
const PAGE_SIZE = 24;

// Lowest price a product sells at (min variant option price, else base price).
function priceOf(p) {
  const opts = p.variants?.options;
  if (Array.isArray(opts) && opts.length) {
    const ps = opts.map((o) => Number(o.price)).filter((n) => !Number.isNaN(n));
    if (ps.length) return Math.min(...ps);
  }
  return Number(p.price) || 0;
}

const SORTS = [
  { id: 'popular',    label: 'Popular' },
  { id: 'price-asc',  label: 'Price: Low to High' },
  { id: 'price-desc', label: 'Price: High to Low' },
  { id: 'name',       label: 'Name: A to Z' },
];

/**
 * ProductGrid
 * ────────────────────────────────────────────────────────────────────────────
 * Renders a sticky filter bar (circular category rail + sort) over a responsive
 * grid of ProductCards.
 *
 * Behavior:
 *  • Circular category tiles filter the grid with a smooth fade-out/in.
 *  • A Sort dropdown reorders the results (popular / price / name).
 *  • The rail + sort stay stuck below the store header while scrolling.
 *  • Only PAGE_SIZE products render at first; "Show more" reveals the rest.
 *  • onAddToCart receives (product, qty) — quantity chosen on the card.
 *
 * Props:
 *   products    Product[]     — BUSINESS_CONFIG.products
 *   categories  Category[]    — BUSINESS_CONFIG.categories
 *   cart        CartItem[]    — for "in cart" state on each card
 *   onAddToCart (product, qty) => void
 */
export default function ProductGrid({
  products = [], categories = [], cart = [], onAddToCart, onIncrease, onDecrease, onSetQty,
  nounSingular = 'product', nounPlural = 'products',
  searchPlaceholder = 'Search products…', showSearch = true,
}) {
  const [activeCategory, setActiveCategory] = useState('all');
  const [fading, setFading]                 = useState(false);
  const [query, setQuery]                   = useState('');
  const [saleOnly, setSaleOnly]             = useState(false);
  const [sortBy, setSortBy]                 = useState('popular');
  const [visible, setVisible]               = useState(PAGE_SIZE);
  const pendingCategory                     = useRef(null);

  const anyOnSale  = products.some((p) => p._onSale);
  const saleCount  = products.filter((p) => p._onSale).length;

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

  // ── Filtered product list (category + search + sale) ───────────────────
  const byCategory =
    activeCategory === 'all'
      ? products
      : products.filter((p) => p.category === activeCategory);
  const bySale = saleOnly ? byCategory.filter((p) => p._onSale) : byCategory;
  const q = query.trim().toLowerCase();
  const filtered = q
    ? bySale.filter((p) => p.name.toLowerCase().includes(q))
    : bySale;

  // ── Sort (popular keeps the owner's original order) ────────────────────
  const sorted = useMemo(() => {
    const arr = [...filtered];
    if (sortBy === 'price-asc')       arr.sort((a, b) => priceOf(a) - priceOf(b));
    else if (sortBy === 'price-desc') arr.sort((a, b) => priceOf(b) - priceOf(a));
    else if (sortBy === 'name')       arr.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    return arr;
  }, [filtered, sortBy]);

  // Reset the visible window whenever the result set/order changes.
  useEffect(() => { setVisible(PAGE_SIZE); }, [activeCategory, q, saleOnly, sortBy]);

  const shown     = sorted.slice(0, visible);
  const remaining = sorted.length - shown.length;

  // ── Cart qty lookup ────────────────────────────────────────────────────
  function getCartQty(id) {
    // Sum the base product line + any variant lines (id "3" or "3::M").
    const prefix = `${id}::`;
    return cart.reduce((s, i) => (i.id === id || String(i.id).startsWith(prefix) ? s + i.qty : s), 0);
  }

  // Category label for the results line
  const activeCatLabel =
    categories.find((c) => c.id === activeCategory)?.label ?? 'All Products';

  return (
    <section className="w-full min-w-0 overflow-hidden">

      {/* Sticky filter bar — category rail + sort stay reachable while
          scrolling a long catalogue (sticks below the store header at top-14). */}
      <div className="sticky top-14 z-30 pt-2 pb-2.5 mb-3 bg-[#f8fafc] space-y-3">
        {/* Search — hidden when the page's hero search bar already covers it. */}
        {showSearch && (
          <div className="relative w-full">
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
        )}

        {/* Results count + on-sale filter + Sort */}
        <div className="flex items-center gap-2 min-w-0">
          <p className="text-sm text-gray-500 min-w-0 truncate">
            <span
              key={`${activeCategory}-${q}-${sortBy}`}   // re-mount to animate
              className="inline-block animate-in fade-in duration-300"
            >
              <span className="font-bold text-brand-dark tabular-nums">{sorted.length}</span>
              {' '}{sorted.length === 1 ? nounSingular : nounPlural}
              {q
                ? <> matching “{query.trim()}”</>
                : <> in <span className="font-medium text-gray-700">{activeCatLabel}</span></>}
            </span>
          </p>

          {/* On-sale filter — only when a live sale covers some products */}
          {anyOnSale && (
            <button type="button" onClick={() => setSaleOnly((v) => !v)}
              className={[
                'flex-shrink-0 inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1.5 rounded-full border transition-all active:scale-95',
                saleOnly
                  ? 'bg-rose-500 text-white border-transparent shadow-sm'
                  : 'bg-white text-rose-600 border-rose-200 hover:border-rose-300',
              ].join(' ')}>
              🔥 Sale {saleOnly ? '✓' : `· ${saleCount}`}
            </button>
          )}

          {/* Sort dropdown (native for reliable mobile pickers) */}
          <div className="relative flex-shrink-0 ml-auto">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              aria-label="Sort products"
              className="appearance-none pl-3 pr-7 py-1.5 rounded-full border border-gray-200 bg-white
                         text-xs font-bold text-gray-700 focus:outline-none focus:border-brand cursor-pointer">
              {SORTS.map((s) => (
                <option key={s.id} value={s.id}>{s.id === 'popular' ? 'Sort: Popular' : s.label}</option>
              ))}
            </select>
            <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          </div>
        </div>

        {/* Category rail — round tiles are the primary way to browse. */}
        {categories.length > 1 && (
          <CategoryCircles
            categories={categories}
            products={products}
            selected={activeCategory}
            onChange={handleCategoryChange}
          />
        )}
      </div>

      {/* Product grid — fades out briefly on category change */}
      <div
        className={[
          'transition-all duration-150',
          fading ? 'opacity-0 translate-y-1' : 'opacity-100 translate-y-0',
        ].join(' ')}
      >
        {sorted.length === 0 ? (
          <EmptyState
            icon="🔍"
            title={q ? `No ${nounPlural} match “${query.trim()}”` : `No ${nounPlural} in this category`}
            description={q ? 'Try a different search term.' : 'Try a different category or check back later.'}
          />
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4 w-full max-w-full">
              {shown.map((product) => (
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

            {/* Progressive reveal — keeps the initial paint short on big catalogues */}
            {remaining > 0 && (
              <div className="mt-6 flex flex-col items-center gap-2">
                <button
                  onClick={() => setVisible((v) => v + PAGE_SIZE)}
                  className="px-6 py-3 rounded-xl bg-white border border-gray-200 text-sm font-bold text-brand-dark
                             shadow-sm hover:bg-gray-50 active:scale-[0.98] transition-all">
                  Show {Math.min(PAGE_SIZE, remaining)} more
                </button>
                <p className="text-xs text-gray-400">
                  Showing {shown.length} of {sorted.length} {sorted.length === 1 ? nounSingular : nounPlural}
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

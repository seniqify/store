import { useState, useRef } from 'react';
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
export default function ProductGrid({ products = [], categories = [], cart = [], onAddToCart, onIncrease, onDecrease }) {
  const [activeCategory, setActiveCategory] = useState('all');
  const [fading, setFading]                 = useState(false);
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

  // ── Filtered product list ──────────────────────────────────────────────
  const filtered =
    activeCategory === 'all'
      ? products
      : products.filter((p) => p.category === activeCategory);

  // ── Cart qty lookup ────────────────────────────────────────────────────
  function getCartQty(id) {
    return cart.find((i) => i.id === id)?.qty ?? 0;
  }

  // Category label for the heading
  const activeCatLabel =
    categories.find((c) => c.id === activeCategory)?.label ?? 'All Products';

  return (
    <section className="w-full min-w-0 overflow-hidden">

      {/* Section heading */}
      <div className="flex items-start justify-between mb-4 flex-wrap gap-2">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Our Products</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            <span
              key={activeCategory}          // re-mount to animate count
              className="inline-block animate-in fade-in duration-300"
            >
              <span className="font-semibold text-brand-dark">{filtered.length}</span>
              {' '}{filtered.length === 1 ? 'product' : 'products'} in{' '}
              <span className="font-medium text-gray-700">{activeCatLabel}</span>
            </span>
          </p>
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
            title="No products in this category"
            description="Try a different category or check back later."
          />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2 sm:gap-3 w-full max-w-full">
            {filtered.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                cartQty={getCartQty(product.id)}
                onAddToCart={onAddToCart}
                onIncrease={onIncrease}
                onDecrease={onDecrease}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

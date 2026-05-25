import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, ShoppingCart } from 'lucide-react';
import ProductGrid from '../components/product/ProductGrid';
import CartSidebar from '../components/cart/CartSidebar';
import CartSummary from '../components/cart/CartSummary';
import CustomerDetailsForm, { INITIAL_CUSTOMER_DETAILS } from '../components/form/CustomerDetailsForm';
import { useCart } from '../hooks/useCart';
import { useBusinessConfig } from '../contexts/BusinessContext';
import { whatsappLink } from '../utils/theme';
import { calcCartTotals, formatINR } from '../utils/currency';

/**
 * Home — the main storefront page.
 *
 * All business data (products, categories, hero, theme) comes from
 * BusinessContext via useBusinessConfig(). No hardcoded business data here.
 *
 * Layout:
 *   Hero → Trust strip → [ProductGrid + OrderForm] | [Sticky cart] → Footer
 */
export default function Home({ externalCartOpen, onExternalCartClose, onCartCountChange }) {
  const [cartOpen,        setCartOpen]        = useState(false);
  const [customerDetails, setCustomerDetails] = useState(INITIAL_CUSTOMER_DETAILS);

  const {
    cart,
    itemCount,
    addToCart,
    increaseQty,
    decreaseQty,
    removeItem,
  } = useCart();

  // Business config from context — changes when the route changes
  const config = useBusinessConfig();
  const { products, categories, hero, features, businessName, whatsappNumber } = config;

  const waLink      = whatsappLink(whatsappNumber, businessName);
  const { total }   = calcCartTotals(cart, config.cart);

  // ── Sync badge count ──────────────────────────────────────────────────────
  useEffect(() => {
    onCartCountChange?.(itemCount);
  }, [itemCount, onCartCountChange]);

  // ── Header cart button → open sidebar ────────────────────────────────────
  useEffect(() => {
    if (externalCartOpen) {
      setCartOpen(true);
      onExternalCartClose?.();
    }
  }, [externalCartOpen, onExternalCartClose]);

  // ── "Place Order" → close sidebar + scroll to form ───────────────────────
  function handleCheckout() {
    setCartOpen(false);
    setTimeout(() => {
      document
        .getElementById('order-form')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 300);
  }

  return (
    <div className={['min-h-screen bg-[#f8fafc] w-full overflow-x-hidden', itemCount > 0 ? 'pb-20 lg:pb-0' : ''].join(' ')}>

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <div className="bg-gradient-to-br from-brand-dark via-brand to-brand/80 text-white w-full">
        <div className="w-full max-w-7xl mx-auto px-4 py-8 sm:py-12 text-center">

          <p className="text-white/70 text-[10px] sm:text-[11px] font-semibold tracking-widest
                        uppercase mb-2.5 truncate">
            {hero.eyebrow}
          </p>

          <h1 className="text-xl sm:text-4xl md:text-5xl font-extrabold leading-tight
                          mb-3 break-words tracking-tight">
            {hero.heading}
          </h1>

          <p className="text-white/80 text-sm sm:text-base max-w-lg mx-auto mb-6 px-2">
            {hero.subtext}
          </p>

          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              onClick={() =>
                document.getElementById('products')?.scrollIntoView({ behavior: 'smooth' })
              }
              className="inline-flex items-center gap-2
                         bg-white text-brand-dark font-bold text-sm
                         px-5 py-2.5 rounded-full shadow-lg hover:shadow-xl
                         hover:bg-brand/5 transition-all duration-200 active:scale-95"
            >
              {hero.cta}
              <ChevronDown size={16} />
            </button>

            <a
              href={waLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2
                         bg-[#25D366] hover:bg-[#1ebe5d] text-white font-bold text-sm
                         px-5 py-2.5 rounded-full shadow-lg
                         transition-all duration-200 active:scale-95"
            >
              💬 WhatsApp Order
            </a>
          </div>
        </div>
      </div>

      {/* ── Trust strip ───────────────────────────────────────────────────── */}
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex items-center gap-5 sm:gap-8 overflow-x-auto scrollbar-hide py-3">
            {features.map((f) => (
              <div key={f.title} className="flex items-center gap-2.5 flex-shrink-0">
                <span className="text-lg leading-none">{f.emoji}</span>
                <div>
                  <p className="text-xs font-semibold text-gray-800 whitespace-nowrap">{f.title}</p>
                  <p className="text-[11px] text-gray-400 whitespace-nowrap hidden sm:block">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Main content ──────────────────────────────────────────────────── */}
      <div id="products" className="w-full max-w-7xl mx-auto px-3 sm:px-4 py-4 sm:py-8 overflow-x-hidden">
        <div className="flex flex-col lg:flex-row gap-6 xl:gap-8 items-start">

          {/* ── Left: Products + Order form ─────────────────────────────── */}
          <div className="flex-1 min-w-0 space-y-8">

            <ProductGrid
              products={products}
              categories={categories}
              cart={cart}
              onAddToCart={addToCart}
              onIncrease={increaseQty}
              onDecrease={decreaseQty}
            />

            {/* Section divider */}
            <div className="flex items-center gap-4">
              <div className="h-px flex-1 bg-gray-200" />
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-widest flex-shrink-0">
                Place Your Order
              </span>
              <div className="h-px flex-1 bg-gray-200" />
            </div>

            <CustomerDetailsForm
              formData={customerDetails}
              onChange={setCustomerDetails}
              cart={cart}
            />
          </div>

          {/* ── Right: Sticky cart (desktop only) ───────────────────────── */}
          <aside className="hidden lg:block w-72 xl:w-80 flex-shrink-0">
            <div className="sticky top-24">
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">

                {/* Cart header */}
                <div className="flex items-center justify-between px-4 py-3.5 border-b border-gray-100">
                  <div className="flex items-center gap-2">
                    <ShoppingCart size={15} className="text-brand" />
                    <span className="font-bold text-gray-900 text-sm">Your Cart</span>
                  </div>
                  {itemCount > 0 && (
                    <span className="text-xs bg-brand/10 text-brand-dark font-semibold px-2 py-0.5 rounded-full">
                      {itemCount} {itemCount === 1 ? 'item' : 'items'}
                    </span>
                  )}
                </div>

                {/* Empty state */}
                {itemCount === 0 && (
                  <div className="px-4 py-8 text-center">
                    <p className="text-2xl mb-2">🛒</p>
                    <p className="text-sm font-semibold text-gray-700 mb-1">Cart is empty</p>
                    <p className="text-xs text-gray-400">Add products to get started</p>
                  </div>
                )}

                {/* Items + summary */}
                {itemCount > 0 && (
                  <>
                    <div className="overflow-y-auto max-h-60 px-4 py-3 space-y-3">
                      {cart.map((item) => (
                        <div key={item.id} className="flex items-start gap-2.5">
                          <img
                            src={item.image}
                            alt={item.name}
                            className="w-10 h-10 rounded-lg object-cover bg-gray-100 flex-shrink-0"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold text-gray-800 truncate leading-tight">
                              {item.name}
                            </p>
                            {item.size && (
                              <p className="text-[11px] text-gray-400 truncate">{item.size}</p>
                            )}
                            <p className="text-[11px] text-gray-500 mt-0.5 tabular-nums">
                              {formatINR(item.price)} × {item.qty}
                            </p>
                          </div>
                          <p className="text-xs font-bold text-brand-dark tabular-nums flex-shrink-0 pt-0.5">
                            {formatINR(item.price * item.qty)}
                          </p>
                        </div>
                      ))}
                    </div>

                    <div className="border-t border-gray-100 px-4 pb-4 pt-3">
                      <CartSummary
                        cart={cart}
                        compact
                        onCheckout={handleCheckout}
                        ctaLabel="Place Order"
                      />
                    </div>
                  </>
                )}
              </div>
            </div>
          </aside>
        </div>
      </div>

      {/* ── Cart Sidebar ─────────────────────────────────────────────────── */}
      <CartSidebar
        cart={cart}
        isOpen={cartOpen}
        onClose={() => setCartOpen(false)}
        onIncrease={increaseQty}
        onDecrease={decreaseQty}
        onRemove={removeItem}
        onCheckout={handleCheckout}
      />

      {/* ── Mobile bottom bar ��───────────────────────────────────────────── */}
      {itemCount > 0 && (
        <div
          className="lg:hidden fixed bottom-0 left-0 right-0 z-40
                     bg-white border-t border-gray-200
                     shadow-[0_-4px_20px_rgba(0,0,0,0.08)]
                     pb-[env(safe-area-inset-bottom)]"
        >
          <div className="px-4 py-3">
            <button
              onClick={() => setCartOpen(true)}
              className="w-full flex items-center justify-between
                         bg-brand hover:bg-brand-dark active:bg-brand-dark
                         text-white font-semibold rounded-xl
                         px-4 py-3 transition-all duration-150 active:scale-[0.99]"
            >
              <div className="flex items-center gap-2.5">
                <span className="bg-white/20 text-white text-xs font-bold
                                 w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0">
                  {itemCount}
                </span>
                <span className="text-sm">
                  {itemCount === 1 ? '1 item' : `${itemCount} items`}
                  <span className="opacity-75 ml-1 font-normal">· View Cart</span>
                </span>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <span className="font-bold tabular-nums">{formatINR(total)}</span>
                <ChevronRight size={16} className="opacity-80" />
              </div>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

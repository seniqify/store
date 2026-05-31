import { useEffect, useState, useRef } from 'react';
import { ChevronRight, ShoppingCart } from 'lucide-react';
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
  const { products, categories, features, businessName, tagline, whatsappNumber, promoText, theme, logo, logoEmoji, coverImage } = config;

  // Parse promo text for the offer ribbon
  const promoEmoji = promoText
    ? (promoText.match(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}]+/u)?.[0] ?? null)
    : null;
  const promoWithoutEmoji = promoText
    ? promoText.replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}]+\s*/u, '').trim()
    : '';
  const promoParts   = promoWithoutEmoji.split(/\s*[·•\-–]\s*/);
  const promoHeading = promoParts[0] ?? '';
  const promoSubtext = promoParts[1] ?? null;

  const waLink      = whatsappLink(whatsappNumber, businessName);
  const { total }   = calcCartTotals(cart, config.cart);

  // ── SEO: update document title + meta tags for this store ────────────────
  const prevTitle = useRef(document.title);
  useEffect(() => {
    const title = `${businessName} — Order via WhatsApp`;
    document.title = title;

    const setMeta = (name, content, prop = false) => {
      const sel = prop ? `meta[property="${name}"]` : `meta[name="${name}"]`;
      let el = document.querySelector(sel);
      if (!el) {
        el = document.createElement('meta');
        prop ? el.setAttribute('property', name) : el.setAttribute('name', name);
        document.head.appendChild(el);
      }
      el.setAttribute('content', content);
    };

    const desc = `Browse ${businessName}'s products and place orders instantly via WhatsApp. ${products.length} products available.`;
    setMeta('description', desc);
    setMeta('og:title',       title,        true);
    setMeta('og:description', desc,         true);
    setMeta('og:type',        'website',    true);
    setMeta('twitter:card',   'summary');
    setMeta('twitter:title',  title);

    return () => {
      document.title = prevTitle.current;
    };
  }, [businessName, products.length]);

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

      {/* ── Hero: cover image OR simple store header ────────────────────── */}
      {coverImage ? (
        <div className="relative w-full h-44 sm:h-60 overflow-hidden flex-shrink-0">
          <img src={coverImage} alt={businessName}
            className="w-full h-full object-cover" />
          <div className="absolute inset-0"
               style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.65) 0%, rgba(0,0,0,0.15) 50%, transparent 100%)' }} />
          <div className="absolute bottom-0 left-0 right-0 px-4 pb-4">
            <div className="flex items-center gap-3 max-w-7xl mx-auto">
              {logo ? (
                <img src={logo} alt={businessName}
                  className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl object-cover border-2 border-white shadow-lg flex-shrink-0" />
              ) : (
                <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl flex items-center justify-center
                                text-2xl border-2 border-white shadow-lg flex-shrink-0"
                     style={{ backgroundColor: theme?.primary ?? '#0d9488' }}>
                  {logoEmoji ?? '🏪'}
                </div>
              )}
              <div className="min-w-0">
                <h1 className="text-lg sm:text-xl font-extrabold text-white leading-tight truncate">{businessName}</h1>
                {tagline && <p className="text-xs text-white/75 mt-0.5 truncate">{tagline}</p>}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="w-full px-3 sm:px-4 pt-4 pb-1">
          <div className="max-w-7xl mx-auto flex items-center gap-3">
            {logo ? (
              <img src={logo} alt={businessName}
                className="w-12 h-12 rounded-2xl object-cover border border-gray-100 shadow-sm flex-shrink-0" />
            ) : (
              <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl flex-shrink-0"
                   style={{ backgroundColor: `${theme?.primary ?? '#0d9488'}18` }}>
                {logoEmoji ?? '🏪'}
              </div>
            )}
            <div className="min-w-0">
              <h1 className="font-extrabold text-gray-900 text-base sm:text-lg leading-tight truncate">{businessName}</h1>
              {tagline && <p className="text-xs text-gray-400 mt-0.5 truncate">{tagline}</p>}
            </div>
          </div>
        </div>
      )}

      {/* ── Offer ribbon ─────────────────────────────────────────────────── */}
      {promoText && (
        <div className="w-full px-3 sm:px-4 pt-2 pb-0">
          <div className="max-w-7xl mx-auto rounded-2xl overflow-hidden"
               style={{ backgroundColor: `${theme?.primary ?? '#0d9488'}12`, border: `1px solid ${theme?.primary ?? '#0d9488'}25` }}>
            <div className="flex items-center gap-3 px-4 py-3">
              <span className="text-xl flex-shrink-0">{promoEmoji ?? '🎉'}</span>
              <div className="min-w-0 flex-1">
                <p className="font-bold text-sm text-gray-900 leading-tight">{promoHeading}</p>
                {promoSubtext && <p className="text-xs text-gray-500 mt-0.5 leading-snug">{promoSubtext}</p>}
              </div>
              <button
                onClick={() => document.getElementById('products')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                className="flex-shrink-0 text-xs font-bold text-white px-3 py-1.5 rounded-lg transition-all active:scale-95"
                style={{ backgroundColor: theme?.primary ?? '#0d9488' }}>
                Shop →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Trust strip ───────────────────────────────────────────────────── */}
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex items-center gap-5 sm:gap-8 overflow-x-auto scrollbar-hide py-2.5">
            {(features || []).map((f) => (
              <div key={f.title} className="flex items-center gap-2 flex-shrink-0">
                <span className="text-base leading-none">{f.emoji}</span>
                <p className="text-xs font-semibold text-gray-700 whitespace-nowrap">{f.title}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Main content ──────────────────────────────────────────────────── */}
      <div id="products" className="w-full max-w-7xl mx-auto px-3 sm:px-4 py-4 sm:py-8 overflow-hidden">
        <div className="flex flex-col lg:flex-row gap-6 xl:gap-8 items-start w-full">

          {/* ── Left: Products + Order form ─────────────────────────────── */}
          <div className="w-full lg:flex-1 min-w-0 overflow-hidden space-y-6">

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

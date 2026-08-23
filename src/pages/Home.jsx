import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ShoppingCart, MessageCircle, Check, Star, Share2, ChevronDown, ArrowLeft, X, Search } from 'lucide-react';
import ProductGrid from '../components/product/ProductGrid';
import ProductDetail from '../components/product/ProductDetail';
import CategoryCircles from '../components/product/CategoryCircles';
import { useScrollLock } from '../hooks/useScrollLock';
import CartSidebar from '../components/cart/CartSidebar';
import CheckoutSheet from '../components/cart/CheckoutSheet';
import CartSummary from '../components/cart/CartSummary';
import CustomerDetailsForm, { INITIAL_CUSTOMER_DETAILS } from '../components/form/CustomerDetailsForm';
import StoreTabBar from '../components/layout/StoreTabBar';
import StoreSearchBar from '../components/store/StoreSearchBar';
import HeroBanner from '../components/store/HeroBanner';
import StoreSaleBanner from '../components/store/StoreSaleBanner';
import { useCart } from '../hooks/useCart';
import { useBusinessConfig } from '../contexts/BusinessContext';
import { whatsappLink } from '../utils/theme';
import { calcCartTotals, formatINR, discountPercent } from '../utils/currency';
import { isVerified, effectivePlan, hasFeature } from '../utils/planLimits';
import { fetchReviews, reviewStats } from '../utils/reviewService';
import { applyOffersToProducts, isOfferLive } from '../utils/offers';
import { initMetaPixel, pixelTrack } from '../utils/metaPixel';

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
  const [checkoutOpen,    setCheckoutOpen]    = useState(false);
  const [askOpen,         setAskOpen]         = useState(false);   // mobile search/AI overlay
  const [catsOpen,        setCatsOpen]        = useState(false);   // mobile category picker
  const [activeCategory,  setActiveCategory]  = useState('all');   // lifted so the Categories tab can drive it
  const [customerDetails, setCustomerDetails] = useState(INITIAL_CUSTOMER_DETAILS);
  useScrollLock(askOpen);
  useScrollLock(catsOpen);

  const {
    cart,
    itemCount,
    addToCart,
    increaseQty,
    decreaseQty,
    setQty,
    removeItem,
    clearCart,
  } = useCart();

  // Business config from context — changes when the route changes
  const config = useBusinessConfig();
  const { products, categories, features, businessName, tagline, whatsappNumber, promoText, theme, logo, logoEmoji, coverImage } = config;

  // Product page: /{slug}/p/{id} keeps this same store page mounted (so the cart
  // survives) and opens the product as a full-screen view over the grid.
  const { productId } = useParams();
  const navigate = useNavigate();

  const primary     = theme?.primary ?? '#0d9488';
  const primaryDark = theme?.primaryDark ?? '#0f766e';
  const freeAbove   = config.cart?.freeShippingAbove ?? 0;

  // Food stores read better with menu vocabulary ("Browse menu", "7 dishes").
  const isRestaurant = config.businessType === 'restaurant';
  const catalogWord  = isRestaurant ? 'menu'   : 'products';
  const itemsWord    = isRestaurant ? 'dishes' : 'products';
  const itemsEmoji   = isRestaurant ? '🍽️'    : '🛍️';

  // Scheduled sales (Premium): bake live sale prices into the products customers
  // see + add to cart, and surface a live sale banner with countdown.
  const offers       = config.offers || [];
  const liveOffers   = offers.filter((o) => isOfferLive(o));
  const saleProducts = applyOffersToProducts(products, offers);

  // The product to show full-screen (sale price applied), or null for the grid.
  const detailProduct = productId ? saleProducts.find((p) => String(p.id) === String(productId)) : null;

  // AI "Ask" / product search — kept inline on desktop, but on mobile it opens
  // from the bottom-nav "Ask" tab so the hero space goes back to the products.
  const aiAskEnabled = Boolean(config.slug) && hasFeature(effectivePlan(config), 'aiEmployee');
  const searchable   = products.length > 0 || aiAskEnabled;

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

  const waLink      = whatsappLink(whatsappNumber, businessName, config.waMessage);
  const { total }   = calcCartTotals(cart, config.cart);

  // Slim trust ribbon — the store's own signals, as small pills.
  const trustPills = [
    isVerified(effectivePlan(config)) ? '✓ Verified shop' : null,
    ...(features || []).slice(0, 2).map((f) => `${f.emoji || '•'} ${f.title}`),
    config.delivery?.mode !== 'pickup' ? '💵 COD available' : null,
  ].filter(Boolean);

  // "Most loved" bestseller rail — owner's product order = popularity.
  const mostLoved = saleProducts.slice(0, 8);

  // Primary hero action: send shoppers into the catalog (browse → cart → checkout,
  // a recorded order) instead of straight to a WhatsApp chat that leaves no order.
  const scrollToProducts = () =>
    document.getElementById('products')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Pick a category from the mobile Categories sheet → filter, close, jump to grid.
  const selectCategory = (id) => { setActiveCategory(id); setCatsOpen(false); scrollToProducts(); };

  // ── Hero social proof: approved-review aggregate → ★ pill next to the name ──
  const [heroRating, setHeroRating] = useState(null);
  useEffect(() => {
    if (!config.slug) return;
    let alive = true;
    fetchReviews(config.slug).then((r) => { if (alive) setHeroRating(reviewStats(r)); });
    return () => { alive = false; };
  }, [config.slug]);

  // Share the store like a profile — native share sheet where available,
  // clipboard fallback on desktop.
  const [shareCopied, setShareCopied] = useState(false);
  async function shareStore() {
    const url = window.location.href.split('?')[0];
    if (navigator.share) {
      try { await navigator.share({ title: businessName, text: `Order from ${businessName} on WhatsApp`, url }); } catch { /* dismissed */ }
    } else {
      navigator.clipboard?.writeText(url);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    }
  }

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

    const desc = `Browse ${businessName}'s ${itemsWord} and place orders instantly via WhatsApp. ${products.length} ${itemsWord} available.`;
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

  // Load the store's Meta Pixel (paid plans) so their Facebook/Instagram ads can
  // track conversions. No-op when the owner hasn't set one.
  useEffect(() => {
    if (config?.metaPixelId && hasFeature(effectivePlan(config), 'metaPixel')) {
      initMetaPixel(config.metaPixelId);
    }
  }, [config?.metaPixelId, config?.plan]);

  // Add to cart + report it to the store's Meta Pixel (no-op without a pixel).
  function handleAddToCart(item, qty = 1) {
    addToCart(item, qty);
    pixelTrack('AddToCart', {
      content_name: item?.name,
      content_ids:  item?.id != null ? [String(item.id)] : undefined,
      content_type: 'product',
      value:        (Number(item?.price) || 0) * (qty || 1),
      currency:     'INR',
    });
  }

  // ── "Place Order" → close cart, open the checkout sheet ──────────────────
  function handleCheckout() {
    pixelTrack('InitiateCheckout', { value: total, currency: 'INR', num_items: itemCount });
    setCartOpen(false);
    setCheckoutOpen(true);
  }

  return (
    <div className={['min-h-screen bg-[#f8fafc] w-full overflow-x-hidden lg:pb-0', itemCount > 0 ? 'pb-32' : 'pb-16'].join(' ')}>

      {/* ── Store hero: cover image OR branded gradient + personal-brand card ── */}
      <header className="relative w-full">
        <div className="relative w-full h-40 sm:h-52 overflow-hidden">
          {coverImage ? (
            <img src={coverImage} alt={businessName} className="w-full h-full object-cover" />
          ) : (
            <HeroBanner style={config.theme?.banner} primary={primary} primaryDark={primaryDark} />
          )}
          {/* darken the bottom so the overlay text stays legible on any cover */}
          <div className="absolute inset-0"
               style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.68) 0%, rgba(0,0,0,0.04) 60%)' }} />
          {/* Share — floats on the banner like a profile action */}
          <button type="button" onClick={shareStore} aria-label="Share this store"
            className="absolute top-3 right-3 z-10 w-9 h-9 rounded-full bg-white/90 backdrop-blur
                       border border-white/60 text-gray-600 flex items-center justify-center shadow-md active:scale-95">
            {shareCopied ? <Check size={15} className="text-emerald-600" /> : <Share2 size={15} />}
          </button>
          {/* Overlay: live-offer ribbon + one-line tagline (identity lives in the sticky header) */}
          <div className="absolute inset-x-0 bottom-0 max-w-7xl mx-auto px-4 sm:px-6 pb-3.5 sm:pb-5">
            {promoHeading && (
              <span className="inline-block text-[11px] font-extrabold text-gray-900 bg-white/95 px-2.5 py-1 rounded-full mb-2 shadow-sm">
                {promoEmoji ?? '🎉'} {promoHeading}
              </span>
            )}
            {(tagline || config.category) && (
              <p className="text-white font-bold text-[15px] sm:text-xl leading-snug max-w-[24rem] drop-shadow-md line-clamp-2"
                 style={{ fontFamily: "'Poppins', system-ui, sans-serif" }}>
                {tagline || `${config.category}${config.city ? ` · ${config.city}` : ''}`}
              </p>
            )}
          </div>
        </div>

      </header>

      {/* ── Shop controls: search + category pills + trust ribbon, right under
             the cover so products are one tap away. ─────────────────────────── */}
      <div className="max-w-7xl mx-auto px-3 sm:px-4 mt-3.5 space-y-3">
        {/* Search — mobile opens the Ask/search overlay; desktop uses the inline
            StoreSearchBar rendered just below. */}
        {searchable && (
          <button type="button" onClick={() => setAskOpen(true)}
            className="lg:hidden w-full flex items-center gap-2.5 bg-white border border-gray-200 rounded-2xl px-4 py-3
                       text-sm text-gray-400 shadow-sm active:scale-[0.99] transition">
            <Search size={17} className="text-gray-400 flex-shrink-0" />
            {aiAskEnabled ? `Ask anything, or search ${itemsWord}…` : `Search ${itemsWord}…`}
          </button>
        )}

        {/* Category pills */}
        {categories.length > 1 && (
          <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-3 px-3 pb-0.5">
            {categories.map((c) => {
              const on = activeCategory === c.id;
              return (
                <button key={c.id} type="button" onClick={() => selectCategory(c.id)}
                  className={[
                    'flex-shrink-0 inline-flex items-center gap-1.5 text-xs font-bold px-3.5 py-2 rounded-full border transition active:scale-95',
                    on ? 'bg-brand text-white border-brand shadow-sm' : 'bg-white text-gray-700 border-gray-200 hover:border-gray-300',
                  ].join(' ')}>
                  {c.id !== 'all' && c.emoji ? <span className="text-sm leading-none">{c.emoji}</span> : null}
                  {c.id === 'all' ? 'All' : c.label}
                </button>
              );
            })}
          </div>
        )}

        {/* Trust ribbon — slim pills of the store's own signals */}
        {trustPills.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {trustPills.map((t) => (
              <span key={t} className="inline-flex items-center text-[11px] font-semibold text-gray-500
                                       bg-gray-50 border border-gray-100 rounded-full px-2.5 py-1 whitespace-nowrap">
                {t}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Scroll hint (desktop) — a gently bouncing cue that the catalog is below */}
      {products.length > 0 && (
        <div className="hidden lg:flex justify-center mt-1">
          <button type="button" onClick={scrollToProducts} aria-label="Scroll down to products"
            className="flex flex-col items-center gap-0.5 text-gray-400 hover:text-gray-600 transition-colors">
            <span className="text-[10.5px] font-bold uppercase tracking-wider">Scroll to shop</span>
            <ChevronDown size={18} className="motion-safe:animate-bounce" style={{ color: primary }} />
          </button>
        </div>
      )}

      {/* Search / AI ask — inline on desktop; on mobile it opens from the Ask tab
          (below), so the hero space goes back to the products. */}
      {searchable && (
        <div className="hidden lg:block">
          <StoreSearchBar
            products={saleProducts}
            primary={primary}
            onAddToCart={handleAddToCart}
            slug={config.slug}
            businessName={businessName}
            waLink={waLink}
            aiEnabled={aiAskEnabled}
            referrals={config.localReferrals !== false}
          />
        </div>
      )}

      {/* ── Sale banner (live scheduled sale) → else static promo ribbon ───── */}
      {liveOffers.length > 0 ? (
        <StoreSaleBanner offers={liveOffers} primary={primary} primaryDark={primaryDark} />
      ) : promoText ? (
        <div className="w-full px-3 sm:px-4 mt-4">
          <div className="max-w-7xl mx-auto relative overflow-hidden rounded-2xl shadow-sm"
               style={{ background: `linear-gradient(135deg, ${primary}, ${primaryDark})` }}>
            <div className="absolute inset-0"
                 style={{ opacity: 0.18, backgroundImage: 'radial-gradient(#fff 1px, transparent 1px)', backgroundSize: '14px 14px' }} />
            <div className="relative flex items-center gap-3 px-4 py-3">
              <span className="text-2xl flex-shrink-0 drop-shadow-sm">{promoEmoji ?? '🎉'}</span>
              <div className="min-w-0 flex-1">
                <p className="font-bold text-sm text-white leading-tight">{promoHeading}</p>
                {promoSubtext && <p className="text-xs text-white/80 mt-0.5 leading-snug">{promoSubtext}</p>}
              </div>
              <button
                onClick={() => document.getElementById('products')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                className="flex-shrink-0 text-xs font-bold px-3.5 py-2 rounded-lg bg-white transition-all active:scale-95 shadow-sm"
                style={{ color: primaryDark }}>
                Shop now →
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Feature badges now live under the store name in the hero (see above). */}

      {/* ── Main content ──────────────────────────────────────────────────── */}
      <div id="products" className="w-full max-w-7xl mx-auto px-3 sm:px-4 py-4 sm:py-8 overflow-hidden">
        <div className="flex flex-col lg:flex-row gap-6 xl:gap-8 items-start w-full">

          {/* ── Left: Products + Order form ─────────────────────────────── */}
          <div className="w-full lg:flex-1 min-w-0 overflow-hidden space-y-6">

            {/* ── "Most loved" bestseller rail — instant social proof + a fast
                   path to popular items, above the full grid. ────────────────── */}
            {mostLoved.length > 3 && activeCategory === 'all' && (
              <section>
                <h2 className="text-base font-extrabold text-gray-900 flex items-center gap-1.5 mb-2.5">
                  ⭐ Most loved
                </h2>
                <div className="flex gap-3 overflow-x-auto scrollbar-hide -mx-3 px-3 pb-1">
                  {mostLoved.map((p) => {
                    const img    = p.image || (Array.isArray(p.images) ? p.images[0] : null);
                    const hasMrp = Number(p.mrp) > Number(p.price);
                    return (
                      <div key={p.id} className="flex-shrink-0 w-[146px] bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-sm">
                        <button type="button" onClick={() => navigate(`/${config.slug}/p/${p.id}`)} className="block w-full text-left">
                          <div className="h-28 bg-gray-50 relative">
                            {img
                              ? <img src={img} alt={p.name} loading="lazy" className="w-full h-full object-cover" />
                              : <div className="w-full h-full flex items-center justify-center text-2xl">{itemsEmoji}</div>}
                            {hasMrp && (
                              <span className="absolute top-1.5 left-1.5 text-[9px] font-extrabold text-white bg-brand px-1.5 py-0.5 rounded">
                                {discountPercent(p.price, p.mrp)}% OFF
                              </span>
                            )}
                          </div>
                          <div className="px-2.5 pt-2">
                            <p className="text-xs font-semibold text-gray-800 leading-tight line-clamp-2 h-8">{p.name}</p>
                            <div className="flex items-baseline gap-1.5 mt-1">
                              <span className="text-sm font-extrabold text-gray-900 tabular-nums">{formatINR(p.price)}</span>
                              {hasMrp && <span className="text-[10px] text-gray-400 line-through tabular-nums">{formatINR(p.mrp)}</span>}
                            </div>
                          </div>
                        </button>
                        <div className="px-2.5 pb-2.5">
                          <button type="button" onClick={() => handleAddToCart(p)}
                            className="mt-2 w-full py-1.5 rounded-lg border border-brand text-brand bg-brand/5
                                       text-[11px] font-extrabold active:scale-95 transition hover:bg-brand/10">
                            ＋ Add
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Shop all heading */}
            {products.length > 0 && (
              <h2 className="text-base font-extrabold text-gray-900 -mb-2">
                Shop all <span className="text-gray-400 font-bold">· {products.length} {itemsWord}</span>
              </h2>
            )}

            <ProductGrid
              products={saleProducts}
              categories={categories}
              cart={cart}
              onAddToCart={handleAddToCart}
              onIncrease={increaseQty}
              onDecrease={decreaseQty}
              onSetQty={setQty}
              onOpenDetail={(id) => navigate(`/${config.slug}/p/${id}`)}
              activeCategory={activeCategory}
              onCategoryChange={setActiveCategory}
              categoryRailClassName="hidden"   /* category nav now lives in the pills above */
              showSearch={false}   /* the hero StoreSearchBar above already searches */
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
                            {(item.variant || item.size) && (
                              <p className="text-[11px] text-gray-400 truncate">{item.variant || item.size}</p>
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

      {/* ── Mobile Ask / search overlay — opened from the bottom-nav Ask tab ── */}
      {searchable && askOpen && (
        <div className="lg:hidden fixed inset-0 z-[70] bg-[#f8fafc] flex flex-col">
          <div className="flex items-center gap-2 px-3 py-3 bg-white border-b border-gray-100 flex-shrink-0">
            <button type="button" onClick={() => setAskOpen(false)} aria-label="Close"
              className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 transition-colors">
              <ArrowLeft size={20} />
            </button>
            <span className="text-sm font-bold text-gray-800">
              {aiAskEnabled ? 'Ask anything' : `Search ${itemsWord}`}
            </span>
          </div>
          <div className="flex-1 overflow-y-auto pb-10">
            <StoreSearchBar
              products={saleProducts}
              primary={primary}
              onAddToCart={handleAddToCart}
              slug={config.slug}
              businessName={businessName}
              waLink={waLink}
              aiEnabled={aiAskEnabled}
              referrals={config.localReferrals !== false}
            />
          </div>
        </div>
      )}

      {/* ── Mobile Categories sheet — opened from the bottom-nav Categories tab ── */}
      {catsOpen && categories.length > 1 && (
        <div className="lg:hidden fixed inset-0 z-[70] flex flex-col justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => setCatsOpen(false)} />
          <div className="relative bg-white rounded-t-3xl max-h-[80vh] overflow-y-auto shadow-2xl pb-8 animate-in fade-in duration-200">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 sticky top-0 bg-white z-10">
              <p className="text-base font-extrabold text-gray-900">Shop by category</p>
              <button type="button" onClick={() => setCatsOpen(false)} aria-label="Close"
                className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 transition-colors">
                <X size={20} />
              </button>
            </div>
            <div className="px-4 pt-2">
              <CategoryCircles categories={categories} products={saleProducts} selected={activeCategory} onChange={selectCategory} wrap />
            </div>
          </div>
        </div>
      )}

      {/* ── Product page (full-screen, shares this store's cart) ─────────────
          Driven by /{slug}/p/{id}; renders over the grid so the cart persists. */}
      {detailProduct && (
        <ProductDetail
          product={detailProduct}
          rating={heroRating}
          itemCount={itemCount}
          onClose={() => navigate(`/${config.slug}`)}
          onAddToCart={handleAddToCart}
          onViewCart={() => { navigate(`/${config.slug}`); setCartOpen(true); }}
        />
      )}

      {/* ── Cart Sidebar ─────────────────────────────────────────────────── */}
      <CartSidebar
        cart={cart}
        isOpen={cartOpen}
        onClose={() => setCartOpen(false)}
        onIncrease={increaseQty}
        onDecrease={decreaseQty}
        onRemove={removeItem}
        onSetQty={setQty}
        onCheckout={handleCheckout}
      />

      {/* ── Checkout Sheet (order form) ──────────────────────────────────── */}
      <CheckoutSheet
        open={checkoutOpen}
        onClose={() => setCheckoutOpen(false)}
        onBack={() => { setCheckoutOpen(false); setCartOpen(true); }}
      >
        <CustomerDetailsForm formData={customerDetails} onChange={setCustomerDetails} cart={cart} onOrderPlaced={clearCart} />
      </CheckoutSheet>

      {/* ── Mobile bottom bar ───────────────────────────────────────────── */}
      <StoreTabBar
        itemCount={itemCount}
        cartTotal={total}
        onCartClick={() => setCartOpen(true)}
        onAskClick={searchable ? () => setAskOpen(true) : undefined}
        askLabel={aiAskEnabled ? 'Ask' : 'Search'}
        onCategoriesClick={categories.length > 1 ? () => setCatsOpen(true) : undefined}
        categoriesTarget="products"
      />
    </div>
  );
}

// Small rounded trust chip used in the store hero — tinted with the store's
// brand colour (bg-brand/* reads the per-store theme CSS vars).
function Chip({ children }) {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-gray-600
                     bg-brand/5 border border-brand/15 rounded-full px-2.5 py-1 whitespace-nowrap">
      {children}
    </span>
  );
}

import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ShoppingCart, MessageCircle, Check, Star, Share2, ChevronDown, ArrowLeft, X } from 'lucide-react';
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
import { calcCartTotals, formatINR } from '../utils/currency';
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
        <div className="relative w-full h-44 sm:h-56 overflow-hidden">
          {coverImage ? (
            <img src={coverImage} alt={businessName} className="w-full h-full object-cover" />
          ) : (
            <HeroBanner style={config.theme?.banner} primary={primary} primaryDark={primaryDark} />
          )}
          {coverImage && (
            <div className="absolute inset-0"
                 style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.5) 0%, transparent 55%)' }} />
          )}
          {/* Share (mobile) — floats on the banner like a profile action */}
          <button type="button" onClick={shareStore} aria-label="Share this store"
            className="sm:hidden absolute top-3 right-3 z-10 w-9 h-9 rounded-full bg-white/90 backdrop-blur
                       border border-white/60 text-gray-600 flex items-center justify-center shadow-md active:scale-95">
            {shareCopied ? <Check size={15} className="text-emerald-600" /> : <Share2 size={15} />}
          </button>
        </div>

        {/* soft brand glow bleeding out from under the card */}
        <div className="absolute left-1/2 -translate-x-1/2 top-28 sm:top-44 w-[34rem] max-w-full h-44 rounded-full blur-3xl pointer-events-none"
             style={{ background: `${primary}1c` }} />

        <div className="max-w-7xl mx-auto px-3 sm:px-4">
          {/* Personal-brand card: gradient hairline border (brand → white) around
              a glass body with a soft brand wash. The colour is the store's own
              theme colour, chosen by the owner in Manage → Settings. */}
          <div className="relative z-10 -mt-14 sm:-mt-20 rounded-3xl p-[1.5px] animate-pl-fade-up"
               style={{
                 background: `linear-gradient(140deg, ${primary}45, ${primary}10 45%, rgba(255,255,255,0.9))`,
                 boxShadow: `0 24px 48px -20px ${primary}38, 0 12px 32px rgba(15,23,42,0.08)`,
               }}>
            {/* Matte body: fully opaque white with a whisper of brand tint baked
                into the top — no translucency, no blur */}
            <div className="relative rounded-[22px] p-4 sm:p-6"
                 style={{ background: `linear-gradient(180deg, ${primary}0a 0%, rgba(255,255,255,0) 45%), #ffffff` }}>

              {/* Brand dot texture fading down the card's top wash (same dotted
                  idiom as the promo ribbon) — pure decoration, kept whisper-quiet */}
              <div aria-hidden className="absolute inset-x-0 top-0 h-24 rounded-t-[22px] pointer-events-none"
                   style={{
                     backgroundImage: `radial-gradient(${primary}21 1px, transparent 1px)`,
                     backgroundSize: '12px 12px',
                     maskImage: 'linear-gradient(to bottom, rgba(0,0,0,0.55), transparent)',
                     WebkitMaskImage: 'linear-gradient(to bottom, rgba(0,0,0,0.55), transparent)',
                   }} />

              {/* Mobile: centered profile composition · Desktop: left-aligned row */}
              <div className="relative flex flex-col items-center text-center
                              sm:flex-row sm:items-start sm:text-left gap-3 sm:gap-5">

                {/* Logo — brand gradient ring + white gap (story-ring style) so
                    it pops on any card, even white-background logos */}
                <div className="flex-shrink-0 -mt-14 sm:-mt-16 rounded-2xl p-[3px]"
                     style={{
                       background: `linear-gradient(135deg, ${primary}, ${primaryDark})`,
                       boxShadow: `0 14px 30px -8px ${primary}59`,
                     }}>
                  <div className="rounded-[13px] bg-white p-[3px]">
                    {logo ? (
                      <img src={logo} alt={businessName}
                           className="w-20 h-20 rounded-[10px] object-cover bg-white" />
                    ) : (
                      <div className="w-20 h-20 rounded-[10px] flex items-center justify-center text-4xl"
                           style={{ background: `linear-gradient(135deg, ${primary}, ${primaryDark})` }}>
                        <span className="drop-shadow-sm">{logoEmoji ?? '🏪'}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex-1 min-w-0 pt-0.5 w-full">
                  <div className="flex items-center justify-center sm:justify-start gap-2 flex-wrap">
                    <h1 className="text-2xl sm:text-3xl font-bold text-gray-950 leading-tight tracking-tight"
                        style={{ fontFamily: "'Poppins', system-ui, sans-serif" }}>{businessName}</h1>
                    {isVerified(effectivePlan(config)) && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-brand bg-brand/10
                                       px-2 py-0.5 rounded-full flex-shrink-0">
                        <Check size={10} strokeWidth={3} /> Verified
                      </span>
                    )}
                    {heroRating?.count > 0 && (
                      <button type="button"
                        onClick={() => document.getElementById('reviews')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                        className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-600 bg-amber-500/10
                                   px-2 py-0.5 rounded-full flex-shrink-0 active:scale-95 transition-transform"
                        aria-label={`Rated ${heroRating.avg} by ${heroRating.count} customers — read reviews`}>
                        <Star size={10} fill="currentColor" /> {heroRating.avg} ({heroRating.count})
                      </button>
                    )}
                  </div>
                  {(tagline || config.category) && (
                    <p className="text-sm text-gray-500 mt-1 line-clamp-2">
                      {tagline || `${config.category}${config.city ? ` · ${config.city}` : ''}`}
                    </p>
                  )}

                  {/* Under the name: the store's own trust badges (Fast Delivery,
                      Genuine Products…) — richer than plain chips. Falls back to a
                      couple of info chips only when the owner hasn't set any. */}
                  {features?.length > 0 ? (
                    <div className="flex items-stretch gap-2 mt-3 overflow-x-auto scrollbar-hide -mx-1 px-1 pb-0.5">
                      {features.map((f) => (
                        <div key={f.title}
                          className="flex items-center gap-2 flex-shrink-0 bg-gray-50 border border-gray-100 rounded-xl pl-2 pr-3 py-1.5">
                          <span className="w-7 h-7 rounded-lg flex items-center justify-center text-sm flex-shrink-0"
                                style={{ background: `${primary}14` }}>
                            {f.emoji}
                          </span>
                          <div className="leading-tight text-left">
                            <p className="text-[11px] font-bold text-gray-800 whitespace-nowrap">{f.title}</p>
                            {f.desc && <p className="text-[9.5px] text-gray-400 whitespace-nowrap">{f.desc}</p>}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 mt-3">
                      <Chip>🛍️ {products.length} products</Chip>
                      {freeAbove > 0 && config.delivery?.mode !== 'pickup' && <Chip>🚚 Free delivery ₹{freeAbove}+</Chip>}
                      {config.delivery?.mode === 'both' && <Chip>🏪 Pickup available</Chip>}
                      {config.delivery?.mode === 'pickup' && <Chip>🏪 Pickup only</Chip>}
                      {config.delivery?.eta && config.delivery?.mode !== 'pickup' && <Chip>⏱️ Delivers in {config.delivery.eta}</Chip>}
                      {config.city && <Chip>📍 {config.city}</Chip>}
                    </div>
                  )}
                </div>

                {/* Primary CTA: browse the catalog · share · quiet WhatsApp (desktop) */}
                <div className="hidden sm:flex flex-col items-end gap-2 flex-shrink-0">
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={shareStore} aria-label="Share this store"
                      className="w-10 h-10 rounded-xl bg-white/80 border border-gray-200 text-gray-500
                                 hover:text-gray-800 hover:bg-white flex items-center justify-center
                                 shadow-sm transition-all active:scale-95">
                      {shareCopied ? <Check size={15} className="text-emerald-600" /> : <Share2 size={15} />}
                    </button>
                    <button type="button" onClick={scrollToProducts}
                       className="inline-flex items-center gap-2 text-white text-sm font-bold px-5 py-3 rounded-xl
                                  shadow-lg transition-all active:scale-95"
                       style={{ background: `linear-gradient(135deg, ${primary}, ${primaryDark})`, boxShadow: `0 10px 25px ${primary}40` }}>
                      <ShoppingCart size={16} /> Browse products
                    </button>
                  </div>
                  <a href={waLink} target="_blank" rel="noopener noreferrer"
                     className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-gray-500 hover:text-emerald-600 transition-colors pr-1">
                    <MessageCircle size={13} /> Questions? Chat on WhatsApp
                  </a>
                </div>
              </div>

              {/* Primary CTA (mobile): browse the catalog, WhatsApp demoted below */}
              <button type="button" onClick={scrollToProducts}
                 className="sm:hidden mt-4 w-full flex items-center justify-center gap-2 text-white text-sm font-bold
                            py-3 rounded-xl shadow-lg active:scale-[0.99]"
                 style={{ background: `linear-gradient(135deg, ${primary}, ${primaryDark})` }}>
                <ShoppingCart size={16} /> Browse products
              </button>
              <a href={waLink} target="_blank" rel="noopener noreferrer"
                 className="sm:hidden mt-2.5 flex items-center justify-center gap-1.5 text-[12px] font-semibold text-gray-500">
                <MessageCircle size={13} /> Questions? Chat on WhatsApp
              </a>
            </div>
          </div>
        </div>
      </header>

      {/* Scroll hint — a gently bouncing cue that the catalog is just below */}
      {products.length > 0 && (
        <div className="flex justify-center mt-1">
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
              categoryRailClassName="hidden lg:block"   /* mobile uses the Categories tab */
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
              {aiAskEnabled ? 'Ask anything' : 'Search products'}
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

import { useState, useEffect } from 'react';
import { ChevronRight } from 'lucide-react';
import ProductGrid   from '../components/product/ProductGrid';
import CartSidebar   from '../components/cart/CartSidebar';
import CartSummary   from '../components/cart/CartSummary';
import CheckoutSheet from '../components/cart/CheckoutSheet';
import { useCart }   from '../hooks/useCart';
import { useBusinessConfig } from '../contexts/BusinessContext';
import { whatsappLink } from '../utils/theme';
import { calcCartTotals, formatINR } from '../utils/currency';
import { openRestaurantOrder }       from '../utils/whatsappEngine';
import PromoBanner                    from '../components/PromoBanner';

const INITIAL_FORM = { name: '', phone: '', orderType: 'delivery', address: '', instructions: '' };

const Wa = (p) => (<svg viewBox="0 0 24 24" className="w-4 h-4 fill-current" {...p}><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>);

function Chip({ children }) {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-gray-600
                     bg-orange-50 border border-orange-100 rounded-full px-2.5 py-1 whitespace-nowrap">
      {children}
    </span>
  );
}

export default function RestaurantTemplate({ externalCartOpen, onExternalCartClose, onCartCountChange }) {
  const [cartOpen,     setCartOpen]     = useState(false);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [form,         setForm]         = useState(INITIAL_FORM);

  const { cart, itemCount, addToCart, increaseQty, decreaseQty, setQty, removeItem } = useCart();
  const config = useBusinessConfig();
  const { products, categories, businessName, tagline, logo, logoEmoji, coverImage, whatsappNumber, theme } = config;
  const { total } = calcCartTotals(cart, config.cart ?? {});
  const primary     = theme?.primary ?? '#ea580c';
  const primaryDark = theme?.primaryDark ?? '#c2410c';
  const waLink      = whatsappLink(whatsappNumber, businessName);

  useEffect(() => { onCartCountChange?.(itemCount); }, [itemCount, onCartCountChange]);
  useEffect(() => {
    if (externalCartOpen) { setCartOpen(true); onExternalCartClose?.(); }
  }, [externalCartOpen, onExternalCartClose]);
  useEffect(() => {
    document.title = `${businessName} — Order Food`;
    return () => { document.title = 'PocketLink'; };
  }, [businessName]);

  function handleCheckout() {
    setCartOpen(false);
    setCheckoutOpen(true);
  }

  function handleOrder(e) {
    e.preventDefault();
    if (!cart.length) return;
    openRestaurantOrder(form, cart, config);
    setCheckoutOpen(false);
  }

  const isValid = form.name && form.phone.length === 10 && (form.orderType === 'pickup' || form.address);

  return (
    <div className={['min-h-screen w-full overflow-x-hidden', itemCount > 0 ? 'pb-20 lg:pb-0' : ''].join(' ')}
         style={{ backgroundColor: '#fffbf5' }}>

      <PromoBanner />

      {/* ══ Hero ══════════════════════════════════════════════════════════════ */}
      <header className="relative w-full">
        <div className="relative w-full h-44 sm:h-60 overflow-hidden">
          {coverImage ? (
            <img src={coverImage} alt={businessName} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full relative"
                 style={{ background: `linear-gradient(135deg, ${primary} 0%, ${primaryDark} 100%)` }}>
              <div className="absolute -top-12 -right-8 w-60 h-60 rounded-full"
                   style={{ background: '#fff', opacity: 0.14, filter: 'blur(50px)' }} />
              <div className="absolute -bottom-20 left-1/4 w-56 h-56 rounded-full"
                   style={{ background: '#000', opacity: 0.16, filter: 'blur(50px)' }} />
              <span className="absolute right-6 sm:right-12 top-1/2 -translate-y-1/2 text-7xl sm:text-8xl opacity-20 select-none">
                {logoEmoji ?? '🍽️'}
              </span>
            </div>
          )}
          {coverImage && (
            <div className="absolute inset-0"
                 style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.55) 0%, transparent 55%)' }} />
          )}
        </div>

        <div className="max-w-7xl mx-auto px-3 sm:px-4">
          <div className="relative z-10 -mt-14 sm:-mt-16 bg-white rounded-3xl border border-orange-100/70
                          shadow-xl shadow-orange-200/30 p-4 sm:p-6">
            <div className="flex items-start gap-3 sm:gap-5">
              {/* Avatar */}
              {logo ? (
                <img src={logo} alt={businessName}
                  className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl object-cover ring-4 ring-white shadow-md
                             flex-shrink-0 -mt-10 sm:-mt-14 bg-white" />
              ) : (
                <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl flex items-center justify-center
                                text-3xl sm:text-4xl ring-4 ring-white shadow-md flex-shrink-0 -mt-10 sm:-mt-14"
                     style={{ background: `linear-gradient(135deg, ${primary}, ${primaryDark})` }}>
                  <span className="drop-shadow-sm">{logoEmoji ?? '🍽️'}</span>
                </div>
              )}

              <div className="flex-1 min-w-0 pt-0.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-lg sm:text-2xl font-extrabold text-gray-900 leading-tight">{businessName}</h1>
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold text-green-700 bg-green-100
                                   px-2 py-0.5 rounded-full flex-shrink-0">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500" /> Taking orders
                  </span>
                </div>
                {tagline && <p className="text-sm text-gray-500 mt-1 line-clamp-2">{tagline}</p>}

                <div className="flex flex-wrap items-center gap-2 mt-3">
                  <Chip>🍽️ {products.length} dishes</Chip>
                  <Chip>🚚 Delivery &amp; Pickup</Chip>
                  <Chip>💬 Order on WhatsApp</Chip>
                </div>
              </div>

              <a href={waLink} target="_blank" rel="noopener noreferrer"
                 className="hidden sm:inline-flex items-center gap-2 flex-shrink-0 bg-[#25D366] hover:bg-[#1ebe5d]
                            text-white text-sm font-bold px-5 py-3 rounded-xl shadow-lg shadow-emerald-500/25
                            transition-all active:scale-95">
                <Wa /> Order on WhatsApp
              </a>
            </div>

            {/* Delivery / Pickup toggle */}
            <div className="mt-4 flex items-center gap-2 bg-orange-50/70 border border-orange-100 rounded-2xl p-1.5 w-full sm:w-auto sm:inline-flex">
              {[['delivery', '🚚 Delivery'], ['pickup', '🏠 Pickup']].map(([t, label]) => (
                <button key={t} onClick={() => setForm(f => ({ ...f, orderType: t }))}
                  className={[
                    'flex-1 sm:flex-none px-5 py-2 rounded-xl text-sm font-bold transition-all',
                    form.orderType === t ? 'text-white shadow-sm' : 'text-gray-500 hover:text-gray-700',
                  ].join(' ')}
                  style={form.orderType === t ? { backgroundColor: primary } : {}}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      <div id="products" className="max-w-7xl mx-auto px-3 sm:px-4 py-6 sm:py-8">
        <div className="flex flex-col lg:flex-row gap-6 xl:gap-8 items-start">

          {/* Menu + form */}
          <div className="w-full lg:flex-1 min-w-0 space-y-6">
            <ProductGrid products={products} categories={categories} cart={cart}
              onAddToCart={addToCart} onIncrease={increaseQty} onDecrease={decreaseQty} onSetQty={setQty}
              heading="Our Menu" nounSingular="dish" nounPlural="dishes" searchPlaceholder="Search the menu…" />

            {/* Order form — opens as a focused slide-over from the cart */}
            <CheckoutSheet
              open={checkoutOpen}
              onClose={() => setCheckoutOpen(false)}
              onBack={() => { setCheckoutOpen(false); setCartOpen(true); }}
              title={form.orderType === 'delivery' ? 'Delivery details' : 'Pickup details'}
            >
            <form onSubmit={handleOrder}
              className="bg-white rounded-3xl border border-orange-100 shadow-sm p-5 sm:p-6 space-y-4">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-lg">{form.orderType === 'delivery' ? '🚚' : '🏠'}</span>
                <h3 className="font-bold text-gray-900 text-sm">{form.orderType === 'delivery' ? 'Delivery Details' : 'Pickup Details'}</h3>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-500 mb-1 block">Your Name *</label>
                  <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="Full name" required
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:border-transparent transition-all"
                    style={{ '--tw-ring-color': `${primary}50` }} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 mb-1 block">Phone *</label>
                  <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value.replace(/\D/g, '').slice(0, 10) }))}
                    placeholder="10-digit number" inputMode="numeric" required
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:border-transparent transition-all"
                    style={{ '--tw-ring-color': `${primary}50` }} />
                </div>
              </div>

              {form.orderType === 'delivery' && (
                <div>
                  <label className="text-xs font-semibold text-gray-500 mb-1 block">Delivery Address *</label>
                  <textarea value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                    placeholder="Full delivery address" rows={2} required
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:border-transparent transition-all resize-none"
                    style={{ '--tw-ring-color': `${primary}50` }} />
                </div>
              )}

              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1 block">Special Instructions <span className="font-normal text-gray-300">(optional)</span></label>
                <textarea value={form.instructions} onChange={e => setForm(f => ({ ...f, instructions: e.target.value }))}
                  placeholder="Spice level, allergies, extra requests…" rows={2}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:border-transparent transition-all resize-none"
                  style={{ '--tw-ring-color': `${primary}50` }} />
              </div>

              {cart.length > 0 ? (
                <div className="border-t border-orange-50 pt-3 space-y-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-500 font-medium">{itemCount} {itemCount === 1 ? 'item' : 'items'}</span>
                    <span className="font-extrabold text-gray-900 text-base">{formatINR(total)}</span>
                  </div>
                  <button type="submit" disabled={!isValid}
                    className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl text-sm font-bold text-white transition-all hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed shadow-md"
                    style={{ backgroundColor: '#25D366' }}>
                    <Wa /> Send Order on WhatsApp
                  </button>
                </div>
              ) : (
                <p className="text-center text-xs text-orange-300 py-2 font-medium">
                  🍽️ Add items from the menu above to place your order
                </p>
              )}
            </form>
            </CheckoutSheet>
          </div>

          {/* Desktop cart */}
          <aside className="hidden lg:block w-72 xl:w-80 flex-shrink-0">
            <div className="sticky top-24 bg-white rounded-2xl border border-orange-100 shadow-sm overflow-hidden">
              <div className="px-4 py-3.5 border-b border-orange-50 flex items-center justify-between"
                   style={{ backgroundColor: `${primary}08` }}>
                <span className="font-bold text-gray-900 text-sm">🛒 Your Cart</span>
                {itemCount > 0 && <span className="text-xs font-bold px-2 py-0.5 rounded-full text-white" style={{ backgroundColor: primary }}>{itemCount}</span>}
              </div>
              {itemCount === 0 ? (
                <div className="px-4 py-10 text-center">
                  <p className="text-3xl mb-2">🍽️</p>
                  <p className="text-sm font-semibold text-gray-600">Nothing here yet</p>
                  <p className="text-xs text-gray-400 mt-1">Add dishes from the menu</p>
                </div>
              ) : (
                <div className="px-4 pb-4 pt-3">
                  <CartSummary cart={cart} compact onCheckout={handleCheckout} ctaLabel="Place Order" />
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>

      <CartSidebar cart={cart} isOpen={cartOpen} onClose={() => setCartOpen(false)}
        onIncrease={increaseQty} onDecrease={decreaseQty} onRemove={removeItem} onSetQty={setQty} onCheckout={handleCheckout} />

      {itemCount > 0 && (
        <div className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-orange-100 shadow-[0_-4px_20px_rgba(0,0,0,0.08)] pb-[env(safe-area-inset-bottom)]">
          <div className="px-4 py-3">
            <button onClick={() => setCartOpen(true)}
              className="w-full flex items-center justify-between text-white font-semibold rounded-2xl px-4 py-3 transition-all"
              style={{ backgroundColor: primary }}>
              <div className="flex items-center gap-2.5">
                <span className="bg-white/20 text-white text-xs font-bold w-6 h-6 rounded-lg flex items-center justify-center">{itemCount}</span>
                <span className="text-sm">{itemCount} {itemCount === 1 ? 'item' : 'items'} · View Cart</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="font-bold">{formatINR(total)}</span>
                <ChevronRight size={16} className="opacity-80" />
              </div>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

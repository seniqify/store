import { useState, useEffect } from 'react';
import { ChevronRight } from 'lucide-react';
import ProductGrid   from '../components/product/ProductGrid';
import CartSidebar   from '../components/cart/CartSidebar';
import CartSummary   from '../components/cart/CartSummary';
import { useCart }   from '../hooks/useCart';
import { useBusinessConfig } from '../contexts/BusinessContext';
import { calcCartTotals, formatINR } from '../utils/currency';
import { openRestaurantOrder }       from '../utils/whatsappEngine';
import PromoBanner                    from '../components/PromoBanner';

const INITIAL_FORM = { name: '', phone: '', orderType: 'delivery', address: '', instructions: '' };

export default function RestaurantTemplate({ externalCartOpen, onExternalCartClose, onCartCountChange }) {
  const [cartOpen, setCartOpen] = useState(false);
  const [form,     setForm]     = useState(INITIAL_FORM);

  const { cart, itemCount, addToCart, increaseQty, decreaseQty, removeItem } = useCart();
  const config = useBusinessConfig();
  const { products, categories, businessName, tagline, logoEmoji, theme } = config;
  const { total } = calcCartTotals(cart, config.cart ?? {});
  const primary = theme?.primary ?? '#ea580c';

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
    setTimeout(() => document.getElementById('order-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
  }

  function handleOrder(e) {
    e.preventDefault();
    if (!cart.length) return;
    openRestaurantOrder(form, cart, config);
  }

  const isValid = form.name && form.phone.length === 10 && (form.orderType === 'pickup' || form.address);

  return (
    <div className={['min-h-screen w-full overflow-x-hidden', itemCount > 0 ? 'pb-20 lg:pb-0' : ''].join(' ')}
         style={{ backgroundColor: '#fffbf5' }}>

      <PromoBanner />

      {/* ── Hero banner ── */}
      <div className="w-full px-3 sm:px-4 pt-4 pb-2">
        <div className="max-w-7xl mx-auto rounded-2xl overflow-hidden relative"
             style={{ background: `linear-gradient(135deg, ${primary}ee, ${primary}aa)` }}>
          <div className="absolute inset-0 opacity-10"
               style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'none\' fill-rule=\'evenodd\'%3E%3Cg fill=\'%23ffffff\' fill-opacity=\'0.4\'%3E%3Cpath d=\'M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z\'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")' }} />
          <div className="relative flex items-center justify-between px-5 sm:px-8 py-5">
            <div>
              <div className="flex items-center gap-3 mb-1">
                <span className="text-3xl">{logoEmoji ?? '🍽️'}</span>
                <h1 className="text-2xl font-extrabold text-white tracking-tight">{businessName}</h1>
              </div>
              {tagline && <p className="text-white/80 text-sm">{tagline}</p>}
              <div className="flex items-center gap-3 mt-3">
                {['delivery', 'pickup'].map(t => (
                  <button key={t} onClick={() => setForm(f => ({ ...f, orderType: t }))}
                    className={[
                      'px-4 py-1.5 rounded-full text-xs font-bold transition-all',
                      form.orderType === t ? 'bg-white text-gray-900' : 'bg-white/20 text-white border border-white/30',
                    ].join(' ')}>
                    {t === 'delivery' ? '🚚 Delivery' : '🏠 Pickup'}
                  </button>
                ))}
              </div>
            </div>
            <span className="text-6xl opacity-80 hidden sm:block">🍽️</span>
          </div>
        </div>
      </div>

      <div id="products" className="max-w-7xl mx-auto px-3 sm:px-4 py-4 sm:py-6">
        <div className="flex flex-col lg:flex-row gap-6 xl:gap-8 items-start">

          {/* Menu + form */}
          <div className="w-full lg:flex-1 space-y-6">
            <ProductGrid products={products} categories={categories} cart={cart}
              onAddToCart={addToCart} onIncrease={increaseQty} onDecrease={decreaseQty} />

            <div className="flex items-center gap-4">
              <div className="h-px flex-1 bg-orange-100" />
              <span className="text-xs font-bold text-orange-400 uppercase tracking-widest">Your Order Details</span>
              <div className="h-px flex-1 bg-orange-100" />
            </div>

            {/* Order form */}
            <form id="order-form" onSubmit={handleOrder}
              className="bg-white rounded-2xl border border-orange-100 shadow-sm p-5 space-y-4">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-lg">📋</span>
                <h3 className="font-bold text-gray-900 text-sm">Delivery Details</h3>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-500 mb-1 block">Your Name *</label>
                  <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="Full name" required
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:border-orange-400 transition-all"
                    style={{ '--tw-ring-color': `${primary}40` }} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 mb-1 block">Phone *</label>
                  <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value.replace(/\D/g, '').slice(0, 10) }))}
                    placeholder="10-digit number" inputMode="numeric" required
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 transition-all" />
                </div>
              </div>

              {form.orderType === 'delivery' && (
                <div>
                  <label className="text-xs font-semibold text-gray-500 mb-1 block">Delivery Address *</label>
                  <textarea value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                    placeholder="Full delivery address" rows={2} required
                    className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 transition-all resize-none" />
                </div>
              )}

              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1 block">Special Instructions <span className="font-normal text-gray-300">(optional)</span></label>
                <textarea value={form.instructions} onChange={e => setForm(f => ({ ...f, instructions: e.target.value }))}
                  placeholder="Spice level, allergies, extra requests…" rows={2}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 transition-all resize-none" />
              </div>

              {cart.length > 0 ? (
                <div className="border-t border-orange-50 pt-3 space-y-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-500 font-medium">{itemCount} {itemCount === 1 ? 'item' : 'items'}</span>
                    <span className="font-extrabold text-gray-900 text-base">{formatINR(total)}</span>
                  </div>
                  <button type="submit" disabled={!isValid}
                    className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl text-sm font-bold text-white transition-all hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{ backgroundColor: primary }}>
                    <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                    Send Order on WhatsApp
                  </button>
                </div>
              ) : (
                <p className="text-center text-xs text-orange-300 py-2 font-medium">
                  🍽️ Add items from the menu above to place your order
                </p>
              )}
            </form>
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
        onIncrease={increaseQty} onDecrease={decreaseQty} onRemove={removeItem} onCheckout={handleCheckout} />

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

import { X, ShoppingBag, PackageOpen } from 'lucide-react';
import CartItem from './CartItem';
import CartSummary from './CartSummary';

/**
 * CartSidebar
 * ───────────────────────────────────────────────────────────────────────────
 * Full-height sliding panel (right edge).
 *
 * Structure:
 *   ┌─ Header ──────────────────────────────── [×] ─┐
 *   │  "Your Cart  (3 items)"                        │
 *   ├────────────────────────────────────────────────┤
 *   │  Scrollable CartItem list                      │  flex-1, overflow-y-auto
 *   ├────────────────────────────────────────────────┤
 *   │  CartSummary (grand total + CTA)               │  sticky bottom
 *   └────────────────────────────────────────────────┘
 *
 * All totals are delegated to CartSummary — this component owns only
 * layout and item list rendering.
 *
 * Props:
 *   cart        CartItem[]
 *   isOpen      boolean
 *   onClose     () => void
 *   onIncrease  (id) => void
 *   onDecrease  (id) => void
 *   onRemove    (id) => void
 *   onCheckout  () => void
 */
export default function CartSidebar({
  cart,
  isOpen,
  onClose,
  onIncrease,
  onDecrease,
  onRemove,
  onCheckout,
}) {
  const itemCount = cart.reduce((s, i) => s + i.qty, 0);

  return (
    <>
      {/* ── Backdrop (mobile) ─────────────────────────────────────────── */}
      <div
        onClick={onClose}
        aria-hidden="true"
        className={[
          'fixed inset-0 bg-black/40 backdrop-blur-sm z-40 transition-opacity duration-300',
          'lg:hidden',
          isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
        ].join(' ')}
      />

      {/* ── Sliding panel ─────────────────────────────────────────────── */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Shopping cart"
        className={[
          'fixed top-0 right-0 z-50',
          'h-[100dvh] w-full sm:w-[26rem]',
          'bg-white shadow-2xl',
          'flex flex-col overflow-hidden',
          'transition-transform duration-300 ease-in-out',
          isOpen ? 'translate-x-0' : 'translate-x-full',
        ].join(' ')}
      >

        {/* ── Header ──────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-brand/10 rounded-lg flex items-center justify-center">
              <ShoppingBag size={17} className="text-brand" />
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-900 leading-none">
                Your Cart
              </h2>
              {itemCount > 0 && (
                <p className="text-xs text-brand-dark font-medium leading-none mt-0.5">
                  {itemCount} {itemCount === 1 ? 'item' : 'items'}
                </p>
              )}
            </div>
          </div>

          <button
            onClick={onClose}
            aria-label="Close cart"
            className="p-1.5 rounded-xl hover:bg-gray-100 text-gray-400
                       hover:text-gray-700 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* ── Item list ───────────────────────────────────────────────── */}
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-5">
          {cart.length === 0 ? (
            /* Empty state */
            <div className="flex flex-col items-center justify-center h-full py-16 text-center">
              <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                <PackageOpen size={36} className="text-gray-300" />
              </div>
              <p className="font-semibold text-gray-700 text-base mb-1">
                Your cart is empty
              </p>
              <p className="text-sm text-gray-400 max-w-[200px]">
                Browse products and add items to get started
              </p>
              <button
                onClick={onClose}
                className="mt-6 text-sm font-semibold text-brand hover:text-brand-dark
                           underline underline-offset-2 transition-colors"
              >
                Continue Shopping
              </button>
            </div>
          ) : (
            cart.map((item) => (
              <CartItem
                key={item.id}
                item={item}
                onIncrease={onIncrease}
                onDecrease={onDecrease}
                onRemove={onRemove}
              />
            ))
          )}
        </div>

        {/* ── Summary + CTA (only when cart has items) ────────────────── */}
        {cart.length > 0 && (
          <div className="border-t border-gray-100 px-5 py-5 flex-shrink-0 bg-white">
            <CartSummary
              cart={cart}
              onCheckout={onCheckout}
            />
          </div>
        )}
      </aside>
    </>
  );
}

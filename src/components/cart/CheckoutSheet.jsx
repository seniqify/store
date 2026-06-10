import { X, ArrowLeft } from 'lucide-react';

/**
 * CheckoutSheet
 * ───────────────────────────────────────────────────────────────────────────
 * A focused slide-over (right panel on desktop, full-screen on mobile) for the
 * order/checkout form — opened from the cart instead of an inline form hanging
 * off the bottom of the catalog. Generic shell: pass the template's own form as
 * `children`, so every business type (product, restaurant, …) shares the same
 * checkout UX. Mirrors CartSidebar's stacking (z-[60]/[55]) so it sits above
 * the mobile tab bar.
 *
 * Props:
 *   open      boolean
 *   onClose   () => void          — close everything
 *   onBack    () => void | null   — back to the cart panel (optional)
 *   title     string              — header label
 *   children  the form to render in the scrollable body
 */
export default function CheckoutSheet({ open, onClose, onBack, title = 'Complete your order', children }) {
  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        aria-hidden="true"
        className={[
          'fixed inset-0 bg-black/40 backdrop-blur-sm z-[55] transition-opacity duration-300',
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
        ].join(' ')}
      />

      {/* Sliding panel */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={[
          'fixed top-0 right-0 z-[60] h-[100dvh] w-full sm:w-[28rem]',
          'bg-[#f8fafc] shadow-2xl sm:rounded-l-3xl flex flex-col overflow-hidden',
          'transition-transform duration-300 ease-in-out',
          open ? 'translate-x-0' : 'translate-x-full',
        ].join(' ')}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0 bg-white">
          <div className="flex items-center gap-1.5 min-w-0">
            {onBack && (
              <button onClick={onBack} aria-label="Back to cart"
                className="p-1.5 -ml-1.5 rounded-lg text-gray-500 hover:text-gray-800 hover:bg-gray-100 transition-colors flex-shrink-0">
                <ArrowLeft size={18} />
              </button>
            )}
            <h2 className="text-base font-extrabold text-gray-900 leading-none tracking-tight truncate">
              {title}
            </h2>
          </div>
          <button onClick={onClose} aria-label="Close"
            className="p-2 rounded-xl hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors flex-shrink-0">
            <X size={20} />
          </button>
        </div>

        {/* Scrollable form body */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4">
          {children}
        </div>
      </aside>
    </>
  );
}

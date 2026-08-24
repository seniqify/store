import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { BellRing, X, ChevronRight } from 'lucide-react';
import { formatINR } from '../../utils/currency';

/**
 * NewOrderToast — the in-app "an order just landed" card.
 *
 * Purely presentational: the Manage shell owns when it appears (a new order
 * arrived while you weren't on the Orders tab) and auto-dismisses it. Tapping the
 * card jumps to Orders. It drops in from the top with a mount transition (no
 * global keyframes needed), and honours prefers-reduced-motion.
 */
export default function NewOrderToast({ order, count = 1, themeColor = '#0d9488', onView, onClose }) {
  const [shown, setShown] = useState(false);

  // Flip to the visible state one frame after mount so the transition plays.
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);

  if (typeof document === 'undefined') return null;

  const name  = (order?.name || '').trim();
  const amount = Number(order?.total) || 0;
  const many  = count > 1;

  const detail = [
    name || 'A customer',
    amount > 0 ? formatINR(amount) : null,
    'just now',
  ].filter(Boolean).join(' · ');

  return createPortal(
    <div
      className="fixed inset-x-0 z-[60] flex justify-center px-3 pointer-events-none"
      style={{ top: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}
      role="status"
      aria-live="polite"
    >
      <button
        type="button"
        onClick={onView}
        className={[
          'pointer-events-auto w-full max-w-sm text-left flex items-center gap-3',
          'rounded-2xl bg-white border border-gray-100 px-3.5 py-3',
          'shadow-[0_16px_40px_-12px_rgba(4,30,22,0.35)] active:scale-[0.99]',
          'transition-all duration-300 ease-out motion-reduce:transition-none',
          shown ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4',
        ].join(' ')}
      >
        <span
          className="flex-shrink-0 w-11 h-11 rounded-xl grid place-items-center text-white"
          style={{ background: `linear-gradient(150deg, ${themeColor}, ${themeColor}cc)` }}
        >
          <BellRing size={20} />
        </span>

        <span className="min-w-0 flex-1">
          <span className="block text-sm font-extrabold text-gray-900 leading-tight">
            {many ? `${count} new orders` : 'New order'} 🎉
          </span>
          <span className="block text-xs text-gray-500 truncate mt-0.5">{detail}</span>
        </span>

        <span
          className="flex-shrink-0 inline-flex items-center gap-0.5 text-xs font-bold px-2.5 py-1.5 rounded-lg text-white"
          style={{ backgroundColor: themeColor }}
        >
          View <ChevronRight size={13} strokeWidth={2.5} />
        </span>

        <span
          role="button"
          tabIndex={0}
          aria-label="Dismiss"
          onClick={(e) => { e.stopPropagation(); onClose?.(); }}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); onClose?.(); } }}
          className="flex-shrink-0 -mr-1 p-1 rounded-lg text-gray-300 hover:text-gray-600 hover:bg-gray-100 transition-colors"
        >
          <X size={15} />
        </span>
      </button>
    </div>,
    document.body,
  );
}

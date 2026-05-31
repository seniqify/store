import { useState } from 'react';
import { Trash2, Plus, Minus, Ruler } from 'lucide-react';
import { formatINR } from '../../utils/currency';

/**
 * CartItem
 * ─────────────────────────────────────────────────────────────────────────
 * Renders a single line in the cart with four required data points:
 *
 *   • Name      — product name (2-line clamp)
 *   • Quantity  — inline stepper with − / qty / + controls
 *   • Price     — unit price (₹ each)
 *   • Subtotal  — price × qty, shown prominently
 *
 * Interactions:
 *   • Decrease below 1 triggers remove (handled by decreaseQty in useCart)
 *   • Delete button animates the row out (260 ms) before calling onRemove
 *
 * Props:
 *   item        CartItem   — { id, name, image, price, mrp?, unit, size?, gsm?, qty }
 *   onIncrease  (id) => void
 *   onDecrease  (id) => void   — automatically removes when qty hits 0
 *   onRemove    (id) => void
 */
export default function CartItem({ item, onIncrease, onDecrease, onRemove }) {
  const [removing, setRemoving] = useState(false);

  const unitSubtotal = item.price * item.qty;

  function handleRemove() {
    setRemoving(true);
    setTimeout(() => onRemove(item.id), 260);
  }

  return (
    <div
      className={[
        'py-4 border-b border-gray-100 last:border-0',
        'transition-all duration-300 ease-in-out',
        removing ? 'opacity-0 -translate-x-3 scale-[0.97]' : 'opacity-100 translate-x-0 scale-100',
      ].join(' ')}
    >
      <div className="flex gap-3">

        {/* Thumbnail */}
        <div className="w-[4.5rem] h-[4.5rem] rounded-2xl overflow-hidden bg-gray-100 flex-shrink-0 shadow-sm ring-1 ring-gray-100">
          <img
            src={item.image}
            alt={item.name}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        </div>

        {/* Info + controls */}
        <div className="flex-1 min-w-0 flex flex-col">

          {/* Top: name + delete */}
          <div className="flex items-start gap-2">
            <p className="text-sm font-semibold text-gray-900 leading-snug line-clamp-2 flex-1">
              {item.name}
            </p>
            <button
              onClick={handleRemove}
              aria-label={`Remove ${item.name}`}
              className="-mt-0.5 -mr-1 p-1.5 rounded-lg text-gray-300
                         hover:text-red-500 hover:bg-red-50
                         transition-colors flex-shrink-0"
            >
              <Trash2 size={15} />
            </button>
          </div>

          {/* Meta chips: size + gsm */}
          {(item.size || item.gsm) && (
            <div className="flex flex-wrap items-center gap-1 mt-1">
              {item.size && (
                <span className="inline-flex items-center gap-0.5 text-[11px]
                                 bg-brand/10 text-brand-dark font-medium
                                 px-1.5 py-0.5 rounded-full leading-none">
                  <Ruler size={9} />
                  {item.size}
                </span>
              )}
              {item.gsm && (
                <span className="text-[11px] bg-gray-100 text-gray-500
                                 font-medium px-1.5 py-0.5 rounded-full leading-none">
                  {item.gsm} GSM
                </span>
              )}
            </div>
          )}

          {/* Unit price */}
          <p className="text-xs text-gray-400 mt-1 tabular-nums">
            {formatINR(item.price)} <span className="text-gray-300">each</span>
            {item.unit && <span className="text-gray-400"> · {item.unit}</span>}
          </p>

          {/* Bottom: stepper + subtotal */}
          <div className="flex items-center justify-between mt-2.5">
            {/* Quantity stepper */}
            <div className="flex items-center bg-gray-50 rounded-xl overflow-hidden border border-gray-200">
              <button
                onClick={() => onDecrease(item.id)}
                aria-label="Decrease quantity"
                className="w-8 h-8 flex items-center justify-center
                           text-gray-600 hover:bg-gray-100 active:bg-gray-200
                           transition-colors"
              >
                <Minus size={13} strokeWidth={2.5} />
              </button>

              <span className="w-8 text-center text-sm font-bold text-gray-900 select-none tabular-nums">
                {item.qty}
              </span>

              <button
                onClick={() => onIncrease(item.id)}
                aria-label="Increase quantity"
                className="w-8 h-8 flex items-center justify-center
                           text-gray-600 hover:bg-gray-100 active:bg-gray-200
                           transition-colors"
              >
                <Plus size={13} strokeWidth={2.5} />
              </button>
            </div>

            {/* Subtotal */}
            <div className="text-right">
              <span className="text-base font-extrabold text-brand-dark tabular-nums tracking-tight">
                {formatINR(unitSubtotal)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

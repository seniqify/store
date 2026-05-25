import { useState } from 'react';
import { Trash2, Plus, Minus, Ruler } from 'lucide-react';
import { formatINR } from '../../utils/currency';

/**
 * CartItem
 * ─────────��───────────────────────��───────────────────────────────────────
 * Renders a single line in the cart with four required data points:
 *
 *   • Name      — product name (2-line clamp)
 *   • Quantity  — inline stepper with − / qty / + controls
 *   • Price     — unit price (₹/piece)
 *   • Subtotal  — price × qty, shown prominently
 *
 * Interactions:
 *   • Decrease below 1 triggers remove (handled by decreaseQty in useCart)
 *   • Delete button animates the row out (150 ms) before calling onRemove
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
      {/* ── Top row: image + info ───���────────────────────────────────── */}
      <div className="flex gap-3">

        {/* Thumbnail */}
        <div className="w-16 h-16 rounded-xl overflow-hidden bg-gray-100 flex-shrink-0 shadow-sm">
          <img
            src={item.image}
            alt={item.name}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">

          {/* Name */}
          <p className="text-sm font-semibold text-gray-900 leading-snug line-clamp-2">
            {item.name}
          </p>

          {/* Meta chips: size + gsm */}
          <div className="flex flex-wrap items-center gap-1 mt-1">
            {item.size && (
              <span className="inline-flex items-center gap-0.5 text-xs
                               bg-brand/10 text-brand-dark font-medium
                               px-1.5 py-0.5 rounded-full leading-none">
                <Ruler size={9} />
                {item.size}
              </span>
            )}
            {item.gsm && (
              <span className="text-xs bg-gray-100 text-gray-500
                               font-medium px-1.5 py-0.5 rounded-full leading-none">
                {item.gsm} GSM
              </span>
            )}
          </div>

          {/* Unit */}
          {item.unit && (
            <p className="text-xs text-gray-400 mt-0.5">{item.unit}</p>
          )}
        </div>
      </div>

      {/* ── Bottom row: price × stepper = subtotal + delete ─────────── */}
      <div className="flex items-center gap-2 mt-3 pl-0">

        {/* Unit price */}
        <div className="flex flex-col">
          <span className="text-xs text-gray-400 leading-none mb-0.5">Price</span>
          <span className="text-sm font-semibold text-gray-700">
            {formatINR(item.price)}
          </span>
        </div>

        {/* Multiply symbol */}
        <span className="text-gray-300 text-sm font-light mx-0.5 self-end mb-0.5">×</span>

        {/* Quantity stepper */}
        <div className="flex flex-col">
          <span className="text-xs text-gray-400 leading-none mb-0.5">Qty</span>
          <div className="flex items-center bg-gray-100 rounded-lg overflow-hidden border border-gray-200">
            <button
              onClick={() => onDecrease(item.id)}
              aria-label="Decrease quantity"
              className="w-7 h-7 flex items-center justify-center
                         text-gray-600 hover:bg-gray-200 active:bg-gray-300
                         transition-colors"
            >
              <Minus size={12} strokeWidth={2.5} />
            </button>

            <span className="w-7 text-center text-sm font-bold text-gray-900 select-none tabular-nums">
              {item.qty}
            </span>

            <button
              onClick={() => onIncrease(item.id)}
              aria-label="Increase quantity"
              className="w-7 h-7 flex items-center justify-center
                         text-gray-600 hover:bg-gray-200 active:bg-gray-300
                         transition-colors"
            >
              <Plus size={12} strokeWidth={2.5} />
            </button>
          </div>
        </div>

        {/* Equals symbol */}
        <span className="text-gray-300 text-sm font-light mx-0.5 self-end mb-0.5">=</span>

        {/* Subtotal */}
        <div className="flex flex-col flex-1 min-w-0">
          <span className="text-xs text-gray-400 leading-none mb-0.5">Subtotal</span>
          <span className="text-sm font-bold text-brand-dark tabular-nums">
            {formatINR(unitSubtotal)}
          </span>
        </div>

        {/* Delete button */}
        <button
          onClick={handleRemove}
          aria-label={`Remove ${item.name}`}
          className="self-end mb-0.5 p-1.5 rounded-lg text-gray-300
                     hover:text-red-500 hover:bg-red-50
                     transition-colors flex-shrink-0"
        >
          <Trash2 size={15} />
        </button>
      </div>
    </div>
  );
}

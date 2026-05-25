import { useState } from 'react';
import { ShoppingCart, Plus, Minus, Check, Ruler } from 'lucide-react';
import Badge from '../ui/Badge';
import { formatINR, discountPercent } from '../../utils/currency';

/**
 * ProductCard
 * ────────────────────────────────────────────────────────────────────────────
 * Action area follows the Swiggy / Amazon pattern:
 *
 *   cartQty === 0  →  [  Add to Cart  ]       (single full-width button)
 *   cartQty  > 0  →  [ − ] [ N ] [ + ]       (live cart qty stepper)
 *
 * This removes the pre-add quantity selector that confused users into
 * thinking every product was already in their cart.
 *
 * Props:
 *   product      Product
 *   cartQty      number                  — live qty from the global cart
 *   onAddToCart  (product) => void       — adds 1 to cart
 *   onIncrease   (id) => void            — bumps cart qty by 1
 *   onDecrease   (id) => void            — drops cart qty by 1 (auto-removes at 0)
 */
export default function ProductCard({
  product,
  cartQty   = 0,
  onAddToCart,
  onIncrease,
  onDecrease,
}) {
  const [justAdded, setJustAdded] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);

  const discount   = discountPercent(product.price, product.mrp);
  const outOfStock = product.stock === 0;   // undefined → in stock

  // ── Add to cart (first time) ───────────────────────────────────────────
  function handleAdd() {
    if (outOfStock) return;
    onAddToCart(product, 1);
    setJustAdded(true);
    setTimeout(() => setJustAdded(false), 1000);
  }

  return (
    <div
      className={[
        'bg-white rounded-2xl border overflow-hidden flex flex-col',
        'transition-all duration-200',
        'hover:shadow-lg hover:-translate-y-0.5',
        cartQty > 0
          ? 'border-brand shadow-sm shadow-brand/10'
          : 'border-gray-100 shadow-sm',
      ].join(' ')}
    >
      {/* ── Image ─────────────────────────────────────────────────────── */}
      <div className="relative aspect-square bg-gray-100 overflow-hidden flex-shrink-0">

        {/* Skeleton shimmer */}
        {!imgLoaded && (
          <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-gray-100 to-gray-200" />
        )}

        <img
          src={product.image}
          alt={product.name}
          loading="lazy"
          onLoad={() => setImgLoaded(true)}
          className={[
            'w-full h-full object-cover hover:scale-105',
            'transition-[transform,opacity] duration-300',
            imgLoaded ? 'opacity-100' : 'opacity-0',
          ].join(' ')}
        />

        {/* Badge (top-left) */}
        {product.badge && (
          <div className="absolute top-2 left-2">
            <Badge label={product.badge} colorClass={product.badgeColor} />
          </div>
        )}

        {/* Discount chip (top-right, only when no badge) */}
        {discount > 0 && !product.badge && (
          <div className="absolute top-2 right-2 bg-green-500 text-white
                          text-xs font-bold px-1.5 py-0.5 rounded-md shadow-sm">
            {discount}% off
          </div>
        )}

        {/* "In cart" indicator — bottom-right */}
        {cartQty > 0 && (
          <div className="absolute bottom-2 right-2
                          flex items-center gap-1 bg-brand text-white
                          text-xs font-semibold px-2 py-0.5 rounded-full shadow-md">
            <Check size={10} strokeWidth={3} />
            {cartQty} in cart
          </div>
        )}

        {/* Out-of-stock overlay */}
        {outOfStock && (
          <div className="absolute inset-0 bg-black/45 flex items-center justify-center">
            <span className="bg-white text-gray-800 text-sm font-semibold
                             px-3 py-1 rounded-full shadow">
              Out of Stock
            </span>
          </div>
        )}
      </div>

      {/* ── Body ──────────────────────────────────────────────────────── */}
      <div className="p-3 flex flex-col flex-1 gap-2">

        {/* Product name */}
        <h3 className="text-sm font-semibold text-gray-900 line-clamp-2
                       leading-snug min-h-[2.5rem]">
          {product.name}
        </h3>

        {/* Description */}
        {product.description && (
          <p className="text-xs text-gray-400 leading-relaxed line-clamp-2 -mt-1">
            {product.description}
          </p>
        )}

        {/* Size + GSM chips */}
        <div className="flex flex-wrap gap-1.5">
          {product.size && (
            <span className="inline-flex items-center gap-0.5 text-xs
                             bg-brand/10 text-brand-dark font-medium
                             px-2 py-0.5 rounded-full">
              <Ruler size={10} />
              {product.size}
            </span>
          )}
          {product.gsm && (
            <span className="text-xs bg-gray-100 text-gray-500
                             font-medium px-2 py-0.5 rounded-full">
              {product.gsm}&nbsp;GSM
            </span>
          )}
        </div>

        {/* Unit */}
        {product.unit && (
          <p className="text-xs text-gray-400 -mt-1">{product.unit}</p>
        )}

        {/* Price row */}
        <div className="flex items-baseline gap-1.5 mt-auto">
          <span className="text-base font-bold text-gray-900">
            {formatINR(product.price)}
          </span>
          {product.mrp > product.price && (
            <span className="text-xs text-gray-400 line-through">
              {formatINR(product.mrp)}
            </span>
          )}
          {discount > 0 && (
            <span className="text-xs font-semibold text-green-600 ml-auto">
              {discount}% off
            </span>
          )}
        </div>

        {/* ── Action area ───────────────────────────────────────────────
            cartQty === 0 → [Add to Cart] button
            cartQty  > 0 → [−] live-qty [+] stepper
        ─────────────────────────────────────────────────────────────── */}
        {!outOfStock && (
          <div className="pt-1">
            {cartQty === 0 ? (
              /* ── Not in cart: single Add button ── */
              <button
                onClick={handleAdd}
                className={[
                  'w-full flex items-center justify-center gap-1.5',
                  'text-xs sm:text-sm font-semibold py-2.5 rounded-xl',
                  'transition-all duration-200 active:scale-95 shadow-sm',
                  justAdded
                    ? 'bg-green-500 text-white scale-95'
                    : 'bg-brand hover:bg-brand-dark text-white',
                ].join(' ')}
              >
                {justAdded ? (
                  <>
                    <Check size={14} strokeWidth={3} />
                    Added!
                  </>
                ) : (
                  <>
                    <ShoppingCart size={14} />
                    Add to Cart
                  </>
                )}
              </button>
            ) : (
              /* ── Already in cart: qty stepper controls live cart qty ── */
              <div className="flex items-center justify-between
                              bg-brand rounded-xl overflow-hidden h-10">
                <button
                  onClick={() => onDecrease(product.id)}
                  aria-label="Remove one from cart"
                  className="w-10 h-full flex items-center justify-center
                             text-white hover:bg-white/20 active:bg-white/30
                             transition-colors"
                >
                  <Minus size={14} strokeWidth={2.5} />
                </button>

                <span className="text-sm font-bold text-white
                                 tabular-nums select-none min-w-[1.5rem]
                                 text-center">
                  {cartQty}
                </span>

                <button
                  onClick={() => onIncrease(product.id)}
                  aria-label="Add one more to cart"
                  className="w-10 h-full flex items-center justify-center
                             text-white hover:bg-white/20 active:bg-white/30
                             transition-colors"
                >
                  <Plus size={14} strokeWidth={2.5} />
                </button>
              </div>
            )}
          </div>
        )}

        {/* Out-of-stock placeholder */}
        {outOfStock && (
          <button
            disabled
            className="w-full py-2.5 rounded-xl bg-gray-100 text-gray-400
                       text-sm font-semibold cursor-not-allowed mt-1"
          >
            Unavailable
          </button>
        )}
      </div>
    </div>
  );
}

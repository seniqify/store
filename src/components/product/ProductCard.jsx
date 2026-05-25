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
        'bg-white rounded-xl border overflow-hidden flex flex-col w-full',
        'transition-shadow duration-200',
        cartQty > 0
          ? 'border-brand shadow-md shadow-brand/10'
          : 'border-gray-100 shadow-sm hover:shadow-md',
      ].join(' ')}
    >
      {/* ── Image ─────────────────────────────────────────────────────── */}
      <div className="relative aspect-[4/3] bg-gray-100 overflow-hidden flex-shrink-0">

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
            'w-full h-full object-cover',
            'transition-opacity duration-300',
            imgLoaded ? 'opacity-100' : 'opacity-0',
          ].join(' ')}
        />

        {/* Badge top-left */}
        {product.badge && (
          <div className="absolute top-2 left-2">
            <Badge label={product.badge} colorClass={product.badgeColor} />
          </div>
        )}

        {/* Discount chip top-right (only when no badge) */}
        {discount > 0 && !product.badge && (
          <div className="absolute top-2 right-2 bg-green-500 text-white
                          text-[11px] font-bold px-1.5 py-0.5 rounded-md">
            {discount}% off
          </div>
        )}

        {/* In-cart badge bottom-right */}
        {cartQty > 0 && (
          <div className="absolute bottom-2 right-2
                          flex items-center gap-1 bg-brand text-white
                          text-[10px] font-bold px-2 py-0.5 rounded-full">
            <Check size={9} strokeWidth={3} />
            {cartQty}
          </div>
        )}

        {/* Out-of-stock overlay */}
        {outOfStock && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
            <span className="bg-white text-gray-800 text-xs font-semibold
                             px-3 py-1 rounded-full">
              Out of Stock
            </span>
          </div>
        )}
      </div>

      {/* ── Body ──────────────────────────────────────────────────────── */}
      <div className="p-2.5 sm:p-3 flex flex-col flex-1 gap-1.5">

        {/* Product name — always 2 lines reserved so cards align */}
        <h3 className="text-xs sm:text-sm font-semibold text-gray-900
                       line-clamp-2 leading-snug min-h-[2.4rem]">
          {product.name}
        </h3>

        {/* Description — hidden on mobile, shows on sm+ */}
        {product.description && (
          <p className="hidden sm:block text-xs text-gray-400 leading-relaxed line-clamp-2">
            {product.description}
          </p>
        )}

        {/* Size + GSM chips */}
        {(product.size || product.gsm) && (
          <div className="flex flex-wrap gap-1">
            {product.size && (
              <span className="inline-flex items-center gap-0.5 text-[10px] sm:text-xs
                               bg-brand/10 text-brand-dark font-medium
                               px-1.5 py-0.5 rounded-full leading-none">
                <Ruler size={9} />
                {product.size}
              </span>
            )}
            {product.gsm && (
              <span className="text-[10px] sm:text-xs bg-gray-100 text-gray-500
                               font-medium px-1.5 py-0.5 rounded-full leading-none">
                {product.gsm}&nbsp;GSM
              </span>
            )}
          </div>
        )}

        {/* Unit */}
        {product.unit && (
          <p className="text-[10px] sm:text-xs text-gray-400 leading-none">
            {product.unit}
          </p>
        )}

        {/* Price row — pushed to bottom */}
        <div className="flex items-baseline gap-1 mt-auto pt-1">
          <span className="text-sm sm:text-base font-bold text-gray-900 tabular-nums">
            {formatINR(product.price)}
          </span>
          {product.mrp > product.price && (
            <span className="text-[10px] sm:text-xs text-gray-400 line-through tabular-nums">
              {formatINR(product.mrp)}
            </span>
          )}
          {discount > 0 && (
            <span className="text-[10px] sm:text-xs font-semibold text-green-600 ml-auto">
              {discount}% off
            </span>
          )}
        </div>

        {/* ── Action button ─────────────────────────────────────────── */}
        <div className="pt-1">
          {outOfStock ? (
            <button disabled
              className="w-full py-2 rounded-lg bg-gray-100 text-gray-400
                         text-xs font-semibold cursor-not-allowed">
              Unavailable
            </button>
          ) : cartQty === 0 ? (
            <button
              onClick={handleAdd}
              className={[
                'w-full flex items-center justify-center gap-1.5',
                'text-xs sm:text-sm font-semibold py-2 sm:py-2.5 rounded-lg',
                'transition-all duration-200 active:scale-95',
                justAdded
                  ? 'bg-green-500 text-white'
                  : 'bg-brand hover:bg-brand-dark text-white',
              ].join(' ')}
            >
              {justAdded ? (
                <><Check size={13} strokeWidth={3} /> Added!</>
              ) : (
                <><ShoppingCart size={13} /> Add to Cart</>
              )}
            </button>
          ) : (
            <div className="flex items-center justify-between
                            bg-brand rounded-lg overflow-hidden h-9">
              <button onClick={() => onDecrease(product.id)}
                className="w-9 h-full flex items-center justify-center
                           text-white hover:bg-white/20 active:bg-white/30 transition-colors">
                <Minus size={13} strokeWidth={2.5} />
              </button>
              <span className="text-sm font-bold text-white tabular-nums select-none">
                {cartQty}
              </span>
              <button onClick={() => onIncrease(product.id)}
                className="w-9 h-full flex items-center justify-center
                           text-white hover:bg-white/20 active:bg-white/30 transition-colors">
                <Plus size={13} strokeWidth={2.5} />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

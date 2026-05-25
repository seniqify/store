import { useState } from 'react';
import { ShoppingCart, Plus, Minus, Check } from 'lucide-react';
import { formatINR, discountPercent } from '../../utils/currency';

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
  const outOfStock = product.stock === 0;

  function handleAdd() {
    if (outOfStock) return;
    onAddToCart(product, 1);
    setJustAdded(true);
    setTimeout(() => setJustAdded(false), 1000);
  }

  return (
    <div className={[
      'bg-white rounded-xl border flex flex-col overflow-hidden',
      'transition-shadow duration-200',
      cartQty > 0 ? 'border-brand/60 shadow-md' : 'border-gray-100 shadow-sm',
    ].join(' ')}>

      {/* ── Image ─────────────────────────────────────────────────── */}
      <div className="relative w-full aspect-square bg-gray-100 overflow-hidden flex-shrink-0">

        {!imgLoaded && (
          <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-gray-100 to-gray-200" />
        )}

        <img
          src={product.image}
          alt={product.name}
          loading="lazy"
          onLoad={() => setImgLoaded(true)}
          className={[
            'w-full h-full object-cover transition-opacity duration-300',
            imgLoaded ? 'opacity-100' : 'opacity-0',
          ].join(' ')}
        />

        {/* Badge */}
        {product.badge && (
          <span className={[
            'absolute top-1.5 left-1.5 text-white text-[10px] font-bold',
            'px-1.5 py-0.5 rounded-md leading-none',
            product.badgeColor ?? 'bg-brand',
          ].join(' ')}>
            {product.badge}
          </span>
        )}

        {/* Discount chip — only when no badge */}
        {discount > 0 && !product.badge && (
          <span className="absolute top-1.5 left-1.5 bg-green-500 text-white
                           text-[10px] font-bold px-1.5 py-0.5 rounded-md leading-none">
            {discount}% off
          </span>
        )}

        {/* In-cart pill */}
        {cartQty > 0 && (
          <span className="absolute bottom-1.5 right-1.5 bg-brand text-white
                           text-[10px] font-bold px-2 py-0.5 rounded-full
                           flex items-center gap-0.5 leading-none">
            <Check size={8} strokeWidth={3} />
            {cartQty}
          </span>
        )}

        {/* Out-of-stock overlay */}
        {outOfStock && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
            <span className="bg-white text-gray-700 text-[11px] font-semibold
                             px-2.5 py-1 rounded-full">
              Out of Stock
            </span>
          </div>
        )}
      </div>

      {/* ── Info ──────────────────────────────────────────────────── */}
      <div className="p-2 flex flex-col flex-1 gap-1">

        {/* Name — fixed 2-line height keeps grid aligned */}
        <p className="text-[11px] sm:text-xs font-semibold text-gray-800
                      line-clamp-2 leading-snug" style={{ minHeight: '2.4em' }}>
          {product.name}
        </p>

        {/* Unit */}
        {product.unit && (
          <p className="text-[10px] text-gray-400 leading-none">{product.unit}</p>
        )}

        {/* Price */}
        <div className="flex items-baseline gap-1 flex-wrap mt-auto">
          <span className="text-sm font-extrabold text-gray-900 tabular-nums">
            {formatINR(product.price)}
          </span>
          {product.mrp > product.price && (
            <span className="text-[10px] text-gray-400 line-through tabular-nums">
              {formatINR(product.mrp)}
            </span>
          )}
        </div>

        {/* ── Action ────────────────────────────────────────────── */}
        {outOfStock ? (
          <button disabled
            className="w-full mt-1 py-1.5 rounded-lg bg-gray-100
                       text-[11px] font-semibold text-gray-400 cursor-not-allowed">
            Unavailable
          </button>
        ) : cartQty === 0 ? (
          <button
            onClick={handleAdd}
            className={[
              'w-full mt-1 flex items-center justify-center gap-1',
              'text-[11px] sm:text-xs font-bold py-1.5 sm:py-2 rounded-lg',
              'transition-all duration-150 active:scale-95',
              justAdded
                ? 'bg-green-500 text-white'
                : 'bg-brand hover:bg-brand-dark text-white',
            ].join(' ')}
          >
            {justAdded
              ? <><Check size={11} strokeWidth={3} /> Added!</>
              : <><ShoppingCart size={11} /> Add to Cart</>
            }
          </button>
        ) : (
          <div className="w-full mt-1 flex items-center justify-between
                          bg-brand rounded-lg overflow-hidden h-8">
            <button onClick={() => onDecrease(product.id)}
              className="w-8 h-full flex items-center justify-center
                         text-white hover:bg-white/20 active:bg-white/30 transition-colors">
              <Minus size={12} strokeWidth={2.5} />
            </button>
            <span className="text-xs font-bold text-white tabular-nums select-none">
              {cartQty}
            </span>
            <button onClick={() => onIncrease(product.id)}
              className="w-8 h-full flex items-center justify-center
                         text-white hover:bg-white/20 active:bg-white/30 transition-colors">
              <Plus size={12} strokeWidth={2.5} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

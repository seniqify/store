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
  const outOfStock = product.inStock === false || product.stock === 0;
  const inCart     = cartQty > 0;

  function handleAdd() {
    if (outOfStock) return;
    onAddToCart(product, 1);
    setJustAdded(true);
    setTimeout(() => setJustAdded(false), 1000);
  }

  return (
    <div className={[
      'group bg-white rounded-2xl border flex flex-col overflow-hidden min-w-0',
      'transition-all duration-200',
      inCart
        ? 'border-brand/40 ring-1 ring-brand/30 shadow-md'
        : 'border-gray-100 shadow-sm hover:shadow-lg hover:-translate-y-0.5',
    ].join(' ')}>

      {/* ── Image ─────────────────────────────────────────────────── */}
      <div className="relative w-full aspect-square bg-gray-50 overflow-hidden flex-shrink-0">

        {product.image ? (
          <>
            {!imgLoaded && (
              <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-gray-100 to-gray-200" />
            )}
            <img
              src={product.image}
              alt={product.name}
              loading="lazy"
              onLoad={() => setImgLoaded(true)}
              className={[
                'w-full h-full object-cover transition-all duration-500',
                'group-hover:scale-[1.06]',
                imgLoaded ? 'opacity-100' : 'opacity-0',
              ].join(' ')}
            />
          </>
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100">
            <span className="text-4xl opacity-30">📦</span>
          </div>
        )}

        {/* Badge */}
        {product.badge && (
          <span className={[
            'absolute top-2 left-2 text-white text-[10px] font-bold',
            'px-2 py-0.5 rounded-full leading-none shadow-sm',
            product.badgeColor ?? 'bg-brand',
          ].join(' ')}>
            {product.badge}
          </span>
        )}

        {/* Discount chip — only when no badge */}
        {discount > 0 && !product.badge && (
          <span className="absolute top-2 left-2 bg-green-500 text-white
                           text-[10px] font-bold px-2 py-0.5 rounded-full leading-none shadow-sm">
            {discount}% OFF
          </span>
        )}

        {/* In-cart pill */}
        {inCart && !outOfStock && (
          <span className="absolute top-2 right-2 bg-brand text-white
                           text-[10px] font-bold px-2 py-0.5 rounded-full
                           flex items-center gap-0.5 leading-none shadow-sm">
            <Check size={9} strokeWidth={3} />
            {cartQty} in cart
          </span>
        )}

        {/* Out-of-stock overlay */}
        {outOfStock && (
          <div className="absolute inset-0 bg-white/60 backdrop-blur-[1px] flex items-center justify-center">
            <span className="bg-gray-900 text-white text-[11px] font-bold
                             px-3 py-1 rounded-full shadow-sm">
              Out of Stock
            </span>
          </div>
        )}
      </div>

      {/* ── Info ──────────────────────────────────────────────────── */}
      <div className="p-2.5 flex flex-col flex-1 gap-1">

        {/* Name — fixed 2-line height keeps grid aligned */}
        <p className="text-[12px] sm:text-[13px] font-semibold text-gray-800
                      line-clamp-2 leading-snug" style={{ minHeight: '2.5em' }}>
          {product.name}
        </p>

        {/* Unit */}
        {product.unit && (
          <p className="text-[10px] text-gray-400 leading-none">{product.unit}</p>
        )}

        {/* Price */}
        <div className="flex items-baseline gap-1.5 flex-wrap mt-auto pt-0.5">
          <span className="text-base font-extrabold text-gray-900 tabular-nums tracking-tight">
            {formatINR(product.price)}
          </span>
          {product.mrp > product.price && (
            <span className="text-[11px] text-gray-400 line-through tabular-nums">
              {formatINR(product.mrp)}
            </span>
          )}
          {discount > 0 && (
            <span className="text-[10px] font-bold text-green-600 leading-none">
              {discount}% off
            </span>
          )}
        </div>

        {/* ── Action ────────────────────────────────────────────── */}
        {outOfStock ? (
          <button disabled
            className="w-full mt-1.5 py-2 rounded-xl bg-gray-100
                       text-[11px] font-semibold text-gray-400 cursor-not-allowed">
            Unavailable
          </button>
        ) : cartQty === 0 ? (
          <button
            onClick={handleAdd}
            className={[
              'w-full mt-1.5 flex items-center justify-center gap-1.5',
              'text-[11px] sm:text-xs font-bold py-2 sm:py-2.5 rounded-xl',
              'transition-all duration-150 active:scale-95 shadow-sm',
              justAdded
                ? 'bg-green-500 text-white'
                : 'bg-brand hover:bg-brand-dark text-white',
            ].join(' ')}
          >
            {justAdded
              ? <><Check size={13} strokeWidth={3} /> Added!</>
              : <><ShoppingCart size={12} /> Add</>
            }
          </button>
        ) : (
          <div className="w-full mt-1.5 flex items-center justify-between
                          bg-brand rounded-xl overflow-hidden h-9 shadow-sm">
            <button onClick={() => onDecrease(product.id)}
              aria-label="Decrease quantity"
              className="w-9 h-full flex items-center justify-center
                         text-white hover:bg-white/20 active:bg-white/30 transition-colors">
              <Minus size={14} strokeWidth={2.5} />
            </button>
            <span className="text-sm font-bold text-white tabular-nums select-none">
              {cartQty}
            </span>
            <button onClick={() => onIncrease(product.id)}
              aria-label="Increase quantity"
              className="w-9 h-full flex items-center justify-center
                         text-white hover:bg-white/20 active:bg-white/30 transition-colors">
              <Plus size={14} strokeWidth={2.5} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

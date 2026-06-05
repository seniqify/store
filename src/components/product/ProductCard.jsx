import { useState } from 'react';
import { Plus, Minus, Check } from 'lucide-react';
import { formatINR, discountPercent } from '../../utils/currency';
import QtyField from '../cart/QtyField';

export default function ProductCard({
  product,
  cartQty   = 0,
  onAddToCart,
  onIncrease,
  onDecrease,
  onSetQty,
}) {
  const [justAdded, setJustAdded] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);

  const discount   = discountPercent(product.price, product.mrp);
  const saving     = product.mrp > product.price ? product.mrp - product.price : 0;
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
      'group relative bg-white rounded-2xl flex flex-col overflow-hidden min-w-0',
      'transition-all duration-300',
      inCart
        ? 'ring-2 ring-brand shadow-lg shadow-brand/10'
        : 'border border-gray-100 shadow-sm hover:shadow-xl hover:-translate-y-1',
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
                'w-full h-full object-cover transition-all duration-700',
                'group-hover:scale-110',
                imgLoaded ? 'opacity-100' : 'opacity-0',
              ].join(' ')}
            />
          </>
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100">
            <span className="text-4xl opacity-30">📦</span>
          </div>
        )}

        {/* Badge → else discount chip */}
        {product.badge ? (
          <span className={[
            'absolute top-2.5 left-2.5 text-white text-[10px] font-bold',
            'px-2.5 py-1 rounded-full leading-none shadow-md',
            product.badgeColor ?? 'bg-brand',
          ].join(' ')}>
            {product.badge}
          </span>
        ) : discount > 0 ? (
          <span className="absolute top-2.5 left-2.5 bg-rose-500 text-white
                           text-[10px] font-bold px-2.5 py-1 rounded-full leading-none shadow-md">
            {discount}% OFF
          </span>
        ) : null}

        {/* In-cart pill */}
        {inCart && !outOfStock && (
          <span className="absolute top-2.5 right-2.5 bg-brand text-white
                           text-[10px] font-bold px-2 py-1 rounded-full
                           flex items-center gap-0.5 leading-none shadow-md">
            <Check size={9} strokeWidth={3} />
            {cartQty}
          </span>
        )}

        {/* Out-of-stock overlay */}
        {outOfStock && (
          <div className="absolute inset-0 bg-white/70 backdrop-blur-[1px] flex items-center justify-center">
            <span className="bg-gray-900 text-white text-[11px] font-bold
                             px-3 py-1 rounded-full shadow">
              Out of Stock
            </span>
          </div>
        )}
      </div>

      {/* ── Info ──────────────────────────────────────────────────── */}
      <div className="p-3 flex flex-col flex-1 gap-1">

        {/* Name — fixed 2-line height keeps grid aligned */}
        <p className="text-[13px] font-semibold text-gray-800 line-clamp-2 leading-snug"
           style={{ minHeight: '2.5em' }}>
          {product.name}
        </p>

        {/* Unit */}
        {product.unit && (
          <p className="text-[10px] text-gray-400 leading-none">{product.unit}</p>
        )}

        {/* Price */}
        <div className="flex items-baseline gap-1.5 flex-wrap mt-auto pt-1">
          <span className="text-[17px] font-extrabold text-gray-900 tabular-nums tracking-tight">
            {formatINR(product.price)}
          </span>
          {product.mrp > product.price && (
            <span className="text-[11px] text-gray-400 line-through tabular-nums">
              {formatINR(product.mrp)}
            </span>
          )}
        </div>

        {/* Savings line */}
        {saving > 0 && (
          <span className="text-[10px] font-bold text-green-600 leading-none">
            You save {formatINR(saving)}
          </span>
        )}

        {/* ── Action ────────────────────────────────────────────── */}
        {outOfStock ? (
          <button disabled
            className="w-full mt-2 py-2.5 rounded-xl bg-gray-100
                       text-[11px] font-semibold text-gray-400 cursor-not-allowed">
            Unavailable
          </button>
        ) : cartQty === 0 ? (
          <button
            onClick={handleAdd}
            className={[
              'w-full mt-2 flex items-center justify-center gap-1.5',
              'text-xs font-bold py-2.5 rounded-xl',
              'transition-all duration-150 active:scale-95',
              justAdded
                ? 'bg-green-500 text-white shadow-md shadow-green-500/30'
                : 'bg-brand hover:bg-brand-dark text-white shadow-md shadow-brand/25',
            ].join(' ')}
          >
            {justAdded ? (
              <><Check size={13} strokeWidth={3} /> Added!</>
            ) : (
              <>
                <Plus size={14} strokeWidth={2.5} />
                <span className="sm:hidden">Add</span>
                <span className="hidden sm:inline">Add to Cart</span>
              </>
            )}
          </button>
        ) : (
          <div className="w-full mt-2 flex items-center justify-between
                          bg-brand rounded-xl overflow-hidden h-10 shadow-md shadow-brand/25">
            <button onClick={() => onDecrease(product.id)}
              aria-label="Decrease quantity"
              className="w-10 h-full flex items-center justify-center
                         text-white hover:bg-white/20 active:bg-white/30 transition-colors">
              <Minus size={15} strokeWidth={2.5} />
            </button>
            <QtyField
              qty={cartQty}
              onSetQty={(n) => onSetQty(product.id, n)}
              className="w-14 h-7 text-center text-sm font-bold text-white tabular-nums
                         bg-white/20 rounded-md border border-white/40 focus:outline-none focus:bg-white/30"
            />
            <button onClick={() => onIncrease(product.id)}
              aria-label="Increase quantity"
              className="w-10 h-full flex items-center justify-center
                         text-white hover:bg-white/20 active:bg-white/30 transition-colors">
              <Plus size={15} strokeWidth={2.5} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

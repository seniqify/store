import { useState } from 'react';
import { Plus, Minus, Check } from 'lucide-react';
import { formatINR, discountPercent } from '../../utils/currency';
import { variantExtrasOf, resolveSelection } from '../../utils/variants';
import QtyField from '../cart/QtyField';

export default function ProductCard({
  product,
  cartQty   = 0,
  onAddToCart,
  onIncrease,
  onDecrease,
  onSetQty,
  onOpen,          // (id) => void — opens the product page; absent = card not tappable
}) {
  const [justAdded, setJustAdded] = useState(false);
  const openDetail = onOpen ? () => onOpen(product.id) : undefined;
  const [imgLoaded, setImgLoaded] = useState(false);

  // Stock Sense — a numeric `stock` (≥0) turns on live counts; absent/blank = untracked.
  const stockNum    = Number(product.stock);
  const tracksStock = product.stock != null && product.stock !== '' && Number.isFinite(stockNum);
  const outOfStock  = product.inStock === false || (tracksStock && stockNum <= 0);
  const lowStock    = tracksStock && stockNum > 0 && stockNum <= 5;
  const inCart      = cartQty > 0;

  const variants    = product.variants;
  const hasVariants = !!(variants && variants.options && variants.options.length);
  const extras      = variantExtrasOf(product);          // additional choice types (Colour, Pack…)
  const hasOptions  = hasVariants || extras.length > 0;

  const [selVariant, setSelVariant] = useState(hasVariants ? variants.options[0].name : null);
  // One selected option name per extra group, in order.
  const [selExtras, setSelExtras]   = useState(extras.map((g) => g.options.find((o) => o.name)?.name));

  // Price, MRP/discount AND image all follow the full selection (the price-driving
  // variant sets the base + photo; each extra adds its optional +₹). Resolved in
  // one place so the shown price never disagrees with what lands in the cart.
  const { price: displayPrice, mrp: displayMrp, image: displayImage, picks } =
    resolveSelection(product, selVariant, selExtras);
  const discount = discountPercent(displayPrice, displayMrp);
  const saving   = displayMrp && displayMrp > displayPrice ? displayMrp - displayPrice : 0;

  function handleAdd() {
    if (outOfStock) return;
    if (hasOptions) {
      onAddToCart({
        ...product,
        id:            `${product.id}::${picks.map((p) => p.name).join('::')}`,
        variant:       picks.map((p) => p.name).join(', '),   // readable → WhatsApp / slip / order
        variantLabel:  picks.length === 1 ? picks[0].label : undefined,
        variantSelections: picks,                             // [{label,name}] → cart chips
        image:         displayImage,                          // cart line shows the chosen photo
        price:         displayPrice,
        mrp:           displayMrp != null ? displayMrp : undefined,
      }, 1);
    } else {
      onAddToCart(product, 1);
    }
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
      <div onClick={openDetail}
           role={openDetail ? 'button' : undefined}
           aria-label={openDetail ? `View ${product.name}` : undefined}
           className={['relative w-full aspect-square bg-gray-50 overflow-hidden flex-shrink-0', openDetail ? 'cursor-pointer' : ''].join(' ')}>

        {displayImage ? (
          <>
            {!imgLoaded && (
              <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-gray-100 to-gray-200" />
            )}
            <img
              src={displayImage}
              alt={product.name}
              loading="lazy"
              onLoad={() => setImgLoaded(true)}
              className={[
                // contain, never cover: product shots must show the WHOLE
                // product — cover was slicing the tops off tall photos.
                'w-full h-full object-contain transition-all duration-700',
                'group-hover:scale-105',
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
        <p onClick={openDetail}
           className={['text-[13px] font-semibold text-gray-800 line-clamp-2 leading-snug', openDetail ? 'cursor-pointer hover:text-brand-dark transition-colors' : ''].join(' ')}
           style={{ minHeight: '2.5em' }}>
          {product.name}
        </p>

        {/* Unit — hidden when the product has variants (the size chip already
            states the quantity, so "per kg" next to a 250 gm option misleads). */}
        {product.unit && !hasVariants && (
          <p className="text-[10px] text-gray-400 leading-none">{product.unit}</p>
        )}

        {/* Attributes (e.g. Eggless · Chocolate) — one compact line */}
        {Array.isArray(product.attributes) && product.attributes.length > 0 && (
          <p className="text-[10px] text-gray-400 leading-tight line-clamp-1">
            {product.attributes.map((a) => a.value).filter(Boolean).slice(0, 3).join(' · ')}
          </p>
        )}

        {/* Description — short blurb the owner typed (was captured but never shown) */}
        {product.description && (
          <p className="text-[11px] text-gray-500 leading-snug line-clamp-2">
            {product.description}
          </p>
        )}

        {/* Price — MRP strike-through reflects the selected variant's own MRP */}
        <div className="flex items-baseline gap-1.5 flex-wrap mt-auto pt-1">
          <span className="text-[17px] font-extrabold text-gray-900 tabular-nums tracking-tight">
            {formatINR(displayPrice)}
          </span>
          {displayMrp && displayMrp > displayPrice && (
            <span className="text-[11px] text-gray-400 line-through tabular-nums">
              {formatINR(displayMrp)}
            </span>
          )}
        </div>

        {/* Savings line */}
        {saving > 0 && (
          <span className="text-[10px] font-bold text-green-600 leading-none">
            You save {formatINR(saving)}
          </span>
        )}

        {/* Low-stock urgency — nudges the customer while it's honestly true */}
        {lowStock && !outOfStock && (
          <span className="text-[10px] font-bold text-amber-600 leading-none">
            🔥 Only {stockNum} left!
          </span>
        )}

        {/* ── Action ────────────────────────────────────────────── */}
        {outOfStock ? (
          <button disabled
            className="w-full mt-2 py-2.5 rounded-xl bg-gray-100
                       text-[11px] font-semibold text-gray-400 cursor-not-allowed">
            Unavailable
          </button>
        ) : hasOptions ? (
          <div className="mt-2">
            {/* Price-driving type (Size/Weight) — its pick sets the base price + photo */}
            {hasVariants && (
              <div className="mb-2">
                <p className="text-[10px] font-semibold text-gray-400 mb-1">{variants.label}</p>
                <div className="flex flex-wrap gap-1">
                  {variants.options.map((o) => (
                    <button key={o.name} type="button" onClick={() => setSelVariant(o.name)}
                      className={[
                        'px-2 py-1 rounded-lg text-[11px] font-semibold border transition active:scale-95',
                        'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
                        selVariant === o.name ? 'bg-brand text-white border-transparent' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300',
                      ].join(' ')}>
                      {o.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {/* Extra choice types (Colour, Pack…) — each option an optional +₹ */}
            {extras.map((g, gi) => {
              const opts = g.options.filter((o) => o.name);
              const cur  = selExtras[gi] ?? opts[0]?.name;
              return (
                <div key={`${g.label}-${gi}`} className="mb-2">
                  <p className="text-[10px] font-semibold text-gray-400 mb-1">{g.label}</p>
                  <div className="flex flex-wrap gap-1">
                    {opts.map((o) => (
                      <button key={o.name} type="button"
                        onClick={() => setSelExtras((prev) => prev.map((x, idx) => idx === gi ? o.name : x))}
                        className={[
                          'px-2 py-1 rounded-lg text-[11px] font-semibold border transition active:scale-95',
                          'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
                          cur === o.name ? 'bg-brand text-white border-transparent' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300',
                        ].join(' ')}>
                        {o.name}{Number(o.addPrice) ? ` +${formatINR(Number(o.addPrice))}` : ''}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
            <button onClick={handleAdd}
              className={[
                'w-full flex items-center justify-center gap-1.5 text-xs font-bold py-2.5 rounded-xl transition-all duration-150 active:scale-95',
                justAdded ? 'bg-green-500 text-white shadow-md shadow-green-500/30' : 'bg-brand hover:bg-brand-dark text-white shadow-md shadow-brand/25',
              ].join(' ')}>
              {justAdded
                ? <><Check size={13} strokeWidth={3} /> Added!</>
                : <><Plus size={14} strokeWidth={2.5} /> {cartQty > 0 ? `Add · ${cartQty} in cart` : 'Add'}</>}
            </button>
          </div>
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

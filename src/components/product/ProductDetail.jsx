import { useState, useRef, useEffect } from 'react';
import { ArrowLeft, Share2, Plus, Check, Star, ChevronDown, Truck, ShieldCheck, Wallet, MessageCircle } from 'lucide-react';
import { formatINR, discountPercent } from '../../utils/currency';
import { variantExtrasOf, resolveSelection, buildCartItem } from '../../utils/variants';
import { useScrollLock } from '../../hooks/useScrollLock';
import { pixelTrack } from '../../utils/metaPixel';

/**
 * ProductDetail — full-screen product page (opened from a card at /{slug}/p/{id}).
 * Reuses the exact pricing/selection logic + cart-line shape as the card, so a
 * product added here is identical to one added from the grid. Shows the roomier
 * view: big image, full description, highlight tiles (from attributes), the
 * pack/variant pickers, the store rating, a share action, and a sticky buy bar.
 */
export default function ProductDetail({ product, onClose, onAddToCart, onViewCart, rating, itemCount = 0, premium = false, config = {} }) {
  useScrollLock(true);   // freeze the store page behind the full-screen product view

  // Premium Dark: a trust-badge row of REAL storefront facts (not invented product
  // claims). Delivery time comes from the store's own settings when set.
  const deliveryEta = config?.delivery?.eta || '';
  const trustBadges = [
    { Icon: Wallet,         t: 'COD',        s: 'Available' },
    { Icon: Truck,          t: 'Delivery',   s: deliveryEta ? deliveryEta.slice(0, 12) : 'Fast & safe' },
    { Icon: ShieldCheck,    t: 'Secure',     s: 'Checkout' },
    { Icon: MessageCircle,  t: 'WhatsApp',   s: 'Support' },
  ];

  // Report the product view to the store's Meta Pixel (no-op without a pixel).
  useEffect(() => {
    pixelTrack('ViewContent', {
      content_name: product?.name,
      content_ids:  product?.id != null ? [String(product.id)] : undefined,
      content_type: 'product',
      value:        Number(product?.price) || 0,
      currency:     'INR',
    });
  }, [product?.id]);

  const variants    = product.variants;
  const hasVariants = !!(variants && variants.options && variants.options.length);
  const extras      = variantExtrasOf(product);
  const hasOptions  = hasVariants || extras.length > 0;

  const [selVariant, setSelVariant] = useState(hasVariants ? variants.options[0].name : null);
  const [selExtras,  setSelExtras]  = useState(extras.map((g) => g.options.find((o) => o.name)?.name));
  const [added,  setAdded]  = useState(false);
  const [shared, setShared] = useState(false);

  const { price, mrp, image } = resolveSelection(product, selVariant, selExtras);

  // Gallery = the selected image (follows a variant photo) + the main image + any
  // extra photos, de-duped. Swipeable; the active dot tracks the scroll position.
  const gallery = [...new Set([image, product.image, ...(Array.isArray(product.images) ? product.images : [])].filter(Boolean))];
  const [imgIdx, setImgIdx] = useState(0);
  const galleryRef = useRef(null);
  const onGalleryScroll = () => {
    const el = galleryRef.current;
    if (el && el.clientWidth) setImgIdx(Math.round(el.scrollLeft / el.clientWidth));
  };

  const off        = discountPercent(price, mrp);
  const saving     = mrp && mrp > price ? mrp - price : 0;
  const stockNum    = Number(product.stock);
  const tracksStock = product.stock != null && product.stock !== '' && Number.isFinite(stockNum);
  const outOfStock  = product.inStock === false || (tracksStock && stockNum <= 0);
  const lowStock    = tracksStock && stockNum > 0 && stockNum <= 5;
  const attrs      = Array.isArray(product.attributes) ? product.attributes.filter((a) => a && a.value) : [];
  const descOpen   = useDisclosure(true);

  function handleAdd() {
    if (outOfStock) return;
    onAddToCart(hasOptions ? buildCartItem(product, selVariant, selExtras) : product, 1);
    setAdded(true);
    setTimeout(() => setAdded(false), 1500);
  }

  async function handleShare() {
    const url = typeof window !== 'undefined' ? window.location.href : '';
    try {
      if (navigator.share) { await navigator.share({ title: product.name, url }); return; }
    } catch { /* user cancelled — fall through to copy */ }
    try { await navigator.clipboard.writeText(url); setShared(true); setTimeout(() => setShared(false), 1800); } catch { /* ignore */ }
  }

  const chipBtn = (active) => [
    'px-3 py-2 rounded-xl text-[13px] font-bold border transition active:scale-95 text-left leading-tight',
    'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
    active ? 'bg-brand text-white border-transparent' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300',
  ].join(' ');

  return (
    <div className="fixed inset-0 z-[60] bg-white flex flex-col" role="dialog" aria-label={product.name}>

      {/* Top bar */}
      <div className="flex-shrink-0 flex items-center justify-between px-3 py-2.5 border-b border-gray-100 bg-white">
        <button type="button" onClick={onClose} aria-label="Back"
                className="w-9 h-9 rounded-full flex items-center justify-center text-gray-600 hover:bg-gray-100 transition-colors">
          <ArrowLeft size={20} />
        </button>
        <p className="text-sm font-semibold text-gray-800 truncate px-2">{product.name}</p>
        <button type="button" onClick={handleShare} aria-label="Share product"
                className="w-9 h-9 rounded-full flex items-center justify-center text-gray-600 hover:bg-gray-100 transition-colors relative">
          {shared ? <Check size={18} className="text-green-500" /> : <Share2 size={17} />}
        </button>
      </div>

      {/* Scroll body */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        <div className="max-w-lg mx-auto w-full">

          {/* Image gallery — swipeable when there's more than one photo */}
          <div className="relative w-full aspect-square bg-gray-50">
            {gallery.length > 0 ? (
              <div ref={galleryRef} onScroll={onGalleryScroll}
                   className="flex w-full h-full overflow-x-auto overflow-y-hidden snap-x snap-mandatory scrollbar-hide">
                {gallery.map((src, i) => (
                  <img key={i} src={src} alt={`${product.name} — photo ${i + 1}`}
                       className="w-full h-full flex-shrink-0 object-contain snap-center" />
                ))}
              </div>
            ) : (
              <div className="w-full h-full flex items-center justify-center text-gray-300 text-5xl">🛍️</div>
            )}

            {gallery.length > 1 && (
              <>
                <div className="absolute top-3 right-3 text-[11px] font-semibold text-white bg-black/45 px-2 py-0.5 rounded-full pointer-events-none">
                  {imgIdx + 1} / {gallery.length}
                </div>
                <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-1.5 pointer-events-none">
                  {gallery.map((_, i) => (
                    <span key={i} className={['h-1.5 rounded-full transition-all', i === imgIdx ? 'w-4 bg-gray-800' : 'w-1.5 bg-gray-300'].join(' ')} />
                  ))}
                </div>
              </>
            )}

            {off > 0 && (
              <span className={['absolute top-3 left-3 text-[11px] font-extrabold text-white px-2.5 py-1 rounded-full shadow', premium ? 'bg-brand' : 'bg-rose-500'].join(' ')}>
                Sale
              </span>
            )}
            {outOfStock && (
              <div className="absolute inset-0 bg-white/70 backdrop-blur-[1px] flex items-center justify-center">
                <span className="bg-gray-900 text-white text-xs font-bold px-3 py-1 rounded-full">Out of Stock</span>
              </div>
            )}
          </div>

          <div className="px-4 py-4 flex flex-col gap-4 pb-8">

            {/* Meta row */}
            <div className="flex items-center gap-2 flex-wrap">
              {product.badge && (
                <span className="text-[11px] font-bold px-2 py-1 rounded-lg bg-brand/10 text-brand-dark">{product.badge}</span>
              )}
              {rating?.count > 0 && (
                <span className="ml-auto inline-flex items-center gap-1 text-xs font-bold text-gray-700">
                  <Star size={13} className="text-amber-400 fill-amber-400" />
                  {rating.avg} <span className="text-gray-400 font-semibold">({rating.count})</span>
                </span>
              )}
            </div>

            <div>
              <h1 className="text-xl font-extrabold text-gray-900 leading-tight">{product.name}</h1>
              {product.unit && !hasVariants && <p className="text-xs text-gray-400 mt-0.5">{product.unit}</p>}
            </div>

            {/* Price — same structure everywhere: price, MRP, % OFF chip, saving.
                Only the colour differs by theme. */}
            <div className="flex items-baseline gap-2.5 flex-wrap">
              <span className={['text-[26px] font-extrabold tabular-nums tracking-tight', premium ? 'text-brand' : 'text-gray-900'].join(' ')}>{formatINR(price)}</span>
              {mrp && mrp > price && <span className="text-sm text-gray-400 line-through tabular-nums">{formatINR(mrp)}</span>}
              {off > 0 && <span className="text-[12px] font-extrabold text-brand bg-brand/10 rounded-md px-2 py-0.5">{off}% OFF</span>}
              {saving > 0 && <span className="w-full text-[13px] font-bold text-green-600">You save {formatINR(saving)}</span>}
              {lowStock && !outOfStock && <span className="w-full text-[13px] font-bold text-amber-600">🔥 Hurry — only {stockNum} left in stock!</span>}
            </div>

            {/* Trust badges — real storefront facts, shown on every store */}
            <div className="grid grid-cols-4 gap-2">
              {trustBadges.map(({ Icon, t, s }) => (
                <div key={t} className="bg-white border border-gray-100 rounded-xl px-2 py-2.5 text-center">
                  <Icon size={17} className="mx-auto text-brand mb-1.5" />
                  <p className="text-[10px] font-bold text-gray-800 leading-tight">{t}</p>
                  <p className="text-[9px] text-gray-400 leading-tight">{s}</p>
                </div>
              ))}
            </div>

            {/* Priced variant type */}
            {hasVariants && (
              <div className="flex flex-col gap-1.5">
                <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">{variants.label}</p>
                <div className="flex flex-wrap gap-2">
                  {variants.options.map((o) => (
                    <button key={o.name} type="button" onClick={() => setSelVariant(o.name)} className={chipBtn(selVariant === o.name)}>
                      {o.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Extra option types */}
            {extras.map((g, gi) => {
              const opts = g.options.filter((o) => o.name);
              const cur  = selExtras[gi] ?? opts[0]?.name;
              return (
                <div key={`${g.label}-${gi}`} className="flex flex-col gap-1.5">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">{g.label}</p>
                  <div className="flex flex-wrap gap-2">
                    {opts.map((o) => (
                      <button key={o.name} type="button"
                              onClick={() => setSelExtras((prev) => prev.map((x, idx) => (idx === gi ? o.name : x)))}
                              className={chipBtn(cur === o.name)}>
                        {o.name}{Number(o.addPrice) ? ` +${formatINR(Number(o.addPrice))}` : ''}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}

            {/* Description */}
            {product.description && (
              <div className="border border-gray-100 rounded-2xl overflow-hidden">
                <button type="button" onClick={descOpen.toggle} aria-expanded={descOpen.open}
                        className="w-full flex items-center justify-between px-4 py-3 text-[13.5px] font-bold text-gray-800">
                  About this product
                  <ChevronDown size={16} className={`text-gray-400 transition-transform ${descOpen.open ? 'rotate-180' : ''}`} />
                </button>
                {descOpen.open && (
                  <p className="px-4 pb-4 -mt-1 text-sm text-gray-500 leading-relaxed">{product.description}</p>
                )}
              </div>
            )}

            {/* Highlights (from attributes) — one tick checklist for every store */}
            {attrs.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Highlights</p>
                <div className="flex flex-col gap-2.5 mt-0.5">
                  {attrs.map((a, i) => (
                    <div key={`${a.key || a.label}-${i}`} className="flex items-center gap-2.5 text-sm font-semibold text-gray-700">
                      <Check size={16} strokeWidth={3} className="text-brand flex-shrink-0" />
                      <span>{a.label && <span className="text-gray-400 font-medium">{a.label}: </span>}{a.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Store rating */}
            {rating?.count > 0 && (
              <div className="flex items-center gap-3 border border-gray-100 rounded-2xl px-4 py-3">
                <div className="text-2xl font-extrabold text-gray-900 tabular-nums leading-none">{rating.avg}</div>
                <div>
                  <div className="flex gap-0.5">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <Star key={n} size={13} className={n <= Math.round(rating.avg) ? 'text-amber-400 fill-amber-400' : 'text-gray-200 fill-gray-200'} />
                    ))}
                  </div>
                  <p className="text-[11px] text-gray-400 mt-0.5">Store rating · {rating.count} review{rating.count === 1 ? '' : 's'}</p>
                </div>
              </div>
            )}

          </div>
        </div>
      </div>

      {/* Sticky buy bar */}
      <div className="flex-shrink-0 flex items-center gap-3 px-4 py-3 border-t border-gray-100 bg-white/95 backdrop-blur">
        <div className="flex flex-col leading-none">
          <span className={['text-lg font-extrabold tabular-nums', premium ? 'text-brand' : 'text-gray-900'].join(' ')}>{formatINR(price)}</span>
          <span className="text-[10px] text-gray-400 font-semibold mt-0.5">Incl. all taxes</span>
        </div>
        {itemCount > 0 && (
          <button type="button" onClick={onViewCart}
                  className="ml-auto px-3 py-3 rounded-xl border border-gray-200 text-sm font-bold text-brand-dark hover:bg-gray-50 transition-colors">
            Cart · {itemCount}
          </button>
        )}
        <button type="button" onClick={handleAdd} disabled={outOfStock}
                className={[
                  itemCount > 0 ? 'flex-1 max-w-[220px]' : 'ml-auto flex-1 max-w-[280px]',
                  'flex items-center justify-center gap-2 py-3 rounded-xl font-extrabold text-sm text-white transition-all active:scale-95',
                  outOfStock ? 'bg-gray-300 cursor-not-allowed' : added ? 'bg-green-500' : 'bg-brand hover:bg-brand-dark shadow-md shadow-brand/25',
                ].join(' ')}>
          {outOfStock ? 'Unavailable' : added ? <><Check size={17} strokeWidth={3} /> Added</> : <><Plus size={17} strokeWidth={2.5} /> Add to cart</>}
        </button>
      </div>
    </div>
  );
}

// Tiny local disclosure helper (avoids repeating open/toggle state).
function useDisclosure(initial) {
  const [open, setOpen] = useState(initial);
  return { open, toggle: () => setOpen((v) => !v) };
}

import { Truck, Tag, ChevronRight, ShoppingBag, Sparkles, Package } from 'lucide-react';
import { formatINR, calcCartTotals } from '../../utils/currency';
import { isValidUpiVpa } from '../../utils/upiLink';
import { useBusinessConfig } from '../../contexts/BusinessContext';
import Button from '../ui/Button';

/**
 * CartSummary
 * ───────────���─────────────────────────────��──────────────────────────────────
 * Reusable, self-contained order summary block.
 *
 * Used in:
 *   CartSidebar  — full version with all line items + checkout CTA
 *   Home sidebar — compact version (fewer rows, "View Cart" CTA)
 *
 * Props:
 *   cart        CartItem[]            — the current cart array
 *   onCheckout  () => void | null     — when provided, shows a CTA button
 *   compact     boolean               — hides secondary rows (savings, tax, delivery)
 *   ctaLabel    string                — override the CTA button label
 */
export default function CartSummary({
  cart,
  onCheckout,
  compact = false,
  ctaLabel,
}) {
  const config = useBusinessConfig();
  const { subtotal, savings, tax, shipping, packaging, total, taxInclusive, taxUniformPct } = calcCartTotals(cart, config.cart);
  const { cart: cartConfig, upi } = config;

  const itemCount = cart.reduce((sum, i) => sum + i.qty, 0);
  const isEmpty   = cart.length === 0;

  // A free-delivery offer only exists when there's a positive threshold AND a
  // delivery fee to waive. Threshold 0 = no offer (always charge), so we must
  // not show "free delivery above ₹0" / "you qualify for free delivery".
  const hasFreeOffer = Number(cartConfig?.freeShippingAbove) > 0 && Number(cartConfig?.shippingCharge) > 0;

  // Always reassure the customer when to expect their order — they can't see the
  // courier/shipping step. Restaurants deliver hot food same-day, so they default
  // to minutes, not the pan-India courier's 3–5 days. A store can override either
  // via cart.deliveryEstimate (e.g. "Same day" for local delivery).
  const isRestaurant     = config.businessType === 'restaurant';
  const defaultEstimate  = isRestaurant ? '30–45 min' : '3–5 days';
  const deliveryEstimate = String(cartConfig?.deliveryEstimate || defaultEstimate).trim();

  if (isEmpty) return null;   // nothing to summarize

  const defaultCta = compact ? 'View Cart →' : 'Proceed to Checkout →';

  return (
    <div className="space-y-3">

      {/* ── Line items ───���─────────────────────────────────────────────── */}
      <div className="space-y-2 text-sm">

        {/* Subtotal */}
        <div className="flex items-center justify-between text-gray-600">
          <span>
            Subtotal
            <span className="text-gray-400 font-normal ml-1">
              ({itemCount} {itemCount === 1 ? 'item' : 'items'})
            </span>
          </span>
          <span className="font-semibold text-gray-900 tabular-nums">
            {formatINR(subtotal)}
          </span>
        </div>

        {/* Savings row — only when there is a real discount and not compact */}
        {!compact && savings > 0 && (
          <div className="flex items-center justify-between text-green-700">
            <span className="flex items-center gap-1">
              <Sparkles size={13} className="text-green-500" />
              You save
            </span>
            <span className="font-semibold tabular-nums">
              − {formatINR(savings)}
            </span>
          </div>
        )}

        {/* GST — shown only when there's tax. The % is dropped when the cart
            mixes rates. Inclusive mode shows it as "incl." (not added). */}
        {!compact && tax > 0 && (
          <div className="flex items-center justify-between text-gray-500">
            <span>GST{taxUniformPct != null ? ` (${taxUniformPct}%)` : ''}{taxInclusive ? ' · incl.' : ''}</span>
            <span className="font-medium text-gray-700 tabular-nums">
              {formatINR(tax)}
            </span>
          </div>
        )}

        {/* Packaging — flat charge on every order (COD fee is added later, at
            checkout, once the customer picks a payment method) */}
        {!compact && packaging > 0 && (
          <div className="flex items-center justify-between text-gray-500">
            <span className="flex items-center gap-1">
              <Package size={13} />
              Packaging
            </span>
            <span className="font-semibold tabular-nums text-gray-700">{formatINR(packaging)}</span>
          </div>
        )}

        {/* Delivery */}
        {!compact && (
          <div className="flex items-center justify-between text-gray-500">
            <span className="flex items-center gap-1">
              <Truck size={13} />
              Delivery
            </span>
            <span
              className={[
                'font-semibold tabular-nums',
                shipping === 0 ? 'text-green-600' : 'text-gray-700',
              ].join(' ')}
            >
              {shipping === 0 ? 'FREE' : formatINR(shipping)}
            </span>
          </div>
        )}
      </div>

      {/* ── Grand total ────���──────────────────��─────────────────────────── */}
      <div
        className={[
          'flex items-center justify-between',
          'border-t border-dashed border-gray-200 pt-3',
        ].join(' ')}
      >
        <span className="font-bold text-gray-900">
          {compact ? 'Total' : 'Grand Total'}
        </span>
        <div className="text-right">
          <span className="font-extrabold text-lg text-brand-dark tabular-nums">
            {formatINR(total)}
          </span>
          {!compact && savings > 0 && (
            <p className="text-xs text-green-600 font-medium leading-none mt-0.5">
              You save {formatINR(savings)} 🎉
            </p>
          )}
        </div>
      </div>

      {/* ── Delivery-time estimate — always shown so the customer knows when
             the order will arrive (independent of the delivery fee) ──────── */}
      <div className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2 text-xs text-gray-600">
        <Truck size={13} className="text-gray-400 flex-shrink-0" />
        <span>
          Estimated delivery in{' '}
          <strong className="font-semibold text-gray-800">{deliveryEstimate}</strong>
        </span>
      </div>

      {/* ── Free-shipping progress (full only, only when an offer exists) ── */}
      {!compact && hasFreeOffer && subtotal < cartConfig.freeShippingAbove && (
        <div className="bg-brand/8 rounded-xl px-3 py-2.5">
          <div className="flex items-center justify-between mb-1.5">
            <span className="flex items-center gap-1 text-xs text-brand-dark font-medium">
              <Truck size={12} />
              Free delivery at ₹{cartConfig.freeShippingAbove}
            </span>
            <span className="text-xs text-brand font-semibold">
              ₹{cartConfig.freeShippingAbove - subtotal} away
            </span>
          </div>
          <div className="w-full h-1.5 bg-brand/20 rounded-full overflow-hidden">
            <div
              className="h-full bg-brand rounded-full transition-all duration-500"
              style={{
                width: `${Math.min((subtotal / cartConfig.freeShippingAbove) * 100, 100)}%`,
              }}
            />
          </div>
        </div>
      )}

      {!compact && hasFreeOffer && subtotal >= cartConfig.freeShippingAbove && (
        <div className="flex items-center gap-2 bg-green-50 rounded-xl px-3 py-2 text-xs text-green-700 font-medium">
          <Truck size={13} className="text-green-500 flex-shrink-0" />
          🎉 You qualify for FREE delivery!
        </div>
      )}

      {/* ── UPI hint (full only, only when a valid UPI ID is configured) ── */}
      {!compact && isValidUpiVpa(upi) && (
        <div className="flex items-center gap-2 bg-blue-50 rounded-xl px-3 py-2.5 text-xs text-blue-700 overflow-hidden">
          <Tag size={13} className="flex-shrink-0 text-blue-500" />
          <span className="min-w-0">
            Pay via UPI:&nbsp;
            <strong className="text-blue-800 break-all">{upi}</strong>
          </span>
        </div>
      )}

      {/* ── CTA button ──���──────────────────────────────────────────────── */}
      {onCheckout && (
        <Button
          variant="primary"
          size={compact ? 'md' : 'lg'}
          fullWidth
          onClick={onCheckout}
        >
          {compact ? (
            <>
              <ShoppingBag size={16} />
              {ctaLabel ?? defaultCta}
            </>
          ) : (
            <>
              {ctaLabel ?? defaultCta}
              <ChevronRight size={16} />
            </>
          )}
        </Button>
      )}
    </div>
  );
}

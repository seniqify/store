import { ShoppingCart, Phone, MessageCircle } from 'lucide-react';
import { useBusinessConfig } from '../../contexts/BusinessContext';
import { whatsappLink } from '../../utils/theme';

/**
 * Header — reads the active business config from context.
 * No props needed for business data; only cart state comes from outside.
 */
export default function Header({ cartCount = 0, onCartOpen }) {
  const { businessName, tagline, logo, logoEmoji, phone, whatsappNumber, cart, gst, businessType } = useBusinessConfig();
  const waLink = whatsappLink(whatsappNumber, businessName);

  // Top-strip message adapts to the business type (default: product store).
  const infoStrip = {
    service: '💬 Free consultation on WhatsApp',
  }[businessType] ?? `🚚 Free delivery above ₹${cart.freeShippingAbove}`;

  return (
    <header className="bg-white border-b border-gray-100 sticky top-0 z-50 w-full overflow-hidden">

      {/* ── Top info strip ────────────────────────────────────────────────── */}
      <div className="bg-brand text-white w-full">
        <div className="w-full max-w-7xl mx-auto px-3 sm:px-4 py-1.5
                        flex items-center justify-between gap-2 text-xs overflow-hidden">
          <a
            href={`tel:${phone}`}
            className="flex items-center gap-1 opacity-90 hover:opacity-100
                       hover:underline transition-opacity flex-shrink-0 min-w-0 truncate"
          >
            <Phone size={10} className="flex-shrink-0" />
            <span className="truncate">{phone}</span>
          </a>

          <span className="font-medium text-center flex-shrink-0 text-[11px] sm:text-xs">
            {infoStrip}
          </span>

          {gst && <span className="hidden sm:block opacity-75 truncate">{gst}</span>}
        </div>
      </div>

      {/* ── Main row ─────────────────────────────────────────────────────── */}
      <div className="w-full max-w-7xl mx-auto px-3 sm:px-4 h-14 flex items-center gap-3 overflow-hidden">

        {/* Logo + name */}
        <div className="flex items-center gap-2.5 flex-shrink-0">
          {logo ? (
            <img src={logo} alt={name} className="w-8 h-8 rounded-xl object-contain" />
          ) : (
            <div className="w-8 h-8 bg-brand rounded-xl flex items-center justify-center
                            text-base shadow-sm flex-shrink-0 select-none">
              {logoEmoji}
            </div>
          )}
          <div>
            <p className="font-bold text-gray-900 text-[15px] leading-none">{businessName}</p>
            <p className="text-[11px] text-gray-400 leading-none mt-0.5 hidden sm:block">
              {tagline}
            </p>
          </div>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* WhatsApp CTA — hidden on xs */}
        <a
          href={waLink}
          target="_blank"
          rel="noopener noreferrer"
          className="hidden sm:flex items-center gap-1.5
                     bg-[#25D366] hover:bg-[#1ebe5d] active:bg-[#17a550]
                     text-white text-xs font-semibold
                     px-3.5 py-2 rounded-xl shadow-sm
                     transition-colors duration-150 active:scale-95"
          aria-label="Chat on WhatsApp"
        >
          <MessageCircle size={14} />
          WhatsApp
        </a>

        {/* Cart button */}
        <button
          onClick={onCartOpen}
          aria-label={`Open cart${cartCount ? ` — ${cartCount} item${cartCount > 1 ? 's' : ''}` : ''}`}
          className="relative flex items-center gap-2
                     bg-brand hover:bg-brand-dark active:bg-brand-dark
                     text-white font-semibold text-sm
                     px-4 py-2 h-9 rounded-xl shadow-sm
                     transition-all duration-150 active:scale-95"
        >
          <ShoppingCart size={17} />
          <span className="hidden sm:inline">Cart</span>

          {cartCount > 0 && (
            <span
              className="absolute -top-1.5 -right-1.5
                         min-w-[18px] h-[18px] px-1
                         bg-red-500 text-white text-[10px] font-bold
                         rounded-full flex items-center justify-center
                         border-2 border-white"
            >
              {cartCount > 99 ? '99+' : cartCount}
            </span>
          )}
        </button>
      </div>
    </header>
  );
}

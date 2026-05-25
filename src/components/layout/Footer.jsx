import { useState } from 'react';
import { MessageCircle, Copy, Check, Phone, MapPin, Receipt } from 'lucide-react';
import { useBusinessConfig } from '../../contexts/BusinessContext';
import { whatsappLink } from '../../utils/theme';

/**
 * Footer — reads the active business config from context.
 *
 * Columns (all optional / conditional):
 *   1. Brand — logo, tagline, WhatsApp CTA
 *   2. Categories — product category list
 *   3. Payment Details — UPI ID + Bank Transfer with copy buttons  ← replaces "Contact Us"
 *   4. Quick Info — delivery threshold, GST, returns
 *
 * Phone is already shown in the Header top-strip; it is NOT repeated here.
 */

// ── Copy button: copies text, shows a "Copied ✓" flash for 1.5 s ──────────
function CopyBtn({ text, label }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={`Copy ${label}`}
      className={[
        'inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-lg',
        'transition-all duration-150 flex-shrink-0',
        copied
          ? 'bg-green-500/20 text-green-400'
          : 'bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white',
      ].join(' ')}
    >
      {copied ? <Check size={10} strokeWidth={3} /> : <Copy size={10} />}
      {copied ? 'Copied!' : 'Copy'}
    </button>
  );
}

// ── A single copyable row ─────────────────────────────────────────────────────
function PayRow({ label, value, mono = false }) {
  return (
    <li className="flex items-center justify-between gap-3 py-1.5
                   border-b border-gray-800/60 last:border-0">
      <span className="text-xs text-gray-500 flex-shrink-0 w-20">{label}</span>
      <span className={[
        'text-xs text-gray-200 flex-1 min-w-0 truncate',
        mono ? 'font-mono tracking-wide' : 'font-medium',
      ].join(' ')}>
        {value}
      </span>
      <CopyBtn text={value} label={label} />
    </li>
  );
}

export default function Footer() {
  const config = useBusinessConfig();
  const {
    businessName, tagline, logoEmoji, logo,
    whatsappNumber, phone, address, upi, bank, gst, cart,
  } = config;

  const waLink = whatsappLink(whatsappNumber, businessName);

  const hasUpi            = Boolean(upi);
  const hasBank           = Boolean(bank?.accountNumber);
  const hasPaymentDetails = hasUpi || hasBank;
  const hasBusinessInfo   = Boolean(phone || address || gst);

  // Always 3 columns: Brand | Business Details | Payment Details | Quick Info
  // Drop to 3 when payment details are absent, 2 when both optional cols absent
  const gridCls = hasPaymentDetails
    ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4'
    : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3';

  return (
    <footer className="bg-gray-900 text-gray-300 mt-16">
      <div className={`max-w-7xl mx-auto px-4 py-10 grid gap-8 ${gridCls}`}>

        {/* ── 1. Brand ──────────────────────────────────────────────────── */}
        <div className="lg:col-span-1">
          <div className="flex items-center gap-2 mb-3">
            {logo ? (
              <img src={logo} alt={businessName} className="w-8 h-8 rounded-xl object-contain" />
            ) : (
              <div className="w-8 h-8 bg-brand rounded-lg flex items-center justify-center
                              text-base select-none flex-shrink-0">
                {logoEmoji}
              </div>
            )}
            <span className="text-white font-bold text-lg">{businessName}</span>
          </div>
          <p className="text-sm leading-relaxed text-gray-400 mb-4">{tagline}</p>
          <a
            href={waLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 bg-[#25D366] hover:bg-[#1ebe5d]
                       text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors"
          >
            <MessageCircle size={15} />
            Order on WhatsApp
          </a>
        </div>

        {/* ── 2. Business Details ───────────────────────────────────────── */}
        <div>
          <h4 className="text-white font-semibold mb-3">Business Details</h4>
          <ul className="space-y-3 text-sm">

            {/* Business name — always shown */}
            <li className="flex items-start gap-2.5">
              <span className="text-base leading-none flex-shrink-0 mt-0.5">
                {config.logoEmoji}
              </span>
              <div>
                <p className="text-white font-semibold leading-snug">{businessName}</p>
                {tagline && (
                  <p className="text-xs text-gray-500 leading-snug mt-0.5">{tagline}</p>
                )}
              </div>
            </li>

            {/* Phone */}
            {phone && (
              <li>
                <a href={`tel:${phone}`}
                   className="flex items-center gap-2.5 text-gray-400 hover:text-white
                              transition-colors group">
                  <Phone size={13} className="text-brand flex-shrink-0" />
                  <span>{phone}</span>
                </a>
              </li>
            )}

            {/* Address / Location */}
            {address && (
              <li className="flex items-start gap-2.5 text-gray-400">
                <MapPin size={13} className="text-brand flex-shrink-0 mt-0.5" />
                <span className="leading-snug">{address}</span>
              </li>
            )}

            {/* GST number */}
            {gst && (
              <li className="flex items-center gap-2.5 text-gray-400">
                <Receipt size={13} className="text-brand flex-shrink-0" />
                <span className="text-xs font-mono tracking-wide">{gst}</span>
              </li>
            )}

            {/* Fallback when none of the optional fields are set */}
            {!hasBusinessInfo && (
              <li className="text-xs text-gray-600 italic">
                No additional business info provided.
              </li>
            )}
          </ul>
        </div>

        {/* ── 3. Payment Details ────────────────────────────────────────── */}
        {hasPaymentDetails && (
          <div>
            <h4 className="text-white font-semibold mb-3">Payment Details</h4>

            {/* UPI */}
            {hasUpi && (
              <div className="mb-4">
                <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-widest mb-2">
                  📱 UPI / QR Code
                </p>
                <ul>
                  <PayRow label="UPI ID" value={upi} mono />
                </ul>
              </div>
            )}

            {/* Bank Transfer */}
            {hasBank && (
              <div>
                <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-widest mb-2">
                  🏦 Bank Transfer
                </p>
                <ul>
                  {bank.accountName   && <PayRow label="Name"    value={bank.accountName} />}
                  <PayRow label="A/C No"  value={bank.accountNumber} mono />
                  {bank.ifsc          && <PayRow label="IFSC"    value={bank.ifsc} mono />}
                  {bank.bankName      && <PayRow label="Bank"    value={bank.bankName} />}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* ── 4. Quick Info ─────────────────────────────────────────────── */}
        <div>
          <h4 className="text-white font-semibold mb-3">Quick Info</h4>
          <ul className="space-y-2 text-sm text-gray-400">
            <li>🚚 Free delivery above ₹{cart.freeShippingAbove}</li>
            <li>✅ 100% genuine products</li>
            <li>🔄 Easy 7-day returns</li>
          </ul>
        </div>
      </div>

      {/* ── Bottom bar ──────────────────────────────────────────────────── */}
      <div className="border-t border-gray-800 py-4 text-center text-xs text-gray-500">
        © {new Date().getFullYear()} {businessName}. All rights reserved.&nbsp;|&nbsp;Made in India 🇮🇳
      </div>
    </footer>
  );
}

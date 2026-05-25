import { useState } from 'react';
import { CheckCircle2, Eye, EyeOff, Truck } from 'lucide-react';
import FormField from './FormField';
import { validateCustomerDetails } from '../../utils/validators';
import {
  generateWhatsAppMessage,
  sendOrderOnWhatsApp,
} from '../../utils/generateWhatsAppMessage';
import { calcCartTotals, formatINR } from '../../utils/currency';
import { useBusinessConfig } from '../../contexts/BusinessContext';

/**
 * CustomerDetailsForm
 * ─────────────────────────────────────────────────────────────────────────────
 * B2B order form — controlled component.  Parent holds formData state.
 *
 * Fields:
 *   partyName      string   required — customer / firm name
 *   mobile         string   required — 10-digit Indian mobile (digits only)
 *   destination    string   required — delivery city / location
 *   paymentMethod  string   required — cod | upi | bank | cheque
 *   notes          string   optional — packing / special instructions
 *
 * Props:
 *   formData   { partyName, mobile, destination, paymentMethod, notes }
 *   onChange   (newFormData) => void  — parent state setter
 *   cart       CartItem[]            — needed for message generation + totals
 */

export const INITIAL_CUSTOMER_DETAILS = {
  partyName:     '',
  mobile:        '',
  destination:   '',
  paymentMethod: '',
  notes:         '',
};

const PAYMENT_OPTIONS = [
  { value: 'cod',    label: 'Cash / COD' },
  { value: 'upi',    label: 'UPI / QR Code' },
  { value: 'bank',   label: 'Bank Transfer (NEFT/RTGS)' },
  { value: 'cheque', label: 'Cheque' },
];

// ── Official WhatsApp icon (SVG, fill="currentColor") ─────────────────────────
function WhatsAppIcon({ size = 20 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

export default function CustomerDetailsForm({ formData, onChange, cart }) {
  const [errors,      setErrors]      = useState({});
  const [submitted,   setSubmitted]   = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const config = useBusinessConfig();
  const { subtotal, tax, shipping, total } = calcCartTotals(cart, config.cart);
  const taxPct     = Math.round((config.cart?.taxRate ?? 0) * 100);
  const itemCount  = cart.reduce((s, i) => s + i.qty, 0);
  const cartEmpty  = cart.length === 0;

  // Preview is only meaningful once the required fields + cart are ready
  const canPreview =
    !cartEmpty &&
    formData.partyName.trim() &&
    formData.mobile.trim() &&
    formData.destination.trim();

  // ── Field change handler ──────────────────────────────────────────────────
  function handleChange(field, value) {
    onChange({ ...formData, [field]: value });
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: '' }));
  }

  // ── Submit ────────────────────────────────────────────────────────────────
  function handleSubmit() {
    const { isValid, errors: newErrors } = validateCustomerDetails(formData);
    if (!isValid) {
      setErrors(newErrors);
      document.getElementById(`cdf-${Object.keys(newErrors)[0]}`)?.focus();
      return;
    }
    if (cartEmpty) return;

    sendOrderOnWhatsApp(formData, cart, config);
    setSubmitted(true);
  }

  // ── Shared input class ─────────────────────────────────────────────────────
  function inputCls(field) {
    return [
      'w-full px-3 py-2.5 rounded-xl border text-sm text-gray-900',
      'placeholder-gray-400 transition focus:outline-none focus:ring-2',
      errors[field]
        ? 'border-red-400 focus:ring-red-300 bg-red-50'
        : 'border-gray-200 focus:ring-brand focus:border-transparent bg-white',
    ].join(' ');
  }

  // ── Success state ─────────────────────────────────────────────────────────
  if (submitted) {
    return (
      <div
        id="order-form"
        className="bg-white rounded-2xl border border-gray-100 shadow-sm p-10 text-center"
      >
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <CheckCircle2 size={32} className="text-green-500" />
        </div>
        <h3 className="text-lg font-bold text-gray-900 mb-1">Order sent to WhatsApp!</h3>
        <p className="text-sm text-gray-500 max-w-xs mx-auto mb-6">
          Complete your order on WhatsApp with{' '}
          <strong className="text-gray-700">{config.businessName}</strong>.
          We'll confirm and dispatch soon.
        </p>
        <button
          onClick={() => setSubmitted(false)}
          className="text-sm font-semibold text-brand hover:text-brand-dark
                     underline underline-offset-2 transition-colors"
        >
          Place another order
        </button>
      </div>
    );
  }

  // ── Main form ─────────────────────────────────────────────────────────────
  return (
    <div id="order-form" className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="px-6 py-5 border-b border-gray-100 bg-gradient-to-r from-brand/5 to-transparent">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-gray-900">📋 Order Details</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              Fill in your details — we'll send the order summary to WhatsApp
            </p>
          </div>

          {/* Preview toggle — only visible when all required fields are ready */}
          {canPreview && (
            <button
              type="button"
              onClick={() => setShowPreview((v) => !v)}
              className="flex-shrink-0 inline-flex items-center gap-1.5 text-xs font-semibold
                         text-brand hover:text-brand-dark border border-brand/30 hover:border-brand/60
                         bg-brand/5 hover:bg-brand/10 rounded-lg px-3 py-1.5 transition-colors mt-0.5"
            >
              {showPreview ? <EyeOff size={13} /> : <Eye size={13} />}
              {showPreview ? 'Hide' : 'Preview'} message
            </button>
          )}
        </div>
      </div>

      {/* ── Message preview panel ─────────────────────────────────────── */}
      {showPreview && canPreview && (
        <div className="border-b border-gray-100 bg-gray-50">
          <div className="px-6 py-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Message preview
            </p>
            <pre className="text-xs text-gray-700 leading-relaxed whitespace-pre-wrap font-mono
                            bg-white border border-gray-200 rounded-xl px-4 py-3 overflow-x-auto">
              {generateWhatsAppMessage(formData, cart, config)}
            </pre>
          </div>
        </div>
      )}

      {/* ── Form fields ──────────────────────────────────────────────────── */}
      <div className="px-6 py-5 space-y-4">

        {/* Row 1 — Party name + Mobile */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

          <FormField label="Party Name" required error={errors.partyName}>
            <input
              id="cdf-partyName"
              type="text"
              placeholder="e.g. Raj Textiles, Priya Stores"
              autoComplete="organization"
              value={formData.partyName}
              onChange={(e) => handleChange('partyName', e.target.value)}
              className={inputCls('partyName')}
            />
          </FormField>

          <FormField
            label="Mobile Number"
            required
            error={errors.mobile}
            hint="10-digit number"
          >
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400
                               font-medium select-none pointer-events-none">
                +91
              </span>
              <input
                id="cdf-mobile"
                type="tel"
                inputMode="numeric"
                placeholder="98765 43210"
                maxLength={10}
                value={formData.mobile}
                onChange={(e) =>
                  handleChange('mobile', e.target.value.replace(/\D/g, '').slice(0, 10))
                }
                className={[inputCls('mobile'), 'pl-12'].join(' ')}
              />
            </div>
          </FormField>
        </div>

        {/* Row 2 — Destination + Payment Method */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

          <FormField
            label="Destination"
            required
            error={errors.destination}
            hint="Delivery city / location"
          >
            <input
              id="cdf-destination"
              type="text"
              placeholder="e.g. Tirupur, Mumbai, Delhi"
              value={formData.destination}
              onChange={(e) => handleChange('destination', e.target.value)}
              className={inputCls('destination')}
            />
          </FormField>

          <FormField
            label="Payment Method"
            required
            error={errors.paymentMethod}
          >
            <select
              id="cdf-paymentMethod"
              value={formData.paymentMethod}
              onChange={(e) => handleChange('paymentMethod', e.target.value)}
              className={inputCls('paymentMethod')}
            >
              <option value="">Select payment method…</option>
              {PAYMENT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </FormField>
        </div>

        {/* ── Payment details hint ─────────────────────────────────────────
            UPI selected   → show UPI ID (or "seller will share" fallback)
            Bank selected  → show bank details table (or "seller will share")
        ─────────────────────────────────────────────────────────────────── */}
        {formData.paymentMethod === 'upi' && (
          config.upi ? (
            <div className="flex items-start gap-3 bg-blue-50 border border-blue-100
                            rounded-xl px-4 py-3">
              <span className="text-lg leading-none mt-0.5 flex-shrink-0">📱</span>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-blue-800 mb-0.5">Pay via UPI</p>
                <p className="text-sm font-mono font-bold text-blue-700 break-all select-all">
                  {config.upi}
                </p>
                <p className="text-[11px] text-blue-400 mt-1">
                  This UPI ID will be included in your order message.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs text-gray-400
                            bg-gray-50 border border-gray-100 rounded-xl px-4 py-2.5">
              <span>📱</span>
              The seller will share UPI payment details when confirming your order.
            </div>
          )
        )}

        {formData.paymentMethod === 'bank' && (
          config.bank?.accountNumber ? (
            <div className="bg-violet-50 border border-violet-100 rounded-xl px-4 py-3">
              <div className="flex items-center gap-2 mb-2.5">
                <span className="text-base leading-none">🏦</span>
                <p className="text-xs font-semibold text-violet-800 flex-1">
                  Bank Transfer Details
                </p>
                <span className="text-[10px] text-violet-400">
                  Included in your order message
                </span>
              </div>
              <div className="space-y-1.5">
                {config.bank.accountName && (
                  <div className="flex items-center justify-between gap-4 text-xs">
                    <span className="text-violet-500 flex-shrink-0">Account Name</span>
                    <span className="font-semibold text-violet-900 text-right">
                      {config.bank.accountName}
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between gap-4 text-xs">
                  <span className="text-violet-500 flex-shrink-0">Account No.</span>
                  <span className="font-mono font-bold text-violet-900 tracking-widest select-all">
                    {config.bank.accountNumber}
                  </span>
                </div>
                {config.bank.ifsc && (
                  <div className="flex items-center justify-between gap-4 text-xs">
                    <span className="text-violet-500 flex-shrink-0">IFSC</span>
                    <span className="font-mono font-bold text-violet-900 select-all">
                      {config.bank.ifsc}
                    </span>
                  </div>
                )}
                {config.bank.bankName && (
                  <div className="flex items-center justify-between gap-4 text-xs">
                    <span className="text-violet-500 flex-shrink-0">Bank</span>
                    <span className="font-semibold text-violet-900">{config.bank.bankName}</span>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs text-gray-400
                            bg-gray-50 border border-gray-100 rounded-xl px-4 py-2.5">
              <span>🏦</span>
              The seller will share bank account details when confirming your order.
            </div>
          )
        )}

        {/* Notes */}
        <FormField label="Notes" hint="Packing instructions, special requests, etc.">
          <textarea
            id="cdf-notes"
            rows={3}
            placeholder="Any special instructions or additional notes…"
            value={formData.notes}
            onChange={(e) => handleChange('notes', e.target.value)}
            className={[
              'w-full px-3 py-2.5 rounded-xl border text-sm text-gray-900',
              'placeholder-gray-400 transition focus:outline-none focus:ring-2 resize-none',
              'border-gray-200 focus:ring-brand focus:border-transparent bg-white',
            ].join(' ')}
          />
        </FormField>
      </div>

      {/* ── Footer — cost breakdown + CTA ────────────────────────────────── */}
      <div className="border-t border-gray-100 px-6 py-5 bg-gray-50/60">
        {cartEmpty ? (
          /* No items nudge */
          <div className="flex items-center gap-3 py-1 text-sm text-gray-400">
            <span className="text-xl leading-none">🛒</span>
            <span>Add products to your cart above, then place your order here.</span>
          </div>
        ) : (
          <div className="flex flex-col gap-4">

            {/* Cost breakdown */}
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between text-gray-500">
                <span>
                  Subtotal
                  <span className="text-gray-400 font-normal ml-1">
                    ({itemCount} {itemCount === 1 ? 'item' : 'items'})
                  </span>
                </span>
                <span className="font-medium text-gray-700 tabular-nums">
                  {formatINR(subtotal)}
                </span>
              </div>

              {taxPct > 0 && (
                <div className="flex justify-between text-gray-500">
                  <span>GST ({taxPct}%)</span>
                  <span className="font-medium text-gray-700 tabular-nums">
                    {formatINR(tax)}
                  </span>
                </div>
              )}

              <div className="flex justify-between text-gray-500">
                <span className="flex items-center gap-1">
                  <Truck size={12} />
                  Delivery
                </span>
                <span className={[
                  'font-medium tabular-nums',
                  shipping === 0 ? 'text-green-600 font-semibold' : 'text-gray-700',
                ].join(' ')}>
                  {shipping === 0 ? 'FREE' : formatINR(shipping)}
                </span>
              </div>

              <div className="flex justify-between pt-1.5 border-t border-dashed border-gray-200">
                <span className="font-bold text-gray-900">Total</span>
                <span className="font-extrabold text-brand-dark text-base tabular-nums">
                  {formatINR(total)}
                </span>
              </div>
            </div>

            {/* Send Order on WhatsApp */}
            <button
              type="button"
              onClick={handleSubmit}
              className="w-full flex items-center justify-center gap-2.5
                         bg-[#25D366] hover:bg-[#1ebe5d] active:bg-[#17a550]
                         text-white font-bold text-base
                         px-7 py-3.5 rounded-2xl
                         shadow-lg hover:shadow-xl
                         transition-all duration-200 active:scale-[0.98]
                         min-h-[52px]"
            >
              <WhatsAppIcon size={21} />
              Send Order on WhatsApp
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

import { useState } from 'react';
import { THEME_PRESETS } from '../../utils/buildConfig';

/**
 * StepBusiness — Onboarding Step 1
 * Collects: business name, WhatsApp number, logo emoji, brand color.
 */

const LOGO_EMOJIS = [
  '🏪', '📱', '🔌', '⚙️', '🧵', '🏭',
  '🛒', '📦', '💎', '🌿', '🔧', '🍽️',
  '🚗', '💼', '👕', '🎯', '🔩', '🌾',
];

const THEME_OPTIONS = [
  { hex: '#0d9488', label: 'Teal'   },
  { hex: '#2563eb', label: 'Blue'   },
  { hex: '#6366f1', label: 'Indigo' },
  { hex: '#16a34a', label: 'Green'  },
  { hex: '#ea580c', label: 'Orange' },
  { hex: '#9333ea', label: 'Purple' },
  { hex: '#e11d48', label: 'Rose'   },
];

export default function StepBusiness({ data, onChange, onNext }) {
  const [errors, setErrors] = useState({});

  function validate() {
    const errs = {};
    if (!data.businessName.trim())
      errs.businessName = 'Business name is required.';
    if (!/^\d{10}$/.test(data.whatsappNumber.replace(/\s/g, '')))
      errs.whatsappNumber = 'Enter a valid 10-digit Indian mobile number.';
    return errs;
  }

  function handleNext() {
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    onNext();
  }

  function inputCls(field) {
    return [
      'w-full px-3 py-2.5 rounded-xl border text-sm text-gray-900',
      'placeholder-gray-400 transition focus:outline-none focus:ring-2',
      errors[field]
        ? 'border-red-400 focus:ring-red-200 bg-red-50'
        : 'border-gray-200 focus:ring-gray-300 bg-white',
    ].join(' ');
  }

  return (
    <div className="space-y-6">

      {/* Heading */}
      <div>
        <h2 className="text-xl font-extrabold text-gray-900">Your business</h2>
        <p className="text-sm text-gray-500 mt-1">
          This is what customers will see on your store page.
        </p>
      </div>

      {/* Business name */}
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-1.5">
          Business Name <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          placeholder="e.g. Mahadev Steel, Priya Textiles, RK Electronics"
          value={data.businessName}
          onChange={e => {
            onChange({ businessName: e.target.value });
            setErrors(p => ({ ...p, businessName: '' }));
          }}
          className={inputCls('businessName')}
          autoFocus
        />
        {errors.businessName && (
          <p className="mt-1 text-xs text-red-500">{errors.businessName}</p>
        )}
      </div>

      {/* WhatsApp number */}
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-1.5">
          WhatsApp Number <span className="text-red-500">*</span>
        </label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm
                           text-gray-400 font-medium select-none pointer-events-none">
            +91
          </span>
          <input
            type="tel"
            inputMode="numeric"
            placeholder="98765 43210"
            maxLength={10}
            value={data.whatsappNumber}
            onChange={e => {
              const v = e.target.value.replace(/\D/g, '').slice(0, 10);
              onChange({ whatsappNumber: v });
              setErrors(p => ({ ...p, whatsappNumber: '' }));
            }}
            className={[inputCls('whatsappNumber'), 'pl-12'].join(' ')}
          />
        </div>
        {errors.whatsappNumber
          ? <p className="mt-1 text-xs text-red-500">{errors.whatsappNumber}</p>
          : <p className="mt-1 text-xs text-gray-400">Orders will be sent to this number.</p>
        }
      </div>

      {/* Store icon */}
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-2">
          Store Icon
        </label>
        <div className="flex flex-wrap gap-2">
          {LOGO_EMOJIS.map(emoji => (
            <button
              key={emoji}
              type="button"
              onClick={() => onChange({ logoEmoji: emoji })}
              className={[
                'w-10 h-10 rounded-xl text-xl flex items-center justify-center transition-all',
                data.logoEmoji === emoji
                  ? 'ring-2 ring-offset-1 ring-gray-800 bg-gray-100 scale-110'
                  : 'bg-gray-50 hover:bg-gray-100 border border-gray-200',
              ].join(' ')}
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>

      {/* Brand color */}
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-2">
          Brand Color
        </label>
        <div className="flex flex-wrap gap-3">
          {THEME_OPTIONS.map(({ hex, label }) => (
            <button
              key={hex}
              type="button"
              title={label}
              onClick={() => onChange({ themeColor: hex })}
              className={[
                'w-9 h-9 rounded-full transition-all flex items-center justify-center',
                data.themeColor === hex
                  ? 'ring-2 ring-offset-2 ring-gray-700 scale-110'
                  : 'hover:scale-105 opacity-80 hover:opacity-100',
              ].join(' ')}
              style={{ backgroundColor: hex }}
            >
              {data.themeColor === hex && (
                <svg viewBox="0 0 14 14" className="w-3.5 h-3.5 text-white" fill="none">
                  <path d="M2 7l3.5 3.5L12 3.5" stroke="currentColor"
                        strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-gray-400">
          Used for buttons and highlights on your store page.
        </p>
      </div>

      {/* ── Divider ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 pt-1">
        <div className="h-px flex-1 bg-gray-100" />
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-widest">
          Pricing & Payments
        </span>
        <div className="h-px flex-1 bg-gray-100" />
      </div>

      {/* GST Rate */}
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-1.5">
          GST Rate
        </label>
        <select
          value={data.gstRate}
          onChange={e => onChange({ gstRate: Number(e.target.value) })}
          className="w-full px-3 py-2.5 rounded-xl border border-gray-200 bg-white
                     text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-300"
        >
          <option value={0}>0% — No GST / Exempt</option>
          <option value={0.05}>5% GST</option>
          <option value={0.12}>12% GST</option>
          <option value={0.18}>18% GST</option>
          <option value={0.28}>28% GST</option>
        </select>
        <p className="mt-1 text-xs text-gray-400">
          Applied to the order subtotal for all customers.
        </p>
      </div>

      {/* GST Number (optional) */}
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-1.5">
          GST Number <span className="text-gray-400 font-normal">(optional)</span>
        </label>
        <input
          type="text"
          placeholder="e.g. 33XXXXX1234Z1Z5"
          maxLength={15}
          value={data.gstNumber}
          onChange={e => onChange({ gstNumber: e.target.value.toUpperCase() })}
          className="w-full px-3 py-2.5 rounded-xl border border-gray-200 bg-white
                     text-sm text-gray-900 placeholder-gray-400 focus:outline-none
                     focus:ring-2 focus:ring-gray-300 font-mono tracking-wide"
        />
        <p className="mt-1 text-xs text-gray-400">
          Shown in your store footer for customer reference.
        </p>
      </div>

      {/* Delivery charge + Free delivery threshold */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1.5">
            Delivery Charge (₹)
          </label>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            placeholder="49"
            value={data.deliveryCharge}
            onChange={e => onChange({ deliveryCharge: e.target.value === '' ? '' : Number(e.target.value) })}
            className="w-full px-3 py-2.5 rounded-xl border border-gray-200 bg-white
                       text-sm text-gray-900 placeholder-gray-400 focus:outline-none
                       focus:ring-2 focus:ring-gray-300"
          />
        </div>
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-1.5">
            Free Delivery Above (₹)
          </label>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            placeholder="999"
            value={data.freeDeliveryAbove}
            onChange={e => onChange({ freeDeliveryAbove: e.target.value === '' ? '' : Number(e.target.value) })}
            className="w-full px-3 py-2.5 rounded-xl border border-gray-200 bg-white
                       text-sm text-gray-900 placeholder-gray-400 focus:outline-none
                       focus:ring-2 focus:ring-gray-300"
          />
        </div>
      </div>
      <p className="text-xs text-gray-400 -mt-3">
        Orders above the free-delivery threshold get free shipping automatically.
      </p>

      {/* UPI ID (optional) */}
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-1.5">
          UPI ID <span className="text-gray-400 font-normal">(optional)</span>
        </label>
        <input
          type="text"
          placeholder="e.g. yourname@upi, 9876543210@paytm"
          value={data.upiId}
          onChange={e => onChange({ upiId: e.target.value.trim() })}
          className="w-full px-3 py-2.5 rounded-xl border border-gray-200 bg-white
                     text-sm text-gray-900 placeholder-gray-400 focus:outline-none
                     focus:ring-2 focus:ring-gray-300"
        />
        <p className="mt-1 text-xs text-gray-400">
          Shown to customers who choose UPI / QR Code payment.
        </p>
      </div>

      {/* Bank Transfer Details */}
      <div className="space-y-2.5">
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-0.5">
            Bank Transfer Details{' '}
            <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <p className="text-xs text-gray-400 mb-2">
            Shared with customers who choose Bank Transfer payment.
          </p>
        </div>

        {/* Account holder name */}
        <input
          type="text"
          placeholder="Account Holder Name  (e.g. Raj Textiles Pvt Ltd)"
          value={data.bankAccountName}
          onChange={e => onChange({ bankAccountName: e.target.value })}
          className="w-full px-3 py-2.5 rounded-xl border border-gray-200 bg-white
                     text-sm text-gray-900 placeholder-gray-400 focus:outline-none
                     focus:ring-2 focus:ring-gray-300"
        />

        {/* Account number + IFSC side by side */}
        <div className="grid grid-cols-2 gap-2.5">
          <input
            type="text"
            inputMode="numeric"
            placeholder="Account Number"
            value={data.bankAccountNumber}
            onChange={e => onChange({ bankAccountNumber: e.target.value.replace(/\D/g, '') })}
            className="w-full px-3 py-2.5 rounded-xl border border-gray-200 bg-white
                       text-sm text-gray-900 placeholder-gray-400 focus:outline-none
                       focus:ring-2 focus:ring-gray-300 font-mono tracking-wide"
          />
          <input
            type="text"
            placeholder="IFSC Code"
            maxLength={11}
            value={data.bankIfsc}
            onChange={e => onChange({ bankIfsc: e.target.value.toUpperCase().replace(/\s/g, '') })}
            className="w-full px-3 py-2.5 rounded-xl border border-gray-200 bg-white
                       text-sm text-gray-900 placeholder-gray-400 focus:outline-none
                       focus:ring-2 focus:ring-gray-300 font-mono tracking-wide uppercase"
          />
        </div>

        {/* Bank name */}
        <input
          type="text"
          placeholder="Bank Name  (e.g. HDFC Bank, SBI)"
          value={data.bankName}
          onChange={e => onChange({ bankName: e.target.value })}
          className="w-full px-3 py-2.5 rounded-xl border border-gray-200 bg-white
                     text-sm text-gray-900 placeholder-gray-400 focus:outline-none
                     focus:ring-2 focus:ring-gray-300"
        />
      </div>

      {/* CTA */}
      <button
        type="button"
        onClick={handleNext}
        className="w-full py-3 rounded-xl font-bold text-white text-sm
                   transition-all active:scale-[0.98] shadow-sm hover:opacity-90"
        style={{ backgroundColor: data.themeColor || '#0d9488' }}
      >
        Continue — Add Products →
      </button>
    </div>
  );
}

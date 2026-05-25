import { useState } from 'react';
import { User, Phone, MapPin, CreditCard, CheckCircle, Loader, MessageCircle } from 'lucide-react';
import FormField, { TextInput, TextArea, SelectInput } from './FormField';
import Button from '../ui/Button';
import { validateCustomerForm } from '../../utils/validators';
import { formatINR, calcCartTotals } from '../../utils/currency';
import { INDIAN_STATES, PAYMENT_MODES } from '../../config/app.config';
import { BUSINESS_CONFIG } from '../../config/businessConfig';
import { whatsappLink } from '../../utils/theme';

const INITIAL_FORM = {
  name: '', phone: '', email: '',
  address: '', city: '', state: '', pincode: '', landmark: '',
  paymentMode: '', notes: '',
};

const PAYMENT_ICONS = {
  'UPI': '📱',
  'Cash on Delivery': '💵',
  'Bank Transfer': '🏦',
  'Card': '💳',
};

/**
 * CustomerForm — tax rate, UPI id, and WhatsApp number come from BUSINESS_CONFIG.
 */
export default function CustomerForm({ cart, onOrderPlaced }) {
  const [form, setForm]       = useState(INITIAL_FORM);
  const [errors, setErrors]   = useState({});
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const { subtotal, tax, shipping, total } = calcCartTotals(cart);
  const isEmpty = cart.length === 0;
  const taxPct  = Math.round(BUSINESS_CONFIG.cart.taxRate * 100);
  const waLink  = whatsappLink(BUSINESS_CONFIG.whatsapp, BUSINESS_CONFIG.name);

  function handleChange(e) {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) setErrors((prev) => ({ ...prev, [name]: undefined }));
  }

  function handleSubmit(e) {
    e.preventDefault();
    const { isValid, errors: errs } = validateCustomerForm(form);
    if (!isValid) {
      setErrors(errs);
      const firstKey = Object.keys(errs)[0];
      document.getElementById(`field-${firstKey}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    setLoading(true);
    // Replace with real API call when backend is ready
    setTimeout(() => {
      setLoading(false);
      setSuccess(true);
      onOrderPlaced?.({ form, cart, total });
    }, 1500);
  }

  // ── Success screen ─────────────────────────────────────────────────────
  if (success) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center">
        <div className="w-16 h-16 bg-brand/10 rounded-full flex items-center justify-center mx-auto mb-4">
          <CheckCircle size={32} className="text-brand" />
        </div>
        <h3 className="text-xl font-bold text-gray-900 mb-2">Order Placed! 🎉</h3>
        <p className="text-gray-500 text-sm mb-1">
          Thank you, <strong>{form.name}</strong>!
        </p>
        <p className="text-gray-500 text-sm mb-4">
          We'll call you on <strong>{form.phone}</strong> to confirm your order.
        </p>

        <div className="bg-brand/8 rounded-xl p-4 text-sm text-gray-700 mb-4">
          <p className="font-semibold text-brand-dark mb-1">Order Summary</p>
          <p>Total: <strong>{formatINR(total)}</strong></p>
          <p>Payment: <strong>{form.paymentMode}</strong></p>
          <p className="text-xs text-gray-500 mt-1">
            Deliver to: {form.address}, {form.city} – {form.pincode}
          </p>
        </div>

        <a
          href={waLink}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 bg-green-500 hover:bg-green-600 text-white
                     font-semibold px-5 py-2.5 rounded-xl transition-colors mb-3 text-sm"
        >
          <MessageCircle size={16} />
          Share order on WhatsApp
        </a>

        <div className="mt-3">
          <Button variant="secondary" onClick={() => { setSuccess(false); setForm(INITIAL_FORM); }}>
            Place Another Order
          </Button>
        </div>
      </div>
    );
  }

  // ── Order form ─────────────────────────────────────────────────────────
  return (
    <section id="order-form" className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">

      {/* Header strip */}
      <div className="bg-gradient-to-r from-brand to-brand-dark px-6 py-4">
        <h2 className="text-white font-bold text-lg flex items-center gap-2">
          <User size={20} />
          Delivery Details
        </h2>
        <p className="text-white/70 text-sm mt-0.5">
          Fill in your details to place the order
        </p>
      </div>

      <form onSubmit={handleSubmit} className="p-6 space-y-6" noValidate>

        {/* ── Contact ── */}
        <div>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <User size={13} /> Contact Information
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label="Full Name" required error={errors.name}>
              <TextInput
                id="field-name"
                name="name"
                value={form.name}
                onChange={handleChange}
                placeholder="e.g. Ramesh Kumar"
                error={errors.name}
              />
            </FormField>

            <FormField label="Mobile Number" required error={errors.phone} hint="10-digit number">
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500 font-medium">+91</span>
                <TextInput
                  id="field-phone"
                  name="phone"
                  type="tel"
                  value={form.phone}
                  onChange={handleChange}
                  placeholder="98765 43210"
                  maxLength={10}
                  error={errors.phone}
                  style={{ paddingLeft: '2.75rem' }}
                />
              </div>
            </FormField>

            <FormField label="Email (optional)" error={errors.email}>
              <TextInput
                id="field-email"
                name="email"
                type="email"
                value={form.email}
                onChange={handleChange}
                placeholder="yourname@gmail.com"
                error={errors.email}
              />
            </FormField>
          </div>
        </div>

        {/* ── Address ── */}
        <div>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <MapPin size={13} /> Delivery Address
          </h3>
          <div className="space-y-4">
            <FormField label="Full Address" required error={errors.address}>
              <TextArea
                id="field-address"
                name="address"
                value={form.address}
                onChange={handleChange}
                placeholder="House/Flat No., Street, Colony…"
                error={errors.address}
              />
            </FormField>

            <FormField label="Landmark (optional)">
              <TextInput
                name="landmark"
                value={form.landmark}
                onChange={handleChange}
                placeholder="Near temple, school, etc."
              />
            </FormField>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <FormField label="City" required error={errors.city}>
                <TextInput
                  id="field-city"
                  name="city"
                  value={form.city}
                  onChange={handleChange}
                  placeholder="Mumbai"
                  error={errors.city}
                />
              </FormField>

              <FormField label="State" required error={errors.state}>
                <SelectInput
                  id="field-state"
                  name="state"
                  value={form.state}
                  onChange={handleChange}
                  error={errors.state}
                >
                  <option value="">-- Select State --</option>
                  {INDIAN_STATES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </SelectInput>
              </FormField>

              <FormField label="PIN Code" required error={errors.pincode}>
                <TextInput
                  id="field-pincode"
                  name="pincode"
                  type="tel"
                  value={form.pincode}
                  onChange={handleChange}
                  placeholder="400001"
                  maxLength={6}
                  error={errors.pincode}
                />
              </FormField>
            </div>
          </div>
        </div>

        {/* ── Payment ── */}
        <div>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <CreditCard size={13} /> Payment Method
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {PAYMENT_MODES.map((mode) => (
              <label
                key={mode}
                className={[
                  'flex items-center justify-center gap-2 px-3 py-3 rounded-xl border-2',
                  'cursor-pointer text-sm font-medium transition-all',
                  form.paymentMode === mode
                    ? 'border-brand bg-brand/10 text-brand-dark'
                    : 'border-gray-200 bg-white text-gray-600 hover:border-brand/50',
                ].join(' ')}
              >
                <input
                  type="radio"
                  name="paymentMode"
                  value={mode}
                  checked={form.paymentMode === mode}
                  onChange={handleChange}
                  className="sr-only"
                />
                <span className="text-base">{PAYMENT_ICONS[mode] ?? '💳'}</span>
                <span className="text-xs sm:text-sm">{mode}</span>
              </label>
            ))}
          </div>
          {errors.paymentMode && (
            <p className="text-xs text-red-500 mt-1">⚠ {errors.paymentMode}</p>
          )}
        </div>

        {/* ── Notes ── */}
        <FormField label="Order Notes (optional)">
          <TextArea
            name="notes"
            value={form.notes}
            onChange={handleChange}
            placeholder="Special instructions for your order…"
            rows={2}
          />
        </FormField>

        {/* ── Order summary ── */}
        {!isEmpty && (
          <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm border border-gray-100">
            <h4 className="font-semibold text-gray-700 mb-2">Order Summary</h4>
            <div className="flex justify-between text-gray-600">
              <span>Subtotal</span><span>{formatINR(subtotal)}</span>
            </div>
            <div className="flex justify-between text-gray-600">
              <span>GST ({taxPct}%)</span><span>{formatINR(tax)}</span>
            </div>
            <div className="flex justify-between text-gray-600">
              <span>Delivery</span>
              <span className={shipping === 0 ? 'text-green-600 font-medium' : ''}>
                {shipping === 0 ? 'FREE' : formatINR(shipping)}
              </span>
            </div>
            <div className="flex justify-between font-bold text-base border-t border-gray-200 pt-2">
              <span>Total Payable</span>
              <span className="text-brand-dark">{formatINR(total)}</span>
            </div>
          </div>
        )}

        {/* ── Submit ── */}
        <Button type="submit" variant="primary" size="lg" fullWidth disabled={isEmpty || loading}>
          {loading ? (
            <><Loader size={18} className="animate-spin" />Placing Order…</>
          ) : isEmpty ? (
            '🛒 Add items to place order'
          ) : (
            `✓ Place Order — ${formatINR(total)}`
          )}
        </Button>

        {isEmpty && (
          <p className="text-center text-xs text-gray-400">
            Add products to your cart before placing an order
          </p>
        )}
      </form>
    </section>
  );
}

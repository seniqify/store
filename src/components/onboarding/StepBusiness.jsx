import { useState } from 'react';
import { Check } from 'lucide-react';
import { FEATURE_SUGGESTIONS } from '../../utils/buildConfig';

/**
 * StepBusiness — Onboarding Step 2
 * Collects everything the storefront hero/footer needs: name, tagline, WhatsApp,
 * brand, cover, location, highlights/amenities, and (cart types only) payments.
 * Fields adapt to the chosen business type.
 */

const LOGO_EMOJIS = [
  '🏪', '📱', '🔌', '⚙️', '🧵', '🏭',
  '🛒', '📦', '💎', '🌿', '🔧', '🍽️',
  '🚗', '💼', '👕', '🎯', '🏨', '💇',
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

// Type-aware copy so the form speaks the merchant's language.
const TYPE_COPY = {
  product:    { noun: 'shop',       taglinePh: 'e.g. Premium home essentials, delivered across India', items: 'products',   highlights: 'Highlights', addr: 'Address / Pickup location', addrPh: 'e.g. MG Road, Bengaluru — 560001' },
  restaurant: { noun: 'restaurant', taglinePh: 'e.g. Authentic home-style meals, cooked fresh daily',  items: 'menu items', highlights: 'Highlights', addr: 'Restaurant address',         addrPh: 'e.g. Koramangala, Bengaluru — 560095' },
  service:    { noun: 'business',   taglinePh: 'e.g. Trusted home services, just a message away',       items: 'services',   highlights: 'Highlights', addr: 'Service area / address',     addrPh: 'e.g. Serving all of South Delhi' },
  hotel:      { noun: 'property',   taglinePh: 'e.g. A peaceful lakeside stay near the hills',          items: 'rooms',      highlights: 'Amenities',  addr: 'Property address',           addrPh: 'e.g. Calangute, Goa — 403516' },
};

export default function StepBusiness({ data, onChange, onNext, onBack }) {
  const [errors, setErrors] = useState({});

  const type   = data.businessType || 'product';
  const brand  = data.themeColor || '#0d9488';
  const isCart = type === 'product' || type === 'restaurant';
  const copy   = TYPE_COPY[type] ?? TYPE_COPY.product;
  const suggestions = FEATURE_SUGGESTIONS[type] ?? FEATURE_SUGGESTIONS.product;

  // Empty = first four defaults are shown pre-selected (config builder mirrors this).
  const selectedFeatures = data.features && data.features.length ? data.features : suggestions.slice(0, 4);
  const isFeatureOn = (f) => selectedFeatures.some(x => x.title === f.title);
  function toggleFeature(f) {
    const next = isFeatureOn(f)
      ? selectedFeatures.filter(x => x.title !== f.title)
      : [...selectedFeatures, f];
    onChange({ features: next });
  }

  function readImage(file, key) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => onChange({ [key]: reader.result });
    reader.readAsDataURL(file);
  }

  function validate() {
    const errs = {};
    if (!data.businessName.trim()) errs.businessName = 'Business name is required.';
    if (!/^\d{10}$/.test((data.whatsappNumber || '').replace(/\s/g, ''))) errs.whatsappNumber = 'Enter a valid 10-digit number.';
    return errs;
  }
  function handleNext() {
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    onNext();
  }

  const fieldStyle = { '--tw-ring-color': `${brand}55` };
  const fieldCls = (f) => [
    'w-full px-3.5 py-3 rounded-xl border bg-white text-sm text-gray-900 placeholder-gray-400',
    'transition focus:outline-none focus:ring-2 focus:border-transparent',
    errors[f] ? 'border-red-400 bg-red-50' : 'border-gray-200',
  ].join(' ');

  const section = (icon, title, sub = null) => (
    <div className="flex items-center gap-2.5 pt-2">
      <span className="w-7 h-7 rounded-lg flex items-center justify-center text-sm flex-shrink-0"
            style={{ backgroundColor: `${brand}14` }}>{icon}</span>
      <div className="min-w-0">
        <h3 className="text-[13px] font-extrabold text-gray-900 leading-tight">{title}</h3>
        {sub && <p className="text-[11px] text-gray-400 leading-tight">{sub}</p>}
      </div>
      <div className="h-px flex-1 bg-gray-100 ml-1" />
    </div>
  );

  return (
    <div className="space-y-6">

      {/* Heading */}
      <div>
        <h2 className="text-xl font-extrabold text-gray-900">Tell us about your {copy.noun}</h2>
        <p className="text-sm text-gray-500 mt-1">This is what customers see on your page — you can change it anytime.</p>
      </div>

      {/* ════ The basics ════ */}
      {section('✏️', 'THE BASICS')}

      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-1.5">
          Business Name <span className="text-red-500">*</span>
        </label>
        <input type="text" placeholder="e.g. Spice Route Kitchen, Aanya Boutique"
          value={data.businessName} style={fieldStyle} autoFocus
          onChange={e => { onChange({ businessName: e.target.value }); setErrors(p => ({ ...p, businessName: '' })); }}
          className={fieldCls('businessName')} />
        {errors.businessName && <p className="mt-1 text-xs text-red-500">{errors.businessName}</p>}
      </div>

      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-1.5">
          Tagline <span className="text-gray-400 font-normal">(one line under your name)</span>
        </label>
        <input type="text" placeholder={copy.taglinePh} maxLength={90}
          value={data.tagline} style={fieldStyle}
          onChange={e => onChange({ tagline: e.target.value })}
          className={fieldCls('tagline')} />
        <p className="mt-1 text-xs text-gray-400">Leave blank and we’ll add a sensible one for you.</p>
      </div>

      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-1.5">
          WhatsApp Number <span className="text-red-500">*</span>
        </label>
        <div className="relative">
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-gray-400 font-medium select-none pointer-events-none">+91</span>
          <input type="tel" inputMode="numeric" placeholder="98765 43210" maxLength={10}
            value={data.whatsappNumber} style={fieldStyle}
            onChange={e => { onChange({ whatsappNumber: e.target.value.replace(/\D/g, '').slice(0, 10) }); setErrors(p => ({ ...p, whatsappNumber: '' })); }}
            className={`${fieldCls('whatsappNumber')} pl-12`} />
        </div>
        {errors.whatsappNumber
          ? <p className="mt-1 text-xs text-red-500">{errors.whatsappNumber}</p>
          : <p className="mt-1 text-xs text-gray-400">Every order, booking & enquiry is sent here.</p>}
      </div>

      {/* ════ Brand & look ════ */}
      {section('🎨', 'BRAND & LOOK')}

      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-2">Business Icon</label>
        <div className="flex flex-wrap gap-2">
          {LOGO_EMOJIS.map(emoji => (
            <button key={emoji} type="button" onClick={() => onChange({ logoEmoji: emoji })}
              className={[
                'w-10 h-10 rounded-xl text-xl flex items-center justify-center transition-all',
                data.logoEmoji === emoji ? 'scale-110 text-white shadow-sm' : 'bg-gray-50 hover:bg-gray-100 border border-gray-200',
              ].join(' ')}
              style={data.logoEmoji === emoji ? { backgroundColor: brand } : {}}>
              {emoji}
            </button>
          ))}
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        {/* Logo */}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">
            Logo Image <span className="font-normal text-gray-400">(optional)</span>
          </label>
          <div className="flex items-center gap-3">
            {data.logo ? (
              <div className="relative flex-shrink-0">
                <img src={data.logo} alt="logo" className="w-16 h-16 rounded-2xl object-cover border border-gray-200" />
                <button type="button" onClick={() => onChange({ logo: '' })}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 rounded-full text-white text-xs flex items-center justify-center font-bold leading-none">×</button>
              </div>
            ) : (
              <label className="w-16 h-16 rounded-2xl border-2 border-dashed border-gray-200 flex flex-col items-center justify-center cursor-pointer hover:border-gray-400 transition-colors bg-gray-50 flex-shrink-0">
                <span className="text-xl mb-0.5">📷</span>
                <span className="text-[10px] text-gray-400">Upload</span>
                <input type="file" accept="image/*" className="hidden" onChange={e => readImage(e.target.files[0], 'logo')} />
              </label>
            )}
            <p className="text-xs text-gray-400 leading-relaxed">Square image.<br />Replaces the emoji.</p>
          </div>
        </div>

        {/* Brand color */}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">Brand Color</label>
          <div className="flex flex-wrap gap-2.5">
            {THEME_OPTIONS.map(({ hex, label }) => (
              <button key={hex} type="button" title={label} onClick={() => onChange({ themeColor: hex })}
                className={[
                  'w-9 h-9 rounded-full transition-all flex items-center justify-center',
                  data.themeColor === hex ? 'ring-2 ring-offset-2 ring-gray-700 scale-110' : 'hover:scale-105 opacity-80 hover:opacity-100',
                ].join(' ')}
                style={{ backgroundColor: hex }}>
                {data.themeColor === hex && <Check size={15} strokeWidth={3} className="text-white" />}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-gray-400">Drives buttons & accents.</p>
        </div>
      </div>

      {/* Cover photo */}
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-2">
          Cover Photo <span className="font-normal text-gray-400">(optional, but recommended)</span>
        </label>
        {data.coverImage ? (
          <div className="relative">
            <img src={data.coverImage} alt="cover" className="w-full h-32 object-cover rounded-2xl border border-gray-200" />
            <button type="button" onClick={() => onChange({ coverImage: '' })}
              className="absolute top-2 right-2 w-6 h-6 bg-red-500 rounded-full text-white text-xs flex items-center justify-center font-bold">×</button>
          </div>
        ) : (
          <label className="w-full h-32 rounded-2xl border-2 border-dashed border-gray-200 flex flex-col items-center justify-center cursor-pointer hover:border-gray-400 transition-colors bg-gray-50">
            <span className="text-2xl mb-1">🖼️</span>
            <span className="text-xs font-semibold text-gray-500">Upload a cover photo</span>
            <span className="text-[11px] text-gray-400 mt-0.5">A wide photo of your {copy.noun} looks best</span>
            <input type="file" accept="image/*" className="hidden" onChange={e => readImage(e.target.files[0], 'coverImage')} />
          </label>
        )}
      </div>

      {/* ════ Location ════ */}
      {section('📍', 'LOCATION')}
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-1.5">
          {copy.addr} {type !== 'hotel' && <span className="text-gray-400 font-normal">(optional)</span>}
        </label>
        <input type="text" placeholder={copy.addrPh} value={data.address} style={fieldStyle}
          onChange={e => onChange({ address: e.target.value })} className={fieldCls('address')} />
        <p className="mt-1 text-xs text-gray-400">Shown on your page{type === 'hotel' ? ' hero and footer' : ' footer'}.</p>
      </div>

      {/* ════ Highlights / Amenities ════ */}
      {section(type === 'hotel' ? '🛎️' : '⭐', copy.highlights.toUpperCase(), 'Tap to add or remove')}
      <div className="flex flex-wrap gap-2">
        {suggestions.map(f => {
          const on = isFeatureOn(f);
          return (
            <button key={f.title} type="button" onClick={() => toggleFeature(f)}
              className={[
                'inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium border transition-all active:scale-95',
                on ? 'text-white border-transparent shadow-sm' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300',
              ].join(' ')}
              style={on ? { backgroundColor: brand } : {}}>
              <span className="text-base leading-none">{f.emoji}</span>
              {f.title}
              {on && <Check size={13} strokeWidth={3} className="ml-0.5" />}
            </button>
          );
        })}
      </div>

      {/* ════ Pricing & payments (cart types only) ════ */}
      {isCart && (
        <>
          {section('💳', 'PRICING & PAYMENTS', 'Used at checkout')}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">GST Rate</label>
              <select value={data.gstRate} onChange={e => onChange({ gstRate: Number(e.target.value) })}
                className="w-full px-3.5 py-3 rounded-xl border border-gray-200 bg-white text-sm text-gray-900 focus:outline-none focus:ring-2 focus:border-transparent"
                style={fieldStyle}>
                <option value={0}>0% — Exempt</option>
                <option value={0.05}>5% GST</option>
                <option value={0.12}>12% GST</option>
                <option value={0.18}>18% GST</option>
                <option value={0.28}>28% GST</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                GST No. <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input type="text" placeholder="33XXXXX1234Z1Z5" maxLength={15} value={data.gstNumber} style={fieldStyle}
                onChange={e => onChange({ gstNumber: e.target.value.toUpperCase() })}
                className="w-full px-3.5 py-3 rounded-xl border border-gray-200 bg-white text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:border-transparent font-mono tracking-wide" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Delivery Charge (₹)</label>
              <input type="number" inputMode="numeric" min={0} placeholder="49" value={data.deliveryCharge} style={fieldStyle}
                onChange={e => onChange({ deliveryCharge: e.target.value === '' ? '' : Number(e.target.value) })}
                className="w-full px-3.5 py-3 rounded-xl border border-gray-200 bg-white text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:border-transparent" />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Free Delivery Above (₹)</label>
              <input type="number" inputMode="numeric" min={0} placeholder="999" value={data.freeDeliveryAbove} style={fieldStyle}
                onChange={e => onChange({ freeDeliveryAbove: e.target.value === '' ? '' : Number(e.target.value) })}
                className="w-full px-3.5 py-3 rounded-xl border border-gray-200 bg-white text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:border-transparent" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">
              UPI ID <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input type="text" placeholder="yourname@upi" value={data.upiId} style={fieldStyle}
              onChange={e => onChange({ upiId: e.target.value.trim() })}
              className="w-full px-3.5 py-3 rounded-xl border border-gray-200 bg-white text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:border-transparent" />
          </div>

          <div className="space-y-2.5">
            <label className="block text-sm font-semibold text-gray-700">
              Bank Transfer <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input type="text" placeholder="Account holder name" value={data.bankAccountName} style={fieldStyle}
              onChange={e => onChange({ bankAccountName: e.target.value })}
              className="w-full px-3.5 py-3 rounded-xl border border-gray-200 bg-white text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:border-transparent" />
            <div className="grid grid-cols-2 gap-2.5">
              <input type="text" inputMode="numeric" placeholder="Account number" value={data.bankAccountNumber} style={fieldStyle}
                onChange={e => onChange({ bankAccountNumber: e.target.value.replace(/\D/g, '') })}
                className="w-full px-3.5 py-3 rounded-xl border border-gray-200 bg-white text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:border-transparent font-mono tracking-wide" />
              <input type="text" placeholder="IFSC code" maxLength={11} value={data.bankIfsc} style={fieldStyle}
                onChange={e => onChange({ bankIfsc: e.target.value.toUpperCase().replace(/\s/g, '') })}
                className="w-full px-3.5 py-3 rounded-xl border border-gray-200 bg-white text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:border-transparent font-mono tracking-wide uppercase" />
            </div>
            <input type="text" placeholder="Bank name (e.g. HDFC Bank)" value={data.bankName} style={fieldStyle}
              onChange={e => onChange({ bankName: e.target.value })}
              className="w-full px-3.5 py-3 rounded-xl border border-gray-200 bg-white text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:border-transparent" />
          </div>
        </>
      )}

      {/* CTA */}
      <div className="flex gap-3 pt-2">
        <button type="button" onClick={onBack}
          className="flex-1 py-3 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors">
          ← Back
        </button>
        <button type="button" onClick={handleNext}
          className="flex-[2] py-3 rounded-xl font-bold text-white text-sm transition-all active:scale-[0.98] shadow-sm hover:opacity-90"
          style={{ backgroundColor: brand }}>
          Continue — Add {copy.items} →
        </button>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { lookupPincode } from '../../utils/pincode';
import { DEFAULT_TAGLINES } from '../../utils/buildConfig';

/**
 * StepBusiness — Onboarding step 2 ("Details").
 * Bare minimum to go live: business name + WhatsApp number (prefilled from the
 * verified phone) + an optional pincode for the local marketplace. A live
 * preview shows the page forming. Logo, colours, cover, GST, payments etc. are
 * deferred to Manage → Settings.
 */

const TYPE_NOUN = { product: 'shop', restaurant: 'restaurant', service: 'business', hotel: 'property' };

export default function StepBusiness({ data, onChange, onNext, onBack }) {
  const [errors,    setErrors]    = useState({});
  const [pinStatus, setPinStatus] = useState('idle'); // idle | loading | ok | notfound

  const type    = data.businessType || 'product';
  const brand   = data.themeColor || '#0d9488';
  const noun    = TYPE_NOUN[type] || 'business';
  const digits  = (data.whatsappNumber || '').replace(/\D/g, '').slice(-10);
  const tagline = data.tagline?.trim() || DEFAULT_TAGLINES[type] || DEFAULT_TAGLINES.product;

  async function onPincode(raw) {
    const pin = raw.replace(/\D/g, '').slice(0, 6);
    onChange({ pincode: pin });
    if (pin.length !== 6) { setPinStatus('idle'); return; }
    setPinStatus('loading');
    const res = await lookupPincode(pin);
    if (res && res.state) {
      onChange({ city: res.city || '', state: res.state || '', area: (res.areas && res.areas[0]) || '' });
      setPinStatus('ok');
    } else {
      setPinStatus('notfound');
    }
  }

  function handleNext() {
    const errs = {};
    if (!data.businessName.trim()) errs.businessName   = 'Please enter your business name.';
    if (digits.length !== 10)      errs.whatsappNumber = 'Enter a valid 10-digit number.';
    if (Object.keys(errs).length) { setErrors(errs); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    onNext();
  }

  const ring = { '--tw-ring-color': `${brand}55` };
  const inputCls = (f) => [
    'w-full px-3.5 py-3 rounded-xl border bg-white text-sm text-gray-900 placeholder-gray-400',
    'transition focus:outline-none focus:ring-2 focus:border-transparent',
    errors[f] ? 'border-red-400 bg-red-50' : 'border-gray-200',
  ].join(' ');

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-extrabold text-gray-900">Your {noun} details</h2>
        <p className="text-sm text-gray-500 mt-1">Just the basics to go live — add a logo, colours &amp; more later.</p>
      </div>

      {/* ── Live preview ── */}
      <div className="rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
        <div className="px-4 py-4 flex items-center gap-3"
             style={{ background: `linear-gradient(135deg, ${brand}, ${brand}cc)` }}>
          <div className="w-12 h-12 rounded-2xl bg-white/20 flex items-center justify-center text-2xl flex-shrink-0">
            {data.logoEmoji || '🏪'}
          </div>
          <div className="min-w-0">
            <p className="text-white font-extrabold text-base leading-tight truncate">
              {data.businessName.trim() || `Your ${noun} name`}
            </p>
            <p className="text-white/80 text-xs mt-0.5 leading-snug line-clamp-1">{tagline}</p>
          </div>
        </div>
        <div className="px-4 py-2.5 bg-white flex items-center gap-2">
          <span className="text-[11px] font-bold px-2.5 py-1 rounded-lg text-white" style={{ backgroundColor: '#25D366' }}>
            💬 Order on WhatsApp
          </span>
          <span className="text-[11px] text-gray-400">live preview</span>
        </div>
      </div>

      {/* ── Business name ── */}
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-1.5">
          Business name <span className="text-red-500">*</span>
        </label>
        <input type="text" autoFocus placeholder="e.g. Sharma Kirana Store"
          value={data.businessName} style={ring}
          onChange={(e) => { onChange({ businessName: e.target.value }); setErrors(p => ({ ...p, businessName: '' })); }}
          className={inputCls('businessName')} />
        {errors.businessName && <p className="mt-1 text-xs text-red-500">{errors.businessName}</p>}
      </div>

      {/* ── WhatsApp (prefilled from the verified number) ── */}
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-1.5">
          WhatsApp number <span className="text-red-500">*</span>
        </label>
        <div className="relative">
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-gray-400 font-medium pointer-events-none">+91</span>
          <input type="tel" inputMode="numeric" maxLength={10} placeholder="98765 43210"
            value={digits} style={ring}
            onChange={(e) => { onChange({ whatsappNumber: e.target.value.replace(/\D/g, '').slice(0, 10) }); setErrors(p => ({ ...p, whatsappNumber: '' })); }}
            className={[inputCls('whatsappNumber'), 'pl-12'].join(' ')} />
        </div>
        {errors.whatsappNumber
          ? <p className="mt-1 text-xs text-red-500">{errors.whatsappNumber}</p>
          : <p className="mt-1 text-xs text-gray-400">Every order &amp; enquiry comes here — ✅ already verified.</p>}
      </div>

      {/* ── Optional pincode → city/state ── */}
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-1.5">
          Pincode <span className="text-gray-400 font-normal">(optional — helps nearby customers find you)</span>
        </label>
        <input type="tel" inputMode="numeric" maxLength={6} placeholder="413001"
          value={data.pincode || ''} style={ring}
          onChange={(e) => onPincode(e.target.value)}
          className={inputCls(false)} />
        {pinStatus === 'loading'  && <p className="mt-1 text-xs text-gray-400">Looking up…</p>}
        {pinStatus === 'ok'       && <p className="mt-1 text-xs text-emerald-600 truncate">📍 {[data.city, data.state].filter(Boolean).join(', ')}</p>}
        {pinStatus === 'notfound' && <p className="mt-1 text-xs text-amber-600">Couldn't find that pincode — you can skip it.</p>}
      </div>

      {/* ── CTA ── */}
      <div className="flex gap-3 pt-1">
        <button type="button" onClick={onBack}
          className="flex-1 py-3 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors">
          ← Back
        </button>
        <button type="button" onClick={handleNext}
          className="flex-[2] py-3 rounded-xl font-bold text-white text-sm transition-all active:scale-[0.98] shadow-sm hover:opacity-90"
          style={{ backgroundColor: brand }}>
          Continue — Add items →
        </button>
      </div>
    </div>
  );
}

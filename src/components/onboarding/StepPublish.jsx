import { Link } from 'react-router-dom';
import { CheckCircle2, Lock } from 'lucide-react';

const ITEM_NOUNS = {
  product:    ['product', 'products'],
  restaurant: ['dish',    'dishes'],
  service:    ['service',  'services'],
  hotel:      ['room',     'rooms'],
};

const CHECKLISTS = {
  product: [
    'A live page with your branding',
    'Catalogue with category filters & search',
    'Cart, quantities & WhatsApp checkout',
    'Edit products anytime from your manage page',
  ],
  restaurant: [
    'A live menu page with your branding',
    'Menu with categories & search',
    'Delivery / pickup orders on WhatsApp',
    'Edit the menu anytime from your manage page',
  ],
  service: [
    'A live services page with your branding',
    'Service list with starting prices',
    'Quote requests straight to WhatsApp',
    'Edit services anytime from your manage page',
  ],
  hotel: [
    'A live booking page with your branding',
    'Rooms with photos, rates & amenities',
    'Booking requests straight to WhatsApp',
    'Edit rooms anytime from your manage page',
  ],
};

export default function StepPublish({
  data, config, saving, saveError,
  onBack, onPublish, onPinChange,
}) {
  if (!config) return null;

  const { businessName, tagline, whatsappNumber, logo, logoEmoji, theme, slug, features = [] } = config;
  const brand      = theme.primary;
  const type       = data.businessType || 'product';
  const digits     = whatsappNumber.replace(/\D/g, '').slice(-10);
  const phoneLabel = `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
  const defaultPin = whatsappNumber.replace(/\D/g, '').slice(-4) || '1234';

  const [nounS, nounP] = ITEM_NOUNS[type] ?? ITEM_NOUNS.product;
  const itemCount    = data.products.length;
  const featureCount = features.length;
  const checklist    = CHECKLISTS[type] ?? CHECKLISTS.product;

  const stat = (label, value) => (
    <div className="rounded-xl bg-gray-50 border border-gray-100 px-3 py-2.5">
      <p className="text-[11px] text-gray-400 leading-none mb-1">{label}</p>
      <p className="text-sm font-bold text-gray-900 leading-tight">{value}</p>
    </div>
  );

  return (
    <div className="space-y-6">

      <div>
        <h2 className="text-xl font-extrabold text-gray-900">You’re all set 🎉</h2>
        <p className="text-sm text-gray-500 mt-1">Here’s a quick look — launch when you’re happy.</p>
      </div>

      {/* ── Preview card ──────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
        <div className="px-4 py-4 flex items-center gap-3"
             style={{ background: `linear-gradient(135deg, ${brand}, ${brand}cc)` }}>
          {logo ? (
            <img src={logo} alt={businessName} className="w-11 h-11 rounded-xl object-cover ring-2 ring-white/40 flex-shrink-0" />
          ) : (
            <div className="w-11 h-11 bg-white/20 rounded-xl flex items-center justify-center text-xl flex-shrink-0">{logoEmoji}</div>
          )}
          <div className="min-w-0">
            <p className="text-white font-extrabold text-base leading-tight truncate">{businessName}</p>
            {tagline && <p className="text-white/80 text-xs mt-0.5 leading-snug line-clamp-1">{tagline}</p>}
          </div>
        </div>

        <div className="p-4 space-y-3">
          <div className="grid grid-cols-3 gap-2.5">
            {stat(itemCount === 1 ? nounS.replace(/^\w/, c => c.toUpperCase()) : nounP.replace(/^\w/, c => c.toUpperCase()), `${itemCount} added`)}
            {stat(type === 'hotel' ? 'Amenities' : 'Highlights', `${featureCount} shown`)}
            <div className="rounded-xl bg-gray-50 border border-gray-100 px-3 py-2.5">
              <p className="text-[11px] text-gray-400 leading-none mb-1">Brand</p>
              <div className="flex items-center gap-1.5">
                <span className="w-4 h-4 rounded-full border border-white shadow-sm flex-shrink-0" style={{ backgroundColor: brand }} />
                <span className="text-sm font-bold text-gray-900">Colour</span>
              </div>
            </div>
          </div>

          <div>
            <p className="text-[11px] text-gray-400 mb-1">WhatsApp · orders come here</p>
            <p className="text-sm font-bold text-gray-900">{phoneLabel}</p>
          </div>

          {/* URL */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 overflow-hidden">
            <p className="text-[11px] text-gray-400 mb-0.5">Your page link</p>
            <p className="font-mono text-[13px] font-semibold text-gray-700 truncate">
              {window.location.origin.replace(/^https?:\/\//, '')}/<span style={{ color: brand }}>{slug}</span>
            </p>
          </div>
        </div>
      </div>

      {/* ── PIN setup (clear) ─────────────────────────────────────────── */}
      <div className="rounded-2xl border border-gray-200 p-5">
        <div className="flex items-center gap-2 mb-1.5">
          <Lock size={15} className="text-gray-500" />
          <p className="text-sm font-bold text-gray-900">Set your management PIN</p>
        </div>
        <p className="text-xs text-gray-500 leading-relaxed mb-3">
          You’ll enter this 4-digit PIN to edit your page after launch.
        </p>

        <div className="flex items-center gap-3 flex-wrap">
          <input
            type="text"
            inputMode="numeric"
            placeholder={defaultPin}
            maxLength={4}
            value={data.pin}
            onChange={(e) => onPinChange(e.target.value.replace(/\D/g, '').slice(0, 4))}
            className="w-32 px-3 py-3 border border-gray-200 rounded-xl text-center
                       text-2xl font-bold tracking-[0.4em] text-gray-900 bg-white
                       focus:outline-none focus:ring-2 transition"
            style={{ '--tw-ring-color': `${brand}55` }}
          />
          <p className="text-xs text-gray-400 leading-snug flex-1 min-w-[10rem]">
            Leave blank to use <span className="font-bold text-gray-600">{defaultPin}</span>
            <br />— the last 4 digits of your WhatsApp number.
          </p>
        </div>
      </div>

      {/* ── What's included (type-aware) ──────────────────────────────── */}
      <div className="rounded-2xl p-4" style={{ backgroundColor: `${brand}0d`, border: `1px solid ${brand}1f` }}>
        <p className="text-xs font-bold uppercase tracking-wider mb-2.5" style={{ color: brand }}>What you’re launching</p>
        <div className="space-y-2">
          {checklist.map(item => (
            <div key={item} className="flex items-center gap-2 text-sm text-gray-700">
              <CheckCircle2 size={15} className="flex-shrink-0" style={{ color: brand }} />
              {item}
            </div>
          ))}
        </div>
      </div>

      {/* ── Error ─────────────────────────────────────────────────────── */}
      {saveError && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
          ⚠️ {saveError}
        </div>
      )}

      {/* ── Terms ─────────────────────────────────────────────────────── */}
      <p className="text-[11px] text-gray-400 text-center leading-relaxed">
        By launching you agree to our{' '}
        <Link to="/terms"   className="underline hover:text-gray-600" target="_blank" rel="noopener noreferrer">Terms</Link>
        {' '}and{' '}
        <Link to="/privacy" className="underline hover:text-gray-600" target="_blank" rel="noopener noreferrer">Privacy Policy</Link>.
      </p>

      {/* ── Navigation ────────────────────────────────────────────────── */}
      <div className="flex gap-3">
        <button type="button" onClick={onBack} disabled={saving}
          className="flex-1 py-3 rounded-xl border border-gray-200 text-sm font-semibold
                     text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50">
          ← Back
        </button>
        <button type="button" onClick={onPublish} disabled={saving}
          className="flex-[2] py-3.5 rounded-xl text-sm font-bold text-white transition-all active:scale-[0.98]
                     shadow-lg hover:opacity-90 disabled:opacity-70 flex items-center justify-center gap-2"
          style={{ backgroundColor: brand, boxShadow: `0 10px 30px ${brand}40` }}>
          {saving ? (
            <>
              <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              Launching…
            </>
          ) : (
            <>🚀 Launch my page</>
          )}
        </button>
      </div>
    </div>
  );
}

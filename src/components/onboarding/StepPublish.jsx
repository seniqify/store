import { Link } from 'react-router-dom';
import { CheckCircle2, Lock, ExternalLink, Settings } from 'lucide-react';

export default function StepPublish({
  data, config, saving, saveError,
  onBack, onPublish, onPinChange,
}) {
  if (!config) return null;

  const { businessName, whatsappNumber, logoEmoji, theme, slug } = config;
  const digits     = whatsappNumber.replace(/\D/g, '').slice(-10);
  const phoneLabel = `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
  const defaultPin = whatsappNumber.replace(/\D/g, '').slice(-4) || '1234';

  return (
    <div className="space-y-6">

      <div>
        <h2 className="text-xl font-extrabold text-gray-900">Your store is ready</h2>
        <p className="text-sm text-gray-500 mt-1">Review and launch your store.</p>
      </div>

      {/* ── Store preview card ──────────────────────────────────────── */}
      <div className="border border-gray-200 rounded-2xl overflow-hidden">
        <div className="px-4 py-3 flex items-center gap-2.5"
             style={{ backgroundColor: theme.primary }}>
          <div className="w-8 h-8 bg-white/20 rounded-xl flex items-center justify-center text-base">
            {logoEmoji}
          </div>
          <div>
            <p className="text-white font-bold text-sm leading-none">{businessName}</p>
            <p className="text-white/70 text-xs mt-0.5">Powered by Seniqify Store</p>
          </div>
        </div>

        <div className="px-4 py-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'WhatsApp',   value: phoneLabel },
              { label: 'Categories', value: `${data.categories.length} categories` },
              { label: 'Products',   value: `${data.products.length} products` },
              { label: 'Brand',      value: theme.primary, swatch: true },
            ].map(({ label, value, swatch }) => (
              <div key={label}>
                <p className="text-xs text-gray-400 mb-0.5">{label}</p>
                {swatch ? (
                  <div className="flex items-center gap-1.5">
                    <div className="w-4 h-4 rounded-full border border-white shadow-sm"
                         style={{ backgroundColor: value }} />
                    <span className="text-sm font-semibold text-gray-900">{value}</span>
                  </div>
                ) : (
                  <p className="text-sm font-semibold text-gray-900">{value}</p>
                )}
              </div>
            ))}
          </div>

          {/* Store URL */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5">
            <p className="text-xs text-gray-400 mb-0.5">Your store URL</p>
            <p className="font-mono text-sm font-semibold text-gray-800">
              {window.location.origin}/<span style={{ color: theme.primary }}>{slug}</span>
            </p>
          </div>
        </div>
      </div>

      {/* ── PIN setup ──────────────────────────────────────────────── */}
      <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-4 space-y-3">
        <div className="flex items-center gap-2">
          <Lock size={15} className="text-amber-600" />
          <p className="text-sm font-bold text-amber-800">Set your Store Management PIN</p>
        </div>
        <p className="text-xs text-amber-600 leading-relaxed">
          Use this PIN to edit products, add categories, and update settings after launch.
          Default is last 4 digits of your WhatsApp number.
        </p>
        <input
          type="number"
          inputMode="numeric"
          placeholder={`Default: ${defaultPin}`}
          maxLength={4}
          value={data.pin}
          onChange={(e) => onPinChange(e.target.value.replace(/\D/g, '').slice(0, 4))}
          className="w-32 px-3 py-2 border border-amber-200 rounded-xl text-center
                     text-lg font-bold tracking-widest text-gray-900 bg-white
                     focus:outline-none focus:ring-2 focus:ring-amber-400"
        />
        <p className="text-[11px] text-amber-500">
          After launch, manage your store at:{' '}
          <span className="font-mono font-semibold">
            {window.location.origin}/{slug}/manage
          </span>
        </p>
      </div>

      {/* ── What's included ────────────────────────────────────────── */}
      <div className="bg-green-50 border border-green-100 rounded-xl px-4 py-3 space-y-2">
        {[
          'Live store page with your branding',
          'Product catalogue with category filters',
          'Cart with quantity selectors',
          'WhatsApp order flow',
          'Add/edit products anytime via manage page',
        ].map(item => (
          <div key={item} className="flex items-center gap-2 text-sm text-green-800">
            <CheckCircle2 size={14} className="text-green-500 flex-shrink-0" />
            {item}
          </div>
        ))}
      </div>

      {/* ── Error ──────────────────────────────────────────────────── */}
      {saveError && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
          ⚠️ {saveError}
        </div>
      )}

      {/* ── Terms acceptance notice ────────────────────────────────── */}
      <p className="text-[11px] text-gray-400 text-center leading-relaxed">
        By launching your store you agree to our{' '}
        <Link to="/terms"   className="underline hover:text-gray-600" target="_blank" rel="noopener noreferrer">Terms of Service</Link>
        {' '}and{' '}
        <Link to="/privacy" className="underline hover:text-gray-600" target="_blank" rel="noopener noreferrer">Privacy Policy</Link>.
      </p>

      {/* ── Navigation ─────────────────────────────────────────────── */}
      <div className="flex gap-3">
        <button type="button" onClick={onBack} disabled={saving}
          className="flex-1 py-3 rounded-xl border border-gray-200 text-sm font-semibold
                     text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50">
          ← Back
        </button>
        <button type="button" onClick={onPublish} disabled={saving}
          className="flex-1 py-3.5 rounded-xl text-sm font-bold text-white
                     transition-all active:scale-[0.98] shadow-sm hover:opacity-90
                     disabled:opacity-70 flex items-center justify-center gap-2"
          style={{ backgroundColor: theme.primary }}>
          {saving ? (
            <>
              <div className="w-4 h-4 border-2 border-white/40 border-t-white
                              rounded-full animate-spin" />
              Saving…
            </>
          ) : (
            '🚀 Launch My Store'
          )}
        </button>
      </div>
    </div>
  );
}

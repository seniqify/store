import { CheckCircle2 } from 'lucide-react';

/**
 * StepPublish — Onboarding Step 3
 * Shows a preview of the generated store config and a "Launch" button.
 *
 * Props:
 *   data       — raw wizard data (used for display counts)
 *   config     — output of buildBusinessConfig() — fully formed store config
 *   onBack     — () => void
 *   onPublish  — () => void — saves to localStorage and navigates to the store
 */
export default function StepPublish({ data, config, onBack, onPublish }) {
  if (!config) return null;

  const { businessName, whatsappNumber, logoEmoji, theme, slug } = config;

  // Format the WhatsApp number for display: 91XXXXXXXXXX → +91 XXXXX XXXXX
  const digits     = whatsappNumber.replace(/\D/g, '').slice(-10);
  const phoneLabel = `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;

  return (
    <div className="space-y-6">

      <div>
        <h2 className="text-xl font-extrabold text-gray-900">Your store is ready</h2>
        <p className="text-sm text-gray-500 mt-1">
          Review the details below and launch your store.
        </p>
      </div>

      {/* ── Store preview card ─────────────────────────────────────────── */}
      <div className="border border-gray-200 rounded-2xl overflow-hidden">

        {/* Simulated header bar */}
        <div className="px-4 py-3 flex items-center gap-2.5"
             style={{ backgroundColor: theme.primary }}>
          <div className="w-8 h-8 bg-white/20 rounded-xl flex items-center
                          justify-center text-base">
            {logoEmoji}
          </div>
          <div>
            <p className="text-white font-bold text-sm leading-none">{businessName}</p>
            <p className="text-white/70 text-xs mt-0.5">Powered by Seniqify Store</p>
          </div>
        </div>

        {/* Info rows */}
        <div className="px-4 py-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'WhatsApp',   value: phoneLabel },
              { label: 'Categories', value: `${data.categories.length} categories` },
              { label: 'Products',   value: `${data.products.length} products` },
              { label: 'Brand',      value: theme.primary,      swatch: true },
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

          {/* Category chips */}
          {data.categories.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {data.categories.map(c => (
                <span key={c.id}
                      className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5
                                 rounded-full font-medium">
                  {c.emoji} {c.label}
                </span>
              ))}
            </div>
          )}

          {/* Store URL */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5">
            <p className="text-xs text-gray-400 mb-0.5">Your store URL</p>
            <p className="font-mono text-sm font-semibold text-gray-800">
              {window.location.origin}/<span style={{ color: theme.primary }}>{slug}</span>
            </p>
          </div>
        </div>
      </div>

      {/* ── What's included ────────────────────────────────────────────── */}
      <div className="bg-green-50 border border-green-100 rounded-xl px-4 py-3 space-y-2">
        {[
          'Live store page with your branding',
          'Product catalogue with category filters',
          'Cart with quantity selectors',
          'WhatsApp order flow — structured message to your number',
        ].map(item => (
          <div key={item} className="flex items-center gap-2 text-sm text-green-800">
            <CheckCircle2 size={14} className="text-green-500 flex-shrink-0" />
            {item}
          </div>
        ))}
      </div>

      {/* ── Navigation ─────────────────────────────────────────────────── */}
      <div className="flex gap-3">
        <button type="button" onClick={onBack}
                className="flex-1 py-3 rounded-xl border border-gray-200 text-sm font-semibold
                           text-gray-600 hover:bg-gray-50 transition-colors">
          ← Back
        </button>
        <button
          type="button"
          onClick={onPublish}
          className="flex-1 py-3.5 rounded-xl text-sm font-bold text-white
                     transition-all active:scale-[0.98] shadow-sm hover:opacity-90"
          style={{ backgroundColor: theme.primary }}
        >
          🚀 Launch My Store
        </button>
      </div>
    </div>
  );
}

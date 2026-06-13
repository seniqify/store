import { Link } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';

/**
 * StepPublish — Onboarding step 4 ("Launch").
 * A compact final check: small preview, the page link, a 4-digit edit PIN
 * (defaults to the last 4 of the WhatsApp number), and the Launch button.
 */

const TYPE_TO_MODE = { product: 'product', service: 'service' };

export default function StepPublish({ data, config, saving, saveError, onBack, onPublish, onPinChange }) {
  const { t } = useI18n();
  if (!config) return null;

  const { businessName, tagline, whatsappNumber, logo, logoEmoji, theme, slug } = config;
  const brand      = theme.primary;
  const type       = data.businessType || 'product';
  const mode       = TYPE_TO_MODE[type] || 'product';
  const digits     = whatsappNumber.replace(/\D/g, '').slice(-10);
  const phoneLabel = digits.length === 10 ? `+91 ${digits.slice(0, 5)} ${digits.slice(5)}` : `+91 ${digits}`;
  const defaultPin = digits.slice(-4) || '1234';
  const itemCount  = data.products.length;
  const itemNoun   = itemCount === 1 ? t(`mode.${mode}.itemS`) : t(`mode.${mode}.itemP`);
  const host       = window.location.origin.replace(/^https?:\/\//, '');

  return (
    <div className="space-y-6">

      <div>
        <h2 className="text-xl font-extrabold text-gray-900">{t('lau.heading')}</h2>
        <p className="text-sm text-gray-500 mt-1">{t('lau.sub')}</p>
      </div>

      {/* ── Compact preview ── */}
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

        <div className="p-4 space-y-2.5">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-500">{t('lau.added', { noun: itemNoun })}</span>
            <span className="font-bold text-gray-900">{itemCount}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-500">{t('lau.ordersTo')}</span>
            <span className="font-bold text-gray-900">{phoneLabel}</span>
          </div>
          <div className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 overflow-hidden">
            <p className="text-[11px] text-gray-400 mb-0.5">{t('lau.link')}</p>
            <p className="font-mono text-[13px] font-semibold text-gray-700 truncate">
              {host}/<span style={{ color: brand }}>{slug}</span>
            </p>
          </div>
        </div>
      </div>

      {/* ── Edit PIN ── */}
      <div className="rounded-2xl border border-gray-200 p-5">
        <div className="flex items-center gap-2 mb-1.5">
          <Lock size={15} className="text-gray-500" />
          <p className="text-sm font-bold text-gray-900">{t('lau.pin.title')}</p>
        </div>
        <p className="text-xs text-gray-500 leading-relaxed mb-3">{t('lau.pin.sub')}</p>
        <div className="flex items-center gap-3 flex-wrap">
          <input
            type="text" inputMode="numeric" placeholder={defaultPin} maxLength={4}
            value={data.pin}
            onChange={(e) => onPinChange(e.target.value.replace(/\D/g, '').slice(0, 4))}
            className="w-32 px-3 py-3 border border-gray-200 rounded-xl text-center
                       text-2xl font-bold tracking-[0.4em] text-gray-900 bg-white
                       focus:outline-none focus:ring-2 transition"
            style={{ '--tw-ring-color': `${brand}55` }}
          />
          <p className="text-xs text-gray-400 leading-snug flex-1 min-w-[10rem]">
            {t('lau.pin.blank', { pin: defaultPin })}
          </p>
        </div>
      </div>

      {saveError && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">
          ⚠️ {saveError}
        </div>
      )}

      <p className="text-[11px] text-gray-400 text-center leading-relaxed">
        By launching you agree to our{' '}
        <Link to="/terms"   className="underline hover:text-gray-600" target="_blank" rel="noopener noreferrer">Terms</Link>
        {' '}and{' '}
        <Link to="/privacy" className="underline hover:text-gray-600" target="_blank" rel="noopener noreferrer">Privacy Policy</Link>.
      </p>

      <div className="flex gap-3">
        <button type="button" onClick={onBack} disabled={saving}
          className="flex-1 py-3 rounded-xl border border-gray-200 text-sm font-semibold
                     text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50">
          {t('common.back')}
        </button>
        <button type="button" onClick={onPublish} disabled={saving}
          className="flex-[2] py-3.5 rounded-xl text-sm font-bold text-white transition-all active:scale-[0.98]
                     shadow-lg hover:opacity-90 disabled:opacity-70 flex items-center justify-center gap-2"
          style={{ backgroundColor: brand, boxShadow: `0 10px 30px ${brand}40` }}>
          {saving ? (
            <><div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> {t('lau.launching')}</>
          ) : (
            <>{t('lau.launch')}</>
          )}
        </button>
      </div>
    </div>
  );
}

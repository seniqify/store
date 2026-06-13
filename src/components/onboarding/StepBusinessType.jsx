import { useI18n } from '../../i18n/I18nContext';

/**
 * StepBusinessType — Onboarding step 1.
 * Pick what kind of business this is. Tapping a card selects it AND advances
 * (the parent sets a matching theme colour + icon on select), so it's one tap.
 */

const BUSINESS_TYPES = [
  { key: 'product',    emoji: '🛒', tint: '#0d9488' },
  { key: 'service',    emoji: '🛠️', tint: '#9333ea' },
];

export default function StepBusinessType({ selected, onSelect, onNext }) {
  const { t } = useI18n();

  // One tap: record the choice (parent also sets theme + icon), then move on.
  function pick(type) {
    onSelect(type);
    onNext();
  }

  return (
    <div className="space-y-6">
      <div className="text-center">
        <p className="text-2xl mb-2">👋</p>
        <h2 className="text-xl font-extrabold text-gray-900">{t('type.heading')}</h2>
        <p className="text-sm text-gray-500 mt-1">{t('type.sub')}</p>
      </div>

      <div className="space-y-3">
        {BUSINESS_TYPES.map((type) => {
          const active = selected === type.key;
          return (
            <button
              key={type.key}
              type="button"
              onClick={() => pick(type.key)}
              className={[
                'w-full flex items-center gap-4 px-4 py-4 rounded-2xl border-2 text-left',
                'transition-all duration-150 active:scale-[0.99]',
                active ? 'border-transparent' : 'border-gray-100 bg-white hover:border-gray-200 hover:bg-gray-50',
              ].join(' ')}
              style={active ? { backgroundColor: `${type.tint}12`, borderColor: `${type.tint}66` } : undefined}
            >
              <span
                className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl flex-shrink-0"
                style={{ backgroundColor: `${type.tint}1a` }}
              >
                {type.emoji}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-extrabold text-[15px] leading-tight text-gray-900">{t(`type.${type.key}.label`)}</p>
                <p className="text-xs text-gray-500 mt-0.5 leading-snug">{t(`type.${type.key}.desc`)}</p>
              </div>
              <span className="text-gray-300 text-lg flex-shrink-0">→</span>
            </button>
          );
        })}
      </div>

      <p className="text-center text-[11px] text-gray-400">{t('type.footer')}</p>
    </div>
  );
}

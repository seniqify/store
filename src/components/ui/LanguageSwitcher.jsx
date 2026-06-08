import { useI18n } from '../../i18n/I18nContext';
import { LANGUAGES } from '../../i18n/strings';

/**
 * Compact EN / हिं / मरा segmented control. `variant="dark"` for dark headers
 * (onboarding), `"light"` for white headers (Manage).
 */
export default function LanguageSwitcher({ variant = 'dark' }) {
  const { lang, setLang } = useI18n();
  const dark = variant === 'dark';
  return (
    <div className={[
      'inline-flex items-center rounded-full p-0.5 gap-0.5',
      dark ? 'bg-white/10 border border-white/15' : 'bg-gray-100 border border-gray-200',
    ].join(' ')}>
      {LANGUAGES.map((l) => {
        const active = lang === l.code;
        return (
          <button
            key={l.code}
            type="button"
            onClick={() => setLang(l.code)}
            aria-pressed={active}
            className={[
              'px-2.5 py-1 rounded-full text-[11px] font-bold transition-colors',
              active
                ? 'bg-white text-gray-900 shadow-sm'
                : dark ? 'text-white/60 hover:text-white' : 'text-gray-500 hover:text-gray-800',
            ].join(' ')}
          >
            {l.short}
          </button>
        );
      })}
    </div>
  );
}

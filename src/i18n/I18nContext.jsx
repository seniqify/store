import { createContext, useContext, useState, useCallback } from 'react';
import { STRINGS } from './strings';

const I18nContext = createContext(null);
const KEY = 'pocketlink_lang';

function initialLang() {
  try {
    const l = localStorage.getItem(KEY);
    if (l && STRINGS[l]) return l;
  } catch { /* ignore */ }
  return 'en';
}

function translate(lang, key, vars) {
  let s = (STRINGS[lang] && STRINGS[lang][key]) ?? STRINGS.en[key] ?? key;
  if (vars) for (const k of Object.keys(vars)) s = s.split(`{${k}}`).join(String(vars[k]));
  return s;
}

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(initialLang);
  const setLang = useCallback((l) => {
    if (!STRINGS[l]) return;
    setLangState(l);
    try { localStorage.setItem(KEY, l); } catch { /* ignore */ }
  }, []);
  const t = useCallback((key, vars) => translate(lang, key, vars), [lang]);
  return <I18nContext.Provider value={{ lang, setLang, t }}>{children}</I18nContext.Provider>;
}

/** Access the current language + t(). Safe to call outside a provider (defaults to English). */
export function useI18n() {
  const ctx = useContext(I18nContext);
  if (ctx) return ctx;
  return { lang: 'en', setLang: () => {}, t: (key, vars) => translate('en', key, vars) };
}

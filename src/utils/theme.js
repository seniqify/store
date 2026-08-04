/**
 * Theme utility — applies business theme colors as CSS custom properties
 * on the document root. Tailwind v4 reads these via @theme to generate
 * utility classes like bg-brand, text-brand-dark, etc.
 *
 * Call applyTheme(BUSINESS_CONFIG.theme) once on app mount.
 */
export function applyTheme(theme) {
  const root = document.documentElement;

  // Map businessConfig.theme keys → CSS custom property names
  const mapping = {
    primary:     '--color-brand',
    primaryDark: '--color-brand-dark',
    accent:      '--color-accent',
    accentDark:  '--color-accent-dark',
  };

  Object.entries(mapping).forEach(([configKey, cssVar]) => {
    if (theme[configKey]) {
      root.style.setProperty(cssVar, theme[configKey]);
    }
  });
}

/**
 * Default pre-filled text for a store's "Chat on WhatsApp" button. Kept short
 * and keyword-like on purpose: many owners run a WhatsApp bot/automation that
 * only triggers on a brief message, so a long sentence won't fire it. Owners
 * can override this per store from Manage → Settings (config.waMessage).
 */
export function defaultWaMessage(businessName) {
  return `Hello! I'd like to place an order from ${businessName}.`;
}

/**
 * Returns a WhatsApp deep-link URL with a pre-filled message. Pass the store's
 * own `waMessage` to override the default (e.g. a short keyword that triggers
 * the owner's WhatsApp automation); falls back to the default when empty.
 */
export function whatsappLink(number, businessName, customMessage) {
  const text = (customMessage && String(customMessage).trim())
    ? String(customMessage).trim()
    : defaultWaMessage(businessName);
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

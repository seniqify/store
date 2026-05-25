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
 * Returns a WhatsApp deep-link URL with an optional pre-filled message.
 */
export function whatsappLink(number, businessName) {
  const msg = encodeURIComponent(
    `Hello! I'd like to place an order from ${businessName}.`
  );
  return `https://wa.me/${number}?text=${msg}`;
}

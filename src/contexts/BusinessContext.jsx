import { createContext, useContext } from 'react';

/**
 * BusinessContext
 * ─────────────────────────────────────────────────────────────────────────────
 * Provides the active business config to the entire component tree.
 *
 * The context value is the full business config object — same shape as
 * BUSINESS_CONFIG in src/config/businessConfig.js.
 *
 * Usage:
 *   // In any component inside <BusinessProvider>:
 *   const config = useBusinessConfig();
 *   const { name, theme, products, cart } = config;
 */

export const BusinessContext = createContext(null);

/**
 * Wraps a business storefront with its config.
 * Render this once per route — BusinessShell in App.jsx does this.
 */
export function BusinessProvider({ config, children }) {
  return (
    <BusinessContext.Provider value={config}>
      {children}
    </BusinessContext.Provider>
  );
}

/**
 * Hook — read the active business config from context.
 * Throws a clear error if called outside of a <BusinessProvider>.
 */
export function useBusinessConfig() {
  const config = useContext(BusinessContext);
  if (!config) {
    throw new Error(
      'useBusinessConfig() called outside of <BusinessProvider>.\n' +
      'Make sure the component is rendered inside a BusinessShell route.'
    );
  }
  return config;
}

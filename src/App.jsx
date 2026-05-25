import { useState, useEffect, useCallback } from 'react';
import { BrowserRouter, Routes, Route, useParams } from 'react-router-dom';
import Header     from './components/layout/Header';
import Footer     from './components/layout/Footer';
import Home       from './pages/Home';
import Landing    from './pages/Landing';
import Onboarding from './pages/Onboarding';
import NotFound   from './pages/NotFound';
import { BusinessProvider, useBusinessConfig } from './contexts/BusinessContext';
import { loadBusiness } from './utils/BusinessLoader';
import { applyTheme }   from './utils/theme';

/**
 * ThemeApplier — zero-render component.
 * Applies CSS custom properties whenever the active business config changes.
 * Enables instant visual rebranding when navigating between stores.
 */
function ThemeApplier() {
  const { theme } = useBusinessConfig();
  useEffect(() => { applyTheme(theme); }, [theme]);
  return null;
}

/**
 * BusinessShell
 * ─────────────────────────────────────────────────────────────────────────────
 * Resolves the :businessSlug URL param → config via BusinessLoader.
 * Checks localStorage (user-created stores) first, then static demo configs.
 * Renders a friendly 404 if the slug is not found in either source.
 *
 * Cart open/count state lives here so Header and Home can share it without
 * a separate CartContext — scoped per-route so each store has isolated state.
 */
function BusinessShell() {
  const { businessSlug } = useParams();
  const config = loadBusiness(businessSlug);

  const [cartOpen,  setCartOpen]  = useState(false);
  const [cartCount, setCartCount] = useState(0);

  const handleCartCountChange = useCallback((count) => setCartCount(count), []);

  if (!config) return <NotFound slug={businessSlug} />;

  return (
    <BusinessProvider config={config}>
      <ThemeApplier />

      <div className="min-h-screen flex flex-col bg-[#f8fafc]">
        <Header
          cartCount={cartCount}
          onCartOpen={() => setCartOpen(true)}
        />

        <main className="flex-1">
          <Home
            externalCartOpen={cartOpen}
            onExternalCartClose={() => setCartOpen(false)}
            onCartCountChange={handleCartCountChange}
          />
        </main>

        <Footer />
      </div>
    </BusinessProvider>
  );
}

/**
 * App — router root.
 *
 * Routes:
 *   /              → Landing page (platform homepage)
 *   /onboarding    → Onboarding wizard (create a new store)
 *   /:businessSlug → BusinessShell (load + render matching store)
 *   *              → NotFound
 *
 * React Router v6 resolves /onboarding as a specific path before
 * the /:businessSlug dynamic segment — no conflict.
 */
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/"              element={<Landing />} />
        <Route path="/onboarding"    element={<Onboarding />} />
        <Route path="/:businessSlug" element={<BusinessShell />} />
        <Route path="*"              element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}

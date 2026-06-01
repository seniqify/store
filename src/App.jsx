import { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, useParams } from 'react-router-dom';
import Header           from './components/layout/Header';
import Footer           from './components/layout/Footer';
import TemplateRenderer from './templates/TemplateRenderer';
import ErrorBoundary    from './components/ErrorBoundary';
import { BusinessProvider, useBusinessConfig } from './contexts/BusinessContext';
import { loadBusiness, listBusinesses } from './utils/BusinessLoader';
import { applyTheme }   from './utils/theme';

// ── Code-split heavy pages — loaded only when first visited ──────────────────
const Landing    = lazy(() => import('./pages/Landing'));
const Start      = lazy(() => import('./pages/Start'));
const Plans      = lazy(() => import('./pages/Plans'));
const Checkout   = lazy(() => import('./pages/Checkout'));
const Register   = lazy(() => import('./pages/Register'));
const Onboarding = lazy(() => import('./pages/Onboarding'));
const ManageStore = lazy(() => import('./pages/ManageStore'));
const Terms      = lazy(() => import('./pages/Terms'));
const Privacy    = lazy(() => import('./pages/Privacy'));
const NotFound   = lazy(() => import('./pages/NotFound'));

function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-8 h-8 border-4 border-gray-200 border-t-gray-700 rounded-full animate-spin" />
    </div>
  );
}

function ThemeApplier() {
  const { theme } = useBusinessConfig();
  useEffect(() => { applyTheme(theme); }, [theme]);
  return null;
}

/** Full-screen loading spinner shown while fetching store from DB */
function LoadingScreen() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 gap-4">
      <div className="w-10 h-10 border-4 border-brand border-t-transparent
                      rounded-full animate-spin" />
      <p className="text-sm text-gray-400 font-medium">Loading page…</p>
    </div>
  );
}

/** Demo store shell — loads config from static REGISTRY, never from DB */
function DemoShell() {
  const { demoSlug } = useParams();
  const [cartOpen,  setCartOpen]  = useState(false);
  const [cartCount, setCartCount] = useState(0);
  const handleCartCountChange = useCallback((c) => setCartCount(c), []);

  // Look up the demo config from the in-memory registry (synchronous)
  const allDemos = listBusinesses();
  const config   = allDemos.find(b => b.slug === demoSlug) ?? null;

  // Unknown demo slug — render 404 inline (NotFound is already lazy-loaded above)
  if (!config) return <NotFound slug={demoSlug} />;

  // Strip the slug so Footer doesn't show a "Manage Store" link for demo stores
  const demoConfig = { ...config, slug: null };

  return (
    <BusinessProvider config={demoConfig}>
      <ThemeApplier />
      {/* Demo ribbon */}
      <div className="w-full bg-amber-500 text-white text-center text-xs font-bold py-1.5 px-4 z-[60] relative">
        👁️ Demo page — <a href="/start" className="underline underline-offset-2">create your own free page →</a>
      </div>
      <div className="min-h-screen flex flex-col bg-[#f8fafc] overflow-x-hidden w-full">
        <Header cartCount={cartCount} onCartOpen={() => setCartOpen(true)} />
        <main className="flex-1">
          <TemplateRenderer
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

function BusinessShell() {
  const { businessSlug } = useParams();
  const [config,   setConfig]   = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [cartOpen,  setCartOpen]  = useState(false);
  const [cartCount, setCartCount] = useState(0);

  const handleCartCountChange = useCallback((c) => setCartCount(c), []);

  useEffect(() => {
    setLoading(true);
    setNotFound(false);
    setConfig(null);

    loadBusiness(businessSlug).then((cfg) => {
      if (cfg) setConfig(cfg);
      else     setNotFound(true);
      setLoading(false);
    });
  }, [businessSlug]);

  if (loading)  return <LoadingScreen />;
  if (notFound) return <NotFound slug={businessSlug} />;

  return (
    <BusinessProvider config={config}>
      <ThemeApplier />
      <div className="min-h-screen flex flex-col bg-[#f8fafc] overflow-x-hidden w-full">
        <Header cartCount={cartCount} onCartOpen={() => setCartOpen(true)} />
        <main className="flex-1">
          <TemplateRenderer
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

export default function App() {
  return (
    <BrowserRouter>
      <ErrorBoundary>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/"                      element={<Landing />} />
            <Route path="/start"                 element={<Start />} />
            <Route path="/plans"                 element={<Plans />} />
            <Route path="/checkout/:plan"        element={<Checkout />} />
            <Route path="/register"              element={<Register />} />
            <Route path="/onboarding"            element={<Onboarding />} />
            <Route path="/terms"                 element={<Terms />} />
            <Route path="/privacy"               element={<Privacy />} />
            <Route path="/demo/:demoSlug"        element={<ErrorBoundary><DemoShell /></ErrorBoundary>} />
            <Route path="/:businessSlug/manage"  element={<ErrorBoundary><ManageStore /></ErrorBoundary>} />
            <Route path="/:businessSlug"         element={<ErrorBoundary><BusinessShell /></ErrorBoundary>} />
            <Route path="*"                      element={<NotFound />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </BrowserRouter>
  );
}

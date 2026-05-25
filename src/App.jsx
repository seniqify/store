import { useState, useEffect, useCallback } from 'react';
import { BrowserRouter, Routes, Route, useParams } from 'react-router-dom';
import Header        from './components/layout/Header';
import Footer        from './components/layout/Footer';
import Home          from './pages/Home';
import Landing       from './pages/Landing';
import Onboarding    from './pages/Onboarding';
import ManageStore   from './pages/ManageStore';
import NotFound      from './pages/NotFound';
import ErrorBoundary from './components/ErrorBoundary';
import { BusinessProvider, useBusinessConfig } from './contexts/BusinessContext';
import { loadBusiness } from './utils/BusinessLoader';
import { applyTheme }   from './utils/theme';

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
      <p className="text-sm text-gray-400 font-medium">Loading store…</p>
    </div>
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

export default function App() {
  return (
    <BrowserRouter>
      <ErrorBoundary>
        <Routes>
          <Route path="/"                      element={<Landing />} />
          <Route path="/onboarding"            element={<Onboarding />} />
          <Route path="/:businessSlug/manage"  element={<ErrorBoundary><ManageStore /></ErrorBoundary>} />
          <Route path="/:businessSlug"         element={<ErrorBoundary><BusinessShell /></ErrorBoundary>} />
          <Route path="*"                      element={<NotFound />} />
        </Routes>
      </ErrorBoundary>
    </BrowserRouter>
  );
}

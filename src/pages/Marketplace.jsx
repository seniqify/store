import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Search, Sparkles, Store } from 'lucide-react';
import { listStores } from '../utils/storeService';
import { listBusinesses } from '../utils/BusinessLoader';
import { normalizeBusiness, CATEGORIES } from '../utils/marketplace';
import BusinessCard from '../components/marketplace/BusinessCard';

const WA = '#25D366';

export default function Marketplace() {
  const [businesses, setBusinesses] = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [query,      setQuery]      = useState('');
  const [category,   setCategory]   = useState('All');
  const [city,       setCity]       = useState('All');

  // Read-only: real stores from the DB + static demo stores as seed examples.
  useEffect(() => {
    let alive = true;
    (async () => {
      const real  = (await listStores()).map((c) => normalizeBusiness(c, { demo: false }));
      const seen  = new Set(real.map((b) => b.slug));
      const demos = listBusinesses()
        .map((c) => normalizeBusiness(c, { demo: true }))
        .filter((d) => !seen.has(d.slug));
      if (alive) {
        setBusinesses([...real, ...demos]);
        setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const cities = useMemo(() => {
    const set = new Set(businesses.map((b) => b.city).filter(Boolean));
    return ['All', ...Array.from(set).sort()];
  }, [businesses]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return businesses.filter((b) => {
      if (category !== 'All' && b.category !== category) return false;
      if (city !== 'All' && b.city !== city) return false;
      if (!q) return true;
      return [b.name, b.category, b.city, b.location, b.tagline]
        .filter(Boolean).some((f) => f.toLowerCase().includes(q));
    });
  }, [businesses, query, category, city]);

  return (
    <div className="min-h-screen bg-[#f8fafc]">

      {/* ── Dark emerald hero (matches /plans + landing) ─────────────────────── */}
      <div className="relative overflow-hidden"
           style={{ background: 'linear-gradient(170deg, #061310 0%, #0a2a20 50%, #05110d 100%)' }}>
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-[-6rem] left-1/2 -translate-x-1/2 w-[40rem] h-[24rem] rounded-full blur-[120px] animate-pl-aurora"
               style={{ background: 'radial-gradient(circle, rgba(16,185,129,0.30), transparent 65%)' }} />
        </div>

        {/* Nav */}
        <nav className="relative z-10 border-b border-white/10 backdrop-blur-md">
          <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
            <Link to="/"><img src="/pocketlink-logo.svg" alt="PocketLink" className="h-8 w-auto brightness-0 invert" /></Link>
            <Link to="/start"
              className="inline-flex items-center gap-1.5 text-white text-sm font-bold px-4 py-2 rounded-xl
                         shadow-lg shadow-emerald-500/30 active:scale-[0.98]"
              style={{ backgroundColor: WA }}>
              List Your Business Free
            </Link>
          </div>
        </nav>

        {/* Hero copy + search */}
        <div className="relative z-10 max-w-4xl mx-auto px-4 pt-12 pb-10 text-center">
          <span className="inline-flex items-center gap-2 bg-white/5 border border-white/15 text-emerald-300
                           text-[11px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-full mb-5">
            <Sparkles size={12} /> Local business finder
          </span>
          <h1 className="text-3xl sm:text-5xl font-extrabold text-white tracking-tight mb-3">
            Discover Local Businesses{' '}
            <span className="bg-gradient-to-r from-emerald-300 to-teal-300 bg-clip-text text-transparent">Near You</span>
          </h1>
          <p className="text-white/55 text-sm sm:text-base max-w-lg mx-auto mb-7">
            Browse shops, eateries and services around you — and order directly on WhatsApp. No app, no login.
          </p>

          <div className="relative max-w-xl mx-auto">
            <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, category or area…"
              className="w-full pl-11 pr-4 py-3.5 rounded-2xl bg-white text-gray-900 placeholder-gray-400 text-sm
                         shadow-xl focus:outline-none focus:ring-2 focus:ring-emerald-400" />
          </div>
        </div>
      </div>

      {/* ── Sticky filter bar ────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-20 bg-white/90 backdrop-blur border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <div className="flex-1 flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {['All', ...CATEGORIES].map((c) => (
              <button key={c} onClick={() => setCategory(c)}
                className={[
                  'flex-shrink-0 px-3.5 py-1.5 rounded-full text-xs font-semibold border transition-colors',
                  category === c
                    ? 'bg-gray-900 text-white border-gray-900'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300',
                ].join(' ')}>
                {c}
              </button>
            ))}
          </div>
          <select value={city} onChange={(e) => setCity(e.target.value)}
            className="flex-shrink-0 text-xs font-semibold text-gray-700 border border-gray-200 rounded-full
                       px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-400">
            {cities.map((c) => <option key={c} value={c}>{c === 'All' ? 'All areas' : c}</option>)}
          </select>
        </div>
      </div>

      {/* ── Results ──────────────────────────────────────────────────────────── */}
      <div className="max-w-6xl mx-auto px-4 py-8">
        {loading ? (
          <div className="py-24 flex justify-center">
            <div className="w-8 h-8 border-4 border-gray-200 border-t-emerald-500 rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState hasAny={businesses.length > 0} />
        ) : (
          <>
            <p className="text-xs font-medium text-gray-400 mb-4">
              {filtered.length} {filtered.length === 1 ? 'business' : 'businesses'}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filtered.map((b) => <BusinessCard key={b.href} biz={b} />)}
            </div>
          </>
        )}
      </div>

      {/* ── List-your-business CTA ───────────────────────────────────────────── */}
      <div className="max-w-6xl mx-auto px-4 pb-14">
        <div className="rounded-3xl bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-100 p-7 sm:p-9 text-center">
          <Store size={26} className="mx-auto text-emerald-600 mb-3" />
          <h3 className="text-lg sm:text-xl font-extrabold text-gray-900">Own a business?</h3>
          <p className="text-sm text-gray-500 mt-1.5 mb-5 max-w-md mx-auto">
            Get your own WhatsApp store page and get discovered right here — free, live in 2 minutes.
          </p>
          <Link to="/start"
            className="inline-flex items-center gap-2 text-white font-bold text-sm px-6 py-3 rounded-xl
                       shadow-lg shadow-emerald-500/30 active:scale-[0.98]"
            style={{ backgroundColor: WA }}>
            List Your Business Free
          </Link>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ hasAny }) {
  return (
    <div className="py-16 text-center">
      <div className="text-4xl mb-3">🔍</div>
      <p className="font-bold text-gray-800">
        {hasAny ? 'No businesses match your search' : 'No businesses listed yet'}
      </p>
      <p className="text-sm text-gray-400 mt-1">
        {hasAny ? 'Try a different category or area.' : 'Be the first to list your business.'}
      </p>
      {!hasAny && (
        <Link to="/start" className="inline-block mt-4 text-emerald-600 font-bold text-sm hover:text-emerald-700">
          List your business free →
        </Link>
      )}
    </div>
  );
}

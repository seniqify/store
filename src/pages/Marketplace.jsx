import { useState, useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Search, Sparkles, Store, ArrowRight, X, MapPin, MessageCircle, ChevronDown } from 'lucide-react';
import { listStores } from '../utils/storeService';
import { listBusinesses } from '../utils/BusinessLoader';
import { normalizeBusiness } from '../utils/marketplace';
import { categoryMeta } from '../utils/businessCategories';
import { whatsappLink } from '../utils/theme';
import BusinessCard from '../components/marketplace/BusinessCard';

/**
 * Marketplace — the consumer-facing discovery app at market.pocketlink.store.
 * Deliberately utility-first (think food-delivery app, not startup landing):
 * compact app bar, search up top, sticky category chips, shops immediately.
 * Merchant acquisition lives on the main domain — only a quiet CTA here.
 */

const WA = '#25D366';
const SUGGESTIONS = ['Boutiques', 'Cafés', 'Salons', 'Grocery', 'Electronics', 'Bakery'];

/* ── Reveal-on-scroll wrapper (fades + rises into view once) ──────────────── */
function Reveal({ children, delay = 0, className = '' }) {
  const ref = useRef(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') { setShown(true); return; }
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { setShown(true); obs.disconnect(); }
    }, { threshold: 0.1 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return (
    <div ref={ref} className={className}
         style={{
           opacity: shown ? 1 : 0,
           transform: shown ? 'none' : 'translateY(22px)',
           transition: `opacity .55s ease ${delay}s, transform .55s cubic-bezier(.22,1,.36,1) ${delay}s`,
         }}>
      {children}
    </div>
  );
}

export default function Marketplace() {
  const [businesses, setBusinesses] = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [query, setQuery] = useState(() =>
    (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('q')) || '');
  const [category,   setCategory]   = useState('All');
  const [city,       setCity]       = useState('All');

  // Set the document title for SPA navigation (direct loads get it from the server).
  useEffect(() => {
    const prevTitle = document.title;
    document.title = 'Discover Local Businesses Near You | PocketLink Marketplace';
    return () => { document.title = prevTitle; };
  }, []);

  // Read-only: real stores from the DB + static demo stores as seed examples.
  useEffect(() => {
    let alive = true;
    (async () => {
      const real  = (await listStores()).map((c) => normalizeBusiness(c, { demo: false }));
      const seen  = new Set(real.map((b) => b.slug));
      const demos = listBusinesses()
        .map((c) => normalizeBusiness(c, { demo: true }))
        .filter((d) => !seen.has(d.slug));
      if (alive) { setBusinesses([...real, ...demos]); setLoading(false); }
    })();
    return () => { alive = false; };
  }, []);

  const cities = useMemo(() => {
    const set = new Set(businesses.map((b) => b.city).filter(Boolean));
    return ['All', ...Array.from(set).sort()];
  }, [businesses]);

  const countByCategory = useMemo(() => {
    const m = {};
    for (const b of businesses) m[b.category] = (m[b.category] || 0) + 1;
    return m;
  }, [businesses]);

  // Only show categories that actually have businesses, most-listed first.
  const presentCategories = useMemo(
    () => Object.keys(countByCategory).sort((a, b) => countByCategory[b] - countByCategory[a]),
    [countByCategory],
  );

  // Featured = image-forward businesses first (fall back to whatever exists), capped.
  const featured = useMemo(() => {
    const withCover = businesses.filter((b) => b.coverImage);
    return (withCover.length ? withCover : businesses).slice(0, 8);
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

  const hasFilters = query || category !== 'All' || city !== 'All';
  const clearFilters = () => { setQuery(''); setCategory('All'); setCity('All'); };
  const showBrowse = !query;   // searching: skip straight to results

  return (
    <div className="min-h-screen bg-[#f8fafc]">

      {/* ════════ App bar ════════ */}
      <header className="sticky top-0 z-40 bg-white/90 backdrop-blur-md border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
          <Link to="/" className="flex-shrink-0">
            <img src="/pocketlink-logo.svg" alt="PocketLink" className="h-7 w-auto" />
          </Link>

          {/* Area picker — the one global control customers reach for */}
          <div className="relative">
            <MapPin size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-emerald-600 pointer-events-none" />
            <select value={city} onChange={(e) => setCity(e.target.value)} aria-label="Choose your area"
              className="appearance-none text-xs font-bold text-gray-800 bg-emerald-50 border border-emerald-100
                         rounded-full pl-7 pr-7 py-2 max-w-[10rem] truncate focus:outline-none focus:ring-2 focus:ring-emerald-300">
              {cities.map((c) => <option key={c} value={c}>{c === 'All' ? 'All areas' : c}</option>)}
            </select>
            <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-emerald-600 pointer-events-none" />
          </div>

          <a href="https://www.pocketlink.store/start"
             className="flex-shrink-0 text-[11px] sm:text-xs font-bold text-gray-400 hover:text-gray-700 transition-colors">
            Own a shop? <span className="text-emerald-600">List free →</span>
          </a>
        </div>
      </header>

      {/* ════════ Search hero — light, short, utility-first ════════ */}
      <div className="relative overflow-hidden border-b border-gray-100 bg-white">
        <div className="absolute inset-0 pointer-events-none"
             style={{ background: 'radial-gradient(60% 120% at 50% -20%, rgba(16,185,129,0.10), transparent 70%)' }} />
        <div className="relative max-w-2xl mx-auto px-4 pt-8 sm:pt-12 pb-7 text-center">
          <h1 className="text-2xl sm:text-4xl font-extrabold text-gray-900 tracking-tight leading-tight">
            Discover local businesses <span className="text-emerald-600">near you</span>
          </h1>
          <p className="text-gray-500 text-sm sm:text-base mt-2 mb-6">
            Order from neighbourhood shops on WhatsApp — no app, no login, 0% commission.
          </p>

          {/* Search */}
          <div className="relative max-w-xl mx-auto">
            <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search shops, food, salons, services…"
              className="w-full pl-11 pr-10 py-3.5 rounded-2xl bg-white text-gray-900 placeholder-gray-400 text-sm sm:text-base
                         border border-gray-200 shadow-[0_8px_30px_rgba(0,0,0,0.06)]
                         focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-transparent transition-all" />
            {query && (
              <button onClick={() => setQuery('')} aria-label="Clear search"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500">
                <X size={18} />
              </button>
            )}
          </div>

          {/* Suggestion chips */}
          <div className="flex flex-wrap items-center justify-center gap-2 mt-3.5">
            {SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => setQuery(s)}
                className="text-xs font-semibold text-gray-600 bg-gray-50 border border-gray-200 rounded-full px-3 py-1
                           hover:border-emerald-300 hover:text-emerald-700 hover:bg-emerald-50 transition-colors">
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ════════ Sticky category chips (below the app bar) ════════ */}
      <div id="results" className="sticky top-14 z-30 bg-[#f8fafc]/95 backdrop-blur-md border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-4 py-2.5 flex gap-2 overflow-x-auto scrollbar-hide">
          {['All', ...presentCategories].map((c) => {
            const active = category === c;
            const meta = c === 'All' ? { emoji: '✨' } : categoryMeta(c);
            const count = c === 'All' ? businesses.length : (countByCategory[c] || 0);
            return (
              <button key={c} onClick={() => setCategory(c)}
                className={[
                  'flex-shrink-0 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-bold border transition-all active:scale-95',
                  active ? 'bg-gray-900 text-white border-gray-900 shadow-md'
                         : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300',
                ].join(' ')}>
                <span className="text-sm leading-none">{meta.emoji}</span> {c}
                <span className={['text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none',
                                  active ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-400'].join(' ')}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ════════ Featured strip (hidden while searching/filtering) ════════ */}
      {!loading && showBrowse && category === 'All' && featured.length > 0 && (
        <section className="max-w-6xl mx-auto px-4 pt-7">
          <Reveal>
            <div className="flex items-end justify-between mb-4">
              <h2 className="text-lg sm:text-xl font-extrabold text-gray-900 flex items-center gap-2">
                <Sparkles size={18} className="text-emerald-500" /> Featured shops
              </h2>
              <span className="hidden sm:inline text-xs font-semibold text-gray-300">swipe →</span>
            </div>
          </Reveal>
          <Reveal>
            <div className="flex gap-4 overflow-x-auto scrollbar-hide snap-x snap-mandatory pb-2 -mx-4 px-4">
              {featured.map((b) => <FeaturedCard key={b.href} biz={b} />)}
            </div>
          </Reveal>
        </section>
      )}

      {/* ════════ Results ════════ */}
      <div className="max-w-6xl mx-auto px-4 py-7 min-h-[40vh]">
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="rounded-3xl border border-gray-100 overflow-hidden bg-white">
                <div className="h-28 bg-gray-100 animate-pulse" />
                <div className="p-4 space-y-2">
                  <div className="w-14 h-14 -mt-10 rounded-2xl bg-gray-200 ring-4 ring-white animate-pulse" />
                  <div className="h-3.5 bg-gray-200 rounded w-2/3 animate-pulse" />
                  <div className="h-3 bg-gray-100 rounded w-full animate-pulse" />
                  <div className="h-9 bg-gray-100 rounded-xl animate-pulse mt-3" />
                </div>
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState hasAny={businesses.length > 0} onClear={clearFilters} hasFilters={hasFilters} />
        ) : (
          <>
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-bold text-gray-900">
                {query ? `Results for “${query.trim()}”` : category !== 'All' ? category : 'All shops'}
                <span className="text-gray-400 font-medium"> · {filtered.length}</span>
              </p>
              {hasFilters && (
                <button onClick={clearFilters} className="text-xs font-semibold text-emerald-600 hover:text-emerald-700 inline-flex items-center gap-1">
                  <X size={13} /> Clear
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filtered.map((b, i) => (
                <Reveal key={b.href} delay={Math.min(i, 7) * 0.05}>
                  <BusinessCard biz={b} />
                </Reveal>
              ))}
            </div>
          </>
        )}
      </div>

      {/* ════════ Trust strip ════════ */}
      <div className="max-w-6xl mx-auto px-4 pb-10">
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 rounded-2xl bg-white border border-gray-100 px-5 py-4">
          {[['💬', 'Order on WhatsApp'], ['🆓', 'No app needed'], ['💸', '0% commission'], ['🏪', 'Direct from the owner']].map(([e, t]) => (
            <span key={t} className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-600">
              <span>{e}</span> {t}
            </span>
          ))}
        </div>
      </div>

      {/* ════════ Quiet merchant CTA ════════ */}
      <div className="max-w-6xl mx-auto px-4 pb-12">
        <Reveal>
          <div className="relative overflow-hidden rounded-3xl p-7 sm:p-9 flex flex-col sm:flex-row items-center justify-between gap-5"
               style={{ background: 'linear-gradient(135deg, #064e3b 0%, #0d9488 70%)' }}>
            <div className="absolute -top-10 -right-10 w-44 h-44 rounded-full bg-white/10 blur-2xl" />
            <div className="relative text-center sm:text-left">
              <h3 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight">Own a business?</h3>
              <p className="text-sm text-white/75 mt-1.5 max-w-md">
                Get your own WhatsApp store page and get discovered right here — free, live in 2 minutes.
              </p>
            </div>
            <a href="https://www.pocketlink.store/start"
               className="relative flex-shrink-0 inline-flex items-center gap-2 bg-white text-emerald-700 font-bold text-sm
                          px-6 py-3 rounded-2xl shadow-xl hover:-translate-y-0.5 active:scale-[0.98] transition-all">
              List Your Business Free <ArrowRight size={16} />
            </a>
          </div>
        </Reveal>
      </div>

      <MarketplaceFooter />
    </div>
  );
}

function EmptyState({ hasAny, hasFilters, onClear }) {
  return (
    <div className="py-16 text-center">
      <div className="text-5xl mb-3">🔍</div>
      <p className="font-bold text-gray-800 text-lg">
        {hasAny ? 'No businesses match your search' : 'No businesses listed yet'}
      </p>
      <p className="text-sm text-gray-400 mt-1">
        {hasAny ? 'Try a different category or area.' : 'Be the first to list your business.'}
      </p>
      {hasAny && hasFilters && (
        <button onClick={onClear}
          className="inline-flex items-center gap-1.5 mt-4 text-sm font-bold text-emerald-600 hover:text-emerald-700">
          <X size={15} /> Clear filters
        </button>
      )}
      {!hasAny && (
        <a href="https://www.pocketlink.store/start" className="inline-block mt-4 text-emerald-600 font-bold text-sm hover:text-emerald-700">
          List your business free →
        </a>
      )}
    </div>
  );
}

/* ── Featured carousel card (image-forward, name overlaid on the banner) ──── */
function FeaturedCard({ biz }) {
  const waHref = biz.whatsappNumber ? whatsappLink(biz.whatsappNumber, biz.name) : null;
  const meta   = categoryMeta(biz.category);
  const onWhatsApp = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (waHref) window.open(waHref, '_blank', 'noopener,noreferrer');
  };

  return (
    <Link to={biz.href}
      className="group relative flex-shrink-0 w-[270px] sm:w-[300px] snap-start rounded-3xl overflow-hidden
                 bg-white border border-gray-100 shadow-sm transition-all duration-300 hover:-translate-y-1.5
                 hover:shadow-[0_24px_50px_-12px_rgba(16,185,129,0.30)]">
      <div className="relative h-40 overflow-hidden">
        {biz.coverImage ? (
          <img src={biz.coverImage} alt="" loading="lazy"
               className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" />
        ) : (
          <div className="w-full h-full transition-transform duration-500 group-hover:scale-110"
               style={{ background: `linear-gradient(135deg, ${biz.primary}, ${biz.primaryDark})` }} />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />

        <span className="absolute top-3 right-3 inline-flex items-center gap-1 text-[10px] font-bold text-white px-2 py-0.5 rounded-full shadow"
              style={{ background: `linear-gradient(135deg, ${meta.grad[0]}, ${meta.grad[1]})` }}>
          <span>{meta.emoji}</span> {biz.category}
        </span>

        <div className="absolute bottom-0 inset-x-0 p-3.5 flex items-end gap-2.5">
          <div className="w-11 h-11 rounded-xl ring-2 ring-white/80 overflow-hidden bg-white flex items-center justify-center text-xl flex-shrink-0"
               style={!biz.logo ? { background: `linear-gradient(135deg, ${biz.primary}, ${biz.primaryDark})` } : undefined}>
            {biz.logo
              ? <img src={biz.logo} alt={biz.name} className="w-full h-full object-cover" loading="lazy" />
              : <span>{biz.logoEmoji}</span>}
          </div>
          <div className="min-w-0 pb-0.5">
            <h3 className="text-white font-extrabold text-sm leading-tight truncate drop-shadow">{biz.name}</h3>
            {(biz.city || biz.state) && (
              <p className="text-white/85 text-[11px] flex items-center gap-1 truncate">
                <MapPin size={11} className="flex-shrink-0" /> {[biz.city, biz.state].filter(Boolean).join(', ')}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="p-3.5">
        <p className="text-xs text-gray-500 line-clamp-2 min-h-[2rem] mb-3">{biz.tagline}</p>
        <div className="flex items-stretch gap-2">
          <span className="flex-1 inline-flex items-center justify-center gap-1 text-xs font-bold text-white rounded-xl py-2.5"
                style={{ background: `linear-gradient(135deg, ${biz.primary}, ${biz.primaryDark})` }}>
            Visit shop <ArrowRight size={13} />
          </span>
          {waHref && (
            <button type="button" onClick={onWhatsApp} aria-label="Chat on WhatsApp"
              className="flex-shrink-0 inline-flex items-center justify-center rounded-xl w-11 text-white transition-transform hover:scale-110 active:scale-95"
              style={{ backgroundColor: WA }}>
              <MessageCircle size={17} />
            </button>
          )}
        </div>
      </div>
    </Link>
  );
}

/* ── Footer (slim, consumer-toned) ────────────────────────────────────────── */
function MarketplaceFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="bg-white border-t border-gray-100">
      <div className="max-w-6xl mx-auto px-4 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <img src="/pocketlink-logo.svg" alt="PocketLink" className="h-6 w-auto" />
          <span className="text-xs text-gray-400">© {year} · Made in India 🇮🇳</span>
        </div>
        <div className="flex items-center gap-5 text-xs font-semibold text-gray-400">
          <a href="https://www.pocketlink.store/start" className="hover:text-emerald-600 transition-colors inline-flex items-center gap-1">
            <Store size={12} /> List your business
          </a>
          <a href="https://www.pocketlink.store/terms" className="hover:text-gray-600 transition-colors">Terms</a>
          <a href="https://www.pocketlink.store/privacy" className="hover:text-gray-600 transition-colors">Privacy</a>
        </div>
      </div>
    </footer>
  );
}

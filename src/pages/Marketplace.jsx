import { useState, useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Search, Sparkles, Store, ArrowRight, X } from 'lucide-react';
import { listStores } from '../utils/storeService';
import { listBusinesses } from '../utils/BusinessLoader';
import { normalizeBusiness, CATEGORIES, CATEGORY_META } from '../utils/marketplace';
import BusinessCard from '../components/marketplace/BusinessCard';

const WA = '#25D366';
const ROTATING = ['Boutiques', 'Cafés', 'Salons', 'Grocers', 'Lodges', 'Studios'];
const SUGGESTIONS = ['Boutiques', 'Cafés', 'Salons', 'Grocery', 'Electronics'];
const MARQUEE = [
  { e: '🛒', t: 'Kirana' }, { e: '🍰', t: 'Bakeries' }, { e: '🍽️', t: 'Restaurants' },
  { e: '💐', t: 'Florists' }, { e: '🔧', t: 'Repairs' }, { e: '🏨', t: 'Lodges' },
  { e: '👗', t: 'Boutiques' }, { e: '💇', t: 'Salons' }, { e: '💼', t: 'Consultants' },
  { e: '📱', t: 'Electronics' }, { e: '🧵', t: 'Wholesalers' }, { e: '🎨', t: 'Designers' },
];

/* ── Rotating gradient word in the hero headline ─────────────────────────── */
function RotatingWord() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((x) => (x + 1) % ROTATING.length), 2200);
    return () => clearInterval(t);
  }, []);
  return (
    <span key={i} className="inline-block pl-rise pl-shimmer-text bg-clip-text text-transparent"
          style={{ backgroundImage: 'linear-gradient(90deg,#34d399,#5eead4,#25D366,#34d399)' }}>
      {ROTATING[i]}
    </span>
  );
}

/* ── Count-up number for the stat strip ──────────────────────────────────── */
function CountUp({ to, suffix = '', duration = 1100 }) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!to) { setVal(0); return; }
    let raf; const start = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - start) / duration);
      setVal(Math.round((1 - Math.pow(1 - p, 3)) * to));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, duration]);
  return <>{val}{suffix}</>;
}

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
           transform: shown ? 'none' : 'translateY(26px)',
           transition: `opacity .6s ease ${delay}s, transform .6s cubic-bezier(.22,1,.36,1) ${delay}s`,
         }}>
      {children}
    </div>
  );
}

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

  const pickCategory = (c) => {
    setCategory(c);
    setTimeout(() => document.getElementById('results')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  };

  const hasFilters = query || category !== 'All' || city !== 'All';
  const clearFilters = () => { setQuery(''); setCategory('All'); setCity('All'); };

  return (
    <div className="min-h-screen bg-[#f8fafc]">

      {/* ════════ Animated dark hero ════════ */}
      <div className="relative overflow-hidden"
           style={{ background: 'linear-gradient(170deg, #061310 0%, #0a2a20 48%, #05110d 100%)' }}>
        {/* Aurora + grid */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-[-8rem] left-1/4 w-[34rem] h-[24rem] rounded-full blur-[120px] animate-pl-aurora"
               style={{ background: 'radial-gradient(circle, rgba(16,185,129,0.34), transparent 65%)' }} />
          <div className="absolute top-[2rem] right-[-6rem] w-[28rem] h-[22rem] rounded-full blur-[120px] animate-pl-aurora"
               style={{ background: 'radial-gradient(circle, rgba(45,212,191,0.22), transparent 65%)', animationDelay: '6s' }} />
          <div className="absolute inset-0 opacity-[0.05]"
               style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,.6) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.6) 1px,transparent 1px)', backgroundSize: '46px 46px', maskImage: 'radial-gradient(ellipse 80% 55% at 50% 20%, #000, transparent 75%)' }} />
        </div>

        {/* Nav */}
        <nav className="relative z-10 border-b border-white/10 backdrop-blur-md">
          <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
            <Link to="/"><img src="/pocketlink-logo.svg" alt="PocketLink" className="h-8 w-auto brightness-0 invert" /></Link>
            <Link to="/start"
              className="group relative inline-flex items-center gap-1.5 text-white text-sm font-bold px-4 py-2 rounded-xl
                         shadow-lg shadow-emerald-500/30 active:scale-[0.98] overflow-hidden"
              style={{ backgroundColor: WA }}>
              <span className="absolute inset-0 overflow-hidden rounded-xl">
                <span className="absolute top-0 h-full w-1/3 bg-white/30 blur-md -skew-x-12 -translate-x-[180%] group-hover:translate-x-[420%] transition-transform duration-700" />
              </span>
              <Store size={14} className="relative" />
              <span className="relative hidden sm:inline">List Your Business Free</span>
              <span className="relative sm:hidden">List Free</span>
            </Link>
          </div>
        </nav>

        {/* Hero copy + search */}
        <div className="relative z-10 max-w-4xl mx-auto px-4 pt-12 sm:pt-16 pb-12 text-center">
          <span className="inline-flex items-center gap-2 bg-white/5 border border-white/15 text-emerald-300
                           text-[11px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-full mb-6 pl-rise">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400" />
            </span>
            Local finder · 0% commission
          </span>

          <h1 className="text-[2.4rem] sm:text-6xl font-extrabold text-white tracking-tight leading-[1.05] mb-4 pl-rise"
              style={{ animationDelay: '.08s' }}>
            Discover Local <RotatingWord /><br className="hidden sm:block" /> Near You
          </h1>

          <p className="text-white/55 text-sm sm:text-lg max-w-lg mx-auto mb-8 pl-rise" style={{ animationDelay: '.16s' }}>
            Browse shops, eateries and services around you — and order directly on WhatsApp. No app, no login.
          </p>

          {/* Glowing search */}
          <div className="relative max-w-xl mx-auto pl-rise" style={{ animationDelay: '.24s' }}>
            <div className="absolute -inset-1 rounded-2xl bg-emerald-500/20 blur-xl animate-pl-glow pointer-events-none" />
            <div className="relative">
              <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by name, category or area…"
                className="w-full pl-11 pr-10 py-4 rounded-2xl bg-white text-gray-900 placeholder-gray-400 text-sm sm:text-base
                           shadow-xl focus:outline-none focus:ring-2 focus:ring-emerald-400" />
              {query && (
                <button onClick={() => setQuery('')} aria-label="Clear"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-300 hover:text-gray-500">
                  <X size={18} />
                </button>
              )}
            </div>
          </div>

          {/* Suggestion chips */}
          <div className="flex flex-wrap items-center justify-center gap-2 mt-4 pl-rise" style={{ animationDelay: '.3s' }}>
            <span className="text-xs text-white/40">Try:</span>
            {SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => setQuery(s)}
                className="text-xs font-semibold text-white/75 bg-white/5 border border-white/15 rounded-full px-3 py-1
                           hover:bg-white/10 hover:text-white transition-colors">
                {s}
              </button>
            ))}
          </div>

          {/* Stats */}
          <div className="flex items-center justify-center gap-6 sm:gap-10 mt-9 pl-rise" style={{ animationDelay: '.36s' }}>
            <Stat value={<CountUp to={businesses.length} suffix="+" />} label="Businesses" />
            <span className="w-px h-8 bg-white/10" />
            <Stat value={<CountUp to={Math.max(cities.length - 1, 0)} />} label="Areas" />
            <span className="w-px h-8 bg-white/10" />
            <Stat value="0%" label="Commission" />
          </div>
        </div>

        {/* Emoji marquee */}
        <div className="relative z-10 pb-6 overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_12%,#000_88%,transparent)]">
          <div className="flex gap-2.5 w-max animate-pl-marquee-slow">
            {[...MARQUEE, ...MARQUEE].map((m, i) => (
              <span key={i} className="flex-shrink-0 inline-flex items-center gap-1.5 text-xs font-semibold text-white/70
                                       bg-white/5 border border-white/10 rounded-full px-3 py-1.5">
                <span>{m.e}</span> {m.t}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ════════ Browse by category ════════ */}
      <section className="max-w-6xl mx-auto px-4 pt-10 sm:pt-12">
        <Reveal>
          <h2 className="text-xl sm:text-2xl font-extrabold text-gray-900 text-center">Browse by category</h2>
          <p className="text-sm text-gray-400 text-center mt-1 mb-6">Tap a category to jump in</p>
        </Reveal>
        <div className="grid grid-cols-4 lg:grid-cols-8 gap-2.5 sm:gap-3">
          {CATEGORIES.map((c, i) => {
            const meta = CATEGORY_META[c];
            const count = countByCategory[c] || 0;
            return (
              <Reveal key={c} delay={i * 0.04}>
                <button onClick={() => pickCategory(c)}
                  className="group relative w-full overflow-hidden rounded-2xl py-4 flex flex-col items-center justify-center gap-1
                             text-white shadow-sm hover:shadow-xl hover:-translate-y-1 active:scale-95 transition-all duration-200"
                  style={{ background: `linear-gradient(140deg, ${meta.grad[0]}, ${meta.grad[1]})` }}>
                  <span className="absolute inset-0 overflow-hidden rounded-2xl">
                    <span className="absolute top-0 h-full w-1/3 bg-white/25 blur-md -skew-x-12 -translate-x-[180%] group-hover:translate-x-[420%] transition-transform duration-700" />
                  </span>
                  <span className="relative text-2xl sm:text-[1.7rem] transition-transform group-hover:scale-110">{meta.emoji}</span>
                  <span className="relative text-[11px] sm:text-xs font-bold leading-none">{c}</span>
                  <span className="relative text-[9px] font-semibold text-white/80 leading-none">
                    {count > 0 ? `${count} listed` : '—'}
                  </span>
                </button>
              </Reveal>
            );
          })}
        </div>
      </section>

      {/* ════════ Sticky filter bar ════════ */}
      <div id="results" className="sticky top-0 z-20 mt-10 bg-white/85 backdrop-blur-md border-y border-gray-100">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <div className="flex-1 flex gap-2 overflow-x-auto scrollbar-hide">
            {['All', ...CATEGORIES].map((c) => {
              const active = category === c;
              const meta = CATEGORY_META[c];
              return (
                <button key={c} onClick={() => setCategory(c)}
                  className={[
                    'flex-shrink-0 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold border transition-all',
                    active ? 'bg-gray-900 text-white border-gray-900 shadow-sm scale-105'
                           : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300 hover:bg-gray-50',
                  ].join(' ')}>
                  <span>{meta.emoji}</span> {c}
                </button>
              );
            })}
          </div>
          <select value={city} onChange={(e) => setCity(e.target.value)}
            className="flex-shrink-0 text-xs font-semibold text-gray-700 border border-gray-200 rounded-full
                       px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-emerald-400">
            {cities.map((c) => <option key={c} value={c}>{c === 'All' ? '📍 All areas' : c}</option>)}
          </select>
        </div>
      </div>

      {/* ════════ Results ════════ */}
      <div className="max-w-6xl mx-auto px-4 py-8 min-h-[40vh]">
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
                {filtered.length} {filtered.length === 1 ? 'business' : 'businesses'}
                {category !== 'All' && <span className="text-gray-400 font-medium"> in {category}</span>}
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

      {/* ════════ List-your-business CTA ════════ */}
      <div className="max-w-6xl mx-auto px-4 pb-16">
        <Reveal>
          <div className="relative overflow-hidden rounded-[2rem] p-8 sm:p-12 text-center"
               style={{ background: 'linear-gradient(135deg, #064e3b 0%, #0d9488 60%, #059669 100%)' }}>
            <div className="absolute -top-10 -right-10 w-48 h-48 rounded-full bg-white/10 blur-2xl animate-pl-glow" />
            <div className="absolute -bottom-12 -left-8 w-52 h-52 rounded-full bg-emerald-300/20 blur-2xl animate-pl-glow" style={{ animationDelay: '2s' }} />
            <div className="relative">
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-white/15 backdrop-blur mb-4 text-2xl">🚀</div>
              <h3 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">Own a business?</h3>
              <p className="text-sm sm:text-base text-white/75 mt-2 mb-6 max-w-md mx-auto">
                Get your own WhatsApp store page and get discovered right here — free, live in 2 minutes.
              </p>
              <Link to="/start"
                className="group relative inline-flex items-center gap-2 bg-white text-emerald-700 font-bold text-sm sm:text-base
                           px-7 py-3.5 rounded-2xl shadow-xl hover:-translate-y-0.5 active:scale-[0.98] transition-all overflow-hidden">
                <span className="absolute inset-0 overflow-hidden rounded-2xl">
                  <span className="absolute top-0 h-full w-1/3 bg-emerald-200/40 blur-md -skew-x-12 -translate-x-[180%] group-hover:translate-x-[420%] transition-transform duration-700" />
                </span>
                <span className="relative">List Your Business Free</span>
                <ArrowRight size={18} className="relative transition-transform group-hover:translate-x-1" />
              </Link>
            </div>
          </div>
        </Reveal>
      </div>
    </div>
  );
}

function Stat({ value, label }) {
  return (
    <div className="text-center">
      <div className="text-2xl sm:text-3xl font-extrabold text-white tabular-nums">{value}</div>
      <div className="text-[10px] sm:text-xs font-medium text-white/45 uppercase tracking-wider mt-0.5">{label}</div>
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
        <Link to="/start" className="inline-block mt-4 text-emerald-600 font-bold text-sm hover:text-emerald-700">
          List your business free →
        </Link>
      )}
    </div>
  );
}

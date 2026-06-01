import { Link } from 'react-router-dom';
import {
  ArrowRight, MessageCircle, Check, Star, Zap,
  Sparkles, ShoppingBag, ChevronRight,
} from 'lucide-react';
import { listBusinesses } from '../utils/BusinessLoader';

/**
 * Landing — platform homepage at /
 *
 * Intentionally has NO BusinessProvider / useBusinessConfig() —
 * this page is the shell around all stores, not a store itself.
 * All colors here are hardcoded (no CSS custom property dependency).
 */

const WA = '#25D366';        // WhatsApp green — primary CTA
const WA_DARK = '#1ebe5d';

const HOW_IT_WORKS = [
  {
    icon: '📝',
    step: '01',
    title: 'Set up your shop',
    desc: 'Add your business name, products and pricing. No tech skills needed — done in under 2 minutes.',
  },
  {
    icon: '🔗',
    step: '02',
    title: 'Share your link',
    desc: 'Your page goes live instantly. Drop the link on WhatsApp, Instagram bio, or anywhere your customers already are.',
  },
  {
    icon: '💬',
    step: '03',
    title: 'Receive orders on WhatsApp',
    desc: 'Customers browse, add to cart and tap “Send Order”. A neat, structured message lands straight in your WhatsApp.',
  },
];

const VALUE_PROPS = [
  { icon: '🚫', title: 'No app downloads',     desc: 'Your page opens in any browser. Customers order through WhatsApp — which they already have.' },
  { icon: '💸', title: '0% commission',        desc: 'Keep every rupee. We never take a cut of your sales, unlike marketplaces and food apps.' },
  { icon: '🎨', title: 'Beautiful by default', desc: 'Pick a colour, add a logo, done. Five page templates tuned for different businesses.' },
  { icon: '🧾', title: 'GST-ready pricing',    desc: 'Show tax-inclusive prices and totals. Orders arrive itemised and ready to fulfil.' },
  { icon: '⚡', title: 'Live in minutes',      desc: 'No designers, no developers, no waiting. Publish today and share the link instantly.' },
  { icon: '🆓', title: 'Free to start',        desc: 'Launch a real, working page on the free plan. Upgrade only when you outgrow it.' },
];

const USE_CASES = [
  { emoji: '🛒', label: 'Retail & Wholesale', desc: 'Electronics, groceries, apparel, manufacturers', color: '#0d9488' },
  { emoji: '🍽️', label: 'Restaurants & Food', desc: 'Cafes, cloud kitchens, bakeries, tiffins',        color: '#f97316' },
  { emoji: '🔧', label: 'Services & Agencies', desc: 'Salons, repairs, consultants, home services',     color: '#6366f1' },
  { emoji: '🏨', label: 'Hotels & Stays',      desc: 'Lodges, resorts, homestays, guest houses',         color: '#0ea5e9' },
  { emoji: '💼', label: 'Portfolio & Leads',   desc: 'Architects, designers, coaches, freelancers',      color: '#db2777' },
];

const TESTIMONIALS = [
  { emoji: '👩🏽‍🍳', name: 'Priya Sharma',  biz: 'Sharma Sweets, Jaipur',     quote: 'Set up my sweet shop in one evening. Festival orders now come straight to WhatsApp — no more lost messages.' },
  { emoji: '👨🏽‍🔧', name: 'Imran Khan',    biz: 'QuickFix Repairs, Delhi',   quote: 'My customers just tap the link and book. Zero commission means I keep everything I earn.' },
  { emoji: '👩🏽‍💼', name: 'Anjali Rao',     biz: 'Bloom Boutique, Bengaluru', quote: 'It looks like an expensive website but it was free and took ten minutes. My Instagram bio finally has a real business page.' },
];

const STATS = [
  { value: '2 min', label: 'to go live' },
  { value: '0%',    label: 'order commission' },
  { value: '₹0',    label: 'to get started' },
  { value: '∞',     label: 'orders, no limits' },
];

/* ── A live mini-storefront rendered inside a phone frame ─────────────── */
function PhoneMockup() {
  return (
    <div className="relative mx-auto w-[270px] sm:w-[300px] animate-pl-float">
      {/* Glow behind the phone */}
      <div className="absolute -inset-6 rounded-[3rem] bg-gradient-to-tr from-emerald-300/40 via-teal-200/30 to-transparent blur-2xl" />

      {/* Phone frame */}
      <div className="relative rounded-[2.6rem] bg-gray-900 p-2.5 shadow-2xl shadow-emerald-900/20 ring-1 ring-black/5">
        {/* Notch */}
        <div className="absolute top-2.5 left-1/2 -translate-x-1/2 z-20 w-28 h-5 bg-gray-900 rounded-b-2xl" />

        {/* Screen */}
        <div className="relative rounded-[2.1rem] overflow-hidden bg-[#f8fafc] h-[540px]">

          {/* Store cover + header */}
          <div className="relative h-28 bg-gradient-to-br from-emerald-500 to-teal-600">
            <div className="absolute inset-0 opacity-25"
                 style={{ backgroundImage: 'radial-gradient(circle, #ffffff55 1px, transparent 1px)', backgroundSize: '14px 14px' }} />
            <div className="absolute bottom-3 left-3 right-3 flex items-center gap-2.5">
              <div className="w-11 h-11 rounded-2xl bg-white flex items-center justify-center text-xl shadow-lg flex-shrink-0">
                🍬
              </div>
              <div className="min-w-0">
                <p className="text-white font-extrabold text-sm leading-tight truncate">Sharma Sweets</p>
                <p className="text-white/80 text-[10px] truncate">Fresh sweets, made daily</p>
              </div>
            </div>
          </div>

          {/* Promo ribbon */}
          <div className="mx-3 mt-3 rounded-xl bg-amber-50 border border-amber-100 px-3 py-2 flex items-center gap-2">
            <span className="text-base">🎉</span>
            <p className="text-[11px] font-bold text-amber-800 leading-tight">Diwali Special · 20% off boxes</p>
          </div>

          {/* Products */}
          <div className="px-3 mt-3 grid grid-cols-2 gap-2.5">
            {[
              { e: '🍰', n: 'Kaju Katli', p: '₹450' },
              { e: '🧁', n: 'Motichoor',  p: '₹380' },
              { e: '🍮', n: 'Rasmalai',   p: '₹260' },
              { e: '🍩', n: 'Gulab Jamun',p: '₹220' },
            ].map((it) => (
              <div key={it.n} className="rounded-xl bg-white border border-gray-100 p-2 shadow-sm">
                <div className="h-14 rounded-lg bg-gradient-to-br from-orange-50 to-amber-50 flex items-center justify-center text-2xl mb-1.5">
                  {it.e}
                </div>
                <p className="text-[11px] font-bold text-gray-800 leading-tight truncate">{it.n}</p>
                <div className="flex items-center justify-between mt-0.5">
                  <span className="text-[11px] font-extrabold text-gray-900">{it.p}</span>
                  <span className="w-5 h-5 rounded-md bg-emerald-500 text-white flex items-center justify-center text-xs font-bold leading-none">+</span>
                </div>
              </div>
            ))}
          </div>

          {/* Floating WhatsApp order confirmation */}
          <div className="absolute bottom-4 left-3 right-3 animate-pl-pop">
            <div className="rounded-2xl bg-[#25D366] px-3.5 py-3 shadow-xl shadow-emerald-900/30 flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
                <MessageCircle size={16} className="text-white" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-white font-bold text-[11px] leading-tight">Order sent to WhatsApp ✓</p>
                <p className="text-white/80 text-[10px] leading-tight truncate">3 items · ₹1,090 · awaiting reply</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Floating rating chip */}
      <div className="absolute -left-6 top-24 hidden sm:flex animate-pl-float-slow items-center gap-1.5 bg-white rounded-2xl shadow-xl ring-1 ring-black/5 px-3 py-2">
        <div className="flex">
          {[...Array(5)].map((_, i) => (
            <Star key={i} size={11} className="text-amber-400 fill-amber-400" />
          ))}
        </div>
        <span className="text-[11px] font-bold text-gray-700">Loved by shops</span>
      </div>

      {/* Floating "no commission" chip */}
      <div className="absolute -right-5 bottom-24 hidden sm:flex animate-pl-float items-center gap-1.5 bg-white rounded-2xl shadow-xl ring-1 ring-black/5 px-3 py-2">
        <span className="text-base">💸</span>
        <span className="text-[11px] font-bold text-gray-700">0% commission</span>
      </div>
    </div>
  );
}

export default function Landing() {
  // Show up to 3 demo stores (static configs only for the landing page)
  const demoStores = listBusinesses().slice(0, 3);

  return (
    <div className="min-h-screen bg-white antialiased">

      {/* ── Navigation ──────────────────────────────────────────────────── */}
      <nav className="border-b border-gray-100 bg-white/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center">
            <img src="/pocketlink-logo.svg" alt="PocketLink" className="h-8 sm:h-9 w-auto" />
          </Link>

          <div className="hidden md:flex items-center gap-7 text-sm font-semibold text-gray-500">
            <a href="#how"      className="hover:text-gray-900 transition-colors">How it works</a>
            <a href="#features" className="hover:text-gray-900 transition-colors">Features</a>
            <a href="#demos"    className="hover:text-gray-900 transition-colors">Demos</a>
            <a href="#pricing"  className="hover:text-gray-900 transition-colors">Pricing</a>
          </div>

          <Link
            to="/start"
            className="inline-flex items-center gap-1.5 text-white text-sm font-bold px-4 py-2 rounded-xl
                       transition-all shadow-sm hover:shadow-md active:scale-[0.98]"
            style={{ backgroundColor: WA }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = WA_DARK)}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = WA)}
          >
            <MessageCircle size={14} />
            Create Free Page
          </Link>
        </div>
      </nav>

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        {/* Decorative background */}
        <div className="absolute inset-0 -z-10 bg-gradient-to-b from-emerald-50/70 via-white to-white" />
        <div className="absolute -z-10 top-[-6rem] left-[-6rem] w-96 h-96 rounded-full bg-emerald-300/30 blur-3xl animate-pl-blob" />
        <div className="absolute -z-10 top-10 right-[-8rem] w-[28rem] h-[28rem] rounded-full bg-teal-300/25 blur-3xl animate-pl-blob" style={{ animationDelay: '4s' }} />
        <div className="absolute inset-0 -z-10 opacity-[0.4]"
             style={{ backgroundImage: 'radial-gradient(circle, #0d948814 1px, transparent 1px)', backgroundSize: '26px 26px', maskImage: 'linear-gradient(to bottom, black, transparent 70%)' }} />

        <div className="max-w-6xl mx-auto px-4 pt-14 pb-16 sm:pt-20 sm:pb-24">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-8 items-center">

            {/* Left: copy */}
            <div className="text-center lg:text-left animate-pl-fade-up">
              <div className="inline-flex items-center gap-2 bg-white border border-emerald-100 shadow-sm
                              text-emerald-700 text-xs font-semibold px-3 py-1.5 rounded-full mb-6">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Free · No tech skills · Live in minutes
              </div>

              <h1 className="text-4xl sm:text-5xl lg:text-[3.4rem] font-extrabold text-gray-900
                             leading-[1.05] tracking-tight mb-5">
                Turn WhatsApp into<br className="hidden sm:block" />{' '}
                <span className="relative inline-block">
                  <span className="bg-gradient-to-r from-emerald-500 to-teal-500 bg-clip-text text-transparent">
                    your business page
                  </span>
                  <svg className="absolute -bottom-2 left-0 w-full" height="10" viewBox="0 0 200 10" preserveAspectRatio="none" aria-hidden="true">
                    <path d="M2 7 Q 50 2, 100 6 T 198 5" stroke="#25D366" strokeWidth="3" fill="none" strokeLinecap="round" />
                  </svg>
                </span>
              </h1>

              <p className="text-gray-500 text-base sm:text-lg max-w-xl mx-auto lg:mx-0 mb-8 leading-relaxed">
                PocketLink gives any small business a beautiful page — shareable in one link,
                with orders landing straight in your WhatsApp. No app, no code, no commission.
              </p>

              <div className="flex flex-col sm:flex-row items-center lg:items-start justify-center lg:justify-start gap-3 mb-8">
                <Link
                  to="/start"
                  className="inline-flex items-center gap-2 text-white font-bold text-base px-8 py-3.5 rounded-2xl
                             shadow-lg shadow-emerald-500/25 hover:shadow-xl transition-all duration-200
                             active:scale-[0.98] w-full sm:w-auto justify-center"
                  style={{ backgroundColor: WA }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = WA_DARK)}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = WA)}
                >
                  Create My Free Page
                  <ArrowRight size={17} />
                </Link>
                <a
                  href="#demos"
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-600
                             hover:text-gray-900 transition-colors px-4 py-3.5"
                >
                  <Sparkles size={15} className="text-emerald-500" />
                  See live demos
                </a>
              </div>

              {/* Trust row */}
              <div className="flex items-center justify-center lg:justify-start gap-3">
                <div className="flex -space-x-2">
                  {['🛍️', '🍰', '💐', '🔧'].map((e, i) => (
                    <div key={i} className="w-8 h-8 rounded-full bg-white border-2 border-white ring-1 ring-gray-100 shadow-sm flex items-center justify-center text-sm">
                      {e}
                    </div>
                  ))}
                </div>
                <div className="text-left">
                  <div className="flex items-center gap-0.5">
                    {[...Array(5)].map((_, i) => (
                      <Star key={i} size={12} className="text-amber-400 fill-amber-400" />
                    ))}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">Shops across India, online in minutes</p>
                </div>
              </div>
            </div>

            {/* Right: phone */}
            <div className="flex justify-center lg:justify-end">
              <PhoneMockup />
            </div>
          </div>
        </div>
      </section>

      {/* ── Stats band ───────────────────────────────────────────────────── */}
      <section className="px-4">
        <div className="max-w-5xl mx-auto -mt-6 sm:-mt-10 relative z-10">
          <div className="rounded-3xl bg-gray-900 shadow-xl shadow-gray-900/10 px-6 py-7 sm:py-8">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 divide-x divide-white/10">
              {STATS.map(({ value, label }, i) => (
                <div key={label} className={`text-center ${i % 2 === 0 ? '' : ''}`}>
                  <p className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">{value}</p>
                  <p className="text-xs text-gray-400 mt-1">{label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────────────────── */}
      <section id="how" className="px-4 py-16 sm:py-20 bg-white">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-14">
            <p className="text-xs font-bold uppercase tracking-widest text-emerald-600 mb-2">How it works</p>
            <h2 className="text-2xl sm:text-4xl font-extrabold text-gray-900 mb-3 tracking-tight">
              Three steps. You're online.
            </h2>
            <p className="text-sm sm:text-base text-gray-500">No designers, no developers, no monthly fee to start.</p>
          </div>

          <div className="relative grid grid-cols-1 sm:grid-cols-3 gap-10 sm:gap-8">
            {/* connecting dotted line (desktop) */}
            <div className="hidden sm:block absolute top-7 left-[16%] right-[16%] h-px border-t-2 border-dashed border-gray-200" />

            {HOW_IT_WORKS.map(({ icon, step, title, desc }) => (
              <div key={step} className="relative text-center">
                <div className="relative inline-block mb-5">
                  <div className="w-16 h-16 bg-white border border-gray-100 rounded-2xl
                                  flex items-center justify-center text-3xl shadow-md shadow-gray-100 relative z-10">
                    {icon}
                  </div>
                  <span className="absolute -top-2 -right-2 z-20 w-6 h-6 bg-emerald-500 text-white
                                   text-[11px] font-bold rounded-full flex items-center
                                   justify-center leading-none shadow-sm ring-2 ring-white">
                    {step}
                  </span>
                </div>
                <h3 className="font-bold text-gray-900 mb-2 text-base">{title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed max-w-xs mx-auto">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Why PocketLink (value props) ─────────────────────────────────── */}
      <section id="features" className="px-4 py-16 sm:py-20 bg-gradient-to-b from-gray-50 to-white border-y border-gray-100">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <p className="text-xs font-bold uppercase tracking-widest text-emerald-600 mb-2">Why PocketLink</p>
            <h2 className="text-2xl sm:text-4xl font-extrabold text-gray-900 mb-3 tracking-tight">
              Everything a small shop needs.<br className="hidden sm:block" /> Nothing it doesn't.
            </h2>
            <p className="text-sm sm:text-base text-gray-500 max-w-xl mx-auto">
              Built for Indian businesses that sell on WhatsApp — fast, fair and genuinely free to start.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {VALUE_PROPS.map(({ icon, title, desc }) => (
              <div
                key={title}
                className="group bg-white border border-gray-100 rounded-2xl p-6 shadow-sm
                           hover:shadow-lg hover:border-emerald-100 hover:-translate-y-1 transition-all duration-200"
              >
                <div className="w-12 h-12 rounded-2xl bg-emerald-50 flex items-center justify-center text-2xl mb-4
                                group-hover:scale-110 transition-transform duration-200">
                  {icon}
                </div>
                <h3 className="font-bold text-gray-900 mb-1.5">{title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Use cases ────────────────────────────────────────────────────── */}
      <section className="px-4 py-16 sm:py-20 bg-white">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-xs font-bold uppercase tracking-widest text-emerald-600 mb-2">Built for every business</p>
            <h2 className="text-2xl sm:text-4xl font-extrabold text-gray-900 mb-3 tracking-tight">
              One platform, five tailored pages
            </h2>
            <p className="text-sm sm:text-base text-gray-500">
              Pick your business type and PocketLink sets up the right layout and ordering flow.
            </p>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            {USE_CASES.map(({ emoji, label, desc, color }) => (
              <div
                key={label}
                className="relative rounded-2xl border border-gray-100 bg-white p-5 text-center
                           shadow-sm hover:shadow-md transition-all duration-200 overflow-hidden group"
              >
                <div
                  className="absolute inset-x-0 top-0 h-1 opacity-80"
                  style={{ backgroundColor: color }}
                />
                <div
                  className="w-14 h-14 mx-auto rounded-2xl flex items-center justify-center text-2xl mb-3
                             group-hover:scale-110 transition-transform duration-200"
                  style={{ backgroundColor: `${color}15` }}
                >
                  {emoji}
                </div>
                <h3 className="font-bold text-gray-900 text-sm leading-tight mb-1">{label}</h3>
                <p className="text-[11px] text-gray-400 leading-snug">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Live demo stores ─────────────────────────────────────────────── */}
      <section id="demos" className="px-4 py-16 sm:py-20 bg-gradient-to-b from-gray-50 to-white border-y border-gray-100">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-xs font-bold uppercase tracking-widest text-emerald-600 mb-2">See it in action</p>
            <h2 className="text-2xl sm:text-4xl font-extrabold text-gray-900 mb-3 tracking-tight">
              Browse live examples
            </h2>
            <p className="text-sm sm:text-base text-gray-500">
              Tap any page to explore a real, live example — exactly what your customers see.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            {demoStores.map((biz) => (
              <Link
                key={biz.slug}
                to={`/demo/${biz.slug}`}
                className="group bg-white border border-gray-100 hover:border-emerald-200
                           hover:shadow-xl hover:-translate-y-1 rounded-2xl overflow-hidden
                           transition-all duration-200 block"
              >
                {/* Mini cover */}
                <div
                  className="h-20 relative"
                  style={{ background: `linear-gradient(135deg, ${biz.theme.primary}, ${biz.theme.primary}cc)` }}
                >
                  <div className="absolute inset-0 opacity-20"
                       style={{ backgroundImage: 'radial-gradient(circle, #ffffff66 1px, transparent 1px)', backgroundSize: '12px 12px' }} />
                  <span className="absolute top-3 right-3 text-[10px] font-bold text-white/90 bg-white/20 px-2 py-0.5 rounded-full backdrop-blur-sm">
                    Live demo
                  </span>
                </div>

                <div className="p-5 -mt-8 relative">
                  <div className="w-12 h-12 rounded-2xl bg-white shadow-md flex items-center justify-center text-2xl mb-3 ring-1 ring-gray-100">
                    {biz.logoEmoji}
                  </div>
                  <p className="font-bold text-gray-900 text-sm leading-tight truncate">{biz.businessName}</p>
                  <p className="text-xs text-gray-400 mt-0.5 truncate leading-tight">{biz.tagline}</p>

                  <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-50">
                    <span className="inline-flex items-center gap-1.5 text-xs text-gray-400">
                      <ShoppingBag size={13} style={{ color: biz.theme.primary }} />
                      {biz.products.length} products
                    </span>
                    <span className="inline-flex items-center text-xs font-bold group-hover:gap-1 gap-0.5 transition-all"
                          style={{ color: biz.theme.primary }}>
                      View <ChevronRight size={13} />
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ── Testimonials ─────────────────────────────────────────────────── */}
      <section className="px-4 py-16 sm:py-20 bg-white">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-xs font-bold uppercase tracking-widest text-emerald-600 mb-2">Loved by shop owners</p>
            <h2 className="text-2xl sm:text-4xl font-extrabold text-gray-900 tracking-tight">
              Real shops, real orders
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            {TESTIMONIALS.map(({ emoji, name, biz, quote }) => (
              <div key={name} className="bg-gradient-to-b from-gray-50 to-white border border-gray-100 rounded-2xl p-6 shadow-sm flex flex-col">
                <div className="flex items-center gap-0.5 mb-3">
                  {[...Array(5)].map((_, i) => (
                    <Star key={i} size={14} className="text-amber-400 fill-amber-400" />
                  ))}
                </div>
                <p className="text-sm text-gray-600 leading-relaxed flex-1">“{quote}”</p>
                <div className="flex items-center gap-3 mt-5 pt-4 border-t border-gray-100">
                  <div className="w-10 h-10 rounded-full bg-emerald-50 flex items-center justify-center text-xl flex-shrink-0">
                    {emoji}
                  </div>
                  <div className="min-w-0">
                    <p className="font-bold text-gray-900 text-sm leading-tight truncate">{name}</p>
                    <p className="text-xs text-gray-400 truncate">{biz}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing ──────────────────────────────────────────────────────── */}
      <section id="pricing" className="px-4 py-16 sm:py-20 bg-gradient-to-b from-gray-50 to-white border-y border-gray-100">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-xs font-bold uppercase tracking-widest text-emerald-600 mb-2">Pricing</p>
            <h2 className="text-2xl sm:text-4xl font-extrabold text-gray-900 mb-3 tracking-tight">
              Simple, honest pricing
            </h2>
            <p className="text-sm sm:text-base text-gray-500">
              Start free. No credit card. Upgrade only when you outgrow the free tier.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-6 items-stretch">
            {[
              {
                name: 'Free', price: 0, popular: false, color: '#374151',
                to: '/start', cta: 'Start Free',
                features: ['2 products · 1 category', 'WhatsApp orders', 'Shareable page link', 'GST-inclusive pricing'],
                caveat: '“Powered by PocketLink” badge',
              },
              {
                name: 'Pro', price: 551, originalPrice: 699, popular: true, color: '#0d9488',
                to: '/start?plan=pro', cta: 'Get Pro',
                features: ['20 products · 5 categories', 'No PocketLink badge', 'Zero per-order cost', 'Order history', 'Email support'],
                caveat: null,
              },
              {
                name: 'Business', price: 1000, popular: false, color: '#6366f1',
                to: '/start?plan=business', cta: 'Get Business',
                features: ['Unlimited products & categories', 'No badge', 'Discount codes', 'Analytics dashboard', 'Product variants', 'Priority support'],
                caveat: null,
              },
            ].map((plan) => (
              <div
                key={plan.name}
                className={[
                  'relative rounded-3xl border-2 p-6 flex flex-col bg-white transition-all duration-200',
                  plan.popular
                    ? 'border-teal-500 shadow-2xl shadow-teal-500/15 sm:-translate-y-2'
                    : 'border-gray-100 shadow-sm hover:shadow-md',
                ].join(' ')}
              >
                {plan.popular && (
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                    <span className="inline-flex items-center gap-1 bg-teal-500 text-white text-[10px] font-bold px-3 py-1
                                     rounded-full uppercase tracking-wider shadow-sm">
                      <Zap size={10} className="fill-white" /> Best Value
                    </span>
                  </div>
                )}
                <h3 className="font-extrabold text-gray-900 text-lg mb-1">{plan.name}</h3>
                <div className="flex items-baseline gap-2 mb-0.5">
                  <p className="text-3xl font-extrabold text-gray-900">
                    {plan.price === 0 ? 'Free' : `₹${plan.price}`}
                    {plan.price > 0 && <span className="text-sm font-normal text-gray-400">/mo</span>}
                  </p>
                  {plan.originalPrice && (
                    <span className="text-sm text-gray-400 line-through">₹{plan.originalPrice}</span>
                  )}
                </div>
                <p className="text-xs text-gray-400 mb-5 pb-5 border-b border-gray-100">
                  {plan.price === 0 ? 'forever · no card needed' : '+ GST · billed monthly'}
                </p>
                <ul className="space-y-2.5 flex-1 mb-5">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2.5 text-sm text-gray-600">
                      <span className="mt-0.5 flex-shrink-0 w-4 h-4 rounded-full bg-teal-50 flex items-center justify-center">
                        <Check size={11} className="text-teal-600" strokeWidth={3} />
                      </span>
                      {f}
                    </li>
                  ))}
                  {plan.caveat && (
                    <li className="flex items-start gap-2.5 text-sm text-gray-400">
                      <span className="mt-0.5 flex-shrink-0 text-gray-300 text-xs">✗</span>
                      <span className="line-through">{plan.caveat}</span>
                    </li>
                  )}
                </ul>
                <Link
                  to={plan.to}
                  className="block text-center py-3 rounded-xl text-sm font-bold transition-all hover:opacity-90 active:scale-[0.98]"
                  style={{
                    backgroundColor: plan.popular || plan.name === 'Business' ? plan.color : '#f3f4f6',
                    color: plan.popular || plan.name === 'Business' ? '#fff' : '#374151',
                  }}
                >
                  {plan.cta}
                </Link>
              </div>
            ))}
          </div>
          <p className="text-center text-xs text-gray-400">
            6-month & yearly plans available at checkout · Cancel anytime
          </p>
        </div>
      </section>

      {/* ── FAQ ──────────────────────────────────────────────────────────── */}
      <section className="px-4 py-16 sm:py-20 bg-white">
        <div className="max-w-2xl mx-auto">
          <div className="text-center mb-10">
            <p className="text-xs font-bold uppercase tracking-widest text-emerald-600 mb-2">FAQ</p>
            <h2 className="text-2xl sm:text-4xl font-extrabold text-gray-900 tracking-tight">
              Frequently asked questions
            </h2>
          </div>
          <div className="space-y-3">
            {[
              { q: 'Is PocketLink really free?', a: 'Yes. The Free plan gives you a fully working page with up to 2 products — no credit card, no expiry. Upgrade only when you need more products or want to remove the badge.' },
              { q: 'Do my customers need to download anything?', a: 'No app needed. Your page opens in any browser. Customers place orders via WhatsApp — which they already have on their phone.' },
              { q: 'How do I receive orders?', a: 'When a customer taps “Send Order”, a structured WhatsApp message lands in your inbox with their name, address, items and total. You reply to confirm and arrange delivery.' },
              { q: 'Can I accept online payments?', a: 'PocketLink currently handles COD and in-person payment collection. Customers mention their preferred payment method in the order message. Integrated online payment links are on our roadmap.' },
              { q: 'What is the “Powered by PocketLink” badge?', a: 'Free pages show a small “Powered by PocketLink” link at the bottom of the page. It disappears on Pro and higher plans.' },
              { q: 'How do paid plans get activated?', a: 'Complete payment and send us a WhatsApp confirmation with your transaction ID. We activate your plan within 2–4 hours. Automated billing is on our roadmap.' },
              { q: 'Can I upgrade later?', a: 'Yes. Upgrade anytime from your dashboard. All your products, settings and page link remain exactly the same.' },
              { q: 'How do I delete my page?', a: 'Go to Settings in your dashboard to permanently delete your page and all associated data at any time.' },
            ].map(({ q, a }) => (
              <details key={q} className="group bg-white border border-gray-100 rounded-2xl shadow-sm hover:border-gray-200 transition-colors">
                <summary className="flex items-center justify-between px-5 py-4 cursor-pointer
                                    font-semibold text-sm text-gray-900 list-none
                                    [&::-webkit-details-marker]:hidden select-none">
                  {q}
                  <span className="text-emerald-500 transition-transform duration-200 group-open:rotate-45 flex-shrink-0 ml-3 text-xl leading-none">
                    +
                  </span>
                </summary>
                <p className="px-5 pb-4 text-sm text-gray-500 leading-relaxed">
                  {a}
                </p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ── Bottom CTA ───────────────────────────────────────────────────── */}
      <section className="px-4 py-16 sm:py-20">
        <div className="max-w-4xl mx-auto">
          <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-br from-emerald-500 to-teal-600 px-6 py-14 sm:py-16 text-center shadow-2xl shadow-emerald-500/20">
            <div className="absolute inset-0 opacity-20"
                 style={{ backgroundImage: 'radial-gradient(circle, #ffffff55 1px, transparent 1px)', backgroundSize: '22px 22px' }} />
            <div className="absolute -top-12 -right-12 w-48 h-48 rounded-full bg-white/10 blur-2xl" />
            <div className="absolute -bottom-12 -left-12 w-48 h-48 rounded-full bg-white/10 blur-2xl" />

            <div className="relative max-w-xl mx-auto">
              <h2 className="text-2xl sm:text-4xl font-extrabold text-white mb-3 tracking-tight">
                Ready to take your shop digital?
              </h2>
              <p className="text-emerald-50 text-sm sm:text-base mb-8 leading-relaxed">
                Free forever to start. No credit card, no setup fee.<br className="hidden sm:block" />
                Give your shop a digital home and start receiving orders today.
              </p>
              <Link
                to="/start"
                className="inline-flex items-center gap-2 bg-white text-emerald-700 font-bold text-base
                           px-8 py-3.5 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-200
                           active:scale-[0.98] hover:bg-emerald-50"
              >
                Create My Free Store
                <ArrowRight size={17} />
              </Link>
              <p className="text-emerald-100/80 text-xs mt-4">Join shops across India already selling on WhatsApp</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer className="border-t border-gray-100 bg-gray-50">
        <div className="max-w-6xl mx-auto px-4 py-12">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-8 mb-10">
            <div className="col-span-2 sm:col-span-1">
              <img src="/pocketlink-logo.svg" alt="PocketLink" className="h-7 w-auto mb-3" />
              <p className="text-xs text-gray-400 leading-relaxed max-w-[200px]">
                Helping small businesses go digital — simple business pages, orders on WhatsApp. 🌍
              </p>
            </div>
            <div>
              <p className="text-xs font-bold text-gray-900 uppercase tracking-wider mb-3">Product</p>
              <ul className="space-y-2 text-sm text-gray-500">
                <li><a href="#how" className="hover:text-gray-900 transition-colors">How it works</a></li>
                <li><a href="#features" className="hover:text-gray-900 transition-colors">Features</a></li>
                <li><a href="#pricing" className="hover:text-gray-900 transition-colors">Pricing</a></li>
                <li><a href="#demos" className="hover:text-gray-900 transition-colors">Live demos</a></li>
              </ul>
            </div>
            <div>
              <p className="text-xs font-bold text-gray-900 uppercase tracking-wider mb-3">Get started</p>
              <ul className="space-y-2 text-sm text-gray-500">
                <li><Link to="/start" className="hover:text-gray-900 transition-colors">Create free store</Link></li>
                <li><Link to="/plans" className="hover:text-gray-900 transition-colors">Plans</Link></li>
              </ul>
            </div>
            <div>
              <p className="text-xs font-bold text-gray-900 uppercase tracking-wider mb-3">Company</p>
              <ul className="space-y-2 text-sm text-gray-500">
                <li><Link to="/terms" className="hover:text-gray-900 transition-colors">Terms of Service</Link></li>
                <li><Link to="/privacy" className="hover:text-gray-900 transition-colors">Privacy Policy</Link></li>
                <li><a href="mailto:hello@pocketlink.store" className="hover:text-gray-900 transition-colors">Contact us</a></li>
              </ul>
            </div>
          </div>
          <div className="pt-6 border-t border-gray-200 flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-xs text-gray-400">© {new Date().getFullYear()} PocketLink. All rights reserved.</p>
            <p className="text-xs text-gray-400">Made with 💚 for small businesses</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

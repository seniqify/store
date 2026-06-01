import { useState, useEffect } from 'react';
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

// Scrolling strip of business types under the hero
const MARQUEE = [
  { emoji: '🛒', label: 'Kirana & Grocery' },
  { emoji: '🍰', label: 'Bakeries' },
  { emoji: '🍽️', label: 'Restaurants' },
  { emoji: '💐', label: 'Florists' },
  { emoji: '🔧', label: 'Repairs & Services' },
  { emoji: '🏨', label: 'Hotels & Stays' },
  { emoji: '👗', label: 'Boutiques' },
  { emoji: '💇', label: 'Salons' },
  { emoji: '💼', label: 'Consultants' },
  { emoji: '📱', label: 'Electronics' },
  { emoji: '🧵', label: 'Wholesalers' },
  { emoji: '🎨', label: 'Designers' },
];

/* ── Reveal-on-scroll wrapper (fades + rises into view once) ──────────── */
function Reveal({ children, delay = 0, className = '' }) {
  const supported = typeof IntersectionObserver !== 'undefined';
  const [el, setEl]       = useState(null);
  const [shown, setShown] = useState(!supported);   // show immediately if unsupported

  useEffect(() => {
    if (!el || !supported) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setShown(true); obs.disconnect(); } },
      { threshold: 0.15 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [el, supported]);

  return (
    <div
      ref={setEl}
      className={className}
      style={{
        opacity: shown ? 1 : 0,
        transform: shown ? 'translateY(0)' : 'translateY(34px)',
        transition: `opacity 0.7s ease-out ${delay}s, transform 0.7s cubic-bezier(0.22,1,0.36,1) ${delay}s`,
      }}
    >
      {children}
    </div>
  );
}

/* ── Headline word that cycles through business types ────────────────── */
const ROTATING = [
  { word: 'shop',       color: '#34d399' },
  { word: 'restaurant', color: '#fbbf24' },
  { word: 'boutique',   color: '#f472b6' },
  { word: 'salon',      color: '#a78bfa' },
  { word: 'hotel',      color: '#38bdf8' },
  { word: 'studio',     color: '#5eead4' },
];

function RotatingWord() {
  const [i, setI]       = useState(0);
  const [show, setShow] = useState(true);

  useEffect(() => {
    const swap = setInterval(() => {
      setShow(false);                                   // fade/slide out
      setTimeout(() => {
        setI(prev => (prev + 1) % ROTATING.length);     // advance
        setShow(true);                                  // fade/slide in
      }, 280);
    }, 2200);
    return () => clearInterval(swap);
  }, []);

  const { word, color } = ROTATING[i];
  return (
    // Own line, fixed height, clipped — the word swaps in place with zero reflow
    <span className="inline-block overflow-hidden align-bottom leading-[1.15]" style={{ height: '1.15em' }}>
      <span
        className="inline-block transition-all duration-300 ease-out will-change-transform"
        style={{
          color,
          opacity: show ? 1 : 0,
          transform: show ? 'translateY(0)' : 'translateY(0.5em)',
          textShadow: `0 0 28px ${color}66`,
        }}
      >
        {word}
      </span>
    </span>
  );
}

/* ── A live mini-storefront rendered inside a phone frame ─────────────── */
function PhoneMockup() {
  return (
    <div className="relative mx-auto w-[270px] sm:w-[300px] animate-pl-float">
      {/* Pulsing glow halo behind the phone */}
      <div className="absolute -inset-10 rounded-[4rem] blur-3xl animate-pl-glow"
           style={{ background: 'radial-gradient(circle, rgba(16,185,129,0.55), rgba(45,212,191,0.25) 45%, transparent 70%)' }} />

      {/* Phone frame */}
      <div className="relative rounded-[2.6rem] bg-gray-900 p-2.5 shadow-2xl shadow-emerald-900/40 ring-1 ring-white/10">
        {/* Notch */}
        <div className="absolute top-2.5 left-1/2 -translate-x-1/2 z-20 w-28 h-5 bg-gray-900 rounded-b-2xl" />

        {/* Screen */}
        <div className="relative rounded-[2.1rem] overflow-hidden bg-[#f8fafc] h-[540px]">

          {/* Glass reflection sweep */}
          <div className="absolute inset-0 z-30 pointer-events-none overflow-hidden rounded-[2.1rem]">
            <div className="absolute -top-1/2 -left-1/4 w-1/2 h-[200%] bg-gradient-to-r from-transparent via-white/15 to-transparent pl-sheen" />
          </div>

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

      {/* Floating "new order" chip — top left */}
      <div className="absolute -left-8 top-20 hidden sm:flex animate-pl-float-slow items-center gap-2 bg-white rounded-2xl shadow-2xl ring-1 ring-black/5 px-3 py-2">
        <span className="relative flex h-7 w-7 items-center justify-center rounded-full bg-emerald-100 flex-shrink-0">
          <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-300 opacity-60 animate-ping" />
          <span className="relative text-sm">🛒</span>
        </span>
        <div className="leading-tight">
          <p className="text-[11px] font-extrabold text-gray-800">New order!</p>
          <p className="text-[10px] text-gray-400">just now</p>
        </div>
      </div>

      {/* Floating "0% commission" chip — bottom right */}
      <div className="absolute -right-6 bottom-28 hidden sm:flex animate-pl-float items-center gap-1.5 bg-white rounded-2xl shadow-2xl ring-1 ring-black/5 px-3 py-2">
        <span className="text-base">💸</span>
        <span className="text-[11px] font-bold text-gray-700">0% commission</span>
      </div>

      {/* Floating rating chip — right top */}
      <div className="absolute -right-4 top-8 hidden sm:flex animate-pl-float-slow items-center gap-1.5 bg-white rounded-2xl shadow-2xl ring-1 ring-black/5 px-3 py-2"
           style={{ animationDelay: '2s' }}>
        <div className="flex">
          {[...Array(5)].map((_, i) => (
            <Star key={i} size={10} className="text-amber-400 fill-amber-400" />
          ))}
        </div>
        <span className="text-[11px] font-bold text-gray-700">4.9</span>
      </div>
    </div>
  );
}

export default function Landing() {
  // Show up to 3 demo stores (static configs only for the landing page)
  const demoStores = listBusinesses().slice(0, 3);

  return (
    <div className="min-h-screen bg-white antialiased">

      {/* ══ Dark hero block (nav + hero + marquee + stats all share one bg) ══ */}
      <div className="relative bg-[#050a09] text-white overflow-hidden">

        {/* Aurora gradient field */}
        <div className="absolute inset-0 -z-10 pointer-events-none">
          <div className="absolute top-[-12rem] left-[-8rem] w-[34rem] h-[34rem] rounded-full blur-[100px] animate-pl-aurora"
               style={{ background: 'radial-gradient(circle, rgba(16,185,129,0.55), transparent 65%)' }} />
          <div className="absolute top-[2rem] right-[-10rem] w-[40rem] h-[40rem] rounded-full blur-[110px] animate-pl-aurora"
               style={{ background: 'radial-gradient(circle, rgba(20,184,166,0.45), transparent 65%)', animationDelay: '6s' }} />
          <div className="absolute bottom-[-14rem] left-1/3 w-[36rem] h-[36rem] rounded-full blur-[120px] animate-pl-aurora"
               style={{ background: 'radial-gradient(circle, rgba(37,211,102,0.35), transparent 65%)', animationDelay: '11s' }} />
          {/* Fine grid */}
          <div className="absolute inset-0 opacity-[0.18]"
               style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)', backgroundSize: '48px 48px', maskImage: 'radial-gradient(ellipse 80% 60% at 50% 30%, black, transparent 75%)' }} />
        </div>

        {/* ── Navigation ──────────────────────────────────────────────────── */}
        <nav className="relative z-50 border-b border-white/10 backdrop-blur-md sticky top-0">
          <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
            <Link to="/" className="flex items-center">
              <img src="/pocketlink-logo.svg" alt="PocketLink" className="h-8 sm:h-9 w-auto brightness-0 invert" />
            </Link>

            <div className="hidden md:flex items-center gap-7 text-sm font-semibold text-white/60">
              <a href="#how"      className="hover:text-white transition-colors">How it works</a>
              <a href="#features" className="hover:text-white transition-colors">Features</a>
              <a href="#demos"    className="hover:text-white transition-colors">Demos</a>
              <a href="#pricing"  className="hover:text-white transition-colors">Pricing</a>
            </div>

            <Link
              to="/start"
              className="group relative inline-flex items-center gap-1.5 text-white text-sm font-bold px-4 py-2 rounded-xl
                         transition-all shadow-lg shadow-emerald-500/30 active:scale-[0.98] overflow-hidden"
              style={{ backgroundColor: WA }}
            >
              <span className="absolute inset-0 -z-0 overflow-hidden rounded-xl">
                <span className="absolute top-0 left-0 h-full w-1/3 bg-white/30 blur-md pl-sheen" />
              </span>
              <MessageCircle size={14} className="relative" />
              <span className="relative">Create Free Page</span>
            </Link>
          </div>
        </nav>

        {/* ── Hero ─────────────────────────────────────────────────────────── */}
        <section className="relative">
          <div className="max-w-6xl mx-auto px-4 pt-12 pb-24 sm:pt-16 sm:pb-32">
            <div className="grid lg:grid-cols-2 gap-12 lg:gap-6 items-center">

              {/* Left: copy */}
              <div className="text-center lg:text-left">
                <div className="inline-flex items-center gap-2 bg-white/5 border border-white/15 backdrop-blur-sm
                                text-emerald-300 text-xs font-semibold px-3 py-1.5 rounded-full mb-7 pl-rise"
                     style={{ animationDelay: '0.05s' }}>
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400" />
                  </span>
                  Free · No tech skills · Live in 2 minutes
                </div>

                <h1 className="text-[2.6rem] sm:text-6xl lg:text-[4.1rem] font-extrabold
                               leading-[1.06] tracking-tight mb-6 pl-rise"
                    style={{ animationDelay: '0.12s' }}>
                  <span className="block text-white">Give your</span>
                  {/* rotating word on its own dedicated line — swaps in place, no reflow */}
                  <span className="block"><RotatingWord /></span>
                  <span className="block text-white">
                    a page on{' '}
                    <span className="relative inline-block">
                      <span className="pl-shimmer-text bg-clip-text text-transparent"
                            style={{ backgroundImage: 'linear-gradient(90deg, #34d399, #5eead4, #25D366, #34d399)' }}>
                        WhatsApp
                      </span>
                      {/* hand-drawn underline (glowing on dark) */}
                      <svg className="absolute -bottom-2.5 left-0 w-full overflow-visible" height="14" viewBox="0 0 220 14" preserveAspectRatio="none" aria-hidden="true">
                        <path d="M3 9 Q 55 3, 110 7 T 217 6" stroke="#25D366" strokeWidth="4" fill="none" strokeLinecap="round"
                              style={{ filter: 'drop-shadow(0 0 6px rgba(37,211,102,0.7))' }} />
                      </svg>
                    </span>
                  </span>
                </h1>

                <p className="text-white/60 text-base sm:text-lg max-w-xl mx-auto lg:mx-0 mb-9 leading-relaxed pl-rise"
                   style={{ animationDelay: '0.2s' }}>
                  PocketLink turns WhatsApp into a stunning page for any business — share one link,
                  and orders land straight in your chat. No app. No code. No commission.
                </p>

                <div className="flex flex-col sm:flex-row items-center lg:items-start justify-center lg:justify-start gap-3 mb-9 pl-rise"
                     style={{ animationDelay: '0.28s' }}>
                  <Link
                    to="/start"
                    className="group relative inline-flex items-center gap-2 text-white font-bold text-base px-8 py-4 rounded-2xl
                               shadow-xl shadow-emerald-500/30 transition-all duration-200 hover:-translate-y-0.5
                               active:scale-[0.98] w-full sm:w-auto justify-center overflow-hidden"
                    style={{ backgroundColor: WA }}
                  >
                    <span className="absolute inset-0 overflow-hidden rounded-2xl">
                      <span className="absolute top-0 left-0 h-full w-1/3 bg-white/30 blur-md pl-sheen" />
                    </span>
                    <span className="relative">Create My Free Page</span>
                    <ArrowRight size={18} className="relative transition-transform group-hover:translate-x-1" />
                  </Link>
                  <a
                    href="#demos"
                    className="inline-flex items-center gap-2 text-sm font-semibold text-white/70
                               hover:text-white transition-colors px-5 py-4 rounded-2xl border border-white/15
                               hover:border-white/30 hover:bg-white/5 w-full sm:w-auto justify-center"
                  >
                    <Sparkles size={15} className="text-emerald-300" />
                    See it live
                  </a>
                </div>

                {/* Trust row */}
                <div className="flex items-center justify-center lg:justify-start gap-3 pl-rise"
                     style={{ animationDelay: '0.36s' }}>
                  <div className="flex -space-x-2.5">
                    {['🛍️', '🍰', '💐', '🔧', '🏨'].map((e, i) => (
                      <div key={i} className="w-9 h-9 rounded-full bg-white/10 border-2 border-[#0a1310] backdrop-blur-sm flex items-center justify-center text-sm">
                        {e}
                      </div>
                    ))}
                  </div>
                  <div className="text-left">
                    <div className="flex items-center gap-0.5">
                      {[...Array(5)].map((_, i) => (
                        <Star key={i} size={13} className="text-amber-400 fill-amber-400" />
                      ))}
                    </div>
                    <p className="text-xs text-white/50 mt-0.5">Loved by shops across India</p>
                  </div>
                </div>
              </div>

              {/* Right: phone */}
              <div className="flex justify-center lg:justify-end pl-rise" style={{ animationDelay: '0.24s' }}>
                <PhoneMockup />
              </div>
            </div>
          </div>

          {/* Marquee strip — live scrolling business types */}
          <div className="relative border-y border-white/10 bg-white/[0.03] py-4 overflow-hidden">
            <div className="flex w-max animate-pl-marquee-slow gap-3">
              {[...MARQUEE, ...MARQUEE].map((m, i) => (
                <span key={i} className="inline-flex items-center gap-2 text-sm font-semibold text-white/70
                                          whitespace-nowrap px-4 py-1.5 rounded-full border border-white/10 bg-white/[0.04]">
                  <span className="text-base">{m.emoji}</span> {m.label}
                </span>
              ))}
            </div>
            {/* edge fades */}
            <div className="absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-[#050a09] to-transparent pointer-events-none" />
            <div className="absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-[#050a09] to-transparent pointer-events-none" />
          </div>
        </section>

        {/* ── Stats band ──────────────────────────────────────────────────── */}
        <section className="relative px-4 pb-16 sm:pb-20 pt-12 sm:pt-16">
          <div className="max-w-5xl mx-auto grid grid-cols-2 sm:grid-cols-4 gap-4">
            {STATS.map(({ value, label }) => (
              <div key={label}
                   className="rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-sm px-4 py-5 text-center
                              hover:bg-white/[0.07] hover:border-emerald-400/30 transition-colors">
                <p className="text-3xl sm:text-4xl font-extrabold tracking-tight bg-clip-text text-transparent"
                   style={{ backgroundImage: 'linear-gradient(135deg, #ffffff, #6ee7b7)' }}>{value}</p>
                <p className="text-xs text-white/50 mt-1.5">{label}</p>
              </div>
            ))}
          </div>
        </section>

        {/* smooth transition into the white body */}
        <div className="h-px bg-gradient-to-r from-transparent via-emerald-400/30 to-transparent" />
      </div>

      {/* ── How it works ─────────────────────────────────────────────────── */}
      <section id="how" className="px-4 py-16 sm:py-20 bg-white">
        <div className="max-w-4xl mx-auto">
          <Reveal className="text-center mb-14">
            <p className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-emerald-700
                          bg-emerald-50 border border-emerald-100 rounded-full px-3 py-1 mb-4
                          before:content-[''] before:w-1.5 before:h-1.5 before:rounded-full before:bg-emerald-500">How it works</p>
            <h2 className="text-2xl sm:text-4xl font-extrabold text-gray-900 mb-3 tracking-tight">
              Three steps. You're online.
            </h2>
            <p className="text-sm sm:text-base text-gray-500">No designers, no developers, no monthly fee to start.</p>
          </Reveal>

          <div className="relative grid grid-cols-1 sm:grid-cols-3 gap-6 sm:gap-6">
            {/* connecting gradient line (desktop) */}
            <div className="hidden sm:block absolute top-[4.5rem] left-[18%] right-[18%] h-0.5
                            bg-gradient-to-r from-emerald-200 via-emerald-300 to-emerald-200" />

            {HOW_IT_WORKS.map(({ icon, step, title, desc }, idx) => (
              <Reveal key={step} delay={idx * 0.12}
                className="group relative text-center bg-white rounded-3xl border border-gray-100 p-7
                           shadow-sm hover:shadow-xl hover:border-emerald-100 hover:-translate-y-1 transition-all duration-300">
                <div className="relative inline-block mb-5">
                  {/* glow ring */}
                  <div className="absolute inset-0 rounded-2xl bg-emerald-400/30 blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                  <div className="relative w-[4.5rem] h-[4.5rem] rounded-2xl flex items-center justify-center text-3xl z-10
                                  bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-100
                                  group-hover:scale-105 transition-transform duration-300">
                    {icon}
                  </div>
                  <span className="absolute -top-2.5 -right-2.5 z-20 w-7 h-7
                                   bg-gradient-to-br from-emerald-500 to-teal-600 text-white
                                   text-xs font-extrabold rounded-full flex items-center
                                   justify-center leading-none shadow-lg shadow-emerald-500/30 ring-2 ring-white">
                    {step}
                  </span>
                </div>
                <h3 className="font-extrabold text-gray-900 mb-2 text-lg tracking-tight">{title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{desc}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── Why PocketLink (value props) ─────────────────────────────────── */}
      <section id="features" className="px-4 py-16 sm:py-20 bg-gradient-to-b from-gray-50 to-white border-y border-gray-100">
        <div className="max-w-5xl mx-auto">
          <Reveal className="text-center mb-14">
            <p className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-emerald-700
                          bg-emerald-50 border border-emerald-100 rounded-full px-3 py-1 mb-4
                          before:content-[''] before:w-1.5 before:h-1.5 before:rounded-full before:bg-emerald-500">Why PocketLink</p>
            <h2 className="text-2xl sm:text-4xl font-extrabold text-gray-900 mb-3 tracking-tight">
              Everything a small shop needs.<br className="hidden sm:block" /> Nothing it doesn't.
            </h2>
            <p className="text-sm sm:text-base text-gray-500 max-w-xl mx-auto">
              Built for Indian businesses that sell on WhatsApp — fast, fair and genuinely free to start.
            </p>
          </Reveal>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {VALUE_PROPS.map(({ icon, title, desc }, idx) => (
              <Reveal
                key={title}
                delay={(idx % 3) * 0.08}
                className="group relative bg-white border border-gray-100 rounded-2xl p-6 shadow-sm overflow-hidden
                           hover:shadow-xl hover:border-emerald-100 hover:-translate-y-1.5 transition-all duration-300"
              >
                {/* corner glow on hover */}
                <div className="absolute -top-10 -right-10 w-28 h-28 rounded-full bg-emerald-300/20 blur-2xl
                                opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                <div className="relative w-12 h-12 rounded-2xl flex items-center justify-center text-2xl mb-4
                                bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-100
                                group-hover:scale-110 group-hover:-rotate-6 transition-transform duration-300">
                  {icon}
                </div>
                <h3 className="relative font-extrabold text-gray-900 mb-1.5 text-[15px]">{title}</h3>
                <p className="relative text-sm text-gray-500 leading-relaxed">{desc}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── Use cases ────────────────────────────────────────────────────── */}
      <section className="px-4 py-16 sm:py-20 bg-white">
        <div className="max-w-5xl mx-auto">
          <Reveal className="text-center mb-12">
            <p className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-emerald-700
                          bg-emerald-50 border border-emerald-100 rounded-full px-3 py-1 mb-4
                          before:content-[''] before:w-1.5 before:h-1.5 before:rounded-full before:bg-emerald-500">Built for every business</p>
            <h2 className="text-2xl sm:text-4xl font-extrabold text-gray-900 mb-3 tracking-tight">
              One platform, five tailored pages
            </h2>
            <p className="text-sm sm:text-base text-gray-500">
              Pick your business type and PocketLink sets up the right layout and ordering flow.
            </p>
          </Reveal>

          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            {USE_CASES.map(({ emoji, label, desc, color }, idx) => (
              <Reveal
                key={label}
                delay={idx * 0.07}
                className="group relative rounded-2xl border border-gray-100 bg-white p-5 text-center
                           shadow-sm hover:shadow-xl hover:-translate-y-1.5 transition-all duration-300 overflow-hidden cursor-default"
              >
                {/* color wash that floods up on hover */}
                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                     style={{ background: `linear-gradient(to bottom, ${color}0d, transparent)` }} />
                <div className="absolute inset-x-0 top-0 h-1" style={{ backgroundColor: color }} />
                <div
                  className="relative w-14 h-14 mx-auto rounded-2xl flex items-center justify-center text-2xl mb-3
                             group-hover:scale-110 transition-transform duration-300 shadow-sm"
                  style={{ backgroundColor: `${color}15`, boxShadow: `0 4px 14px ${color}22` }}
                >
                  {emoji}
                </div>
                <h3 className="relative font-extrabold text-gray-900 text-sm leading-tight mb-1">{label}</h3>
                <p className="relative text-[11px] text-gray-400 leading-snug">{desc}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── Live demo stores ─────────────────────────────────────────────── */}
      <section id="demos" className="px-4 py-16 sm:py-20 bg-gradient-to-b from-gray-50 to-white border-y border-gray-100">
        <div className="max-w-5xl mx-auto">
          <Reveal className="text-center mb-12">
            <p className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-emerald-700
                          bg-emerald-50 border border-emerald-100 rounded-full px-3 py-1 mb-4
                          before:content-[''] before:w-1.5 before:h-1.5 before:rounded-full before:bg-emerald-500">See it in action</p>
            <h2 className="text-2xl sm:text-4xl font-extrabold text-gray-900 mb-3 tracking-tight">
              Browse live examples
            </h2>
            <p className="text-sm sm:text-base text-gray-500">
              Tap any page to explore a real, live example — exactly what your customers see.
            </p>
          </Reveal>

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
          <Reveal className="text-center mb-12">
            <p className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-emerald-700
                          bg-emerald-50 border border-emerald-100 rounded-full px-3 py-1 mb-4
                          before:content-[''] before:w-1.5 before:h-1.5 before:rounded-full before:bg-emerald-500">Loved by shop owners</p>
            <h2 className="text-2xl sm:text-4xl font-extrabold text-gray-900 tracking-tight">
              Real shops, real orders
            </h2>
          </Reveal>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            {TESTIMONIALS.map(({ emoji, name, biz, quote }, idx) => (
              <Reveal key={name} delay={idx * 0.1}
                className="group relative bg-white border border-gray-100 rounded-3xl p-7 shadow-sm flex flex-col
                           hover:shadow-xl hover:-translate-y-1 transition-all duration-300 overflow-hidden">
                {/* oversized quote mark */}
                <span className="absolute -top-3 right-4 text-7xl font-serif text-emerald-100 select-none leading-none
                                 group-hover:text-emerald-200 transition-colors">”</span>
                <div className="relative flex items-center gap-0.5 mb-3">
                  {[...Array(5)].map((_, i) => (
                    <Star key={i} size={15} className="text-amber-400 fill-amber-400" />
                  ))}
                </div>
                <p className="relative text-sm text-gray-700 leading-relaxed flex-1">{quote}</p>
                <div className="relative flex items-center gap-3 mt-5 pt-4 border-t border-gray-100">
                  <div className="w-11 h-11 rounded-full bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-100
                                  flex items-center justify-center text-xl flex-shrink-0">
                    {emoji}
                  </div>
                  <div className="min-w-0">
                    <p className="font-extrabold text-gray-900 text-sm leading-tight truncate">{name}</p>
                    <p className="text-xs text-gray-400 truncate">{biz}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing ──────────────────────────────────────────────────────── */}
      <section id="pricing" className="px-4 py-16 sm:py-20 bg-gradient-to-b from-gray-50 to-white border-y border-gray-100">
        <div className="max-w-5xl mx-auto">
          <Reveal className="text-center mb-12">
            <p className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-emerald-700
                          bg-emerald-50 border border-emerald-100 rounded-full px-3 py-1 mb-4
                          before:content-[''] before:w-1.5 before:h-1.5 before:rounded-full before:bg-emerald-500">Pricing</p>
            <h2 className="text-2xl sm:text-4xl font-extrabold text-gray-900 mb-3 tracking-tight">
              Simple, honest pricing
            </h2>
            <p className="text-sm sm:text-base text-gray-500">
              Start free. No credit card. Upgrade only when you outgrow the free tier.
            </p>
          </Reveal>

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
          <Reveal className="text-center mb-10">
            <p className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-emerald-700
                          bg-emerald-50 border border-emerald-100 rounded-full px-3 py-1 mb-4
                          before:content-[''] before:w-1.5 before:h-1.5 before:rounded-full before:bg-emerald-500">FAQ</p>
            <h2 className="text-2xl sm:text-4xl font-extrabold text-gray-900 tracking-tight">
              Frequently asked questions
            </h2>
          </Reveal>
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
              <h2 className="text-3xl sm:text-5xl font-extrabold text-white mb-4 tracking-tight leading-[1.05]">
                Your customers are<br className="hidden sm:block" /> already on WhatsApp.
              </h2>
              <p className="text-emerald-50 text-sm sm:text-base mb-8 leading-relaxed">
                Meet them there. Launch a beautiful business page in two minutes —<br className="hidden sm:block" />
                free forever to start, no credit card, no setup fee.
              </p>
              <Link
                to="/start"
                className="group relative inline-flex items-center gap-2 bg-white text-emerald-700 font-bold text-base
                           px-8 py-4 rounded-2xl shadow-xl hover:shadow-2xl transition-all duration-200
                           hover:-translate-y-0.5 active:scale-[0.98] overflow-hidden"
              >
                <span className="absolute inset-0 overflow-hidden rounded-2xl">
                  <span className="absolute top-0 left-0 h-full w-1/3 bg-emerald-200/40 blur-md pl-sheen" />
                </span>
                <span className="relative">Create My Free Page</span>
                <ArrowRight size={18} className="relative transition-transform group-hover:translate-x-1" />
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
                <li><Link to="/start" className="hover:text-gray-900 transition-colors">Create free page</Link></li>
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

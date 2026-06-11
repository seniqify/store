import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, MessageCircle, Check, Star, Zap,
  Sparkles, ShoppingBag, ChevronRight,
  Pencil, Share2, QrCode, Copy, Globe, Plus,
  Wallet, Palette, Receipt, Smartphone, Gift,
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

const VALUE_PROPS = [
  { Icon: Smartphone, title: 'No app downloads',     desc: 'Your page opens in any browser. Customers order through WhatsApp — which they already have.' },
  { Icon: Wallet,     title: '0% commission',        desc: 'Keep every rupee. We never take a cut of your sales, unlike marketplaces and food apps.' },
  { Icon: Palette,    title: 'Beautiful by default', desc: 'Pick a colour, add a logo, done. Five page templates tuned for different businesses.' },
  { Icon: Receipt,    title: 'GST-ready pricing',    desc: 'Show tax-inclusive prices and totals. Orders arrive itemised and ready to fulfil.' },
  { Icon: Zap,        title: 'Live in minutes',      desc: 'No designers, no developers, no waiting. Publish today and share the link instantly.' },
  { Icon: Gift,       title: 'Free to start',        desc: 'Launch a real, working page on the free plan. Upgrade only when you outgrow it.' },
];

const USE_CASES = [
  { emoji: '🛒', label: 'Retail & Wholesale', desc: 'Electronics, groceries, apparel, manufacturers', color: '#0d9488' },
  { emoji: '🍽️', label: 'Restaurants & Food', desc: 'Cafes, cloud kitchens, bakeries, tiffins',        color: '#f97316' },
  { emoji: '🔧', label: 'Services & Agencies', desc: 'Salons, repairs, consultants, home services',     color: '#6366f1' },
  { emoji: '🏨', label: 'Lodges & Stay',       desc: 'Lodges, resorts, homestays, guest houses',         color: '#0ea5e9' },
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

// Pricing plans — 4 tiers (yearly = 12× monthly, billed on /plans + /checkout)
const PRICING_PLANS = [
  {
    name: 'Free', icon: '🌱', tagline: 'Get started today', accent: '#9ca3af',
    price: 0, originalPrice: null, priceNote: 'forever · no card needed',
    popular: false, to: '/start', cta: 'Start Free',
    features: ['10 products · 2 categories', 'WhatsApp orders', 'Shareable page link', 'GST-inclusive pricing'],
    caveat: '“Powered by PocketLink” badge',
  },
  {
    name: 'Pro', icon: '🚀', tagline: 'Look professional & get found', accent: '#34d399',
    price: 249, originalPrice: null, priceNote: '+ GST · billed monthly · cancel anytime',
    popular: false, to: '/start?plan=pro', cta: 'Get Pro',
    features: ['50 products · 10 categories', 'Verified badge', 'Order history & analytics', 'No PocketLink badge'],
    caveat: null,
  },
  {
    name: 'Business', icon: '👑', tagline: 'Sell without limits', accent: '#818cf8',
    price: 500, originalPrice: null, priceNote: '+ GST · billed monthly · cancel anytime',
    popular: true, to: '/start?plan=business', cta: 'Get Business',
    features: ['Unlimited products & categories', 'Discount codes & coupons', 'Product variants', 'Priority support'],
    caveat: null,
  },
  {
    name: 'Premium', icon: '👑', tagline: 'For serious sellers', accent: '#f59e0b',
    price: 1000, originalPrice: null, priceNote: '+ GST · billed monthly · cancel anytime',
    popular: false, to: '/start?plan=premium', cta: 'Get Premium',
    features: ['Everything in Business', 'Dedicated WhatsApp support', 'Personal onboarding & setup help', 'Early access to new features'],
    caveat: null,
  },
];

// Scrolling strip of business types under the hero
const MARQUEE = [
  { emoji: '🛒', label: 'Kirana & Grocery' },
  { emoji: '🍰', label: 'Bakeries' },
  { emoji: '🍽️', label: 'Restaurants' },
  { emoji: '💐', label: 'Florists' },
  { emoji: '🔧', label: 'Repairs & Services' },
  { emoji: '🏨', label: 'Lodges & Stay' },
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

/* ══ BUILD DEMO ════════════════════════════════════════════════════════════
 * Self-running animation for the 'Why PocketLink' section: a page builds
 * itself step-by-step (name → colour → product → publish → first order),
 * with a checklist ticking off live. Shows BOTH how easy it is AND the payoff.
 * Loops only while scrolled into view.
 * ─────────────────────────────────────────────────────────────────────────*/
const BUILD_COLORS = ['#10b981', '#f472b6', '#38bdf8', '#a78bfa', '#fb923c'];
const BUILD_STEPS = [
  'Add your business name',
  'Choose your brand colour',
  'Add your first product',
  'Publish — your page is live',
];

function BuildDemo() {
  const ioSupported = typeof IntersectionObserver !== 'undefined';
  const [stage, setStage] = useState(0);   // 0..5 (5 = first order arrives)
  const [hostEl, setHostEl] = useState(null);
  const [inView, setInView] = useState(!ioSupported);  // animate immediately if no IO

  // only animate when visible
  useEffect(() => {
    if (!hostEl || !ioSupported) return;
    const obs = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.3 });
    obs.observe(hostEl);
    return () => obs.disconnect();
  }, [hostEl, ioSupported]);

  // advance through stages on a loop while in view
  useEffect(() => {
    if (!inView) return;
    const delays = [800, 1100, 1100, 1200, 1500, 2800]; // per-stage dwell (ms)
    const t = setTimeout(() => setStage(s => (s + 1) % 6), delays[stage]);
    return () => clearTimeout(t);
  }, [stage, inView]);

  const colorIdx   = 1; // the colour it "picks" (pink) — pops vs default emerald
  const picked     = stage >= 2 ? BUILD_COLORS[colorIdx] : BUILD_COLORS[0];
  const nameShown  = stage >= 1;
  const colorShown = stage >= 2;
  const prodShown  = stage >= 3;
  const live       = stage >= 4;
  const ordered    = stage >= 5;

  return (
    <div ref={setHostEl}
         className="relative grid lg:grid-cols-2 gap-8 lg:gap-10 items-center
                    rounded-3xl border border-white/10 bg-white/[0.03] backdrop-blur-sm p-6 sm:p-8 mb-14 overflow-hidden">
      {/* soft glow that follows the picked colour */}
      <div className="absolute -top-24 -right-24 w-72 h-72 rounded-full blur-3xl opacity-40 pointer-events-none"
           style={{ background: `radial-gradient(circle, ${picked}, transparent 70%)`, transition: 'background 0.6s ease' }} />

      {/* ── Left: the building checklist ──────────────────────────────── */}
      <div className="relative">
        <p className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-emerald-300 mb-4">
          <Sparkles size={13} /> Watch a page build itself
        </p>
        <ul className="space-y-2.5">
          {BUILD_STEPS.map((label, i) => {
            const done    = stage >= i + 1;
            const current = stage === i;          // the step being "worked on" right now
            return (
              <li key={label} className={[
                'flex items-center gap-3 rounded-xl px-2.5 py-1.5 -mx-2.5 transition-colors duration-300',
                current ? 'bg-white/[0.06]' : '',
              ].join(' ')}>
                <span className={[
                  'flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center transition-all duration-500',
                  done ? 'bg-emerald-500 scale-100' : current ? 'bg-emerald-400/20 scale-100' : 'bg-white/10 scale-90',
                ].join(' ')}>
                  {done
                    ? <Check size={13} className="text-white" strokeWidth={3} />
                    : current
                      ? <span className="w-2.5 h-2.5 rounded-full border-2 border-emerald-300 border-t-transparent animate-spin" />
                      : <span className="w-1.5 h-1.5 rounded-full bg-white/40" />}
                </span>
                <span className={[
                  'text-sm font-semibold transition-colors duration-500',
                  done ? 'text-white' : current ? 'text-emerald-200' : 'text-white/40',
                ].join(' ')}>
                  {label}
                </span>
              </li>
            );
          })}
        </ul>

        {/* progress bar + percent */}
        <div className="mt-6 flex items-center gap-3">
          <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
            <div className="h-full rounded-full transition-all duration-700 ease-out"
                 style={{ width: `${Math.min(stage, 4) / 4 * 100}%`, background: 'linear-gradient(90deg, #34d399, #25D366)' }} />
          </div>
          <span className="text-xs font-bold text-emerald-300 tabular-nums w-9 text-right">
            {Math.round(Math.min(stage, 4) / 4 * 100)}%
          </span>
        </div>
        <p className="text-xs text-white/45 mt-3 min-h-[1rem]">
          {ordered
            ? <span className="text-emerald-300 font-semibold">🎉 Built in under 2 minutes — first order already in.</span>
            : live
              ? <span className="text-emerald-300 font-semibold">✓ Your page is live. Now just share the link.</span>
              : 'No code. No designer. Just a few taps.'}
        </p>
      </div>

      {/* ── Right: the phone filling in live ──────────────────────────── */}
      <div className="relative flex justify-center">
        <div className="relative w-[230px]">
          {/* live badge */}
          <div className={[
            'absolute -top-3 right-2 z-30 transition-all duration-500',
            live ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2',
          ].join(' ')}>
            <span className="inline-flex items-center gap-1 bg-emerald-500 text-white text-[10px] font-bold px-2.5 py-1 rounded-full shadow-lg shadow-emerald-500/40">
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" /> LIVE
            </span>
          </div>

          <div className="rounded-[2rem] bg-gray-900 p-2 shadow-2xl shadow-emerald-900/40 ring-1 ring-white/10">
            <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 w-20 h-4 bg-gray-900 rounded-b-xl" />
            <div className="relative rounded-[1.6rem] overflow-hidden bg-[#f8fafc] h-[380px] flex flex-col">

              {/* cover (colour fills in at stage 2) */}
              <div className="relative h-[4.75rem] flex-shrink-0 transition-all duration-700"
                   style={{ background: colorShown ? `linear-gradient(135deg, ${picked}, ${picked}cc)` : '#e5e7eb' }}>
                {colorShown && (
                  <div className="absolute inset-0 opacity-25"
                       style={{ backgroundImage: 'radial-gradient(circle, #ffffff55 1px, transparent 1px)', backgroundSize: '12px 12px' }} />
                )}
                <div className="absolute bottom-2.5 left-2.5 right-2.5 flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-white flex items-center justify-center text-sm shadow flex-shrink-0 transition-transform duration-500"
                       style={{ transform: colorShown ? 'scale(1)' : 'scale(0.9)' }}>
                    {colorShown ? '🍬' : <Plus size={14} className="text-gray-300" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    {/* name types in at stage 1 */}
                    {nameShown ? (
                      <p className="text-white font-extrabold text-[12px] leading-tight truncate">
                        Sharma Sweets{!live && <span className="inline-block w-0.5 h-3 bg-white/80 ml-0.5 align-middle animate-pulse" />}
                      </p>
                    ) : (
                      <div className="h-2.5 w-20 rounded bg-white/40" />
                    )}
                    {nameShown
                      ? <p className="text-white/80 text-[9px] leading-tight truncate mt-0.5">Fresh sweets, made daily</p>
                      : <div className="h-1.5 w-14 rounded bg-white/25 mt-1" />}
                  </div>
                </div>
              </div>

              {/* promo strip — appears once the page goes live */}
              <div className={[
                'mx-2.5 mt-2.5 rounded-lg px-2 py-1.5 flex items-center gap-1.5 transition-all duration-500 flex-shrink-0',
                live ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-1 h-0 py-0 mt-0',
              ].join(' ')}
                   style={{ backgroundColor: `${picked}14`, border: `1px solid ${picked}28` }}>
                <span className="text-xs">🎉</span>
                <span className="text-[9px] font-bold leading-tight" style={{ color: picked }}>Festival Special · 20% off boxes</span>
              </div>

              {/* product grid (first tile appears at stage 3) */}
              <div className="px-2.5 mt-2.5 grid grid-cols-2 gap-2 flex-1 content-start">
                {[0, 1, 2, 3].map((i) => {
                  const visible = prodShown && (i === 0 || stage >= 4);
                  const meta = [
                    { e:'🍰', n:'Kaju Katli', p:'₹450' }, { e:'🧁', n:'Motichoor', p:'₹380' },
                    { e:'🍮', n:'Rasmalai', p:'₹260' },   { e:'🍩', n:'Gulab Jamun', p:'₹220' },
                  ][i];
                  return (
                    <div key={i} className={[
                      'rounded-lg border p-1.5 transition-all duration-500',
                      visible ? 'bg-white border-gray-100 opacity-100 scale-100 shadow-sm' : 'bg-gray-100/50 border-dashed border-gray-200 opacity-70 scale-95',
                    ].join(' ')} style={{ transitionDelay: `${i * 80}ms` }}>
                      <div className="h-[2.1rem] rounded flex items-center justify-center text-base"
                           style={{ background: visible ? `${picked}12` : 'transparent' }}>
                        {visible ? meta.e : ''}
                      </div>
                      {visible ? (
                        <>
                          <p className="text-[9px] font-bold text-gray-700 leading-tight truncate mt-1">{meta.n}</p>
                          <div className="flex items-center justify-between mt-0.5">
                            <span className="text-[9px] font-extrabold text-gray-900">{meta.p}</span>
                            <span className="w-3.5 h-3.5 rounded text-white flex items-center justify-center leading-none" style={{ backgroundColor: picked }}>
                              <Plus size={9} strokeWidth={3} />
                            </span>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="h-1.5 w-10 rounded bg-gray-200 mt-1.5" />
                          <div className="h-1.5 w-6 rounded bg-gray-200 mt-1" />
                        </>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* bottom: WhatsApp order bar (idle) → first-order toast (stage 5) */}
              <div className="relative flex-shrink-0 p-2.5">
                {/* idle order bar — visible once live, hidden when toast shows */}
                <div className={[
                  'rounded-xl px-2.5 py-2 flex items-center justify-center gap-1.5 transition-all duration-500',
                  live && !ordered ? 'opacity-100' : 'opacity-0 absolute inset-x-2.5 bottom-2.5',
                ].join(' ')} style={{ backgroundColor: picked }}>
                  <MessageCircle size={12} className="text-white" />
                  <span className="text-white font-bold text-[10px]">Order on WhatsApp</span>
                </div>

                {/* first-order toast */}
                <div className={[
                  'rounded-xl bg-[#25D366] px-2.5 py-2 shadow-xl flex items-center gap-2 transition-all duration-500',
                  ordered ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 absolute inset-x-2.5 bottom-2.5',
                ].join(' ')}>
                  <span className="relative flex h-6 w-6 items-center justify-center rounded-full bg-white/20 flex-shrink-0">
                    <span className="absolute inline-flex h-full w-full rounded-full bg-white/30 animate-ping" />
                    <MessageCircle size={13} className="relative text-white" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-white font-bold text-[10px] leading-tight">New order · ₹1,280</p>
                    <p className="text-white/80 text-[9px] leading-tight">just landed in your WhatsApp</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── A 'How it works' step: mini-UI screen + caption ──────────────────── */
function HowStep({ n, title, desc, children }) {
  return (
    <div className="relative h-full rounded-3xl border border-gray-100 bg-white p-5 shadow-sm
                    hover:shadow-2xl hover:border-emerald-100 hover:-translate-y-1.5 transition-all duration-300">
      {/* step number badge */}
      <div className="absolute -top-3 left-5 z-10">
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-extrabold
                         uppercase tracking-wider text-white shadow-lg shadow-emerald-500/30"
              style={{ background: 'linear-gradient(90deg, #34d399, #0d9488)' }}>
          Step {n}
        </span>
      </div>
      {/* mini-UI "screen" */}
      <div className="relative rounded-2xl bg-gray-50/70 border border-gray-100 p-3 mb-4 mt-2 overflow-hidden">
        {/* faux browser dots */}
        <div className="flex items-center gap-1 mb-3">
          <span className="w-2 h-2 rounded-full bg-red-300" />
          <span className="w-2 h-2 rounded-full bg-amber-300" />
          <span className="w-2 h-2 rounded-full bg-emerald-300" />
        </div>
        {children}
      </div>
      <h3 className="font-extrabold text-gray-900 mb-1.5 text-lg tracking-tight">{title}</h3>
      <p className="text-sm text-gray-500 leading-relaxed">{desc}</p>
    </div>
  );
}

/* ══ LIVE PAGE BUILDER ════════════════════════════════════════════════════
 * The hero's signature interactive: the visitor types their business name and
 * their storefront materializes inside the phone — themed to their industry
 * (detected from keywords), with matching products. Idle → auto-demos.
 * ─────────────────────────────────────────────────────────────────────────*/

// Industry "recipes" — keyword-detected. Each themes the whole phone preview.
const BIZ_RECIPES = [
  {
    key: 'sweets', match: ['sweet', 'mithai', 'bakery', 'cake', 'dessert', 'chocolat'],
    emoji: '🍬', tagline: 'Fresh sweets, made daily', from: '#f472b6', to: '#db2777',
    promo: '🎉 Festival Special · 20% off boxes', accent: '#db2777',
    products: [
      { e: '🍰', n: 'Kaju Katli', p: '₹450' }, { e: '🧁', n: 'Motichoor', p: '₹380' },
      { e: '🍮', n: 'Rasmalai', p: '₹260' },  { e: '🍩', n: 'Gulab Jamun', p: '₹220' },
    ],
  },
  {
    key: 'salon', match: ['salon', 'beauty', 'spa', 'hair', 'glow', 'nails', 'makeup'],
    emoji: '💇', tagline: 'Look your best, every day', from: '#a78bfa', to: '#7c3aed',
    promo: '✨ This week · 15% off first visit', accent: '#7c3aed',
    products: [
      { e: '💇', n: 'Haircut & Style', p: '₹399' }, { e: '💅', n: 'Manicure', p: '₹299' },
      { e: '🧖', n: 'Facial', p: '₹699' },          { e: '💆', n: 'Head Massage', p: '₹349' },
    ],
  },
  {
    key: 'hotel', match: ['hotel', 'stay', 'lodge', 'resort', 'inn', 'rooms', 'homestay', 'sunset'],
    emoji: '🏨', tagline: 'Your home away from home', from: '#38bdf8', to: '#0284c7',
    promo: '🌙 Early-bird · 25% off bookings', accent: '#0284c7',
    products: [
      { e: '🛏️', n: 'Deluxe Room', p: '₹2,400' }, { e: '🏊', n: 'Pool Suite', p: '₹4,800' },
      { e: '🌅', n: 'Sea View', p: '₹3,600' },     { e: '👨‍👩‍👧', n: 'Family Room', p: '₹3,200' },
    ],
  },
  {
    key: 'food', match: ['restaurant', 'cafe', 'kitchen', 'food', 'biryani', 'pizza', 'dhaba', 'tiffin', 'tea'],
    emoji: '🍽️', tagline: 'Hot & fresh, made to order', from: '#fb923c', to: '#ea580c',
    promo: '🚚 Free delivery above ₹299', accent: '#ea580c',
    products: [
      { e: '🍛', n: 'Veg Biryani', p: '₹180' },  { e: '🍕', n: 'Margherita', p: '₹249' },
      { e: '🍔', n: 'Paneer Burger', p: '₹149' }, { e: '🥤', n: 'Cold Coffee', p: '₹99' },
    ],
  },
  {
    key: 'electronics', match: ['electronic', 'mobile', 'gadget', 'computer', 'tech', 'repair', 'digital'],
    emoji: '📱', tagline: 'Latest tech, best prices', from: '#34d399', to: '#0d9488',
    promo: '⚡ Mega Sale · up to 40% off', accent: '#0d9488',
    products: [
      { e: '🎧', n: 'Earbuds Pro', p: '₹1,999' }, { e: '🔌', n: '65W Charger', p: '₹899' },
      { e: '⌚', n: 'Smart Watch', p: '₹2,499' },  { e: '🔋', n: 'Power Bank', p: '₹1,299' },
    ],
  },
  {
    key: 'fashion', match: ['boutique', 'fashion', 'cloth', 'apparel', 'saree', 'wear', 'textile', 'style'],
    emoji: '👗', tagline: 'Style that speaks for you', from: '#f472b6', to: '#be185d',
    promo: '🛍️ New arrivals · flat 30% off', accent: '#be185d',
    products: [
      { e: '👗', n: 'Anarkali Set', p: '₹1,499' }, { e: '🥻', n: 'Silk Saree', p: '₹2,799' },
      { e: '👕', n: 'Cotton Kurta', p: '₹799' },   { e: '👜', n: 'Clutch Bag', p: '₹599' },
    ],
  },
];

// Default shown before the user types (also the first auto-demo)
const DEFAULT_RECIPE = BIZ_RECIPES[0];
// Names the builder auto-types when idle
const DEMO_NAMES = ['Sharma Sweets', 'Glow Salon', 'Sunset Hotel', 'Spice Kitchen', 'TechHub Mobiles', 'Bloom Boutique'];

function recipeFor(name) {
  const n = name.toLowerCase();
  for (const r of BIZ_RECIPES) {
    if (r.match.some(k => n.includes(k))) return r;
  }
  return null;
}

function LivePageBuilder() {
  const [typed, setTyped]     = useState('');     // what's in the input
  const [auto, setAuto]       = useState(true);   // idle auto-demo running?

  // Auto-demo: type a name, hold, delete, advance to next — until user interacts
  useEffect(() => {
    if (!auto) return;
    let nameIdx = 0, charIdx = 0, mode = 'typing', timer;
    const tick = () => {
      const name = DEMO_NAMES[nameIdx];
      if (mode === 'typing') {
        charIdx++;
        setTyped(name.slice(0, charIdx));
        if (charIdx >= name.length) { mode = 'hold'; timer = setTimeout(tick, 1900); return; }
        timer = setTimeout(tick, 95);
      } else if (mode === 'hold') {
        mode = 'deleting'; timer = setTimeout(tick, 380);
      } else {
        charIdx--;
        setTyped(name.slice(0, Math.max(0, charIdx)));
        if (charIdx <= 0) { nameIdx = (nameIdx + 1) % DEMO_NAMES.length; mode = 'typing'; timer = setTimeout(tick, 380); return; }
        timer = setTimeout(tick, 45);
      }
    };
    timer = setTimeout(tick, 700);
    return () => clearTimeout(timer);
  }, [auto]);

  const name    = typed.trim();
  const matched = name ? recipeFor(name) : null;
  const r       = matched || DEFAULT_RECIPE;
  const display = name || 'Your Business';
  const tagline = matched ? r.tagline : 'Type your business name…';

  return (
    <div className="relative mx-auto w-full max-w-[320px]">
      {/* Pulsing glow halo */}
      <div className="absolute -inset-10 rounded-[4rem] blur-3xl animate-pl-glow -z-10"
           style={{ background: `radial-gradient(circle, ${r.accent}66, rgba(45,212,191,0.18) 45%, transparent 70%)`, transition: 'background 0.6s ease' }} />

      {/* ── The magic input ─────────────────────────────────────────────── */}
      <div className="mb-4">
        <label className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-emerald-300/80 mb-2 justify-center lg:justify-start">
          <Sparkles size={12} /> Try it — type your business name
        </label>
        <div className="relative group">
          <input
            value={typed}
            onChange={(e) => { setAuto(false); setTyped(e.target.value.slice(0, 28)); }}
            onFocus={() => { setAuto(false); setTyped(''); }}
            placeholder="e.g. Sharma Sweets"
            aria-label="Type your business name to preview your page"
            className="w-full bg-white/[0.06] border border-white/20 focus:border-emerald-400/60 rounded-2xl
                       px-4 py-3 pr-11 text-white placeholder-white/30 text-base font-semibold
                       backdrop-blur-sm outline-none transition-colors focus:bg-white/[0.09]"
          />
          {/* live caret pulse / sparkle */}
          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-emerald-300 transition-transform group-focus-within:scale-110">
            {auto
              ? <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              : <Sparkles size={16} />}
          </span>
        </div>
        {/* detected-industry chip */}
        <div className="h-5 mt-2 text-center lg:text-left">
          {matched && (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-300 animate-pl-fade-up">
              <Check size={12} /> Detected: {r.key} page — building it live →
            </span>
          )}
        </div>
      </div>

      {/* ── The phone, themed live ──────────────────────────────────────── */}
      <div className="relative animate-pl-float">
        <div className="relative rounded-[2.6rem] bg-gray-900 p-2.5 shadow-2xl shadow-emerald-900/40 ring-1 ring-white/10">
          <div className="absolute top-2.5 left-1/2 -translate-x-1/2 z-20 w-28 h-5 bg-gray-900 rounded-b-2xl" />

          <div className="relative rounded-[2.1rem] overflow-hidden bg-[#f8fafc] h-[520px]">
            {/* Glass reflection sweep */}
            <div className="absolute inset-0 z-30 pointer-events-none overflow-hidden rounded-[2.1rem]">
              <div className="absolute -top-1/2 -left-1/4 w-1/2 h-[200%] bg-gradient-to-r from-transparent via-white/15 to-transparent pl-sheen" />
            </div>

            {/* Cover + header (themed) */}
            <div className="relative h-28" style={{ background: `linear-gradient(135deg, ${r.from}, ${r.to})`, transition: 'background 0.6s ease' }}>
              <div className="absolute inset-0 opacity-25"
                   style={{ backgroundImage: 'radial-gradient(circle, #ffffff55 1px, transparent 1px)', backgroundSize: '14px 14px' }} />
              <div className="absolute bottom-3 left-3 right-3 flex items-center gap-2.5">
                <div key={r.key} className="w-11 h-11 rounded-2xl bg-white flex items-center justify-center text-xl shadow-lg flex-shrink-0 animate-pl-pop"
                     style={{ animationDelay: '0s' }}>
                  {r.emoji}
                </div>
                <div className="min-w-0">
                  <p className="text-white font-extrabold text-sm leading-tight truncate">{display}</p>
                  <p className="text-white/80 text-[10px] truncate">{tagline}</p>
                </div>
              </div>
            </div>

            {/* Promo ribbon (themed) */}
            <div className="mx-3 mt-3 rounded-xl px-3 py-2 flex items-center gap-2 border transition-colors"
                 style={{ backgroundColor: `${r.accent}12`, borderColor: `${r.accent}30` }}>
              <span className="text-base">{r.promo.match(/^\S+/)?.[0]}</span>
              <p className="text-[11px] font-bold leading-tight" style={{ color: r.accent }}>
                {r.promo.replace(/^\S+\s/, '')}
              </p>
            </div>

            {/* Products (themed, re-animate on change) */}
            <div key={r.key} className="px-3 mt-3 grid grid-cols-2 gap-2.5">
              {r.products.map((it, idx) => (
                <div key={it.n} className="rounded-xl bg-white border border-gray-100 p-2 shadow-sm animate-pl-fade-up"
                     style={{ animationDelay: `${idx * 0.06}s` }}>
                  <div className="h-14 rounded-lg flex items-center justify-center text-2xl mb-1.5"
                       style={{ background: `linear-gradient(135deg, ${r.accent}12, ${r.accent}04)` }}>
                    {it.e}
                  </div>
                  <p className="text-[11px] font-bold text-gray-800 leading-tight truncate">{it.n}</p>
                  <div className="flex items-center justify-between mt-0.5">
                    <span className="text-[11px] font-extrabold text-gray-900">{it.p}</span>
                    <span className="w-5 h-5 rounded-md text-white flex items-center justify-center text-xs font-bold leading-none"
                          style={{ backgroundColor: r.accent }}>+</span>
                  </div>
                </div>
              ))}
            </div>

            {/* WhatsApp order confirmation */}
            <div className="absolute bottom-4 left-3 right-3 animate-pl-pop">
              <div className="rounded-2xl bg-[#25D366] px-3.5 py-3 shadow-xl shadow-emerald-900/30 flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center flex-shrink-0">
                  <MessageCircle size={16} className="text-white" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-white font-bold text-[11px] leading-tight">Order sent to WhatsApp ✓</p>
                  <p className="text-white/80 text-[10px] leading-tight truncate">New order for {display}</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Floating "new order" chip */}
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

        {/* Floating rating chip */}
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
    </div>
  );
}

export default function Landing() {
  // One demo per business type (static configs only for the landing page)
  const demoStores = listBusinesses().slice(0, 4);

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
              <a href="https://market.pocketlink.store" className="hover:text-white transition-colors">Explore</a>
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
                  <a
                    href="https://market.pocketlink.store"
                    className="inline-flex items-center gap-2 text-sm font-semibold text-white/70
                               hover:text-white transition-colors px-5 py-4 rounded-2xl border border-white/15
                               hover:border-white/30 hover:bg-white/5 w-full sm:w-auto justify-center"
                  >
                    Explore Local Businesses
                    <ArrowRight size={15} className="text-emerald-300" />
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

              {/* Right: live page builder */}
              <div className="flex justify-center lg:justify-end pl-rise" style={{ animationDelay: '0.24s' }}>
                <LivePageBuilder />
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

      {/* ── How it works — VISUAL FLOW ───────────────────────────────────── */}
      <section id="how" className="px-4 py-16 sm:py-24 bg-white">
        <div className="max-w-6xl mx-auto">
          <Reveal className="text-center mb-16">
            <p className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-emerald-700
                          bg-emerald-50 border border-emerald-100 rounded-full px-3 py-1 mb-4
                          before:content-[''] before:w-1.5 before:h-1.5 before:rounded-full before:bg-emerald-500">How it works</p>
            <h2 className="text-3xl sm:text-5xl font-extrabold text-gray-900 mb-3 tracking-tight">
              From idea to first order<br className="hidden sm:block" /> in three steps.
            </h2>
            <p className="text-sm sm:text-base text-gray-500">No designers. No developers. No monthly fee to start.</p>
          </Reveal>

          <div className="relative grid grid-cols-1 lg:grid-cols-3 gap-8 lg:gap-5">
            {/* flow arrows between panels (desktop) */}
            <div className="hidden lg:flex absolute top-[7.5rem] left-1/3 -translate-x-1/2 z-10 text-emerald-300">
              <ArrowRight size={26} className="animate-pl-float-slow" />
            </div>
            <div className="hidden lg:flex absolute top-[7.5rem] left-2/3 -translate-x-1/2 z-10 text-emerald-300">
              <ArrowRight size={26} className="animate-pl-float-slow" style={{ animationDelay: '1s' }} />
            </div>

            {/* STEP 1 — build form */}
            <Reveal delay={0} className="group">
              <HowStep n="01" title="Set up in minutes" desc="Add your name, products and prices. Pick a colour. Done — no tech skills needed.">
                <div className="space-y-2.5">
                  <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                    <Pencil size={13} className="text-gray-400" />
                    <span className="text-[12px] font-semibold text-gray-700">Sharma Sweets</span>
                    <span className="ml-auto w-1.5 h-3.5 bg-emerald-400 rounded-sm animate-pulse" />
                  </div>
                  <div className="flex items-center gap-2">
                    {['#10b981','#f472b6','#38bdf8','#a78bfa','#fb923c'].map((c, i) => (
                      <span key={c} className={`w-6 h-6 rounded-full ${i === 0 ? 'ring-2 ring-offset-2 ring-gray-900' : ''}`}
                            style={{ backgroundColor: c }} />
                    ))}
                    <Palette size={14} className="text-gray-300 ml-1" />
                  </div>
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    {[{e:'🍰',n:'Kaju Katli'},{e:'🧁',n:'Motichoor'}].map(p => (
                      <div key={p.n} className="rounded-lg border border-gray-100 bg-white p-2">
                        <div className="h-9 rounded bg-gradient-to-br from-pink-50 to-rose-50 flex items-center justify-center text-lg mb-1">{p.e}</div>
                        <p className="text-[10px] font-bold text-gray-700 truncate">{p.n}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </HowStep>
            </Reveal>

            {/* STEP 2 — share card with QR */}
            <Reveal delay={0.12} className="group">
              <HowStep n="02" title="Share one link" desc="Your page goes live instantly. Drop the link in your WhatsApp status, Insta bio — anywhere.">
                <div className="space-y-3">
                  <div className="flex items-center gap-2 rounded-lg border border-emerald-100 bg-emerald-50/60 px-3 py-2">
                    <Globe size={13} className="text-emerald-500" />
                    <span className="text-[11px] font-mono font-semibold text-emerald-700 truncate">pocketlink.store/sharma</span>
                    <Copy size={12} className="text-emerald-400 ml-auto flex-shrink-0" />
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-16 h-16 rounded-xl bg-white border border-gray-200 p-1.5 flex-shrink-0 shadow-sm">
                      <QrCode size={52} className="text-gray-800" strokeWidth={1.2} />
                    </div>
                    <div className="flex-1 space-y-1.5">
                      <div className="flex items-center gap-1.5 text-[11px] font-bold text-gray-700">
                        <Share2 size={12} className="text-emerald-500" /> Share anywhere
                      </div>
                      <div className="flex gap-1.5">
                        <span className="w-7 h-7 rounded-lg bg-[#25D366] flex items-center justify-center text-white"><MessageCircle size={13} /></span>
                        <span className="w-7 h-7 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white text-xs font-bold">IG</span>
                        <span className="w-7 h-7 rounded-lg bg-gray-100 flex items-center justify-center text-gray-500"><Copy size={13} /></span>
                      </div>
                    </div>
                  </div>
                </div>
              </HowStep>
            </Reveal>

            {/* STEP 3 — incoming WhatsApp order */}
            <Reveal delay={0.24} className="group">
              <HowStep n="03" title="Orders in your chat" desc="Customers tap “Send Order” and a tidy, itemised message lands straight in your WhatsApp.">
                <div className="rounded-xl bg-[#e5ddd5] p-2.5 space-y-2"
                     style={{ backgroundImage: 'radial-gradient(rgba(0,0,0,0.03) 1px, transparent 1px)', backgroundSize: '12px 12px' }}>
                  <div className="ml-auto max-w-[85%] rounded-xl rounded-tr-sm bg-[#dcf8c6] px-2.5 py-2 shadow-sm">
                    <p className="text-[10px] font-bold text-gray-800 mb-0.5">🛒 New Order · Sharma Sweets</p>
                    <p className="text-[10px] text-gray-600 leading-snug">2× Kaju Katli · 1× Motichoor<br/>Total: <span className="font-bold">₹1,280</span></p>
                    <p className="text-[9px] text-gray-500 mt-1">📍 MG Road, Jaipur · COD</p>
                    <span className="block text-right text-[8px] text-emerald-600 mt-0.5">12:04 ✓✓</span>
                  </div>
                  <div className="max-w-[70%] rounded-xl rounded-tl-sm bg-white px-2.5 py-1.5 shadow-sm">
                    <p className="text-[10px] text-gray-700">Confirmed! Out for delivery 🛵</p>
                    <span className="block text-right text-[8px] text-gray-400 mt-0.5">12:05</span>
                  </div>
                </div>
              </HowStep>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ── Why PocketLink (value props) — DARK ──────────────────────────── */}
      <section id="features" className="relative px-4 py-20 sm:py-28 bg-[#050a09] text-white overflow-hidden">
        {/* aurora + grid backdrop */}
        <div className="absolute inset-0 -z-10 pointer-events-none">
          <div className="absolute top-[-8rem] right-[-6rem] w-[36rem] h-[28rem] rounded-full blur-[120px] animate-pl-aurora"
               style={{ background: 'radial-gradient(circle, rgba(16,185,129,0.34), transparent 65%)' }} />
          <div className="absolute bottom-[-10rem] left-[-6rem] w-[32rem] h-[30rem] rounded-full blur-[120px] animate-pl-aurora"
               style={{ background: 'radial-gradient(circle, rgba(20,184,166,0.28), transparent 65%)', animationDelay: '6s' }} />
          <div className="absolute inset-0 opacity-[0.14]"
               style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)', backgroundSize: '48px 48px', maskImage: 'radial-gradient(ellipse 70% 60% at 50% 35%, black, transparent 75%)' }} />
        </div>

        <div className="max-w-5xl mx-auto">
          <Reveal className="text-center mb-14">
            <p className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-emerald-300
                          bg-white/5 border border-white/15 rounded-full px-3 py-1 mb-5
                          before:content-[''] before:w-1.5 before:h-1.5 before:rounded-full before:bg-emerald-400">Why PocketLink</p>
            <h2 className="text-3xl sm:text-5xl font-extrabold mb-4 tracking-tight">
              Everything a small shop needs.<br className="hidden sm:block" />
              <span className="text-white/45">Nothing it doesn't.</span>
            </h2>
            <p className="text-sm sm:text-base text-white/55 max-w-xl mx-auto">
              Built for Indian businesses that sell on WhatsApp — fast, fair and genuinely free to start.
            </p>
          </Reveal>

          {/* Self-running build demo */}
          <BuildDemo />

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {VALUE_PROPS.map(({ Icon, title, desc }, idx) => (
              <Reveal
                key={title}
                delay={(idx % 3) * 0.08}
                className="group relative bg-white/[0.04] border border-white/10 rounded-2xl p-6 backdrop-blur-sm overflow-hidden
                           hover:bg-white/[0.07] hover:border-emerald-400/30 hover:-translate-y-1.5 transition-all duration-300"
              >
                {/* corner glow on hover */}
                <div className="absolute -top-10 -right-10 w-28 h-28 rounded-full bg-emerald-400/25 blur-2xl
                                opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                <div className="relative w-12 h-12 rounded-2xl flex items-center justify-center mb-4
                                bg-emerald-400/10 border border-emerald-400/25 text-emerald-300
                                group-hover:scale-110 group-hover:-rotate-6 transition-transform duration-300">
                  <Icon size={22} strokeWidth={2} />
                </div>
                <h3 className="relative font-extrabold text-white mb-1.5 text-[15px]">{title}</h3>
                <p className="relative text-sm text-white/55 leading-relaxed">{desc}</p>
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

      {/* ── Live demo stores — DARK ──────────────────────────────────────── */}
      <section id="demos" className="relative px-4 py-20 sm:py-28 bg-[#050a09] text-white overflow-hidden">
        {/* aurora + grid backdrop */}
        <div className="absolute inset-0 -z-10 pointer-events-none">
          <div className="absolute top-[-8rem] left-[-6rem] w-[34rem] h-[28rem] rounded-full blur-[120px] animate-pl-aurora"
               style={{ background: 'radial-gradient(circle, rgba(20,184,166,0.32), transparent 65%)' }} />
          <div className="absolute bottom-[-10rem] right-[-6rem] w-[32rem] h-[30rem] rounded-full blur-[120px] animate-pl-aurora"
               style={{ background: 'radial-gradient(circle, rgba(16,185,129,0.28), transparent 65%)', animationDelay: '6s' }} />
          <div className="absolute inset-0 opacity-[0.14]"
               style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)', backgroundSize: '48px 48px', maskImage: 'radial-gradient(ellipse 70% 60% at 50% 35%, black, transparent 75%)' }} />
        </div>

        <div className="max-w-5xl mx-auto">
          <Reveal className="text-center mb-12">
            <p className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-emerald-300
                          bg-white/5 border border-white/15 rounded-full px-3 py-1 mb-5
                          before:content-[''] before:w-1.5 before:h-1.5 before:rounded-full before:bg-emerald-400">See it in action</p>
            <h2 className="text-3xl sm:text-5xl font-extrabold mb-4 tracking-tight">
              Browse{' '}
              <span className="pl-shimmer-text bg-clip-text text-transparent"
                    style={{ backgroundImage: 'linear-gradient(90deg, #34d399, #5eead4, #25D366, #34d399)' }}>
                live examples
              </span>
            </h2>
            <p className="text-sm sm:text-base text-white/55">
              Tap any page to explore a real, live example — exactly what your customers see.
            </p>
          </Reveal>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {demoStores.map((biz) => (
              <Link
                key={biz.slug}
                to={`/demo/${biz.slug}`}
                className="group bg-white/[0.04] border border-white/10 backdrop-blur-sm hover:border-emerald-400/30
                           hover:bg-white/[0.07] hover:-translate-y-1 rounded-2xl overflow-hidden
                           transition-all duration-300 block"
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
                  <div className="w-12 h-12 rounded-2xl bg-[#0c1512] shadow-lg flex items-center justify-center text-2xl mb-3 ring-1 ring-white/10">
                    {biz.logoEmoji}
                  </div>
                  <p className="font-bold text-white text-sm leading-tight truncate">{biz.businessName}</p>
                  <p className="text-xs text-white/45 mt-0.5 truncate leading-tight">{biz.tagline}</p>

                  <div className="flex items-center justify-between mt-4 pt-3 border-t border-white/10">
                    <span className="inline-flex items-center gap-1.5 text-xs text-white/45">
                      <ShoppingBag size={13} style={{ color: biz.theme.primary }} />
                      {biz.products.length}{' '}
                      {{ restaurant: 'dishes', service: 'services', hotel: 'rooms' }[biz.businessType] ?? 'products'}
                    </span>
                    <span className="inline-flex items-center text-xs font-bold group-hover:gap-1 gap-0.5 transition-all text-emerald-300">
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

      {/* ── Pricing (premium dark showcase) ──────────────────────────────── */}
      <section id="pricing" className="relative px-4 py-20 sm:py-28 bg-[#050a09] text-white overflow-hidden">
        {/* Aurora + grid backdrop */}
        <div className="absolute inset-0 -z-10 pointer-events-none">
          <div className="absolute top-[-8rem] left-1/2 -translate-x-1/2 w-[44rem] h-[28rem] rounded-full blur-[120px] animate-pl-aurora"
               style={{ background: 'radial-gradient(circle, rgba(16,185,129,0.4), transparent 65%)' }} />
          <div className="absolute bottom-[-10rem] right-[-6rem] w-[32rem] h-[32rem] rounded-full blur-[120px] animate-pl-aurora"
               style={{ background: 'radial-gradient(circle, rgba(99,102,241,0.28), transparent 65%)', animationDelay: '7s' }} />
          <div className="absolute inset-0 opacity-[0.15]"
               style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)', backgroundSize: '48px 48px', maskImage: 'radial-gradient(ellipse 70% 60% at 50% 30%, black, transparent 75%)' }} />
        </div>

        <div className="max-w-6xl mx-auto">
          <Reveal className="text-center mb-14">
            <p className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-emerald-300
                          bg-white/5 border border-white/15 rounded-full px-3 py-1 mb-5
                          before:content-[''] before:w-1.5 before:h-1.5 before:rounded-full before:bg-emerald-400">Pricing</p>
            <h2 className="text-3xl sm:text-5xl font-extrabold mb-4 tracking-tight">
              Pay nothing to start.<br className="hidden sm:block" />
              <span className="pl-shimmer-text bg-clip-text text-transparent"
                    style={{ backgroundImage: 'linear-gradient(90deg, #34d399, #5eead4, #25D366, #34d399)' }}>
                Upgrade when you grow.
              </span>
            </h2>
            <p className="text-sm sm:text-base text-white/55 max-w-md mx-auto">
              No credit card. No commission. No surprises — just one fair price when you're ready.
            </p>
          </Reveal>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 items-stretch">
            {PRICING_PLANS.map((plan, idx) => (
              <Reveal key={plan.name} delay={idx * 0.1}
                className={plan.popular ? 'lg:-mt-4 lg:-mb-4' : ''}>
                <div className={[
                  'relative h-full rounded-3xl p-[1.5px] transition-transform duration-300',
                  plan.popular ? 'hover:-translate-y-1' : 'hover:-translate-y-1',
                ].join(' ')}
                  style={plan.popular
                    ? { background: 'linear-gradient(160deg, #34d399, #14b8a6 45%, #0d9488)' }
                    : { background: 'linear-gradient(160deg, rgba(255,255,255,0.18), rgba(255,255,255,0.04))' }}>

                  {/* Glow behind the popular card */}
                  {plan.popular && (
                    <div className="absolute -inset-3 -z-10 rounded-[2rem] bg-emerald-500/25 blur-2xl animate-pl-glow" />
                  )}

                  <div className={[
                    'relative h-full rounded-3xl p-7 flex flex-col',
                    plan.popular ? 'bg-[#07110e]' : 'bg-white/[0.03] backdrop-blur-sm',
                  ].join(' ')}>

                    {/* Badge */}
                    {plan.popular && (
                      <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold px-3 py-1 rounded-full
                                         uppercase tracking-wider text-white shadow-lg shadow-emerald-500/40"
                              style={{ background: 'linear-gradient(90deg, #34d399, #0d9488)' }}>
                          <Zap size={10} className="fill-white" /> Most Popular
                        </span>
                      </div>
                    )}

                    {/* Header */}
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-11 h-11 rounded-2xl flex items-center justify-center text-xl flex-shrink-0"
                           style={{ backgroundColor: `${plan.accent}22`, border: `1px solid ${plan.accent}44` }}>
                        {plan.icon}
                      </div>
                      <div>
                        <h3 className="font-extrabold text-white text-lg leading-none">{plan.name}</h3>
                        <p className="text-[11px] text-white/45 mt-1">{plan.tagline}</p>
                      </div>
                    </div>

                    {/* Price */}
                    <div className="flex items-end gap-2 mb-1">
                      <span className="text-4xl font-extrabold tracking-tight text-white">
                        {plan.price === 0 ? 'Free' : `₹${plan.price}`}
                      </span>
                      {plan.price > 0 && <span className="text-sm text-white/40 mb-1.5">/month</span>}
                      {plan.originalPrice && (
                        <span className="text-sm text-white/30 line-through mb-1.5">₹{plan.originalPrice}</span>
                      )}
                    </div>
                    <p className="text-xs text-white/45 mb-6 pb-6 border-b border-white/10">
                      {plan.priceNote}
                    </p>

                    {/* Features */}
                    <ul className="space-y-3 flex-1 mb-7">
                      {plan.features.map((f) => (
                        <li key={f} className="flex items-start gap-2.5 text-sm text-white/75">
                          <span className="mt-0.5 flex-shrink-0 w-[18px] h-[18px] rounded-full flex items-center justify-center"
                                style={{ backgroundColor: `${plan.accent}26` }}>
                            <Check size={11} strokeWidth={3} style={{ color: plan.accent }} />
                          </span>
                          {f}
                        </li>
                      ))}
                      {plan.caveat && (
                        <li className="flex items-start gap-2.5 text-sm text-white/30">
                          <span className="mt-0.5 flex-shrink-0 w-[18px] h-[18px] rounded-full bg-white/5 flex items-center justify-center text-[10px]">✗</span>
                          <span className="line-through">{plan.caveat}</span>
                        </li>
                      )}
                    </ul>

                    {/* CTA */}
                    <Link
                      to={plan.to}
                      className={[
                        'group/btn relative block text-center py-3.5 rounded-xl text-sm font-bold transition-all',
                        'active:scale-[0.98] overflow-hidden',
                        plan.popular
                          ? 'text-white shadow-lg shadow-emerald-500/30 hover:-translate-y-0.5'
                          : 'text-white border border-white/15 hover:bg-white/10 hover:border-white/30',
                      ].join(' ')}
                      style={plan.popular ? { background: 'linear-gradient(90deg, #25D366, #0d9488)' } : undefined}
                    >
                      {plan.popular && (
                        <span className="absolute inset-0 overflow-hidden rounded-xl">
                          <span className="absolute top-0 left-0 h-full w-1/3 bg-white/30 blur-md pl-sheen" />
                        </span>
                      )}
                      <span className="relative inline-flex items-center justify-center gap-1.5">
                        {plan.cta}
                        <ArrowRight size={15} className="transition-transform group-hover/btn:translate-x-0.5" />
                      </span>
                    </Link>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>

          {/* Trust strip */}
          <div className="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-white/45">
            <span className="inline-flex items-center gap-1.5"><Check size={13} className="text-emerald-400" /> 6-month &amp; yearly plans save more</span>
            <span className="inline-flex items-center gap-1.5"><Check size={13} className="text-emerald-400" /> Cancel anytime</span>
            <span className="inline-flex items-center gap-1.5"><Check size={13} className="text-emerald-400" /> 0% commission on every plan</span>
          </div>
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
            ].map(({ q, a }, idx) => (
              <Reveal key={q} delay={Math.min(idx, 4) * 0.05}>
                <details className="group bg-white border border-gray-100 rounded-2xl shadow-sm
                                    open:shadow-lg open:border-emerald-100 hover:border-emerald-100 transition-all duration-200">
                  <summary className="flex items-center justify-between gap-3 px-5 py-4 cursor-pointer
                                      font-bold text-[15px] text-gray-900 list-none
                                      [&::-webkit-details-marker]:hidden select-none">
                    {q}
                    <span className="flex-shrink-0 w-7 h-7 rounded-full bg-emerald-50 text-emerald-600
                                     flex items-center justify-center text-lg leading-none font-light
                                     transition-all duration-300 group-open:rotate-45 group-open:bg-emerald-500 group-open:text-white">
                      +
                    </span>
                  </summary>
                  <p className="px-5 pb-5 -mt-1 text-sm text-gray-500 leading-relaxed">
                    {a}
                  </p>
                </details>
              </Reveal>
            ))}
          </div>

          {/* Still have questions? */}
          <Reveal delay={0.1} className="mt-8 text-center">
            <div className="inline-flex flex-col sm:flex-row items-center gap-3 bg-gray-50 border border-gray-100 rounded-2xl px-6 py-4">
              <span className="text-sm text-gray-500">Still have a question?</span>
              <a href="mailto:hello@pocketlink.store"
                 className="inline-flex items-center gap-1.5 text-sm font-bold text-emerald-600 hover:text-emerald-700 transition-colors">
                <MessageCircle size={15} /> Talk to us
              </a>
            </div>
          </Reveal>
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

      {/* ── Footer (premium dark finish) ─────────────────────────────────── */}
      <footer className="relative bg-[#050a09] text-white overflow-hidden">
        {/* subtle aurora + grid */}
        <div className="absolute inset-0 -z-10 pointer-events-none">
          <div className="absolute bottom-[-12rem] left-1/2 -translate-x-1/2 w-[44rem] h-[24rem] rounded-full blur-[120px] animate-pl-aurora"
               style={{ background: 'radial-gradient(circle, rgba(16,185,129,0.22), transparent 65%)' }} />
          <div className="absolute inset-0 opacity-[0.12]"
               style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)', backgroundSize: '48px 48px', maskImage: 'radial-gradient(ellipse 70% 80% at 50% 100%, black, transparent 75%)' }} />
        </div>

        <div className="max-w-6xl mx-auto px-4 py-14">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-8 mb-12">
            <div className="col-span-2 sm:col-span-1">
              <img src="/pocketlink-logo.svg" alt="PocketLink" className="h-7 w-auto mb-4 brightness-0 invert" />
              <p className="text-xs text-white/45 leading-relaxed max-w-[210px] mb-4">
                Helping small businesses go digital — simple business pages, orders on WhatsApp. 🌍
              </p>
              <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-300
                              bg-white/5 border border-white/10 rounded-full px-2.5 py-1">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400" />
                </span>
                Made in India 🇮🇳
              </div>
            </div>
            <div>
              <p className="text-[11px] font-bold text-white/40 uppercase tracking-widest mb-4">Product</p>
              <ul className="space-y-2.5 text-sm text-white/60">
                <li><a href="#how" className="hover:text-emerald-300 transition-colors">How it works</a></li>
                <li><a href="#features" className="hover:text-emerald-300 transition-colors">Features</a></li>
                <li><a href="#pricing" className="hover:text-emerald-300 transition-colors">Pricing</a></li>
                <li><a href="#demos" className="hover:text-emerald-300 transition-colors">Live demos</a></li>
              </ul>
            </div>
            <div>
              <p className="text-[11px] font-bold text-white/40 uppercase tracking-widest mb-4">Get started</p>
              <ul className="space-y-2.5 text-sm text-white/60">
                <li><Link to="/start" className="hover:text-emerald-300 transition-colors">Create free page</Link></li>
                <li><Link to="/plans" className="hover:text-emerald-300 transition-colors">Plans</Link></li>
              </ul>
            </div>
            <div>
              <p className="text-[11px] font-bold text-white/40 uppercase tracking-widest mb-4">Company</p>
              <ul className="space-y-2.5 text-sm text-white/60">
                <li><Link to="/terms" className="hover:text-emerald-300 transition-colors">Terms of Service</Link></li>
                <li><Link to="/privacy" className="hover:text-emerald-300 transition-colors">Privacy Policy</Link></li>
                <li><a href="mailto:hello@pocketlink.store" className="hover:text-emerald-300 transition-colors">Contact us</a></li>
              </ul>
            </div>
          </div>
          <div className="pt-6 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-xs text-white/40">© {new Date().getFullYear()} PocketLink. All rights reserved.</p>
            <p className="text-xs text-white/40">Made with 💚 for small businesses</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

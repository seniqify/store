import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Check, ChevronDown, ShieldCheck, Sparkles, Star, ArrowRight, Zap } from 'lucide-react';

// ── Billing periods ───────────────────────────────────────────────────────────
const PERIODS = [
  { key: 'monthly', label: 'Monthly' },
  { key: 'yearly',  label: 'Yearly'  },
];

// Front-end price DISPLAY only. The amount actually debited comes from the
// Razorpay plan_id in supabase/functions/create-razorpay-subscription — these
// numbers MUST match the amount of the plan_id wired there, or a customer sees
// one price and gets charged another. Internal keys are unchanged for
// grandfathering: 'business' = Growth, 'premium' = Pro.
const PRICING = {
  business: { monthly: 199, yearly: 1999 },   // Growth
  premium:  { monthly: 599, yearly: 5999 },   // Pro
};

// Optional marketplace add-on (not self-serve yet — activation goes through
// support on WhatsApp; founder enables it manually).
const FEATURED_PRICE = 299;
const SUPPORT_WA = '918482840808';

// ── Plans ──────────────────────────────────────────────────────────────────────
// Free was retired (2026-07-23): zero-commitment signups mostly went dead —
// never touched again — rather than converting, so every store now requires
// a paid plan upfront. Existing free stores from before this change are
// grandfathered and keep working; see planLimits.js for their limits.
const PLANS = [
  {
    key: 'business',
    name: 'Growth',
    best: 'For growing businesses',
    popular: true,
    accent: '#10b981',
    cta: 'Get Growth',
    // Self-contained — this is the entry tier now, so it lists everything a
    // store gets, not just a delta on top of a Free plan that no longer exists.
    features: [
      'WhatsApp orders + QR code',
      'Mobile-ready store + basic SEO',
      '50 products · 10 categories',
      'No PocketLink branding — verified business badge',
      'Unlimited AI product search + AI product assistant',
      'Product variants, coupons & discounts',
      'Online payments',
      'Cart & order management + history',
      'Customer insights & sales analytics',
      'Store theme customization',
      'Business hours & delivery settings',
      'AI auto-fill · smart categories',
      'Priority support',
    ],
  },
  {
    key: 'premium',
    name: 'Pro',
    best: 'For businesses that want to scale',
    accent: '#8b5cf6',
    cta: 'Go Pro',
    inherits: 'Growth',
    features: [
      'Unlimited products & categories',
      'Unlimited AI assistant usage',
      'AI business insights',
      'Advanced analytics — returning customers, conversion & peak hours',
      'Offers engine — flash, weekend & festival sales',
      'Auto WhatsApp order updates',
      'Priority support',
      'Early access to new features',
    ],
  },
];

const FEATURED_BENEFITS = [
  'Higher search ranking',
  'Featured badge',
  'Priority listing',
  'Festival promotions',
  'More customer visibility',
];

const GUARANTEES = [
  ['💸', '0% commission'],
  ['🔁', 'Cancel anytime'],
  ['🌐', 'Page stays live'],
  ['🔒', 'Secure payment'],
  ['🧾', 'GST invoice'],
];

const UNIVERSAL = [
  ['🔗', 'Shareable link'], ['💬', 'WhatsApp orders'], ['📱', 'Mobile-first'], ['⚡', 'Live in 2 min'],
  ['🆓', 'No app for buyers'], ['🏷️', 'QR code for your shop'], ['🏦', 'UPI + Bank + COD'], ['🔒', 'Secure & private'],
];

const FAQS = [
  { q: 'How much does PocketLink cost?', a: 'Growth is ₹199/month — a complete, branded store for a growing business. Pro is ₹599/month — unlimited everything plus the full AI suite and scaling tools. No setup fee, cancel anytime.' },
  { q: 'What’s the difference between Growth and Pro?', a: 'Growth removes PocketLink branding and gives you a verified store with variants, coupons, online payments, customer insights and the AI product assistant — up to 50 products. Pro removes every limit and adds unlimited AI assistant usage, AI business insights, advanced analytics (returning customers, conversion, peak hours), the offers engine, automatic WhatsApp order updates and priority support.' },
  { q: 'Do you charge per order or per message?', a: 'Never. Orders arrive on WhatsApp, which is always free, and we never take a cut of your sales — 0% commission on every plan.' },
  { q: 'Is paying yearly cheaper?', a: 'Yes. Growth is ₹1,999/year (save ₹389 vs monthly) and Pro is ₹5,999/year (save ₹1,189) — roughly two months free. It auto-renews yearly so your store never lapses.' },
  { q: 'What is the Featured Store add-on?', a: 'An optional ₹299/month boost that lifts your shop’s ranking inside the PocketLink Marketplace — a featured badge, priority listing and festival promotions for more customer visibility. Add it on top of any plan.' },
  { q: 'Can I cancel or switch plans anytime?', a: 'Anytime — no contracts, no lock-in. Your store keeps working; you simply lose the paid features, it never goes offline.' },
  { q: 'How do I pay and how soon does it activate?', a: 'Securely via UPI, debit/credit card or net banking through Razorpay, with a GST invoice for every payment. Your plan activates the instant payment succeeds — no waiting.' },
];

export default function Plans() {
  const navigate = useNavigate();
  const phone    = sessionStorage.getItem('pocketlink_verified_phone');

  const [period, setPeriod] = useState('monthly');
  const [faq,    setFaq]    = useState(null);

  function choosePlan(planKey) {
    if (phone) {
      navigate(`/checkout/${planKey}?period=${period}`);
    } else {
      sessionStorage.setItem('pocketlink_upgrade_plan', planKey);
      navigate(`/start?plan=${planKey}&upgrade=1`);
    }
  }

  function getFeatured() {
    if (SUPPORT_WA) {
      const msg = encodeURIComponent('Hi PocketLink — I’d like to add the Featured Store boost (₹299/mo) to my shop.');
      window.open(`https://wa.me/${SUPPORT_WA}?text=${msg}`, '_blank', 'noopener');
    } else {
      navigate('/start');
    }
  }

  const maxSave = Math.max(
    ...Object.values(PRICING).map((p) => p.monthly * 12 - p.yearly),
  );

  return (
    <div className="relative min-h-screen overflow-hidden"
         style={{ background: 'linear-gradient(170deg, #061310 0%, #0a2a20 45%, #05110d 100%)' }}>

      {/* aurora + grid */}
      <div className="absolute inset-0 -z-10 pointer-events-none">
        <div className="absolute top-[-8rem] left-1/2 -translate-x-1/2 w-[44rem] h-[28rem] rounded-full blur-[120px] animate-pl-aurora"
             style={{ background: 'radial-gradient(circle, rgba(16,185,129,0.35), transparent 65%)' }} />
        <div className="absolute bottom-[-10rem] right-[-6rem] w-[30rem] h-[26rem] rounded-full blur-[120px] animate-pl-aurora"
             style={{ background: 'radial-gradient(circle, rgba(20,184,166,0.22), transparent 65%)', animationDelay: '7s' }} />
        <div className="absolute inset-0 opacity-[0.05]"
             style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)', backgroundSize: '46px 46px', maskImage: 'radial-gradient(ellipse 80% 50% at 50% 18%, #000, transparent 75%)' }} />
      </div>

      {/* Nav */}
      <nav className="sticky top-0 z-20 border-b border-white/10 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link to="/"><img src="/pocketlink-logo.svg" alt="PocketLink" className="h-8 w-auto brightness-0 invert" /></Link>
          {phone && (
            <span className="hidden sm:flex items-center gap-1.5 text-xs font-medium
                             bg-white/5 border border-white/15 text-emerald-300 px-3 py-1.5 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              +91 {phone.replace('91', '').replace(/(\d{5})(\d{5})/, '$1 $2')}
            </span>
          )}
        </div>
      </nav>

      <div className="relative max-w-6xl mx-auto px-4 py-12 sm:py-16">

        {/* Header */}
        <div className="text-center mb-9 animate-pl-fade-up">
          <span className="inline-flex items-center gap-2 bg-white/5 border border-white/15 text-emerald-300
                           text-[11px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-full mb-5">
            <Sparkles size={12} /> Simple, transparent pricing
          </span>
          <h1 className="text-3xl sm:text-5xl font-extrabold text-white mb-3 tracking-tight">
            Pricing that{' '}
            <span className="bg-gradient-to-r from-emerald-300 to-teal-300 bg-clip-text text-transparent">grows with you</span>
          </h1>
          <p className="text-white/55 text-sm sm:text-base max-w-lg mx-auto">
            Pick a plan and go live in minutes. No contracts, no per-order fees — an AI storefront and local marketplace, all on WhatsApp.
          </p>
        </div>

        {/* Billing toggle */}
        <div className="flex justify-center mb-11">
          <div className="inline-flex items-center bg-white/5 border border-white/10 rounded-2xl p-1 gap-1">
            {PERIODS.map((p) => (
              <button key={p.key} onClick={() => setPeriod(p.key)}
                className={[
                  'relative px-5 py-2 rounded-xl text-sm font-semibold transition-all duration-150',
                  period === p.key ? 'bg-white text-gray-900 shadow-sm' : 'text-white/55 hover:text-white',
                ].join(' ')}>
                {p.label}
                {p.key === 'yearly' && (
                  <span className={`ml-2 text-[10px] font-bold ${period === 'yearly' ? 'text-emerald-600' : 'text-emerald-300'}`}>
                    save ₹{maxSave.toLocaleString('en-IN')}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Plan cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 items-start max-w-2xl mx-auto">
          {PLANS.map((plan) => {
            const price    = PRICING[plan.key];
            const effMonth = period === 'yearly' ? Math.round(price.yearly / 12) : price.monthly;
            const perDay   = Math.max(1, Math.round(effMonth / 30));
            const save     = price.monthly * 12 - price.yearly;
            const popular  = plan.popular;

            return (
              <div key={plan.key}
                className={[
                  'relative flex flex-col rounded-3xl p-6 sm:p-7 transition-all duration-200',
                  popular
                    ? 'bg-white/[0.09] border-2 shadow-2xl lg:-translate-y-3'
                    : 'bg-white/[0.04] border border-white/10 hover:bg-white/[0.06]',
                ].join(' ')}
                style={popular ? { borderColor: plan.accent, boxShadow: `0 24px 60px ${plan.accent}26` } : {}}>

                {popular && (
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                    <span className="inline-flex items-center gap-1 text-white text-[10px] font-bold px-3 py-1
                                     rounded-full uppercase tracking-wider shadow-lg"
                          style={{ backgroundColor: plan.accent }}>
                      <Zap size={9} fill="white" /> Most popular
                    </span>
                  </div>
                )}

                <h2 className="font-extrabold text-lg" style={{ color: plan.accent }}>{plan.name}</h2>
                <p className="text-xs text-white/45 mt-0.5 mb-5">{plan.best}</p>

                {/* Price */}
                <div className="pb-5 mb-5 border-b border-white/10">
                  <div className="flex items-baseline gap-2">
                    <p className="text-4xl font-extrabold text-white">
                      ₹{effMonth}<span className="text-base font-normal text-white/45">/mo</span>
                    </p>
                    {period === 'yearly' && (
                      <span className="text-lg font-semibold text-white/35 line-through">₹{price.monthly}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                          style={{ backgroundColor: `${plan.accent}22`, color: plan.accent }}>
                      ≈ ₹{perDay}/day
                    </span>
                    {period === 'yearly' && (
                      <span className="text-[11px] font-bold text-emerald-300">save ₹{save.toLocaleString('en-IN')}/yr</span>
                    )}
                  </div>
                  <p className="text-xs text-white/40 mt-2">
                    {period === 'monthly'
                      ? 'billed monthly · cancel anytime'
                      : `₹${price.yearly.toLocaleString('en-IN')} billed yearly`}
                  </p>
                </div>

                {/* CTA */}
                <button onClick={() => choosePlan(plan.key)}
                  className="w-full py-3.5 rounded-xl text-sm font-bold text-white shadow-lg transition-all
                             active:scale-[0.98] inline-flex items-center justify-center gap-1.5"
                  style={{ backgroundColor: plan.accent, boxShadow: `0 10px 30px ${plan.accent}40` }}>
                  {plan.cta} <ArrowRight size={15} />
                </button>

                {/* Features */}
                <div className="mt-6">
                  {plan.inherits && (
                    <p className="text-[11px] font-bold uppercase tracking-wider text-white/40 mb-3">
                      Everything in {plan.inherits}, plus
                    </p>
                  )}
                  <ul className="space-y-2.5">
                    {plan.features.map((f) => (
                      <li key={f} className="flex items-start gap-2.5 text-[13px] text-white/80">
                        <span className="mt-0.5 flex-shrink-0 w-4 h-4 rounded-full flex items-center justify-center"
                              style={{ backgroundColor: `${plan.accent}26` }}>
                          <Check size={11} strokeWidth={3} style={{ color: plan.accent }} />
                        </span>
                        {f}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            );
          })}
        </div>

        {/* Guarantee strip */}
        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 rounded-2xl
                        bg-white/[0.04] border border-white/10 px-5 py-3.5">
          {GUARANTEES.map(([e, t]) => (
            <span key={t} className="inline-flex items-center gap-1.5 text-xs font-medium text-white/70">
              <span>{e}</span> {t}
            </span>
          ))}
        </div>
        <p className="text-center text-[11px] text-white/35 mt-3">
          Prices exclusive of GST · Paid plans activate instantly after payment · Cancel anytime
        </p>

        {/* ── Marketplace Promotion (add-ons) ── */}
        <div className="mt-14">
          <div className="text-center mb-6">
            <h3 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight">Marketplace Promotion</h3>
            <p className="text-sm text-white/50 mt-1">Optional add-ons — stack on top of any plan</p>
          </div>

          <div className="max-w-2xl mx-auto rounded-3xl p-[1.5px] shadow-2xl"
               style={{ background: 'linear-gradient(135deg, #f59e0b, #10b981 60%, #8b5cf6)' }}>
            <div className="rounded-3xl bg-[#07130f] p-6 sm:p-8">
              <div className="flex flex-col sm:flex-row sm:items-start gap-6">
                <div className="flex-1 min-w-0">
                  <div className="inline-flex items-center gap-2 mb-3">
                    <span className="w-9 h-9 rounded-xl bg-amber-400/15 border border-amber-300/30 flex items-center justify-center">
                      <Star size={18} className="text-amber-300" fill="currentColor" />
                    </span>
                    <h4 className="text-lg font-extrabold text-white">Featured Store</h4>
                  </div>
                  <p className="text-sm text-white/60 mb-4 max-w-sm">
                    Get higher visibility inside the PocketLink Marketplace so more nearby customers discover you.
                  </p>
                  <ul className="grid sm:grid-cols-2 gap-x-5 gap-y-2">
                    {FEATURED_BENEFITS.map((b) => (
                      <li key={b} className="flex items-center gap-2 text-[13px] text-white/80">
                        <Check size={13} strokeWidth={3} className="text-amber-300 flex-shrink-0" />
                        {b}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="sm:text-right sm:pl-6 sm:border-l border-white/10 flex sm:flex-col items-center sm:items-end justify-between gap-3">
                  <div>
                    <p className="text-3xl font-extrabold text-white whitespace-nowrap">₹{FEATURED_PRICE}<span className="text-sm font-normal text-white/50">/mo</span></p>
                    <p className="text-[11px] text-white/40 mt-0.5">cancel anytime</p>
                  </div>
                  <button onClick={getFeatured}
                    className="inline-flex items-center gap-1.5 bg-white text-gray-900 font-bold text-sm px-5 py-3 rounded-xl
                               hover:bg-amber-50 transition-colors active:scale-[0.98] whitespace-nowrap">
                    Feature My Store <ArrowRight size={15} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Every plan includes */}
        <div className="mt-14 rounded-3xl bg-white/[0.03] border border-white/10 p-7">
          <h3 className="font-bold text-white/80 text-sm mb-6 text-center">Every plan includes</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {UNIVERSAL.map(([icon, text]) => (
              <div key={text} className="flex items-center gap-2.5 text-xs text-white/65">
                <span className="w-8 h-8 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-base leading-none flex-shrink-0">{icon}</span>
                <span className="font-medium">{text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* FAQ */}
        <div className="mt-14 max-w-2xl mx-auto">
          <h3 className="text-center text-xl font-extrabold text-white mb-6">Questions, answered</h3>
          <div className="space-y-2.5">
            {FAQS.map((item, i) => {
              const isOpen = faq === i;
              return (
                <div key={item.q} className="rounded-2xl bg-white/[0.04] border border-white/10 overflow-hidden">
                  <button onClick={() => setFaq(isOpen ? null : i)}
                    className="w-full flex items-center justify-between gap-3 text-left px-5 py-4">
                    <span className="text-sm font-semibold text-white/90">{item.q}</span>
                    <ChevronDown size={16} className={`flex-shrink-0 text-emerald-300 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
                  </button>
                  <div className={`grid transition-all duration-300 ${isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                    <div className="overflow-hidden">
                      <p className="px-5 pb-4 text-sm text-white/55 leading-relaxed">{item.a}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Closing reassurance */}
        <div className="mt-12 text-center">
          <p className="inline-flex items-center gap-2 text-sm font-semibold text-white/80">
            <ShieldCheck size={16} className="text-emerald-400" />
            No contracts, no lock-in — cancel anytime and your page stays live.
          </p>
        </div>
      </div>
    </div>
  );
}

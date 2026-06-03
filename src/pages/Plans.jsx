import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Check, X, Zap, ChevronDown, ShieldCheck, Sparkles } from 'lucide-react';

// ── Billing periods (yearly = 12× monthly — one invoice, no discount) ──────────
const PERIODS = [
  { key: 'monthly', label: 'Monthly', badge: null          },
  { key: 'yearly',  label: 'Yearly',  badge: 'One payment'  },
];

// per-month display rate + total charge amount (yearly = rate × 12)
const PRICING = {
  starter: {
    monthly: { rate: 149, charge: 149  },
    yearly:  { rate: 149, charge: 1788 },
  },
  pro: {
    monthly: { rate: 249, charge: 249  },
    yearly:  { rate: 249, charge: 2988 },
  },
  business: {
    monthly: { rate: 499, charge: 499  },
    yearly:  { rate: 499, charge: 5988 },
  },
};

// ── Plans (highlights = always shown · features = inside the dropdown) ─────────
const PLANS = [
  {
    key: 'free', name: 'Free', tagline: 'Get online today',
    accent: '#64748b', cta: 'Start Free',
    highlights: ['10 products · 2 categories', 'WhatsApp order messages', 'Your own shareable link'],
    features: ['10 products · 2 categories', 'WhatsApp order messages', 'Your own shareable link', 'GST-ready pricing', 'UPI + Bank + COD checkout'],
    missing: ['Carries a small “Powered by PocketLink” badge', 'No Verified badge'],
  },
  {
    key: 'starter', name: 'Starter', tagline: 'Look professional',
    accent: '#14b8a6', cta: 'Get Starter',
    highlights: ['20 products · 5 categories', 'Your brand only — badge removed', 'Promo banners & announcements'],
    features: [
      '20 products · 5 categories',
      'No “Powered by” badge — 100% your brand',
      'Promo banners & page announcements',
      'Zero per-order cost — WhatsApp stays free',
      'Share one link on bio, status, everywhere',
      'Email support',
    ],
    missing: ['Verified badge is on Pro & Business'],
  },
  {
    key: 'pro', name: 'Pro', tagline: 'For growing businesses', popular: true,
    accent: '#10b981', cta: 'Get Pro',
    highlights: ['50 products · 10 categories', 'Verified badge ✓', 'Order history & analytics'],
    features: [
      '50 products · 10 categories',
      'Everything in Starter',
      'Verified badge — instant customer trust',
      'Order history to track & re-engage',
      'Sales analytics dashboard',
      'Email support',
    ],
  },
  {
    key: 'business', name: 'Business', tagline: 'Scale with no limits',
    accent: '#8b5cf6', cta: 'Get Business',
    highlights: ['Unlimited products & categories', 'Discount codes & coupons', 'Priority support'],
    features: [
      'Unlimited products & categories',
      'Everything in Pro',
      'Discount codes & coupons',
      'Product variants — size, colour & more',
      'Priority WhatsApp support',
    ],
  },
];

const GUARANTEES = [
  ['🚫', 'No per-order fees'],
  ['🔁', 'Cancel anytime'],
  ['🌐', 'Page stays live'],
  ['🔒', 'Secure payment'],
  ['🧾', 'GST invoice'],
];

const UNIVERSAL = [
  ['🔗', 'Shareable link'], ['💬', 'WhatsApp orders'], ['📱', 'Mobile-first'], ['⚡', 'Live in 2 min'],
  ['🆓', 'No app for buyers'], ['💰', 'GST-ready'], ['🏦', 'UPI + Bank + COD'], ['🔒', 'Secure & private'],
];

const FAQS = [
  { q: 'Is the free plan really free?', a: 'Yes — free forever, no credit card. Your page stays live on Free for as long as you like.' },
  { q: 'Do you charge per order or per message?', a: 'Never. Orders arrive on WhatsApp, which is always free, and we never take a cut of your sales.' },
  { q: 'Can I cancel or switch plans anytime?', a: 'Anytime — no contracts, no lock-in. If you downgrade, your page simply moves to the Free plan; it never goes offline.' },
  { q: 'How do I pay?', a: 'Securely via UPI, debit/credit card or net banking. You get a GST invoice for every payment.' },
  { q: 'How soon does my plan activate?', a: 'Instantly. The moment your payment succeeds, your plan is live — no waiting, no manual confirmation.' },
];

export default function Plans() {
  const navigate = useNavigate();
  const phone    = sessionStorage.getItem('pocketlink_verified_phone');

  const [period, setPeriod] = useState('monthly');    // monthly first; yearly = 12× (one payment)
  const [open,   setOpen]   = useState({});            // which plan's feature dropdown is open
  const [faq,    setFaq]    = useState(null);          // which FAQ is open

  const togglePlan = (k) => setOpen(o => ({ ...o, [k]: !o[k] }));

  function choosePlan(planKey) {
    if (planKey === 'free') {
      if (!phone) { navigate('/start'); return; }
      sessionStorage.setItem('pocketlink_plan', 'free');
      navigate('/onboarding');
      return;
    }
    if (phone) {
      navigate(`/checkout/${planKey}?period=${period}`);
    } else {
      sessionStorage.setItem('pocketlink_upgrade_plan', planKey);
      navigate(`/start?plan=${planKey}&upgrade=1`);
    }
  }

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
            <Sparkles size={12} /> Launch pricing — lock in these rates
          </span>
          <h1 className="text-3xl sm:text-5xl font-extrabold text-white mb-3 tracking-tight">
            Pick the plan that{' '}
            <span className="bg-gradient-to-r from-emerald-300 to-teal-300 bg-clip-text text-transparent">grows with you</span>
          </h1>
          <p className="text-white/55 text-sm sm:text-base max-w-md mx-auto">
            Start free. Upgrade only when you’re ready. No contracts, no per-order fees — ever.
          </p>
        </div>

        {/* Billing toggle */}
        <div className="flex justify-center mb-12">
          <div className="inline-flex bg-white/5 border border-white/10 rounded-2xl p-1 gap-1">
            {PERIODS.map((p) => (
              <button key={p.key} onClick={() => setPeriod(p.key)}
                className={[
                  'relative px-4 sm:px-5 py-2 rounded-xl text-sm font-semibold transition-all duration-150',
                  period === p.key ? 'bg-white text-gray-900 shadow-sm' : 'text-white/55 hover:text-white',
                ].join(' ')}>
                {p.label}
                {p.badge && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-emerald-500 text-white
                                   text-[9px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap shadow-sm">
                    {p.badge}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Plan cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 items-start">
          {PLANS.map((plan) => {
            const p        = plan.key === 'free' ? null : PRICING[plan.key][period];
            const perDay   = p ? Math.round(p.rate / 30) : null;
            const isOpen   = !!open[plan.key];
            const popular  = plan.popular;

            return (
              <div key={plan.key}
                className={[
                  'relative flex flex-col rounded-3xl p-6 transition-all duration-200',
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

                <h2 className="font-extrabold text-white text-xl">{plan.name}</h2>
                <p className="text-xs text-white/45 mt-0.5 mb-5">{plan.tagline}</p>

                {/* Price */}
                <div className="pb-5 mb-5 border-b border-white/10">
                  {plan.key === 'free' ? (
                    <>
                      <p className="text-4xl font-extrabold text-white">Free</p>
                      <p className="text-xs text-white/45 mt-1">forever · no card needed</p>
                    </>
                  ) : (
                    <>
                      <div className="flex items-baseline gap-2">
                        <p className="text-4xl font-extrabold text-white">
                          ₹{p.rate}<span className="text-base font-normal text-white/45">/mo</span>
                        </p>
                      </div>
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                              style={{ backgroundColor: `${plan.accent}22`, color: plan.accent }}>
                          ≈ ₹{perDay}/day{plan.key === 'pro' ? ' · less than a chai' : ''}
                        </span>
                      </div>
                      <p className="text-xs text-white/40 mt-2">
                        {period === 'monthly'
                          ? 'billed monthly · cancel anytime'
                          : `₹${p.charge.toLocaleString('en-IN')} billed yearly · one invoice`}
                      </p>
                    </>
                  )}
                </div>

                {/* Highlights (always visible) */}
                <ul className="space-y-2.5">
                  {plan.highlights.map((f) => (
                    <li key={f} className="flex items-start gap-2.5 text-sm text-white/80">
                      <span className="mt-0.5 flex-shrink-0 w-4 h-4 rounded-full flex items-center justify-center"
                            style={{ backgroundColor: `${plan.accent}26` }}>
                        <Check size={11} strokeWidth={3} style={{ color: plan.accent }} />
                      </span>
                      {f}
                    </li>
                  ))}
                </ul>

                {/* What's included dropdown */}
                <button onClick={() => togglePlan(plan.key)}
                  className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-emerald-300 hover:text-emerald-200 transition-colors">
                  {isOpen ? 'Hide details' : 'See everything included'}
                  <ChevronDown size={14} className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
                </button>

                <div className={`grid transition-all duration-300 ${isOpen ? 'grid-rows-[1fr] opacity-100 mt-3' : 'grid-rows-[0fr] opacity-0'}`}>
                  <div className="overflow-hidden">
                    <div className="rounded-2xl bg-black/20 border border-white/10 p-4 space-y-2.5">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-white/40 mb-1">What’s included</p>
                      {plan.features.map((f) => (
                        <div key={f} className="flex items-start gap-2.5 text-[13px] text-white/75">
                          <Check size={13} strokeWidth={3} className="mt-0.5 flex-shrink-0" style={{ color: plan.accent }} />
                          {f}
                        </div>
                      ))}
                      {plan.missing?.map((f) => (
                        <div key={f} className="flex items-start gap-2.5 text-[13px] text-white/35">
                          <X size={13} className="mt-0.5 flex-shrink-0" />
                          <span>{f}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* CTA */}
                <button onClick={() => choosePlan(plan.key)}
                  className={[
                    'mt-6 w-full py-3.5 rounded-xl text-sm font-bold transition-all active:scale-[0.98]',
                    plan.key === 'free'
                      ? 'bg-white/10 text-white hover:bg-white/15 border border-white/10'
                      : 'text-white shadow-lg',
                  ].join(' ')}
                  style={plan.key !== 'free' ? { backgroundColor: plan.accent, boxShadow: `0 10px 30px ${plan.accent}40` } : {}}>
                  {plan.cta} {plan.key !== 'free' && '→'}
                </button>
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

        {/* Every plan includes */}
        <div className="mt-12 rounded-3xl bg-white/[0.03] border border-white/10 p-7">
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
        <div className="mt-12 max-w-2xl mx-auto">
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
            Try it free — upgrade only when it’s paying for itself.
          </p>
        </div>
      </div>
    </div>
  );
}

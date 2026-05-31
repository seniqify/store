import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Check, X, Zap } from 'lucide-react';

// ── Billing periods ───────────────────────────────────────────────────────────
const PERIODS = [
  { key: 'monthly',  label: 'Monthly',  badge: null          },
  { key: 'halfyear', label: '6 Months', badge: 'Save 15%'    },
  { key: 'yearly',   label: '1 Year',   badge: 'Best Deal 🔥' },
];

// per-month display rate + total charge amount
const PRICING = {
  pro: {
    monthly:  { rate: 551,  original: 699,  charge: 551,  saving: null           },
    halfyear: { rate: 469,  original: null, charge: 2814, saving: 'Save ₹738'    },
    yearly:   { rate: 389,  original: null, charge: 4668, saving: 'Save ₹1,944'  },
  },
  business: {
    monthly:  { rate: 1000, original: null, charge: 1000, saving: null           },
    halfyear: { rate: 849,  original: null, charge: 5094, saving: 'Save ₹906'    },
    yearly:   { rate: 699,  original: null, charge: 8388, saving: 'Save ₹3,612'  },
  },
};

// ── Feature lists ─────────────────────────────────────────────────────────────
const FREE_FEATURES  = [
  '2 products · 1 category',
  'WhatsApp order messages',
  'Shareable store link',
  'GST-ready pricing',
  'UPI + Bank + COD',
];
const FREE_MISSING   = ['"Powered by PocketLink" badge'];

const PRO_FEATURES   = [
  '20 products · 5 categories',
  'No "Powered by" badge — your brand only',
  'Zero per-order cost — WhatsApp is always free',
  'No blocking risk — customers come to you',
  'Share one link on bio, status, everywhere',
  'Promo banners & store announcements',
  'Order history to track & re-engage',
  'Email support',
];

const BIZ_FEATURES   = [
  'Unlimited products & categories',
  'Everything in Pro',
  'Discount codes & coupons',
  'Product variants — size, color, more',
  'Sales analytics dashboard',
  'No message cost — ever',
  'Promote freely, zero fear of blocking',
  'Priority WhatsApp support',
];

// ── All-plan universal features ───────────────────────────────────────────────
const UNIVERSAL = [
  { icon: '🔗', text: 'Shareable store link' },
  { icon: '💬', text: 'WhatsApp orders'       },
  { icon: '📱', text: 'Mobile-first design'   },
  { icon: '⚡', text: 'Live in 2 minutes'     },
  { icon: '🆓', text: 'No app for customers'  },
  { icon: '💰', text: 'GST-ready pricing'     },
  { icon: '🏦', text: 'UPI + Bank + COD'      },
  { icon: '🔒', text: 'Secure & private'      },
];

export default function Plans() {
  const navigate = useNavigate();
  const phone    = sessionStorage.getItem('pocketlink_verified_phone');

  const [period, setPeriod] = useState('monthly');

  function choosePlan(planKey) {
    if (planKey === 'free') {
      if (!phone) { navigate('/start'); return; }
      sessionStorage.setItem('pocketlink_plan', 'free');
      navigate('/onboarding');
      return;
    }
    // Paid plans: go straight to checkout if phone is known,
    // otherwise go to /start with upgrade flag so existing users aren't blocked
    if (phone) {
      navigate(`/checkout/${planKey}?period=${period}`);
    } else {
      sessionStorage.setItem('pocketlink_upgrade_plan', planKey);
      navigate(`/start?plan=${planKey}&upgrade=1`);
    }
  }

  const pro = PRICING.pro[period];
  const biz = PRICING.business[period];

  return (
    <div className="relative min-h-screen overflow-hidden bg-white">

      {/* Decorative background */}
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-emerald-50/60 via-white to-white" />
      <div className="absolute -z-10 top-[-6rem] left-1/2 -translate-x-1/2 w-[40rem] h-96 rounded-full bg-emerald-200/30 blur-3xl animate-pl-blob" />

      {/* Nav */}
      <nav className="bg-white/70 backdrop-blur-md border-b border-gray-100 sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link to="/">
            <img src="/pocketlink-logo.svg" alt="PocketLink" className="h-8 w-auto" />
          </Link>
          {phone && (
            <span className="hidden sm:flex items-center gap-1.5 text-xs font-medium
                             bg-emerald-50 border border-emerald-100 text-emerald-700 px-3 py-1.5 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              +91 {phone.replace('91', '').replace(/(\d{5})(\d{5})/, '$1 $2')}
            </span>
          )}
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-4 py-12 sm:py-16">

        {/* Header */}
        <div className="text-center mb-10 animate-pl-fade-up">
          <p className="text-xs font-bold uppercase tracking-widest text-emerald-600 mb-2">Pricing</p>
          <h1 className="text-3xl sm:text-5xl font-extrabold text-gray-900 mb-3 tracking-tight">
            Choose your plan
          </h1>
          <p className="text-gray-500 text-sm sm:text-base max-w-md mx-auto">
            Start free. Upgrade as you grow. Cancel anytime — no contracts.
          </p>
        </div>

        {/* Billing period toggle */}
        <div className="flex justify-center mb-12">
          <div className="inline-flex bg-white border border-gray-200 rounded-2xl p-1 gap-1 shadow-sm">
            {PERIODS.map((p) => (
              <button
                key={p.key}
                onClick={() => setPeriod(p.key)}
                className={[
                  'relative px-4 sm:px-5 py-2 rounded-xl text-sm font-semibold transition-all duration-150',
                  period === p.key
                    ? 'bg-gray-900 text-white shadow-sm'
                    : 'text-gray-500 hover:text-gray-800',
                ].join(' ')}
              >
                {p.label}
                {p.badge && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-emerald-500
                                   text-white text-[9px] font-bold px-2 py-0.5 rounded-full
                                   whitespace-nowrap shadow-sm">
                    {p.badge}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Plan cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-8 items-stretch">

          {/* ── Free ── */}
          <div className="flex flex-col rounded-3xl border-2 border-gray-100 bg-white p-6 shadow-sm hover:shadow-md transition-all duration-200">
            <h2 className="font-extrabold text-gray-900 text-xl mb-0.5">Free</h2>
            <p className="text-xs text-gray-400 mb-4">Get started today</p>
            <div className="mb-5 pb-5 border-b border-gray-100">
              <p className="text-4xl font-extrabold text-gray-900">Free</p>
              <p className="text-xs text-gray-400 mt-0.5">forever · no card needed</p>
            </div>
            <ul className="space-y-2.5 flex-1 mb-5">
              {FREE_FEATURES.map(f => (
                <li key={f} className="flex items-start gap-2.5 text-sm text-gray-600">
                  <span className="mt-0.5 flex-shrink-0 w-4 h-4 rounded-full bg-gray-100 flex items-center justify-center">
                    <Check size={11} className="text-gray-500" strokeWidth={3} />
                  </span>
                  {f}
                </li>
              ))}
              {FREE_MISSING.map(f => (
                <li key={f} className="flex items-start gap-2.5 text-sm text-gray-400">
                  <span className="mt-0.5 flex-shrink-0"><X size={13} className="text-gray-300" /></span>
                  <span className="line-through">{f}</span>
                </li>
              ))}
            </ul>
            <button
              onClick={() => choosePlan('free')}
              className="mt-auto w-full py-3 rounded-xl text-sm font-bold
                         bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors active:scale-[0.98]"
            >
              Start Free
            </button>
          </div>

          {/* ── Pro ── */}
          <div className="relative flex flex-col rounded-3xl border-2 border-teal-500
                          bg-white p-6 shadow-2xl shadow-teal-500/15 sm:-translate-y-2">
            {/* Badge */}
            <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
              <span className="inline-flex items-center gap-1 bg-teal-500 text-white
                               text-[10px] font-bold px-3 py-1 rounded-full uppercase
                               tracking-wider shadow-sm">
                <Zap size={9} fill="white" />
                Best Value
              </span>
            </div>

            <h2 className="font-extrabold text-gray-900 text-xl mb-0.5">Pro</h2>
            <p className="text-xs text-gray-400 mb-4">For growing businesses</p>

            <div className="mb-5 pb-5 border-b border-gray-100">
              <div className="flex items-baseline gap-2">
                <p className="text-4xl font-extrabold text-gray-900">
                  ₹{pro.rate}
                  <span className="text-base font-normal text-gray-400">/mo</span>
                </p>
                {pro.original && (
                  <span className="text-sm text-gray-400 line-through">₹{pro.original}</span>
                )}
              </div>
              {period === 'monthly' && pro.original && (
                <span className="inline-block mt-1 text-[11px] bg-teal-50 text-teal-700
                                 font-semibold px-2 py-0.5 rounded-full">
                  21% off
                </span>
              )}
              <p className="text-xs text-gray-400 mt-1">
                {period === 'monthly'
                  ? 'billed monthly · cancel anytime'
                  : `₹${pro.charge.toLocaleString('en-IN')} billed ${period === 'halfyear' ? 'every 6 months' : 'yearly'} · ${pro.saving}`}
              </p>
            </div>

            <ul className="space-y-2.5 flex-1 mb-5">
              {PRO_FEATURES.map(f => (
                <li key={f} className="flex items-start gap-2.5 text-sm text-gray-600">
                  <span className="mt-0.5 flex-shrink-0 w-4 h-4 rounded-full bg-teal-50 flex items-center justify-center">
                    <Check size={11} className="text-teal-600" strokeWidth={3} />
                  </span>
                  {f}
                </li>
              ))}
            </ul>

            <button
              onClick={() => choosePlan('pro')}
              className="mt-auto w-full py-3 rounded-xl text-sm font-bold
                         text-white bg-teal-500 hover:bg-teal-600 transition-colors
                         active:scale-[0.98] shadow-lg shadow-teal-500/25"
            >
              Get Pro
            </button>
          </div>

          {/* ── Business ── */}
          <div className="flex flex-col rounded-3xl border-2 border-indigo-200 bg-white p-6
                          shadow-sm hover:shadow-lg transition-all duration-200">
            <h2 className="font-extrabold text-gray-900 text-xl mb-0.5">Business</h2>
            <p className="text-xs text-gray-400 mb-4">Unlimited, no restrictions</p>

            <div className="mb-5 pb-5 border-b border-gray-100">
              <p className="text-4xl font-extrabold text-gray-900">
                ₹{biz.rate}
                <span className="text-base font-normal text-gray-400">/mo</span>
              </p>
              <p className="text-xs text-gray-400 mt-1">
                {period === 'monthly'
                  ? 'billed monthly · cancel anytime'
                  : `₹${biz.charge.toLocaleString('en-IN')} billed ${period === 'halfyear' ? 'every 6 months' : 'yearly'} · ${biz.saving}`}
              </p>
            </div>

            <ul className="space-y-2.5 flex-1 mb-5">
              {BIZ_FEATURES.map(f => (
                <li key={f} className="flex items-start gap-2.5 text-sm text-gray-600">
                  <span className="mt-0.5 flex-shrink-0 w-4 h-4 rounded-full bg-indigo-50 flex items-center justify-center">
                    <Check size={11} className="text-indigo-600" strokeWidth={3} />
                  </span>
                  {f}
                </li>
              ))}
            </ul>

            <button
              onClick={() => choosePlan('business')}
              className="mt-auto w-full py-3 rounded-xl text-sm font-bold
                         text-white bg-indigo-500 hover:bg-indigo-600 transition-colors
                         active:scale-[0.98] shadow-lg shadow-indigo-500/25"
            >
              Get Business
            </button>
          </div>
        </div>

        <p className="text-center text-xs text-gray-400 mb-12">
          All prices exclusive of GST · Paid plans activated within 2–4 hours of payment · Free plan stays active until then
        </p>

        {/* Universal features */}
        <div className="bg-gradient-to-b from-gray-50 to-white rounded-3xl border border-gray-100 p-7 shadow-sm">
          <h3 className="font-bold text-gray-900 text-sm mb-6 text-center">
            Every plan includes
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-5">
            {UNIVERSAL.map(({ icon, text }) => (
              <div key={text} className="flex items-center gap-2.5 text-xs text-gray-600">
                <span className="w-8 h-8 rounded-xl bg-white shadow-sm border border-gray-100 flex items-center justify-center text-base leading-none flex-shrink-0">{icon}</span>
                <span className="font-medium">{text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

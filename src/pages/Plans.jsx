import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Check, ChevronDown, ShieldCheck, Sparkles, Star, ArrowRight, Zap,
  Store, ShoppingBag, Truck, MessageCircle, Megaphone, TrendingUp, Coins,
} from 'lucide-react';
import { PRICE } from '../utils/planLimits';
import {
  FEATURE_GROUPS, CARD_FEATURES, COIN_PRICES, COIN_PACKS, PRICING_FAQS,
  YEARLY_SAVING, YEARLY_PER_MONTH, FREE_ORDER_MESSAGES,
} from '../utils/pricingCopy';

// ── Billing periods ───────────────────────────────────────────────────────────
const PERIODS = [
  { key: 'monthly', label: 'Monthly' },
  { key: 'yearly',  label: 'Yearly'  },
];

// Front-end price DISPLAY only (PRICE in planLimits.js). The amount actually
// debited comes from the Razorpay plan_id in
// supabase/functions/create-razorpay-subscription; the two MUST match, or a
// customer sees one price and is charged another. The internal key stays
// 'premium' for grandfathering.
const PLAN_KEY = 'premium';
const ACCENT = '#10b981';

// Optional marketplace add-on (not self-serve yet: activation goes through
// support on WhatsApp; the founder enables it manually).
const FEATURED_PRICE = 299;
const SUPPORT_WA = '918482840808';

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

const GROUP_ICON = {
  shop: Store, orders: ShoppingBag, delivery: Truck, whatsapp: MessageCircle,
  grow: Megaphone, numbers: TrendingUp, always: ShieldCheck,
};

const inr = (n) => `₹${Number(n).toLocaleString('en-IN')}`;

export default function Plans() {
  const navigate = useNavigate();
  const phone    = sessionStorage.getItem('pocketlink_verified_phone');

  const [period, setPeriod] = useState('monthly');
  const [faq,    setFaq]    = useState(null);

  function choosePlan() {
    if (phone) {
      navigate(`/checkout/${PLAN_KEY}?period=${period}`);
    } else {
      sessionStorage.setItem('pocketlink_upgrade_plan', PLAN_KEY);
      navigate(`/start?plan=${PLAN_KEY}&upgrade=1`);
    }
  }

  function getFeatured() {
    const msg = encodeURIComponent('Hi PocketLink — I’d like to add the Featured Store boost (₹299/mo) to my shop.');
    window.open(`https://wa.me/${SUPPORT_WA}?text=${msg}`, '_blank', 'noopener');
  }

  const yearly   = period === 'yearly';
  const effMonth = yearly ? YEARLY_PER_MONTH : PRICE.monthly;
  const perDay   = Math.max(1, Math.round(effMonth / 30));

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
            One plan,{' '}
            <span className="bg-gradient-to-r from-emerald-300 to-teal-300 bg-clip-text text-transparent">everything included</span>
          </h1>
          <p className="text-white/55 text-sm sm:text-base max-w-xl mx-auto">
            Your shop, payments, delivery and WhatsApp in one place. No setup fee, no per-order fees, 0% commission.
          </p>
        </div>

        {/* Billing toggle */}
        <div className="flex justify-center mb-11">
          <div className="inline-flex items-center bg-white/5 border border-white/10 rounded-2xl p-1 gap-1">
            {PERIODS.map((p) => (
              <button key={p.key} type="button" onClick={() => setPeriod(p.key)}
                className={[
                  'relative px-5 py-2 rounded-xl text-sm font-semibold transition-all duration-150',
                  period === p.key ? 'bg-white text-gray-900 shadow-sm' : 'text-white/55 hover:text-white',
                ].join(' ')}>
                {p.label}
                {p.key === 'yearly' && (
                  <span className={`ml-2 text-[10px] font-bold ${yearly ? 'text-emerald-600' : 'text-emerald-300'}`}>
                    2 months free
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* The plan */}
        <div className="max-w-md mx-auto">
          <div className="relative flex flex-col rounded-3xl p-6 sm:p-7 bg-white/[0.09] border-2 shadow-2xl"
               style={{ borderColor: ACCENT, boxShadow: `0 24px 60px ${ACCENT}26` }}>
            <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
              <span className="inline-flex items-center gap-1 text-white text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-wider shadow-lg"
                    style={{ backgroundColor: ACCENT }}>
                <Zap size={9} fill="white" /> Everything included
              </span>
            </div>

            <h2 className="font-extrabold text-lg" style={{ color: ACCENT }}>PocketLink</h2>
            <p className="text-xs text-white/45 mt-0.5 mb-5">One simple plan for your whole business</p>

            <div className="pb-5 mb-5 border-b border-white/10">
              <div className="flex items-baseline gap-2">
                <p className="text-4xl font-extrabold text-white">
                  {inr(effMonth)}<span className="text-base font-normal text-white/45">/mo</span>
                </p>
                {yearly && <span className="text-lg font-semibold text-white/35 line-through">{inr(PRICE.monthly)}</span>}
              </div>
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: `${ACCENT}22`, color: ACCENT }}>
                  ≈ {inr(perDay)}/day
                </span>
                {yearly && <span className="text-[11px] font-bold text-emerald-300">save {inr(YEARLY_SAVING)} a year</span>}
              </div>
              <p className="text-xs text-white/40 mt-2">
                {yearly ? `${inr(PRICE.yearly)} billed yearly · incl. GST` : 'billed monthly · incl. GST · cancel anytime'}
              </p>
            </div>

            <button type="button" onClick={choosePlan}
              className="w-full py-3.5 rounded-xl text-sm font-bold text-white shadow-lg transition-all
                         active:scale-[0.98] inline-flex items-center justify-center gap-1.5"
              style={{ backgroundColor: ACCENT, boxShadow: `0 10px 30px ${ACCENT}40` }}>
              Subscribe now <ArrowRight size={15} />
            </button>

            {/* Included every month */}
            <div className="mt-5 rounded-2xl bg-amber-300/10 border border-amber-300/25 px-4 py-3 flex items-start gap-3">
              <Coins size={20} className="text-amber-300 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-[13px] font-bold text-white">Every month: {FREE_ORDER_MESSAGES} free WhatsApp order confirmations</p>
                <p className="text-[11.5px] text-white/55 mt-0.5">Worth {FREE_ORDER_MESSAGES} Coins. Resets on the 1st.</p>
              </div>
            </div>

            <ul className="mt-5 space-y-2.5">
              {/* The free order confirmations already have their own box above. */}
              {CARD_FEATURES.filter((f) => !f.startsWith(`${FREE_ORDER_MESSAGES} free`)).map((f) => (
                <li key={f} className="flex items-start gap-2.5 text-[13px] text-white/80">
                  <span className="mt-0.5 flex-shrink-0 w-4 h-4 rounded-full flex items-center justify-center" style={{ backgroundColor: `${ACCENT}26` }}>
                    <Check size={11} strokeWidth={3} style={{ color: ACCENT }} />
                  </span>
                  {f}
                </li>
              ))}
            </ul>
            <a href="#included" className="mt-4 text-center text-[12.5px] font-bold text-emerald-300 hover:text-emerald-200">
              See everything that’s included ↓
            </a>
          </div>
        </div>

        {/* Guarantee strip */}
        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 rounded-2xl
                        bg-white/[0.04] border border-white/10 px-5 py-3.5 max-w-3xl mx-auto">
          {GUARANTEES.map(([e, t]) => (
            <span key={t} className="inline-flex items-center gap-1.5 text-xs font-medium text-white/70">
              <span>{e}</span> {t}
            </span>
          ))}
        </div>
        <p className="text-center text-[11px] text-white/35 mt-3">
          Prices include GST · Your plan starts the moment payment succeeds · Cancel anytime
        </p>

        {/* ── Everything included, explained ── */}
        <div id="included" className="mt-16 scroll-mt-20">
          <div className="text-center mb-8">
            <h3 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">Everything that’s included</h3>
            <p className="text-sm text-white/50 mt-1">No add-ons to unlock. Every shop gets all of it.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {FEATURE_GROUPS.map((g) => {
              const Icon = GROUP_ICON[g.key] || Check;
              return (
                <div key={g.key} className="rounded-2xl bg-white/[0.04] border border-white/10 p-5">
                  <div className="flex items-center gap-2.5 mb-3">
                    <span className="w-9 h-9 rounded-xl bg-emerald-400/10 border border-emerald-400/25 text-emerald-300 grid place-items-center">
                      <Icon size={18} />
                    </span>
                    <h4 className="font-extrabold text-white text-[15px]">{g.title}</h4>
                  </div>
                  <ul className="space-y-2">
                    {g.points.map((p) => (
                      <li key={p} className="flex items-start gap-2 text-[13px] text-white/70 leading-snug">
                        <Check size={13} strokeWidth={3} className="text-emerald-400 flex-shrink-0 mt-0.5" />
                        {p}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── WhatsApp Coins ── */}
        <div className="mt-16">
          <div className="text-center mb-6">
            <h3 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight inline-flex items-center gap-2">
              <Coins size={26} className="text-amber-300" /> WhatsApp Coins
            </h3>
            <p className="text-sm text-white/50 mt-1">
              The messages PocketLink sends for you. <span className="font-bold text-amber-200">1 Coin = ₹0.50</span>
            </p>
          </div>
          <div className="max-w-3xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-2xl bg-white/[0.04] border border-white/10 p-5">
              <p className="text-[11px] font-bold uppercase tracking-wider text-white/40 mb-3">Included every month</p>
              <p className="text-[15px] font-extrabold text-white">{FREE_ORDER_MESSAGES} free order confirmations</p>
              <p className="text-[12.5px] text-white/55 mt-1 leading-relaxed">
                Cash-on-delivery buyers get a “Confirm my order” button; online buyers get “Payment received” with Track order.
                It cuts fake and refused orders.
              </p>
              <p className="text-[11px] font-bold uppercase tracking-wider text-white/40 mt-5 mb-2">Then, in Coins</p>
              <ul className="space-y-2">
                {COIN_PRICES.map((c) => (
                  <li key={c.what} className="flex items-start justify-between gap-3 text-[13px]">
                    <span className="text-white/70">{c.what}</span>
                    <span className="font-extrabold text-amber-200 whitespace-nowrap">{c.coins} {c.coins === 1 ? 'Coin' : 'Coins'}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl bg-white/[0.04] border border-white/10 p-5">
              <p className="text-[11px] font-bold uppercase tracking-wider text-white/40 mb-3">Add Coins anytime</p>
              <div className="space-y-2">
                {COIN_PACKS.map((p) => (
                  <div key={p.price} className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.05] border border-white/10 px-3.5 py-2.5">
                    <div>
                      <p className="text-[14px] font-extrabold text-white">{p.total.toLocaleString('en-IN')} Coins</p>
                      {p.bonus > 0 && <p className="text-[11px] font-bold text-amber-300">incl. {p.bonus.toLocaleString('en-IN')} bonus</p>}
                    </div>
                    <p className="text-[14px] font-extrabold text-white">{p.price}</p>
                  </div>
                ))}
              </div>
              <p className="text-[11.5px] text-white/45 mt-3 leading-relaxed">
                Coins never expire. A message that can’t be sent gives its Coins back. Shipping updates, cart reminders and offers each have their own on/off switch.
              </p>
            </div>
          </div>
        </div>

        {/* ── Marketplace Promotion (add-on) ── */}
        <div className="mt-16">
          <div className="text-center mb-6">
            <h3 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight">Marketplace Promotion</h3>
            <p className="text-sm text-white/50 mt-1">An optional add-on on top of your plan</p>
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
                  <button type="button" onClick={getFeatured}
                    className="inline-flex items-center gap-1.5 bg-white text-gray-900 font-bold text-sm px-5 py-3 rounded-xl
                               hover:bg-amber-50 transition-colors active:scale-[0.98] whitespace-nowrap">
                    Feature My Store <ArrowRight size={15} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* FAQ */}
        <div className="mt-16 max-w-2xl mx-auto">
          <h3 className="text-center text-xl font-extrabold text-white mb-6">Questions, answered</h3>
          <div className="space-y-2.5">
            {PRICING_FAQS.map((item, i) => {
              const isOpen = faq === i;
              return (
                <div key={item.q} className="rounded-2xl bg-white/[0.04] border border-white/10 overflow-hidden">
                  <button type="button" onClick={() => setFaq(isOpen ? null : i)} aria-expanded={isOpen}
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

        {/* Closing */}
        <div className="mt-12 flex flex-col items-center gap-4 text-center">
          <button type="button" onClick={choosePlan}
            className="inline-flex items-center gap-1.5 px-6 py-3.5 rounded-xl text-sm font-bold text-white shadow-lg active:scale-[0.98]"
            style={{ backgroundColor: ACCENT, boxShadow: `0 10px 30px ${ACCENT}40` }}>
            Start with PocketLink · {inr(PRICE.monthly)}/mo <ArrowRight size={15} />
          </button>
          <p className="inline-flex items-center gap-2 text-sm font-semibold text-white/80">
            <ShieldCheck size={16} className="text-emerald-400" />
            No contracts, no lock-in. Cancel anytime and your page stays live.
          </p>
        </div>
      </div>
    </div>
  );
}

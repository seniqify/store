import { Link } from 'react-router-dom';
import { ArrowRight, MessageCircle } from 'lucide-react';
import { listBusinesses } from '../utils/BusinessLoader';

/**
 * Landing — platform homepage at /
 *
 * Intentionally has NO BusinessProvider / useBusinessConfig() —
 * this page is the shell around all stores, not a store itself.
 * All colors here are hardcoded (no CSS custom property dependency).
 */

const HOW_IT_WORKS = [
  {
    icon: '📝',
    step: '01',
    title: 'Fill in your details',
    desc: 'Business name, WhatsApp number, products, and pricing. Takes about 2 minutes.',
  },
  {
    icon: '🔗',
    step: '02',
    title: 'Get your store link',
    desc: 'Your shareable URL goes live instantly — share it on WhatsApp, Instagram, or anywhere.',
  },
  {
    icon: '📱',
    step: '03',
    title: 'Customers order via WhatsApp',
    desc: 'They browse, pick products, and tap "Send Order". A structured message lands in your WhatsApp.',
  },
];

const PLATFORM_FEATURES = [
  { icon: '⚡', label: 'Instant setup',    sub: 'No coding, no designers needed' },
  { icon: '📱', label: 'Mobile-first',     sub: 'Works perfectly on any phone' },
  { icon: '🆓', label: '100% free',        sub: 'No monthly fees, ever' },
  { icon: '🇮🇳', label: 'Built for India', sub: 'GST-native, WhatsApp-native' },
];

export default function Landing() {
  // Show up to 3 demo stores (static configs only for the landing page)
  const demoStores = listBusinesses().slice(0, 3);

  return (
    <div className="min-h-screen bg-white">

      {/* ── Navigation ───────────────────────────────────────────────────── */}
      <nav className="border-b border-gray-100 bg-white/90 backdrop-blur-sm
                      sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/ordify-logo.png" alt="Ordify" className="h-28 w-auto" />
            </div>
          <Link
            to="/onboarding"
            className="inline-flex items-center gap-1.5 bg-[#25D366] hover:bg-[#1ebe5d]
                       text-white text-sm font-bold px-4 py-2 rounded-xl
                       transition-colors shadow-sm"
          >
            <MessageCircle size={14} />
            Create Free Store
          </Link>
        </div>
      </nav>

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="px-4 py-16 sm:py-24 text-center
                          bg-gradient-to-b from-gray-50 to-white">
        <div className="max-w-2xl mx-auto">

          {/* Pill badge */}
          <div className="inline-flex items-center gap-2 bg-green-50 border border-green-100
                          text-green-700 text-xs font-semibold px-3 py-1.5 rounded-full mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            Free for every business · No credit card needed
          </div>

          <h1 className="text-3xl sm:text-5xl font-extrabold text-gray-900
                         leading-tight tracking-tight mb-4">
            Launch your WhatsApp store<br />
            <span className="text-[#25D366]">in 2 minutes</span>
          </h1>

          <p className="text-gray-500 text-base sm:text-lg max-w-xl mx-auto mb-8 leading-relaxed">
            A structured product page for your business. Customers browse, select,
            and place orders — the message lands directly in your WhatsApp.
            No app. No payment gateway. No Shopify.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              to="/onboarding"
              className="inline-flex items-center gap-2 bg-[#25D366] hover:bg-[#1ebe5d]
                         text-white font-bold text-base px-8 py-3.5 rounded-2xl
                         shadow-lg shadow-green-500/20 hover:shadow-xl
                         transition-all duration-200 active:scale-[0.98] w-full sm:w-auto
                         justify-center"
            >
              Create My Free Store
              <ArrowRight size={17} />
            </Link>
            <a
              href="#demos"
              className="text-sm font-semibold text-gray-500 hover:text-gray-800
                         transition-colors"
            >
              See live demos →
            </a>
          </div>
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────────────────── */}
      <section className="px-4 py-16 bg-white">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-900 mb-2">
              How it works
            </h2>
            <p className="text-sm text-gray-400">Three steps and your store is live.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
            {HOW_IT_WORKS.map(({ icon, step, title, desc }) => (
              <div key={step} className="text-center">
                <div className="relative inline-block mb-4">
                  <div className="w-14 h-14 bg-gray-50 border border-gray-100 rounded-2xl
                                  flex items-center justify-center text-2xl shadow-sm">
                    {icon}
                  </div>
                  <span className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-gray-900 text-white
                                   text-[10px] font-bold rounded-full flex items-center
                                   justify-center leading-none">
                    {step}
                  </span>
                </div>
                <h3 className="font-bold text-gray-900 mb-1.5 text-[15px]">{title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Platform features strip ───────────────────────────────────────── */}
      <section className="px-4 py-8 bg-gray-50 border-y border-gray-100">
        <div className="max-w-4xl mx-auto">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
            {PLATFORM_FEATURES.map(({ icon, label, sub }) => (
              <div key={label} className="flex items-start gap-3">
                <span className="text-2xl leading-none mt-0.5 flex-shrink-0">{icon}</span>
                <div>
                  <p className="font-semibold text-gray-900 text-sm leading-tight">{label}</p>
                  <p className="text-xs text-gray-400 mt-0.5 leading-snug">{sub}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Live demo stores ─────────────────────────────────────────────── */}
      <section id="demos" className="px-4 py-16">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-10">
            <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-900 mb-2">
              Live demo stores
            </h2>
            <p className="text-sm text-gray-400">
              Click any store to see a real storefront — browse products, try the cart.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {demoStores.map(biz => (
              <Link
                key={biz.slug}
                to={`/demo/${biz.slug}`}
                className="bg-white border border-gray-200 hover:border-gray-300
                           hover:shadow-md rounded-2xl p-5 transition-all duration-150
                           group block"
              >
                <div className="flex items-center gap-3 mb-3">
                  <div
                    className="w-11 h-11 rounded-xl flex items-center justify-center
                               text-xl shadow-sm flex-shrink-0"
                    style={{ backgroundColor: `${biz.theme.primary}18` }}
                  >
                    {biz.logoEmoji}
                  </div>
                  <div className="min-w-0">
                    <p className="font-bold text-gray-900 text-sm leading-tight truncate">
                      {biz.businessName}
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5 truncate leading-tight">
                      {biz.tagline}
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full"
                         style={{ backgroundColor: biz.theme.primary }} />
                    <span className="text-xs text-gray-400">
                      {biz.products.length} products
                    </span>
                  </div>
                  <span className="text-xs font-semibold group-hover:underline underline-offset-2"
                        style={{ color: biz.theme.primary }}>
                    View demo →
                  </span>
                </div>
              </Link>
            ))}
          </div>

          <p className="text-center text-xs text-gray-400 mt-4">
            Click any demo to browse a live store ↑
          </p>
        </div>
      </section>

      {/* ── Bottom CTA ───────────────────────────────────────────────────── */}
      <section className="px-4 py-16 bg-gradient-to-b from-white to-gray-50 text-center">
        <div className="max-w-xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-900 mb-3">
            Ready to launch your store?
          </h2>
          <p className="text-gray-500 text-sm mb-8 leading-relaxed">
            Free forever. No credit card. No setup fee.<br />
            Just a working WhatsApp order page for your business.
          </p>
          <Link
            to="/onboarding"
            className="inline-flex items-center gap-2 bg-[#25D366] hover:bg-[#1ebe5d]
                       text-white font-bold text-base px-8 py-3.5 rounded-2xl
                       shadow-lg shadow-green-500/20 transition-all duration-200
                       active:scale-[0.98]"
          >
            Create My Free Store
            <ArrowRight size={17} />
          </Link>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer className="border-t border-gray-100 px-4 py-6 text-center space-y-2">
        <p className="text-xs text-gray-400">
          Made for Indian businesses 🇮🇳 ·{' '}
          <span className="font-medium">WhatsApp-native commerce infrastructure</span>
        </p>
        <p className="text-xs text-gray-400">
          <Link to="/terms"   className="hover:text-gray-700 transition-colors">Terms of Service</Link>
          <span className="mx-2">·</span>
          <Link to="/privacy" className="hover:text-gray-700 transition-colors">Privacy Policy</Link>
          <span className="mx-2">·</span>
          <a href="mailto:hello@ordify.store" className="hover:text-gray-700 transition-colors">Contact</a>
        </p>
      </footer>
    </div>
  );
}

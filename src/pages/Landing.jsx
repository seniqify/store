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
    title: 'Set up your shop',
    desc: 'Add your business name, products, and pricing. No tech skills needed — done in under 2 minutes.',
  },
  {
    icon: '🔗',
    step: '02',
    title: 'Share your store link',
    desc: 'Your store goes live instantly. Share the link on WhatsApp, Instagram, or anywhere your customers are.',
  },
  {
    icon: '💬',
    step: '03',
    title: 'Receive orders on WhatsApp',
    desc: 'Customers browse, pick products, and tap "Send Order". A structured message lands straight in your WhatsApp — no app, no gateway.',
  },
];

const PLATFORM_FEATURES = [
  { icon: '⚡', label: 'Instant setup',      sub: 'No coding, no designers needed' },
  { icon: '📱', label: 'Mobile-first',       sub: 'Works perfectly on any phone' },
  { icon: '🆓', label: '100% free to start', sub: 'Launch today, upgrade when you grow' },
  { icon: '🌍', label: 'Built for everyone', sub: 'Any shop, any size, anywhere' },
];

export default function Landing() {
  // Show up to 3 demo stores (static configs only for the landing page)
  const demoStores = listBusinesses().slice(0, 3);

  return (
    <div className="min-h-screen bg-white">

      {/* â"€â"€ Navigation â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€ */}
      <nav className="border-b border-gray-100 bg-white/90 backdrop-blur-sm
                      sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/pocketlink-logo.svg" alt="PocketLink" className="h-80 w-auto" />
            </div>
          <Link
            to="/start"
            className="inline-flex items-center gap-1.5 bg-[#25D366] hover:bg-[#1ebe5d]
                       text-white text-sm font-bold px-4 py-2 rounded-xl
                       transition-colors shadow-sm"
          >
            <MessageCircle size={14} />
            Create Free Store
          </Link>
        </div>
      </nav>

      {/* â"€â"€ Hero â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€ */}
      <section className="px-4 py-16 sm:py-24 text-center
                          bg-gradient-to-b from-gray-50 to-white">
        <div className="max-w-2xl mx-auto">

          {/* Pill badge */}
          <div className="inline-flex items-center gap-2 bg-green-50 border border-green-100
                          text-green-700 text-xs font-semibold px-3 py-1.5 rounded-full mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            Free · No tech skills needed · Live in minutes
          </div>

          <h1 className="text-3xl sm:text-5xl font-extrabold text-gray-900
                         leading-tight tracking-tight mb-4">
            Your shop,<br />
            <span className="text-[#25D366]">online in minutes</span>
          </h1>

          <p className="text-gray-500 text-base sm:text-lg max-w-xl mx-auto mb-8 leading-relaxed">
            PocketLink gives any small business a beautiful online store — shareable in one link,
            orders straight to your WhatsApp. No app. No code. No monthly fees to get started.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              to="/start"
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

      {/* â"€â"€ How it works â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€ */}
      <section className="px-4 py-16 bg-white">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-900 mb-2">
              How it works
            </h2>
            <p className="text-sm text-gray-400">Three steps. Your shop is online. Forever free to start.</p>
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

      {/* â"€â"€ Platform features strip â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€ */}
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

      {/* â"€â"€ Live demo stores â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€ */}
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
            Click any demo to browse a live store →
          </p>
        </div>
      </section>

      {/* ── Pricing ── */}
      <section id="pricing" className="px-4 py-16 bg-white">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-900 mb-2">
              Simple, honest pricing
            </h2>
            <p className="text-sm text-gray-400">
              Start free. No credit card. Upgrade when you outgrow the free tier.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-6">
            {[
              {
                name: 'Free', price: 0, popular: false, color: '#374151',
                to: '/start', cta: 'Start Free',
                features: ['3 products', '2 categories', 'WhatsApp orders', 'Shareable link', 'GST pricing'],
                caveat: '"Powered by PocketLink" badge',
              },
              {
                name: 'Starter', price: 299, popular: true, color: '#0d9488',
                to: '/start?plan=starter', cta: 'Get Starter',
                features: ['10 products', '5 categories', 'No badge', 'Promo banners', 'Order history', 'Email support'],
                caveat: null,
              },
              {
                name: 'Growth', price: 699, popular: false, color: '#6366f1',
                to: '/start?plan=growth', cta: 'Get Growth',
                features: ['50 products', '15 categories', 'No badge', 'Discount codes', 'Analytics', 'Product variants', 'Priority support'],
                caveat: null,
              },
            ].map((plan) => (
              <div
                key={plan.name}
                className={[
                  'relative rounded-2xl border-2 p-6 flex flex-col bg-white',
                  plan.popular ? 'border-teal-500 shadow-xl shadow-teal-500/10' : 'border-gray-100 shadow-sm',
                ].join(' ')}
              >
                {plan.popular && (
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                    <span className="bg-teal-500 text-white text-[10px] font-bold px-3 py-1
                                     rounded-full uppercase tracking-wider shadow-sm">
                      Most Popular
                    </span>
                  </div>
                )}
                <h3 className="font-extrabold text-gray-900 text-lg mb-1">{plan.name}</h3>
                <p className="text-2xl font-extrabold text-gray-900 mb-1">
                  {plan.price === 0 ? 'Free' : `₹${plan.price}`}
                  {plan.price > 0 && <span className="text-sm font-normal text-gray-400">/mo</span>}
                </p>
                <p className="text-xs text-gray-400 mb-4 pb-4 border-b border-gray-100">
                  {plan.price === 0 ? 'forever · no card needed' : '+ GST · billed monthly'}
                </p>
                <ul className="space-y-2 flex-1 mb-4">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-center gap-2 text-sm text-gray-600">
                      <span className="text-teal-500 font-bold text-xs">✓</span> {f}
                    </li>
                  ))}
                  {plan.caveat && (
                    <li className="flex items-center gap-2 text-sm text-gray-400">
                      <span className="text-gray-300 text-xs">✗</span>
                      <span className="line-through">{plan.caveat}</span>
                    </li>
                  )}
                </ul>
                <Link
                  to={plan.to}
                  className="block text-center py-2.5 rounded-xl text-sm font-bold
                             transition-all hover:opacity-90 active:scale-[0.98]"
                  style={{
                    backgroundColor: plan.popular ? plan.color : plan.name === 'Growth' ? plan.color : '#e5e7eb',
                    color: plan.popular || plan.name === 'Growth' ? '#fff' : '#374151',
                  }}
                >
                  {plan.cta}
                </Link>
              </div>
            ))}
          </div>
          <p className="text-center text-xs text-gray-400">
            Paid plans activated within 2–4 hours · Cancel anytime from your dashboard
          </p>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section className="px-4 py-16 bg-gray-50 border-t border-gray-100">
        <div className="max-w-2xl mx-auto">
          <div className="text-center mb-10">
            <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-900 mb-2">
              Frequently asked questions
            </h2>
          </div>
          <div className="space-y-3">
            {[
              { q: 'Is PocketLink really free?', a: 'Yes. The Free plan gives you a fully working store with up to 3 products — no credit card, no expiry. Upgrade only when you need more products or want to remove the badge.' },
              { q: 'Do my customers need to download anything?', a: 'No app needed. Your store opens in any browser. Customers place orders via WhatsApp — which they already have on their phone.' },
              { q: 'How do I receive orders?', a: 'When a customer taps "Send Order", a structured WhatsApp message lands in your inbox with their name, address, items, and total. You reply to confirm and arrange delivery.' },
              { q: 'Can I accept online payments?', a: 'PocketLink currently handles COD and in-person payment collection. Customers mention their preferred payment method in the order message. Integrated online payment links are on our roadmap.' },
              { q: 'What is the "Powered by PocketLink" badge?', a: 'Free stores show a small "Powered by PocketLink" link at the bottom of the storefront. It disappears on Starter and higher plans.' },
              { q: 'How do paid plans get activated?', a: 'Complete payment and send us a WhatsApp confirmation with your transaction ID. We activate your plan within 2–4 hours. Automated billing is on our roadmap.' },
              { q: 'Can I upgrade later?', a: 'Yes. Upgrade anytime from your store management dashboard. All your products, settings, and store link remain exactly the same.' },
              { q: 'How do I delete my store?', a: 'Go to Settings in your store management dashboard to permanently delete your store and all associated data at any time.' },
            ].map(({ q, a }) => (
              <details key={q} className="group bg-white border border-gray-100 rounded-xl shadow-sm">
                <summary className="flex items-center justify-between px-5 py-4 cursor-pointer
                                    font-semibold text-sm text-gray-900 list-none
                                    [&::-webkit-details-marker]:hidden select-none">
                  {q}
                  <span className="text-gray-400 transition-transform duration-150 group-open:rotate-45 flex-shrink-0 ml-3 text-lg leading-none">
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

      {/* ── Bottom CTA ── */}
      <section className="px-4 py-16 bg-gradient-to-b from-white to-gray-50 text-center">
        <div className="max-w-xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-900 mb-3">
            Ready to take your shop digital?
          </h2>
          <p className="text-gray-500 text-sm mb-8 leading-relaxed">
            Free forever. No credit card. No setup fee.<br />
            Give your shop a digital home and start receiving orders today.
          </p>
          <Link
            to="/start"
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

      {/* â"€â"€ Footer â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€ */}
      <footer className="border-t border-gray-100 px-4 py-6 text-center space-y-2">
        <p className="text-xs text-gray-400">
          Helping small businesses go digital 🌍 ·{' '}
          <span className="font-medium">Simple online stores, WhatsApp orders</span>
        </p>
        <p className="text-xs text-gray-400">
          <Link to="/terms"   className="hover:text-gray-700 transition-colors">Terms of Service</Link>
          <span className="mx-2">·</span>
          <Link to="/privacy" className="hover:text-gray-700 transition-colors">Privacy Policy</Link>
          <span className="mx-2">·</span>
          <a href="mailto:hello@pocketlink.store" className="hover:text-gray-700 transition-colors">Contact</a>
        </p>
      </footer>
    </div>
  );
}

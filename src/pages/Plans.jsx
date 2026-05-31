import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Check, Zap, ArrowRight } from 'lucide-react';

const PLANS = [
  {
    key: 'free',
    name: 'Free',
    price: 0,
    badge: null,
    popular: false,
    color: '#374151',
    bgColor: '#f9fafb',
    desc: 'Get started in 2 minutes',
    features: [
      '3 products',
      '2 product categories',
      'WhatsApp order messages',
      'Shareable store link',
      'GST-inclusive pricing',
      'UPI + Bank + COD options',
    ],
    missing: ['"Powered by PocketLink" badge on store'],
    cta: 'Start for Free',
  },
  {
    key: 'starter',
    name: 'Starter',
    price: 299,
    badge: 'Most Popular',
    popular: true,
    color: '#0d9488',
    bgColor: '#f0fdfa',
    desc: 'For growing businesses',
    features: [
      '10 products',
      '5 product categories',
      'No "Powered by" badge',
      'Promo banners & announcements',
      'Basic order history',
      'WhatsApp order messages',
      'Email support',
    ],
    missing: [],
    cta: 'Get Starter',
  },
  {
    key: 'growth',
    name: 'Growth',
    price: 699,
    badge: null,
    popular: false,
    color: '#6366f1',
    bgColor: '#f5f3ff',
    desc: 'For serious sellers',
    features: [
      '50 products',
      '15 product categories',
      'No "Powered by" badge',
      'Discount codes',
      'Product variants (size, color)',
      'Sales analytics dashboard',
      'Priority WhatsApp support',
    ],
    missing: [],
    cta: 'Get Growth',
  },
];

export default function Plans() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const phone = sessionStorage.getItem('pocketlink_verified_phone');
  const suggested = params.get('plan');

  function choosePlan(planKey) {
    if (!phone) {
      navigate(`/start?plan=${planKey}`);
      return;
    }
    if (planKey === 'free') {
      sessionStorage.setItem('pocketlink_plan', 'free');
      navigate('/onboarding');
    } else {
      navigate(`/checkout/${planKey}`);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">

      {/* Nav */}
      <nav className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link to="/">
            <img src="/pocketlink-logo.svg" alt="PocketLink" className="h-80 w-auto" />
          </Link>
          {phone && (
            <span className="hidden sm:flex items-center gap-1.5 text-xs font-medium
                             bg-green-50 border border-green-100 text-green-700
                             px-3 py-1 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
              +91 {phone.replace('91', '').replace(/(\d{5})(\d{5})/, '$1 $2')}
            </span>
          )}
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-4 py-12 sm:py-16">

        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-3">
            Choose your plan
          </h1>
          <p className="text-gray-500 text-sm sm:text-base max-w-md mx-auto">
            Start free, upgrade when you grow. No contracts.
            Cancel anytime from your dashboard.
          </p>
        </div>

        {/* Plan cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-8">
          {PLANS.map((plan) => (
            <div
              key={plan.key}
              className={[
                'relative flex flex-col rounded-2xl border-2 p-6 transition-shadow',
                plan.popular
                  ? 'border-teal-500 shadow-xl shadow-teal-500/10'
                  : 'border-gray-100 bg-white shadow-sm hover:shadow-md',
                plan.popular ? 'bg-white' : '',
              ].join(' ')}
            >
              {/* Popular badge */}
              {plan.badge && (
                <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                  <span className="inline-flex items-center gap-1 bg-teal-500 text-white
                                   text-[10px] font-bold px-3 py-1 rounded-full uppercase
                                   tracking-wider shadow-sm">
                    <Zap size={9} fill="white" />
                    {plan.badge}
                  </span>
                </div>
              )}

              {/* Plan name + desc */}
              <div className="mb-3">
                <h2 className="font-extrabold text-gray-900 text-xl">{plan.name}</h2>
                <p className="text-xs text-gray-400 mt-0.5">{plan.desc}</p>
              </div>

              {/* Price */}
              <div className="mb-5 pb-5 border-b border-gray-100">
                {plan.price === 0 ? (
                  <div>
                    <p className="text-4xl font-extrabold text-gray-900">Free</p>
                    <p className="text-xs text-gray-400 mt-0.5">forever</p>
                  </div>
                ) : (
                  <div>
                    <p className="text-4xl font-extrabold text-gray-900">
                      ₹{plan.price}
                      <span className="text-base font-normal text-gray-400">/mo</span>
                    </p>
                    <p className="text-xs text-gray-400 mt-0.5">+ GST · billed monthly</p>
                  </div>
                )}
              </div>

              {/* Features */}
              <ul className="space-y-2.5 mb-2 flex-1">
                {plan.features.map((feat) => (
                  <li key={feat} className="flex items-start gap-2 text-sm text-gray-600">
                    <Check size={13} className="mt-0.5 flex-shrink-0" style={{ color: plan.color }} />
                    {feat}
                  </li>
                ))}
                {plan.missing.map((feat) => (
                  <li key={feat} className="flex items-start gap-2 text-sm text-gray-400 line-through">
                    <span className="w-[13px] h-[13px] mt-0.5 flex-shrink-0 text-gray-300">✗</span>
                    {feat}
                  </li>
                ))}
              </ul>

              {/* CTA */}
              <button
                onClick={() => choosePlan(plan.key)}
                className="mt-5 w-full flex items-center justify-center gap-1.5 py-2.5
                           rounded-xl text-sm font-bold transition-all duration-150
                           hover:opacity-90 active:scale-[0.98]"
                style={{
                  backgroundColor: plan.popular ? plan.color : plan.key === 'growth' ? plan.color : '#e5e7eb',
                  color: plan.popular || plan.key === 'growth' ? '#fff' : '#374151',
                }}
              >
                {plan.cta}
                <ArrowRight size={13} />
              </button>
            </div>
          ))}
        </div>

        {/* Footer note */}
        <p className="text-center text-xs text-gray-400 leading-relaxed">
          All prices exclusive of GST &nbsp;·&nbsp;
          Paid plans activated within 2–4 hours of payment confirmation &nbsp;·&nbsp;
          Free plan remains active until then
        </p>

        {/* Feature comparison teaser */}
        <div className="mt-10 bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
          <h3 className="font-bold text-gray-900 text-sm mb-4 text-center">
            All plans include
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { icon: '🔗', label: 'Shareable store link' },
              { icon: '📱', label: 'WhatsApp orders' },
              { icon: '💰', label: 'GST-ready pricing' },
              { icon: '🏦', label: 'UPI + Bank + COD' },
              { icon: '🖼️', label: 'Product photos' },
              { icon: '⚡', label: 'Instant setup' },
              { icon: '🇮🇳', label: 'Made for India' },
              { icon: '🔒', label: 'Secure & private' },
            ].map(({ icon, label }) => (
              <div key={label} className="flex items-center gap-2 text-xs text-gray-500">
                <span className="text-base leading-none">{icon}</span>
                {label}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

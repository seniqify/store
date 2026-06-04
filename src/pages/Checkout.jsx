import { useState } from 'react';
import { Link, useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { validateCoupon } from '../utils/coupons';
import { findStoreByPhone, upgradePlan, savePendingSignup } from '../utils/storeService';

const PLAN_INFO = {
  starter: {
    name:  'Starter',
    color: '#14b8a6',
    features: ['20 products', '5 categories', 'No badge', 'Promo banners'],
  },
  pro: {
    name:  'Pro',
    color: '#10b981',
    features: ['50 products', '10 categories', 'Verified badge', 'Order history'],
  },
  business: {
    name:  'Business',
    color: '#8b5cf6',
    features: ['Unlimited products', 'Unlimited categories', 'Verified badge', 'Priority support'],
  },
};

const PERIOD_LABEL = {
  monthly: 'Monthly',
  yearly:  '1 Year',
};

// yearly = 12× monthly (one payment, no discount)
const CHARGES = {
  starter:  { monthly: 149, yearly: 1788 },
  pro:      { monthly: 249, yearly: 2988 },
  business: { monthly: 499, yearly: 5988 },
};

function loadRazorpayScript() {
  return new Promise((resolve) => {
    if (window.Razorpay) { resolve(true); return; }
    const script    = document.createElement('script');
    script.src      = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload   = () => resolve(true);
    script.onerror  = () => resolve(false);
    document.body.appendChild(script);
  });
}

export default function Checkout() {
  const { plan: planKey }  = useParams();
  const [searchParams]     = useSearchParams();
  const navigate           = useNavigate();
  const period             = searchParams.get('period') || 'monthly';
  const plan               = PLAN_INFO[planKey];

  const [paying,   setPaying]   = useState(false);
  const [payError, setPayError] = useState('');
  const [coupon,      setCoupon]      = useState('');
  const [applied,     setApplied]     = useState(null);   // coupon def once applied
  const [couponError, setCouponError] = useState('');

  const phone  = sessionStorage.getItem('pocketlink_verified_phone');
  const amount = CHARGES[planKey]?.[period];

  if (!plan || !amount) { navigate('/plans'); return null; }
  if (!phone)           { navigate('/start'); return null; }

  // How long a paid term stays active before the next auto-charge (+grace).
  // The razorpay-webhook pushes this forward on each successful renewal.
  function termExpiry(per) {
    const days = per === 'yearly' ? 368 : 33;
    return new Date(Date.now() + days * 86400000).toISOString();
  }

  async function handlePay() {
    setPaying(true);
    setPayError('');

    try {
      // 1. Load Razorpay JS
      const loaded = await loadRazorpayScript();
      if (!loaded) throw new Error('Could not load payment SDK. Check your connection.');

      // 2. Create an auto-debit subscription on the backend
      const { data: subData } = await supabase.functions.invoke('create-razorpay-subscription', {
        body: { plan: planKey, period, phone },
      });

      if (subData?.error || !subData?.subscription_id) {
        throw new Error(subData?.error ?? 'Could not start the subscription.');
      }

      // 3. Open Razorpay checkout for the mandate (amount comes from the plan)
      await new Promise((resolve, reject) => {
        const options = {
          key:             subData.key_id,
          subscription_id: subData.subscription_id,
          name:            'PocketLink',
          description:     `${plan.name} Plan · ${PERIOD_LABEL[period]} · auto-renews`,
          prefill:         { contact: phone.replace('91', '') },
          theme:           { color: plan.color },
          modal: {
            ondismiss: () => {
              setPaying(false);
              setPayError('Payment was cancelled. You can try again.');
              resolve(null);
            },
          },
          handler: async (response) => {
            try {
              // 4. Verify signature on backend (payment_id | subscription_id)
              const { data: verifyData } = await supabase.functions.invoke(
                'verify-razorpay-payment',
                {
                  body: {
                    razorpay_payment_id:      response.razorpay_payment_id,
                    razorpay_subscription_id: response.razorpay_subscription_id,
                    razorpay_signature:       response.razorpay_signature,
                  },
                },
              );

              if (verifyData?.verified) {
                const expires = termExpiry(period);
                const subId   = subData.subscription_id;
                // Existing store for this phone → upgrade it (renewal);
                // otherwise it's a new signup → carry the plan into onboarding.
                const existing = await findStoreByPhone(phone);
                if (existing) {
                  await upgradePlan(existing, planKey, expires, subId);
                  navigate(`/${existing}/manage`);
                } else {
                  // Persist the payment so it survives leaving onboarding (resume, no re-charge)
                  await savePendingSignup(phone, planKey, expires, subId);
                  sessionStorage.setItem('pocketlink_plan', planKey);
                  sessionStorage.setItem('pocketlink_plan_expires', expires);
                  sessionStorage.setItem('pocketlink_subscription_id', subId);
                  navigate('/onboarding');
                }
                resolve(true);
              } else {
                throw new Error(verifyData?.error ?? 'Payment verification failed.');
              }
            } catch (err) {
              reject(err);
            }
          },
        };

        const rzp = new window.Razorpay(options);
        rzp.on('payment.failed', (resp) => {
          reject(new Error(resp.error?.description ?? 'Payment failed. Please try again.'));
        });
        rzp.open();
      });
    } catch (err) {
      setPayError(err.message ?? 'Something went wrong. Please try again.');
      setPaying(false);
    }
  }

  function applyCoupon() {
    const def = validateCoupon(coupon);
    if (!def) { setCouponError('That code isn’t valid.'); setApplied(null); return; }
    setApplied(def);
    setCouponError('');
  }

  // Coupon path: grant the plan free with an expiry, skip payment.
  // Existing store → upgrade it (renewal); new signup → carry into onboarding.
  async function handleClaim() {
    const expires = new Date(Date.now() + applied.days * 86400000).toISOString();
    const existing = await findStoreByPhone(phone);
    if (existing) {
      await upgradePlan(existing, applied.plan, expires);
      navigate(`/${existing}/manage`);
    } else {
      await savePendingSignup(phone, applied.plan, expires, null);
      sessionStorage.setItem('pocketlink_plan', applied.plan);
      sessionStorage.setItem('pocketlink_plan_expires', expires);
      navigate('/onboarding');
    }
  }

  const billingNote = period === 'monthly'
    ? `₹${amount} billed monthly`
    : `₹${amount.toLocaleString('en-IN')} billed yearly`;

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white/80 backdrop-blur-md border-b border-gray-100 sticky top-0 z-20">
        <div className="max-w-lg mx-auto px-4 h-16 flex items-center justify-between">
          <Link to="/">
            <img src="/pocketlink-logo.svg" alt="PocketLink" className="h-8 w-auto" />
          </Link>
          <Link to="/plans" className="text-xs text-gray-400 hover:text-gray-700 transition-colors">
            ← Change plan
          </Link>
        </div>
      </nav>

      <div className="max-w-lg mx-auto px-4 py-10">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 sm:p-8">

          {/* Plan summary */}
          <div className="mb-7 pb-6 border-b border-gray-100">
            <p className="text-xs font-medium text-gray-400 mb-1">Activating plan</p>
            <div className="flex items-baseline gap-2 flex-wrap">
              <h1 className="text-2xl font-extrabold text-gray-900">{plan.name}</h1>
              <span className="text-sm font-semibold px-2 py-0.5 rounded-full text-white"
                    style={{ backgroundColor: plan.color }}>
                {PERIOD_LABEL[period]}
              </span>
            </div>
            <p className="text-sm text-gray-400 mt-1">{billingNote} + GST</p>
            <div className="flex flex-wrap gap-2 mt-3">
              {plan.features.map((f) => (
                <span key={f} className="text-[11px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                  {f}
                </span>
              ))}
            </div>
          </div>

          {/* What happens — only relevant when paying */}
          {!applied && (
            <div className="bg-gray-50 rounded-xl p-4 mb-5 space-y-3">
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">What happens</p>
              {[
                { n: '1', title: 'Pay securely',             desc: 'UPI · Cards · Net Banking · Wallets' },
                { n: '2', title: 'Plan activates instantly', desc: 'No manual confirmation needed'        },
                { n: '3', title: 'Create your page',         desc: 'Jump straight into onboarding'        },
              ].map(({ n, title, desc }) => (
                <div key={n} className="flex items-start gap-3">
                  <span className="w-5 h-5 rounded-full text-[11px] font-bold flex items-center
                                   justify-center text-white flex-shrink-0 mt-0.5"
                        style={{ backgroundColor: plan.color }}>{n}</span>
                  <div>
                    <p className="text-sm font-semibold text-gray-800 leading-tight">{title}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Coupon */}
          {applied ? (
            <div className="mb-4 flex items-center justify-between gap-3 rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-bold text-emerald-700">🎁 {applied.label}</p>
                <p className="text-[11px] text-emerald-600 mt-0.5">No payment now · reverts to Free after {applied.days} days</p>
              </div>
              <button type="button" onClick={() => { setApplied(null); setCoupon(''); }}
                className="text-xs font-semibold text-emerald-700 hover:text-emerald-900 flex-shrink-0">Remove</button>
            </div>
          ) : (
            <div className="mb-4">
              <div className="flex gap-2">
                <input value={coupon}
                  onChange={(e) => { setCoupon(e.target.value.toUpperCase()); setCouponError(''); }}
                  placeholder="Have a coupon? Enter code"
                  className="flex-1 px-3.5 py-2.5 rounded-xl border border-gray-200 bg-white text-sm font-mono tracking-wide
                             text-gray-900 placeholder:font-sans placeholder:tracking-normal placeholder-gray-400
                             focus:outline-none focus:ring-2 focus:ring-gray-300" />
                <button type="button" onClick={applyCoupon} disabled={!coupon.trim()}
                  className="px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-bold text-gray-700
                             hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                  Apply
                </button>
              </div>
              {couponError && <p className="mt-1.5 text-xs text-red-500">{couponError}</p>}
            </div>
          )}

          {/* Claim (free) or Pay */}
          {applied ? (
            <button type="button" onClick={handleClaim}
              className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl text-sm font-bold text-white
                         transition-all hover:opacity-90 active:scale-[0.98] shadow-lg"
              style={{ backgroundColor: '#16a34a', boxShadow: '0 10px 30px rgba(22,163,74,0.35)' }}>
              🎁 Claim your free month →
            </button>
          ) : (
            <button onClick={handlePay} disabled={paying}
              className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl
                         text-sm font-bold text-white transition-all hover:opacity-90
                         active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
              style={{ backgroundColor: plan.color }}>
              {paying ? (
                <>
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Opening payment…
                </>
              ) : (
                `Pay ₹${amount.toLocaleString('en-IN')} — Activate ${plan.name}`
              )}
            </button>
          )}

          {payError && (
            <p className="mt-3 text-xs text-red-500 text-center leading-relaxed">{payError}</p>
          )}

          {!applied && (
            <p className="text-center text-[11px] text-gray-400 mt-4">
              Secured by Razorpay · Auto-renews {period === 'yearly' ? 'yearly' : 'monthly'} · Cancel anytime
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

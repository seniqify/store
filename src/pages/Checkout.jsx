import { useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { load } from '@cashfreepayments/cashfree-js';
import { supabase } from '../lib/supabase';

const PLAN_INFO = {
  starter: {
    name: 'Starter',
    price: 299,
    color: '#0d9488',
    features: ['10 products', '5 categories', 'No badge', 'Order history'],
  },
  growth: {
    name: 'Growth',
    price: 699,
    color: '#6366f1',
    features: ['50 products', '15 categories', 'Discount codes', 'Analytics'],
  },
};

const STEPS = [
  { n: '1', title: 'Pay securely',         desc: 'UPI · Cards · Net Banking · Wallets' },
  { n: '2', title: 'Plan activates instantly', desc: 'No manual confirmation needed'    },
  { n: '3', title: 'Create your store',    desc: 'Jump straight into onboarding'        },
];

export default function Checkout() {
  const { plan: planKey } = useParams();
  const navigate           = useNavigate();
  const plan               = PLAN_INFO[planKey];

  const [paying,   setPaying]   = useState(false);
  const [payError, setPayError] = useState('');

  const phone = sessionStorage.getItem('pocketlink_verified_phone');

  if (!plan)  { navigate('/plans');  return null; }
  if (!phone) { navigate('/start');  return null; }

  async function handlePay() {
    setPaying(true);
    setPayError('');

    try {
      // 1. Create order on backend
      const { data: orderData, error: orderErr } = await supabase.functions.invoke(
        'create-cashfree-order',
        { body: { plan: planKey, phone } },
      );

      if (orderData?.error || !orderData?.payment_session_id) {
        throw new Error(orderData?.error ?? 'Could not start payment. Please try again.');
      }

      // 2. Open Cashfree checkout modal
      const cashfree = await load({ mode: 'sandbox' });

      const result = await cashfree.checkout({
        paymentSessionId: orderData.payment_session_id,
        redirectTarget: '_modal',
      });

      if (result.error) {
        setPayError(result.error.message ?? 'Payment was not completed. You can try again.');
        setPaying(false);
        return;
      }

      if (result.paymentDetails) {
        // 3. Verify server-side
        const { data: verifyData } = await supabase.functions.invoke(
          'verify-cashfree-payment',
          { body: { order_id: orderData.order_id } },
        );

        if (verifyData?.verified) {
          sessionStorage.setItem('pocketlink_plan', planKey);
          navigate('/onboarding');
        } else {
          setPayError('Payment verification failed. Please contact support.');
          setPaying(false);
        }
      }
    } catch (err) {
      setPayError(err.message ?? 'Something went wrong. Please try again.');
      setPaying(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">

      {/* Nav */}
      <nav className="bg-white border-b border-gray-100">
        <div className="max-w-lg mx-auto px-4 h-14 flex items-center justify-between">
          <Link to="/">
            <img src="/pocketlink-logo.svg" alt="PocketLink" className="h-80 w-auto" />
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
            <div className="flex items-baseline gap-2">
              <h1 className="text-2xl font-extrabold text-gray-900">{plan.name}</h1>
              <span className="text-gray-400 text-sm">₹{plan.price}/month + GST</span>
            </div>
            <div className="flex flex-wrap gap-2 mt-2">
              {plan.features.map((f) => (
                <span key={f} className="text-[11px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                  {f}
                </span>
              ))}
            </div>
          </div>

          {/* How it works */}
          <div className="bg-gray-50 rounded-xl p-4 mb-7 space-y-3">
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">What happens</p>
            {STEPS.map(({ n, title, desc }) => (
              <div key={n} className="flex items-start gap-3">
                <span
                  className="w-5 h-5 rounded-full text-[11px] font-bold flex items-center
                             justify-center text-white flex-shrink-0 mt-0.5"
                  style={{ backgroundColor: plan.color }}
                >
                  {n}
                </span>
                <div>
                  <p className="text-sm font-semibold text-gray-800 leading-tight">{title}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{desc}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Pay button */}
          <button
            onClick={handlePay}
            disabled={paying}
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl
                       text-sm font-bold text-white transition-all hover:opacity-90
                       active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
            style={{ backgroundColor: plan.color }}
          >
            {paying ? (
              <>
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Opening payment…
              </>
            ) : (
              `Pay ₹${plan.price} — Activate ${plan.name}`
            )}
          </button>

          {payError && (
            <p className="mt-3 text-xs text-red-500 text-center leading-relaxed">{payError}</p>
          )}

          <p className="text-center text-[11px] text-gray-400 mt-4 leading-relaxed">
            Secured by Cashfree Payments · 256-bit SSL
          </p>
        </div>
      </div>
    </div>
  );
}

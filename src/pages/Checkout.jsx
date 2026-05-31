import { useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { Copy, Check, ArrowRight } from 'lucide-react';

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

// ── Update this to your actual support WhatsApp number ──────────────────────
const SUPPORT_WA = '919999999999';
const UPI_ID     = 'pocketlink@upi';

export default function Checkout() {
  const { plan: planKey } = useParams();
  const navigate          = useNavigate();
  const plan              = PLAN_INFO[planKey];

  const [copiedUpi, setCopiedUpi] = useState(false);

  const phone = sessionStorage.getItem('pocketlink_verified_phone');

  // Guard: unknown plan or no phone → redirect
  if (!plan)  { navigate('/plans');  return null; }
  if (!phone) { navigate('/start');  return null; }

  const displayPhone = phone.replace('91', '').replace(/(\d{5})(\d{5})/, '+91 $1 $2');

  const upiDeepLink = `upi://pay?pa=${UPI_ID}&am=${plan.price}&tn=PocketLink+${plan.name}+Plan&cu=INR`;

  const waMessage = encodeURIComponent(
    `Hi PocketLink!\n\nI've paid ₹${plan.price} for the ${plan.name} plan.\n\nMy WhatsApp number: ${displayPhone}\n\nPlease activate my store. Thank you!`
  );
  const waLink = `https://wa.me/${SUPPORT_WA}?text=${waMessage}`;

  function copyUpi() {
    navigator.clipboard.writeText(UPI_ID).then(() => {
      setCopiedUpi(true);
      setTimeout(() => setCopiedUpi(false), 2000);
    });
  }

  function handleContinue() {
    sessionStorage.setItem('pocketlink_plan', planKey);
    navigate('/onboarding');
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
          <div className="mb-6 pb-5 border-b border-gray-100">
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

          {/* Step 1 — Pay via UPI */}
          <div className="space-y-3 mb-6">
            <div className="flex items-center gap-2">
              <span className="w-5 h-5 rounded-full text-xs font-bold flex items-center justify-center text-white flex-shrink-0"
                    style={{ backgroundColor: plan.color }}>1</span>
              <p className="text-sm font-bold text-gray-800">Pay via UPI</p>
            </div>

            <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-3">
              {/* UPI ID row */}
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] text-gray-400 font-medium mb-0.5">UPI ID</p>
                  <p className="font-mono text-sm font-bold text-gray-800">{UPI_ID}</p>
                </div>
                <button
                  onClick={copyUpi}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold
                             text-white flex-shrink-0 transition-all"
                  style={{ backgroundColor: copiedUpi ? '#16a34a' : plan.color }}
                >
                  {copiedUpi ? <Check size={11} /> : <Copy size={11} />}
                  {copiedUpi ? 'Copied' : 'Copy'}
                </button>
              </div>

              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">Amount</span>
                <span className="font-bold text-gray-800">₹{plan.price}</span>
              </div>

              {/* Open UPI app */}
              <a
                href={upiDeepLink}
                className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg
                           text-sm font-bold text-white transition-colors hover:opacity-90"
                style={{ backgroundColor: plan.color }}
              >
                📲 Open UPI App to Pay ₹{plan.price}
              </a>
              <p className="text-center text-[10px] text-gray-400">
                Opens PhonePe, GPay, Paytm, or any UPI app
              </p>
            </div>
          </div>

          {/* Step 2 — WhatsApp confirm */}
          <div className="space-y-2 mb-6">
            <div className="flex items-center gap-2">
              <span className="w-5 h-5 rounded-full text-xs font-bold flex items-center justify-center text-white flex-shrink-0"
                    style={{ backgroundColor: plan.color }}>2</span>
              <p className="text-sm font-bold text-gray-800">Confirm on WhatsApp</p>
            </div>
            <a
              href={waLink}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full py-3 rounded-xl
                         text-sm font-bold text-white bg-[#25D366] hover:bg-[#1ebe5d]
                         transition-colors"
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
              </svg>
              Send Payment Confirmation
            </a>
          </div>

          {/* Divider + Continue */}
          <div className="pt-4 border-t border-gray-100 space-y-3">
            <button
              onClick={handleContinue}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl
                         text-sm font-bold text-white transition-all hover:opacity-90"
              style={{ backgroundColor: plan.color }}
            >
              Continue to Create My Store
              <ArrowRight size={14} />
            </button>
            <p className="text-center text-[11px] text-gray-400 leading-relaxed">
              Your store will start on the Free plan until payment is confirmed.
              We'll upgrade it within 2–4 hours of receiving your WhatsApp message.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

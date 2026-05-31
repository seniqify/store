import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, MessageCircle } from 'lucide-react';

export default function Start() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const planParam = params.get('plan') || 'free';

  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');

  const digits = phone.replace(/\D/g, '').slice(0, 10);
  const isValid = digits.length === 10;

  function handleContinue(e) {
    e.preventDefault();
    if (!isValid) {
      setError('Please enter a valid 10-digit WhatsApp number.');
      return;
    }
    sessionStorage.setItem('pocketlink_verified_phone', `91${digits}`);
    navigate(planParam !== 'free' ? `/plans?plan=${planParam}` : '/plans');
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">

      {/* Nav */}
      <nav className="bg-white border-b border-gray-100">
        <div className="max-w-sm mx-auto px-4 h-14 flex items-center">
          <Link to="/">
            <img src="/pocketlink-logo.svg" alt="PocketLink" className="h-80 w-auto" />
          </Link>
        </div>
      </nav>

      {/* Card */}
      <div className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm space-y-4">

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-6 py-8 space-y-6">

            {/* Header */}
            <div className="text-center">
              <div className="inline-flex items-center justify-center w-12 h-12
                              bg-[#25D366]/10 rounded-2xl mb-3">
                <MessageCircle size={22} className="text-[#25D366]" />
              </div>
              <h1 className="text-xl font-extrabold text-gray-900">
                Enter your WhatsApp number
              </h1>
              <p className="text-sm text-gray-500 mt-1 leading-snug">
                Your store orders will arrive here.
                You can change it later.
              </p>
            </div>

            {/* Form */}
            <form onSubmit={handleContinue} className="space-y-4">
              <div>
                <div className="flex gap-2">
                  <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-200
                                  rounded-xl px-3 py-2.5 text-sm font-medium text-gray-600
                                  flex-shrink-0 select-none">
                    🇮🇳 +91
                  </div>
                  <input
                    type="tel"
                    inputMode="numeric"
                    placeholder="98765 43210"
                    value={digits}
                    onChange={(e) => {
                      setPhone(e.target.value.replace(/\D/g, ''));
                      setError('');
                    }}
                    maxLength={10}
                    autoFocus
                    className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5
                               text-sm font-mono focus:outline-none focus:ring-2
                               focus:ring-[#25D366]/30 focus:border-[#25D366] transition-all"
                  />
                </div>
                {error && (
                  <p className="text-xs text-red-500 mt-1.5">{error}</p>
                )}
              </div>

              <button
                type="submit"
                disabled={!isValid}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl
                           text-sm font-bold text-white bg-[#25D366] transition-all
                           hover:bg-[#1ebe5d] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Continue
                <ArrowRight size={15} />
              </button>
            </form>

            {/* Already have store */}
            <p className="text-center text-xs text-gray-400">
              Already have a store?{' '}
              <a
                href="/"
                className="text-teal-600 font-semibold hover:underline"
              >
                Back to home →
              </a>
            </p>
          </div>

          <p className="text-center text-xs text-gray-400 leading-relaxed">
            Your number is only used to receive order messages on WhatsApp.
            We don't send spam.
          </p>
        </div>
      </div>
    </div>
  );
}

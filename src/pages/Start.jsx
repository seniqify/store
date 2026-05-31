import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, MessageCircle } from 'lucide-react';
import { sendOtp, verifyOtp } from '../utils/otpService';
import { findStoreByPhone } from '../utils/storeService';

const RESEND_SECONDS = 30;

export default function Start() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const planParam = params.get('plan') || 'free';

  const [step,       setStep]       = useState('phone'); // 'phone' | 'otp' | 'exists'
  const [digits,     setDigits]     = useState('');
  const [otp,        setOtp]        = useState('');
  const [sending,    setSending]    = useState(false);
  const [verifying,  setVerifying]  = useState(false);
  const [error,      setError]      = useState('');
  const [timer,      setTimer]      = useState(0);
  const [existSlug,  setExistSlug]  = useState('');
  const timerRef = useRef(null);

  const isValidPhone = digits.replace(/\D/g, '').length === 10;
  const phone        = `91${digits.replace(/\D/g, '').slice(0, 10)}`;

  // Countdown timer for resend
  useEffect(() => {
    if (timer <= 0) { clearInterval(timerRef.current); return; }
    timerRef.current = setInterval(() => setTimer(t => t - 1), 1000);
    return () => clearInterval(timerRef.current);
  }, [timer]);

  async function handleSendOtp(e) {
    e?.preventDefault();
    if (!isValidPhone) { setError('Please enter a valid 10-digit WhatsApp number.'); return; }
    setSending(true);
    setError('');
    try {
      // Check for existing store before proceeding
      const existingSlug = await findStoreByPhone(phone);
      if (existingSlug) {
        setExistSlug(existingSlug);
        setStep('exists');
        return;
      }
      // TODO: re-enable OTP when Seniqify WhatsApp number is approved
      // await sendOtp(phone);
      // setStep('otp');
      // setTimer(RESEND_SECONDS);
      sessionStorage.setItem('pocketlink_verified_phone', phone);
      navigate(planParam !== 'free' ? `/plans?plan=${planParam}` : '/plans');
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setSending(false);
    }
  }

  async function handleVerifyOtp(e) {
    e?.preventDefault();
    if (otp.length !== 6) { setError('Please enter the 6-digit OTP.'); return; }
    setVerifying(true);
    setError('');
    try {
      await verifyOtp(phone, otp);
      sessionStorage.setItem('pocketlink_verified_phone', phone);
      navigate(planParam !== 'free' ? `/plans?plan=${planParam}` : '/plans');
    } catch (err) {
      setError(err.message || 'Verification failed. Please try again.');
    } finally {
      setVerifying(false);
    }
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

      <div className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm space-y-4">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-6 py-8 space-y-6">

            {/* ── Store already exists ── */}
            {step === 'exists' && (
              <div className="text-center space-y-5">
                <div className="text-4xl">🏪</div>
                <div>
                  <h1 className="text-xl font-extrabold text-gray-900">
                    Store already linked
                  </h1>
                  <p className="text-sm text-gray-500 mt-2 leading-snug">
                    This WhatsApp number already has a store.
                  </p>
                </div>
                <a
                  href={`/${existSlug}/manage`}
                  className="flex items-center justify-center gap-2 w-full py-3 rounded-xl
                             text-sm font-bold text-white bg-[#25D366] hover:bg-[#1ebe5d]
                             transition-colors"
                >
                  Go to My Store →
                </a>
                <button
                  onClick={() => { setStep('phone'); setDigits(''); setExistSlug(''); }}
                  className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
                >
                  Use a different number
                </button>
              </div>
            )}

            {/* ── Step 1: Phone entry ── */}
            {step === 'phone' && (
              <>
                <div className="text-center">
                  <div className="inline-flex items-center justify-center w-12 h-12
                                  bg-[#25D366]/10 rounded-2xl mb-3">
                    <MessageCircle size={22} className="text-[#25D366]" />
                  </div>
                  <h1 className="text-xl font-extrabold text-gray-900">
                    Enter your WhatsApp number
                  </h1>
                  <p className="text-sm text-gray-500 mt-1 leading-snug">
                    We'll send a one-time code to verify it's you.
                  </p>
                </div>

                <form onSubmit={handleSendOtp} className="space-y-4">
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
                        onChange={(e) => { setDigits(e.target.value.replace(/\D/g, '').slice(0, 10)); setError(''); }}
                        maxLength={10}
                        autoFocus
                        className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5
                                   text-sm font-mono focus:outline-none focus:ring-2
                                   focus:ring-[#25D366]/30 focus:border-[#25D366] transition-all"
                      />
                    </div>
                    {error && <p className="text-xs text-red-500 mt-1.5">{error}</p>}
                  </div>

                  <button
                    type="submit"
                    disabled={!isValidPhone || sending}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl
                               text-sm font-bold text-white bg-[#25D366] transition-all
                               hover:bg-[#1ebe5d] disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {sending ? (
                      <>
                        <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        Sending OTP…
                      </>
                    ) : (
                      <>Send OTP on WhatsApp <ArrowRight size={15} /></>
                    )}
                  </button>
                </form>
              </>
            )}

            {/* ── Step 2: OTP verification ── */}
            {step === 'otp' && (
              <>
                <div className="text-center">
                  <div className="text-4xl mb-3">💬</div>
                  <h1 className="text-xl font-extrabold text-gray-900">
                    Check your WhatsApp
                  </h1>
                  <p className="text-sm text-gray-500 mt-1 leading-snug">
                    We sent a 6-digit code to{' '}
                    <span className="font-semibold text-gray-700">+91 {digits}</span>
                  </p>
                </div>

                <form onSubmit={handleVerifyOtp} className="space-y-4">
                  <div>
                    <input
                      type="text"
                      inputMode="numeric"
                      placeholder="Enter 6-digit OTP"
                      value={otp}
                      onChange={(e) => { setOtp(e.target.value.replace(/\D/g, '').slice(0, 6)); setError(''); }}
                      maxLength={6}
                      autoFocus
                      className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3
                                 text-center text-xl font-mono tracking-[0.4em] font-bold
                                 focus:outline-none focus:ring-2 focus:ring-[#25D366]/30
                                 focus:border-[#25D366] transition-all"
                    />
                    {error && <p className="text-xs text-red-500 mt-1.5 text-center">{error}</p>}
                  </div>

                  <button
                    type="submit"
                    disabled={otp.length !== 6 || verifying}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl
                               text-sm font-bold text-white bg-[#25D366] transition-all
                               hover:bg-[#1ebe5d] disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {verifying ? (
                      <>
                        <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        Verifying…
                      </>
                    ) : (
                      <>Verify & Continue <ArrowRight size={15} /></>
                    )}
                  </button>
                </form>

                <div className="text-center space-y-1">
                  {timer > 0 ? (
                    <p className="text-xs text-gray-400">
                      Resend OTP in <span className="font-semibold text-gray-600">{timer}s</span>
                    </p>
                  ) : (
                    <button
                      onClick={handleSendOtp}
                      disabled={sending}
                      className="text-xs font-semibold text-teal-600 hover:underline disabled:opacity-50"
                    >
                      {sending ? 'Sending…' : 'Resend OTP'}
                    </button>
                  )}
                  <button
                    onClick={() => { setStep('phone'); setOtp(''); setError(''); }}
                    className="block w-full text-xs text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    ← Change number
                  </button>
                </div>
              </>
            )}

            <p className="text-center text-xs text-gray-400">
              Already have a store?{' '}
              <Link to="/" className="text-teal-600 font-semibold hover:underline">
                Back to home →
              </Link>
            </p>
          </div>

          <p className="text-center text-xs text-gray-400 leading-relaxed">
            Your number is only used to receive order messages on WhatsApp. We don't send spam.
          </p>
        </div>
      </div>
    </div>
  );
}

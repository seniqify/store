import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, MessageCircle, Check } from 'lucide-react';
import { sendOtp, verifyOtp } from '../utils/otpService';
import { findStoreByPhone } from '../utils/storeService';

const RESEND_SECONDS = 30;

const SIDE_BENEFITS = [
  { icon: '🆓', title: 'Free forever to start',  desc: 'A real, working store — no credit card needed.' },
  { icon: '💬', title: 'Orders on WhatsApp',     desc: 'Every order lands in your chat, neatly itemised.' },
  { icon: '⚡', title: 'Live in 2 minutes',      desc: 'No code, no designers. Share your link instantly.' },
];

export default function Start() {
  const navigate   = useNavigate();
  const [params]   = useSearchParams();
  const planParam  = params.get('plan') || 'free';
  const isUpgrade  = params.get('upgrade') === '1';

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
      // Check for existing store — skip if user is upgrading an existing store
      if (!isUpgrade) {
        const existingSlug = await findStoreByPhone(phone);
        if (existingSlug) {
          setExistSlug(existingSlug);
          setStep('exists');
          return;
        }
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
    <div className="relative min-h-screen flex flex-col overflow-hidden bg-white">

      {/* Decorative background */}
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-emerald-50/70 via-white to-white" />
      <div className="absolute -z-10 top-[-8rem] right-[-6rem] w-[26rem] h-[26rem] rounded-full bg-emerald-300/25 blur-3xl animate-pl-blob" />
      <div className="absolute -z-10 bottom-[-8rem] left-[-8rem] w-[24rem] h-[24rem] rounded-full bg-teal-300/20 blur-3xl animate-pl-blob" style={{ animationDelay: '5s' }} />

      {/* Nav */}
      <nav className="relative bg-white/70 backdrop-blur-md border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center">
          <Link to="/">
            <img src="/pocketlink-logo.svg" alt="PocketLink" className="h-8 w-auto" />
          </Link>
        </div>
      </nav>

      <div className="flex-1 flex items-center justify-center px-4 py-10 sm:py-14">
        <div className="w-full max-w-5xl grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">

          {/* ── Left: value panel (desktop) ──────────────────────────────── */}
          <div className="hidden lg:block animate-pl-fade-up">
            <div className="inline-flex items-center gap-2 bg-white border border-emerald-100 shadow-sm
                            text-emerald-700 text-xs font-semibold px-3 py-1.5 rounded-full mb-6">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Free · No tech skills · Live in minutes
            </div>
            <h1 className="text-4xl font-extrabold text-gray-900 leading-[1.1] tracking-tight mb-4">
              Your shop, online in{' '}
              <span className="bg-gradient-to-r from-emerald-500 to-teal-500 bg-clip-text text-transparent">
                two minutes
              </span>
            </h1>
            <p className="text-gray-500 text-base leading-relaxed mb-8 max-w-md">
              Enter your WhatsApp number to begin. We’ll set up a beautiful storefront that sends every
              order straight to your chat.
            </p>
            <ul className="space-y-4">
              {SIDE_BENEFITS.map(({ icon, title, desc }) => (
                <li key={title} className="flex items-start gap-3">
                  <span className="w-10 h-10 rounded-xl bg-white shadow-sm border border-gray-100 flex items-center justify-center text-lg flex-shrink-0">
                    {icon}
                  </span>
                  <div>
                    <p className="font-bold text-gray-900 text-sm">{title}</p>
                    <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{desc}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/* ── Right: auth card ─────────────────────────────────────────── */}
          <div className="w-full max-w-sm mx-auto lg:mx-0 lg:ml-auto space-y-4">
            <div className="bg-white rounded-3xl border border-gray-100 shadow-xl shadow-gray-200/50 px-6 py-8 space-y-6">

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
                               transition-colors active:scale-[0.98]"
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
                    <div className="inline-flex items-center justify-center w-14 h-14
                                    bg-[#25D366]/10 rounded-2xl mb-3">
                      <MessageCircle size={24} className="text-[#25D366]" />
                    </div>
                    <h1 className="text-xl font-extrabold text-gray-900">
                      Enter your WhatsApp number
                    </h1>
                    <p className="text-sm text-gray-500 mt-1 leading-snug">
                      We'll use it to send you orders. No spam, ever.
                    </p>
                  </div>

                  <form onSubmit={handleSendOtp} className="space-y-4">
                    <div>
                      <div className="flex gap-2">
                        <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-200
                                        rounded-xl px-3 py-3 text-sm font-medium text-gray-600
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
                          className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3
                                     text-sm font-mono focus:outline-none focus:ring-2
                                     focus:ring-[#25D366]/30 focus:border-[#25D366] transition-all"
                        />
                      </div>
                      {error && <p className="text-xs text-red-500 mt-1.5">{error}</p>}
                    </div>

                    <button
                      type="submit"
                      disabled={!isValidPhone || sending}
                      className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl
                                 text-sm font-bold text-white bg-[#25D366] transition-all
                                 hover:bg-[#1ebe5d] active:scale-[0.98] shadow-lg shadow-emerald-500/25
                                 disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
                    >
                      {sending ? (
                        <>
                          <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          Sending OTP…
                        </>
                      ) : (
                        <>Continue <ArrowRight size={15} /></>
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
                      className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl
                                 text-sm font-bold text-white bg-[#25D366] transition-all
                                 hover:bg-[#1ebe5d] active:scale-[0.98] shadow-lg shadow-emerald-500/25
                                 disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
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
                        className="text-xs font-semibold text-emerald-600 hover:underline disabled:opacity-50"
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

              {/* Trust row inside card */}
              {step === 'phone' && (
                <div className="flex items-center justify-center gap-4 text-[11px] text-gray-400 pt-1">
                  <span className="inline-flex items-center gap-1"><Check size={11} className="text-emerald-500" /> Free plan</span>
                  <span className="inline-flex items-center gap-1"><Check size={11} className="text-emerald-500" /> No app</span>
                  <span className="inline-flex items-center gap-1"><Check size={11} className="text-emerald-500" /> 2-min setup</span>
                </div>
              )}

              <p className="text-center text-xs text-gray-400">
                Already have a store?{' '}
                <Link to="/" className="text-emerald-600 font-semibold hover:underline">
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
    </div>
  );
}

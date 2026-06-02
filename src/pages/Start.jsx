import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, MessageCircle, Check } from 'lucide-react';
import { sendOtp, verifyOtp } from '../utils/otpService';
import { findStoreByPhone } from '../utils/storeService';

const RESEND_SECONDS = 30;

// TEMP: WhatsApp OTP disabled while Seniqify / WhatsApp delivery is down.
// Flip OTP_ENABLED back to true to restore the send-OTP -> verify flow.
// The phone is still captured and passed on, so plan selection / onboarding /
// payment / store creation are all unchanged. (Mirror of the flag in Register.jsx.)
const OTP_ENABLED = false;

const SIDE_BENEFITS = [
  { icon: '🆓', title: 'Free forever to start',  desc: 'A real, working page — no credit card needed.' },
  { icon: '💬', title: 'Orders on WhatsApp',     desc: 'Every order lands in your chat, neatly itemised.' },
  { icon: '⚡', title: 'Live in 2 minutes',      desc: 'No code, no designers. Share your link instantly.' },
];

const CATEGORY_CHIPS = [['🛍️', 'Shops'], ['🍽️', 'Food'], ['💇', 'Services'], ['🏨', 'Stays']];

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
      // TEMP: OTP disabled — skip verification, capture the number, continue
      // to the same place a successful verify would (plan selection).
      if (!OTP_ENABLED) {
        sessionStorage.setItem('pocketlink_verified_phone', phone);
        navigate(planParam !== 'free' ? `/plans?plan=${planParam}` : '/plans');
        return;
      }

      // Send the OTP via WhatsApp, then move to the verify step
      await sendOtp(phone);
      setStep('otp');
      setTimer(RESEND_SECONDS);
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
    <div className="relative min-h-screen flex flex-col overflow-hidden"
         style={{ background: 'linear-gradient(to bottom, #ecfdf5, #ffffff 38%)' }}>

      {/* soft brand blobs */}
      <div className="absolute -z-10 top-[-8rem] right-[-6rem] w-[26rem] h-[26rem] rounded-full bg-emerald-300/20 blur-3xl animate-pl-blob" />
      <div className="absolute -z-10 bottom-[-10rem] left-[-8rem] w-[24rem] h-[24rem] rounded-full bg-teal-300/15 blur-3xl animate-pl-blob" style={{ animationDelay: '5s' }} />

      {/* Nav */}
      <nav className="relative bg-white/60 backdrop-blur-md border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link to="/"><img src="/pocketlink-logo.svg" alt="PocketLink" className="h-8 w-auto" /></Link>
          <Link to="/" className="text-xs font-semibold text-gray-400 hover:text-gray-700 transition-colors">← Back to home</Link>
        </div>
      </nav>

      <div className="flex-1 flex items-center justify-center px-4 py-8 sm:py-12">
        <div className="w-full max-w-5xl grid lg:grid-cols-2 gap-5 lg:gap-10 items-stretch">

          {/* ══ Showcase panel ══════════════════════════════════════════════ */}
          <div className="relative overflow-hidden rounded-3xl p-6 sm:p-8 lg:p-10 flex flex-col justify-center
                          order-1 animate-pl-fade-up"
               style={{ background: 'linear-gradient(160deg, #07140f 0%, #0b2a20 55%, #06120d 100%)' }}>
            {/* glow + grid */}
            <div className="absolute -top-16 -right-12 w-64 h-64 rounded-full pointer-events-none"
                 style={{ background: 'rgba(16,185,129,0.35)', filter: 'blur(70px)' }} />
            <div className="absolute -bottom-20 -left-10 w-56 h-56 rounded-full pointer-events-none"
                 style={{ background: 'rgba(20,184,166,0.25)', filter: 'blur(70px)' }} />
            <div className="absolute inset-0 opacity-[0.06] pointer-events-none"
                 style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)', backgroundSize: '40px 40px', maskImage: 'radial-gradient(ellipse 80% 70% at 30% 30%, #000, transparent 75%)' }} />

            <div className="relative">
              <div className="inline-flex items-center gap-2 bg-white/5 border border-white/15 text-emerald-300
                              text-[11px] font-semibold px-3 py-1.5 rounded-full mb-5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Free · No tech skills · Live in minutes
              </div>

              <h1 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold text-white leading-[1.12] tracking-tight">
                Your business, online in{' '}
                <span className="bg-gradient-to-r from-emerald-300 to-teal-300 bg-clip-text text-transparent">2 minutes</span>
              </h1>

              <p className="text-white/55 text-sm sm:text-base leading-relaxed mt-3 max-w-md">
                A beautiful page that sends every order, booking and enquiry straight to your WhatsApp.
              </p>

              {/* benefits — desktop only (keeps the mobile panel compact) */}
              <ul className="hidden lg:block space-y-4 mt-8">
                {SIDE_BENEFITS.map(({ icon, title, desc }) => (
                  <li key={title} className="flex items-start gap-3">
                    <span className="w-10 h-10 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center text-lg flex-shrink-0">
                      {icon}
                    </span>
                    <div>
                      <p className="font-bold text-white text-sm">{title}</p>
                      <p className="text-xs text-white/50 mt-0.5 leading-relaxed">{desc}</p>
                    </div>
                  </li>
                ))}
              </ul>

              {/* category trust chips */}
              <div className="mt-6 lg:mt-8">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-white/40 mb-2.5">
                  Built for every kind of business
                </p>
                <div className="flex flex-wrap gap-2">
                  {CATEGORY_CHIPS.map(([emoji, label]) => (
                    <span key={label} className="inline-flex items-center gap-1.5 text-xs font-medium text-white/75
                                                 bg-white/5 border border-white/10 rounded-full px-3 py-1.5">
                      <span>{emoji}</span> {label}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* ══ Form card ═══════════════════════════════════════════════════ */}
          <div className="order-2 flex items-center justify-center">
            <div className="w-full max-w-md space-y-4">
              <div className="bg-white rounded-3xl border border-gray-100 shadow-xl shadow-emerald-900/5
                              px-6 py-8 sm:px-8 space-y-6">

                {/* ── Store already exists ── */}
                {step === 'exists' && (
                  <div className="text-center space-y-5">
                    <div className="text-4xl">🏪</div>
                    <div>
                      <h2 className="text-xl font-extrabold text-gray-900">Page already linked</h2>
                      <p className="text-sm text-gray-500 mt-2 leading-snug">
                        This WhatsApp number already has a page.
                      </p>
                    </div>
                    <a
                      href={`/${existSlug}/manage`}
                      className="flex items-center justify-center gap-2 w-full py-3.5 rounded-xl
                                 text-sm font-bold text-white bg-[#25D366] hover:bg-[#1ebe5d]
                                 transition-colors active:scale-[0.98]"
                    >
                      Go to my page →
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
                      <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-3 shadow-lg shadow-emerald-500/30"
                           style={{ background: 'linear-gradient(135deg, #25D366, #0d9488)' }}>
                        <MessageCircle size={24} className="text-white" />
                      </div>
                      <h2 className="text-xl font-extrabold text-gray-900">Enter your WhatsApp number</h2>
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
                            className="flex-1 w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3
                                       text-sm font-mono tracking-wide focus:outline-none focus:ring-2
                                       focus:ring-[#25D366]/30 focus:border-[#25D366] focus:bg-white transition-all"
                          />
                        </div>
                        {error && <p className="text-xs text-red-500 mt-1.5">{error}</p>}
                      </div>

                      <button
                        type="submit"
                        disabled={!isValidPhone || sending}
                        className="group relative w-full overflow-hidden flex items-center justify-center gap-2 py-3.5 rounded-xl
                                   text-sm font-bold text-white bg-[#25D366] transition-all
                                   hover:bg-[#1ebe5d] active:scale-[0.98] shadow-lg shadow-emerald-500/25
                                   disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none"
                      >
                        <span className="absolute inset-0 overflow-hidden rounded-xl pointer-events-none">
                          <span className="absolute top-0 left-0 h-full w-1/3 bg-white/25 blur-md pl-sheen" />
                        </span>
                        <span className="relative flex items-center justify-center gap-2">
                          {sending ? (
                            <>
                              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                              {OTP_ENABLED ? 'Sending OTP…' : 'Please wait…'}
                            </>
                          ) : (
                            <>Continue <ArrowRight size={15} /></>
                          )}
                        </span>
                      </button>
                    </form>
                  </>
                )}

                {/* ── Step 2: OTP verification ── */}
                {step === 'otp' && (
                  <>
                    <div className="text-center">
                      <div className="text-4xl mb-3">💬</div>
                      <h2 className="text-xl font-extrabold text-gray-900">Check your WhatsApp</h2>
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
                                     focus:border-[#25D366] focus:bg-white transition-all"
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
                          <>Verify &amp; Continue <ArrowRight size={15} /></>
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
                  <div className="flex items-center justify-center gap-4 text-[11px] text-gray-400 pt-1 border-t border-gray-50">
                    <span className="inline-flex items-center gap-1 pt-3"><Check size={11} className="text-emerald-500" /> Free plan</span>
                    <span className="inline-flex items-center gap-1 pt-3"><Check size={11} className="text-emerald-500" /> No app</span>
                    <span className="inline-flex items-center gap-1 pt-3"><Check size={11} className="text-emerald-500" /> 2-min setup</span>
                  </div>
                )}
              </div>

              <p className="text-center text-xs text-gray-400 leading-relaxed px-4">
                Your number is only used to receive order messages on WhatsApp. We don't send spam.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

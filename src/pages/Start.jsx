import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, MessageCircle, Check } from 'lucide-react';
import { sendOtp, verifyOtp } from '../utils/otpService';
import { findStoreByPhone, getPendingSignup } from '../utils/storeService';

// Longer resend window: each send REPLACES the stored code, so resending before
// a slow WhatsApp message lands would invalidate the code the user is waiting on.
const RESEND_SECONDS = 60;

// WhatsApp OTP is live (Seniqify template "optpt" / h042vmds6w). Set this to
// false to bypass verification (the number is still captured and the flow
// continues).
const OTP_ENABLED = true;

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

  // After the phone is confirmed (OTP or bypass): if this number already paid
  // but never finished onboarding, resume there free; otherwise go to plans.
  async function continueAfterPhone() {
    sessionStorage.setItem('pocketlink_verified_phone', phone);
    if (!isUpgrade) {
      const pending = await getPendingSignup(phone);
      if (pending) {
        sessionStorage.setItem('pocketlink_plan', pending.plan);
        if (pending.planExpiresAt)  sessionStorage.setItem('pocketlink_plan_expires', pending.planExpiresAt);
        if (pending.subscriptionId) sessionStorage.setItem('pocketlink_subscription_id', pending.subscriptionId);
        navigate('/onboarding');
        return;
      }
    }
    navigate(planParam !== 'free' ? `/plans?plan=${planParam}` : '/plans');
  }

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
        await continueAfterPhone();
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
      await continueAfterPhone();
    } catch (err) {
      setError(err.message || 'Verification failed. Please try again.');
    } finally {
      setVerifying(false);
    }
  }

  return (
    <div className="relative min-h-screen flex flex-col overflow-hidden"
         style={{ background: 'linear-gradient(160deg, #061310 0%, #0a2a20 52%, #05110d 100%)' }}>

      {/* ── Aurora + grid backdrop ── */}
      <div className="absolute inset-0 -z-10 pointer-events-none">
        <div className="absolute top-[-10rem] right-[-6rem] w-[34rem] h-[30rem] rounded-full blur-[110px] animate-pl-aurora"
             style={{ background: 'radial-gradient(circle, rgba(16,185,129,0.40), transparent 65%)' }} />
        <div className="absolute bottom-[-12rem] left-[-8rem] w-[32rem] h-[30rem] rounded-full blur-[120px] animate-pl-aurora"
             style={{ background: 'radial-gradient(circle, rgba(20,184,166,0.30), transparent 65%)', animationDelay: '7s' }} />
        <div className="absolute inset-0 opacity-[0.05]"
             style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)', backgroundSize: '46px 46px', maskImage: 'radial-gradient(ellipse 75% 60% at 50% 28%, #000, transparent 75%)' }} />
      </div>

      {/* ── Nav ── */}
      <nav className="relative z-10 border-b border-white/10">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link to="/"><img src="/pocketlink-logo.svg" alt="PocketLink" className="h-8 w-auto brightness-0 invert" /></Link>
          <Link to="/" className="text-xs font-semibold text-white/50 hover:text-white transition-colors">← Back to home</Link>
        </div>
      </nav>

      {/* ── Single centered experience ── */}
      <div className="relative z-10 flex-1 flex items-center justify-center px-4 py-6 sm:py-8">
        <div className="w-full max-w-md text-center animate-pl-fade-up">

          <div className="inline-flex items-center gap-2 bg-white/5 border border-white/15 text-emerald-300
                          text-[11px] font-semibold px-3 py-1.5 rounded-full mb-5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Simple setup · No tech skills · Live in minutes
          </div>

          <h1 className="text-3xl sm:text-4xl font-extrabold text-white leading-[1.1] tracking-tight">
            Your business, online in{' '}
            <span className="bg-gradient-to-r from-emerald-300 to-teal-300 bg-clip-text text-transparent">2 minutes</span>
          </h1>
          <p className="text-white/55 text-sm sm:text-[15px] leading-relaxed mt-3 max-w-sm mx-auto">
            Enter your WhatsApp number to begin — every order, booking &amp; enquiry lands straight in your chat.
          </p>

          {/* ══ Glass action card — the focal point ══════════════════════════ */}
          <div className="mt-7 text-left rounded-3xl border border-white/10 bg-white/[0.06] backdrop-blur-xl
                          p-5 sm:p-6 shadow-2xl shadow-emerald-950/40">

            {/* ── Store already exists ── */}
            {step === 'exists' && (
              <div className="text-center space-y-4 py-2">
                <div className="text-4xl">🏪</div>
                <div>
                  <p className="text-base font-extrabold text-white">Page already linked</p>
                  <p className="text-xs text-white/55 mt-1.5 leading-snug">This WhatsApp number already has a page.</p>
                </div>
                <a href={`/${existSlug}/manage`}
                   className="flex items-center justify-center gap-2 w-full py-3.5 rounded-xl text-sm font-bold text-white
                              bg-[#25D366] hover:bg-[#1ebe5d] transition-colors active:scale-[0.98] shadow-lg shadow-emerald-500/30">
                  Go to my page →
                </a>
                <button onClick={() => { setStep('phone'); setDigits(''); setExistSlug(''); }}
                  className="text-xs text-white/45 hover:text-white/80 transition-colors">
                  Use a different number
                </button>
              </div>
            )}

            {/* ── Step 1: Phone entry (the hero) ── */}
            {step === 'phone' && (
              <form onSubmit={handleSendOtp} className="space-y-4">
                <div>
                  <label className="flex items-center gap-2 text-xs font-bold text-white/75 mb-2">
                    <MessageCircle size={14} className="text-emerald-400" /> Your WhatsApp number
                  </label>
                  <div className="flex gap-2">
                    <div className="flex items-center gap-1.5 bg-white rounded-xl px-3.5 py-3.5 text-sm font-bold
                                    text-gray-700 flex-shrink-0 shadow-md select-none">
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
                      className="flex-1 w-full bg-white rounded-xl px-4 py-3.5 text-base font-mono tracking-wide
                                 text-gray-900 placeholder-gray-400 shadow-md focus:outline-none
                                 focus:ring-4 focus:ring-emerald-400/40 transition-all"
                    />
                  </div>
                  {error && <p className="text-xs text-red-300 mt-2">{error}</p>}
                </div>

                <button
                  type="submit"
                  disabled={!isValidPhone || sending}
                  className="group relative w-full overflow-hidden flex items-center justify-center gap-2 py-4 rounded-xl
                             text-sm font-bold text-white bg-[#25D366] transition-all
                             hover:bg-[#1ebe5d] active:scale-[0.98] shadow-lg shadow-emerald-500/30
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

                <div className="flex items-center justify-center gap-4 text-[11px] text-white/45 pt-1">
                  <span className="inline-flex items-center gap-1"><Check size={11} className="text-emerald-400" /> 0% commission</span>
                  <span className="inline-flex items-center gap-1"><Check size={11} className="text-emerald-400" /> No app</span>
                  <span className="inline-flex items-center gap-1"><Check size={11} className="text-emerald-400" /> 2-min setup</span>
                </div>
              </form>
            )}

            {/* ── Step 2: OTP verification ── */}
            {step === 'otp' && (
              <div className="space-y-4">
                <div className="text-center">
                  <div className="text-3xl mb-1">💬</div>
                  <p className="text-base font-bold text-white">Check your WhatsApp</p>
                  <p className="text-xs text-white/55 mt-1 leading-snug">
                    We sent a 6-digit code to <span className="font-semibold text-white">+91 {digits}</span>
                  </p>
                  <p className="text-[11px] text-white/40 mt-1">It can take up to a minute to arrive.</p>
                </div>

                <form onSubmit={handleVerifyOtp} className="space-y-4">
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="······"
                    value={otp}
                    onChange={(e) => { setOtp(e.target.value.replace(/\D/g, '').slice(0, 6)); setError(''); }}
                    maxLength={6}
                    autoFocus
                    className="w-full bg-white rounded-xl px-4 py-3.5 text-center text-xl font-mono tracking-[0.4em]
                               font-bold text-gray-900 shadow-md focus:outline-none focus:ring-4 focus:ring-emerald-400/40 transition-all"
                  />
                  {error && <p className="text-xs text-red-300 text-center">{error}</p>}

                  <button
                    type="submit"
                    disabled={otp.length !== 6 || verifying}
                    className="w-full flex items-center justify-center gap-2 py-4 rounded-xl text-sm font-bold text-white
                               bg-[#25D366] transition-all hover:bg-[#1ebe5d] active:scale-[0.98] shadow-lg shadow-emerald-500/30
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
                    <p className="text-xs text-white/45">
                      Resend OTP in <span className="font-semibold text-white/80">{timer}s</span>
                    </p>
                  ) : (
                    <button onClick={handleSendOtp} disabled={sending}
                      className="text-xs font-semibold text-emerald-300 hover:underline disabled:opacity-50">
                      {sending ? 'Sending…' : 'Resend OTP'}
                    </button>
                  )}
                  <button onClick={() => { setStep('phone'); setOtp(''); setError(''); }}
                    className="block w-full text-xs text-white/45 hover:text-white/80 transition-colors">
                    ← Change number
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ── Category trust chips ── */}
          <div className="mt-6">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-white/35 mb-2.5">
              Built for every kind of business
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {CATEGORY_CHIPS.map(([emoji, label]) => (
                <span key={label} className="inline-flex items-center gap-1.5 text-xs font-medium text-white/70
                                             bg-white/5 border border-white/10 rounded-full px-3 py-1.5">
                  <span>{emoji}</span> {label}
                </span>
              ))}
            </div>
          </div>

          <p className="mt-5 text-[11px] text-white/35 leading-relaxed max-w-xs mx-auto">
            Your number is only used to receive order messages on WhatsApp. We don't send spam.
          </p>
        </div>
      </div>
    </div>
  );
}

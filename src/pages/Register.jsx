import { useState, useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MessageCircle, ArrowRight, RotateCcw } from 'lucide-react';
import { sendOtp, verifyOtp } from '../utils/otpService';

/**
 * Register — WhatsApp number + OTP verification.
 * Must be completed before /onboarding is accessible.
 *
 * On success → stores verified phone in sessionStorage and redirects to /onboarding.
 */

// â"€â"€ 6-box OTP input â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
function OtpInput({ value, onChange, disabled }) {
  const refs = useRef([]);
  const digits = (value + '      ').slice(0, 6).split('');

  function handleChange(i, e) {
    const v = e.target.value.replace(/\D/g, '').slice(-1);
    const next = digits.map((d, idx) => (idx === i ? v : d));
    onChange(next.join('').trimEnd());
    if (v && i < 5) refs.current[i + 1]?.focus();
  }

  function handleKeyDown(i, e) {
    if (e.key === 'Backspace') {
      if (!digits[i].trim() && i > 0) {
        refs.current[i - 1]?.focus();
      } else {
        const next = digits.map((d, idx) => (idx === i ? ' ' : d));
        onChange(next.join('').trimEnd());
      }
    }
    if (e.key === 'ArrowLeft' && i > 0) refs.current[i - 1]?.focus();
    if (e.key === 'ArrowRight' && i < 5) refs.current[i + 1]?.focus();
  }

  function handlePaste(e) {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    onChange(pasted);
    refs.current[Math.min(pasted.length, 5)]?.focus();
    e.preventDefault();
  }

  return (
    <div className="flex items-center justify-center gap-2.5">
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => (refs.current[i] = el)}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={d.trim()}
          disabled={disabled}
          onChange={(e) => handleChange(i, e)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={handlePaste}
          className={[
            'w-11 h-12 text-center text-xl font-bold rounded-xl border-2 transition-all',
            'focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed',
            d.trim()
              ? 'border-teal-500 bg-teal-50 text-teal-700'
              : 'border-gray-200 bg-white text-gray-900 focus:border-teal-400',
          ].join(' ')}
        />
      ))}
    </div>
  );
}

// â"€â"€ Main component â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
// TEMP: WhatsApp OTP disabled while Seniqify / WhatsApp delivery is down.
// Flip OTP_ENABLED back to true to restore the send-OTP -> verify flow.
// The phone number is still captured and passed to onboarding either way,
// so payment / store creation / everything downstream is unchanged.
const OTP_ENABLED = false;

export default function Register() {
  const navigate = useNavigate();

  // If already verified this session, skip straight to onboarding
  useEffect(() => {
    if (sessionStorage.getItem('pocketlink_verified_phone')) {
      navigate('/onboarding', { replace: true });
    }
  }, [navigate]);

  const [phase,    setPhase]    = useState('phone');  // 'phone' | 'otp'
  const [phone,    setPhone]    = useState('');
  const [otp,      setOtp]      = useState('');
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  const [resendIn, setResendIn] = useState(0);

  // â"€â"€ Countdown timer for resend â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  // â"€â"€ Normalise phone to 10 digits â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  const digits = phone.replace(/\D/g, '').slice(-10);
  const fullPhone = `91${digits}`;  // E.164 without +
  const isValidPhone = digits.length === 10;

  // â"€â"€ Step 1 — send OTP â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  async function handleSendOtp(e) {
    e.preventDefault();
    if (!isValidPhone) { setError('Enter a valid 10-digit WhatsApp number.'); return; }

    // TEMP: OTP disabled — skip verification, capture the number, continue.
    if (!OTP_ENABLED) {
      sessionStorage.setItem('pocketlink_verified_phone', fullPhone);
      navigate('/onboarding', { replace: true });
      return;
    }

    setLoading(true);
    setError('');
    try {
      await sendOtp(fullPhone);
      setPhase('otp');
      setResendIn(30);
    } catch (err) {
      setError(err.message || 'Could not send OTP. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  // â"€â"€ Step 2 — verify OTP â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  async function handleVerify(e) {
    e.preventDefault();
    const code = otp.replace(/\s/g, '');
    if (code.length !== 6) { setError('Enter the 6-digit code from WhatsApp.'); return; }
    setLoading(true);
    setError('');
    try {
      await verifyOtp(fullPhone, code);
      sessionStorage.setItem('pocketlink_verified_phone', fullPhone);
      navigate('/onboarding', { replace: true });
    } catch (err) {
      setError(err.message || 'Incorrect code. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  // â"€â"€ Resend â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  async function handleResend() {
    if (resendIn > 0) return;
    setLoading(true);
    setError('');
    setOtp('');
    try {
      await sendOtp(fullPhone);
      setResendIn(30);
    } catch (err) {
      setError(err.message || 'Could not resend OTP.');
    } finally {
      setLoading(false);
    }
  }

  // â"€â"€ Formatted display number â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€
  const displayPhone = digits.length === 10
    ? `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`
    : '+91 …';

  return (
    <div className="relative min-h-screen flex flex-col overflow-hidden bg-white">

      {/* Decorative background */}
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-emerald-50/70 via-white to-white" />
      <div className="absolute -z-10 top-[-8rem] right-[-6rem] w-[24rem] h-[24rem] rounded-full bg-emerald-300/25 blur-3xl animate-pl-blob" />
      <div className="absolute -z-10 bottom-[-8rem] left-[-8rem] w-[22rem] h-[22rem] rounded-full bg-teal-300/20 blur-3xl animate-pl-blob" style={{ animationDelay: '5s' }} />

      {/* â"€â"€ Nav â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€ */}
      <nav className="relative bg-white/70 backdrop-blur-md border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center">
          <Link to="/">
            <img src="/pocketlink-logo.svg" alt="PocketLink" className="h-8 w-auto" />
          </Link>
        </div>
      </nav>

      {/* â"€â"€ Card â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€ */}
      <div className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm bg-white rounded-3xl border border-gray-100
                        shadow-xl shadow-gray-200/50 px-6 py-8 space-y-6">

          {/* Header */}
          <div className="text-center space-y-1">
            <div className="inline-flex items-center justify-center w-12 h-12
                            bg-[#25D366]/10 rounded-2xl mb-1">
              <MessageCircle size={22} className="text-[#25D366]" />
            </div>
            <h1 className="text-xl font-extrabold text-gray-900">
              {phase === 'phone' ? 'Create your free page' : 'Enter your OTP'}
            </h1>
            <p className="text-sm text-gray-500 leading-snug">
              {phase === 'phone'
                ? (OTP_ENABLED
                    ? 'Verify your WhatsApp number to get started.'
                    : 'Enter your WhatsApp number to get started.')
                : <>We sent a 6-digit code to <span className="font-semibold text-gray-700">{displayPhone}</span></>
              }
            </p>
          </div>

          {/* Free plan badge */}
          {phase === 'phone' && (
            <div className="flex items-center justify-center gap-1.5 bg-green-50
                            border border-green-100 rounded-xl px-3 py-2">
              <span className="text-sm">🆓</span>
              <span className="text-xs font-semibold text-green-700">
                Free forever · 3 products · No credit card
              </span>
            </div>
          )}

          {/* â"€â"€ Phase: phone entry â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€ */}
          {phase === 'phone' && (
            <form onSubmit={handleSendOtp} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                  WhatsApp Number
                </label>
                <div className="flex items-center gap-0 border border-gray-200 rounded-xl
                                overflow-hidden focus-within:ring-2 focus-within:ring-teal-400
                                focus-within:border-teal-400 transition-all">
                  {/* Country prefix */}
                  <div className="flex items-center gap-1.5 px-3 py-3 bg-gray-50
                                  border-r border-gray-200 flex-shrink-0">
                    <span className="text-base leading-none">🇮🇳</span>
                    <span className="text-sm font-semibold text-gray-600">+91</span>
                  </div>
                  <input
                    type="tel"
                    inputMode="numeric"
                    autoFocus
                    placeholder="98765 43210"
                    value={phone}
                    maxLength={10}
                    onChange={(e) => {
                      setPhone(e.target.value.replace(/\D/g, '').slice(0, 10));
                      setError('');
                    }}
                    className="flex-1 px-3 py-3 text-sm bg-white text-gray-900
                               placeholder-gray-400 focus:outline-none font-medium
                               tracking-wide"
                  />
                </div>
                <p className="mt-1 text-[11px] text-gray-400">
                  {OTP_ENABLED
                    ? 'OTP will be sent to this WhatsApp number.'
                    : "We'll use this number for your orders on WhatsApp."}
                </p>
              </div>

              {error && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-100
                              rounded-xl px-3 py-2">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={!isValidPhone || loading}
                className="w-full flex items-center justify-center gap-2 py-3
                           rounded-xl text-sm font-bold text-white
                           bg-[#25D366] hover:bg-[#1ebe5d] transition-colors
                           disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <div className="w-4 h-4 border-2 border-white/40 border-t-white
                                  rounded-full animate-spin" />
                ) : (
                  <>{OTP_ENABLED ? 'Send OTP on WhatsApp' : 'Continue'} <ArrowRight size={15} /></>
                )}
              </button>
            </form>
          )}

          {/* â"€â"€ Phase: OTP entry â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€â"€ */}
          {phase === 'otp' && (
            <form onSubmit={handleVerify} className="space-y-5">
              <OtpInput value={otp} onChange={setOtp} disabled={loading} />

              {error && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-100
                              rounded-xl px-3 py-2 text-center">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={otp.replace(/\s/g, '').length < 6 || loading}
                className="w-full flex items-center justify-center gap-2 py-3
                           rounded-xl text-sm font-bold text-white
                           bg-teal-600 hover:bg-teal-700 transition-colors
                           disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <div className="w-4 h-4 border-2 border-white/40 border-t-white
                                  rounded-full animate-spin" />
                ) : (
                  <>Verify &amp; Continue <ArrowRight size={15} /></>
                )}
              </button>

              {/* Resend + Change number */}
              <div className="flex items-center justify-between text-xs text-gray-400">
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={resendIn > 0 || loading}
                  className="flex items-center gap-1 hover:text-gray-700
                             disabled:opacity-40 disabled:cursor-not-allowed
                             transition-colors"
                >
                  <RotateCcw size={11} />
                  {resendIn > 0 ? `Resend in ${resendIn}s` : 'Resend OTP'}
                </button>
                <button
                  type="button"
                  onClick={() => { setPhase('phone'); setOtp(''); setError(''); }}
                  className="hover:text-gray-700 transition-colors"
                >
                  Change number
                </button>
              </div>
            </form>
          )}

          {/* Footer */}
          <p className="text-[11px] text-gray-400 text-center leading-relaxed pt-1">
            By continuing you agree to our{' '}
            <Link to="/terms" target="_blank" className="underline hover:text-gray-600">
              Terms
            </Link>{' '}
            and{' '}
            <Link to="/privacy" target="_blank" className="underline hover:text-gray-600">
              Privacy Policy
            </Link>.
          </p>
        </div>
      </div>
    </div>
  );
}

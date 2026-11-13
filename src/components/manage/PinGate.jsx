// The lock screen in front of a shop's dashboard (/:slug/manage).
//
// The checks are exactly the ones it always had: verify_store_pin for the PIN
// (throttled server-side: 10 wrong tries per address per shop in 15 minutes),
// and the WhatsApp code reset (sendOtp, then resetPin, verified server-side).
// Only the look changed (founder, 2026-11-13): the shop's own logo, name and
// colour; four PIN boxes that open the dashboard at the 4th digit; a "Show
// PIN" switch; and a clear way to reset the PIN on WhatsApp. On a computer a
// dark PocketLink panel sits beside it, in the same look as /plans.
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, ArrowRight, Eye, EyeOff, MessageCircle, ShieldCheck, Package, Truck,
  Wallet, ChevronRight, AlertCircle, Check, CheckCircle2, ShoppingBag, Users,
} from 'lucide-react';
import { verifyPin, resetPin } from '../../utils/storeService';
import { sendOtp } from '../../utils/otpService';
import { pinColors, nextDigits, shopInitial, isImageSrc } from '../../utils/pinGate';

const AURORA = {
  backgroundColor: '#061310',
  backgroundImage:
    'radial-gradient(circle at 88% 4%, rgba(16,185,129,0.3), transparent 50%), '
    + 'radial-gradient(circle at 4% 96%, rgba(20,184,166,0.18), transparent 48%)',
};
const WHATSAPP_GREEN = '#25d366';
const WRONG_PIN = 'That PIN didn’t match. Check it and try again, or reset it on WhatsApp.';

// What is behind the lock, for the panel beside it on a computer.
const INSIDE = [
  { Icon: Package,       title: 'Orders',            text: 'New-order alerts and order cards' },
  { Icon: Truck,         title: 'Delivery',          text: 'Book Delhivery, Shadowfax or your own delivery boy' },
  { Icon: Wallet,        title: 'Payments & Hisaab', text: 'Money in, money out, sales statements' },
  { Icon: MessageCircle, title: 'WhatsApp',          text: 'Order confirmations, shipping updates and Coins' },
];
const INSIDE_SERVICE = [
  { Icon: ShoppingBag, title: 'Leads',               text: 'Every enquiry from your page, in one list' },
  { Icon: Wallet,      title: 'Payments & Hisaab',   text: 'Money in, money out, sales statements' },
  { Icon: Users,       title: 'Customers & reviews', text: 'Who came back, and what they said' },
];

// Box sizes. lg: the PIN on the first screen. md: a new PIN. sm: the 6-digit code.
// Each fits a 320 px wide phone.
const SIZES = {
  lg: { gap: 'gap-3 sm:gap-3.5', cell: 'w-14 h-16 rounded-2xl min-[380px]:w-16 min-[380px]:h-[72px] sm:w-[72px] sm:h-20 sm:rounded-[18px]', dot: 'w-3 h-3 sm:w-3.5 sm:h-3.5', caret: 'h-7', digit: 'text-2xl' },
  md: { gap: 'gap-2.5', cell: 'w-14 h-[60px] rounded-[15px]', dot: 'w-3 h-3', caret: 'h-6', digit: 'text-xl' },
  sm: { gap: 'gap-1.5 min-[380px]:gap-2', cell: 'w-10 h-12 rounded-xl min-[380px]:w-11 min-[380px]:h-[54px] min-[380px]:rounded-[14px]', dot: 'w-3 h-3', caret: 'h-6', digit: 'text-xl min-[380px]:text-[22px]' },
};

/**
 * A row of digit boxes over ONE real input (numeric keyboard, paste and
 * one-time-code autofill all work). The boxes only draw what it holds.
 */
function DigitBoxes({
  id, label, value, length, onChange, masked = true, wrong = false, size = 'lg',
  accent, ring, autoComplete = 'off', autoFocus = false, inputRef, describedBy,
}) {
  const [focused, setFocused] = useState(false);
  const s = SIZES[size];
  return (
    <div className={`relative flex justify-center ${s.gap}`}>
      <input
        id={id} ref={inputRef} type="text" inputMode="numeric" pattern="[0-9]*"
        autoComplete={autoComplete} autoFocus={autoFocus} aria-label={label}
        aria-invalid={wrong || undefined} aria-describedby={describedBy}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        className="absolute inset-0 z-10 w-full h-full opacity-0 cursor-text text-base caret-transparent"
      />
      {Array.from({ length }, (_, i) => {
        const filled = i < value.length;
        const active = focused && !wrong && i === value.length;
        const cls = wrong ? 'border-2 border-red-600 bg-red-50'
          : active ? 'border-2 bg-white'
          : filled ? 'border-[1.5px] border-gray-400 bg-white'
          : 'border-[1.5px] border-gray-300 bg-white';
        return (
          <div key={i} aria-hidden="true"
               className={`${s.cell} flex items-center justify-center transition-colors ${cls}`}
               style={active ? { borderColor: accent, boxShadow: `0 0 0 4px ${ring}` } : undefined}>
            {filled && masked && <span className={`${s.dot} rounded-full ${wrong ? 'bg-red-700' : 'bg-gray-900'}`} />}
            {filled && !masked && <span className={`${s.digit} font-bold ${wrong ? 'text-red-700' : 'text-gray-900'}`}>{value[i]}</span>}
            {!filled && active && <span className={`w-0.5 ${s.caret} rounded-full animate-pulse`} style={{ background: accent }} />}
          </div>
        );
      })}
    </div>
  );
}

/** The shop's logo, or its first letter in its colour. */
function ShopLogo({ logo, name, accent, className }) {
  return isImageSrc(logo) ? (
    <img src={logo} alt={`${name} logo`}
         className={`${className} rounded-full object-cover bg-white border-4 border-white shadow-[0_8px_22px_rgba(6,19,16,0.22)]`} />
  ) : (
    <div aria-hidden="true" style={{ background: accent }}
         className={`${className} rounded-full border-4 border-white shadow-[0_8px_22px_rgba(6,19,16,0.22)] flex items-center justify-center text-white text-3xl font-extrabold`}>
      {shopInitial(name)}
    </div>
  );
}

function StepChips({ step, button }) {
  return (
    <ol className="flex items-center gap-2 mt-4" aria-label="Steps">
      <li className={`flex items-center gap-1.5 text-[12.5px] px-2.5 py-1.5 rounded-full ${step === 1 ? 'font-bold text-white' : 'font-semibold text-gray-700 bg-gray-100'}`}
          style={step === 1 ? { background: button } : undefined} aria-current={step === 1 ? 'step' : undefined}>
        {step === 1
          ? <span className="w-4 h-4 rounded-full bg-white/25 flex items-center justify-center text-[10.5px]">1</span>
          : <Check size={14} strokeWidth={3} className="text-green-700" />}
        WhatsApp number
      </li>
      <li aria-hidden="true" className="w-[18px] h-0.5 rounded-full bg-gray-300" />
      <li className={`flex items-center gap-1.5 text-[12.5px] px-2.5 py-1.5 rounded-full ${step === 2 ? 'font-bold text-white' : 'font-semibold text-gray-500 bg-gray-100'}`}
          style={step === 2 ? { background: button } : undefined} aria-current={step === 2 ? 'step' : undefined}>
        <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[10.5px] ${step === 2 ? 'bg-white/25' : 'bg-gray-200'}`}>2</span>
        New PIN
      </li>
    </ol>
  );
}

function WhatsAppTile({ size = 40 }) {
  return (
    <span className="rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ width: size, height: size, background: WHATSAPP_GREEN }}>
      <MessageCircle size={Math.round(size / 2)} strokeWidth={2.4} className="text-white" />
    </span>
  );
}

export default function PinGate({ slug, config, onVerified }) {
  const name = String(config?.businessName || '').trim() || slug;
  const { accent, button, ring } = pinColors(config?.theme?.primary);
  const inside = config?.businessType === 'service' ? INSIDE_SERVICE : INSIDE;

  const [mode,     setMode]     = useState('login');   // 'login' | 'recover'
  const [pin,      setPin]      = useState('');
  const [showPin,  setShowPin]  = useState(false);
  const [wrong,    setWrong]    = useState(false);     // the last PIN was refused
  const [error,    setError]    = useState('');
  const [checking, setChecking] = useState(false);
  const busy  = useRef(false);
  const pinRef = useRef(null);

  // Recovery state
  const [phone,    setPhone]    = useState('');
  const [otpSent,  setOtpSent]  = useState(false);
  const [code,     setCode]     = useState('');
  const [sending,  setSending]  = useState(false);
  const [newPin,   setNewPin]   = useState('');
  const [confPin,  setConfPin]  = useState('');
  const [success,  setSuccess]  = useState(false);
  const phone10 = phone.replace(/\D/g, '').slice(0, 10);

  // ── Login ──────────────────────────────────────────────────────────────────
  async function unlock(value) {
    if (busy.current) return;
    if (value.length !== 4) { setError('Enter your 4-digit PIN'); pinRef.current?.focus(); return; }
    busy.current = true; setChecking(true); setError(''); setWrong(false);
    let ok;
    try { ok = await verifyPin(slug, value); } catch { ok = false; }
    if (ok) { onVerified(value); return; }
    busy.current = false; setChecking(false);
    setWrong(true); setError(WRONG_PIN);
  }

  function onPinChange(raw) {
    const v = nextDigits(pin, raw, 4, wrong);
    if (wrong) setWrong(false);
    if (error) setError('');
    setPin(v);
    if (v.length === 4) unlock(v);          // opens by itself at the 4th digit
  }

  function tryAgain() {
    setPin(''); setWrong(false); setError('');
    pinRef.current?.focus();
  }

  // ── Recovery: step 1 — send an OTP to the store's WhatsApp number ────────────
  async function handleSendOtp(e) {
    e?.preventDefault?.();
    if (phone10.length !== 10) { setError('Enter a valid 10-digit WhatsApp number'); return; }
    setSending(true); setError('');
    try {
      await sendOtp(`91${phone10}`);
      setOtpSent(true);
    } catch (err) {
      setError(err.message || 'Could not send the code. Please try again.');
    } finally {
      setSending(false);
    }
  }

  // ── Recovery: step 2 — verify the OTP + set the new PIN (checked server-side) ─
  async function handleRecover(e) {
    e.preventDefault();
    if (code.length !== 6)   { setError('Enter the 6-digit code from WhatsApp'); return; }
    if (newPin.length !== 4) { setError('New PIN must be exactly 4 digits'); return; }
    if (newPin !== confPin)  { setError('The two PINs don’t match. Type the new PIN again.'); return; }
    setChecking(true); setError('');
    try {
      await resetPin(slug, newPin, `91${phone10}`, code);
      setSuccess(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setChecking(false);
    }
  }

  function switchMode(m) {
    setMode(m); setError(''); setWrong(false); setShowPin(false);
    setPin(''); setPhone(''); setOtpSent(false); setCode(''); setNewPin(''); setConfPin(''); setSuccess(false);
  }

  const recovering = mode === 'recover';
  const field = 'w-full pl-12 pr-3 py-3 border border-gray-300 rounded-xl text-base bg-white text-gray-900 '
              + 'placeholder-gray-400 focus:outline-none focus:ring-2 focus:border-transparent';
  const primaryBtn = 'w-full h-[54px] rounded-[14px] text-white text-base font-bold flex items-center justify-center gap-2 '
                   + 'transition active:scale-[0.98] disabled:opacity-60';

  return (
    <div className="min-h-screen bg-white lg:bg-[#f8faf9] lg:flex">

      {/* ── Computer: the PocketLink panel ─────────────────────────────────── */}
      <aside className="hidden lg:flex w-[540px] flex-shrink-0 flex-col gap-10 px-14 py-12 text-white" style={AURORA}>
        <img src="/pocketlink-logo.svg" alt="PocketLink" className="h-8 w-auto self-start brightness-0 invert" />
        <div className="space-y-4 mt-7">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-emerald-300">Shop dashboard</p>
          <h2 className="text-[40px] leading-[1.12] font-extrabold tracking-tight">Everything your shop needs, behind one PIN.</h2>
          <p className="text-base leading-relaxed text-[#b6d3c7]">
            {config?.businessType === 'service' ? 'Leads, payments and customers' : 'Orders, delivery, payments and WhatsApp'}
            {' '}— open them with the 4-digit PIN you set when you made your shop.
          </p>
        </div>
        <ul className="space-y-[18px]">
          {inside.map(({ Icon, title, text }) => (
            <li key={title} className="flex items-center gap-3.5">
              <span className="w-[42px] h-[42px] rounded-xl bg-emerald-400/10 border border-emerald-400/20 flex items-center justify-center flex-shrink-0">
                <Icon size={20} className="text-emerald-300" />
              </span>
              <span>
                <span className="block text-[15px] font-semibold">{title}</span>
                <span className="block text-[13px] text-[#9cc2b3]">{text}</span>
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-auto flex items-start gap-2.5 px-4 py-3.5 rounded-[14px] bg-white/5 border border-white/10">
          <ShieldCheck size={18} className="text-emerald-300 flex-shrink-0 mt-px" />
          <p className="text-[13px] leading-normal text-[#b6d3c7]">
            Your PIN is checked on PocketLink’s server, never stored on this device. After 10 wrong tries, PIN entry pauses for 15 minutes.
          </p>
        </div>
      </aside>

      {/* ── Phone: the dark header ─────────────────────────────────────────── */}
      <header className={`lg:hidden ${recovering ? 'h-[116px]' : 'h-[220px]'} px-4 pt-4 text-white`} style={AURORA}>
        <div className="flex items-center justify-between">
          {recovering ? (
            <button type="button" onClick={() => switchMode('login')} aria-label="Back to PIN"
                    className="w-11 h-11 rounded-full bg-white/10 border border-white/15 flex items-center justify-center">
              <ArrowLeft size={20} />
            </button>
          ) : (
            <Link to={`/${slug}`} aria-label="Back to shop"
                  className="w-11 h-11 rounded-full bg-white/10 border border-white/15 flex items-center justify-center">
              <ArrowLeft size={20} />
            </Link>
          )}
          <img src="/pocketlink-logo.svg" alt="PocketLink" className="h-[22px] w-auto brightness-0 invert" />
          <span className="w-11" aria-hidden="true" />
        </div>
        {!recovering && (
          <p className="mt-5 text-center text-[11px] font-bold uppercase tracking-[0.16em] text-emerald-300">Shop dashboard</p>
        )}
      </header>

      <main className="relative flex-1 min-w-0 lg:flex lg:items-center lg:justify-center lg:p-10">
        <Link to={`/${slug}`}
              className="hidden lg:flex absolute top-8 right-10 items-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:text-gray-900">
          <ArrowLeft size={16} /> Back to shop
        </Link>

        <div className={`relative ${recovering ? '-mt-6' : '-mt-16'} lg:mt-0 rounded-t-[28px] lg:rounded-none bg-white lg:bg-transparent
                         px-6 pb-8 lg:p-0 w-full lg:w-[392px] mx-auto animate-pl-fade-up`}>

          {/* ── LOGIN ───────────────────────────────────────────────────────── */}
          {!recovering && (
            <form onSubmit={(e) => { e.preventDefault(); if (wrong) tryAgain(); else unlock(pin); }}
                  className="flex flex-col items-center text-center">
              <ShopLogo logo={config?.logo} name={name} accent={accent} className="w-24 h-24 -mt-12 lg:mt-0 lg:w-[88px] lg:h-[88px]" />
              <p className="mt-3 text-xl font-extrabold tracking-tight text-gray-900">{name}</p>
              <p className="mt-1.5 lg:mt-2 inline-flex items-center gap-1.5 text-[12.5px] lg:text-[13px] text-gray-600 lg:px-3 lg:py-1 lg:rounded-full lg:bg-white lg:border lg:border-gray-200">
                <span className="w-[7px] h-[7px] rounded-full" style={{ background: accent }} />
                pocketlink.store/{slug}
              </p>

              <h1 className="mt-7 lg:mt-9 text-2xl lg:text-[28px] font-extrabold tracking-tight text-gray-900">Welcome back</h1>
              <p className="mt-1.5 text-[14.5px] lg:text-[15px] text-gray-600">
                Enter your 4-digit PIN<span className="hidden lg:inline"> to open your dashboard.</span>
              </p>

              <div className="mt-5 lg:mt-6">
                <DigitBoxes id="manage-pin" label="4-digit PIN" value={pin} length={4} onChange={onPinChange}
                            masked={!showPin} wrong={wrong} accent={accent} ring={ring} inputRef={pinRef}
                            autoFocus describedBy={error ? 'manage-pin-msg' : undefined} />
              </div>

              {error && (
                <p id="manage-pin-msg" role="alert"
                   className={`w-full mt-4 flex items-start gap-2 text-left text-[13.5px] leading-snug ${wrong ? 'px-3.5 py-3 rounded-[14px] bg-red-50 border border-red-200 text-red-700' : 'justify-center text-red-600'}`}>
                  {wrong && <AlertCircle size={18} className="flex-shrink-0 mt-px" />}
                  <span>{error}</span>
                </p>
              )}

              {!wrong && (
                <div className="w-full mt-2 lg:mt-3 flex items-center justify-center lg:justify-between">
                  <button type="button" onClick={() => { setShowPin((v) => !v); pinRef.current?.focus(); }}
                          aria-pressed={showPin}
                          className="flex items-center gap-1.5 px-2.5 lg:px-1 py-3 text-sm font-medium text-gray-700 hover:text-gray-900">
                    {showPin ? <EyeOff size={17} /> : <Eye size={17} />}
                    {showPin ? 'Hide PIN' : 'Show PIN'}
                  </button>
                  <span className="hidden lg:inline text-[13px] text-gray-500">Opens by itself at the 4th digit</span>
                </div>
              )}

              <button type="submit" disabled={checking}
                      className={`${primaryBtn} ${wrong ? 'mt-4' : 'mt-1.5 lg:mt-3'}`}
                      style={{ background: button, boxShadow: `0 8px 20px ${ring}` }}>
                {checking ? 'Checking…' : wrong ? 'Try again' : (<>Unlock dashboard <ArrowRight size={18} strokeWidth={2.2} /></>)}
              </button>
              {!wrong && <p className="lg:hidden mt-2.5 text-[12.5px] text-gray-500">Opens by itself when you type the 4th digit</p>}

              {wrong ? (
                <button type="button" onClick={() => switchMode('recover')}
                        className="w-full h-[54px] mt-2.5 rounded-[14px] border-[1.5px] border-gray-300 bg-white flex items-center justify-center gap-2.5 text-[15px] font-bold text-gray-900 active:scale-[0.98] transition">
                  <WhatsAppTile size={26} /> Reset PIN on WhatsApp
                </button>
              ) : (
                <button type="button" onClick={() => switchMode('recover')}
                        className="w-full mt-[22px] flex items-center gap-3 px-3.5 lg:px-4 py-3.5 rounded-2xl border border-gray-200 bg-gray-50 lg:bg-white text-left hover:border-gray-300 transition">
                  <WhatsAppTile />
                  <span className="flex-1">
                    <span className="block text-[14.5px] font-bold text-gray-900">Forgot your PIN?</span>
                    <span className="block text-[12.5px] lg:text-[13px] text-gray-600">Reset it with a code on WhatsApp</span>
                  </span>
                  <ChevronRight size={18} className="text-gray-500" />
                </button>
              )}

              <p className="lg:hidden mt-8 px-2 text-center text-xs leading-relaxed text-gray-500">
                <ShieldCheck size={14} className="inline -mt-0.5 mr-1" aria-hidden="true" />After 10 wrong tries, PIN entry pauses for 15 minutes
              </p>
            </form>
          )}

          {/* ── RESET ON WHATSAPP ───────────────────────────────────────────── */}
          {recovering && !success && (
            <div className="pt-[26px] lg:pt-0">
              <button type="button" onClick={() => switchMode('login')}
                      className="hidden lg:flex items-center gap-1.5 mb-5 text-sm font-medium text-gray-600 hover:text-gray-900">
                <ArrowLeft size={16} /> Back to PIN
              </button>
              <h1 className="text-[22px] font-extrabold tracking-tight text-gray-900">Reset your PIN</h1>
              <p className="mt-1 text-[13.5px] text-gray-600">{name}</p>
              <StepChips step={otpSent ? 2 : 1} button={button} />

              {!otpSent && (
                <form onSubmit={handleSendOtp} className="mt-5 flex flex-col gap-3">
                  <p className="text-sm text-gray-600">We’ll send a 6-digit code to the WhatsApp number linked to this shop.</p>
                  <div>
                    <label htmlFor="reset-phone" className="block text-[13px] font-semibold text-gray-700 mb-2">WhatsApp number of this shop</label>
                    <div className="relative">
                      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-base text-gray-500 font-medium pointer-events-none">+91</span>
                      <input id="reset-phone" type="tel" inputMode="numeric" autoComplete="tel-national" placeholder="98765 43210" maxLength={10}
                             value={phone} autoFocus
                             onChange={(e) => { setPhone(e.target.value.replace(/\D/g, '').slice(0, 10)); setError(''); }}
                             className={field} style={{ '--tw-ring-color': accent }} />
                    </div>
                  </div>
                  {error && <p role="alert" className="text-[13.5px] text-red-700 bg-red-50 border border-red-200 rounded-[14px] px-3.5 py-3">{error}</p>}
                  <button type="submit" disabled={sending} className={`${primaryBtn} mt-2`}
                          style={{ background: button, boxShadow: `0 8px 20px ${ring}` }}>
                    {sending ? 'Sending code…' : (<>Send code on WhatsApp <ArrowRight size={18} strokeWidth={2.2} /></>)}
                  </button>
                </form>
              )}

              {otpSent && (
                <form onSubmit={handleRecover} className="mt-[18px]">
                  <div className="flex items-center gap-3 px-3.5 py-3 rounded-2xl bg-gray-50 border border-gray-200">
                    <WhatsAppTile size={36} />
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-bold text-gray-900">Code sent on WhatsApp</span>
                      <span className="block text-[12.5px] text-gray-600">
                        to +91 {phone10.slice(0, 5)} {phone10.slice(5)} ·{' '}
                        <button type="button" onClick={() => { setOtpSent(false); setCode(''); setError(''); }}
                                className="font-semibold underline underline-offset-2" style={{ color: button }}>Change</button>
                      </span>
                    </span>
                  </div>

                  <p className="mt-[18px] mb-2 text-[13px] font-semibold text-gray-700">6-digit code</p>
                  <DigitBoxes id="reset-code" label="6-digit code from WhatsApp" value={code} length={6} size="sm"
                              masked={false} autoComplete="one-time-code" autoFocus accent={accent} ring={ring}
                              onChange={(raw) => { setCode(nextDigits(code, raw, 6)); setError(''); }} />
                  <p className="mt-2 text-[12.5px] text-gray-500">
                    Didn’t get it?{' '}
                    <button type="button" onClick={handleSendOtp} disabled={sending}
                            className="font-semibold underline underline-offset-2 disabled:opacity-50" style={{ color: button }}>
                      {sending ? 'Sending…' : 'Send it again'}
                    </button>
                  </p>

                  <p className="mt-[18px] mb-2 text-[13px] font-semibold text-gray-700">New PIN</p>
                  <DigitBoxes id="reset-new" label="New 4-digit PIN" value={newPin} length={4} size="md"
                              accent={accent} ring={ring}
                              onChange={(raw) => { setNewPin(nextDigits(newPin, raw, 4)); setError(''); }} />

                  <p className="mt-4 mb-2 text-[13px] font-semibold text-gray-700">Type the new PIN again</p>
                  <DigitBoxes id="reset-confirm" label="Confirm new PIN" value={confPin} length={4} size="md"
                              accent={accent} ring={ring}
                              onChange={(raw) => { setConfPin(nextDigits(confPin, raw, 4)); setError(''); }} />

                  {error && <p role="alert" className="mt-4 text-[13.5px] text-red-700 bg-red-50 border border-red-200 rounded-[14px] px-3.5 py-3">{error}</p>}

                  <button type="submit" disabled={checking} className={`${primaryBtn} mt-6`}
                          style={{ background: button, boxShadow: `0 8px 20px ${ring}` }}>
                    {checking ? 'Saving…' : 'Save new PIN'}
                  </button>
                  <p className="mt-2.5 text-center text-[12.5px] text-gray-500">Your old PIN stops working straight away.</p>
                </form>
              )}
            </div>
          )}

          {/* ── PIN CHANGED ─────────────────────────────────────────────────── */}
          {recovering && success && (
            <div className="pt-10 lg:pt-0 text-center flex flex-col items-center">
              <div className="w-16 h-16 rounded-2xl bg-green-50 flex items-center justify-center">
                <CheckCircle2 size={32} className="text-green-600" />
              </div>
              <h1 className="mt-4 text-[22px] font-extrabold tracking-tight text-gray-900">PIN changed</h1>
              <p className="mt-1.5 text-sm text-gray-600">Use your new PIN to open the dashboard of {name}.</p>
              <button type="button" onClick={() => switchMode('login')} className={`${primaryBtn} mt-6`}
                      style={{ background: button, boxShadow: `0 8px 20px ${ring}` }}>
                Unlock with new PIN <ArrowRight size={18} strokeWidth={2.2} />
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

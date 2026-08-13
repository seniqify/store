import { useState } from 'react';
import { CreditCard, Check, ShieldCheck } from 'lucide-react';
import { getPlanLimits, effectivePlan } from '../../utils/planLimits';
import { connectRazorpay, disconnectRazorpay } from '../../utils/paymentsConnect';

/**
 * Settings → Online Payments. Lets the owner connect their own Razorpay so
 * customers can pay by UPI / card at checkout (money settles to the merchant).
 *
 * Interim "paste keys" connect — the RLS-locked credentials never touch the
 * browser after this; the one-tap "Connect with Razorpay" (OAuth) drops into the
 * same slot once the Partner approval lands.
 */
export default function PaymentsConnect({ config, pin, themeColor = '#0d9488' }) {
  const entitled  = getPlanLimits(effectivePlan(config)).onlinePayments;
  const [pay, setPay]           = useState(config.payments || {});
  const [keyId, setKeyId]       = useState('');
  const [keySecret, setSecret]  = useState('');
  const [busy, setBusy]         = useState(false);
  const [err, setErr]           = useState('');

  const connected = Boolean(pay.razorpay);

  async function connect() {
    setErr(''); setBusy(true);
    try {
      const r = await connectRazorpay(config.slug, pin, { keyId: keyId.trim(), keySecret: keySecret.trim() });
      setPay({ razorpay: true, mode: r.mode, keyIdMasked: r.keyIdMasked });
      setKeyId(''); setSecret('');
    } catch (e) {
      setErr(e.message || 'Could not connect. Please try again.');
    } finally { setBusy(false); }
  }

  async function disconnect() {
    setErr(''); setBusy(true);
    try {
      await disconnectRazorpay(config.slug, pin);
      setPay({ razorpay: false });
    } catch (e) {
      setErr(e.message || 'Could not disconnect. Please try again.');
    } finally { setBusy(false); }
  }

  const label = 'block text-xs font-semibold text-gray-600 mb-1.5';
  const input = 'w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-900 bg-white ' +
                'placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent';

  return (
    <div>
      <label className="block text-sm font-semibold text-gray-700 mb-1.5">
        Online Payments <span className="text-gray-400 font-normal">· accept UPI / card at checkout</span>
      </label>

      {/* Not on a paid plan → upgrade tease (same idiom as Meta Pixel) */}
      {!entitled ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/60 px-3 py-2.5">
          <p className="text-xs text-gray-500">
            Take instant UPI / card payments on <b>Growth</b> &amp; <b>Pro</b> —{' '}
            <a href="/plans"
               onClick={() => sessionStorage.setItem('pocketlink_verified_phone', String(config.whatsappNumber || '').replace(/\D/g, ''))}
               className="font-semibold underline text-brand-dark">upgrade →</a>
          </p>
        </div>
      ) : connected ? (
        /* Connected state */
        <div className="rounded-xl border border-green-200 bg-green-50 px-3.5 py-3">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-green-500 text-white flex items-center justify-center flex-shrink-0">
              <Check size={14} strokeWidth={3} />
            </span>
            <p className="text-sm font-bold text-green-800">Razorpay connected</p>
            <span className={`ml-auto text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${
              pay.mode === 'live' ? 'bg-green-600 text-white' : 'bg-amber-100 text-amber-700'}`}>
              {pay.mode === 'live' ? 'Live' : 'Test mode'}
            </span>
          </div>
          {pay.keyIdMasked && (
            <p className="text-xs text-green-700/80 mt-1.5 font-mono">{pay.keyIdMasked}</p>
          )}
          <p className="text-xs text-gray-500 mt-2">
            Customers now see <b>“Pay Online now — UPI / Card”</b> at checkout. Money settles to your Razorpay account.
          </p>
          {err && <p className="text-xs text-red-600 mt-2">{err}</p>}
          <button type="button" onClick={disconnect} disabled={busy}
            className="mt-2.5 text-xs font-semibold text-gray-400 hover:text-red-500 disabled:opacity-50">
            {busy ? 'Disconnecting…' : 'Disconnect'}
          </button>
        </div>
      ) : (
        /* Connect form */
        <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-3.5 space-y-3">
          <div className="flex items-start gap-2 text-xs text-gray-500">
            <CreditCard size={15} className="flex-shrink-0 mt-0.5" style={{ color: themeColor }} />
            <span>Paste your Razorpay API keys to take UPI / card payments. Money goes straight to your account — we never hold it.</span>
          </div>
          <div>
            <label className={label}>Key ID</label>
            <input type="text" value={keyId} onChange={(e) => setKeyId(e.target.value)}
                   placeholder="rzp_test_… or rzp_live_…" className={input} autoComplete="off" />
          </div>
          <div>
            <label className={label}>Key Secret</label>
            <input type="password" value={keySecret} onChange={(e) => setSecret(e.target.value)}
                   placeholder="Your Razorpay key secret" className={input} autoComplete="off" />
          </div>
          {err && <p className="text-xs text-red-600">{err}</p>}
          <button type="button" onClick={connect} disabled={busy || !keyId.trim() || !keySecret.trim()}
            className="w-full py-2.5 rounded-xl text-white text-sm font-bold active:scale-[0.98] transition disabled:opacity-50"
            style={{ background: themeColor }}>
            {busy ? 'Connecting…' : 'Connect Razorpay'}
          </button>
          <p className="text-[11px] text-gray-400 leading-snug flex items-start gap-1.5">
            <ShieldCheck size={13} className="flex-shrink-0 mt-px" />
            <span>
              Find your keys in Razorpay Dashboard → Settings → API Keys. Start with <b>Test Mode</b> keys to try it safely.
              One-tap “Connect with Razorpay” is coming soon.
            </span>
          </p>
        </div>
      )}
    </div>
  );
}

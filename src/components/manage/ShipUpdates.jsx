import { useState, useEffect, useCallback } from 'react';
import { MessageCircle, Loader2 } from 'lucide-react';
import WalletCard from './WalletCard';
import { getShipUpdates, setShipUpdates, SHIP_EVENTS } from '../../utils/deliveryTools';
import { fetchWallet } from '../../utils/wallet';
import { formatPaise } from '../../utils/walletPacks';

/**
 * Delivery → WhatsApp: automatic shipping updates to the buyer, paid from the
 * shop's WhatsApp wallet at Rs 0.50 each (supabase/delivery-tools-forward.sql,
 * edge function ship-updates). One master switch, one switch per step.
 */

const PREVIEW = {
  shipped:   (s) => `Hi Sameer, your order from ${s} is on its way with Delhivery. Tracking number: 1490882344. [Track order]`,
  ofd:       (s) => `Hi Sameer, your order from ${s} is out for delivery today. Amount to pay on delivery: ₹780. [Track order]`,
  failed:    (s) => `Hi Sameer, the delivery partner could not deliver your order from ${s} today. Tap below to choose: deliver tomorrow or change the address. [Choose]`,
  delivered: (s) => `Hi Sameer, your order from ${s} has been delivered. Thank you for shopping with us! [Rate your order]`,
};

function Switch({ on, onClick, label, disabled, color }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={onClick} disabled={disabled}
            className="relative w-11 h-6 rounded-full transition-colors flex-shrink-0 disabled:opacity-50"
            style={{ backgroundColor: on ? color : '#d1d5db' }}>
      <span className={['absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform', on ? 'translate-x-5' : ''].join(' ')} />
    </button>
  );
}

export default function ShipUpdates({ slug, pin, themeColor = '#0d9488', storeName = '' }) {
  const [s, setS]       = useState(null);   // { enabled, events[], sent_30d, price_paise }
  const [balance, setBalance] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState('');
  const [open, setOpen] = useState('');     // preview shown for one step

  const load = useCallback(async () => {
    try { setS(await getShipUpdates(slug, pin)); }
    catch (e) { setErr(e.message); }
    const w = await fetchWallet(slug, pin);
    if (w.ok) setBalance(Number(w.data?.balance_paise) || 0);
  }, [slug, pin]);
  useEffect(() => { load(); }, [load]);

  async function save(enabled, events) {
    setBusy(true); setErr('');
    const before = s;
    setS((x) => ({ ...x, enabled, events }));
    try { await setShipUpdates(slug, pin, enabled, events); }
    catch (e) { setErr(e.message); setS(before); }
    finally { setBusy(false); }
  }

  if (!s) {
    return err
      ? <p className="text-[12px] text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">{err}</p>
      : <div className="py-10 grid place-items-center text-gray-400"><Loader2 className="animate-spin" size={22} /></div>;
  }

  const price = Number(s.price_paise) || 50;
  const events = Array.isArray(s.events) ? s.events : [];
  const toggleEvent = (k) => save(s.enabled, events.includes(k) ? events.filter((e) => e !== k) : [...events, k]);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-extrabold text-gray-900">WhatsApp updates</h2>
        <p className="text-xs text-gray-500 mt-0.5">Your customers hear about their parcel without calling you</p>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl grid place-items-center flex-shrink-0" style={{ background: `${themeColor}14`, color: themeColor }}>
          <MessageCircle size={17} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-extrabold text-gray-900">Automatic shipping updates</p>
          <p className="text-xs text-gray-500 mt-0.5">
            {s.enabled ? `On · ${formatPaise(price)} per message from your wallet` : 'Off · no messages are sent'}
          </p>
        </div>
        <Switch on={s.enabled} disabled={busy} color={themeColor} label="Automatic shipping updates"
                onClick={() => save(!s.enabled, events)} />
      </div>

      {err && <p className="text-[12px] text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">{err}</p>}

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
        {SHIP_EVENTS.map((e) => (
          <div key={e.key} className="px-4 py-3 border-t border-gray-50 first:border-t-0">
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className={`text-[13.5px] font-bold ${s.enabled ? 'text-gray-900' : 'text-gray-500'}`}>{e.title}</p>
                <p className="text-[11.5px] text-gray-500 mt-0.5">{e.desc} · {formatPaise(price)}</p>
                <button type="button" onClick={() => setOpen(open === e.key ? '' : e.key)}
                        className="text-[11.5px] font-bold mt-1" style={{ color: themeColor }}>
                  {open === e.key ? 'Hide message' : 'See message'}
                </button>
              </div>
              <Switch on={s.enabled && events.includes(e.key)} disabled={busy || !s.enabled} color={themeColor}
                      label={e.title} onClick={() => toggleEvent(e.key)} />
            </div>
            {open === e.key && (
              <p className="mt-2 rounded-xl bg-[#e7fce3] px-3 py-2 text-[12.5px] text-gray-800 leading-snug">{PREVIEW[e.key](storeName || 'your shop')}</p>
            )}
          </div>
        ))}
      </div>

      <p className="text-[12px] text-gray-600 px-1 leading-relaxed">
        {balance !== null && <>Wallet {formatPaise(balance)} ≈ <b>{Math.floor(balance / price)}</b> shipping updates. </>}
        Last 30 days: {s.sent_30d || 0} sent. Only orders placed after you turn this on get updates, one per step, between 8 am and 9 pm.
        When the wallet is empty, updates stop until you top up. Customers who said Stop to your shop get none.
      </p>

      <WalletCard slug={slug} pin={pin} themeColor={themeColor} storeName={storeName} compact />
    </div>
  );
}

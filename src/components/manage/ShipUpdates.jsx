import { useState, useEffect, useCallback } from 'react';
import { Truck, Loader2 } from 'lucide-react';
import { getShipUpdates, setShipUpdates, SHIP_EVENTS } from '../../utils/deliveryTools';

/**
 * WhatsApp → Shipping updates: automatic messages to the buyer at each step of
 * the parcel, 1 Coin each from the shop's Coins (supabase/delivery-tools-
 * forward.sql, edge function ship-updates). One master switch, one per step.
 */

const PREVIEW = {
  shipped:   (s) => `Hi Sameer, your order from ${s} is on its way with Delhivery. Tracking number: 149088234402. Tap below to track it. [Track order]`,
  ofd:       (s) => `Hi Sameer, your order from ${s} is out for delivery today. Amount to pay on delivery: ₹780. Please keep your phone reachable. [Track order]`,
  failed:    (s) => `Hi Sameer, the delivery partner could not deliver your order from ${s} today. Tap below to tell us what to do: deliver tomorrow, change the address or cancel. [Choose what to do]`,
  delivered: (s) => `Hi Sameer, your order from ${s} has been delivered. Thank you for shopping with us! Tap below to rate your order. [Rate your order]`,
};

export function Switch({ on, onClick, label, disabled, color }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={onClick} disabled={disabled}
            className="relative w-11 h-6 rounded-full transition-colors flex-shrink-0 disabled:opacity-50"
            style={{ backgroundColor: on ? color : '#d1d5db' }}>
      <span className={['absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform', on ? 'translate-x-5' : ''].join(' ')} />
    </button>
  );
}

export default function ShipUpdates({ slug, pin, themeColor = '#0d9488', storeName = '' }) {
  const [s, setS]       = useState(null);   // { enabled, events[], sent_30d }
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState('');
  const [open, setOpen] = useState('');     // preview shown for one step

  const load = useCallback(async () => {
    try { setS(await getShipUpdates(slug, pin)); }
    catch (e) { setErr(e.message); }
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
      : <div className="h-40 rounded-2xl bg-white border border-gray-100 animate-pulse" />;
  }

  const events = Array.isArray(s.events) ? s.events : [];
  const toggleEvent = (k) => save(s.enabled, events.includes(k) ? events.filter((e) => e !== k) : [...events, k]);

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
      <div className="p-4 flex items-center gap-3 border-b border-gray-50">
        <div className="w-9 h-9 rounded-xl grid place-items-center flex-shrink-0" style={{ background: `${themeColor}14`, color: themeColor }}>
          {busy ? <Loader2 size={17} className="animate-spin" /> : <Truck size={17} />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-extrabold text-gray-900">Automatic shipping updates</p>
          <p className="text-xs text-gray-500 mt-0.5">{s.enabled ? 'On · 1 Coin per message' : 'Off · no shipping messages'}</p>
        </div>
        <Switch on={s.enabled} disabled={busy} color={themeColor} label="Automatic shipping updates"
                onClick={() => save(!s.enabled, events)} />
      </div>

      {err && <p className="mx-4 mt-3 text-[12px] text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">{err}</p>}

      {SHIP_EVENTS.map((e) => (
        <div key={e.key} className="px-4 py-3 border-t border-gray-50 first:border-t-0">
          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className={`text-[13.5px] font-bold ${s.enabled ? 'text-gray-900' : 'text-gray-500'}`}>{e.title}</p>
              <p className="text-[11.5px] text-gray-500 mt-0.5">{e.desc}</p>
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

      <p className="px-4 pb-4 pt-1 text-[11.5px] text-gray-500 leading-relaxed">
        Last 30 days: {s.sent_30d || 0} sent. Only orders placed after you turn this on get updates, one per step, between 8 am and 9 pm.
        They stop when your Coins run out. Customers who said Stop to your shop get none.
      </p>
    </div>
  );
}

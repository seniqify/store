import { useState } from 'react';
import { Truck, Check, ShieldCheck } from 'lucide-react';
import { getPlanLimits, effectivePlan } from '../../utils/planLimits';
import { connectDelhivery, connectShadowfax, disconnectDelhivery } from '../../utils/shippingConnect';
import { clearCachedStore } from '../../utils/businessStorage';

const COURIERS = {
  delhivery: { name: 'Delhivery', blurb: 'Live rates at checkout, then one-tap booking + printed labels per order.' },
  shadowfax: { name: 'Shadowfax', blurb: 'Book a seller-pickup order; a rider collects it and delivers. The rider carries the label.' },
};

/**
 * Settings → Shipping. Connect the store's own courier account (Delhivery or
 * Shadowfax) so outstation orders ship pan-India. Local orders stay on rider
 * dispatch. The API token is stored server-side (RLS-locked), never in the browser.
 */
export default function ShippingConnect({ config, pin, themeColor = '#0d9488', onConfig }) {
  const entitled = getPlanLimits(effectivePlan(config)).shipping;
  const [ship, setShip]       = useState(config.shipping || {});
  const [courier, setCourier] = useState(ship.courier || (ship.shadowfax ? 'shadowfax' : 'delhivery'));
  const [tok, setTok]         = useState('');
  const [pincode, setPin]     = useState('');
  const [address, setAddr]    = useState('');
  const [phone, setPhone]     = useState('');
  const [city, setCity]       = useState('');
  const [stateName, setState] = useState('');
  const [busy, setBusy]       = useState(false);
  const [err, setErr]         = useState('');

  const activeCourier = ship.courier || (ship.delhivery ? 'delhivery' : ship.shadowfax ? 'shadowfax' : null);
  const connected     = Boolean(ship.delhivery || ship.shadowfax);
  const isSfx         = courier === 'shadowfax';
  const canConnect    = tok.trim() && pincode.length === 6 && (!isSfx || (city.trim() && stateName.trim()));

  async function connect() {
    setErr(''); setBusy(true);
    try {
      const common = {
        apiToken: tok.trim(), pickupPincode: pincode.trim(),
        pickupAddress: address.trim(), pickupPhone: phone.trim(), pickupName: config.businessName,
      };
      let r, next;
      if (isSfx) {
        r = await connectShadowfax(config.slug, pin, { ...common, pickupCity: city.trim(), pickupState: stateName.trim() });
        next = { courier: 'shadowfax', shadowfax: true, delhivery: false, pickupPincode: r.pickupPincode, district: r.district, localPrefix: (r.pickupPincode || '').slice(0, 3) };
      } else {
        r = await connectDelhivery(config.slug, pin, common);
        next = { courier: 'delhivery', delhivery: true, shadowfax: false, pickupPincode: r.pickupPincode, district: r.district, localPrefix: (r.pickupPincode || '').slice(0, 3) };
      }
      setShip(next);
      onConfig?.({ shipping: next });      // keep Settings in sync (no reload needed)
      clearCachedStore(config.slug);       // a future reload reads the fresh flag from the DB
      setTok(''); setPin(''); setAddr(''); setPhone(''); setCity(''); setState('');
    } catch (e) { setErr(e.message || 'Could not connect. Try again.'); }
    finally { setBusy(false); }
  }

  async function disconnect() {
    setErr(''); setBusy(true);
    try {
      await disconnectDelhivery(config.slug, pin);
      const off = { delhivery: false, shadowfax: false, courier: null };
      setShip(off);
      onConfig?.({ shipping: off });
      clearCachedStore(config.slug);
    } catch (e) { setErr(e.message || 'Could not disconnect.'); }
    finally { setBusy(false); }
  }

  const label = 'block text-xs font-semibold text-gray-600 mb-1.5';
  const input = 'w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-900 bg-white ' +
                'placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent';

  return (
    <div>
      <label className="block text-sm font-semibold text-gray-700 mb-1.5">
        Shipping <span className="text-gray-400 font-normal">· ship pan-India with Delhivery or Shadowfax</span>
      </label>

      {!entitled ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/60 px-3 py-2.5">
          <p className="text-xs text-gray-500">
            Ship anywhere in India with live courier rates on <b>Growth</b> &amp; <b>Pro</b> —{' '}
            <a href="/plans"
               onClick={() => sessionStorage.setItem('pocketlink_verified_phone', String(config.whatsappNumber || '').replace(/\D/g, ''))}
               className="font-semibold underline text-brand-dark">upgrade →</a>
          </p>
        </div>
      ) : connected ? (
        <div className="rounded-xl border border-green-200 bg-green-50 px-3.5 py-3">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-green-500 text-white flex items-center justify-center flex-shrink-0">
              <Check size={14} strokeWidth={3} />
            </span>
            <p className="text-sm font-bold text-green-800">{COURIERS[activeCourier]?.name || 'Courier'} connected</p>
            <span className="ml-auto text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-green-600 text-white">Live</span>
          </div>
          <p className="text-xs text-green-700/80 mt-1.5">
            Pickup from <b>{ship.pickupPincode}{ship.district ? ` · ${ship.district}` : ''}</b>
          </p>
          <p className="text-xs text-gray-500 mt-2">
            Outstation orders ship via {COURIERS[activeCourier]?.name || 'your courier'}. Local orders (pincodes starting <b>{ship.localPrefix}</b>) stay on rider dispatch.
          </p>
          {err && <p className="text-xs text-red-600 mt-2">{err}</p>}
          <button type="button" onClick={disconnect} disabled={busy}
            className="mt-2.5 text-xs font-semibold text-gray-400 hover:text-red-500 disabled:opacity-50">
            {busy ? 'Disconnecting…' : 'Disconnect'}
          </button>
        </div>
      ) : (
        <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-3.5 space-y-3">
          {/* Courier picker */}
          <div className="flex gap-2">
            {['delhivery', 'shadowfax'].map((c) => (
              <button key={c} type="button" onClick={() => { setCourier(c); setErr(''); }}
                className={[
                  'flex-1 py-2 rounded-xl text-sm font-bold border transition active:scale-[0.98]',
                  courier === c ? 'text-white border-transparent' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300',
                ].join(' ')}
                style={courier === c ? { background: themeColor } : {}}>
                {COURIERS[c].name}
              </button>
            ))}
          </div>

          <div className="flex items-start gap-2 text-xs text-gray-500">
            <Truck size={15} className="flex-shrink-0 mt-0.5" style={{ color: themeColor }} />
            <span>{COURIERS[courier].blurb}</span>
          </div>

          <div>
            <label className={label}>{COURIERS[courier].name} API Token</label>
            <input type="password" value={tok} onChange={(e) => setTok(e.target.value)}
                   placeholder={`Your ${COURIERS[courier].name} API token`} className={input} autoComplete="off" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={label}>Pickup PIN code</label>
              <input type="tel" inputMode="numeric" maxLength={6} value={pincode}
                     onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                     placeholder="e.g. 413001" className={input} />
            </div>
            <div>
              <label className={label}>Pickup phone</label>
              <input type="tel" inputMode="numeric" maxLength={10} value={phone}
                     onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                     placeholder="10-digit" className={input} />
            </div>
          </div>
          <div>
            <label className={label}>Pickup address</label>
            <input type="text" value={address} onChange={(e) => setAddr(e.target.value)}
                   placeholder="Shop / warehouse address" className={input} />
          </div>
          {isSfx && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={label}>Pickup city</label>
                <input type="text" value={city} onChange={(e) => setCity(e.target.value)}
                       placeholder="e.g. Solapur" className={input} />
              </div>
              <div>
                <label className={label}>Pickup state</label>
                <input type="text" value={stateName} onChange={(e) => setState(e.target.value)}
                       placeholder="e.g. Maharashtra" className={input} />
              </div>
            </div>
          )}
          {err && <p className="text-xs text-red-600">{err}</p>}
          <button type="button" onClick={connect} disabled={busy || !canConnect}
            className="w-full py-2.5 rounded-xl text-white text-sm font-bold active:scale-[0.98] transition disabled:opacity-50"
            style={{ background: themeColor }}>
            {busy ? 'Connecting…' : `Connect ${COURIERS[courier].name}`}
          </button>
          <p className="text-[11px] text-gray-400 leading-snug flex items-start gap-1.5">
            <ShieldCheck size={13} className="flex-shrink-0 mt-px" />
            <span>Find your token in your {COURIERS[courier].name} dashboard / dev portal. Your token is stored securely and never shown in the browser.</span>
          </p>
        </div>
      )}
    </div>
  );
}

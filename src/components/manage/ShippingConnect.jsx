import { useState } from 'react';
import { Truck, Check, ShieldCheck } from 'lucide-react';
import { getPlanLimits, effectivePlan } from '../../utils/planLimits';
import { connectDelhivery, connectShadowfax, disconnectCourier, setActiveCourier } from '../../utils/shippingConnect';
import { clearCachedStore } from '../../utils/businessStorage';

const COURIERS = {
  delhivery: { name: 'Delhivery', blurb: 'Live rates at checkout, then one-tap booking + printed labels per order.' },
  shadowfax: { name: 'Shadowfax', blurb: 'Book a seller-pickup order; a rider collects it and delivers. The rider carries the label.' },
};
const ORDER = ['delhivery', 'shadowfax'];

/**
 * Settings → Shipping. Connect one or both couriers (Delhivery / Shadowfax) and
 * pick which is the store's active default — every order ships via the default,
 * switchable anytime with one tap. Tokens are stored server-side (RLS-locked).
 */
export default function ShippingConnect({ config, pin, themeColor = '#0d9488', onConfig }) {
  const entitled = getPlanLimits(effectivePlan(config)).shipping;
  const [ship, setShip]       = useState(config.shipping || {});
  const [openForm, setOpen]   = useState(null);   // 'delhivery' | 'shadowfax' | null
  const [f, setF]             = useState({ tok: '', pincode: '', phone: '', address: '', city: '', state: '' });
  const [busy, setBusy]       = useState('');     // action id, e.g. 'connect-shadowfax'
  const [err, setErr]         = useState('');

  const active   = ship.courier || (ship.delhivery ? 'delhivery' : ship.shadowfax ? 'shadowfax' : null);
  const isConn   = (c) => (c === 'delhivery' ? Boolean(ship.delhivery) : Boolean(ship.shadowfax));
  const setField = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const resetForm = () => setF({ tok: '', pincode: '', phone: '', address: '', city: '', state: '' });
  const sync = (next) => { setShip(next); onConfig?.({ shipping: next }); clearCachedStore(config.slug); };

  async function connect(courier) {
    setErr(''); setBusy(`connect-${courier}`);
    try {
      const common = { apiToken: f.tok.trim(), pickupPincode: f.pincode.trim(), pickupAddress: f.address.trim(), pickupPhone: f.phone.trim(), pickupName: config.businessName };
      let r, patch;
      if (courier === 'shadowfax') {
        r = await connectShadowfax(config.slug, pin, { ...common, pickupCity: f.city.trim(), pickupState: f.state.trim() });
        patch = { shadowfax: true };
      } else {
        r = await connectDelhivery(config.slug, pin, common);
        patch = { delhivery: true };
      }
      sync({ ...ship, ...patch, courier, pickupPincode: r.pickupPincode, district: r.district, localPrefix: (r.pickupPincode || '').slice(0, 3) });
      resetForm(); setOpen(null);
    } catch (e) { setErr(e.message || 'Could not connect. Try again.'); }
    finally { setBusy(''); }
  }

  async function makeDefault(courier) {
    setErr(''); setBusy(`default-${courier}`);
    try {
      const r = await setActiveCourier(config.slug, pin, courier);
      sync({ ...ship, courier, pickupPincode: r.pickupPincode ?? ship.pickupPincode, district: r.district ?? ship.district, localPrefix: String(r.pickupPincode ?? ship.pickupPincode ?? '').slice(0, 3) });
    } catch (e) { setErr(e.message || 'Could not switch the default.'); }
    finally { setBusy(''); }
  }

  async function disconnect(courier) {
    setErr(''); setBusy(`disc-${courier}`);
    try {
      const r = await disconnectCourier(config.slug, pin, courier);
      sync({ ...ship, [courier]: false, courier: r.courier ?? (active === courier ? null : active) });
    } catch (e) { setErr(e.message || 'Could not disconnect.'); }
    finally { setBusy(''); }
  }

  const label = 'block text-xs font-semibold text-gray-600 mb-1.5';
  const input = 'w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-900 bg-white ' +
                'placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent';

  return (
    <div>
      <label className="block text-sm font-semibold text-gray-700 mb-1.5">
        Shipping <span className="text-gray-400 font-normal">· connect Delhivery &amp; Shadowfax, pick your default</span>
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
      ) : (
        <div className="space-y-2.5">
          {ORDER.map((courier) => {
            const connected = isConn(courier);
            const isDefault = active === courier;
            const open      = openForm === courier;
            const isSfx     = courier === 'shadowfax';
            const canConnect = f.tok.trim() && f.pincode.length === 6 && (!isSfx || (f.city.trim() && f.state.trim()));
            return (
              <div key={courier}
                className={['rounded-xl border p-3.5', isDefault ? 'border-green-300 bg-green-50' : 'border-gray-100 bg-gray-50/60'].join(' ')}>
                <div className="flex items-center gap-2">
                  <Truck size={16} className="flex-shrink-0" style={{ color: isDefault ? '#16a34a' : themeColor }} />
                  <span className="text-sm font-bold text-gray-800">{COURIERS[courier].name}</span>
                  {connected && (
                    <span className={[
                      'ml-auto text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full',
                      isDefault ? 'bg-green-600 text-white' : 'bg-gray-200 text-gray-600',
                    ].join(' ')}>
                      {isDefault ? '✓ Default' : 'Connected'}
                    </span>
                  )}
                </div>

                {connected ? (
                  <>
                    {isDefault && (
                      <p className="text-xs text-green-700/80 mt-1.5">
                        Every order ships via {COURIERS[courier].name}. Pickup from <b>{ship.pickupPincode}{ship.district ? ` · ${ship.district}` : ''}</b>.
                        {ship.localPrefix ? <> Local pincodes (starting <b>{ship.localPrefix}</b>) stay on rider dispatch.</> : null}
                      </p>
                    )}
                    <div className="flex items-center gap-3 mt-2">
                      {!isDefault && (
                        <button type="button" onClick={() => makeDefault(courier)} disabled={!!busy}
                          className="text-xs font-bold px-3 py-1.5 rounded-lg text-white active:scale-95 disabled:opacity-50"
                          style={{ background: themeColor }}>
                          {busy === `default-${courier}` ? 'Switching…' : 'Make default'}
                        </button>
                      )}
                      <button type="button" onClick={() => disconnect(courier)} disabled={!!busy}
                        className="text-xs font-semibold text-gray-400 hover:text-red-500 disabled:opacity-50">
                        {busy === `disc-${courier}` ? 'Disconnecting…' : 'Disconnect'}
                      </button>
                    </div>
                  </>
                ) : open ? (
                  <div className="mt-3 space-y-2.5">
                    <div className="flex items-start gap-2 text-xs text-gray-500">
                      <span>{COURIERS[courier].blurb}</span>
                    </div>
                    <div>
                      <label className={label}>{COURIERS[courier].name} API Token</label>
                      <input type="password" value={f.tok} onChange={(e) => setField('tok', e.target.value)}
                             placeholder={`Your ${COURIERS[courier].name} API token`} className={input} autoComplete="off" />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className={label}>Pickup PIN code</label>
                        <input type="tel" inputMode="numeric" maxLength={6} value={f.pincode}
                               onChange={(e) => setField('pincode', e.target.value.replace(/\D/g, '').slice(0, 6))}
                               placeholder="e.g. 413001" className={input} />
                      </div>
                      <div>
                        <label className={label}>Pickup phone</label>
                        <input type="tel" inputMode="numeric" maxLength={10} value={f.phone}
                               onChange={(e) => setField('phone', e.target.value.replace(/\D/g, '').slice(0, 10))}
                               placeholder="10-digit" className={input} />
                      </div>
                    </div>
                    <div>
                      <label className={label}>Pickup address</label>
                      <input type="text" value={f.address} onChange={(e) => setField('address', e.target.value)}
                             placeholder="Shop / warehouse address" className={input} />
                    </div>
                    {isSfx && (
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className={label}>Pickup city</label>
                          <input type="text" value={f.city} onChange={(e) => setField('city', e.target.value)}
                                 placeholder="e.g. Solapur" className={input} />
                        </div>
                        <div>
                          <label className={label}>Pickup state</label>
                          <input type="text" value={f.state} onChange={(e) => setField('state', e.target.value)}
                                 placeholder="e.g. Maharashtra" className={input} />
                        </div>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => connect(courier)} disabled={!!busy || !canConnect}
                        className="flex-1 py-2.5 rounded-xl text-white text-sm font-bold active:scale-[0.98] transition disabled:opacity-50"
                        style={{ background: themeColor }}>
                        {busy === `connect-${courier}` ? 'Connecting…' : `Connect ${COURIERS[courier].name}`}
                      </button>
                      <button type="button" onClick={() => { setOpen(null); resetForm(); setErr(''); }} disabled={!!busy}
                        className="text-xs font-semibold text-gray-400 px-2 disabled:opacity-50">Cancel</button>
                    </div>
                    <p className="text-[11px] text-gray-400 leading-snug flex items-start gap-1.5">
                      <ShieldCheck size={13} className="flex-shrink-0 mt-px" />
                      <span>Find your token in your {COURIERS[courier].name} dashboard / dev portal. It’s stored securely and never shown in the browser.</span>
                    </p>
                  </div>
                ) : (
                  <div className="flex items-center justify-between mt-1.5">
                    <span className="text-xs text-gray-500">{COURIERS[courier].blurb}</span>
                    <button type="button" onClick={() => { resetForm(); setOpen(courier); setErr(''); }}
                      className="flex-shrink-0 ml-2 text-xs font-bold px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:border-gray-300 active:scale-95"
                      style={{ color: themeColor }}>
                      Connect
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          {err && <p className="text-xs text-red-600">{err}</p>}
        </div>
      )}
    </div>
  );
}

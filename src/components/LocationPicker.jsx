import { useState } from 'react';
import { lookupPincode } from '../utils/pincode';
import { STATES } from '../utils/indiaLocations';

/**
 * Pincode-first location input, shared by onboarding + Manage.
 * Entering a 6-digit pincode auto-fills City, Area and State (all still editable).
 *
 * Props:
 *   values   — { pincode, city, state, area, address }
 *   onChange — (partial) => void   (merges the partial into the parent's data)
 *   accent   — brand hex for the focus ring
 */
export default function LocationPicker({ values = {}, onChange, accent = '#0d9488' }) {
  const { pincode = '', city = '', state = '', area = '', address = '' } = values;
  const [areas,  setAreas]  = useState([]);
  const [status, setStatus] = useState('idle'); // idle | loading | ok | notfound

  async function onPin(raw) {
    const pin = raw.replace(/\D/g, '').slice(0, 6);
    onChange({ pincode: pin });
    if (pin.length !== 6) { setStatus('idle'); return; }
    setStatus('loading');
    const res = await lookupPincode(pin);
    if (res && res.state) {
      setAreas(res.areas || []);
      onChange({ city: res.city || '', state: res.state || '', area: (res.areas && res.areas[0]) || '' });
      setStatus('ok');
    } else {
      setAreas([]); setStatus('notfound');
    }
  }

  const ring  = { '--tw-ring-color': `${accent}55` };
  const input = 'w-full px-3.5 py-3 rounded-xl border border-gray-200 bg-white text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:border-transparent';
  const label = 'block text-sm font-semibold text-gray-700 mb-1.5';

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label}>Pincode</label>
          <input type="tel" inputMode="numeric" maxLength={6} value={pincode} style={ring}
                 onChange={e => onPin(e.target.value)} placeholder="560001" className={input} />
          {status === 'loading'  && <p className="mt-1 text-xs text-gray-400">Looking up…</p>}
          {status === 'ok'       && <p className="mt-1 text-xs text-emerald-600 truncate">📍 {[city, state].filter(Boolean).join(', ')}</p>}
          {status === 'notfound' && <p className="mt-1 text-xs text-amber-600">Not found — fill city &amp; state below.</p>}
        </div>
        <div>
          <label className={label}>Area / Locality</label>
          {areas.length ? (
            <select value={area} style={ring} onChange={e => onChange({ area: e.target.value })} className={input}>
              {areas.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          ) : (
            <input value={area} style={ring} onChange={e => onChange({ area: e.target.value })}
                   placeholder="e.g. Koramangala" className={input} />
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={label}>City</label>
          <input value={city} style={ring} onChange={e => onChange({ city: e.target.value })}
                 placeholder="City" className={input} />
        </div>
        <div>
          <label className={label}>State</label>
          <select value={state} style={ring} onChange={e => onChange({ state: e.target.value })} className={input}>
            <option value="">Select state</option>
            {STATES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      <div>
        <label className={label}>Full Address <span className="text-gray-400 font-normal">(optional)</span></label>
        <input value={address} style={ring} onChange={e => onChange({ address: e.target.value })}
               placeholder="Shop no, street, landmark…" className={input} />
      </div>
    </div>
  );
}

// Delivery -> Settings -> India Post (Speed Post): filled once, used by every
// India Post sheet (IndiaPostSheet.jsx). Saved with the rest of Delivery
// settings, in config.delivery.indiaPost. Empty sender fields are filled from
// the shop (name, address, pickup PIN, WhatsApp number) when the sheet is made.
import { ipSettings, barcodeState, IP_DEFAULTS } from '../../utils/indiaPost';

const lCls = 'block text-xs font-semibold text-gray-700 mb-1.5';
const iCls = 'w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-200';

function Switch({ on, label, onClick, themeColor }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={onClick}
      className={['relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full p-0 transition-colors', on ? '' : 'bg-gray-200'].join(' ')}
      style={on ? { backgroundColor: themeColor } : undefined}>
      <span aria-hidden="true" className={['inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform', on ? 'translate-x-6' : 'translate-x-1'].join(' ')} />
    </button>
  );
}

export default function IndiaPostSettings({ config, update, themeColor = '#0d9488' }) {
  const dlv = config.delivery || {};
  const stored = { ...IP_DEFAULTS, ...(dlv.indiaPost || {}) };
  const filled = ipSettings(config);
  const set = (patch) => update({ delivery: { ...dlv, indiaPost: { ...(dlv.indiaPost || {}), ...patch } } });
  const setSender = (k, v) => set({ sender: { ...(stored.sender || {}), [k]: v } });
  const setBox = (k, v) => set({ box: { ...stored.box, [k]: v === '' ? '' : Math.max(1, Math.round(Number(v)) || 1) } });
  const bs = barcodeState(stored.nextBarcode);
  const pill = (on) => `flex-1 min-h-[44px] px-3 py-2 rounded-xl text-[13px] font-bold border transition ${on ? 'text-white' : 'bg-white text-gray-700 border-gray-200'}`;
  const sender = [
    ['name', 'Sender name'], ['company', 'Company (optional)'], ['line1', 'Address line 1'], ['line2', 'Address line 2'],
    ['city', 'City'], ['state', 'State'], ['pin', 'PIN'], ['mobile', 'Mobile'], ['email', 'Email (optional)'],
  ];

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-5">
      <div>
        <h3 className="text-sm font-extrabold text-gray-900">India Post (Speed Post)</h3>
        <p className="text-xs text-gray-400 mt-0.5">For the India Post sheet on Ship: PocketLink fills India Post&rsquo;s bulk-booking Excel, you upload it on the India Post portal. Fill this once.</p>
      </div>

      <div className="space-y-3">
        <p className="text-[11px] font-extrabold tracking-wider uppercase text-gray-500">From (sender)</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {sender.map(([k, t]) => (
            <div key={k} className={k === 'line1' || k === 'line2' ? 'sm:col-span-2' : ''}>
              <label className={lCls} htmlFor={`ip-s-${k}`}>{t}</label>
              <input id={`ip-s-${k}`} className={iCls} value={stored.sender?.[k] ?? ''} placeholder={filled.sender[k] || ''}
                inputMode={k === 'pin' || k === 'mobile' ? 'numeric' : undefined}
                onChange={(e) => setSender(k, k === 'pin' ? e.target.value.replace(/\D/g, '').slice(0, 6) : k === 'mobile' ? e.target.value.replace(/\D/g, '').slice(0, 10) : e.target.value)} />
            </div>
          ))}
        </div>
        <p className="text-[11px] text-gray-400">Grey text = what is used when left empty (from your shop details and courier pickup PIN).</p>
      </div>

      <div className="space-y-3">
        <p className="text-[11px] font-extrabold tracking-wider uppercase text-gray-500">Handing parcels over</p>
        <div className="flex gap-2" role="group" aria-label="Handing parcels over">
          {[['drop', 'I drop at the post office'], ['pickup', 'Post office picks up']].map(([k, t]) => (
            <button key={k} type="button" aria-pressed={stored.handover === k} onClick={() => set({ handover: k })} className={pill(stored.handover === k)} style={stored.handover === k ? { backgroundColor: themeColor, borderColor: themeColor } : undefined}>{t}</button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={lCls} htmlFor="ip-drop">Post office PIN</label><input id="ip-drop" className={iCls} inputMode="numeric" value={stored.dropPin || ''} placeholder={filled.sender.pin} onChange={(e) => set({ dropPin: e.target.value.replace(/\D/g, '').slice(0, 6) })} /></div>
          <div><label className={lCls} htmlFor="ip-office">Office ID (if India Post gave one)</label><input id="ip-office" className={iCls} value={stored.officeId || ''} placeholder="optional" onChange={(e) => set({ officeId: e.target.value.slice(0, 20) })} /></div>
        </div>
      </div>

      <div className="space-y-3">
        <p className="text-[11px] font-extrabold tracking-wider uppercase text-gray-500">Usual box (cm)</p>
        <div className="grid grid-cols-3 gap-3">
          {[['l', 'Length'], ['b', 'Breadth'], ['h', 'Height']].map(([k, t]) => (
            <div key={k}><label className={lCls} htmlFor={`ip-box-${k}`}>{t}</label><input id={`ip-box-${k}`} className={iCls} inputMode="numeric" value={stored.box?.[k] ?? ''} onChange={(e) => setBox(k, e.target.value.replace(/\D/g, ''))} /></div>
          ))}
        </div>
        <p className="text-[11px] text-gray-400">Weight comes from each product&rsquo;s packed weight plus your box weight above, as in Book courier. Any row can be changed on the sheet.</p>
      </div>

      <div className="space-y-3">
        <p className="text-[11px] font-extrabold tracking-wider uppercase text-gray-500">Barcodes from India Post</p>
        <div className="flex gap-2" role="group" aria-label="Barcodes">
          {[['series', 'Number series from the post office'], ['stickers', 'Pre-printed sticker roll']].map(([k, t]) => (
            <button key={k} type="button" aria-pressed={stored.barcodeMode === k} onClick={() => set({ barcodeMode: k })} className={pill(stored.barcodeMode === k)} style={stored.barcodeMode === k ? { backgroundColor: themeColor, borderColor: themeColor } : undefined}>{t}</button>
          ))}
        </div>
        {stored.barcodeMode === 'series' ? (
          <div>
            <label className={lCls} htmlFor="ip-next">Next barcode to use</label>
            <input id="ip-next" className={`${iCls} font-mono`} value={stored.nextBarcode || ''} placeholder="EM123456789IN" onChange={(e) => set({ nextBarcode: e.target.value.toUpperCase().replace(/\s/g, '').slice(0, 13) })} />
            <p className={`text-[11px] mt-1 font-semibold ${bs === 'ok' ? 'text-emerald-700' : bs === 'empty' ? 'text-gray-400' : 'text-red-600'}`}>
              {bs === 'ok' ? 'Right. Each sheet takes the next numbers, and this moves on by itself.' : bs === 'empty' ? 'The first barcode of the series India Post gave you.' : bs === 'digit' ? 'The last digit does not match: check the number.' : 'Looks like EM123456789IN: 2 letters, 9 digits, IN.'}
            </p>
          </div>
        ) : (
          <p className="text-[12.5px] text-gray-600">The sheet leaves the barcode empty: type the number from the sticker on each parcel. A wrong last digit is caught.</p>
        )}
      </div>

      <div className="space-y-1">
        <p className="text-[11px] font-extrabold tracking-wider uppercase text-gray-500 mb-1">On every parcel</p>
        {[['priority', 'Priority', 'PRIORITY FLAG'], ['registration', 'Registration', 'REGISTRATION'], ['otp', 'OTP-based delivery', 'The buyer tells the postman a code'], ['ack', 'Acknowledgement card (ACK)', 'A signed card comes back to you']].map(([k, t, d]) => (
          <div key={k} className="flex items-center gap-3 py-2.5 border-t border-gray-50 first:border-t-0">
            <div className="flex-1 min-w-0"><p className="text-sm font-bold text-gray-800">{t}</p><p className="text-xs text-gray-500">{d}</p></div>
            <Switch on={Boolean(stored[k])} label={t} themeColor={themeColor} onClick={() => set({ [k]: !stored[k] })} />
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 border-t border-gray-100 pt-4">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-gray-800">My India Post contract allows COD</p>
          <p className="text-xs text-gray-500">{stored.cod !== false ? 'COD orders go on the sheet with the amount to collect; India Post pays you under your contract.' : 'Off: only paid orders go by Speed Post.'}</p>
        </div>
        <Switch on={stored.cod !== false} label="My India Post contract allows COD" themeColor={themeColor} onClick={() => set({ cod: stored.cod === false })} />
      </div>
    </div>
  );
}

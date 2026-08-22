import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Truck, ArrowLeft, Package } from 'lucide-react';
import { bookShipment, getShippingRate } from '../../utils/shippingConnect';

/**
 * Two-step "Book Delhivery" modal.
 *   Step 1 — recipient & payment (pre-filled from the order, editable)
 *   Step 2 — package weight & dimensions
 * On submit it books the shipment with the edited details, so the label is
 * always correct and the weight/size are real (not the 500g default).
 */
export default function ShipBookModal({ o, slug, pin, themeColor = '#0d9488', onClose, onBooked, courier }) {
  const isSfx = String(courier || '').toLowerCase() === 'shadowfax';
  const cName = isSfx ? 'Shadowfax' : 'Delhivery';
  // pull the destination pincode out of the order (column, else from the address)
  const guessPin = () => {
    const p = String(o.pincode || '').replace(/\D/g, '');
    if (p.length === 6) return p;
    const m = String(o.destination || '').match(/\d{6}/g);
    return m ? m[m.length - 1] : '';
  };

  const [step, setStep] = useState(1);
  const [f, setF] = useState({
    name:    o.customer_name || '',
    phone:   String(o.customer_phone || '').replace(/\D/g, '').slice(-10),
    add:     o.destination || '',
    pin:     guessPin(),
    payment: o.payment_method === 'cod' ? 'COD' : 'Prepaid',
    codAmount: Math.round(Number(o.total) || 0),
    weight:  500,
    length: '', breadth: '', height: '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState('');
  const [cost, setCost] = useState(null);   // live Delhivery charge estimate (merchant's cost)

  // What Delhivery will charge the merchant for this shipment (destination pincode
  // + weight + COD/prepaid). Internal — the customer pays the store's flat fee.
  useEffect(() => {
    if (f.pin.length !== 6 || !(Number(f.weight) > 0)) { setCost(null); return; }
    let alive = true;
    setCost({ loading: true });
    const t = setTimeout(() => {
      getShippingRate(slug, f.pin, Number(f.weight), f.payment === 'COD' ? 'COD' : 'Pre-paid')
        .then((r) => { if (alive) setCost(r || { error: true }); })
        .catch(() => { if (alive) setCost({ error: true }); });
    }, 500);
    return () => { alive = false; clearTimeout(t); };
  }, [f.pin, f.weight, f.payment, slug]);

  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const label = 'block text-xs font-semibold text-gray-600 mb-1';
  const input = 'w-full px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-900 bg-white ' +
                'placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent';

  const step1Valid = f.name.trim() && f.phone.length === 10 && f.add.trim() && f.pin.length === 6;

  async function book() {
    setErr(''); setBusy(true);
    try {
      const r = await bookShipment(slug, pin, o.id, {
        name: f.name, phone: f.phone, add: f.add, pin: f.pin,
        payment_mode: f.payment,
        cod_amount: f.payment === 'COD' ? Number(f.codAmount) || 0 : 0,
        total_amount: Number(o.total) || Number(f.codAmount) || 0,
        weight: Number(f.weight) || 500,
        length: f.length, breadth: f.breadth, height: f.height,
        // The exact courier charge shown above — stored on the order so Stats →
        // Profit subtracts the real delivery cost (not a flat estimate).
        shipping_cost: cost && cost.amount != null ? Number(cost.amount) : undefined,
      });
      onBooked?.(r);
    } catch (e) {
      setErr(e.message || 'Could not book. Please try again.');
      setBusy(false);
    }
  }

  // Rendered through a portal to <body> so the fixed overlay escapes any
  // transformed ancestor (the manage tab's fade-up animation keeps a
  // `transform`, which would otherwise trap `position: fixed` inside the card —
  // making the modal render clipped/hidden, i.e. "clicking Book does nothing").
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4"
         onClick={onClose}>
      <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[92vh] overflow-y-auto"
           onClick={(e) => e.stopPropagation()}>
        {/* header */}
        <div className="flex items-center gap-2 px-5 py-3.5 border-b border-gray-100 sticky top-0 bg-white">
          <Truck size={16} style={{ color: themeColor }} />
          <p className="text-sm font-bold text-gray-900">Book {cName}</p>
          <span className="text-[11px] text-gray-400 ml-1">Step {step} of 2</span>
          <button onClick={onClose} className="ml-auto text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        {step === 1 ? (
          <div className="px-5 py-4 space-y-3">
            <p className="text-[11px] text-gray-400">Check the delivery details — edit anything that's wrong before booking.</p>
            <div>
              <label className={label}>Recipient name</label>
              <input className={input} value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Full name" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={label}>Phone</label>
                <input className={input} inputMode="numeric" maxLength={10} value={f.phone}
                       onChange={(e) => set('phone', e.target.value.replace(/\D/g, '').slice(0, 10))} placeholder="10-digit" />
              </div>
              <div>
                <label className={label}>PIN code</label>
                <input className={input} inputMode="numeric" maxLength={6} value={f.pin}
                       onChange={(e) => set('pin', e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="6-digit" />
              </div>
            </div>
            <div>
              <label className={label}>Full delivery address</label>
              <textarea rows={3} className={`${input} resize-none`} value={f.add}
                        onChange={(e) => set('add', e.target.value)} placeholder="House/flat, area, city" />
            </div>
            <div>
              <label className={label}>Payment</label>
              <div className="flex gap-2">
                {['COD', 'Prepaid'].map((p) => (
                  <button key={p} type="button" onClick={() => set('payment', p)}
                    className={['flex-1 py-2 rounded-lg border text-sm font-semibold transition',
                      f.payment === p ? 'text-white' : 'border-gray-200 text-gray-600'].join(' ')}
                    style={f.payment === p ? { backgroundColor: themeColor, borderColor: themeColor } : {}}>
                    {p === 'COD' ? '💵 Cash on Delivery' : '✅ Prepaid'}
                  </button>
                ))}
              </div>
            </div>
            {f.payment === 'COD' && (
              <div>
                <label className={label}>COD amount to collect (₹)</label>
                <input className={input} inputMode="numeric" value={f.codAmount}
                       onChange={(e) => set('codAmount', e.target.value.replace(/\D/g, ''))} />
              </div>
            )}
            <button type="button" onClick={() => setStep(2)} disabled={!step1Valid}
              className="w-full py-2.5 rounded-xl text-white text-sm font-bold active:scale-[0.98] transition disabled:opacity-50 mt-1"
              style={{ backgroundColor: themeColor }}>
              Next: Package details →
            </button>
            {!step1Valid && <p className="text-[11px] text-gray-400 text-center">Name, 10-digit phone, address &amp; 6-digit PIN are required.</p>}
          </div>
        ) : (
          <div className="px-5 py-4 space-y-3">
            <div className="flex items-center gap-1.5 text-xs text-gray-500">
              <Package size={14} style={{ color: themeColor }} /> Package weight &amp; size (for accurate courier charges)
            </div>
            <div>
              <label className={label}>Weight (grams)</label>
              <input className={input} inputMode="numeric" value={f.weight}
                     onChange={(e) => set('weight', e.target.value.replace(/\D/g, ''))} placeholder="e.g. 500" />
              <p className="text-[10px] text-gray-400 mt-1">1 kg = 1000 g. Enter the packed weight.</p>
            </div>
            <div>
              <label className={label}>Dimensions in cm <span className="text-gray-400 font-normal">· optional</span></label>
              <div className="grid grid-cols-3 gap-2">
                {[['length', 'Length'], ['breadth', 'Breadth'], ['height', 'Height']].map(([k, ph]) => (
                  <input key={k} className={input} inputMode="numeric" value={f[k]}
                         onChange={(e) => set(k, e.target.value.replace(/\D/g, ''))} placeholder={ph} />
                ))}
              </div>
            </div>
            {/* What the courier charges YOU for this shipment (your cost) */}
            {cost && (
              <div className="rounded-lg bg-gray-50 border border-gray-100 px-3 py-2 text-xs leading-snug">
                {cost.loading ? (
                  <span className="text-gray-400">Checking {cName} serviceability…</span>
                ) : cost.serviceable === false ? (
                  <span className="text-amber-700">⚠️ {cost.reason || `${cName} may not deliver to this pincode.`}</span>
                ) : cost.amount != null ? (
                  <span className="text-gray-600">
                    📦 {cName} will charge you <b className="text-gray-900">≈ ₹{cost.amount}</b>
                    {isSfx && cost.zone ? ` (${cost.zone}, flat rate + GST)` : ' for this shipment'}
                    <span className="text-gray-400"> · your cost (the customer pays your flat delivery fee)</span>
                  </span>
                ) : isSfx ? (
                  <span className="text-gray-600">✓ Deliverable via Shadowfax — you’re billed per your Shadowfax rate card (the customer pays your flat delivery fee).</span>
                ) : (
                  <span className="text-gray-400">Couldn't fetch the charge — you can still book.</span>
                )}
              </div>
            )}

            {err && <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{err}</p>}
            <div className="flex items-center gap-2 pt-1">
              <button type="button" onClick={() => { setErr(''); setStep(1); }} disabled={busy}
                className="inline-flex items-center gap-1 text-sm font-semibold text-gray-500 px-3 py-2.5 rounded-xl border border-gray-200 disabled:opacity-50">
                <ArrowLeft size={14} /> Back
              </button>
              <button type="button" onClick={book} disabled={busy || !(Number(f.weight) > 0)}
                className="flex-1 py-2.5 rounded-xl text-white text-sm font-bold active:scale-[0.98] transition disabled:opacity-50"
                style={{ backgroundColor: themeColor }}>
                {busy ? 'Booking…' : '🚚 Book Shipment'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

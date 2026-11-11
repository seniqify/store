import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Truck, ArrowLeft, Package, Bike, AlertTriangle } from 'lucide-react';
import { bookShipment, getShippingRate } from '../../utils/shippingConnect';
import { courierInfo } from '../../utils/deliveryStatus';
import { autoPickCourier, courierOptions } from '../../utils/courierChoice';
import { walletLow as readWalletLow, markWalletLow, isWalletRefusal, onWalletLowChange } from '../../utils/courierAlerts';

/**
 * Two-step "Book courier" modal.
 *   Step 1 — recipient & payment (pre-filled from the order, editable)
 *   Step 2 — package weight & dimensions, then the courier for THIS order: every
 *            connected courier is checked for the pincode (delivers? COD? price),
 *            the store's default is picked when it delivers, else the other one;
 *            or the shop's own delivery boy. Picking here never changes Settings.
 * On submit it books the shipment with the edited details, so the label is
 * always correct and the weight/size are real (not the 500g default).
 */
export default function ShipBookModal({
  o, slug, pin, themeColor = '#0d9488', onClose, onBooked,
  courier, couriers, riders = [], riderHref, onRider,
}) {
  // The store's default courier, and every courier it has connected (default first).
  const defaultCourier = courierInfo(courier).key;
  const connected = (couriers && couriers.length ? couriers : [defaultCourier])
    .slice().sort((a, b) => (a === defaultCourier ? -1 : b === defaultCourier ? 1 : 0));
  const connectedKey = connected.join(',');
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
  const [rates, setRates] = useState({});     // courier → { loading } | shipping-rate's answer | { error }
  const [chosen, setChosen] = useState(null); // the shop's own pick: a courier key or 'rider'
  const [riderPhone, setRiderPhone] = useState(riders[0]?.phone || '');
  const [lowWallet, setLowWallet] = useState(() => readWalletLow(slug));
  useEffect(() => onWalletLowChange(() => setLowWallet(readWalletLow(slug))), [slug]);

  // Each connected courier: does it deliver to this pincode, and what will it
  // charge the merchant (their cost — the customer pays the store's flat fee)?
  useEffect(() => {
    if (step !== 2 || f.pin.length !== 6 || !(Number(f.weight) > 0)) { setRates({}); return; }
    let alive = true;
    const list = connectedKey.split(',');
    setRates(Object.fromEntries(list.map((c) => [c, { loading: true }])));
    const t = setTimeout(() => {
      list.forEach((c) => {
        getShippingRate(slug, f.pin, Number(f.weight), f.payment === 'COD' ? 'COD' : 'Pre-paid', c)
          .then((r) => { if (alive) setRates((s) => ({ ...s, [c]: r || { error: true } })); })
          .catch(() => { if (alive) setRates((s) => ({ ...s, [c]: { error: true } })); });
      });
    }, 500);
    return () => { alive = false; clearTimeout(t); };
  }, [step, f.pin, f.weight, f.payment, slug, connectedKey]);

  // What each courier can do for this order, and which one to start on.
  const options = courierOptions(connected, rates, f.payment, defaultCourier, lowWallet);
  const usable = options.filter((x) => x.usable);
  const autoPick = autoPickCourier(options);
  const anyLoading = options.some((x) => x.loading);
  const pick = chosen === 'rider' || usable.some((x) => x.key === chosen) ? chosen : autoPick;
  const pickOpt = options.find((x) => x.key === pick);
  const cheapest = usable.filter((x) => x.amount != null).sort((a, b) => a.amount - b.amount)[0];
  const defaultOpt = options.find((x) => x.isDefault);
  const defaultSkipped = defaultOpt && !defaultOpt.loading && !defaultOpt.usable && autoPick && autoPick !== defaultOpt.key;
  const noCourier = !anyLoading && usable.length === 0;
  const riderName = riders.find((r) => r.phone === riderPhone)?.name || 'your delivery boy';

  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const label = 'block text-xs font-semibold text-gray-600 mb-1';
  const input = 'w-full px-3 py-2 rounded-lg border border-gray-200 text-sm text-gray-900 bg-white ' +
                'placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent';

  const step1Valid = f.name.trim() && f.phone.length === 10 && f.add.trim() && f.pin.length === 6;

  async function book() {
    if (!pickOpt) return;
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
        shipping_cost: pickOpt.amount != null ? pickOpt.amount : undefined,
      }, pickOpt.key);
      onBooked?.({ ...r, courier: r.courier || pickOpt.key });
    } catch (e) {
      if (isWalletRefusal(e.message)) markWalletLow(slug, pickOpt.key, e.message);
      setErr(e.message || 'Could not book. Please try again.');
      setBusy(false);
    }
  }

  const priceText = (x) => (x.amount != null ? `${x.estimate ? '≈ ' : ''}₹${x.amount}` : '');
  const statusText = (x) => {
    if (x.noWallet) return `${x.name} wallet is low · recharge first`;
    if (x.loading) return 'Checking…';
    if (x.off) return `Doesn't deliver to ${f.pin}`;
    if (x.noCod) return 'No cash on delivery here';
    if (x.unchecked) return "Couldn't check right now — you can still book";
    return f.payment === 'COD' ? 'Delivers · Cash on delivery OK' : 'Delivers';
  };
  const cardCls = (on, enabled) => [
    'w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-left transition',
    on ? 'border-2' : 'border-gray-200',
    enabled ? 'bg-white active:scale-[0.99]' : 'opacity-60 cursor-not-allowed',
  ].join(' ');
  const radio = (on) => (
    <span className="w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0"
          style={{ borderColor: on ? themeColor : '#d1d5db' }}>
      {on && <span className="w-2 h-2 rounded-full" style={{ backgroundColor: themeColor }} />}
    </span>
  );

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
        <div className="flex items-center gap-2 px-5 py-3.5 border-b border-gray-100 sticky top-0 bg-white z-10">
          <Truck size={16} style={{ color: themeColor }} />
          <p className="text-sm font-bold text-gray-900">Book courier</p>
          <span className="text-[11px] text-gray-400 ml-1">Step {step} of 2</span>
          <button onClick={onClose} aria-label="Close" className="ml-auto text-gray-400 hover:text-gray-600"><X size={18} /></button>
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
              Next: Package &amp; courier →
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

            {/* Who delivers THIS order */}
            <div className="space-y-2 pt-1">
              <p className={label}>Choose courier for PIN {f.pin}</p>
              {defaultSkipped && (
                <p className="flex items-start gap-1.5 text-[11.5px] leading-snug text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-2">
                  <AlertTriangle size={13} className="flex-shrink-0 mt-px" />
                  <span>{defaultOpt.name} (your default) {defaultOpt.noWallet ? 'needs a wallet recharge first' : defaultOpt.noCod ? "can't take cash on delivery here" : `doesn't deliver to ${f.pin}`}, so {courierInfo(autoPick).name} is picked for this order.</span>
                </p>
              )}
              {options.map((x) => {
                const on = pick === x.key;
                const cheaper = cheapest && cheapest.key === x.key && usable.length > 1 && !x.isDefault
                  && defaultOpt?.usable && defaultOpt.amount != null && defaultOpt.amount > x.amount
                  ? defaultOpt.amount - x.amount : 0;
                return (
                  <button key={x.key} type="button" disabled={!x.usable} aria-pressed={on}
                    onClick={() => setChosen(x.key)} className={cardCls(on, x.usable)}
                    style={on ? { borderColor: themeColor } : undefined}>
                    {radio(on)}
                    <span className={`w-8 h-8 rounded-lg flex items-center justify-center text-[13px] font-extrabold flex-shrink-0 ${x.chip}`}>{x.name[0]}</span>
                    <span className="flex-1 min-w-0">
                      <span className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[13.5px] font-bold text-gray-900">{x.name}</span>
                        {x.isDefault && <span className="text-[10px] font-semibold text-gray-600 bg-gray-100 rounded-full px-1.5 py-0.5">Your default</span>}
                        {cheaper > 0 && <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 rounded-full px-1.5 py-0.5">₹{cheaper} cheaper</span>}
                      </span>
                      <span className={`block text-[11.5px] ${x.usable && !x.unchecked ? 'text-emerald-700' : x.loading || x.unchecked ? 'text-gray-500' : 'text-rose-700'}`}>{statusText(x)}</span>
                    </span>
                    {x.usable && x.amount != null && (
                      <span className="text-right flex-shrink-0">
                        <span className="block text-[15px] font-extrabold text-gray-900 tabular-nums">{priceText(x)}</span>
                        <span className="block text-[10px] text-gray-400">{x.estimate ? 'rate-card estimate' : 'live price'}</span>
                      </span>
                    )}
                  </button>
                );
              })}

              {noCourier && (
                <div className="rounded-xl bg-rose-50 border border-rose-100 px-3 py-2.5 space-y-2">
                  <p className="text-[12.5px] font-bold text-rose-800">{connected.length > 1 ? 'Neither of your couriers delivers here' : `${courierInfo(connected[0]).name} doesn't deliver here`}</p>
                  <p className="text-[11.5px] text-rose-800 leading-snug">Check the PIN with the customer first — a wrong digit is the usual reason. Or send it with your own delivery boy.</p>
                  <button type="button" onClick={() => { setErr(''); setStep(1); }}
                    className="w-full h-10 rounded-lg border border-rose-200 bg-white text-[12.5px] font-bold text-rose-800">Edit the PIN code</button>
                </div>
              )}

              {/* The shop's own delivery boy: no courier, no fee */}
              <p className="text-[11px] font-semibold text-gray-500 pt-1">Deliver yourself</p>
              <button type="button" aria-pressed={pick === 'rider'} onClick={() => setChosen('rider')}
                className={cardCls(pick === 'rider', true)} style={pick === 'rider' ? { borderColor: themeColor } : undefined}>
                {radio(pick === 'rider')}
                <span className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${courierInfo('local').chip}`}><Bike size={16} /></span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[13.5px] font-bold text-gray-900">Your delivery boy</span>
                  <span className="block text-[11.5px] text-gray-500">{riders.length ? 'Opens WhatsApp with the address filled in' : 'Opens WhatsApp — pick your delivery boy'}</span>
                </span>
                <span className="text-right flex-shrink-0">
                  <span className="block text-[15px] font-extrabold text-gray-900">₹0</span>
                  <span className="block text-[10px] text-gray-400">no courier fee</span>
                </span>
              </button>
              {pick === 'rider' && riders.length > 1 && (
                <div className="flex items-center gap-1.5 flex-wrap pl-7">
                  {riders.map((r) => (
                    <button key={r.phone} type="button" aria-pressed={riderPhone === r.phone} onClick={() => setRiderPhone(r.phone)}
                      className={['h-8 px-3 rounded-full border text-xs font-semibold', riderPhone === r.phone ? 'text-white' : 'border-gray-200 text-gray-700'].join(' ')}
                      style={riderPhone === r.phone ? { backgroundColor: themeColor, borderColor: themeColor } : undefined}>
                      {r.name || `+91 ${r.phone}`}
                    </button>
                  ))}
                </div>
              )}
              <p className="text-[10.5px] text-gray-400">Picking here is for this order only — your default courier in Settings stays the same.</p>
            </div>

            {err && <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{err}</p>}
            <div className="flex items-center gap-2 pt-1">
              <button type="button" onClick={() => { setErr(''); setStep(1); }} disabled={busy}
                className="inline-flex items-center gap-1 text-sm font-semibold text-gray-500 px-3 py-2.5 rounded-xl border border-gray-200 disabled:opacity-50">
                <ArrowLeft size={14} /> Back
              </button>
              {pick === 'rider' ? (
                <a href={riderHref ? riderHref(riderPhone || null) : undefined} target="_blank" rel="noopener noreferrer"
                  onClick={() => onRider?.()}
                  className="flex-1 py-2.5 rounded-xl text-white text-sm font-bold text-center active:scale-[0.98] transition"
                  style={{ backgroundColor: themeColor }}>
                  🛵 Send to {riders.length ? riderName : 'delivery boy'}
                </a>
              ) : (
                <button type="button" onClick={book} disabled={busy || !pickOpt || !(Number(f.weight) > 0)}
                  className="flex-1 py-2.5 rounded-xl text-white text-sm font-bold active:scale-[0.98] transition disabled:opacity-50"
                  style={{ backgroundColor: themeColor }}>
                  {busy ? 'Booking…' : pickOpt ? `🚚 Book ${pickOpt.name}${pickOpt.amount != null ? ` · ${priceText(pickOpt)}` : ''}` : anyLoading ? 'Checking couriers…' : 'Choose a courier'}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

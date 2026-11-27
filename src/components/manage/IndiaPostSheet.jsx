// Delivery -> Ship -> "Make an India Post sheet" (founder, 2026-11-27).
// India Post's office did not take up the API, so the shop books Speed Post by
// uploading India Post's bulk-booking Excel on the India Post portal. Here the
// shop ticks orders, checks the filled sheet (every column from the order and
// Delivery -> Settings -> India Post), downloads it, and after uploading marks
// the parcels shipped: the barcode becomes the tracking number and the buyer's
// WhatsApp "shipped" update goes out as for any courier.
// IndiaPostParcel is the small India Post block on an order card and in Track.
import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { X, ArrowLeft, Download, Check, ExternalLink, Truck, AlertTriangle, Trash2 } from 'lucide-react';
import { fetchOrders, indiaPostMarkShipped, indiaPostSetState } from '../../utils/orderService';
import { orderStage } from '../../utils/orderCard';
import { orderWeight } from '../../utils/orderWeight';
import { lookupPincode } from '../../utils/pincode';
import { formatINR } from '../../utils/currency';
import { useScrollLock } from '../../hooks/useScrollLock';
import {
  ipSettings, settingsProblems, orderPin, sheetRows, rowProblems, duplicateBarcodes, sheetCells, sheetFileName, refBaseOf,
  nextSerial, makeBarcode, barcodeParts, IP_TRACK_URL,
} from '../../utils/indiaPost';
import { xlsxBytes, downloadXlsx } from '../../utils/xlsxWrite';

const inputCls = (bad) => `w-full h-10 rounded-xl border px-3 text-[14px] bg-white focus:outline-none focus:ring-2 focus:ring-gray-200 ${bad ? 'border-red-400' : 'border-gray-200'}`;
const SKIP = {
  barcode: 'barcode not valid', 'not found': 'order not found', 'not to ship': 'cancelled or already delivered',
  'already booked': 'already booked with another courier', 'already marked': 'already marked', 'barcode used': 'barcode already used', 'bad order': 'order not found',
};

export default function IndiaPostSheet({ slug, pin, config, themeColor = '#0d9488', onClose, onSaveIp, onOpenSettings }) {
  useScrollLock(true);
  const ip = useMemo(() => ipSettings(config), [config]);
  const setupMissing = settingsProblems(ip);
  const [orders, setOrders] = useState(null);
  const [step, setStep] = useState('pick');
  const [picked, setPicked] = useState(() => new Set());
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [result, setResult] = useState(null);
  const [file, setFile] = useState('');

  useEffect(() => {
    let alive = true;
    fetchOrders(slug, pin).then((list) => { if (alive) setOrders(list || []); });
    return () => { alive = false; };
  }, [slug, pin]);

  const toShip = useMemo(() => (orders || []).filter((o) => orderStage(o) === 'to_ship' && orderPin(o)), [orders]);
  const pickedOrders = toShip.filter((o) => picked.has(o.id));
  const codOrders = pickedOrders.filter((o) => String(o.payment_method).toLowerCase() === 'cod' && !o.paid);
  const toggle = (id) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allOn = toShip.length > 0 && picked.size === toShip.length;

  async function toSheet() {
    setErr(''); setBusy('check');
    const pins = [...new Set(pickedOrders.map(orderPin))];
    const place = {};
    // City (district) and state from India Post's PIN directory; a slow answer is skipped.
    await Promise.race([
      Promise.all(pins.map(async (p) => { const r = await lookupPincode(p); if (r?.state) place[p] = { city: r.city, state: r.state }; })),
      new Promise((res) => setTimeout(res, 5000)),
    ]);
    const next = ip.barcodeMode === 'series' ? nextSerial(ip, orders || []) : null;
    const withNext = next ? { ...ip, nextBarcode: makeBarcode(next.prefix, next.serial) } : ip;
    const products = config?.products || [];
    const boxG = config?.delivery?.boxWeightG || 0;
    setRows(sheetRows(pickedOrders, withNext, { grams: (o) => orderWeight(o.items, products, { boxG }).grams, place, codAllowed: ip.cod !== false }));
    setBusy(''); setStep('check');
  }

  const dups = duplicateBarcodes(rows);
  const problems = rows.map((r) => ({ ...rowProblems(r), ...(dups.has(String(r.barcode).toUpperCase().replace(/\s/g, '')) ? { barcode: 'The same barcode is on two parcels' } : {}) }));
  const problemCount = problems.reduce((a, p) => a + Object.keys(p).length, 0);
  const setRow = (i, patch) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const dropRow = (i) => setRows((rs) => rs.filter((_, j) => j !== i));

  async function download() {
    if (problemCount || setupMissing.length || !rows.length) return;
    setErr(''); setBusy('download');
    try {
      const cells = sheetCells(rows, ip, { refBase: refBaseOf() });
      const name = sheetFileName(config?.businessName || slug);
      downloadXlsx(name, xlsxBytes(cells, { widths: cells[0].map((c) => Math.max(10, String(c.v).length + 2)) }));
      setFile(name);
      // The next sheet starts after the highest barcode used here.
      if (ip.barcodeMode === 'series') {
        const top = rows.map((r) => barcodeParts(r.barcode)).filter(Boolean).reduce((a, p) => (!a || p.serial > a.serial ? p : a), null);
        const saved = barcodeParts(ip.nextBarcode);
        if (top && (!saved || top.prefix !== saved.prefix || top.serial >= saved.serial)) {
          await onSaveIp?.({ nextBarcode: makeBarcode(top.prefix, top.serial + 1) });
        }
      }
      setStep('done');
    } catch (e) {
      setErr(e.message || 'Could not make the file.');
    } finally { setBusy(''); }
  }

  async function markShipped() {
    setErr(''); setBusy('mark');
    try {
      const r = await indiaPostMarkShipped(slug, pin, rows.map((x) => ({ order_id: x.orderId, barcode: String(x.barcode).toUpperCase().replace(/\s/g, '') })));
      setResult(r);
    } catch (e) {
      setErr(e.message);
    } finally { setBusy(''); }
  }

  const head = step === 'pick' ? 'Make an India Post sheet' : step === 'check' ? `India Post sheet · ${rows.length} ${rows.length === 1 ? 'parcel' : 'parcels'}` : 'Sheet downloaded';
  const btnStyle = { backgroundColor: themeColor };

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/40" onClick={() => onClose?.(Boolean(result?.shipped))}>
      <div role="dialog" aria-modal="true" aria-label={head} className="bg-gray-50 w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[94vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 pt-4 pb-3 border-b border-gray-100 bg-white rounded-t-2xl flex items-center gap-2">
          {step === 'check' && (
            <button type="button" onClick={() => setStep('pick')} aria-label="Back" className="w-9 h-9 grid place-items-center rounded-full border border-gray-200 text-gray-600"><ArrowLeft size={16} /></button>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-[17px] font-extrabold text-gray-900 leading-tight">{head}</p>
            <p className="text-[12px] text-gray-500 mt-0.5">Speed Post · upload it on the India Post portal</p>
          </div>
          <button type="button" onClick={() => onClose?.(Boolean(result?.shipped))} aria-label="Close" className="w-9 h-9 grid place-items-center rounded-full border border-gray-200 text-gray-500"><X size={16} /></button>
        </div>

        <div className="overflow-y-auto overscroll-contain px-4 py-4 space-y-3 flex-1">
          {setupMissing.length > 0 && step !== 'done' && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3.5 flex gap-2.5 items-start">
              <AlertTriangle size={17} className="text-amber-700 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-[13.5px] font-extrabold text-amber-900">Set up India Post once</p>
                <p className="text-[12.5px] text-amber-900 mt-0.5">Missing: {setupMissing.join(', ')}.</p>
                <button type="button" onClick={onOpenSettings} className="mt-2 h-9 px-3 rounded-lg bg-white border border-amber-300 text-[12.5px] font-bold text-amber-900">Open Delivery settings</button>
              </div>
            </div>
          )}

          {step === 'pick' && (
            orders === null ? <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-16 rounded-xl bg-gray-100 animate-pulse" />)}</div>
            : !toShip.length ? <p className="text-center text-sm text-gray-500 py-10">No order is waiting to be shipped.</p>
            : (
              <>
                <div className="flex items-center justify-between px-1">
                  <p className="text-[13px] font-bold text-gray-900">Tick the orders going by Speed Post</p>
                  <button type="button" onClick={() => setPicked(allOn ? new Set() : new Set(toShip.map((o) => o.id)))} className="text-[12.5px] font-bold" style={{ color: themeColor }}>{allOn ? 'Clear' : 'Select all'}</button>
                </div>
                <ul className="space-y-2 list-none m-0 p-0">
                  {toShip.map((o) => {
                    const on = picked.has(o.id);
                    const cod = String(o.payment_method).toLowerCase() === 'cod' && !o.paid;
                    return (
                      <li key={o.id}>
                        <button type="button" onClick={() => toggle(o.id)} aria-pressed={on}
                          className="w-full text-left bg-white rounded-2xl border p-3 flex items-start gap-3" style={on ? { borderColor: themeColor, boxShadow: `0 0 0 1px ${themeColor}` } : { borderColor: '#e5e7eb' }}>
                          <span aria-hidden="true" className="w-6 h-6 mt-0.5 rounded-md grid place-items-center flex-shrink-0 border-2" style={on ? { backgroundColor: themeColor, borderColor: themeColor, color: '#fff' } : { borderColor: '#9ca3af', color: 'transparent' }}><Check size={14} strokeWidth={3} /></span>
                          <span className="flex-1 min-w-0">
                            <span className="block text-[14.5px] font-extrabold text-gray-900 truncate">{o.customer_name || 'Customer'}</span>
                            <span className="block text-[12px] text-gray-500 truncate">{o.destination || orderPin(o)}</span>
                          </span>
                          <span className="text-right flex-shrink-0">
                            <span className="block text-[14px] font-extrabold text-gray-900">{formatINR(o.total || 0)}</span>
                            <span className={`inline-block mt-0.5 text-[11px] font-bold px-2 py-0.5 rounded-full ${cod ? 'bg-amber-100 text-amber-900' : 'bg-emerald-100 text-emerald-800'}`}>{cod ? 'COD' : 'Paid'}</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {ip.cod === false && codOrders.length > 0 && (
                  <p className="text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">COD by Speed Post needs an India Post contract. Turn it on in Settings if you have one, or untick the COD orders.</p>
                )}
              </>
            )
          )}

          {step === 'check' && (
            <>
              <div className="bg-white rounded-2xl border border-gray-100 p-3 text-[12.5px] text-gray-700 flex gap-3 items-start">
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-extrabold tracking-wider uppercase text-gray-500">From (every row)</p>
                  <p className="font-bold text-gray-900 mt-1">{ip.sender.name} · {ip.sender.mobile}</p>
                  <p>{[ip.sender.line1, ip.sender.line2, ip.sender.city, ip.sender.state, ip.sender.pin].filter(Boolean).join(', ')}</p>
                  <p className="text-gray-500 mt-0.5">{ip.handover === 'pickup' ? 'Post office picks up' : `Drop off at the post office (${ip.dropPin || ip.sender.pin})`} · box {ip.box.l} × {ip.box.b} × {ip.box.h} cm</p>
                </div>
                <button type="button" onClick={onOpenSettings} className="text-[12.5px] font-bold flex-shrink-0" style={{ color: themeColor }}>Change</button>
              </div>
              {rows.map((r, i) => {
                const p = problems[i];
                const bad = Object.keys(p).length > 0;
                const id = `r${i}`;
                return (
                  <div key={r.orderId} className={`bg-white rounded-2xl border p-3 space-y-2.5 ${bad ? 'border-red-300' : 'border-gray-100'}`}>
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-[14.5px] font-extrabold text-gray-900">{i + 1}. {r.name || 'Customer'}</p>
                        <p className="text-[12px] text-gray-500">{r.cod ? `COD ${formatINR(r.codValue)} to collect` : r.codBlocked ? 'COD: needs an India Post contract' : 'Paid: nothing to collect'}</p>
                      </div>
                      <button type="button" onClick={() => dropRow(i)} aria-label={`Take ${r.name || 'this order'} off the sheet`} className="w-9 h-9 grid place-items-center rounded-lg text-gray-400 hover:bg-gray-50"><Trash2 size={15} /></button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="col-span-2"><label className="block text-[11.5px] font-bold text-gray-600 mb-1" htmlFor={`ip-a1-${id}`}>Address line 1</label><input id={`ip-a1-${id}`} className={inputCls(p.line1)} value={r.line1} onChange={(e) => setRow(i, { line1: e.target.value })} /></div>
                      <div className="col-span-2"><label className="block text-[11.5px] font-bold text-gray-600 mb-1" htmlFor={`ip-a2-${id}`}>Address line 2</label><input id={`ip-a2-${id}`} className={inputCls(false)} value={r.line2} onChange={(e) => setRow(i, { line2: e.target.value })} /></div>
                      <div><label className="block text-[11.5px] font-bold text-gray-600 mb-1" htmlFor={`ip-c-${id}`}>City</label><input id={`ip-c-${id}`} className={inputCls(p.city)} value={r.city} onChange={(e) => setRow(i, { city: e.target.value.toUpperCase() })} /></div>
                      <div><label className="block text-[11.5px] font-bold text-gray-600 mb-1" htmlFor={`ip-s-${id}`}>State</label><input id={`ip-s-${id}`} className={inputCls(p.state)} value={r.state} onChange={(e) => setRow(i, { state: e.target.value.toUpperCase() })} /></div>
                      <div><label className="block text-[11.5px] font-bold text-gray-600 mb-1" htmlFor={`ip-p-${id}`}>PIN</label><input id={`ip-p-${id}`} inputMode="numeric" className={inputCls(p.pin)} value={r.pin} onChange={(e) => setRow(i, { pin: e.target.value.replace(/\D/g, '').slice(0, 6) })} /></div>
                      <div><label className="block text-[11.5px] font-bold text-gray-600 mb-1" htmlFor={`ip-m-${id}`}>Mobile</label><input id={`ip-m-${id}`} inputMode="numeric" className={inputCls(p.mobile)} value={r.mobile} onChange={(e) => setRow(i, { mobile: e.target.value.replace(/\D/g, '').slice(0, 10) })} /></div>
                      <div><label className="block text-[11.5px] font-bold text-gray-600 mb-1" htmlFor={`ip-b-${id}`}>Barcode</label><input id={`ip-b-${id}`} className={`${inputCls(p.barcode)} font-mono`} value={r.barcode} placeholder="EM123456789IN" onChange={(e) => setRow(i, { barcode: e.target.value.toUpperCase() })} /></div>
                      <div><label className="block text-[11.5px] font-bold text-gray-600 mb-1" htmlFor={`ip-w-${id}`}>Weight (g)</label><input id={`ip-w-${id}`} inputMode="numeric" className={inputCls(p.weight)} value={r.weight} onChange={(e) => setRow(i, { weight: e.target.value.replace(/\D/g, '') })} /></div>
                      <div className="col-span-2 grid grid-cols-3 gap-2">
                        {[['l', 'Length (cm)'], ['b', 'Breadth (cm)'], ['h', 'Height (cm)']].map(([k, t]) => (
                          <div key={k}><label className="block text-[11.5px] font-bold text-gray-600 mb-1" htmlFor={`ip-d${k}-${id}`}>{t}</label><input id={`ip-d${k}-${id}`} inputMode="numeric" className={inputCls(p.size && !(Number(r[k]) > 0))} value={r[k]} onChange={(e) => setRow(i, { [k]: e.target.value.replace(/\D/g, '').slice(0, 3) })} /></div>
                        ))}
                      </div>
                    </div>
                    {bad && <ul className="m-0 pl-4 text-[12px] text-red-700 font-semibold space-y-0.5">{Object.values(p).map((t) => <li key={t}>{t}</li>)}</ul>}
                  </div>
                );
              })}
            </>
          )}

          {step === 'done' && (
            <div className="space-y-3">
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 space-y-3">
                <p className="text-[14.5px] font-extrabold text-emerald-900">Downloaded {file}</p>
                <ol className="m-0 pl-5 space-y-2 text-[13px] text-emerald-950 leading-relaxed">
                  <li>Upload it on the India Post portal (bulk booking). <a href={IP_TRACK_URL} target="_blank" rel="noopener noreferrer" className="font-bold underline">Open India Post</a></li>
                  <li>Stick each barcode on its parcel and {ip.handover === 'pickup' ? 'hand them to the postman at pickup' : `drop them at your post office (${ip.dropPin || ip.sender.pin})`}.</li>
                  <li>Then mark them shipped here: each buyer gets the WhatsApp update with the tracking number.</li>
                </ol>
              </div>
              {result ? (
                <div className="rounded-2xl border border-gray-100 bg-white p-4 space-y-2">
                  <p className="text-[14px] font-extrabold text-gray-900">{result.shipped} {result.shipped === 1 ? 'parcel' : 'parcels'} marked shipped by India Post.</p>
                  {(result.skipped || []).length > 0 && (
                    <ul className="m-0 pl-4 text-[12.5px] text-amber-800 space-y-0.5">
                      {result.skipped.map((s) => { const r = rows.find((x) => x.orderId === s.order_id); return <li key={s.order_id}>{r?.name || 'An order'}: {SKIP[s.reason] || s.reason}</li>; })}
                    </ul>
                  )}
                  <p className="text-[12px] text-gray-500">They are in Track now. India Post is not linked, so mark each one Delivered or Came back there.</p>
                </div>
              ) : null}
            </div>
          )}
          {err && <p className="text-[12.5px] text-red-600 font-semibold">{err}</p>}
        </div>

        <div className="border-t border-gray-100 bg-white px-4 py-3 rounded-b-2xl space-y-1.5">
          {step === 'pick' && (
            <>
              <p className="text-[12px] text-gray-500 text-center">{picked.size ? `${picked.size} ${picked.size === 1 ? 'order' : 'orders'}${codOrders.length ? ` · ${codOrders.length} COD ${formatINR(codOrders.reduce((a, o) => a + (Number(o.total) || 0), 0))}` : ''}` : 'Tick at least one order'}</p>
              <button type="button" disabled={!picked.size || busy === 'check' || (ip.cod === false && codOrders.length > 0)} onClick={toSheet}
                className="w-full h-12 rounded-xl text-white text-[15px] font-extrabold disabled:opacity-50" style={btnStyle}>{busy === 'check' ? 'Filling the sheet…' : 'Next: check the sheet'}</button>
            </>
          )}
          {step === 'check' && (
            <>
              <p className={`text-[12px] font-bold text-center ${problemCount || setupMissing.length ? 'text-red-600' : 'text-emerald-700'}`}>
                {setupMissing.length ? `Finish the India Post setup first: ${setupMissing.join(', ')}.` : problemCount ? `Fix ${problemCount} ${problemCount === 1 ? 'thing' : 'things'} in red, then download.` : `All 48 columns filled for ${rows.length} ${rows.length === 1 ? 'parcel' : 'parcels'}.`}
              </p>
              <button type="button" disabled={!!problemCount || setupMissing.length > 0 || !rows.length || busy === 'download'} onClick={download}
                className="w-full h-12 rounded-xl text-white text-[15px] font-extrabold inline-flex items-center justify-center gap-2 disabled:opacity-50" style={btnStyle}>
                <Download size={17} /> {busy === 'download' ? 'Making the file…' : 'Download Excel (.xlsx)'}
              </button>
            </>
          )}
          {step === 'done' && (
            result ? (
              <button type="button" onClick={() => onClose?.(true)} className="w-full h-12 rounded-xl text-white text-[15px] font-extrabold" style={btnStyle}>Done</button>
            ) : (
              <>
                <button type="button" disabled={busy === 'mark'} onClick={markShipped} className="w-full h-12 rounded-xl text-white text-[15px] font-extrabold inline-flex items-center justify-center gap-2 disabled:opacity-50" style={btnStyle}>
                  <Truck size={17} /> {busy === 'mark' ? 'Saving…' : `Mark ${rows.length} shipped by India Post`}
                </button>
                <button type="button" onClick={download} className="w-full h-10 rounded-xl border border-gray-200 bg-white text-[13px] font-bold text-gray-700">Download again</button>
              </>
            )
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** India Post parcel on an order card or in Track: tracking number and the shop's own Delivered / Came back. */
export function IndiaPostParcel({ o, slug, pin, themeColor = '#0d9488', onChanged }) {
  const [state, setState] = useState(o.shipment_status || 'In Transit');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState(false);
  const open = state === 'In Transit';
  const set = async (kind) => {
    const ask = kind === 'delivered' ? 'Mark this parcel delivered? A COD order then counts as paid.' : 'Mark this parcel as came back to you?';
    if (!window.confirm(ask)) return;
    setBusy(kind); setErr('');
    try { const s = await indiaPostSetState(slug, pin, o.id, kind); setState(s); onChanged?.(s); } catch (e) { setErr(e.message); } finally { setBusy(''); }
  };
  const copy = async () => { try { await navigator.clipboard.writeText(o.awb); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ } };
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50/70 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[13px] font-bold text-gray-900"><Truck size={15} style={{ color: themeColor }} /> India Post · Speed Post</span>
        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${state === 'Delivered' ? 'bg-emerald-100 text-emerald-800' : open ? 'bg-blue-100 text-blue-800' : 'bg-red-100 text-red-800'}`}>{state === 'Delivered' ? 'Delivered' : open ? 'With India Post' : 'Came back'}</span>
      </div>
      <div className="flex items-center gap-2">
        <button type="button" onClick={copy} className="flex-1 min-w-0 h-9 px-3 rounded-lg bg-white border border-gray-200 text-left text-[13px] font-mono font-bold text-gray-900 truncate" title="Copy the tracking number">{copied ? 'Copied' : o.awb}</button>
        <a href={IP_TRACK_URL} target="_blank" rel="noopener noreferrer" className="h-9 px-3 rounded-lg bg-white border border-gray-200 text-[12px] font-bold text-gray-700 inline-flex items-center gap-1"><ExternalLink size={12} /> Track</a>
      </div>
      {open && (
        <>
          <div className="flex gap-2">
            <button type="button" disabled={!!busy} onClick={() => set('delivered')} className="flex-1 h-9 rounded-lg bg-white border border-gray-200 text-[12px] font-bold text-gray-700 disabled:opacity-50">{busy === 'delivered' ? '…' : 'Mark delivered'}</button>
            <button type="button" disabled={!!busy} onClick={() => set('returned')} className="flex-1 h-9 rounded-lg bg-white border border-gray-200 text-[12px] font-bold text-gray-700 disabled:opacity-50">{busy === 'returned' ? '…' : 'Came back'}</button>
          </div>
          <p className="text-[11px] text-gray-500 leading-snug">India Post is not linked to PocketLink: check its tracking page with this number, then mark it here.</p>
        </>
      )}
      {err && <p className="text-[11.5px] text-red-600">{err}</p>}
    </div>
  );
}

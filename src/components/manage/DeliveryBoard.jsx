import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle, Truck, Bike, Package, Check, X, Phone, MapPin,
  ChevronRight, ExternalLink, RefreshCw, MessageCircle, PackageOpen,
} from 'lucide-react';
import { fetchOrders } from '../../utils/orderService';
import { shipmentOp } from '../../utils/shippingConnect';
import { formatINR } from '../../utils/currency';
import { classifyBucket, BUCKET_META, BUCKETS, prettyStatus, courierInfo } from '../../utils/deliveryStatus';

const BUCKET_ICON = { attention: AlertTriangle, ofd: Bike, transit: Truck, pickup: Package, delivered: Check };

// UTC courier timestamp → readable IST ("27 Aug, 11:16 AM")
function fmtTs(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d)) return '';
  try {
    return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
  } catch { return d.toLocaleString(); }
}

const digits = (p) => String(p || '').replace(/\D/g, '');
const last10 = (p) => digits(p).slice(-10);

// wa.me link that sends the customer their live tracking link, from the owner's number.
function trackWaLink(o, trackUrl, storeName) {
  const phone = last10(o.customer_phone);
  if (!phone || !trackUrl) return null;
  const name = o.customer_name?.trim() || 'there';
  const at = storeName ? ` from ${storeName}` : '';
  const msg = `Hi ${name}, your order${at} is on its way! 📦\nTrack it live here: ${trackUrl}\n\nThank you! 🙏`;
  return `https://wa.me/91${phone}?text=${encodeURIComponent(msg)}`;
}

export default function DeliveryBoard({ slug, pin, themeColor = '#0d9488', storeName = '' }) {
  const [orders, setOrders]       = useState(null);   // null = loading
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter]       = useState('all');
  const [active, setActive]       = useState(null);   // order open in the drawer

  const load = useCallback(async (silent) => {
    if (!silent) setOrders(null); else setRefreshing(true);
    try {
      const rows = await fetchOrders(slug, pin);
      // Only booked shipments belong on the board (they carry an AWB).
      setOrders((rows || []).filter((o) => o.awb));
    } finally { setRefreshing(false); }
  }, [slug, pin]);

  useEffect(() => { load(false); }, [load]);

  // Group into buckets.
  const groups = {};
  BUCKETS.forEach((b) => { groups[b] = []; });
  (orders || []).forEach((o) => {
    const b = classifyBucket(o);
    (groups[b] || (groups[b] = [])).push(o);
  });
  const count = (b) => (groups[b] || []).length;
  const total = (orders || []).length;

  const codToCollect = (orders || [])
    .filter((o) => o.payment_method === 'cod' && !['delivered', 'cancelled'].includes(classifyBucket(o)))
    .reduce((n, o) => n + (Number(o.total) || 0), 0);

  const stat = 'bg-white rounded-2xl border border-gray-100 shadow-sm px-3.5 py-3';

  return (
    <div className="max-w-3xl mx-auto">
      {/* summary */}
      <div className="grid grid-cols-2 gap-2.5 mb-3">
        <div className={`${stat} ${count('attention') ? 'border-red-100 bg-gradient-to-b from-white to-red-50/60' : ''}`}>
          <p className={`text-2xl font-extrabold leading-none tabular-nums flex items-center gap-1.5 ${count('attention') ? 'text-red-700' : 'text-gray-900'}`}>
            <span className="w-2 h-2 rounded-full" style={{ background: count('attention') ? '#dc2626' : '#d1d5db' }} />
            {count('attention')}
          </p>
          <p className="text-[11px] font-semibold text-gray-500 mt-1.5">Need attention now</p>
        </div>
        <div className={stat}>
          <p className="text-2xl font-extrabold leading-none tabular-nums flex items-center gap-1.5 text-indigo-700">
            <span className="w-2 h-2 rounded-full bg-indigo-500" />{count('ofd')}
          </p>
          <p className="text-[11px] font-semibold text-gray-500 mt-1.5">Out for delivery</p>
        </div>
        <div className={stat}>
          <p className="text-2xl font-extrabold leading-none tabular-nums flex items-center gap-1.5 text-amber-700">
            <span className="w-2 h-2 rounded-full bg-amber-500" />{count('transit') + count('pickup')}
          </p>
          <p className="text-[11px] font-semibold text-gray-500 mt-1.5">In transit / pickup</p>
        </div>
        <div className={stat}>
          <p className="text-2xl font-extrabold leading-none tabular-nums text-gray-900">{formatINR(codToCollect)}</p>
          <p className="text-[11px] font-semibold text-gray-500 mt-1.5">COD still to collect</p>
        </div>
      </div>

      {/* filter chips + refresh */}
      <div className="flex items-center gap-2 mb-3">
        <div className="flex gap-2 overflow-x-auto flex-1 no-scrollbar -mx-1 px-1 py-0.5">
          <Chip on={filter === 'all'} onClick={() => setFilter('all')}>All <b className="tabular-nums opacity-60">{total}</b></Chip>
          {BUCKETS.filter((b) => count(b)).map((b) => (
            <Chip key={b} tone={b === 'attention' ? 'red' : ''} on={filter === b} onClick={() => setFilter(b)}>
              {BUCKET_META[b].label} <b className="tabular-nums opacity-60">{count(b)}</b>
            </Chip>
          ))}
        </div>
        <button onClick={() => load(true)} disabled={refreshing}
          className="flex-shrink-0 p-2 rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-50" aria-label="Refresh">
          <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* body */}
      {orders === null ? (
        <div className="space-y-2.5">{[0, 1, 2].map((i) => <div key={i} className="h-24 rounded-2xl bg-gray-100 animate-pulse" />)}</div>
      ) : total === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 text-center">
          <PackageOpen size={30} className="mx-auto text-gray-300" />
          <p className="text-sm font-bold text-gray-800 mt-3">No shipments yet</p>
          <p className="text-xs text-gray-500 mt-1 max-w-xs mx-auto">Book a courier from any order (Orders tab → Book) and it will appear here to track — across Shadowfax, Delhivery and your delivery boys.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {BUCKETS.filter((b) => count(b) && (filter === 'all' || filter === b)).map((b) => {
            const M = BUCKET_META[b]; const Ic = BUCKET_ICON[b];
            return (
              <section key={b}>
                <div className="flex items-center gap-2 px-0.5 mb-2">
                  <span className={`w-5 h-5 rounded-md grid place-items-center ${M.chip}`}><Ic size={12} /></span>
                  <h3 className={`text-[12.5px] font-extrabold ${M.tone === 'red' ? 'text-red-700' : 'text-gray-700'}`}>{M.label}</h3>
                  <span className="text-[11px] font-bold text-gray-400 tabular-nums">{count(b)}</span>
                </div>
                <div className="space-y-2.5">
                  {groups[b].map((o) => (
                    <OrderCard key={o.id} o={o} bucket={b} themeColor={themeColor} onOpen={() => setActive(o)} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {active && (
        <TrackDrawer o={active} bucket={classifyBucket(active)} slug={slug} pin={pin}
          themeColor={themeColor} storeName={storeName} onClose={() => setActive(null)} />
      )}
    </div>
  );
}

function Chip({ on, tone, onClick, children }) {
  const base = 'flex-shrink-0 inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border whitespace-nowrap transition active:scale-95';
  const cls = on
    ? (tone === 'red' ? 'bg-red-600 text-white border-red-600' : 'bg-gray-900 text-white border-gray-900')
    : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50';
  return <button type="button" onClick={onClick} className={`${base} ${cls}`}>{children}</button>;
}

function OrderCard({ o, bucket, themeColor, onOpen }) {
  const M = BUCKET_META[bucket];
  const c = courierInfo(o.courier);
  const isCod = o.payment_method === 'cod';
  const phone = last10(o.customer_phone);
  const items = Array.isArray(o.items) ? o.items : [];
  const prod = items.length
    ? items.map((i) => `${i.name}${i.qty > 1 ? ` × ${i.qty}` : ''}`).join(', ')
    : `${o.item_count || 1} item${(o.item_count || 1) === 1 ? '' : 's'}`;
  const attention = bucket === 'attention';

  return (
    <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
      <button type="button" onClick={onOpen} className="w-full text-left">
        <div className="flex gap-3 px-3.5 pt-3.5 pb-2.5">
          <span className="w-1 self-stretch rounded-full flex-shrink-0" style={{ backgroundColor: M.stripe }} />
          <div className="flex-1 min-w-0">
            <p className="font-extrabold text-gray-900 leading-tight truncate">{o.customer_name || 'Customer'}</p>
            <p className="text-xs text-gray-500 truncate mt-0.5">{prod}</p>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${c.chip}`}>
                {c.key === 'delhivery' ? <Truck size={10} /> : <Bike size={10} />}{c.name}
              </span>
              <span className="text-[10.5px] font-mono text-gray-400">{o.awb}</span>
            </div>
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-base font-extrabold text-gray-900 tabular-nums leading-none">{formatINR(o.total || 0)}</p>
            <span className={`inline-block mt-1.5 text-[9.5px] font-bold px-1.5 py-0.5 rounded-full ${isCod ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'bg-emerald-50 text-emerald-700'}`}>
              {isCod ? 'COD' : 'Paid'}
            </span>
          </div>
          <ChevronRight size={16} className="text-gray-300 self-center flex-shrink-0" />
        </div>
        <div className="flex items-center gap-2 px-3.5 pb-3 -mt-0.5">
          <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full ${M.chip}`}>
            {prettyStatus(o.shipment_status)}
          </span>
          {attention && <span className="text-[11px] text-red-500 font-medium">· action needed</span>}
        </div>
      </button>

      {attention && (
        <div className="flex gap-2 px-3.5 pb-3.5">
          <a href={phone ? `tel:+91${phone}` : undefined}
            className={`flex-1 inline-flex items-center justify-center gap-1.5 text-[12px] font-bold py-2 rounded-xl border ${phone ? 'text-gray-800 border-gray-200 hover:bg-gray-50' : 'text-gray-300 border-gray-100 pointer-events-none'}`}>
            <Phone size={13} /> Call customer
          </a>
          <button type="button" onClick={onOpen}
            className="flex-1 inline-flex items-center justify-center gap-1.5 text-[12px] font-bold py-2 rounded-xl text-white active:scale-95"
            style={{ backgroundColor: themeColor }}>
            <MapPin size={13} /> Track & fix
          </button>
        </div>
      )}
    </div>
  );
}

function TrackDrawer({ o, bucket, slug, pin, themeColor, storeName, onClose }) {
  const M = BUCKET_META[bucket];
  const c = courierInfo(o.courier);
  const isCod = o.payment_method === 'cod';
  const phone = last10(o.customer_phone);
  const firstName = (o.customer_name || 'customer').trim().split(' ')[0];

  const [data, setData] = useState(null);   // track result
  const [err, setErr]   = useState('');

  useEffect(() => {
    let alive = true;
    setData(null); setErr('');
    shipmentOp(slug, pin, o.id, 'track')
      .then((r) => { if (alive) setData(r || {}); })
      .catch((e) => { if (alive) setErr(e.message || 'Could not fetch tracking.'); });
    return () => { alive = false; };
  }, [slug, pin, o.id]);

  const timeline = Array.isArray(data?.timeline) ? data.timeline : [];
  const trackUrl = data?.customerTrackUrl || data?.trackUrl || null;
  const waLink = trackWaLink(o, trackUrl, storeName);
  const ndr = data?.ndrReason || (bucket === 'attention' ? prettyStatus(o.shipment_status) : null);

  const btn = 'inline-flex items-center justify-center gap-1.5 text-[12.5px] font-bold py-2.5 rounded-xl active:scale-95 transition';

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-gray-50 w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* head */}
        <div className="px-5 pt-4 pb-3 border-b border-gray-100 bg-white rounded-t-2xl">
          <div className="flex items-start gap-3">
            <p className="text-lg font-extrabold text-gray-900 leading-tight flex-1">{o.customer_name || 'Customer'}</p>
            <button onClick={onClose} className="w-8 h-8 grid place-items-center rounded-full border border-gray-200 text-gray-500 hover:bg-gray-50 flex-shrink-0"><X size={16} /></button>
          </div>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${c.chip}`}>
              {c.key === 'delhivery' ? <Truck size={10} /> : <Bike size={10} />}{c.name}
            </span>
            <span className="text-[10.5px] font-mono text-gray-400">{o.awb}</span>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${isCod ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'bg-emerald-50 text-emerald-700'}`}>
              {isCod ? `COD ${formatINR(o.total || 0)}` : `Paid ${formatINR(o.total || 0)}`}
            </span>
          </div>
        </div>

        <div className="overflow-y-auto px-5 py-4">
          {/* NDR alert */}
          {ndr && (
            <div className="rounded-2xl border border-red-100 bg-gradient-to-b from-white to-red-50/70 p-4 mb-4">
              <p className="flex items-center gap-2 text-sm font-extrabold text-red-700"><AlertTriangle size={15} /> {prettyStatus(o.shipment_status)}</p>
              <p className="text-xs text-red-500/90 mt-1.5 leading-relaxed">
                {/nc|not contactable|unreachable|cnr/i.test(ndr)
                  ? 'The rider couldn’t reach the customer. Call to confirm they’ll be available, or reschedule — before it comes back as a return.'
                  : /address/i.test(ndr)
                  ? 'The courier flagged the address. Confirm the full address and pincode with the customer, then reschedule the delivery.'
                  : ndr}
              </p>
            </div>
          )}

          {/* actions */}
          <div className="flex gap-2 mb-5">
            <a href={phone ? `tel:+91${phone}` : undefined}
              className={`${btn} flex-1 bg-white border ${phone ? 'border-gray-200 text-gray-800 hover:bg-gray-50' : 'border-gray-100 text-gray-300 pointer-events-none'}`}>
              <Phone size={14} /> Call {firstName}
            </a>
            {waLink ? (
              <a href={waLink} target="_blank" rel="noopener noreferrer" className={`${btn} flex-1 text-white`} style={{ backgroundColor: '#1faa53' }}>
                <MessageCircle size={14} /> Send tracking
              </a>
            ) : (
              <span className={`${btn} flex-1 bg-gray-50 border border-gray-100 text-gray-400`} title="This courier hasn’t shared a public tracking link for this parcel yet.">
                <MessageCircle size={14} /> No link yet
              </span>
            )}
          </div>

          {/* rider / promised date */}
          {(data?.rider?.name || data?.promisedDate) && (
            <div className="flex flex-wrap gap-2 mb-4">
              {data?.rider?.name && (
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-gray-600 bg-white border border-gray-100 rounded-full px-2.5 py-1">
                  <Bike size={12} className="text-gray-400" /> {data.rider.name}{data.rider.phone ? ` · ${data.rider.phone}` : ''}
                </span>
              )}
              {data?.promisedDate && (
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-gray-600 bg-white border border-gray-100 rounded-full px-2.5 py-1">
                  📅 Expected {data.promisedDate}
                </span>
              )}
            </div>
          )}

          {/* timeline */}
          <p className="text-[11px] font-extrabold tracking-wider uppercase text-gray-400 mb-3">Delivery journey</p>
          {data === null ? (
            <div className="space-y-3">{[0, 1, 2, 3].map((i) => <div key={i} className="h-10 rounded-lg bg-gray-100 animate-pulse" />)}</div>
          ) : err ? (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">{err}</p>
          ) : timeline.length === 0 ? (
            <div className="text-xs text-gray-500 bg-white border border-gray-100 rounded-xl px-3 py-3">
              Current status: <b className="text-gray-700">{prettyStatus(data?.status || o.shipment_status)}</b>.
              <br />Hub-by-hub updates will appear here once {c.name} scans the parcel.
            </div>
          ) : (
            <div className="relative pl-7">
              <span className="absolute left-2.5 top-1.5 bottom-3 w-0.5 bg-gray-200" />
              {timeline.map((e, i) => {
                const isLast = i === timeline.length - 1;
                const dotColor = isLast ? M.stripe : '#059669';
                return (
                  <div key={i} className="relative pb-4 last:pb-0">
                    <span className="absolute -left-7 top-0.5 w-[18px] h-[18px] rounded-full grid place-items-center"
                      style={{ background: isLast ? '#fff' : dotColor, border: `2px solid ${dotColor}`, boxShadow: isLast ? `0 0 0 4px ${M.stripe}22` : 'none' }}>
                      {!isLast && <Check size={9} strokeWidth={3} className="text-white" />}
                    </span>
                    <p className={`text-[13px] font-bold leading-tight ${isLast ? '' : 'text-gray-900'}`} style={isLast ? { color: M.stripe } : {}}>
                      {prettyStatus(e.label || e.code)}
                    </p>
                    {e.place && <p className="text-[11.5px] text-gray-500 mt-0.5">{e.place}</p>}
                    {e.ts && <p className="text-[10.5px] text-gray-400 mt-0.5 tabular-nums">{fmtTs(e.ts)}</p>}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* foot */}
        <div className="border-t border-gray-100 bg-white px-5 py-3 flex items-center gap-3 rounded-b-2xl sm:rounded-b-2xl">
          {data?.trackUrl ? (
            <a href={data.trackUrl} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-bold text-gray-600 border border-gray-200 bg-white px-3 py-2 rounded-xl hover:bg-gray-50">
              <ExternalLink size={13} /> Open in {c.name}
            </a>
          ) : <span />}
          <p className="text-[10.5px] text-gray-400 flex-1 leading-snug">Call recordings & delivery photos stay in the courier app.</p>
        </div>
      </div>
    </div>,
    document.body,
  );
}

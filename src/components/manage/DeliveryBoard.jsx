import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle, Truck, Bike, Package, Check, X, Phone, MapPin,
  ChevronRight, ChevronDown, ExternalLink, RefreshCw, MessageCircle, PackageOpen, ListFilter, Search,
} from 'lucide-react';
import { fetchOrders, fetchOrderFacts } from '../../utils/orderService';
import { shipmentOp, syncDeliveryStatuses } from '../../utils/shippingConnect';
import { buildDeliveryMetrics, isAtDetailedCap, DETAILED_ORDER_CAP } from '../../utils/deliveryMetrics';
import { formatINR } from '../../utils/currency';
import { classifyBucket, BUCKET_META, BUCKETS, prettyStatus, courierInfo, matchesShipmentSearch } from '../../utils/deliveryStatus';
import { useScrollLock } from '../../hooks/useScrollLock';

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

// The buyer's own order page on PocketLink. Preferred over the courier's own
// tracking URL because it exists for EVERY order — couriers only sometimes
// publish one — and it shows the shop's branding rather than Delhivery's.
function buyerTrackUrl(o) {
  if (!o?.confirm_token) return null;
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://www.pocketlink.store';
  return `${origin}/order/${o.confirm_token}`;
}

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
  // TWO feeds, kept apart.
  //  facts  - get_store_order_facts: UNCAPPED, PII-free. The summary tiles.
  //  orders - get_store_orders: newest 500, detailed. The shipment list, search
  //           and drawer, which need a customer's name, phone and address.
  // No tile is ever computed from the capped rows.
  const [factsResult, setFactsResult] = useState(null);   // { ok, data, reason }
  const [rawCount, setRawCount] = useState(0);
  const [orders, setOrders]   = useState(null);   // null = loading
  const [syncing, setSyncing] = useState(false);
  // A courier refresh that failed is NOT the same as missing data: the board
  // keeps whatever it already loaded and says the statuses may be stale.
  const [syncStale, setSyncStale] = useState(false);
  const [filter, setFilter]   = useState('all');
  const [courier, setCourier]         = useState('all');
  const [courierMenu, setCourierMenu] = useState(false);   // courier dropdown open
  const [statusMenu, setStatusMenu]   = useState(false);   // status dropdown open
  const [active, setActive]           = useState(null);    // order open in the drawer
  const [query, setQuery]             = useState('');      // search: name, number or AWB
  const ddRef = useRef(null);
  const sdRef = useRef(null);

  // close either dropdown on an outside tap
  useEffect(() => {
    if (!courierMenu && !statusMenu) return undefined;
    const h = (e) => {
      if (courierMenu && ddRef.current && !ddRef.current.contains(e.target)) setCourierMenu(false);
      if (statusMenu && sdRef.current && !sdRef.current.contains(e.target)) setStatusMenu(false);
    };
    document.addEventListener('mousedown', h);
    document.addEventListener('touchstart', h);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('touchstart', h); };
  }, [courierMenu, statusMenu]);

  const grab = useCallback(async () => {
    // includeAbandoned so the raw page size is visible: get_store_orders applies
    // its LIMIT before anything is filtered, so the list can be truncated while
    // holding far fewer than 500 shipments.
    const rows = await fetchOrders(slug, pin, { includeAbandoned: true });
    setRawCount(rows.length);
    return rows.filter((o) => o.awb);   // only booked shipments (they carry an AWB)
  }, [slug, pin]);

  // The accounting feed. Never mixed with the rows above.
  const grabFacts = useCallback(async () => {
    const f = await fetchOrderFacts(slug, pin);
    setFactsResult(f);
  }, [slug, pin]);

  // Pull the live courier status for every open shipment, then re-read. This is what
  // keeps the board matching the courier — the stored status is only the booking-time
  // value until the webhook or a manual Track updates it, which often never happens.
  const sync = useCallback(async () => {
    setSyncing(true);
    try {
      // shippingConnect already reports a failure instead of throwing; the board
      // used to discard that and show stale statuses as if they were fresh.
      const r = await syncDeliveryStatuses(slug, pin);
      setSyncStale(Boolean(r?.error));
      await Promise.all([grabFacts(), grab().then(setOrders)]);
    } finally { setSyncing(false); }
  }, [slug, pin, grab, grabFacts]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setOrders(null);
      setFactsResult(null);
      const [first] = await Promise.all([grab(), grabFacts()]);
      if (!alive) return;
      setOrders(first);                       // stored statuses render instantly
      setSyncing(true);
      const r = await syncDeliveryStatuses(slug, pin);  // then correct them from the courier
      if (!alive) return;
      setSyncStale(Boolean(r?.error));
      await Promise.all([grabFacts(), grab().then(setOrders)]);
      setSyncing(false);
    })();
    return () => { alive = false; };
  }, [slug, pin, grab, grabFacts]);

  // Which couriers appear → drives the selector (hidden for single-courier stores).
  const courierKeys = [...new Set((orders || []).map((o) => courierInfo(o.courier).key))];
  const showCourierSel = courierKeys.length > 1;
  const activeCourier = showCourierSel ? courier : 'all';

  // Courier-scoped pool → buckets. Courier + status filters compose.
  const pool = (orders || []).filter((o) => activeCourier === 'all' || courierInfo(o.courier).key === activeCourier);
  const groups = {};
  BUCKETS.forEach((b) => { groups[b] = []; });
  pool.forEach((o) => { const b = classifyBucket(o); (groups[b] || (groups[b] = [])).push(o); });
  const count = (b) => (groups[b] || []).length;
  const total = pool.length;
  // if the active status filter emptied out under this courier, fall back to All
  const effFilter = (filter === 'all' || count(filter)) ? filter : 'all';
  // Search narrows the list only; the tiles and counts above still cover the whole board.
  const shown = (b) => (groups[b] || []).filter((o) => matchesShipmentSearch(o, query));
  const shownTotal = BUCKETS.reduce((n, b) => n + ((effFilter === 'all' || effFilter === b) ? shown(b).length : 0), 0);

  // The canonical fulfilment summary. Built from the UNCAPPED facts feed and
  // classified by shipmentState, never by the display buckets above - a bucket
  // reads only shipment_status, so a parcel whose shipment_outcome says it came
  // back still shows as in transit.
  const summary = buildDeliveryMetrics(factsResult?.ok ? factsResult.data : []);
  const summaryOk = factsResult?.ok === true;
  const listCapped = isAtDetailedCap(rawCount);

  const stat = 'bg-white rounded-2xl border border-gray-100 shadow-sm px-3.5 py-3';
  const TRIG = {
    all:       'bg-white border-gray-200 text-gray-800',
    shadowfax: 'bg-orange-50 border-orange-200 text-orange-700',
    delhivery: 'bg-indigo-50 border-indigo-200 text-indigo-700',
    local:     'bg-emerald-50 border-emerald-200 text-emerald-700',
  };
  const courierCount = (k) => (orders || []).filter((o) => courierInfo(o.courier).key === k).length;
  const CourierIcon = (k) => (k === 'delhivery' ? Truck : k === 'all' ? Package : Bike);
  const courierName = (k) => (k === 'all' ? 'All couriers' : courierInfo(k).name);
  const courierNum  = (k) => (k === 'all' ? (orders || []).length : courierCount(k));

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
          {summaryOk ? (<>
            <p className="text-2xl font-extrabold leading-none tabular-nums text-gray-900">
              {formatINR(Math.round(summary.codOnUndelivered.amount))}
            </p>
            {/* The population is in the label on purpose. Payments owns "Still to
                collect", which covers every method and every unshipped order;
                this is only COD riding on shipments still in flight. */}
            <p className="text-[11px] font-semibold text-gray-500 mt-1.5 leading-snug">
              COD on shipments not yet delivered
            </p>
            <p className="text-[10.5px] text-gray-400 mt-0.5">
              {summary.codOnUndelivered.count} shipment{summary.codOnUndelivered.count === 1 ? '' : 's'}
            </p>
          </>) : (
            <>
              <p className="text-2xl font-extrabold leading-none text-gray-300">&mdash;</p>
              <p className="text-[11px] font-semibold text-gray-500 mt-1.5 leading-snug">COD on shipments not yet delivered</p>
            </>
          )}
        </div>
      </div>

      {/* ── Fulfilment summary: canonical, uncapped, current state ──────────
          Counts are the point; money is subtext. Delivery Orders is exactly
          Delivered + Returned + In Flight - orders with no AWB are a separate
          queue below and are deliberately not in that sum. */}
      {!summaryOk ? (
        <div className="rounded-2xl border border-amber-100 bg-amber-50/60 px-4 py-3.5 mb-3 flex items-center gap-3" role="alert">
          <PackageOpen size={18} className="text-amber-500 flex-shrink-0" />
          <div className="min-w-0 flex-grow">
            <p className="text-sm font-bold text-gray-900">Delivery summary unavailable</p>
            <p className="text-xs text-gray-500 mt-0.5">Your shipments are safe &mdash; the totals couldn&rsquo;t be loaded.</p>
          </div>
          <button type="button" onClick={sync} disabled={syncing}
                  className="flex-shrink-0 text-xs font-bold px-3 py-2 rounded-xl text-white active:scale-[0.98] transition-transform disabled:opacity-50"
                  style={{ backgroundColor: themeColor }}>
            Try again
          </button>
        </div>
      ) : (
        <div className="rounded-2xl border border-gray-100 bg-white shadow-sm px-4 py-3 mb-3">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-[10.5px] font-bold uppercase tracking-widest text-gray-400">Shipments</p>
            <p className="text-[11px] font-bold text-gray-700 tabular-nums">
              {summary.orders.count} <span className="font-semibold text-gray-400">· {formatINR(Math.round(summary.orders.amount))}</span>
            </p>
          </div>
          <dl className="mt-2 grid grid-cols-3 gap-2 text-center">
            <div><dt className="text-[10.5px] text-gray-500">Delivered</dt>
              <dd className="text-lg font-extrabold text-blue-700 tabular-nums">{summary.delivered.count}</dd></div>
            <div><dt className="text-[10.5px] text-gray-500">In flight</dt>
              <dd className="text-lg font-extrabold text-amber-700 tabular-nums">{summary.inFlight.count}</dd></div>
            <div><dt className="text-[10.5px] text-gray-500">Returned</dt>
              <dd className="text-lg font-extrabold text-rose-700 tabular-nums">{summary.returned.count}</dd></div>
          </dl>
          {(summary.notShipped.count > 0 || summary.deliveredPaymentPending.count > 0) && (
            <div className="mt-2.5 pt-2.5 border-t border-gray-100 space-y-1">
              {summary.notShipped.count > 0 && (
                <p className="text-[11px] text-gray-500">
                  <span className="font-bold text-gray-700">{summary.notShipped.count} not shipped yet</span>
                  {' '}&mdash; {formatINR(Math.round(summary.notShipped.amount))}, no courier booked
                </p>
              )}
              {summary.deliveredPaymentPending.count > 0 && (
                <p className="text-[11px] text-gray-500">
                  <span className="font-bold text-gray-700">{summary.deliveredPaymentPending.count} delivered · payment pending</span>
                  {' '}&mdash; {formatINR(Math.round(summary.deliveredPaymentPending.amount))}
                </p>
              )}
              {summary.returnedPaymentRecorded.count > 0 && (
                <p className="text-[11px] text-gray-500">
                  <span className="font-bold text-gray-700">{summary.returnedPaymentRecorded.count} returned · payment recorded</span>
                  {' '}&mdash; {formatINR(Math.round(summary.returnedPaymentRecorded.amount))}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* A courier refresh that failed leaves the board showing what it already
          had. Saying nothing would present stale statuses as fresh ones. */}
      {syncStale && !syncing && (
        <div className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 mb-3 flex items-center gap-2" role="status">
          <AlertTriangle size={13} className="text-amber-500 flex-shrink-0" />
          <span className="text-[11px] font-semibold text-amber-800 flex-grow">
            Courier status refresh failed. Showing the last loaded delivery data.
          </span>
          <button type="button" onClick={sync} disabled={syncing}
                  className="text-[11px] font-bold text-amber-900 underline underline-offset-2 disabled:opacity-50">
            Retry
          </button>
        </div>
      )}

      {listCapped && (
        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-1.5 mb-2.5">
          The list below reads your newest {DETAILED_ORDER_CAP} orders; the totals above read all of them.
        </p>
      )}

      {/* live-sync indicator */}
      <div className="flex items-center gap-1.5 mb-2.5 px-0.5">
        {syncing ? (
          <>
            <RefreshCw size={12} className="animate-spin text-gray-400" />
            <span className="text-[11px] font-semibold text-gray-400">Syncing live status from the courier…</span>
          </>
        ) : (
          <>
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 ring-2 ring-green-100" />
            <span className="text-[11px] font-semibold text-green-600">Live status · synced from the courier</span>
          </>
        )}
      </div>

      {/* courier selector (dropdown) — only when more than one courier ships */}
      {showCourierSel && (
        <div className="relative mb-3" ref={ddRef}>
          {(() => { const Ic = CourierIcon(activeCourier); return (
            <button type="button" onClick={() => { setStatusMenu(false); setCourierMenu((v) => !v); }} aria-haspopup="listbox" aria-expanded={courierMenu}
              className={['inline-flex items-center gap-2 text-sm font-bold rounded-xl border px-3.5 py-2.5 shadow-sm active:scale-[0.98] transition',
                TRIG[activeCourier] || TRIG.all].join(' ')}>
              <Ic size={15} />
              <span>{courierName(activeCourier)}</span>
              <span className="text-[11px] font-extrabold text-gray-500 bg-black/5 rounded-full px-1.5 tabular-nums">{courierNum(activeCourier)}</span>
              <ChevronDown size={15} className={`text-gray-400 transition-transform ${courierMenu ? 'rotate-180' : ''}`} />
            </button>
          ); })()}
          {courierMenu && (
            <div role="listbox" className="absolute left-0 top-full mt-1.5 z-30 w-60 max-w-[80vw] bg-white border border-gray-100 rounded-xl shadow-lg py-1 overflow-hidden">
              {['all', ...courierKeys].map((k) => {
                const on = activeCourier === k; const Ic = CourierIcon(k);
                return (
                  <button key={k} type="button" role="option" aria-selected={on}
                    onClick={() => { setCourier(k); setCourierMenu(false); }}
                    className={['w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm font-semibold text-left', on ? 'bg-gray-50' : 'hover:bg-gray-50'].join(' ')}>
                    <Ic size={15} className="text-gray-500 flex-shrink-0" />
                    <span className="flex-1 text-gray-800">{courierName(k)}</span>
                    <span className="text-[11px] font-extrabold text-gray-400 tabular-nums">{courierNum(k)}</span>
                    {on && <Check size={14} className="text-gray-900" strokeWidth={3} />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* search */}
      {total > 0 && (
        <div className="flex items-center gap-2 bg-white rounded-xl border border-gray-200 px-3 py-2 mb-3">
          <Search size={15} className="text-gray-400 flex-shrink-0" />
          <input id="delivery-search" type="text" value={query} onChange={(e) => setQuery(e.target.value)}
                 placeholder="Search name, number or AWB…" aria-label="Search shipments"
                 className="flex-1 min-w-0 bg-transparent text-sm text-gray-900 placeholder-gray-400 focus:outline-none" />
          {query && (
            <button type="button" onClick={() => setQuery('')} aria-label="Clear search" className="p-0.5 text-gray-400 hover:text-gray-600">
              <X size={14} />
            </button>
          )}
        </div>
      )}

      {/* status filter (dropdown) + refresh */}
      <div className="flex items-center gap-2 mb-3">
        <div className="relative" ref={sdRef}>
          {(() => {
            const cur = effFilter;
            const Ic = cur === 'all' ? ListFilter : BUCKET_ICON[cur];
            const label = cur === 'all' ? 'All statuses' : BUCKET_META[cur].label;
            const n = cur === 'all' ? total : count(cur);
            const tint = cur === 'all' ? 'bg-white border-gray-200 text-gray-800' : BUCKET_META[cur].soft;
            return (
              <button type="button" onClick={() => { setCourierMenu(false); setStatusMenu((v) => !v); }} aria-haspopup="listbox" aria-expanded={statusMenu}
                className={['inline-flex items-center gap-2 text-sm font-bold rounded-xl border px-3.5 py-2.5 shadow-sm active:scale-[0.98] transition', tint].join(' ')}>
                <Ic size={15} />
                <span>{label}</span>
                <span className="text-[11px] font-extrabold text-gray-500 bg-black/5 rounded-full px-1.5 tabular-nums">{n}</span>
                <ChevronDown size={15} className={`text-gray-400 transition-transform ${statusMenu ? 'rotate-180' : ''}`} />
              </button>
            );
          })()}
          {statusMenu && (
            <div role="listbox" className="absolute left-0 top-full mt-1.5 z-30 w-60 max-w-[80vw] bg-white border border-gray-100 rounded-xl shadow-lg py-1 overflow-hidden">
              {['all', ...BUCKETS.filter((b) => count(b))].map((k) => {
                const on = effFilter === k;
                const Ic = k === 'all' ? ListFilter : BUCKET_ICON[k];
                const label = k === 'all' ? 'All statuses' : BUCKET_META[k].label;
                const n = k === 'all' ? total : count(k);
                const dot = k === 'all' ? '#9ca3af' : BUCKET_META[k].stripe;
                return (
                  <button key={k} type="button" role="option" aria-selected={on}
                    onClick={() => { setFilter(k); setStatusMenu(false); }}
                    className={['w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm font-semibold text-left', on ? 'bg-gray-50' : 'hover:bg-gray-50'].join(' ')}>
                    <Ic size={15} className="flex-shrink-0" style={{ color: dot }} />
                    <span className="flex-1 text-gray-800">{label}</span>
                    <span className="text-[11px] font-extrabold text-gray-400 tabular-nums">{n}</span>
                    {on && <Check size={14} className="text-gray-900" strokeWidth={3} />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <button onClick={sync} disabled={syncing}
          className="ml-auto flex-shrink-0 p-2.5 rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-50" aria-label="Refresh live status">
          <RefreshCw size={15} className={syncing ? 'animate-spin' : ''} />
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
      ) : shownTotal === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 text-center">
          <Search size={26} className="mx-auto text-gray-300" />
          <p className="text-sm font-bold text-gray-800 mt-3">No shipment matches “{query.trim()}”</p>
          <p className="text-xs text-gray-500 mt-1">
            {effFilter === 'all' ? 'Check the spelling, or search by phone number or AWB.' : `Only “${BUCKET_META[effFilter].label}” is showing. Try All statuses.`}
          </p>
          <button type="button" onClick={() => setQuery('')}
            className="mt-3 text-xs font-bold text-gray-700 border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50">
            Clear search
          </button>
        </div>
      ) : (
        <div className="space-y-5">
          {BUCKETS.filter((b) => shown(b).length && (effFilter === 'all' || effFilter === b)).map((b) => {
            const M = BUCKET_META[b]; const Ic = BUCKET_ICON[b];
            return (
              <section key={b}>
                <div className="flex items-center gap-2 px-0.5 mb-2">
                  <span className={`w-5 h-5 rounded-md grid place-items-center ${M.chip}`}><Ic size={12} /></span>
                  <h3 className={`text-[12.5px] font-extrabold ${M.tone === 'red' ? 'text-red-700' : 'text-gray-700'}`}>{M.label}</h3>
                  <span className="text-[11px] font-bold text-gray-400 tabular-nums">{shown(b).length}</span>
                </div>
                <div className="space-y-2.5">
                  {shown(b).map((o) => (
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

function OrderCard({ o, bucket, themeColor, onOpen }) {
  const M = BUCKET_META[bucket];
  const c = courierInfo(o.courier);
  const isCod = o.payment_method === 'cod';
  const codCollected = isCod && bucket === 'delivered';   // COD delivered = cash taken at the door
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
            <span className={`inline-block mt-1.5 text-[9.5px] font-bold px-1.5 py-0.5 rounded-full ${
              codCollected ? 'bg-emerald-100 text-emerald-700'
              : isCod ? 'bg-amber-50 text-amber-700 border border-amber-200'
              : 'bg-emerald-50 text-emerald-700'}`}>
              {codCollected ? '✓ Collected' : isCod ? 'COD' : 'Paid'}
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

  // Lock the board behind the drawer so scrolling the timeline doesn't move it.
  useScrollLock(true);

  const timeline = Array.isArray(data?.timeline) ? data.timeline : [];
  const trackUrl = buyerTrackUrl(o) || data?.customerTrackUrl || data?.trackUrl || null;
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

        <div className="overflow-y-auto overscroll-contain px-5 py-4">
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

          {/* COD collection + proof of delivery */}
          {(isCod || (data?.pod && (data.pod.name || data.pod.proof?.length))) && (
            <div className="rounded-2xl border border-gray-100 bg-white p-3.5 mb-4">
              {isCod && (
                bucket === 'delivered' ? (
                  <p className="flex items-center gap-2 text-[13px] font-bold text-emerald-700">
                    <Check size={15} strokeWidth={3} /> Cash collected — {formatINR(o.total || 0)} taken at delivery
                  </p>
                ) : (
                  <p className="flex items-center gap-2 text-[13px] font-bold text-amber-700">
                    <span className="w-2 h-2 rounded-full bg-amber-500 flex-shrink-0" /> To collect {formatINR(o.total || 0)} in cash at the door
                  </p>
                )
              )}
              {data?.pod && (data.pod.name || data.pod.proof?.length > 0) && (
                <div className={isCod ? 'mt-2.5 pt-2.5 border-t border-gray-100' : ''}>
                  {data.pod.name && (
                    <p className="text-xs text-gray-600">Received by <b className="text-gray-900">{data.pod.name}</b>{data.pod.contact ? ` · ${data.pod.contact}` : ''}</p>
                  )}
                  {data.pod.proof?.map((u, i) => (
                    <a key={i} href={u} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] font-bold text-gray-600 border border-gray-200 rounded-lg px-2 py-1 mt-1.5 mr-1.5 hover:bg-gray-50">
                      <ExternalLink size={11} /> Proof of delivery{data.pod.proof.length > 1 ? ` ${i + 1}` : ''}
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}

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

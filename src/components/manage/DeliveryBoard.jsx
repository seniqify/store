import { useState, useEffect, useCallback, useMemo, useDeferredValue, memo } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle, Truck, Bike, Package, Check, X, Phone, MapPin,
  ChevronRight, ExternalLink, RefreshCw, MessageCircle, PackageOpen, Search, Ban,
} from 'lucide-react';
import { fetchOrders, fetchOrderFacts } from '../../utils/orderService';
import { shipmentOp, syncDeliveryStatuses } from '../../utils/shippingConnect';
import { buildDeliveryMetrics, isPartialList } from '../../utils/deliveryMetrics';
import { LIST_PAGE_SIZE } from '../../utils/listPage';
import { formatINR } from '../../utils/currency';
import { classifyBucket, BUCKET_META, BUCKETS, prettyStatus, courierInfo, matchesShipmentSearch, shipmentRef } from '../../utils/deliveryStatus';
import { useScrollLock } from '../../hooks/useScrollLock';
import { DELIVERY_CHOICE_LABEL } from '../../utils/deliveryTools';

const BUCKET_ICON = {
  attention: AlertTriangle, ofd: Bike, transit: Truck, pickup: Package, delivered: Check, cancelled: Ban,
};

// The five BUCKETS are the live pipeline. A shipment the courier called off is
// not in it, but it still has to be findable - before this it fell into a
// display hole: counted in the header, rendered in no section.
const LIST_BUCKETS = [...BUCKETS, 'cancelled'];

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
  //  orders - fetchOrders: every order, detailed. The shipment list, search
  //           and drawer, which need a customer's name, phone and address.
  // No tile is ever computed from the detailed rows.
  const [factsResult, setFactsResult] = useState(null);   // { ok, data, reason }
  const [listPartial, setListPartial] = useState(false);
  const [orders, setOrders]   = useState(null);   // null = loading
  const [syncing, setSyncing] = useState(false);
  // A courier refresh that failed is NOT the same as missing data: the board
  // keeps whatever it already loaded and says the statuses may be stale.
  const [syncStale, setSyncStale] = useState(false);
  const [filter, setFilter]   = useState('all');
  const [courier, setCourier]         = useState('all');
  const [active, setActive]           = useState(null);    // order open in the drawer
  const [query, setQuery]             = useState('');      // search: name, phone, order no., product or AWB
  // The box shows every letter at once; the list follows a beat behind.
  const searchText = useDeferredValue(query);
  // Cards drawn, for one view of the board: a new search or filter starts again
  // at the first page; a courier refresh keeps what the seller already opened.
  const [more, setMore]               = useState({ view: '', n: LIST_PAGE_SIZE });

  const grab = useCallback(async () => {
    // fetchOrders reads every order; `partial` means some older ones failed.
    const rows = await fetchOrders(slug, pin, { includeAbandoned: true });
    setListPartial(isPartialList(rows));
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

  // Which couriers appear → drives the courier chips (hidden for single-courier stores).
  const courierKeys = [...new Set((orders || []).map((o) => courierInfo(o.courier).key))];
  const showCourierSel = courierKeys.length > 1;
  const activeCourier = showCourierSel ? courier : 'all';

  // Courier-scoped pool → buckets. Courier + status filters compose. Sorted
  // once per load, not on every keystroke of the search.
  const { pool, groups } = useMemo(() => {
    const p = (orders || []).filter((o) => activeCourier === 'all' || courierInfo(o.courier).key === activeCourier);
    const g = {};
    LIST_BUCKETS.forEach((b) => { g[b] = []; });
    p.forEach((o) => { const b = classifyBucket(o); (g[b] || (g[b] = [])).push(o); });
    return { pool: p, groups: g };
  }, [orders, activeCourier]);
  const count = (b) => (groups[b] || []).length;
  const total = pool.length;
  // if the active status filter emptied out under this courier, fall back to All
  const effFilter = (filter === 'all' || count(filter)) ? filter : 'all';
  // Search narrows the list only; the tab counts above still cover the whole board.
  const matched = useMemo(() => {
    const m = {};
    LIST_BUCKETS.forEach((b) => { m[b] = (groups[b] || []).filter((o) => matchesShipmentSearch(o, searchText)); });
    return m;
  }, [groups, searchText]);
  const shown = (b) => matched[b] || [];
  const shownTotal = LIST_BUCKETS.reduce((n, b) => n + ((effFilter === 'all' || effFilter === b) ? shown(b).length : 0), 0);
  // A page at a time behind "Show more": the first `visible` shipments in board
  // order, split back into their sections. Section counts stay whole.
  const view = `${searchText}|${effFilter}|${activeCourier}`;
  const visible = more.view === view ? more.n : LIST_PAGE_SIZE;
  const page = {};
  let left = visible;
  LIST_BUCKETS.forEach((b) => {
    page[b] = (effFilter === 'all' || effFilter === b) ? shown(b).slice(0, Math.max(0, left)) : [];
    left -= page[b].length;
  });
  const remaining = shownTotal - Math.min(visible, shownTotal);

  // The canonical fulfilment summary. Built from the UNCAPPED facts feed and
  // classified by shipmentState, never by the display buckets above - a bucket
  // reads only shipment_status, so a parcel whose shipment_outcome says it came
  // back still shows as in transit.
  const summary = useMemo(() => buildDeliveryMetrics(factsResult?.ok ? factsResult.data : []), [factsResult]);
  const summaryOk = factsResult?.ok === true;

  const courierNum = (k) => (k === 'all' ? (orders || []).length : (orders || []).filter((o) => courierInfo(o.courier).key === k).length);
  // The status tabs, always in view: every live stage (a 0 is an answer too),
  // and a courier-cancelled tab only when there is one.
  const statusTabs = ['all', ...BUCKETS, ...(count('cancelled') ? ['cancelled'] : [])];

  return (
    <div className="max-w-3xl mx-auto">
      {/* ── Find a parcel: one search over everything, and refresh ────────── */}
      <div className="flex items-center gap-2 mb-3">
        {total > 0 && (
          <div className="flex-1 min-w-0 flex items-center gap-2 bg-white rounded-xl border border-gray-200 px-3 h-11 focus-within:border-gray-400 transition-colors">
            <Search size={16} className="text-gray-400 flex-shrink-0" />
            <input id="delivery-search" type="text" value={query} onChange={(e) => setQuery(e.target.value)}
                   placeholder="Search name, phone, order no. or AWB…" aria-label="Search shipments"
                   className="flex-1 min-w-0 bg-transparent text-[14px] text-gray-900 placeholder-gray-400 focus:outline-none" />
            {query && (
              <button type="button" onClick={() => setQuery('')} aria-label="Clear search" className="p-1 text-gray-400 hover:text-gray-600">
                <X size={15} />
              </button>
            )}
          </div>
        )}
        <button type="button" onClick={sync} disabled={syncing} aria-label="Refresh live status"
          className="ml-auto flex-shrink-0 h-11 inline-flex items-center gap-1.5 px-3 rounded-xl border border-gray-200 bg-white text-[13px] font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-60">
          <RefreshCw size={15} className={syncing ? 'animate-spin' : ''} />
          <span className="hidden sm:inline">{syncing ? 'Checking…' : 'Refresh'}</span>
        </button>
      </div>

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

      {listPartial && (
        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-1.5 mb-2.5">
          Some older orders didn&rsquo;t load, so the list below may be missing a few; the totals below read all of them.
        </p>
      )}

      {/* ── Status tabs: where every parcel stands, at a glance ─────────────── */}
      {total > 0 && (
        <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-1 px-1 mb-2.5 sm:flex-wrap" role="tablist" aria-label="Shipment status">
          {statusTabs.map((k) => {
            const on = effFilter === k;
            const n = k === 'all' ? total : count(k);
            // Parcels that need the owner (a failed attempt, a return) light up red.
            const urgent = k === 'attention' && count('attention') > 0 && !on;
            return (
              <button key={k} type="button" role="tab" aria-selected={on} disabled={k !== 'all' && n === 0}
                onClick={() => setFilter(k)}
                className={['flex-shrink-0 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[13px] font-semibold border transition disabled:opacity-50',
                  on ? 'bg-gray-900 text-white border-gray-900'
                    : urgent ? 'bg-red-50 text-red-700 border-red-200 hover:border-red-300'
                    : 'bg-white text-gray-700 border-gray-200 hover:border-gray-300'].join(' ')}>
                {k !== 'all' && <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: BUCKET_META[k].stripe }} />}
                {k === 'all' ? 'All' : BUCKET_META[k].label}
                <span className={`tabular-nums ${on ? 'opacity-70' : urgent ? 'font-extrabold' : 'text-gray-400'}`}>{n}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* courier chips (only when more than one courier ships) + live status */}
      <div className="flex items-center gap-1.5 flex-wrap mb-4 px-0.5">
        {/* The tab counts stay on the whole board; this says what the search found. */}
        {searchText.trim() && total > 0 && (
          <span className="text-[12px] font-bold text-gray-800 mr-1" role="status">
            {shownTotal} found
          </span>
        )}
        {showCourierSel && ['all', ...courierKeys].map((k) => {
          const on = activeCourier === k;
          return (
            <button key={k} type="button" aria-pressed={on} onClick={() => setCourier(k)}
              className={['inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[12px] font-bold border transition',
                on ? 'bg-white border-gray-400 text-gray-900' : 'bg-transparent border-gray-200 text-gray-500 hover:text-gray-800'].join(' ')}>
              {k === 'all' ? 'All couriers' : courierInfo(k).name}
              <span className="tabular-nums text-gray-400">{courierNum(k)}</span>
            </button>
          );
        })}
        <span className="ml-auto inline-flex items-center gap-1.5">
          {syncing ? (
            <>
              <RefreshCw size={11} className="animate-spin text-gray-400" />
              <span className="text-[11px] font-semibold text-gray-400">Syncing live status from the courier…</span>
            </>
          ) : (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 ring-2 ring-green-100" />
              <span className="text-[11px] font-semibold text-green-700">Live status · synced from the courier</span>
            </>
          )}
        </span>
      </div>

      {/* body */}
      {orders === null ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm divide-y divide-gray-100">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3.5">
              <div className="w-10 h-10 rounded-xl bg-gray-100 animate-pulse" />
              <div className="flex-1 space-y-2"><div className="h-3 w-1/3 rounded bg-gray-100 animate-pulse" /><div className="h-3 w-1/2 rounded bg-gray-100 animate-pulse" /></div>
            </div>
          ))}
        </div>
      ) : total === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 text-center">
          <PackageOpen size={30} className="mx-auto text-gray-300" />
          <p className="text-sm font-bold text-gray-800 mt-3">No shipments yet</p>
          <p className="text-xs text-gray-500 mt-1 max-w-xs mx-auto">Book a courier from Ship (or any order card) and it will appear here to track — across Shadowfax, Delhivery and your delivery boys.</p>
        </div>
      ) : shownTotal === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 text-center">
          <Search size={26} className="mx-auto text-gray-300" />
          <p className="text-sm font-bold text-gray-800 mt-3">No shipment matches “{searchText.trim()}”</p>
          <p className="text-xs text-gray-500 mt-1">
            {effFilter === 'all' ? 'Check the spelling, or search by phone number, order number or AWB.' : `Only “${BUCKET_META[effFilter].label}” is showing. Try All.`}
          </p>
          <div className="mt-3 flex justify-center gap-2">
            <button type="button" onClick={() => setQuery('')}
              className="text-xs font-bold text-gray-700 border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50">
              Clear search
            </button>
            {effFilter !== 'all' && (
              <button type="button" onClick={() => setFilter('all')}
                className="text-xs font-bold text-gray-700 border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50">
                Search all
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {LIST_BUCKETS.filter((b) => page[b].length).map((b) => {
            const M = BUCKET_META[b]; const Ic = BUCKET_ICON[b];
            return (
              <section key={b}>
                {/* In "All", each stage gets its own heading; one tab needs none. */}
                {effFilter === 'all' && (
                  <div className="flex items-center gap-2 px-0.5 mb-2">
                    <span className={`w-5 h-5 rounded-md grid place-items-center ${M.chip}`}><Ic size={12} /></span>
                    <h3 className={`text-[12.5px] font-extrabold ${M.tone === 'red' ? 'text-red-700' : 'text-gray-700'}`}>{M.label}</h3>
                    <span className="text-[11px] font-bold text-gray-400 tabular-nums">{shown(b).length}</span>
                  </div>
                )}
                <ul className="bg-white rounded-2xl border border-gray-100 shadow-sm divide-y divide-gray-100 overflow-hidden">
                  {page[b].map((o) => (
                    <OrderCard key={o.id} o={o} bucket={b} themeColor={themeColor} onOpen={setActive} />
                  ))}
                </ul>
              </section>
            );
          })}

          {/* A page size, never a cap: every shipment is one tap away. */}
          {remaining > 0 && (
            <div className="flex flex-col items-center gap-2 pt-1">
              <button type="button"
                onClick={() => setMore({ view, n: visible + LIST_PAGE_SIZE })}
                className="px-6 py-3 rounded-xl bg-white border border-gray-200 text-sm font-bold text-gray-800
                           shadow-sm hover:bg-gray-50 active:scale-[0.98] transition-all">
                Show {Math.min(LIST_PAGE_SIZE, remaining)} more
              </button>
              <p className="text-xs text-gray-400">Showing {Math.min(visible, shownTotal)} of {shownTotal} shipments</p>
            </div>
          )}
        </div>
      )}

      {/* ── Totals, below the list: canonical, uncapped, current state ───────
          Counts are the point; money is subtext. Delivery Orders is exactly
          Delivered + Returned + In Flight - orders with no AWB are a separate
          queue and are deliberately not in that sum. */}
      <div className="mt-6">
      {!summaryOk ? (
        <div className="rounded-2xl border border-amber-100 bg-amber-50/60 px-4 py-3.5 flex items-center gap-3" role="alert">
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
        <div className="rounded-2xl border border-gray-100 bg-white shadow-sm px-4 py-3.5">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-[10.5px] font-bold uppercase tracking-widest text-gray-400">Shipments so far</p>
            <p className="text-[11px] font-bold text-gray-700 tabular-nums">
              {summary.orders.count} <span className="font-semibold text-gray-400">· {formatINR(Math.round(summary.orders.amount))}</span>
            </p>
          </div>
          <dl className="mt-2.5 grid grid-cols-3 gap-2">
            <div className="rounded-xl bg-gray-50 px-3 py-2.5"><dt className="text-[11px] font-semibold text-gray-500">Delivered</dt>
              <dd className="text-lg font-extrabold text-blue-700 tabular-nums leading-tight">{summary.delivered.count}</dd></div>
            <div className="rounded-xl bg-gray-50 px-3 py-2.5"><dt className="text-[11px] font-semibold text-gray-500">In flight</dt>
              <dd className="text-lg font-extrabold text-amber-700 tabular-nums leading-tight">{summary.inFlight.count}</dd></div>
            <div className="rounded-xl bg-gray-50 px-3 py-2.5"><dt className="text-[11px] font-semibold text-gray-500">Returned</dt>
              <dd className="text-lg font-extrabold text-rose-700 tabular-nums leading-tight">{summary.returned.count}</dd></div>
          </dl>
          {/* The population is in the label on purpose. Payments owns "Still to
              collect", which covers every method and every unshipped order;
              this is only COD riding on shipments still in flight. */}
          <div className="mt-2 flex items-center justify-between gap-3 rounded-xl bg-amber-50/70 px-3 py-2.5">
            <p className="text-[12px] font-semibold text-gray-600 leading-snug">
              COD on shipments not yet delivered
              <span className="block text-[10.5px] text-gray-400">{summary.codOnUndelivered.count} shipment{summary.codOnUndelivered.count === 1 ? '' : 's'}</span>
            </p>
            <p className="text-lg font-extrabold text-gray-900 tabular-nums">{formatINR(Math.round(summary.codOnUndelivered.amount))}</p>
          </div>
          {(summary.notShipped.count > 0 || summary.deliveredPaymentPending.count > 0
            || summary.cancelledShipments.count > 0) && (
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
              {/* Outside the three counts above on purpose: nothing is moving,
                  so it is not a fulfilment state. The ORDER is still live. */}
              {summary.cancelledShipments.count > 0 && (
                <p className="text-[11px] text-gray-500">
                  <span className="font-bold text-gray-700">{summary.cancelledShipments.count} cancelled by the courier</span>
                  {' '}&mdash; {formatINR(Math.round(summary.cancelledShipments.amount))}, order still open
                </p>
              )}
            </div>
          )}
        </div>
      )}
      </div>

      {active && (
        <TrackDrawer o={active} bucket={classifyBucket(active)} slug={slug} pin={pin}
          themeColor={themeColor} storeName={storeName} onClose={() => setActive(null)} />
      )}
    </div>
  );
}

// What is in the parcel, in one line.
function itemsLine(o) {
  const items = Array.isArray(o.items) ? o.items : [];
  return items.length
    ? items.map((i) => `${i.name}${i.qty > 1 ? ` × ${i.qty}` : ''}`).join(', ')
    : `${o.item_count || 1} item${(o.item_count || 1) === 1 ? '' : 's'}`;
}

// The day the order came in ("12 Nov"), so an old parcel stands out.
function orderDay(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  try { return new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }); } catch { return ''; }
}

// One shipment, one compact row: who, where it is now, which courier, how much.
// Memoised, with onOpen taking the order, so a row redraws only when its own
// shipment changes, not on every keystroke of the search.
const OrderCard = memo(function OrderCard({ o, bucket, themeColor, onOpen }) {
  const M = BUCKET_META[bucket];
  const Ic = BUCKET_ICON[bucket] || Truck;
  const open = () => onOpen(o);
  const c = courierInfo(o.courier);
  const isCod = o.payment_method === 'cod';
  const codCollected = isCod && bucket === 'delivered';   // COD delivered = cash taken at the door
  const phone = last10(o.customer_phone);
  const attention = bucket === 'attention';
  const day = orderDay(o.created_at);

  return (
    <li className={attention ? 'bg-red-50/40' : ''}>
      <button type="button" onClick={open} className="w-full text-left flex items-center gap-3 px-3.5 sm:px-4 py-3 hover:bg-gray-50/80 transition-colors">
        <span className={`w-10 h-10 rounded-xl grid place-items-center flex-shrink-0 ${M.chip}`}><Ic size={17} /></span>
        <span className="flex-1 min-w-0">
          <span className="flex items-baseline gap-1.5 min-w-0">
            <span className="font-bold text-[14.5px] text-gray-900 truncate">{o.customer_name || 'Customer'}</span>
            <span className="text-[12px] font-semibold text-gray-400 flex-shrink-0">#{shipmentRef(o)}</span>
          </span>
          <span className="flex items-center gap-1.5 mt-1 min-w-0">
            <span className={`flex-shrink-0 text-[11px] font-bold px-2 py-0.5 rounded-full ${M.chip}`}>{prettyStatus(o.shipment_status)}</span>
            <span className="text-[12px] text-gray-500 truncate">{c.name} · <span className="font-mono text-[11.5px]">{o.awb}</span></span>
          </span>
          <span className="block text-[12px] text-gray-400 truncate mt-0.5">{itemsLine(o)}{day ? ` · ${day}` : ''}</span>
        </span>
        <span className="text-right flex-shrink-0">
          <span className="block text-[15px] font-extrabold text-gray-900 tabular-nums leading-none">{formatINR(o.total || 0)}</span>
          <span className={`inline-block mt-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
            codCollected ? 'bg-emerald-100 text-emerald-700'
            : isCod ? 'bg-amber-50 text-amber-700 border border-amber-200'
            : 'bg-emerald-50 text-emerald-700'}`}>
            {codCollected ? '✓ Collected' : isCod ? 'COD' : 'Paid'}
          </span>
        </span>
        <ChevronRight size={16} className="text-gray-300 flex-shrink-0 hidden sm:block" />
      </button>

      {attention && (
        <div className="flex gap-2 px-3.5 sm:px-4 pb-3 sm:pl-[68px]">
          <a href={phone ? `tel:+91${phone}` : undefined}
            className={`flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 text-[12px] font-bold px-3 py-2 rounded-xl border bg-white ${phone ? 'text-gray-800 border-gray-200 hover:bg-gray-50' : 'text-gray-300 border-gray-100 pointer-events-none'}`}>
            <Phone size={13} /> Call customer
          </a>
          <button type="button" onClick={open}
            className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 text-[12px] font-bold px-3 py-2 rounded-xl text-white active:scale-95"
            style={{ backgroundColor: themeColor }}>
            <MapPin size={13} /> Track & fix
          </button>
        </div>
      )}
    </li>
  );
});

function TrackDrawer({ o, bucket, slug, pin, themeColor, storeName, onClose }) {
  const M = BUCKET_META[bucket];
  const c = courierInfo(o.courier);
  const isCod = o.payment_method === 'cod';
  const phone = last10(o.customer_phone);
  const firstName = (o.customer_name || 'customer').trim().split(' ')[0];

  const [data, setData] = useState(null);   // track result
  const [err, setErr]   = useState('');
  // The buyer's answer to a missed delivery (order page), and sending it on.
  const [re, setRe] = useState({ busy: false, sent: Boolean(o.delivery_choice_sent_at), msg: '' });
  async function sendReattempt() {
    setRe({ busy: true, sent: false, msg: '' });
    try {
      await shipmentOp(slug, pin, o.id, 'reattempt');
      setRe({ busy: false, sent: true, msg: `Sent. ${c.name} will try again on its next delivery run.` });
    } catch (e) {
      setRe({ busy: false, sent: false, msg: e.message || 'Could not send it.' });
    }
  }

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
            <div className="flex-1 min-w-0">
              <p className="text-lg font-extrabold text-gray-900 leading-tight">
                {o.customer_name || 'Customer'} <span className="text-[13px] font-semibold text-gray-400">#{shipmentRef(o)}</span>
              </p>
              <p className="text-[12px] text-gray-500 mt-0.5 line-clamp-2">{itemsLine(o)}{orderDay(o.created_at) ? ` · ordered ${orderDay(o.created_at)}` : ''}</p>
              {o.destination && (
                <p className="text-[12px] text-gray-500 mt-0.5 flex items-start gap-1"><MapPin size={12} className="mt-0.5 flex-shrink-0 text-gray-400" /><span className="line-clamp-2">{o.destination}</span></p>
              )}
            </div>
            <button onClick={onClose} aria-label="Close" className="w-8 h-8 grid place-items-center rounded-full border border-gray-200 text-gray-500 hover:bg-gray-50 flex-shrink-0"><X size={16} /></button>
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

          {/* The customer's own answer, from their order page */}
          {o.delivery_choice && bucket === 'attention' && (
            <div className="rounded-2xl border border-gray-100 bg-white p-4 mb-4 space-y-2">
              <p className="text-[13px] text-gray-900">
                {firstName} replied: <b>“{DELIVERY_CHOICE_LABEL[o.delivery_choice] || o.delivery_choice}”</b>
              </p>
              {o.delivery_choice_address && (
                <p className="text-[12px] text-gray-700"><span className="font-semibold">New address:</span> {o.delivery_choice_address}</p>
              )}
              {o.delivery_choice === 'reattempt' && c.key === 'delhivery' && (
                <button type="button" onClick={sendReattempt} disabled={re.busy || re.sent}
                  className={`${btn} w-full text-white disabled:opacity-60`} style={{ backgroundColor: re.sent ? '#059669' : '#dc2626' }}>
                  {re.busy ? 'Sending…' : re.sent ? 'Sent to Delhivery ✓' : 'Ask Delhivery to deliver again'}
                </button>
              )}
              {(o.delivery_choice !== 'reattempt' || c.key !== 'delhivery') && (
                <p className="text-[11.5px] text-gray-500">
                  {o.delivery_choice === 'cancel'
                    ? `Call ${firstName} once more, then cancel or let ${c.name} return it.`
                    : `Tell ${c.name} support or the rider; ${c.name} doesn’t take this through PocketLink.`}
                </p>
              )}
              {re.msg && <p className={`text-[11.5px] ${re.sent ? 'text-emerald-700' : 'text-red-600'}`}>{re.msg}</p>}
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

import { useEffect, useState, useCallback } from 'react';
import { useParams, useLocation, Link } from 'react-router-dom';
import {
  CheckCircle2, XCircle, PackageCheck, Loader2, Truck, MapPin,
  AlertTriangle, MessageCircle, Package, Star, Copy, Check,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { formatINR } from '../utils/currency';
import { buildTimeline, heroStyle, courierName } from '../utils/orderTimeline';

/**
 * OrderTracking — the buyer's page for one order, served at two routes:
 *
 *   /confirm/<token>   the link inside the WhatsApp order message. Confirms the
 *                      order on arrival, then shows the page.
 *   /order/<token>     the same page, read-only. Reachable from the checkout
 *                      success screen and from the seller's Delivery board.
 *
 * Both use orders.confirm_token, so the buyer's original WhatsApp message keeps
 * working as their tracking link for the life of the order — nothing extra to send.
 *
 * Why confirmation runs from JS and not the plain GET: chat apps fetch URLs to
 * build link previews. If the request itself confirmed the order, a preview
 * crawler could confirm orders nobody tapped. Crawlers don't run this.
 *
 * The token IS the credential (there is no login) and buyers forward WhatsApp
 * messages, so get_order_by_token deliberately withholds phone, street address
 * and notes — see supabase/order-tracking.sql.
 */

const HERO_ICON = {
  check: CheckCircle2, box: PackageCheck, truck: Truck,
  pin: MapPin, alert: AlertTriangle, x: XCircle,
};

function fmtDate(iso, withTime = true) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const day = d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  if (!withTime) return day;
  return `${day}, ${d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;
}

/** One row of the progress list. */
function Step({ step, last }) {
  const done  = step.state === 'done';
  const now   = step.state === 'now';
  const issue = step.state === 'issue';
  const dot   = issue ? 'bg-red-500' : (done ? 'bg-emerald-500' : now ? 'bg-indigo-500' : 'bg-gray-200');
  return (
    <li className="flex gap-3 relative pb-3.5 last:pb-0">
      {!last && (
        <span className={`absolute left-[7px] top-4 bottom-0 w-0.5 rounded ${done ? 'bg-emerald-500' : 'bg-gray-200'}`} />
      )}
      <span className={`w-4 h-4 rounded-full flex-shrink-0 z-[1] grid place-items-center text-white
                        ring-2 ring-white ${dot} ${now ? 'shadow-[0_0_0_4px_rgba(79,70,229,0.16)]' : ''}`}>
        {done && <Check size={9} strokeWidth={4} />}
      </span>
      <div className="-mt-0.5">
        <p className={`text-[13px] leading-tight ${
          done || now || issue ? 'font-semibold text-gray-900' : 'text-gray-400'}`}>
          {step.label}
        </p>
        {(step.at || step.hint) && (
          <p className="text-[11px] text-gray-400 mt-0.5">
            {step.hint || fmtDate(step.at)}
          </p>
        )}
      </div>
    </li>
  );
}

export default function OrderTracking() {
  const { token }  = useParams();
  const { pathname } = useLocation();
  const isConfirmRoute = pathname.startsWith('/confirm');

  // Derive the no-token case from the initial state rather than setState-ing
  // synchronously inside the effect.
  const [state, setState] = useState(token ? 'loading' : 'invalid'); // loading | ready | invalid | error
  const [data,  setData]  = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const { data: d, error } = await supabase.rpc('get_order_by_token', { p_token: token });
    if (error) return { ok: false, err: true };
    return d || { ok: false };
  }, [token]);

  useEffect(() => {
    let alive = true;
    if (!token) return undefined;

    (async () => {
      try {
        // Arriving from the WhatsApp button confirms first, then reads back the
        // fresh row so the page reflects the confirmation immediately.
        //
        // NOTE: supabase.rpc() returns a thenable, NOT a Promise — it implements
        // .then but has no .catch. Calling .catch() on it throws a TypeError that
        // lands in the outer catch and shows "Something went wrong" instead of
        // the order. Errors surface on the returned { error } field, so a plain
        // await inside its own try is the correct shape here.
        if (isConfirmRoute) {
          try {
            await supabase.rpc('confirm_order_by_token', { p_token: token });
          } catch { /* a failed confirm must not stop the order rendering */ }
        }
        const d = await load();
        if (!alive) return;
        if (d.err)  { setState('error');   return; }
        if (!d.ok)  { setState('invalid'); return; }
        setData(d);
        setState('ready');
      } catch {
        if (alive) setState('error');
      }
    })();

    return () => { alive = false; };
  }, [token, isConfirmRoute, load]);

  async function confirmNow() {
    setConfirming(true);
    try {
      await supabase.rpc('confirm_order_by_token', { p_token: token });
      const d = await load();
      if (d.ok) setData(d);
    } catch { /* leave the page as-is; the buyer can retry */ }
    setConfirming(false);
  }

  function copyAwb(awb) {
    // Optional-chaining the call still leaves `.then` on undefined when the
    // Clipboard API is missing (older Android WebViews, non-HTTPS contexts).
    const p = navigator.clipboard?.writeText(awb);
    if (!p) return;
    p.then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    }).catch(() => {});
  }

  // ── Non-ready states ───────────────────────────────────────────────────────
  if (state !== 'ready') {
    return (
      <div className="min-h-screen bg-gradient-to-b from-emerald-50/60 via-white to-white
                      flex flex-col items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm bg-white rounded-3xl border border-gray-100 shadow-sm p-7 text-center">
          {state === 'loading' ? (
            <>
              <Loader2 size={38} className="mx-auto text-emerald-500 animate-spin mb-4" />
              <p className="text-sm text-gray-500">Loading your order…</p>
            </>
          ) : (
            <>
              <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
                <XCircle size={34} className="text-gray-400" strokeWidth={2.2} />
              </div>
              <h1 className="text-xl font-extrabold text-gray-900">
                {state === 'error' ? 'Something went wrong' : 'This link is not valid'}
              </h1>
              <p className="text-sm text-gray-500 mt-1.5">
                {state === 'error'
                  ? 'Please check your connection and open the link again.'
                  : 'The link may be incorrect or the order no longer exists.'}
              </p>
            </>
          )}
        </div>
        <p className="text-[11px] text-gray-400 mt-6">
          Secured by <span className="font-semibold text-gray-500">PocketLink</span>
        </p>
      </div>
    );
  }

  // ── Ready ──────────────────────────────────────────────────────────────────
  const store = data.store || {};
  const o     = data.order || {};
  const { hero, steps, note, cod, delivered, cancelled, shipped } = buildTimeline(o);
  const Icon  = HERO_ICON[hero.icon] || CheckCircle2;
  const brand = store.color || '#0d9488';
  const items = Array.isArray(o.items) ? o.items : [];
  const wa    = String(store.whatsapp || '').replace(/\D/g, '');
  const waMsg = encodeURIComponent(`Hi, about my order #${o.ref}`);

  const card = 'bg-white rounded-2xl border border-gray-100 p-4';
  const lbl  = 'text-[10px] font-bold uppercase tracking-wide text-gray-400 mb-2.5';

  return (
    <div className="min-h-screen bg-[#f8fafc] flex flex-col items-center px-4 py-6">
      <div className="w-full max-w-sm space-y-3">

        {/* Store */}
        <div className="bg-white rounded-2xl border border-gray-100 px-4 py-3 flex items-center gap-3">
          {store.logo
            ? <img src={store.logo} alt="" className="w-10 h-10 rounded-xl object-cover flex-shrink-0" />
            : <span className="w-10 h-10 rounded-xl grid place-items-center text-white font-extrabold text-sm flex-shrink-0"
                    style={{ background: brand }}>
                {(store.name || '?').slice(0, 2).toUpperCase()}
              </span>}
          <div className="min-w-0">
            <p className="font-bold text-[14px] text-gray-900 leading-tight truncate">{store.name}</p>
            <p className="text-[11px] text-gray-400">Order #{o.ref}</p>
          </div>
        </div>

        {/* Status hero */}
        <div className="rounded-2xl p-5 text-center text-white" style={heroStyle(hero.tone)}>
          <div className="w-11 h-11 rounded-full bg-white/20 grid place-items-center mx-auto mb-2.5">
            <Icon size={22} strokeWidth={2.3} />
          </div>
          <p className="text-lg font-extrabold leading-tight">{hero.title}</p>
          <p className="text-[12px] opacity-90 mt-1">{hero.sub}</p>
          {o.city && !cancelled && (
            <p className="text-[11px] opacity-75 mt-2 flex items-center justify-center gap-1">
              <MapPin size={11} /> Delivering to {o.city}
            </p>
          )}
        </div>

        {/* Buyer hasn't confirmed yet — the whole point of the flow. */}
        {!o.confirmedAt && !cancelled && !delivered && (
          <button type="button" onClick={confirmNow} disabled={confirming}
            className="w-full py-3.5 rounded-2xl text-white text-sm font-bold active:scale-[0.98]
                       transition disabled:opacity-60"
            style={{ background: brand }}>
            {confirming ? 'Confirming…' : '✓ Confirm my order'}
          </button>
        )}

        {/* Cash not being ready is a real cause of failed COD attempts. */}
        {cod && hero.tone === 'indigo' && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3.5 flex gap-2.5">
            <span className="text-base leading-none">💵</span>
            <div>
              <p className="text-[12px] font-bold text-amber-900">Keep {formatINR(o.total)} ready</p>
              <p className="text-[11px] text-amber-700 mt-0.5">This is a Cash on Delivery order.</p>
            </div>
          </div>
        )}

        {/* Progress */}
        <div className={card}>
          <p className={lbl}>Progress</p>
          <ul className="flex flex-col">
            {steps.map((s, i) => <Step key={s.key} step={s} last={i === steps.length - 1} />)}
          </ul>
          {note && (
            <p className="text-[11px] text-gray-500 leading-relaxed mt-3 pt-3 border-t border-dashed border-gray-200">
              {note}
            </p>
          )}
        </div>

        {/* Shipment */}
        {shipped && (
          <div className={card}>
            <p className={lbl}>Shipment</p>
            <div className="flex items-center justify-between text-[12px] py-1">
              <span className="text-gray-500">Courier</span>
              <span className="font-semibold text-gray-900">{courierName(o.courier)}</span>
            </div>
            <div className="flex items-center justify-between text-[12px] py-1 gap-2">
              <span className="text-gray-500 flex-shrink-0">Tracking no.</span>
              <button type="button" onClick={() => copyAwb(o.awb)}
                className="font-mono text-[11px] bg-gray-50 border border-gray-100 rounded-lg
                           px-2 py-1 text-gray-700 flex items-center gap-1.5 min-w-0">
                <span className="truncate">{o.awb}</span>
                {copied ? <Check size={11} className="text-emerald-600 flex-shrink-0" />
                        : <Copy size={11} className="text-gray-400 flex-shrink-0" />}
              </button>
            </div>
          </div>
        )}

        {/* Items */}
        <div className={card}>
          <p className={lbl}>Your order</p>
          {items.map((it, i) => (
            <div key={i} className="flex items-start justify-between gap-3 text-[12px] py-1">
              <span className="text-gray-600">
                {it.qty}× {it.name}
                {it.variant && <span className="text-gray-400"> · {it.variant}</span>}
              </span>
              <span className="font-semibold text-gray-900 tabular-nums flex-shrink-0">
                {formatINR(Number(it.price) * Number(it.qty || 1))}
              </span>
            </div>
          ))}
          <div className="border-t border-dashed border-gray-200 my-2.5" />
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-extrabold text-gray-900">
              {o.paid ? 'Paid' : 'Total'}
            </span>
            <span className="text-[15px] font-extrabold text-gray-900 tabular-nums">
              {formatINR(o.total)}
            </span>
          </div>
          <div className="mt-2">
            {o.paid
              ? <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full bg-emerald-100 text-emerald-700">✓ PAID</span>
              : cod
                ? <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full bg-amber-100 text-amber-700">CASH ON DELIVERY</span>
                : null}
          </div>
        </div>

        {/* Delivered is the best moment we'll ever get to ask for a review. */}
        {delivered && store.slug && (
          <a href={`/${store.slug}?review=1#reviews`}
             className={`${card} block text-center hover:border-gray-200 transition`}>
            <p className="text-[13px] font-bold text-gray-900">How was your order?</p>
            <div className="flex items-center justify-center gap-1 my-2">
              {[0, 1, 2, 3, 4].map((i) => <Star key={i} size={19} className="text-amber-400 fill-amber-400" />)}
            </div>
            <p className="text-[11px] text-gray-400">Tap to rate {store.name}</p>
          </a>
        )}

        {/* Actions */}
        <div className="space-y-2 pt-1">
          {delivered && store.slug && (
            <Link to={`/${store.slug}`}
              className="flex items-center justify-center gap-2 w-full py-3 rounded-2xl text-white
                         text-sm font-bold active:scale-[0.98] transition"
              style={{ background: brand }}>
              <Package size={15} /> Order again
            </Link>
          )}
          {wa && (
            <a href={`https://wa.me/${wa}?text=${waMsg}`} target="_blank" rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full py-3 rounded-2xl bg-white
                         border border-gray-200 text-gray-800 text-sm font-bold active:scale-[0.98] transition">
              <MessageCircle size={15} /> Message the shop
            </a>
          )}
          {!delivered && store.slug && (
            <Link to={`/${store.slug}`}
              className="block text-center text-[12px] font-semibold text-gray-400 py-1.5 hover:text-gray-600">
              Continue shopping
            </Link>
          )}
        </div>
      </div>

      <p className="text-[11px] text-gray-400 mt-6 mb-2">
        Secured by <span className="font-semibold text-gray-500">PocketLink</span>
      </p>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { CheckCircle2, XCircle, PackageCheck, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { formatINR } from '../utils/currency';

/**
 * ConfirmOrder — the page a buyer lands on from the "Confirm my order" button
 * in their WhatsApp order message (pocketlink.store/confirm/<token>).
 *
 * Why this is a page and not a plain link that confirms server-side: WhatsApp
 * (and other chat apps) fetch URLs to build link previews. If the mere HTTP GET
 * confirmed the order, a preview crawler could confirm orders nobody tapped.
 * The confirmation runs from JS here, which those crawlers don't execute — so a
 * real human tap is what records it.
 *
 * The token IS the credential (there is no login), so the RPC deliberately
 * returns only what the buyer needs to recognise their own order — never the
 * phone number, address or notes.
 */
export default function ConfirmOrder() {
  const { token } = useParams();
  // Derive the no-token case from the initial state rather than setState-ing
  // synchronously inside the effect.
  const [state, setState] = useState(token ? 'loading' : 'invalid');   // loading | ok | already | invalid | cancelled | error
  const [order, setOrder] = useState(null);

  useEffect(() => {
    let alive = true;
    if (!token) return;

    (async () => {
      try {
        const { data, error } = await supabase.rpc('confirm_order_by_token', { p_token: token });
        if (!alive) return;
        if (error) { setState('error'); return; }
        if (!data?.ok) { setState(data?.reason === 'cancelled' ? 'cancelled' : 'invalid'); return; }
        setOrder(data);
        setState(data.already ? 'already' : 'ok');
      } catch {
        if (alive) setState('error');
      }
    })();

    return () => { alive = false; };
  }, [token]);

  const confirmed = state === 'ok' || state === 'already';

  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-50/60 via-white to-white flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm bg-white rounded-3xl border border-gray-100 shadow-sm p-7 text-center">

        {state === 'loading' && (
          <>
            <Loader2 size={38} className="mx-auto text-emerald-500 animate-spin mb-4" />
            <p className="text-sm text-gray-500">Confirming your order…</p>
          </>
        )}

        {confirmed && (
          <>
            <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 size={34} className="text-emerald-600" strokeWidth={2.2} />
            </div>
            <h1 className="text-xl font-extrabold text-gray-900">
              {state === 'already' ? 'Already confirmed' : 'Order confirmed!'}
            </h1>
            <p className="text-sm text-gray-500 mt-1.5">
              {state === 'already'
                ? 'Thanks — we already have your confirmation.'
                : 'Thank you! Your order is confirmed.'}
            </p>

            <div className="mt-5 rounded-2xl bg-gray-50 border border-gray-100 p-4 text-left">
              <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400">Your order</p>
              <p className="text-sm font-bold text-gray-900 mt-1">{order.store}</p>
              <div className="flex items-center justify-between mt-2 text-sm">
                <span className="text-gray-500">
                  {order.items} item{Number(order.items) === 1 ? '' : 's'}
                </span>
                <span className="font-extrabold text-gray-900 tabular-nums">{formatINR(order.total)}</span>
              </div>
            </div>

            <p className="flex items-center justify-center gap-1.5 text-xs text-emerald-700 font-semibold mt-4">
              <PackageCheck size={14} /> The shop will pack and ship it now.
            </p>

            {order.slug && (
              <Link to={`/${order.slug}`}
                    className="mt-5 inline-block w-full py-3 rounded-xl bg-emerald-600 text-white text-sm font-bold
                               hover:bg-emerald-700 active:scale-[0.98] transition">
                Continue shopping
              </Link>
            )}
          </>
        )}

        {(state === 'invalid' || state === 'cancelled' || state === 'error') && (
          <>
            <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
              <XCircle size={34} className="text-gray-400" strokeWidth={2.2} />
            </div>
            <h1 className="text-xl font-extrabold text-gray-900">
              {state === 'cancelled' ? 'This order was cancelled'
                : state === 'error' ? 'Something went wrong'
                : 'This link is not valid'}
            </h1>
            <p className="text-sm text-gray-500 mt-1.5">
              {state === 'cancelled'
                ? 'It can no longer be confirmed. Please contact the shop if this looks wrong.'
                : state === 'error'
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

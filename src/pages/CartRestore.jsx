import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Loader2, ShoppingCart } from 'lucide-react';
import { fetchCartReminder } from '../utils/cartReminderService';
import { saveRestoreIntent } from '../utils/cartRestore';
import { saveMessageAttribution } from '../utils/messageAttribution';
import { storePath } from '../utils/storeUrls';

/**
 * CartRestore — /cart/<token>, the "Complete my order" link in the automatic
 * WhatsApp cart reminder.
 *
 * Looks the token up (get_cart_reminder: the shop and the items, nothing
 * personal), leaves the items for that shop's page, and opens the shop, which
 * refills the cart from its current catalogue and opens it (cartRestore.js).
 *
 * Like /confirm/<token>, this runs from JS rather than on the plain GET, so a
 * chat app building a link preview never counts as the customer's click.
 */
export default function CartRestore() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchCartReminder(token).then((r) => {
      if (!alive) return;
      if (!r) { setExpired(true); return; }
      saveRestoreIntent(r.store_slug, r.items);
      saveMessageAttribution(r.store_slug, 'cart', token);   // so the order is tagged to this reminder
      navigate(storePath(r.store_slug), { replace: true });
    });
    return () => { alive = false; };
  }, [token, navigate]);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-gray-100 bg-white shadow-sm p-6 text-center">
        {expired ? (
          <>
            <ShoppingCart size={28} className="mx-auto text-gray-300" />
            <p className="mt-3 text-sm font-bold text-gray-900">This cart link has expired</p>
            <p className="mt-1 text-xs text-gray-500">Open the shop again from its WhatsApp message or link to order.</p>
            <Link to="/" className="mt-4 inline-flex items-center justify-center px-4 py-2.5 rounded-xl bg-gray-900 text-white text-xs font-bold">
              Go to PocketLink
            </Link>
          </>
        ) : (
          <>
            <Loader2 size={24} className="mx-auto text-gray-400 animate-spin" />
            <p className="mt-3 text-sm font-semibold text-gray-700">Opening your cart…</p>
          </>
        )}
      </div>
    </div>
  );
}

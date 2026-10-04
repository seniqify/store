import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Loader2, Store } from 'lucide-react';
import { fetchOfferLink } from '../utils/cartReminderService';
import { saveMessageAttribution } from '../utils/messageAttribution';
import { storePath } from '../utils/storeUrls';

/**
 * OfferLink — /o/<token>, the "Shop now" button in a WhatsApp offer.
 *
 * Looks the token up (get_offer_link: which shop, nothing else; the first click
 * is recorded), remembers that this customer came from that offer so an order
 * placed now is tagged to it, and opens the shop. Runs from JS, like
 * /cart/<token>, so a chat app building a link preview is never a click.
 */
export default function OfferLink() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchOfferLink(token).then((r) => {
      if (!alive) return;
      if (!r) { setExpired(true); return; }
      saveMessageAttribution(r.store_slug, 'offer', token);
      navigate(storePath(r.store_slug), { replace: true });
    });
    return () => { alive = false; };
  }, [token, navigate]);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-gray-100 bg-white shadow-sm p-6 text-center">
        {expired ? (
          <>
            <Store size={28} className="mx-auto text-gray-300" />
            <p className="mt-3 text-sm font-bold text-gray-900">This offer link has expired</p>
            <p className="mt-1 text-xs text-gray-500">Open the shop from its WhatsApp message or link to see what&rsquo;s on now.</p>
            <Link to="/" className="mt-4 inline-flex items-center justify-center px-4 py-2.5 rounded-xl bg-gray-900 text-white text-xs font-bold">
              Go to PocketLink
            </Link>
          </>
        ) : (
          <>
            <Loader2 size={24} className="mx-auto text-gray-400 animate-spin" />
            <p className="mt-3 text-sm font-semibold text-gray-700">Opening the shop…</p>
          </>
        )}
      </div>
    </div>
  );
}

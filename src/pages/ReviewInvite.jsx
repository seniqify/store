import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Star, BadgeCheck, Loader2, CheckCircle2, AlertTriangle, Package } from 'lucide-react';
import { getReviewInvite, submitInviteReview } from '../utils/reviewService';

/**
 * ReviewInvite — /review/<token>. The only place a review can be written.
 *
 * The seller creates the link from a DELIVERED order (Manage → Orders → Ask for
 * a review) and sends it on WhatsApp. The token is the credential: it names one
 * order, each item in it gets one review, and the customer can come back and
 * edit. Store, product and the "Verified purchase" badge are set by the server
 * from the token (submit_review); nothing on this page can change them.
 */

const STATE_COPY = {
  invalid:     { title: 'This review link doesn’t work', body: 'Check that the whole link was copied, or ask the store to send it again.' },
  replaced:    { title: 'This link was replaced', body: 'The store sent you a newer review link. Please open the latest one.' },
  expired:     { title: 'This review link has expired', body: 'Review links work for 60 days. Ask the store to send a new one.' },
  unavailable: { title: 'This order can’t be reviewed', body: 'Only delivered orders can be reviewed.' },
  error:       { title: 'Couldn’t open your review', body: 'Check your internet connection and try again.' },
};

const RATING_WORDS = ['', 'Bad', 'Not good', 'Okay', 'Good', 'Excellent'];

function StarPicker({ value, onPick, disabled }) {
  return (
    <div className="flex items-center gap-1" role="radiogroup" aria-label="Your rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" disabled={disabled} onClick={() => onPick(n)}
                role="radio" aria-checked={value === n} aria-label={`${n} star${n > 1 ? 's' : ''}`}
                className="p-1 rounded-lg active:scale-90 transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 disabled:opacity-60">
          <Star size={30} className={n <= value ? 'fill-amber-400 text-amber-400' : 'fill-gray-100 text-gray-300'} />
        </button>
      ))}
    </div>
  );
}

function ItemReview({ token, item, name, ads, brand, onSaved }) {
  const existing = item.review;
  const locked   = Boolean(existing) && existing.status !== 'published';
  const [rating, setRating]   = useState(existing?.rating || 0);
  const [body, setBody]       = useState(existing?.body || '');
  const [editing, setEditing] = useState(!existing);
  const [busy, setBusy]       = useState(false);
  const [err, setErr]         = useState('');
  const [justSaved, setJustSaved] = useState(false);

  async function save() {
    setErr('');
    if (rating < 1)   { setErr('Tap a star rating first.'); return; }
    if (!name.trim()) { setErr('Add your name at the top of the page.'); return; }
    setBusy(true);
    try {
      await submitInviteReview(token, {
        itemIndex: item.index, rating, body, displayName: name, consentAdvertising: ads,
      });
      onSaved(item.index, { ...(existing || {}), rating, body: body.trim(), displayName: name.trim(), status: 'published' });
      setEditing(false);
      setJustSaved(true);
    } catch (e) {
      setErr(e.message || 'Could not save your review. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-4">
      <div className="flex items-center gap-3">
        {item.image ? (
          <img src={item.image} alt="" className="w-14 h-14 rounded-xl object-cover bg-gray-50 flex-shrink-0" loading="lazy" />
        ) : (
          <span className="w-14 h-14 rounded-xl bg-gray-50 flex items-center justify-center flex-shrink-0">
            <Package size={20} className="text-gray-300" />
          </span>
        )}
        <div className="min-w-0">
          <p className="text-sm font-bold text-gray-900 leading-snug">{item.name || 'Item'}</p>
          {item.variant && <p className="text-xs text-gray-400 mt-0.5 truncate">{item.variant}</p>}
        </div>
      </div>

      {locked ? (
        <p className="mt-3 text-xs text-gray-500 bg-gray-50 rounded-xl px-3 py-2.5">
          This review was removed after a report and can’t be changed.
        </p>
      ) : editing ? (
        <div className="mt-3 space-y-3">
          <div>
            <StarPicker value={rating} onPick={setRating} disabled={busy} />
            <p className="text-xs font-semibold text-gray-500 mt-1 h-4">{RATING_WORDS[rating]}</p>
          </div>
          <label className="block">
            <span className="sr-only">Your review</span>
            <textarea rows={3} maxLength={1000} value={body} onChange={(e) => setBody(e.target.value)} disabled={busy}
                      placeholder="What did you like or not like? (optional)"
                      className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-gray-300 resize-none" />
            <span className="block text-right text-[10px] text-gray-400 tabular-nums">{body.length}/1000</span>
          </label>
          {err && <p className="text-xs text-red-500" role="alert">{err}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={save} disabled={busy}
                    className="flex-1 py-3 rounded-xl text-sm font-bold text-white active:scale-[0.98] disabled:opacity-60 inline-flex items-center justify-center gap-2"
                    style={{ backgroundColor: brand }}>
              {busy ? <><Loader2 size={15} className="animate-spin" /> Saving…</> : existing ? 'Save changes' : 'Post review'}
            </button>
            {existing && (
              <button type="button" onClick={() => { setEditing(false); setRating(existing.rating); setBody(existing.body || ''); setErr(''); }}
                      disabled={busy}
                      className="px-4 py-3 rounded-xl border border-gray-200 text-sm text-gray-500 hover:text-gray-700">
                Cancel
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="mt-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center">
              {[1, 2, 3, 4, 5].map((n) => (
                <Star key={n} size={16} className={n <= existing.rating ? 'fill-amber-400 text-amber-400' : 'fill-gray-100 text-gray-300'} />
              ))}
            </div>
            <button type="button" onClick={() => { setEditing(true); setJustSaved(false); }}
                    className="text-xs font-bold text-gray-500 border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50">
              Edit
            </button>
          </div>
          {existing.body && <p className="text-sm text-gray-600 mt-2 leading-relaxed">{existing.body}</p>}
          {justSaved && (
            <p className="text-xs font-semibold text-emerald-700 mt-2 inline-flex items-center gap-1.5">
              <CheckCircle2 size={14} /> Posted. Thank you!
            </p>
          )}
          {existing.reply && (
            <div className="mt-2 rounded-xl bg-gray-50 border border-gray-100 px-3 py-2">
              <p className="text-[11px] font-bold text-gray-700">Reply from the store</p>
              <p className="text-xs text-gray-600 mt-0.5">{existing.reply}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ReviewInvite() {
  const { token } = useParams();
  const [invite, setInvite] = useState(null);   // null = loading
  const [name, setName]     = useState('');
  const [ads, setAds]       = useState(false);

  useEffect(() => {
    let alive = true;
    getReviewInvite(token).then((d) => {
      if (!alive) return;
      setInvite(d);
      const earlier = (d?.items || []).find((it) => it.review?.displayName)?.review?.displayName;
      setName(earlier || d?.firstName || '');
    });
    return () => { alive = false; };
  }, [token]);

  function onSaved(index, review) {
    setInvite((d) => ({ ...d, items: d.items.map((it) => (it.index === index ? { ...it, review } : it)) }));
  }

  if (invite === null) {
    return (
      <div className="min-h-screen bg-[#f8fafc] flex items-center justify-center px-4">
        <Loader2 size={24} className="animate-spin text-gray-400" aria-label="Loading" />
      </div>
    );
  }

  if (invite.state !== 'ok') {
    const copy = STATE_COPY[invite.state] || STATE_COPY.error;
    return (
      <div className="min-h-screen bg-[#f8fafc] flex items-center justify-center px-4 py-6">
        <div className="w-full max-w-sm bg-white rounded-3xl border border-gray-100 shadow-sm p-7 text-center">
          <AlertTriangle size={28} className="mx-auto text-amber-500" />
          <h1 className="text-lg font-extrabold text-gray-900 mt-3">{copy.title}</h1>
          <p className="text-sm text-gray-500 mt-1.5">{copy.body}</p>
          {invite.storeName && <p className="text-xs text-gray-400 mt-4">{invite.storeName}</p>}
        </div>
      </div>
    );
  }

  const brand = invite.brand || '#059669';
  const items = invite.items || [];
  const done  = items.filter((it) => it.review).length;

  return (
    <div className="min-h-screen bg-[#f8fafc] flex flex-col items-center px-4 py-6">
      <div className="w-full max-w-sm space-y-3">
        <div className="bg-white rounded-2xl border border-gray-100 px-4 py-3">
          <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Review your order</p>
          <p className="text-base font-extrabold text-gray-900 truncate">{invite.storeName || 'Store'}</p>
        </div>

        <div className="rounded-2xl p-5 text-white" style={{ backgroundColor: brand }}>
          <h1 className="text-xl font-extrabold leading-tight">
            {invite.firstName ? `Hi ${invite.firstName}, how was your order?` : 'How was your order?'}
          </h1>
          <p className="text-sm opacity-90 mt-1">
            Rate each item you received. {items.length > 1 ? `${done} of ${items.length} done.` : ''}
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-3">
          <label className="block">
            <span className="text-xs font-semibold text-gray-600">Name shown with your review</span>
            <input type="text" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} autoComplete="given-name"
                   className="mt-1 w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-gray-300" />
          </label>
          <label className="flex items-start gap-2.5 text-xs text-gray-600">
            <input type="checkbox" checked={ads} onChange={(e) => setAds(e.target.checked)} className="mt-0.5 w-4 h-4 rounded" />
            <span>The store may use my review in its ads. <span className="text-gray-400">(Optional)</span></span>
          </label>
        </div>

        {items.map((it) => (
          <ItemReview key={it.index} token={token} item={it} name={name} ads={ads} brand={brand} onSaved={onSaved} />
        ))}

        <p className="text-[11px] text-gray-400 px-1 leading-relaxed inline-flex items-start gap-1.5">
          <BadgeCheck size={13} className="text-emerald-600 flex-shrink-0 mt-px" />
          Your name, stars and words appear on {invite.storeName || 'the store'}’s page, marked Verified purchase. Low ratings are published too. The store can reply, but can’t edit or delete your review.
        </p>
      </div>
    </div>
  );
}

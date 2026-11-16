import { supabase } from '../lib/supabase';
import { hashPin } from './pinHash';
import { toPublicReview, reviewStats, ratingsByStore } from './reviewShape';

/**
 * Verified-purchase reviews (supabase/reviews-verified-forward.sql).
 *
 *  Public (storefront)
 *   • fetchReviews / fetchProductReviews / fetchAllRatings — published reviews only.
 *  Customer (holds a review link)
 *   • getReviewInvite / submitInviteReview — the ONLY way a review is written.
 *  Seller (holds the store PIN)
 *   • createReviewInvite — makes the link for one delivered order.
 *   • fetchOwnerReviews / replyToReview / reportReview.
 *     There is no delete and no hide: a reported review stays up until
 *     PocketLink decides.
 *
 * Public reads never throw (a network blip shows no reviews). Writes throw an
 * Error carrying the server's message, which is written to be shown as-is.
 */

export { reviewStats };

// Only these columns are granted to the browser; asking for any other fails.
const PUBLIC_COLUMNS =
  'id, product_id, item_name, variant, display_name, rating, body, verified_purchase, ' +
  'merchant_reply, merchant_replied_at, submitted_at, edit_count';

function fail(error, fallback) {
  return new Error(error?.message || fallback);
}

/** Public: a store's published reviews, newest first. Never throws. */
export async function fetchReviews(slug) {
  if (!slug) return [];
  try {
    const { data, error } = await supabase
      .from('product_reviews')
      .select(PUBLIC_COLUMNS)
      .eq('store_slug', slug)
      .eq('status', 'published')
      .order('submitted_at', { ascending: false })
      .limit(500);
    if (error) return [];
    return (data || []).map(toPublicReview);
  } catch {
    return [];
  }
}

/** Public: published reviews of one product. Never throws. */
export async function fetchProductReviews(slug, productId) {
  if (!slug || productId === undefined || productId === null || productId === '') return [];
  try {
    const { data, error } = await supabase
      .from('product_reviews')
      .select(PUBLIC_COLUMNS)
      .eq('store_slug', slug)
      .eq('product_id', String(productId))
      .eq('status', 'published')
      .order('submitted_at', { ascending: false })
      .limit(100);
    if (error) return [];
    return (data || []).map(toPublicReview);
  } catch {
    return [];
  }
}

/** Public: { [store_slug]: { avg, count } } for the marketplace. Never throws. */
export async function fetchAllRatings() {
  try {
    const { data, error } = await supabase
      .from('product_reviews')
      .select('store_slug, rating')
      .eq('status', 'published')
      .limit(5000);
    if (error || !data) return {};
    return ratingsByStore(data);
  } catch {
    return {};
  }
}

// ── Customer ───────────────────────────────────────────────────────────────

/** What the review page shows for a link. `state` is 'ok' or why it cannot be used. */
export async function getReviewInvite(token) {
  try {
    const { data, error } = await supabase.rpc('get_review_invite', { p_token: String(token || '') });
    if (error || !data) return { state: 'error' };
    return data;
  } catch {
    return { state: 'error' };
  }
}

/** Write or edit the review of one item. Throws with the server's reason. */
export async function submitInviteReview(token, { itemIndex, rating, body, displayName, consentAdvertising = false }) {
  const { data, error } = await supabase.rpc('submit_review', {
    p_token:               String(token || ''),
    p_item_index:          itemIndex,
    p_rating:              Math.round(Number(rating)),
    p_body:                String(body || ''),
    p_display_name:        String(displayName || ''),
    p_consent_advertising: Boolean(consentAdvertising),
  });
  if (error) throw fail(error, 'Could not save your review. Try again.');
  return data;
}

// ── Seller ─────────────────────────────────────────────────────────────────

/** Make (or remake) the review link for a delivered order. Returns the raw token. */
export async function createReviewInvite(slug, pin, orderId) {
  const hashed = await hashPin(pin);
  const { data, error } = await supabase.rpc('issue_review_invite', {
    p_slug: slug, p_hashed_pin: hashed, p_order_id: orderId,
  });
  if (error) throw fail(error, 'Could not create the review link.');
  if (!data) throw new Error('Could not create the review link.');
  return data;
}

/** Every review of the store, any status. `{ rows, error }` so the tab can say why it is empty. */
export async function fetchOwnerReviews(slug, pin) {
  try {
    const hashed = await hashPin(pin);
    const { data, error } = await supabase.rpc('get_owner_reviews', { p_slug: slug, p_hashed_pin: hashed });
    if (error) return { rows: [], error: error.message || 'Could not load reviews.' };
    return { rows: data || [], error: '' };
  } catch (e) {
    return { rows: [], error: e?.message || 'Could not load reviews.' };
  }
}

/**
 * Which orders were asked for a review, when, how many times, and which the shop
 * said not to ask (supabase/review-asks-forward.sql). `{ rows, error }`: the
 * list must not pretend nobody was asked when this failed.
 */
export async function fetchReviewAsks(slug, pin) {
  try {
    const hashed = await hashPin(pin);
    const { data, error } = await supabase.rpc('get_review_asks', { p_slug: slug, p_hashed_pin: hashed });
    if (error) return { rows: [], error: error.message || 'Could not load who was asked.' };
    return { rows: data || [], error: '' };
  } catch (e) {
    return { rows: [], error: e?.message || 'Could not load who was asked.' };
  }
}

/** "Don't ask this customer" (skip = true), or undo it. Throws with the server's reason. */
export async function setReviewAskSkip(slug, pin, orderId, skip = true) {
  const hashed = await hashPin(pin);
  const { error } = await supabase.rpc('set_review_ask_skip', {
    p_slug: slug, p_hashed_pin: hashed, p_order_id: orderId, p_skip: Boolean(skip),
  });
  if (error) throw fail(error, 'Could not save that.');
}

/**
 * "Ask automatically": the switch, the wallet, the last 30 days and how many
 * delivered orders wait to be asked (supabase/review-asks-auto-forward.sql).
 * `{ ok, data }` | `{ ok: false, error }`. Never throws.
 */
export async function fetchReviewAskAuto(slug, pin) {
  try {
    const hashed = await hashPin(pin);
    const { data, error } = await supabase.rpc('get_review_ask_auto', { p_slug: slug, p_hashed_pin: hashed });
    if (error || !data) return { ok: false, error: error?.message || 'Could not load.' };
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e?.message || 'Could not load.' };
  }
}

/** Save the switch and its choices: { on, days, lang, couriers, manual }. Throws with the reason. */
export async function saveReviewAskAuto(slug, pin, s) {
  const hashed = await hashPin(pin);
  const { data, error } = await supabase.rpc('set_review_ask_auto', {
    p_slug: slug, p_hashed_pin: hashed, p_on: Boolean(s.on), p_days: Number(s.days), p_lang: s.lang === 'mr' ? 'mr' : 'en',
    p_couriers: Boolean(s.couriers), p_manual: Boolean(s.manual),
  });
  if (error) throw fail(error, 'Could not save that.');
  return data;
}

/** Has WhatsApp approved the review message yet? `{ ready, ready_mr }`. Never throws. */
export async function reviewAsksReady(slug, pin) {
  try {
    const hashed = await hashPin(pin);
    const { data, error } = await supabase.functions.invoke('review-asks-now', { body: { slug, hashedPin: hashed, check: true } });
    if (error || data?.error) return { ready: false, ready_mr: false };
    return { ready: Boolean(data?.ready), ready_mr: Boolean(data?.ready_mr) };
  } catch {
    return { ready: false, ready_mr: false };
  }
}

/**
 * "Ask all": PocketLink sends the review request to each ticked order, 1 Coin
 * each. Calls again while the server reports more. Resolves
 * { sent, failed, skipped, sentIds, stoppedFor: '' | 'no_balance' | 'night' }.
 */
export async function askAllReviews(slug, pin, orderIds, lang, onProgress) {
  const hashed = await hashPin(pin);
  const sum = { sent: 0, failed: 0, skipped: 0, sentIds: [], stoppedFor: '' };
  let left = [...orderIds];
  for (let round = 0; round < 20 && left.length; round++) {
    const batch = left.slice(0, 100);
    left = left.slice(100);
    const { data, error } = await supabase.functions.invoke('review-asks-now', {
      body: { slug, hashedPin: hashed, order_ids: batch, lang },
    });
    if (error || data?.error) throw new Error(data?.error || 'Sending stopped. Please try again.');
    sum.sent += Number(data.sent) || 0;
    sum.failed += Number(data.failed) || 0;
    sum.skipped += Number(data.skipped) || 0;
    sum.sentIds.push(...(data.sent_ids || []));
    onProgress?.({ sent: sum.sent, failed: sum.failed });
    if (data.reasons?.no_balance) { sum.stoppedFor = 'no_balance'; break; }
    if (data.reasons?.night) { sum.stoppedFor = 'night'; break; }
  }
  return sum;
}

/** Public reply under a review. An empty reply removes it. */
export async function replyToReview(slug, pin, reviewId, reply) {
  const hashed = await hashPin(pin);
  const { error } = await supabase.rpc('reply_to_review', {
    p_slug: slug, p_hashed_pin: hashed, p_review_id: reviewId, p_reply: String(reply || ''),
  });
  if (error) throw fail(error, 'Could not save your reply.');
}

/** Ask PocketLink to check a review. It stays visible until they decide. */
export async function reportReview(slug, pin, reviewId, reason) {
  const hashed = await hashPin(pin);
  const { error } = await supabase.rpc('report_review', {
    p_slug: slug, p_hashed_pin: hashed, p_review_id: reviewId, p_reason: String(reason || ''),
  });
  if (error) throw fail(error, 'Could not send the report.');
}

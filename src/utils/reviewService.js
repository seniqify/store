import { supabase } from '../lib/supabase';
import { hashPin } from './pinHash';

/**
 * Customer reviews & ratings.
 *  • submitReview      — public (anon) insert when a customer leaves a review.
 *  • fetchReviews      — public read of *approved* reviews (RLS-restricted).
 *  • fetchAllReviews   — owner-only read of every review, gated by the store PIN.
 *  • setReviewStatus   — owner-only hide / re-approve, gated by the store PIN.
 *  • removeReview      — owner-only permanent delete, gated by the store PIN.
 *
 * Reviews auto-publish (status 'approved') for instant social proof; the owner
 * can hide or delete abusive ones from the Reviews tab. Every call is wrapped so
 * a missing table / network blip degrades gracefully instead of throwing.
 */

const MAX_COMMENT = 400;

/** Public: leave a review. Returns true on success, false otherwise. */
export async function submitReview(slug, { name, rating, comment } = {}) {
  if (!slug) return false;
  const stars = Math.round(Number(rating));
  const cleanName = String(name || '').trim().slice(0, 60);
  if (!cleanName || !(stars >= 1 && stars <= 5)) return false;
  try {
    const { error } = await supabase.from('reviews').insert({
      store_slug:    slug,
      customer_name: cleanName,
      rating:        stars,
      comment:       String(comment || '').trim().slice(0, MAX_COMMENT),
      status:        'approved',
    });
    return !error;
  } catch {
    return false;
  }
}

/** Public: list approved reviews for a store (newest first). Never throws. */
export async function fetchReviews(slug) {
  if (!slug) return [];
  try {
    const { data, error } = await supabase
      .from('reviews')
      .select('id, customer_name, rating, comment, created_at')
      .eq('store_slug', slug)
      .eq('status', 'approved')
      .order('created_at', { ascending: false });
    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
}

/** Owner-only: list every review (any status), PIN-checked server-side. */
export async function fetchAllReviews(slug, pin) {
  try {
    const hashed = await hashPin(pin);
    const { data, error } = await supabase.rpc('get_store_reviews', { p_slug: slug, p_hashed_pin: hashed });
    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
}

/** Owner-only: hide ('hidden') or re-publish ('approved') a review. */
export async function setReviewStatus(slug, pin, reviewId, status) {
  try {
    const hashed = await hashPin(pin);
    await supabase.rpc('set_review_status', {
      p_slug: slug, p_hashed_pin: hashed, p_review_id: reviewId, p_status: status,
    });
  } catch {
    /* ignore */
  }
}

/** Owner-only: permanently delete a review. */
export async function removeReview(slug, pin, reviewId) {
  try {
    const hashed = await hashPin(pin);
    await supabase.rpc('delete_review', { p_slug: slug, p_hashed_pin: hashed, p_review_id: reviewId });
  } catch {
    /* ignore */
  }
}

/** Aggregate { avg, count } from a list of reviews. avg rounded to 1 dp. */
export function reviewStats(reviews = []) {
  const count = reviews.length;
  if (!count) return { avg: 0, count: 0 };
  const sum = reviews.reduce((s, r) => s + (Number(r.rating) || 0), 0);
  return { avg: Math.round((sum / count) * 10) / 10, count };
}

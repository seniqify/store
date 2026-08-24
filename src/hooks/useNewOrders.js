import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchNewOrderSignal } from '../utils/orderService';

/**
 * useNewOrders — the live "a new order just landed" signal for the Manage shell.
 *
 * Why a poll and not Supabase Realtime: customers can INSERT orders but RLS
 * forbids the anon role from SELECTing them (owner PII stays owner-only), so
 * realtime postgres_changes would never deliver a payload to the browser. Instead
 * we poll a tiny PIN-checked RPC (new_orders_since) that returns just a count +
 * the newest order's name/amount — cheap, secure, and fresh within ~15s.
 *
 * "New" means orders that arrived AFTER `seenAt` (persisted per store in
 * localStorage). On first ever open we seed seenAt = now, so the owner is never
 * ambushed by a toast for their whole backlog — only genuinely fresh arrivals
 * ping. Opening the Orders tab calls markSeen(), clearing the badge.
 *
 *   const { newCount, markSeen } = useNewOrders({ slug, pin, enabled, onArrive });
 *
 * onArrive(order, delta) fires only when the count RISES (a new order actually
 * arrived) — the shell uses it to raise the toast + chime.
 */

const POLL_MS = 15000;
const seenKey = (slug) => `pl_orders_seen_${slug}`;

export function useNewOrders({ slug, pin, enabled = true, onArrive }) {
  const [newCount, setNewCount] = useState(0);

  const seenRef      = useRef(null);   // ISO string — orders after this are "new"
  const lastCountRef = useRef(0);      // last observed count, to detect a rise
  const onArriveRef  = useRef(onArrive);
  useEffect(() => { onArriveRef.current = onArrive; });

  // Move the "seen" watermark forward (badge → 0). Called when the owner opens
  // the Orders tab, or taps a toast's View.
  const markSeen = useCallback(() => {
    const nowIso = new Date().toISOString();
    seenRef.current = nowIso;
    lastCountRef.current = 0;
    try { localStorage.setItem(seenKey(slug), nowIso); } catch { /* private mode */ }
    setNewCount(0);
  }, [slug]);

  useEffect(() => {
    if (!enabled || !slug || !pin) return;

    // Seed the watermark once: stored value, else now (ignore the backlog).
    if (seenRef.current === null) {
      let stored = null;
      try { stored = localStorage.getItem(seenKey(slug)); } catch { /* private mode */ }
      seenRef.current = stored || new Date().toISOString();
      if (!stored) { try { localStorage.setItem(seenKey(slug), seenRef.current); } catch { /* ignore */ } }
    }

    let alive = true;
    async function poll() {
      const sig = await fetchNewOrderSignal(slug, pin, seenRef.current);
      if (!alive || !sig) return;
      const count = sig.new_count || 0;
      if (count > lastCountRef.current) {
        onArriveRef.current?.(
          { name: sig.latest_name || '', total: Number(sig.latest_total) || 0, at: sig.latest_at },
          count - lastCountRef.current,
        );
      }
      lastCountRef.current = count;
      setNewCount(count);
    }

    poll();   // immediate first check
    const id = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') poll();
    }, POLL_MS);
    // Re-check the instant the owner returns to the tab, so it feels live.
    const onVisible = () => { if (document.visibilityState === 'visible') poll(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);

    return () => {
      alive = false;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [slug, pin, enabled]);

  return { newCount, markSeen };
}

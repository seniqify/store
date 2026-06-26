import { useState, useEffect } from 'react';
import { Zap } from 'lucide-react';
import { offerEndsAt, describeDiscount } from '../../utils/offers';

/**
 * StoreSaleBanner — the live sale banner shown on the storefront when one or
 * more scheduled sales are running. Replaces the static promo ribbon while a
 * sale is on. Shows a ticking countdown for time-bound sales (date range,
 * weekend, happy-hours); "always on" sales just show the headline.
 *
 * Owns its own per-second tick so the rest of the page doesn't re-render.
 */
export default function StoreSaleBanner({ offers = [], primary = '#0d9488', primaryDark = '#0f766e' }) {
  const [now, setNow] = useState(() => new Date());

  // The sale ending soonest drives the countdown + the headline.
  const withEnd = offers
    .map((o) => ({ o, end: offerEndsAt(o, now) }))
    .filter((x) => x.end);
  const soonest = withEnd.sort((a, b) => a.end - b.end)[0] || null;
  const headline = soonest?.o || offers[0];
  const endsAt = soonest?.end || null;

  useEffect(() => {
    if (!endsAt) return;
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, [endsAt]);

  const remaining = endsAt ? Math.max(0, endsAt - now) : 0;

  function scrollToProducts() {
    document.getElementById('products')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <div className="w-full px-3 sm:px-4 mt-4">
      <div className="max-w-7xl mx-auto relative overflow-hidden rounded-2xl shadow-sm"
           style={{ background: `linear-gradient(135deg, ${primary}, ${primaryDark})` }}>
        <div className="absolute inset-0"
             style={{ opacity: 0.18, backgroundImage: 'radial-gradient(#fff 1px, transparent 1px)', backgroundSize: '14px 14px' }} />
        <div className="relative flex items-center gap-3 px-4 py-3">
          <span className="flex-shrink-0 w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center text-white">
            <Zap size={18} fill="currentColor" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-bold text-sm text-white leading-tight truncate">
              {headline?.name || 'Sale on now'} · {describeDiscount(headline)}
            </p>
            {endsAt ? (
              <p className="text-[11px] text-white/85 mt-0.5 leading-tight tabular-nums">
                Ends in {fmtCountdown(remaining)}
              </p>
            ) : (
              <p className="text-[11px] text-white/80 mt-0.5 leading-tight">Limited-time offer — shop now</p>
            )}
          </div>
          <button onClick={scrollToProducts}
            className="flex-shrink-0 text-xs font-bold px-3.5 py-2 rounded-lg bg-white transition-all active:scale-95 shadow-sm"
            style={{ color: primaryDark }}>
            Shop now →
          </button>
        </div>
      </div>
    </div>
  );
}

// ms → "2d 03:14:09" / "03:14:09" / "14:09"
function fmtCountdown(ms) {
  const total = Math.floor(ms / 1000);
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  if (d > 0) return `${d}d ${pad(h)}:${pad(m)}:${pad(s)}`;
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

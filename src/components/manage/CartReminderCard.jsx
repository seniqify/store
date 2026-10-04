import { useState, useEffect } from 'react';
import { MessageCircle } from 'lucide-react';
import { fetchCartReminderSummary, setCartReminders } from '../../utils/cartReminderService';
import { formatINR } from '../../utils/currency';

/**
 * CartReminderCard — the shop's switch for automatic WhatsApp cart reminders,
 * and what they did in the last 30 days.
 *
 * When ON, about an hour after a customer leaves checkout PocketLink sends them
 * one WhatsApp with their cart and a "Complete my order" button, paid from the
 * message wallet (Rs 1.50). Who gets one, and when, is decided on the server
 * (supabase/cart-reminders-forward.sql): only customers who ticked "Get offers
 * on WhatsApp" for this shop, at most once a week, 9 am – 9 pm, never if they
 * have ordered since.
 */
export default function CartReminderCard({ slug, pin, themeColor = '#0d9488' }) {
  const [summary, setSummary] = useState(null);   // null = loading; else { ok, data }
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    fetchCartReminderSummary(slug, pin).then((r) => { if (alive) setSummary(r); });
    return () => { alive = false; };
  }, [slug, pin]);

  if (summary === null) return <div className="h-28 rounded-2xl bg-white border border-gray-100 animate-pulse" />;
  if (!summary.ok) return null;   // the wallet card above already offers the retry

  const s = summary.data;
  const on = s.enabled === true;

  async function toggle() {
    setError('');
    setSaving(true);
    try {
      const next = await setCartReminders(slug, pin, !on);
      setSummary({ ok: true, data: { ...s, enabled: next } });
    } catch (e) {
      setError(e?.message || 'Could not change the setting.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-2xl border border-gray-100 bg-white shadow-sm p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-extrabold text-gray-900 flex items-center gap-1.5">
            <MessageCircle size={15} className="text-[#25D366]" /> Automatic WhatsApp reminders
          </p>
          <p className="text-xs text-gray-500 mt-1 leading-snug">
            About an hour after a customer leaves checkout, we send them their cart with a
            {' '}<b>Complete my order</b> button. ₹1.50 each from your message wallet.
          </p>
        </div>
        <button type="button" role="switch" aria-checked={on} aria-label="Automatic WhatsApp reminders"
          disabled={saving} onClick={toggle}
          className="relative w-11 h-6 rounded-full transition-colors flex-shrink-0 disabled:opacity-60"
          style={{ backgroundColor: on ? themeColor : '#d1d5db' }}>
          <span className={['absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform',
                            on ? 'translate-x-5' : ''].join(' ')} />
        </button>
      </div>

      {error && <p className="mt-2 text-xs font-semibold text-rose-600">{error}</p>}

      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        {[
          ['Sent', Number(s.sent_30d) || 0],
          ['Opened', Number(s.clicked_30d) || 0],
          ['Ordered', Number(s.recovered_30d) || 0],
        ].map(([label, n]) => (
          <div key={label} className="rounded-xl bg-gray-50 px-2 py-2">
            <p className="text-base font-extrabold text-gray-900 tabular-nums">{n.toLocaleString('en-IN')}</p>
            <p className="text-[11px] text-gray-500">{label}</p>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-gray-400 leading-snug">
        {Number(s.recovered_value_30d) > 0
          ? <><b className="text-emerald-700">{formatINR(Number(s.recovered_value_30d))} recovered</b> in the last 30 days. </>
          : 'Last 30 days. '}
        Only customers who ticked &ldquo;Get offers on WhatsApp&rdquo; at your checkout, at most once a week, 9 am – 9 pm.
      </p>
    </div>
  );
}

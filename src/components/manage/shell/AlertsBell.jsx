import { useState, useEffect } from 'react';
import { Bell, ChevronRight } from 'lucide-react';
import { arrivalText } from '../../../utils/dashboardShell';
import { formatINR } from '../../../utils/currency';

/**
 * The bell in the top bar. Its number is the same new-order count as the red
 * badge on Orders (useNewOrders). Opening it lists the orders that arrived
 * while the dashboard was open; "Open orders" clears the count.
 */
export default function AlertsBell({ newCount = 0, arrivals = [], onOpenOrders, noun = 'order', variant = 'bar' }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const phone = variant === 'phone';
  const nouns = newCount === 1 ? noun : `${noun}s`;
  const time = (at) => new Date(at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        aria-label={newCount > 0 ? `Alerts, ${newCount} new ${nouns}` : 'Alerts'}
        className={phone
          ? 'relative w-10 h-10 rounded-full grid place-items-center text-gray-700 hover:bg-gray-100'
          : 'relative w-10 h-10 rounded-xl border border-gray-200 bg-white text-gray-700 grid place-items-center hover:bg-gray-50'}>
        <Bell size={phone ? 20 : 19} />
        {newCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white
                           text-[10px] font-extrabold tabular-nums grid place-items-center ring-2 ring-white">
            {newCount > 9 ? '9+' : newCount}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className={[
            'z-50 bg-white rounded-2xl border border-gray-200 shadow-xl overflow-hidden',
            phone ? 'fixed left-3 right-3 top-[64px]' : 'absolute right-0 top-12 w-[340px]',
          ].join(' ')}>
            <p className="px-4 pt-3.5 pb-2.5 text-[11px] font-bold uppercase tracking-widest text-gray-500 border-b border-gray-100">Alerts</p>
            {newCount > 0 && (
              <button type="button" onClick={() => { setOpen(false); onOpenOrders?.(); }}
                className="w-full flex items-center gap-3 px-4 py-3 bg-amber-50 text-left hover:bg-amber-100/70">
                <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse flex-shrink-0" />
                <span className="flex-1 text-[14px] font-bold text-amber-900">{newCount} new {nouns} waiting</span>
                <span className="text-[12px] font-bold text-amber-800">Open</span>
                <ChevronRight size={15} className="text-amber-700" />
              </button>
            )}
            {arrivals.length > 0 ? (
              <ul className="max-h-[320px] overflow-y-auto divide-y divide-gray-100">
                {arrivals.slice(0, 8).map((a) => (
                  <li key={a.id} className="px-4 py-2.5">
                    <p className="text-[14px] text-gray-800">{arrivalText(a, formatINR)}</p>
                    <p className="text-[12px] text-gray-500">{time(a.at)}</p>
                  </li>
                ))}
              </ul>
            ) : newCount === 0 && (
              <p className="px-4 py-6 text-sm text-gray-500 text-center">No new alerts. New {noun}s show up here as they arrive.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';
import { useBusinessConfig } from '../../contexts/BusinessContext';
import { getStoreStatus } from '../../utils/storeHours';

/**
 * StoreStatus — a slim "Open now / Closed" strip shown under the store header.
 * Lives in the shared store shell so it appears for every template
 * (product / service). Renders nothing unless the owner has enabled
 * business hours. Re-evaluates every minute.
 */
export default function StoreStatus() {
  const config = useBusinessConfig();
  const [, tick] = useState(0);

  // Re-check the open/closed state once a minute so it flips at open/close time.
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const status = getStoreStatus(config.hours);
  if (!status) return null;

  return (
    <div className={[
      'w-full border-b text-center',
      status.open ? 'bg-emerald-50 border-emerald-100' : 'bg-gray-50 border-gray-100',
    ].join(' ')}>
      <div className="max-w-7xl mx-auto px-4 py-1.5 flex items-center justify-center gap-2 text-xs">
        <span className={[
          'inline-flex items-center gap-1.5 font-bold',
          status.open ? 'text-emerald-700' : 'text-gray-500',
        ].join(' ')}>
          <span className={[
            'w-1.5 h-1.5 rounded-full',
            status.open ? 'bg-emerald-500 animate-pulse' : 'bg-gray-400',
          ].join(' ')} />
          {status.label}
        </span>
        {status.detail && (
          <span className="inline-flex items-center gap-1 text-gray-400 font-medium">
            <Clock size={11} /> {status.detail}
          </span>
        )}
      </div>
    </div>
  );
}

// Call timer: no phone system is connected, so the call's length is taken as
// the time from tapping Call (the phone app opens) to coming back to the CRM.
// It is shown before saving and can be cleared if it looks wrong.
import { useEffect, useState } from 'react';
import { callSeconds } from './crmLogic.js';

const KEY = 'crm-call';

export function startCallTimer(leadId) {
  try { sessionStorage.setItem(KEY, JSON.stringify({ leadId, at: Date.now() })); } catch { /* private mode */ }
}

/** [seconds or null, clear()] for this lead's last tapped call. */
export function useCallTimer(leadId) {
  const [secs, setSecs] = useState(null);
  useEffect(() => {
    const check = () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const c = JSON.parse(sessionStorage.getItem(KEY) || 'null');
        if (c && c.leadId === leadId) setSecs(callSeconds(c.at, Date.now()));
      } catch { /* ignore */ }
    };
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    return () => { document.removeEventListener('visibilitychange', check); window.removeEventListener('focus', check); };
  }, [leadId]);
  const clear = () => { setSecs(null); try { sessionStorage.removeItem(KEY); } catch { /* ignore */ } };
  return [secs, clear];
}

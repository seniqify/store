// New-lead alert: speed matters (call within 5 minutes). Every minute while
// the CRM is open, look for new leads given to me that nobody has called; a
// new one shows a bar at the top with Call, plays a short sound and, if
// allowed, a browser notification. The first check only learns what is there.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCrm } from './crmContext.js';
import { myFreshLeads } from './crmService.js';
import { telHref, sourceLabel } from './crmLogic.js';
import { startCallTimer } from './crmCallTimer.js';
import { Icon } from './ui.jsx';
import { btn } from './crmStyles.js';

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.18].forEach((t) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 880; g.gain.value = 0.08;
      o.connect(g); g.connect(ctx.destination);
      o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.12);
    });
    setTimeout(() => ctx.close(), 800);
  } catch { /* no sound */ }
}

export default function NewLeadAlert() {
  const { me, path } = useCrm();
  const [fresh, setFresh] = useState([]);
  const seen = useRef(null);

  useEffect(() => {
    if (me.role === 'manager') return undefined;
    let alive = true;
    const check = async () => {
      if (document.visibilityState !== 'visible' && seen.current) return;
      const rows = await myFreshLeads(me.user_id);
      if (!alive || !rows) return;
      if (!seen.current) { seen.current = new Set(rows.map((r) => r.id)); return; }
      const added = rows.filter((r) => !seen.current.has(r.id));
      rows.forEach((r) => seen.current.add(r.id));
      if (!added.length) return;
      setFresh((f) => [...added, ...f].slice(0, 3));
      beep();
      try {
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification(`New lead: ${added[0].shop_name}`, { body: `${sourceLabel(added[0].source)} · call within 5 minutes`, tag: added[0].id });
        }
      } catch { /* not allowed */ }
    };
    check();
    const id = setInterval(check, 60000);
    const vis = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', vis);
    return () => { alive = false; clearInterval(id); document.removeEventListener('visibilitychange', vis); };
  }, [me.role, me.user_id]);

  if (!fresh.length) return null;
  const l = fresh[0];
  return (
    <div role="alert" className="fixed top-0 inset-x-0 lg:left-60 z-40 shadow-lg bg-green-700 text-white px-4 lg:px-7 py-2.5 flex flex-wrap items-center gap-2">
      <span className="flex-1 min-w-[180px] text-sm"><b>New lead: {l.shop_name}</b> · {sourceLabel(l.source)} · call within 5 minutes{fresh.length > 1 ? ` (+${fresh.length - 1} more)` : ''}</span>
      <a href={telHref(l.phone)} onClick={() => { startCallTimer(l.id); }} className={`${btn.small} border-white`}><Icon name="phone" size={14} />Call</a>
      <Link to={path(`leads/${l.id}`)} onClick={() => setFresh((f) => f.slice(1))} className={`${btn.small} border-white`}>Open</Link>
      <button type="button" aria-label="Close" onClick={() => setFresh((f) => f.slice(1))} className="w-9 h-9 grid place-items-center rounded-lg bg-white/10"><Icon name="x" size={16} /></button>
    </div>
  );
}

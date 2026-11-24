// Follow-ups by day: late, today, tomorrow, this week. A manager sees
// everyone's (and can filter by person); others see their own.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCrm } from './crmContext.js';
import { listLeads, updateLead } from './crmService.js';
import { followupColumns, dueLabel, telHref } from './crmLogic.js';
import { Spinner, Empty, Notice } from './ui.jsx';
import { btn, card, input } from './crmStyles.js';

const COLS = [['late', 'Late', 'border-t-amber-600 text-amber-700'], ['today', 'Today', 'border-t-green-700 text-green-700'],
  ['tomorrow', 'Tomorrow', 'border-t-blue-600 text-blue-700'], ['week', 'This week', 'border-t-gray-400 text-gray-600']];

export default function CrmFollowups() {
  const { me, staff, nameOf, path } = useCrm();
  const [leads, setLeads] = useState(null);
  const [who, setWho] = useState('all');
  const [err, setErr] = useState('');
  const isManager = me.role === 'manager';

  const [loadedAt, setLoadedAt] = useState(0);
  const load = useCallback(async () => { const ls = await listLeads(); setLeads(ls); setLoadedAt(Date.now()); }, []);
  useEffect(() => { load(); }, [load]);

  const cols = useMemo(() => followupColumns((leads || []).filter((l) => who === 'all' || l.assigned_to === who), loadedAt), [leads, who, loadedAt]);

  const later = async (l) => {
    setErr('');
    try {
      const base = Math.max(Date.parse(l.next_action_at), Date.now());
      await updateLead(l.id, { next_action_at: new Date(base + 86400000).toISOString() });
      await load();
    } catch (e) { setErr(e.message); }
  };

  return (
    <div className="px-4 lg:px-7 py-5 space-y-4">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-extrabold flex-1">Follow-ups</h1>
        {isManager && (
          <select aria-label="Person" className={`${input} sm:w-56`} value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="all">Everyone</option>
            {staff.map((s) => <option key={s.user_id} value={s.user_id}>{s.name}</option>)}
          </select>
        )}
      </header>
      {err && <Notice>{err}</Notice>}
      {!leads ? <Spinner /> : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 items-start">
          {COLS.map(([key, title, cls]) => (
            <section key={key} aria-label={title} className={`${card} border-t-4 ${cls.split(' ')[0]} p-3 space-y-2`}>
              <div className="flex items-baseline justify-between px-1"><h2 className="font-extrabold text-gray-900">{title}</h2><span className={`text-sm font-bold ${cls.split(' ')[1]}`}>{cols[key].length}</span></div>
              {!cols[key].length ? <Empty>Nothing.</Empty> : cols[key].slice(0, 40).map((l) => (
                <div key={l.id} className="border border-gray-200 rounded-xl p-3 space-y-1.5">
                  <div className="flex gap-2 items-baseline">
                    <Link to={path(`leads/${l.id}`)} className="font-bold text-[14px] flex-1 text-gray-900 no-underline">{l.shop_name}</Link>
                    <span className={`text-[12px] font-bold ${key === 'late' ? 'text-amber-700' : 'text-gray-500'}`}>{dueLabel(l.next_action_at)}</span>
                  </div>
                  <div className="text-[13px] text-gray-700">{l.next_action || 'Follow up'}</div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {isManager && <span className="text-[12px] font-bold text-blue-800 bg-blue-50 rounded-full px-2 py-0.5">{nameOf(l.assigned_to) || 'Not assigned'}</span>}
                    <span className="flex-1" />
                    <a href={telHref(l.phone)} className={btn.smallGreen}>Call</a>
                    <button type="button" className={btn.small} onClick={() => later(l)}>+1 day</button>
                  </div>
                </div>
              ))}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

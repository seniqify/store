// Call queue: your own leads in the order to call them. Call, tap how it went,
// "Save and call next". Due and late calls first, then later today, then new.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useCrm } from './crmContext.js';
import { listLeads, listActivities, logActivity, updateLead, activitiesSince } from './crmService.js';
import { buildQueue, dueLabel, telHref, waHref, prettyPhone, sourceLabel, istDate, istInstant, shortDay, istTime } from './crmLogic.js';
import { Icon, Spinner, Empty, Notice, OutcomePanel, StagePill } from './ui.jsx';
import { btn, card } from './crmStyles.js';

// A line or two to start with, by type of business. The full scripts come in
// the Scripts section.
const HOOKS = {
  'Clothing and sarees': 'Every design with sizes and colours on one link. No more “price?” on every photo.',
  'Food, spices, sweets': 'Send parcels across India with Delhivery or Shadowfax; buyers track them on a page with the shop’s name.',
  'Kirana and grocery': 'Regular customers reorder from the link. Cash on delivery with a “Confirm my order” message.',
  'Restaurant or café': 'A menu link for WhatsApp and Instagram. Orders come straight to the shop, with no app commission.',
  Services: 'A price list customers open and book from on WhatsApp.',
};
const DEFAULT_HOOK = 'One shop link with every product and price. Orders come to their WhatsApp, payments go to their own account, 0% commission. Offer a 10-minute demo.';

const GROUPS = [
  ['now', 'Call now', 'text-amber-700'], ['later', 'Later today', 'text-gray-700'],
  ['fresh', 'New for you', 'text-blue-700'], ['ahead', 'Coming up', 'text-gray-500'],
];

export default function CrmQueue() {
  const { me } = useCrm();
  const [leads, setLeads] = useState(null);
  const [cur, setCur] = useState(null);
  const [last, setLast] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [today, setToday] = useState({ calls: 0, picked: 0, demos: 0 });
  const [panelKey, setPanelKey] = useState(0);

  const load = useCallback(async () => {
    const all = await listLeads();
    setLeads(all.filter((l) => l.assigned_to === me.user_id));
    const acts = (await activitiesSince(new Date(istInstant(istDate())).toISOString())).filter((a) => a.staff_id === me.user_id && a.kind === 'call');
    setToday({
      calls: acts.length,
      picked: acts.filter((a) => !['no_answer', 'wrong_number'].includes(a.outcome)).length,
      demos: acts.filter((a) => a.outcome === 'demo').length,
    });
  }, [me.user_id]);
  useEffect(() => { load(); }, [load]);

  const q = useMemo(() => buildQueue(leads || []), [leads]);
  const order = useMemo(() => [...q.now, ...q.later, ...q.fresh, ...q.ahead], [q]);
  const current = useMemo(() => order.find((l) => l.id === cur) || q.now[0] || q.fresh[0] || q.later[0] || q.ahead[0] || null, [order, cur, q]);

  useEffect(() => {
    if (!current) { setLast(null); return undefined; }
    let alive = true;
    setLast(undefined);
    listActivities(current.id).then((xs) => { if (alive) setLast(xs.find((a) => a.kind !== 'stage') || null); });
    return () => { alive = false; };
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (r) => {
    setBusy(true); setErr('');
    try {
      await logActivity({ leadId: current.id, kind: 'call', outcome: r.outcome, note: r.note, stage: r.stage, nextAt: r.nextAt, next: r.next, lost: r.lost });
      if (r.outcome === 'won') await updateLead(current.id, { won_plan: r.wonPlan, won_amount: r.wonAmount });
      const idx = order.findIndex((l) => l.id === current.id);
      const next = order[idx + 1] || null;
      setCur(next?.id || null);
      setPanelKey((k) => k + 1);
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="px-4 lg:px-7 py-5 space-y-4">
      <header className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[200px]"><h1 className="text-2xl font-extrabold">Call queue</h1><p className="text-sm text-gray-500">Your leads only, most urgent first</p></div>
        {[['Calls today', today.calls, me.daily_target ? `of ${me.daily_target}` : ''], ['Picked up', today.picked, ''], ['Demos', today.demos, '']].map(([label, v, of]) => (
          <div key={label} className={`${card} px-4 py-2.5 min-w-[110px]`}>
            <div className="text-[11.5px] font-bold uppercase tracking-wide text-gray-500">{label}</div>
            <div className="text-xl font-extrabold">{v} <span className="text-[13px] text-gray-500 font-semibold">{of}</span></div>
          </div>
        ))}
      </header>

      {!leads ? <Spinner /> : !order.length ? <div className={card}><Empty>No leads in your queue. Ask your manager for more.</Empty></div> : (
        <div className="flex flex-col lg:flex-row gap-4 items-start">
          <section aria-label="Queue" className={`${card} w-full lg:w-[340px] shrink-0 overflow-hidden lg:max-h-[calc(100vh-10rem)] lg:overflow-y-auto`}>
            {GROUPS.map(([key, title, cls]) => q[key].length > 0 && (
              <div key={key}>
                <div className={`px-4 py-2 bg-gray-50 border-t border-gray-100 text-[12px] font-extrabold uppercase tracking-wide ${cls}`}>{title} · {q[key].length}</div>
                {q[key].slice(0, key === 'ahead' ? 15 : 60).map((l) => (
                  <button key={l.id} type="button" onClick={() => setCur(l.id)}
                    className={`w-full text-left px-4 py-2.5 border-t border-gray-100 flex gap-2 items-center ${current?.id === l.id ? 'bg-green-50' : 'bg-white'}`}>
                    <span className="flex-1 min-w-0"><span className="block font-bold text-[14px] truncate">{l.shop_name}</span>
                      <span className="block text-[12.5px] text-gray-500 truncate">{l.next_action || sourceLabel(l.source)}</span></span>
                    <span className={`text-[12px] font-bold shrink-0 ${key === 'now' ? 'text-amber-700' : 'text-gray-500'}`}>{l.next_action_at ? dueLabel(l.next_action_at) : 'New'}</span>
                  </button>
                ))}
              </div>
            ))}
          </section>

          {current && (
            <section aria-label="Current call" className="flex-1 min-w-0 w-full space-y-4">
              <div className={`${card} p-5 space-y-3`}>
                <div className="flex flex-wrap gap-3 items-start">
                  <div className="flex-1 min-w-[220px]">
                    <div className="text-[12px] font-extrabold uppercase tracking-wide text-amber-700">{current.next_action_at ? `${current.next_action || 'Follow up'} · ${dueLabel(current.next_action_at)}` : 'New lead'}</div>
                    <h2 className="text-2xl font-extrabold mt-1">{current.shop_name}</h2>
                    <p className="text-sm text-gray-600">{[current.owner_name, current.business_type, current.city, sourceLabel(current.source)].filter(Boolean).join(' · ')}</p>
                  </div>
                  <StagePill stage={current.stage} />
                </div>
                <div className="flex flex-wrap gap-2">
                  <a href={telHref(current.phone)} className={`${btn.primary} h-12 px-6 text-base`}><Icon name="phone" />Call {prettyPhone(current.phone)}</a>
                  <a href={waHref(current.phone)} target="_blank" rel="noreferrer" className={`${btn.ghost} h-12`}>WhatsApp</a>
                </div>
                <div className="bg-gray-50 rounded-xl px-4 py-3 text-sm text-gray-700">
                  <b className="text-gray-900">Last time: </b>
                  {last === undefined ? '…' : !last ? 'never contacted.' : `${shortDay(istDate(Date.parse(last.created_at)))} ${istTime(last.created_at)} · ${last.kind}${last.outcome ? ` · ${last.outcome.replace(/_/g, ' ')}` : ''}${last.note ? ` · “${last.note}”` : ''}`}
                </div>
                <div>
                  <h3 className="text-[12.5px] font-extrabold uppercase tracking-wide text-gray-500 mb-1">What to say</h3>
                  <p className="text-[14.5px] leading-relaxed">{HOOKS[current.business_type] || DEFAULT_HOOK}</p>
                </div>
              </div>
              <div className={`${card} p-5`}>
                <h3 className="font-extrabold text-lg mb-3">How did the call go?</h3>
                {err && <div className="mb-3"><Notice>{err}</Notice></div>}
                <OutcomePanel key={`${current.id}-${panelKey}`} lead={current} busy={busy} onSave={save} saveLabel="Save and call next" />
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

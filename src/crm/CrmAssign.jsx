// Manager: give leads to people. Tick leads, then one person, or split evenly
// between the people you pick. Each person's open-lead count keeps workloads fair.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCrm, initials } from './crmContext.js';
import { listLeads, assignLeads } from './crmService.js';
import { sourceLabel, splitEvenly, dueLabel } from './crmLogic.js';
import { Spinner, Empty, Notice, StagePill } from './ui.jsx';
import { btn, card, input } from './crmStyles.js';

export default function CrmAssign() {
  const { staff, path } = useCrm();
  const [leads, setLeads] = useState(null);
  const [show, setShow] = useState('none');
  const [sel, setSel] = useState(new Set());
  const [mode, setMode] = useState('one');
  const [to, setTo] = useState('');
  const [split, setSplit] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const [loadedAt, setLoadedAt] = useState(0);
  const load = useCallback(async () => { const ls = await listLeads(); setLeads(ls); setLoadedAt(Date.now()); setSel(new Set()); }, []);
  useEffect(() => { load(); }, [load]);

  const people = useMemo(() => staff.filter((s) => s.active), [staff]);
  const open = useMemo(() => {
    const c = {};
    for (const l of leads || []) if (l.assigned_to && l.stage !== 'won' && l.stage !== 'lost') c[l.assigned_to] = (c[l.assigned_to] || 0) + 1;
    return c;
  }, [leads]);

  const weekAgo = loadedAt - 7 * 86400000;
  const shown = useMemo(() => (leads || []).filter((l) => {
    if (l.stage === 'won' || l.stage === 'lost') return false;
    if (show === 'none') return !l.assigned_to;
    if (show === 'stale') return Date.parse(l.last_activity_at || l.created_at) < weekAgo;
    if (show === 'all') return true;
    return l.assigned_to === show;
  }).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)), [leads, show, weekAgo]);

  const toggle = (id) => { const s = new Set(sel); s.has(id) ? s.delete(id) : s.add(id); setSel(s); };
  const toggleSplit = (id) => { const s = new Set(split); s.has(id) ? s.delete(id) : s.add(id); setSplit(s); };
  const allOn = shown.length > 0 && shown.every((l) => sel.has(l.id));

  const give = async () => {
    setBusy(true); setMsg(null);
    try {
      const ids = shown.filter((l) => sel.has(l.id)).map((l) => l.id);
      let moved = 0;
      if (mode === 'one') {
        moved = await assignLeads(ids, to || null);
      } else {
        const groups = splitEvenly(ids, [...split]);
        for (const [uid, group] of Object.entries(groups)) if (group.length) moved += await assignLeads(group, uid);
      }
      setMsg({ kind: 'ok', text: `${moved} lead${moved === 1 ? '' : 's'} given out. They are in each person’s queue now.` });
      await load();
    } catch (e) {
      setMsg({ kind: 'error', text: e.message });
    } finally {
      setBusy(false);
    }
  };

  const ready = sel.size > 0 && (mode === 'one' ? true : split.size > 0);

  return (
    <div className="px-4 lg:px-7 py-5 space-y-4">
      <header className="flex flex-wrap items-center gap-3">
        <Link to={path('leads')} className="text-sm font-bold text-green-700">← Leads</Link>
        <h1 className="text-2xl font-extrabold flex-1">Assign leads</h1>
        <Link to={path('add')} className={btn.ghost}>Add leads</Link>
      </header>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      <div className="flex flex-col lg:flex-row gap-4 items-start">
        <section aria-label="Leads to give" className={`${card} flex-1 min-w-0 w-full overflow-hidden`}>
          <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-gray-100">
            <label htmlFor="show" className="text-[13px] font-bold text-gray-700">Show</label>
            <select id="show" className={`${input} h-10 sm:w-56`} value={show} onChange={(e) => { setShow(e.target.value); setSel(new Set()); }}>
              <option value="none">Not assigned</option>
              <option value="stale">Untouched for 7 days</option>
              <option value="all">Everyone’s open leads</option>
              {people.map((s) => <option key={s.user_id} value={s.user_id}>{s.name}’s leads</option>)}
            </select>
            <span className="flex-1" />
            <button type="button" className={btn.small} onClick={() => setSel(allOn ? new Set() : new Set(shown.map((l) => l.id)))}>
              {allOn ? 'Clear all' : `Select all ${shown.length}`}
            </button>
          </div>
          {!leads ? <Spinner /> : !shown.length ? <Empty>Nothing here. Every lead has an owner.</Empty> : (
            <ul className="divide-y divide-gray-100 max-h-[70vh] overflow-y-auto">
              {shown.map((l) => (
                <li key={l.id}>
                  <label className={`flex gap-3 items-center px-4 py-3 cursor-pointer ${sel.has(l.id) ? 'bg-green-50' : ''}`}>
                    <input type="checkbox" checked={sel.has(l.id)} onChange={() => toggle(l.id)} className="w-[18px] h-[18px] accent-green-700" />
                    <span className="flex-1 min-w-0">
                      <span className="block font-bold text-[14px] truncate">{l.shop_name}</span>
                      <span className="block text-[12.5px] text-gray-500 truncate">{[l.city, sourceLabel(l.source), l.next_action_at ? dueLabel(l.next_action_at) : ''].filter(Boolean).join(' · ')}</span>
                    </span>
                    <StagePill stage={l.stage} />
                  </label>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-label="Give to" className={`${card} w-full lg:w-[420px] shrink-0 p-4 space-y-3`}>
          <h2 className="text-lg font-extrabold">Give {sel.size} lead{sel.size === 1 ? '' : 's'} to…</h2>
          <div className="grid grid-cols-2 gap-2">
            {[['one', 'One person'], ['split', 'Split evenly']].map(([k, label]) => (
              <button key={k} type="button" aria-pressed={mode === k} onClick={() => setMode(k)}
                className={`h-11 rounded-xl border-2 text-[13.5px] font-bold ${mode === k ? 'border-green-700 bg-green-50' : 'border-gray-200 bg-white'}`}>{label}</button>
            ))}
          </div>
          <div className="space-y-2">
            {mode === 'one' && (
              <button type="button" aria-pressed={to === ''} onClick={() => setTo('')}
                className={`w-full text-left rounded-xl border-2 px-3 py-2.5 text-[13.5px] font-bold ${to === '' ? 'border-green-700 bg-green-50' : 'border-gray-200'}`}>Nobody (take them back)</button>
            )}
            {people.map((s) => {
              const on = mode === 'one' ? to === s.user_id : split.has(s.user_id);
              return (
                <button key={s.user_id} type="button" aria-pressed={on} onClick={() => (mode === 'one' ? setTo(s.user_id) : toggleSplit(s.user_id))}
                  className={`w-full flex items-center gap-3 rounded-xl border-2 px-3 py-2.5 text-left ${on ? 'border-green-700 bg-green-50' : 'border-gray-200'}`}>
                  <span aria-hidden="true" className="w-9 h-9 rounded-full bg-blue-100 text-blue-800 grid place-items-center text-[12px] font-extrabold">{initials(s.name)}</span>
                  <span className="flex-1 min-w-0"><span className="block font-bold text-[14px]">{s.name}</span>
                    <span className="block text-[12.5px] text-gray-500">{s.role} · {open[s.user_id] || 0} open leads</span></span>
                </button>
              );
            })}
          </div>
          <button type="button" className={`${btn.primary} w-full`} disabled={!ready || busy} onClick={give}>
            {busy ? 'Giving…' : !sel.size ? 'Tick the leads to give' : mode === 'one' ? 'Give them' : `Split between ${split.size} people`}
          </button>
          <p className="text-[12.5px] text-gray-500">The leads appear at the top of each person’s queue under “New for you”.</p>
        </section>
      </div>
    </div>
  );
}

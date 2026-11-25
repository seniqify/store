// Manager: auto-assign rules. New leads that arrive by themselves (PocketLink
// sign-ups, unfinished sign-ups) and leads added with "Auto" are given out by
// these rules: a place rule first (city or area contains the words), else the
// people in the list take turns, or whoever has the fewest open leads.
// The database applies them (sales_pick_owner), so they work with the app closed.
import { useState } from 'react';
import { useCrm } from './crmContext.js';
import { saveSetting, autoAssign } from './crmService.js';
import { Field, Notice, Icon } from './ui.jsx';
import { btn, card, input } from './crmStyles.js';

export default function CrmRules({ unassignedIds, onAssigned }) {
  const { staff, settings, refreshSettings, nameOf } = useCrm();
  const cur = settings?.auto_assign || {};
  const people = staff.filter((s) => s.active && s.role !== 'manager' && s.role !== 'ads');
  const [on, setOn] = useState(!!cur.on);
  const [how, setHow] = useState(cur.how === 'fewest' ? 'fewest' : 'turns');
  const [pool, setPool] = useState(() => (Array.isArray(cur.pool) ? cur.pool.filter((u) => staff.some((s) => s.user_id === u && s.role !== 'ads')) : []));
  const [places, setPlaces] = useState(() => (Array.isArray(cur.places) ? cur.places.map((p) => ({ match: p.match || '', to: p.to || '' })) : []));
  const [rotate, setRotate] = useState(String(Number(cur.rotate_min) || 0));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const togglePool = (u) => setPool(pool.includes(u) ? pool.filter((x) => x !== u) : [...pool, u]);
  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      const clean = places.map((p) => ({ match: p.match.trim().slice(0, 60), to: p.to })).filter((p) => p.match.length >= 2 && p.to);
      if (on && !pool.length && !clean.length) throw new Error('Tick at least one person, or add a place rule.');
      await saveSetting('auto_assign', { ...cur, on, how, pool, places: clean, rotate_min: Number(rotate) || 0 });
      await refreshSettings();
      setPlaces(clean);
      setMsg({ kind: 'ok', text: on ? 'Saved. New leads are given out by these rules from now on.' : 'Saved. Auto-assign is off; new leads wait in “Not assigned”.' });
    } catch (e) { setMsg({ kind: 'error', text: e.message }); } finally { setBusy(false); }
  };
  const runNow = async () => {
    setBusy(true); setMsg(null);
    try {
      const n = await autoAssign(unassignedIds);
      setMsg({ kind: 'ok', text: `${n} lead${n === 1 ? '' : 's'} given out by the rules.` });
      await onAssigned?.();
    } catch (e) { setMsg({ kind: 'error', text: e.message }); } finally { setBusy(false); }
  };

  return (
    <section aria-label="Auto-assign rules" className={`${card} p-4 space-y-3`}>
      <div className="flex items-center gap-3">
        <div className="flex-1"><h2 className="text-lg font-extrabold">Auto-assign rules</h2>
          <p className="text-[13px] text-gray-500">For new PocketLink sign-ups and leads added with “Auto”. Top to bottom, the first rule that fits wins.</p></div>
        <button type="button" role="switch" aria-checked={on} aria-label="Auto-assign on" onClick={() => setOn(!on)}
          className={`w-12 h-7 rounded-full relative shrink-0 ${on ? 'bg-green-600' : 'bg-gray-300'}`}>
          <span className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-all ${on ? 'left-6' : 'left-1'}`} />
        </button>
      </div>

      <div className={on ? '' : 'opacity-50 pointer-events-none'} aria-disabled={!on}>
        <ol className="space-y-2">
          {places.map((p, i) => (
            <li key={i} className="flex flex-wrap items-end gap-2 border border-gray-200 rounded-xl p-2.5">
              <span className="w-6 h-6 rounded-full bg-gray-900 text-white grid place-items-center text-[12px] font-extrabold mb-2.5">{i + 1}</span>
              <div className="flex-1 min-w-[130px]"><Field label="If city or area has" htmlFor={`pm-${i}`}>
                <input id={`pm-${i}`} className={input} value={p.match} placeholder="e.g. Pune" onChange={(e) => setPlaces(places.map((x, j) => (j === i ? { ...x, match: e.target.value } : x)))} /></Field></div>
              <div className="flex-1 min-w-[150px]"><Field label="give it to" htmlFor={`pt-${i}`}>
                <select id={`pt-${i}`} className={input} value={p.to} onChange={(e) => setPlaces(places.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)))}>
                  <option value="">Pick a person</option>{people.map((s) => <option key={s.user_id} value={s.user_id}>{s.name}</option>)}
                </select></Field></div>
              <button type="button" aria-label="Remove this rule" className="h-11 w-11 rounded-xl border border-gray-200 grid place-items-center" onClick={() => setPlaces(places.filter((_, j) => j !== i))}><Icon name="x" size={16} /></button>
            </li>
          ))}
          <li className="border border-gray-200 rounded-xl p-3 space-y-2">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-gray-900 text-white grid place-items-center text-[12px] font-extrabold">{places.length + 1}</span>
              <span className="font-bold text-[14px]">Everyone else: give out between</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {people.map((s) => (
                <button key={s.user_id} type="button" aria-pressed={pool.includes(s.user_id)} onClick={() => togglePool(s.user_id)}
                  className={`h-9 px-3 rounded-full border-2 text-[13px] font-bold ${pool.includes(s.user_id) ? 'border-green-700 bg-green-50' : 'border-gray-200 bg-white'}`}>
                  {pool.includes(s.user_id) ? `${pool.indexOf(s.user_id) + 1}. ` : ''}{s.name}</button>
              ))}
              {!people.length && <span className="text-[13px] text-gray-500">Add callers or field executives in Team first.</span>}
            </div>
            <div className="flex flex-wrap gap-2">
              {[['turns', 'One each, in turn'], ['fewest', 'Fewest open leads first']].map(([k, label]) => (
                <button key={k} type="button" aria-pressed={how === k} onClick={() => setHow(k)}
                  className={`h-9 px-3 rounded-lg border text-[13px] font-bold ${how === k ? 'border-green-700 bg-green-50' : 'border-gray-200 bg-white'}`}>{label}</button>
              ))}
            </div>
            {cur.last && how === 'turns' && <p className="text-[12px] text-gray-500">Last one went to {nameOf(cur.last) || 'someone'}.</p>}
          </li>
        </ol>
        <button type="button" className={`${btn.small} mt-2`} onClick={() => setPlaces([...places, { match: '', to: '' }])}><Icon name="plus" size={14} />Add a place rule</button>
        <div className="mt-3 max-w-md">
          <Field label="An ad or website lead nobody called" htmlFor="rot" hint="Checked every 5 minutes, 9:30 am to 8 pm. A lead moves only once.">
            <select id="rot" className={input} value={rotate} onChange={(e) => setRotate(e.target.value)}>
              <option value="0">Stays with the same person</option>
              {[10, 15, 30, 60].map((m) => <option key={m} value={m}>Moves to the next person after {m} minutes</option>)}
            </select>
          </Field>
        </div>
      </div>

      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btn.primary} disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save rules'}</button>
        {cur.on && unassignedIds.length > 0 && (
          <button type="button" className={btn.ghost} disabled={busy} onClick={runNow}>Give out the {unassignedIds.length} not assigned now</button>
        )}
      </div>
    </section>
  );
}

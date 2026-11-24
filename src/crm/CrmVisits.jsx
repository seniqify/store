// Manager: field visits for a day, with photo, place and time. Anything odd is
// flagged (far from the shop's first check-in, weak GPS, the same photo used
// twice, too far from the visit before for the time). The manager marks a
// flagged visit fine, or "do not count it" (it then leaves the score).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCrm, initials } from './crmContext.js';
import { visitsBetween, visitsForLeads, reviewVisit, photoUrl } from './crmService.js';
import { istDate, istInstant, addDays, istTime, shortDay, visitFlags, mapHref, waHref, kmLabel } from './crmLogic.js';
import { Icon, Spinner, Notice, Empty } from './ui.jsx';
import { btn, card, input } from './crmStyles.js';

const MET = { owner: 'Met the owner', staff: 'Staff only', closed: 'Shop closed' };
const RESULT = { interested: 'Interested', demo: 'Demo', think: 'Will think', won: 'Won', lost: 'Not interested' };
const outcomeLabel = (o) => { const [m, r] = String(o || '').split('_'); return [MET[m], RESULT[r]].filter(Boolean).join(' · ') || o || ''; };

function Thumb({ path }) {
  const [url, setUrl] = useState('');
  useEffect(() => { let alive = true; if (path) photoUrl(path).then((u) => { if (alive) setUrl(u); }); return () => { alive = false; }; }, [path]);
  if (!url) return <span className="w-16 h-16 rounded-lg bg-gray-100 shrink-0" aria-hidden="true" />;
  return <a href={url} target="_blank" rel="noreferrer" className="shrink-0"><img src={url} alt="Shop photo" className="w-16 h-16 rounded-lg object-cover border border-gray-200" /></a>;
}

export default function CrmVisits() {
  const { staff, nameOf, path } = useCrm();
  const today = istDate();
  const [day, setDay] = useState(today);
  const [who, setWho] = useState('all');
  const [visits, setVisits] = useState(null);
  const [flags, setFlags] = useState({});
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setErr('');
    try {
      const vs = await visitsBetween(new Date(istInstant(day)).toISOString(), new Date(istInstant(addDays(day, 1))).toISOString());
      const all = await visitsForLeads([...new Set(vs.map((v) => v.lead_id))]);
      const byId = new Map([...all, ...vs].map((v) => [v.id, v]));
      // Same-day visits by the same people to other shops matter for "too far for the time".
      setFlags(visitFlags([...byId.values()]));
      setVisits(vs);
    } catch (e) { setErr(e.message); setVisits([]); }
  }, [day]);
  useEffect(() => { setVisits(null); load(); }, [load]);

  const shown = useMemo(() => (visits || []).filter((v) => who === 'all' || v.staff_id === who), [visits, who]);
  const people = useMemo(() => {
    const ids = new Set([...(visits || []).map((v) => v.staff_id), ...staff.filter((s) => s.active && s.role === 'field').map((s) => s.user_id)]);
    return staff.filter((s) => ids.has(s.user_id));
  }, [visits, staff]);
  const toCheck = shown.filter((v) => flags[v.id] && !v.review);
  const byPerson = useMemo(() => {
    const m = new Map();
    for (const v of shown) { if (!m.has(v.staff_id)) m.set(v.staff_id, []); m.get(v.staff_id).push(v); }
    return [...m.entries()];
  }, [shown]);

  const mark = async (id, review) => { try { await reviewVisit(id, review); await load(); } catch (e) { setErr(e.message); } };
  const phoneOf = (id) => staff.find((s) => s.user_id === id)?.phone;

  return (
    <div className="px-4 lg:px-7 py-5 space-y-4">
      <header className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[220px]"><h1 className="text-2xl font-extrabold">Field visits · {day === today ? 'today' : shortDay(day)}</h1>
          <p className="text-sm text-gray-500">Every check-in with its photo, place and time. Anything odd is flagged for you.</p></div>
        <input type="date" aria-label="Day" className={`${input} h-10 sm:w-44`} value={day} max={today} onChange={(e) => e.target.value && setDay(e.target.value)} />
        <select aria-label="Person" className={`${input} h-10 sm:w-48`} value={who} onChange={(e) => setWho(e.target.value)}>
          <option value="all">Everyone</option>{people.map((s) => <option key={s.user_id} value={s.user_id}>{s.name}</option>)}
        </select>
      </header>
      {err && <Notice>{err}</Notice>}
      {!visits ? <Spinner /> : (
        <>
          <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              ['Visits', shown.length, `${new Set(shown.map((v) => v.lead_id)).size} shops`],
              ['Look fine', shown.filter((v) => !flags[v.id] || v.review === 'ok').length, 'photo + place'],
              ['To check', toCheck.length, toCheck.length ? 'see below' : 'nothing odd'],
              ['First · last check-in', shown.length ? `${istTime(shown[0].created_at)} · ${istTime(shown[shown.length - 1].created_at)}` : '—', ''],
            ].map(([label, v, sub]) => (
              <div key={label} className={`${card} px-4 py-3`}><div className="text-[11.5px] font-bold uppercase tracking-wide text-gray-500">{label}</div>
                <div className="text-xl font-extrabold mt-0.5">{v}</div>{sub && <div className="text-[12.5px] text-gray-500">{sub}</div>}</div>
            ))}
          </section>

          {toCheck.length > 0 && (
            <section aria-label="To check" className={`${card} border-amber-300 overflow-hidden`}>
              <h2 className="px-4 pt-3 pb-2 font-extrabold">Check {toCheck.length === 1 ? 'this visit' : `these ${toCheck.length} visits`}</h2>
              <ul className="divide-y divide-gray-100">
                {toCheck.map((v) => {
                  const first = nameOf(v.staff_id).split(' ')[0];
                  const shop = v.sales_leads?.shop_name || 'a shop';
                  return (
                    <li key={v.id} className="px-4 py-3 flex flex-wrap gap-3 items-start">
                      <Thumb path={v.photo_path} />
                      <div className="flex-1 min-w-[220px]">
                        <div className="font-bold">{nameOf(v.staff_id)} · <Link to={path(`leads/${v.lead_id}`)} className="text-gray-900">{shop}</Link> · {istTime(v.created_at)}</div>
                        <ul className="text-[13px] text-amber-900 list-disc pl-5">{flags[v.id].map((f) => <li key={f}>{f}</li>)}</ul>
                        <a href={mapHref(v.lat, v.lng)} target="_blank" rel="noreferrer" className="text-[12.5px] font-bold">See the place on the map{v.accuracy_m ? ` (±${kmLabel(v.accuracy_m)})` : ''}</a>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {phoneOf(v.staff_id) && <a className={btn.small} target="_blank" rel="noreferrer"
                          href={waHref(phoneOf(v.staff_id), `Namaskar ${first}, about your visit to ${shop} at ${istTime(v.created_at)}: `)}><Icon name="wa" size={14} />Ask {first}</a>}
                        <button type="button" className={btn.smallGreen} onClick={() => mark(v.id, 'ok')}>It is fine</button>
                        <button type="button" className={btn.small} onClick={() => mark(v.id, 'rejected')}>Do not count it</button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {!byPerson.length ? <Empty>No visits on this day.</Empty> : byPerson.map(([uid, vs]) => (
            <section key={uid} aria-label={nameOf(uid)} className={`${card} overflow-hidden`}>
              <div className="flex items-center gap-2.5 px-4 pt-3 pb-2">
                <span aria-hidden="true" className="w-8 h-8 rounded-full bg-blue-100 text-blue-800 grid place-items-center text-[11px] font-extrabold">{initials(nameOf(uid))}</span>
                <h2 className="font-extrabold flex-1">{nameOf(uid)}’s day</h2>
                <span className="text-[13px] text-gray-500">{vs.length} visit{vs.length === 1 ? '' : 's'} · {istTime(vs[0].created_at)} – {istTime(vs[vs.length - 1].created_at)}</span>
              </div>
              <ol className="divide-y divide-gray-100">
                {vs.map((v) => (
                  <li key={v.id} className={`px-4 py-3 flex gap-3 items-start ${v.review === 'rejected' ? 'opacity-60' : ''}`}>
                    <span className="w-16 text-[13px] font-extrabold text-gray-700 pt-0.5">{istTime(v.created_at)}</span>
                    <Thumb path={v.photo_path} />
                    <div className="flex-1 min-w-0">
                      <div className="font-bold"><Link to={path(`leads/${v.lead_id}`)} className="text-gray-900">{v.sales_leads?.shop_name || 'Shop'}</Link></div>
                      <div className="text-[13px] text-gray-600">{outcomeLabel(v.outcome)}{v.sales_leads?.area || v.sales_leads?.city ? ` · ${[v.sales_leads?.area, v.sales_leads?.city].filter(Boolean).join(', ')}` : ''}</div>
                      {v.note && <div className="text-[13px] text-gray-800">“{v.note}”</div>}
                      <div className="flex flex-wrap gap-x-3 text-[12.5px] mt-0.5">
                        <a href={mapHref(v.lat, v.lng)} target="_blank" rel="noreferrer" className="font-bold">Map{v.accuracy_m ? ` ±${kmLabel(v.accuracy_m)}` : ''}</a>
                        {v.review === 'ok' && <span className="font-bold text-green-700">Checked: fine</span>}
                        {v.review === 'rejected' && <span className="font-bold text-red-700">Not counted</span>}
                        {flags[v.id] && !v.review && <span className="font-bold text-amber-800">To check</span>}
                        {v.review && <button type="button" className="font-bold text-gray-500 underline" onClick={() => mark(v.id, null)}>Undo</button>}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </>
      )}
    </div>
  );
}

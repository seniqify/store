// Add one lead. The number is checked against every lead as it is typed, so
// two people never work the same shop. A manager picks who gets it; anyone
// else adds it to their own list. The first step becomes a follow-up.
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useCrm } from './crmContext.js';
import { addLead, lookupPhone, listLeads, autoAssign } from './crmService.js';
import CrmImport from './CrmImport.jsx';
import { phone10, BUSINESS_TYPES, SOURCES, whenPresets, stageOf } from './crmLogic.js';
import { Field, Notice } from './ui.jsx';
import { btn, input, card } from './crmStyles.js';

const FIRST_STEPS = [
  ['call_today', 'Call today'], ['call_tomorrow', 'Call tomorrow'], ['visit', 'Visit the shop'], ['whatsapp', 'Send WhatsApp first'],
];
const PICKABLE_SOURCES = ['referral', 'calling_list', 'field', 'walk_in', 'instagram', 'facebook', 'google', 'website', 'manual'];

export default function CrmAddLead() {
  const { me, staff, path, settings } = useCrm();
  const navigate = useNavigate();
  const isManager = me.role === 'manager';
  const [params, setParams] = useSearchParams();
  const tab = isManager && params.get('tab') === 'import' ? 'import' : 'one';
  const rulesOn = !!settings?.auto_assign?.on;
  const [f, setF] = useState({
    shop_name: '', owner_name: '', phone: '', business_type: '', city: '', area: '',
    source: me.role === 'field' ? 'field' : 'referral', heat: 'warm', assigned_to: isManager ? '' : me.user_id, step: 'call_today', note: '',
  });
  const [dupe, setDupe] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [openCounts, setOpenCounts] = useState({});
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  useEffect(() => {
    if (!isManager) return;
    listLeads().then((ls) => {
      const c = {};
      for (const l of ls) if (l.assigned_to && l.stage !== 'won' && l.stage !== 'lost') c[l.assigned_to] = (c[l.assigned_to] || 0) + 1;
      setOpenCounts(c);
    });
  }, [isManager]);

  const p10 = phone10(f.phone);
  useEffect(() => {
    if (!p10) { setDupe([]); return undefined; }
    const t = setTimeout(() => lookupPhone(p10).then(setDupe), 300);
    return () => clearTimeout(t);
  }, [p10]);

  const people = useMemo(() => staff.filter((s) => s.active), [staff]);
  const valid = f.shop_name.trim() && /^[6-9][0-9]{9}$/.test(p10) && !dupe.length;

  const save = async (again) => {
    setBusy(true); setErr('');
    try {
      const pre = whenPresets();
      const step = {
        call_today: [Math.max(Date.now() + 5 * 60000, pre.in1h - 55 * 60000), 'Call'],
        call_tomorrow: [pre.tomorrow, 'Call'],
        visit: [pre.tomorrow, 'Visit the shop'],
        whatsapp: [Date.now() + 5 * 60000, 'Send WhatsApp, then call'],
      }[f.step];
      const row = await addLead({
        shop_name: f.shop_name.trim(), owner_name: f.owner_name.trim() || null, phone: p10,
        business_type: f.business_type || null, city: f.city.trim() || null, area: f.area.trim() || null,
        source: f.source, heat: f.heat, assigned_to: f.assigned_to && f.assigned_to !== 'auto' ? f.assigned_to : null,
        next_action_at: new Date(step[0]).toISOString(), next_action: f.note.trim() ? `${step[1]} · ${f.note.trim()}`.slice(0, 200) : step[1],
      });
      if (f.assigned_to === 'auto') await autoAssign([row.id]);
      if (again) {
        setF({ ...f, shop_name: '', owner_name: '', phone: '', area: '', note: '' });
      } else {
        navigate(path(`leads/${row.id}`));
      }
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="px-4 lg:px-7 py-5 max-w-3xl space-y-4">
      <header className="flex items-center gap-3">
        <Link to={path('leads')} className="text-sm font-bold text-green-700">← Leads</Link>
        <h1 className="text-2xl font-extrabold">{tab === 'import' ? 'Import a list' : 'Add a lead'}</h1>
      </header>
      {isManager && (
        <div className="flex gap-2" role="tablist" aria-label="How to add">
          {[['one', 'One lead'], ['import', 'Import a list (Excel / CSV)']].map(([k, label]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setParams(k === 'import' ? { tab: 'import' } : {}, { replace: true })}
              className={`h-10 px-4 rounded-full border text-[13.5px] font-bold ${tab === k ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-200 text-gray-700'}`}>{label}</button>
          ))}
        </div>
      )}
      {tab === 'import' ? <CrmImport /> : (
      <form className={`${card} p-5 space-y-4`} onSubmit={(e) => { e.preventDefault(); if (valid) save(false); }}>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Shop name *" htmlFor="sn"><input id="sn" className={input} value={f.shop_name} onChange={set('shop_name')} required /></Field>
          <Field label="Owner’s name" htmlFor="on"><input id="on" className={input} value={f.owner_name} onChange={set('owner_name')} /></Field>
          <Field label="Mobile *" htmlFor="ph"><input id="ph" inputMode="tel" className={input} value={f.phone} onChange={set('phone')} placeholder="10-digit mobile" required /></Field>
          <Field label="Type of business" htmlFor="bt">
            <select id="bt" className={input} value={f.business_type} onChange={set('business_type')}>
              <option value="">Pick one</option>{BUSINESS_TYPES.map((b) => <option key={b}>{b}</option>)}
            </select>
          </Field>
        </div>
        {dupe.length > 0 && (
          <Notice kind="warn">
            <b>This number is already a lead:</b> {dupe[0].shop_name}, {stageOf(dupe[0].stage).label}
            {dupe[0].owner_name ? `, with ${dupe[0].owner_name}` : ', not assigned'}.{' '}
            {(dupe[0].mine || isManager) ? <Link className="font-bold" to={path(`leads/${dupe[0].lead_id}`)}>Open it</Link> : 'Ask your manager if you should have it.'}
          </Notice>
        )}
        {f.phone && !p10 && <p className="text-[13px] text-red-700">Enter all 10 digits.</p>}
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label="City" htmlFor="ct"><input id="ct" className={input} value={f.city} onChange={set('city')} /></Field>
          <Field label="Area" htmlFor="ar"><input id="ar" className={input} value={f.area} onChange={set('area')} /></Field>
          <Field label="Came from" htmlFor="sr">
            <select id="sr" className={input} value={f.source} onChange={set('source')}>
              {PICKABLE_SOURCES.map((k) => <option key={k} value={k}>{SOURCES[k]}</option>)}
            </select>
          </Field>
        </div>
        <div>
          <p className="text-[13px] font-bold text-gray-700 mb-1.5">How hot is it?</p>
          <div className="flex gap-2">
            {[['hot', 'Hot'], ['warm', 'Warm'], ['cold', 'Cold']].map(([k, label]) => (
              <button key={k} type="button" aria-pressed={f.heat === k} onClick={() => setF({ ...f, heat: k })}
                className={`h-10 px-4 rounded-lg border-2 text-[13.5px] font-bold ${f.heat === k ? 'border-green-700 bg-green-50' : 'border-gray-200 bg-white'}`}>{label}</button>
            ))}
          </div>
        </div>
        <div className="grid sm:grid-cols-2 gap-3 border-t border-gray-100 pt-4">
          {isManager ? (
            <Field label="Give it to" htmlFor="as">
              <select id="as" className={input} value={f.assigned_to} onChange={set('assigned_to')}>
                {rulesOn && <option value="auto">Auto: follow my rules</option>}
                <option value="">Keep unassigned for now</option>
                {people.map((s) => <option key={s.user_id} value={s.user_id}>{s.name} · {s.role} · {openCounts[s.user_id] || 0} open</option>)}
              </select>
            </Field>
          ) : (
            <Field label="Given to" htmlFor="as"><input id="as" className={input} value="You" readOnly /></Field>
          )}
          <Field label="First step" htmlFor="fs">
            <select id="fs" className={input} value={f.step} onChange={set('step')}>
              {FIRST_STEPS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Note for them" htmlFor="nt"><input id="nt" className={input} value={f.note} onChange={set('note')} placeholder="Anything to know before calling" /></Field>
        {err && <Notice>{err}</Notice>}
        <div className="flex flex-wrap gap-2">
          <button type="submit" className={btn.primary} disabled={!valid || busy}>{busy ? 'Saving…' : 'Save lead'}</button>
          <button type="button" className={btn.ghost} disabled={!valid || busy} onClick={() => save(true)}>Save and add another</button>
        </div>
      </form>
      )}
    </div>
  );
}

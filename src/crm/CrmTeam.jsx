// Manager: who works in the CRM, their role, area, score targets, shift and
// weekly off; the incentive per paid shop. Adding a person creates their login (sales-staff edge function); someone
// who leaves is switched off and their leads can be moved in Assign.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useCrm, initials, ROLE_LABEL } from './crmContext.js';
import { addStaff, updateStaff, resetStaffPassword, signOff } from './crmService.js';
import { KPI_DEFS, kpiTarget, kpiValue } from './crmLogic.js';
import { PRICE } from '../utils/planLimits.js';
import { Field, Notice } from './ui.jsx';
import { btn, card, input } from './crmStyles.js';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAILY_LABEL = { field: 'Visits a day', ads: 'Leads checked a day' };

function Person({ s, me, onSaved }) {
  const [f, setF] = useState({
    role: s.role, area: s.area || '', daily_target: s.daily_target ?? '', monthly_target: s.monthly_target ?? '',
    shift_start: String(s.shift_start).slice(0, 5), shift_end: String(s.shift_end).slice(0, 5), weekly_off: s.weekly_off, active: s.active, must_train: !!s.must_train,
    targets: Object.fromEntries(Object.entries(s.targets || {}).map(([k, v]) => [k, String(v)])),
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const self = s.user_id === me.user_id;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      await updateStaff(s.user_id, {
        role: f.role, area: f.area.trim() || null,
        daily_target: f.daily_target === '' ? null : Number(f.daily_target), monthly_target: f.monthly_target === '' ? null : Number(f.monthly_target),
        shift_start: f.shift_start, shift_end: f.shift_end, weekly_off: Number(f.weekly_off), active: f.active, must_train: f.must_train,
        targets: Object.fromEntries(Object.entries(f.targets).filter(([, v]) => Number(v) > 0).map(([k, v]) => [k, Number(v)])),
      });
      setMsg({ kind: 'ok', text: 'Saved.' });
      await onSaved();
    } catch (e) { setMsg({ kind: 'error', text: e.message }); } finally { setBusy(false); }
  };
  const toggleSignOff = async () => {
    setBusy(true); setMsg(null);
    try { await signOff(s.user_id, !s.signed_off_at); setMsg({ kind: 'ok', text: s.signed_off_at ? 'Sign-off removed.' : `${s.name} is signed off.` }); await onSaved(); }
    catch (e) { setMsg({ kind: 'error', text: e.message }); } finally { setBusy(false); }
  };
  const newPassword = async () => {
    const pw = window.prompt(`New password for ${s.name} (at least 8 characters):`);
    if (!pw) return;
    setBusy(true); setMsg(null);
    try { await resetStaffPassword(s.user_id, pw); setMsg({ kind: 'ok', text: 'Password changed. Tell them the new one.' }); }
    catch (e) { setMsg({ kind: 'error', text: e.message }); } finally { setBusy(false); }
  };

  return (
    <details className={`${card} p-4 ${f.active ? '' : 'opacity-70'}`}>
      <summary className="flex items-center gap-3 cursor-pointer list-none">
        <span aria-hidden="true" className="w-10 h-10 rounded-full bg-blue-100 text-blue-800 grid place-items-center text-[12px] font-extrabold">{initials(s.name)}</span>
        <span className="flex-1 min-w-0"><span className="block font-bold">{s.name}{self ? ' (you)' : ''}</span>
          <span className="block text-[12.5px] text-gray-500 truncate">{s.email || ''}</span></span>
        {s.ref_code && <span className="hidden sm:inline text-[12px] font-extrabold tracking-widest rounded-md px-2 py-0.5 bg-gray-900 text-white" title="Own sign-up code">{s.ref_code}</span>}
        {s.role !== 'manager' && (s.signed_off_at ? <span className="text-[12px] font-bold rounded-full px-2.5 py-0.5 bg-green-100 text-green-800">Signed off</span>
          : s.qualified_at ? <span className="text-[12px] font-bold rounded-full px-2.5 py-0.5 bg-blue-100 text-blue-800">Passed · to sign off</span>
          : s.must_train ? <span className="text-[12px] font-bold rounded-full px-2.5 py-0.5 bg-amber-100 text-amber-900">In training</span> : null)}
        <span className="text-[12px] font-bold rounded-full px-2.5 py-0.5 bg-gray-100 text-gray-800">{ROLE_LABEL[s.role]}{s.active ? '' : ' · off'}</span>
      </summary>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
        <Field label="Role" htmlFor={`r-${s.user_id}`}>
          <select id={`r-${s.user_id}`} className={input} value={f.role} onChange={set('role')} disabled={self}>
            <option value="manager">Manager</option><option value="caller">Calling executive</option><option value="field">Field executive</option><option value="ads">Ads &amp; leads executive</option>
          </select>
        </Field>
        <Field label="Area or list" htmlFor={`a-${s.user_id}`}><input id={`a-${s.user_id}`} className={input} value={f.area} onChange={set('area')} placeholder="e.g. Solapur east" /></Field>
        <Field label={DAILY_LABEL[f.role] || 'Calls a day'} htmlFor={`d-${s.user_id}`}><input id={`d-${s.user_id}`} type="number" min="0" className={input} value={f.daily_target} onChange={set('daily_target')} placeholder={{ field: '8', ads: '40' }[f.role] || '80'} /></Field>
        <Field label={f.role === 'ads' ? 'Paid shops from checked leads a month' : 'Paid shops a month'} htmlFor={`m-${s.user_id}`}><input id={`m-${s.user_id}`} type="number" min="0" className={input} value={f.monthly_target} onChange={set('monthly_target')} placeholder={{ field: '8', ads: '4' }[f.role] || '10'} /></Field>
        <Field label="Shift starts" htmlFor={`ss-${s.user_id}`}><input id={`ss-${s.user_id}`} type="time" className={input} value={f.shift_start} onChange={set('shift_start')} /></Field>
        <Field label="Shift ends" htmlFor={`se-${s.user_id}`}><input id={`se-${s.user_id}`} type="time" className={input} value={f.shift_end} onChange={set('shift_end')} /></Field>
        <Field label="Weekly off" htmlFor={`w-${s.user_id}`}>
          <select id={`w-${s.user_id}`} className={input} value={f.weekly_off} onChange={set('weekly_off')}>{DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select>
        </Field>
        {f.role !== 'manager' && (
          <Field label="Must pass training" htmlFor={`mt-${s.user_id}`}>
            <select id={`mt-${s.user_id}`} className={input} value={f.must_train ? 'yes' : 'no'} onChange={(e) => setF({ ...f, must_train: e.target.value === 'yes' })}>
              <option value="yes">Yes, before their work opens</option><option value="no">No</option>
            </select>
          </Field>
        )}
        <Field label="Can sign in" htmlFor={`ac-${s.user_id}`}>
          <select id={`ac-${s.user_id}`} className={input} value={f.active ? 'yes' : 'no'} onChange={(e) => setF({ ...f, active: e.target.value === 'yes' })} disabled={self}>
            <option value="yes">Yes</option><option value="no">No (left or paused)</option>
          </select>
        </Field>
      </div>
      {f.role !== 'manager' && (
        <div className="mt-4 border-t border-gray-100 pt-3">
          <p className="text-[13px] font-extrabold text-gray-700">Score targets <span className="font-semibold text-gray-500">· a month unless it says a day or %. Empty = the usual target (shown in grey).</span></p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-2">
            {(KPI_DEFS[f.role] || []).filter((d) => !d.column).map((d) => (
              <Field key={d.key} label={`${d.label}${d.kind === 'pct' ? ' (%)' : d.kind === 'money' ? ' (₹)' : ''}`} htmlFor={`t-${d.key}-${s.user_id}`}>
                <input id={`t-${d.key}-${s.user_id}`} type="number" min="0" className={input} value={f.targets[d.key] ?? ''}
                  placeholder={kpiValue(d.kind, kpiTarget(d, { ...s, role: f.role, targets: {}, daily_target: Number(f.daily_target) || null, monthly_target: Number(f.monthly_target) || null }, PRICE.monthly)).replace(/[₹,%]/g, '')}
                  onChange={(e) => setF({ ...f, targets: { ...f.targets, [d.key]: e.target.value } })} />
              </Field>
            ))}
          </div>
        </div>
      )}
      {f.role === 'ads' && s.role !== 'ads' && <div className="mt-3"><Notice kind="warn">The Ads &amp; leads team owns no leads. Move this person’s open leads in Assign before you save.</Notice></div>}
      {s.role !== 'manager' && s.qualified_at && (
        <div className="mt-4 border-t border-gray-100 pt-3 flex flex-wrap items-center gap-3">
          <p className="flex-1 min-w-[220px] text-[13.5px] text-gray-700">{s.signed_off_at
            ? <>Signed off on {new Date(s.signed_off_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}: ready to work on their own.</>
            : <>Passed the exam. Listen to a few of their calls, join a visit or watch them check leads, then sign them off.</>}</p>
          <button type="button" className={s.signed_off_at ? btn.ghost : btn.dark} disabled={busy} onClick={toggleSignOff}>{s.signed_off_at ? 'Undo sign-off' : 'Sign off: ready to work'}</button>
        </div>
      )}
      {msg && <div className="mt-3"><Notice kind={msg.kind}>{msg.text}</Notice></div>}
      <div className="flex flex-wrap gap-2 mt-3">
        <button type="button" className={btn.primary} disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
        {!self && s.role !== 'manager' && <button type="button" className={btn.ghost} disabled={busy} onClick={newPassword}>Set a new password</button>}
      </div>
    </details>
  );
}

export default function CrmTeam() {
  const { me, staff, refreshStaff, path } = useCrm();
  const [f, setF] = useState({ name: '', email: '', password: '', role: 'caller', phone: '', area: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const add = async (e) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const r = await addStaff(f);
      setMsg({ kind: 'ok', text: r.existing ? `${f.name} added. They sign in with their existing password.` : `${f.name} added. Send them crm.pocketlink.store, their email and this password.` });
      setF({ name: '', email: '', password: '', role: 'caller', phone: '', area: '' });
      await refreshStaff();
    } catch (err) { setMsg({ kind: 'error', text: err.message }); } finally { setBusy(false); }
  };

  return (
    <div className="px-4 lg:px-7 py-5 max-w-5xl space-y-4">
      <h1 className="text-2xl font-extrabold">Team &amp; targets</h1>
      <p className="text-sm text-gray-600">Callers and field executives see only their own leads. The Ads &amp; leads executive sees leads from ads and the website, checks them and adds new ones, but owns none and sees nobody else’s score or incentive. Managers see everything. Nobody in the CRM can see shops, orders or the Console.</p>
      <div className="space-y-3">{staff.map((s) => <Person key={s.user_id} s={s} me={me} onSaved={refreshStaff} />)}</div>
      <p className="text-[13px] text-gray-600">The incentive rule, team targets, score weights, shifts and holidays are in <Link to={path('settings')} className="font-bold">Settings</Link>.</p>
      <form onSubmit={add} className={`${card} p-5 space-y-3`}>
        <h2 className="font-extrabold text-lg">Add a person</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Name" htmlFor="tn"><input id="tn" className={input} value={f.name} onChange={set('name')} required /></Field>
          <Field label="Role" htmlFor="tr">
            <select id="tr" className={input} value={f.role} onChange={set('role')}>
              <option value="caller">Calling executive</option><option value="field">Field executive</option><option value="ads">Ads &amp; leads executive</option><option value="manager">Manager</option>
            </select>
          </Field>
          <Field label="Email (they sign in with it)" htmlFor="te"><input id="te" type="email" className={input} value={f.email} onChange={set('email')} required /></Field>
          <Field label="Starting password" htmlFor="tp" hint="At least 8 characters. They can change it later."><input id="tp" className={input} value={f.password} onChange={set('password')} required minLength={8} /></Field>
          <Field label="Mobile" htmlFor="tm"><input id="tm" inputMode="tel" className={input} value={f.phone} onChange={set('phone')} /></Field>
          <Field label="Area or list" htmlFor="ta"><input id="ta" className={input} value={f.area} onChange={set('area')} /></Field>
        </div>
        {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
        <button type="submit" className={btn.primary} disabled={busy}>{busy ? 'Adding…' : 'Add person'}</button>
      </form>
    </div>
  );
}

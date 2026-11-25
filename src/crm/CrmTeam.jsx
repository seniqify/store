// Manager: who works in the CRM, their role, area, score targets, shift and
// weekly off; the incentive per paid shop. Adding a person creates their login (sales-staff edge function); someone
// who leaves is switched off and their leads can be moved in Assign.
import { useState } from 'react';
import { useCrm, initials, ROLE_LABEL } from './crmContext.js';
import { addStaff, updateStaff, resetStaffPassword, saveSetting } from './crmService.js';
import { KPI_DEFS, kpiTarget, kpiValue } from './crmLogic.js';
import { PRICE } from '../utils/planLimits.js';
import { Field, Notice } from './ui.jsx';
import { btn, card, input } from './crmStyles.js';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function Person({ s, me, onSaved }) {
  const [f, setF] = useState({
    role: s.role, area: s.area || '', daily_target: s.daily_target ?? '', monthly_target: s.monthly_target ?? '',
    shift_start: String(s.shift_start).slice(0, 5), shift_end: String(s.shift_end).slice(0, 5), weekly_off: s.weekly_off, active: s.active,
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
        shift_start: f.shift_start, shift_end: f.shift_end, weekly_off: Number(f.weekly_off), active: f.active,
        targets: Object.fromEntries(Object.entries(f.targets).filter(([, v]) => Number(v) > 0).map(([k, v]) => [k, Number(v)])),
      });
      setMsg({ kind: 'ok', text: 'Saved.' });
      await onSaved();
    } catch (e) { setMsg({ kind: 'error', text: e.message }); } finally { setBusy(false); }
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
        <span className="text-[12px] font-bold rounded-full px-2.5 py-0.5 bg-gray-100 text-gray-800">{ROLE_LABEL[s.role]}{s.active ? '' : ' · off'}</span>
      </summary>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
        <Field label="Role" htmlFor={`r-${s.user_id}`}>
          <select id={`r-${s.user_id}`} className={input} value={f.role} onChange={set('role')} disabled={self}>
            <option value="manager">Manager</option><option value="caller">Calling executive</option><option value="field">Field executive</option>
          </select>
        </Field>
        <Field label="Area or list" htmlFor={`a-${s.user_id}`}><input id={`a-${s.user_id}`} className={input} value={f.area} onChange={set('area')} placeholder="e.g. Solapur east" /></Field>
        <Field label={f.role === 'field' ? 'Visits a day' : 'Calls a day'} htmlFor={`d-${s.user_id}`}><input id={`d-${s.user_id}`} type="number" min="0" className={input} value={f.daily_target} onChange={set('daily_target')} placeholder={f.role === 'field' ? '8' : '80'} /></Field>
        <Field label="Paid shops a month" htmlFor={`m-${s.user_id}`}><input id={`m-${s.user_id}`} type="number" min="0" className={input} value={f.monthly_target} onChange={set('monthly_target')} placeholder={f.role === 'field' ? '8' : '10'} /></Field>
        <Field label="Shift starts" htmlFor={`ss-${s.user_id}`}><input id={`ss-${s.user_id}`} type="time" className={input} value={f.shift_start} onChange={set('shift_start')} /></Field>
        <Field label="Shift ends" htmlFor={`se-${s.user_id}`}><input id={`se-${s.user_id}`} type="time" className={input} value={f.shift_end} onChange={set('shift_end')} /></Field>
        <Field label="Weekly off" htmlFor={`w-${s.user_id}`}>
          <select id={`w-${s.user_id}`} className={input} value={f.weekly_off} onChange={set('weekly_off')}>{DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select>
        </Field>
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
      {msg && <div className="mt-3"><Notice kind={msg.kind}>{msg.text}</Notice></div>}
      <div className="flex flex-wrap gap-2 mt-3">
        <button type="button" className={btn.primary} disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
        {!self && s.role !== 'manager' && <button type="button" className={btn.ghost} disabled={busy} onClick={newPassword}>Set a new password</button>}
      </div>
    </details>
  );
}

function Incentive() {
  const { settings, refreshSettings } = useCrm();
  const cur = settings?.incentive || {};
  const [f, setF] = useState({ per_paid: cur.per_paid ? String(cur.per_paid) : '', pay_day: cur.pay_day || '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      await saveSetting('incentive', { ...cur, per_paid: Number(f.per_paid) > 0 ? Math.round(Number(f.per_paid)) : 0, pay_day: f.pay_day.trim().slice(0, 80) });
      await refreshSettings();
      setMsg({ kind: 'ok', text: 'Saved. It shows on Performance and on each person’s score.' });
    } catch (e) { setMsg({ kind: 'error', text: e.message }); } finally { setBusy(false); }
  };
  return (
    <section className={`${card} p-5 space-y-3`}>
      <h2 className="font-extrabold text-lg">Incentive</h2>
      <p className="text-sm text-gray-600">Shown to the team on their score. Leave the amount empty if there is no incentive. Write the full rule in FAQ &amp; help.</p>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="For each paid shop (₹)" htmlFor="inc-a"><input id="inc-a" type="number" min="0" className={input} value={f.per_paid} onChange={(e) => setF({ ...f, per_paid: e.target.value })} placeholder="e.g. 300" /></Field>
        <Field label="When it is paid" htmlFor="inc-d"><input id="inc-d" className={input} value={f.pay_day} onChange={(e) => setF({ ...f, pay_day: e.target.value })} placeholder="e.g. on the 5th of next month" /></Field>
      </div>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      <button type="button" className={btn.primary} disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save incentive'}</button>
    </section>
  );
}

export default function CrmTeam() {
  const { me, staff, refreshStaff, settings } = useCrm();
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
      <p className="text-sm text-gray-600">Callers and field executives see only their own leads. Managers see everything. Nobody in the CRM can see shops, orders or the Console.</p>
      <div className="space-y-3">{staff.map((s) => <Person key={s.user_id} s={s} me={me} onSaved={refreshStaff} />)}</div>
      {settings && <Incentive />}
      <form onSubmit={add} className={`${card} p-5 space-y-3`}>
        <h2 className="font-extrabold text-lg">Add a person</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Name" htmlFor="tn"><input id="tn" className={input} value={f.name} onChange={set('name')} required /></Field>
          <Field label="Role" htmlFor="tr">
            <select id="tr" className={input} value={f.role} onChange={set('role')}>
              <option value="caller">Calling executive</option><option value="field">Field executive</option><option value="manager">Manager</option>
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

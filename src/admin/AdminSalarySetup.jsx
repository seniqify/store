// Salary setup: each sales person's monthly salary, joining day, where they
// are paid and their Professional Tax, and the month's rules. Only the Owner
// changes these (the database checks: admin_require('salary_approve'));
// Finance can read them. Every change goes into the audit log with a reason.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAdmin } from './adminContext.js';
import { payrollInputs, payrollPersonSave, payrollSettingsSave } from './adminService.js';
import { canDo, SALES_ROLE as ROLE_NAME } from './adminLogic.js';
import { istDate } from '../crm/crmLogic.js';
import { monthOf, payrollRules, rupees, dateLabel, DAY_RATES, PROF_TAX, payDay, lockDay, monthLabel, addMonths } from '../utils/payroll.js';
import { Chip, Panel, Spinner, Notice, Empty } from './ui.jsx';
import { btn, input, label, th, td, muted } from './adminStyles.js';

function Toggle({ on, label: name, disabled, onChange }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={name} disabled={disabled} onClick={onChange}
      className={`relative w-11 h-[26px] flex-none rounded-full border-0 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${on ? 'bg-emerald-500' : 'bg-[#3a4a41]'}`}>
      <span aria-hidden="true" className={`absolute top-[3px] w-5 h-5 rounded-full bg-white transition-[left] ${on ? 'left-[21px]' : 'left-[3px]'}`} />
    </button>
  );
}

function PersonRow({ s, p, owner, onSaved }) {
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState(() => ({
    base: p ? String(p.base_monthly) : '', joined: p?.joined_on || '', employeeNo: p?.employee_no || '', payTo: p?.pay_to || '',
    profTax: p?.prof_tax || 'none', active: p ? p.active : true, reason: '',
  }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { await payrollPersonSave(s.user_id, { ...f, base: Number(f.base) }, f.reason.trim() || null); setEdit(false); await onSaved(); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  const id = s.user_id.slice(0, 8);
  return (
    <>
      <tr>
        <td className={td}><div className="font-bold">{s.name}</div><div className={`text-[12px] ${muted}`}>{ROLE_NAME[s.role] || s.role}</div></td>
        <td className={`${td} font-bold`}>{p ? rupees(p.base_monthly) : <Chip tone="warn">Not set</Chip>}</td>
        <td className={td}>{p?.joined_on ? dateLabel(p.joined_on) : '—'}</td>
        <td className={td}>{p?.pay_to || <span className={muted}>—</span>}</td>
        <td className={td}>{p ? <Chip tone={p.prof_tax === 'none' ? 'off' : 'info'}>{(PROF_TAX.find(([k]) => k === p.prof_tax) || PROF_TAX[0])[1]}</Chip> : '—'}</td>
        <td className={td}>{p ? <Chip tone={p.active ? 'ok' : 'off'}>{p.active ? 'Paid each month' : 'Off'}</Chip> : ''}</td>
        <td className={`${td} text-right`}>{owner && <button type="button" className={btn.small} aria-expanded={edit} onClick={() => setEdit(!edit)}>{edit ? 'Close' : p ? 'Edit' : 'Set salary'}</button>}</td>
      </tr>
      {edit && (
        <tr><td colSpan={7} className="px-3 py-3 border-b border-[#18231d] bg-[#111a15]">
          <form onSubmit={save} className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
            <div><label className={label} htmlFor={`b-${id}`}>Salary a month (₹)</label><input id={`b-${id}`} inputMode="numeric" className={input} required value={f.base} onChange={(e) => setF({ ...f, base: e.target.value.replace(/\D/g, '') })} placeholder="14000" /></div>
            <div><label className={label} htmlFor={`j-${id}`}>Joined on</label><input id={`j-${id}`} type="date" className={input} required value={f.joined} onChange={(e) => setF({ ...f, joined: e.target.value })} /></div>
            <div><label className={label} htmlFor={`e-${id}`}>Employee no. (optional)</label><input id={`e-${id}`} className={input} maxLength={20} value={f.employeeNo} onChange={(e) => setF({ ...f, employeeNo: e.target.value })} placeholder="PL-003" /></div>
            <div><label className={label} htmlFor={`u-${id}`}>Paid to: UPI id or bank account</label><input id={`u-${id}`} className={input} maxLength={120} value={f.payTo} onChange={(e) => setF({ ...f, payTo: e.target.value })} placeholder="name@okaxis" /></div>
            <div><label className={label} htmlFor={`t-${id}`}>Professional Tax</label><select id={`t-${id}`} className={input} value={f.profTax} onChange={(e) => setF({ ...f, profTax: e.target.value })}>{PROF_TAX.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></div>
            <div className="flex items-end gap-2.5 pb-2"><Toggle on={f.active} label="Paid each month" onChange={() => setF({ ...f, active: !f.active })} /><span className="text-[13.5px]">Paid each month</span></div>
            <div className="col-span-full"><label className={label} htmlFor={`r-${id}`}>Reason (goes in the log)</label><input id={`r-${id}`} className={input} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="e.g. New salary from December" /></div>
            <div className="col-span-full flex flex-wrap gap-2 items-center">
              <button type="submit" className={btn.primary} disabled={busy || f.base === '' || !f.joined}>{busy ? 'Saving…' : 'Save'}</button>
              <span className={`text-[12.5px] ${muted}`}>Counts from the next drafts. Approved salaries do not change.</span>
            </div>
            {err && <div className="col-span-full"><Notice>{err}</Notice></div>}
          </form>
        </td></tr>
      )}
    </>
  );
}

const NUM = [
  ['pay_day', 'Pay day (of the next month, 1 to 28)'], ['lock_day', 'Attendance locks on (day of the next month)'],
  ['paid_leave', 'Paid leave a month (days)'], ['leave_carry_max', 'Unused leave carried over, at most (days)'],
  ['travel_per_km', 'Field travel: ₹ per km'], ['travel_cap', 'Field travel: most in a day (₹)'], ['road_factor', 'Road factor (roads are not straight)'],
];
const SWITCH = [
  ['sunday_before', 'If pay day is a Sunday, pay the day before'],
  ['late_cut', 'Cut pay for late marks (every 3 late marks = half a day)'],
  ['travel_visit_days_only', 'Field travel only on days with at least 1 visit'],
  ['whatsapp_on', 'Send a WhatsApp message when a salary is marked paid'],
];

function Rules({ settings, owner, onSaved }) {
  const [f, setF] = useState(() => ({ ...payrollRules(settings), nowork_paid_until: payrollRules(settings).nowork_paid_until || '' }));
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const month = addMonths(monthOf(istDate()), -1);
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setMsg(null);
    const v = { ...f, nowork_paid_until: f.nowork_paid_until || null };
    for (const [k] of NUM) v[k] = Number(f[k]);
    try { await payrollSettingsSave(v, why.trim() || null); setMsg({ kind: 'ok', text: 'Saved. The next drafts use these rules.' }); setWhy(''); await onSaved(); }
    catch (x) { setMsg({ kind: 'error', text: x.message }); } finally { setBusy(false); }
  };
  return (
    <Panel title="Rules for every month">
      <form onSubmit={save} className="p-4 space-y-4">
        <fieldset disabled={!owner} className="m-0 p-0 border-0 space-y-4">
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))' }}>
            {NUM.map(([k, t]) => <div key={k}><label className={label} htmlFor={`s-${k}`}>{t}</label><input id={`s-${k}`} inputMode="decimal" className={input} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value.replace(/[^0-9.]/g, '') })} /></div>)}
            <div><label className={label} htmlFor="s-rate">One day's pay</label><select id="s-rate" className={input} value={f.day_rate} onChange={(e) => setF({ ...f, day_rate: e.target.value })}>{DAY_RATES.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></div>
            <div><label className={label} htmlFor="s-trial">Trial: "Logged in, no work" days paid until</label><input id="s-trial" type="date" className={input} value={f.nowork_paid_until} onChange={(e) => setF({ ...f, nowork_paid_until: e.target.value })} /></div>
            <div><label className={label} htmlFor="s-co">Company name on the payslip</label><input id="s-co" className={input} maxLength={120} value={f.company_name} onChange={(e) => setF({ ...f, company_name: e.target.value })} placeholder="Your company's legal name" /></div>
            <div><label className={label} htmlFor="s-addr">Address on the payslip</label><input id="s-addr" className={input} maxLength={200} value={f.company_address} onChange={(e) => setF({ ...f, company_address: e.target.value })} placeholder="Shop no., street, Solapur" /></div>
          </div>
          <ul className="list-none m-0 p-0 border-t border-[#1f2b24]">
            {SWITCH.map(([k, t]) => <li key={k} className="flex items-center gap-3 py-2.5 border-b border-[#18231d]"><span className="flex-1 text-[13.5px]">{t}</span><Toggle on={!!f[k]} label={t} onChange={() => setF({ ...f, [k]: !f[k] })} /></li>)}
          </ul>
        </fieldset>
        <p className={`m-0 text-[12.5px] ${muted}`}>With these rules, {monthLabel(month)} locks on {dateLabel(lockDay(month, f))} and is paid on {dateLabel(payDay(month, f))}. Paid each month: present, late, half day (half), weekly offs, holidays and paid leave. Not paid: absent, leave over the allowance, and "Logged in, no work" after the trial.</p>
        {owner ? (
          <div className="flex flex-wrap gap-2.5 items-end">
            <div className="flex-1 min-w-[240px]"><label className={label} htmlFor="s-why">Reason for the change (goes in the log)</label><input id="s-why" className={input} value={why} onChange={(e) => setWhy(e.target.value)} placeholder="e.g. Paid leave 2 days from January" /></div>
            <button type="submit" className={btn.primary} disabled={busy}>{busy ? 'Saving…' : 'Save rules'}</button>
          </div>
        ) : <Notice kind="warn">Only the Owner changes salaries and rules.</Notice>}
        {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      </form>
    </Panel>
  );
}

export default function AdminSalarySetup() {
  const { me, path } = useAdmin();
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const load = useCallback(async () => { setErr(''); try { setD(await payrollInputs(monthOf(istDate()))); } catch (x) { setErr(x.message); } }, []);
  useEffect(() => { load(); }, [load]);
  const staff = useMemo(() => (d?.staff || []).filter((s) => s.active || (d.people || []).some((p) => p.user_id === s.user_id && p.active)), [d]);
  const owner = canDo(me.role, 'salary_approve');

  if (!canDo(me.role, 'salary')) return <Notice kind="warn">Salaries are for the Owner and Finance only.</Notice>;
  if (err) return <Notice>{err}</Notice>;
  if (!d) return <Spinner />;
  return (
    <div className="space-y-5 max-w-[1300px]">
      <header className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[260px]">
          <h1 className="m-0 text-[26px] font-extrabold">Salary setup</h1>
          <p className="m-0 mt-1 text-[14px] text-[#8fa69a]">Each person's salary and the rules for every month. Changes count from the next drafts and go into the audit log.</p>
        </div>
        <Link to={path('salary')} className={btn.ghost}>Back to salaries</Link>
      </header>

      <Panel title="People and salaries" className="overflow-hidden" right={<span className={`text-[12.5px] ${muted}`}>People come from the CRM team</span>}>
        {!staff.length ? <Empty>No one on the sales team yet. Add people in the CRM, Team.</Empty> : (
          <div className="overflow-x-auto"><table className="w-full border-collapse text-[13.5px]">
            <thead><tr>{['Person', 'Salary a month', 'Joined', 'Paid to', 'Professional Tax', 'Pay', ''].map((h, i) => <th key={h || i} scope="col" className={th}>{h || <span className="sr-only">Edit</span>}</th>)}</tr></thead>
            <tbody>{staff.map((s) => <PersonRow key={s.user_id} s={s} p={(d.people || []).find((p) => p.user_id === s.user_id) || null} owner={owner} onSaved={load} />)}</tbody>
          </table></div>
        )}
        <p className={`m-0 px-4 py-3 text-[12.5px] ${muted}`}>Someone without a salary here gets no draft, and the Salary page warns you. "Joined on" matters: days before it are not paid; days after it but before the CRM existed are paid (there is no record to judge them by).</p>
      </Panel>

      <Rules settings={d.settings} owner={owner} onSaved={load} />

      <div className="flex flex-wrap gap-5 items-start">
        <Panel title="Incentives" className="flex-[1_1_380px] min-w-0">
          <p className="m-0 px-4 py-3 text-[13.5px] leading-relaxed">The incentive rule lives in the CRM (Settings): amounts per paid shop and the 30-day check. Every incentive that is <b>earned and not paid</b> when drafts are made goes into that salary, and becomes "Paid out" in the CRM when you mark the salary paid. While a salary is approved, its incentives cannot be changed in the CRM.</p>
          <p className="m-0 px-4 pb-3"><a href="https://crm.pocketlink.store/settings" target="_blank" rel="noreferrer">Open CRM Settings</a></p>
        </Panel>
        <Panel title="Who sees salaries" className="flex-[1_1_380px] min-w-0">
          <ul className="list-none m-0 p-0 text-[13.5px]">
            {[['Owner', 'See, set salaries and rules, approve, mark paid', 'ok'], ['Finance', 'See, add a bonus or deduction, note advances, mark paid. Cannot approve.', 'info'],
              ['Admin, Support, Viewer', 'Salary is not in their menu; the audit log shows them no amounts', 'off'], ['Sales manager (CRM)', 'Attendance and incentives only, never salaries', 'off'],
              ['Each employee (CRM)', 'Only their own pay and payslips, under My pay', 'off']].map(([w, t, tone]) => (
              <li key={w} className="flex flex-wrap gap-2 items-center px-4 py-2.5 border-b border-[#18231d]"><b className="flex-1 min-w-[150px]">{w}</b><Chip tone={tone}>{t}</Chip></li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}

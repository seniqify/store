// Manager: one place for the team's rules. Score weights and team targets,
// the incentive rule, work hours and attendance rules, each person's shift
// and weekly off, holidays, training and the WhatsApp reports.
import { useEffect, useState } from 'react';
import { useCrm } from './crmContext.js';
import { saveSetting, updateStaff, listHolidays, addHoliday, removeHoliday, sendTestReport } from './crmService.js';
import {
  KPA, KPI_DEFS, weightsFrom, DEFAULT_WEIGHTS, incentiveRule, incentiveRuleLines, RECOMMENDED_INCENTIVE,
  LATE_GRACE_MIN, HALF_DAY_HOURS, shortDay,
} from './crmLogic.js';
import { DAILY_TEMPLATE, WEEKLY_TEMPLATE } from '../../shared/sales-report-text.mjs';
import { Field, Notice, Icon, Spinner } from './ui.jsx';
import IncentiveExplainer from './CrmIncentiveExplainer.jsx';
import { btn, card, input } from './crmStyles.js';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SECTIONS = [['score', 'Score'], ['incentive', 'Incentive'], ['work', 'Work hours'], ['people', 'Shifts & weekly offs'], ['holidays', 'Holidays'], ['training', 'Training'], ['reports', 'Reports']];
const num = (v) => (v === '' || v == null ? null : Number(v));
const TARGET_ROLES = [['caller', 'Calling executives'], ['field', 'Field executives'], ['ads', 'Ads & leads executives']];

function Section({ id, title, sub, children }) {
  return (
    <section id={id} className={`${card} p-5 space-y-3 scroll-mt-4`}>
      <div><h2 className="text-lg font-extrabold">{title}</h2>{sub && <p className="text-[13px] text-gray-500 mt-0.5">{sub}</p>}</div>
      {children}
    </section>
  );
}

function useSaver(refresh) {
  const [msg, setMsg] = useState({});
  const save = async (id, fn, text = 'Saved.') => {
    setMsg((m) => ({ ...m, [id]: null }));
    try { await fn(); await refresh?.(); setMsg((m) => ({ ...m, [id]: { kind: 'ok', text } })); }
    catch (e) { setMsg((m) => ({ ...m, [id]: { kind: 'error', text: e.message } })); }
  };
  return [msg, save];
}

function Copy({ text }) {
  const [done, setDone] = useState(false);
  return <button type="button" className={btn.small} onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* old browser */ } }}><Icon name={done ? 'check' : 'copy'} size={14} />{done ? 'Copied' : 'Copy'}</button>;
}

// The forms start from the saved values, so wait until they have loaded.
export default function CrmSettings() {
  const { staff, settings } = useCrm();
  if (!settings || !staff.length) return <Spinner />;
  return <SettingsForm />;
}

function SettingsForm() {
  const { staff, settings, refreshSettings, refreshStaff } = useCrm();
  const [msg, save] = useSaver(refreshSettings);
  const score = settings?.score || {};
  const work = settings?.work || {};
  const training = settings?.training || {};
  const reports = settings?.reports || {};

  // Score
  const [w, setW] = useState(() => Object.fromEntries(KPA.map((a) => [a.key, String(weightsFrom(score)[a.key])])));
  const [tt, setTt] = useState(() => Object.fromEntries(TARGET_ROLES.map(([r]) => [r, { ...(score.targets?.[r] || {}) }])));
  const wTotal = KPA.reduce((s, a) => s + (Number(w[a.key]) || 0), 0);
  // Incentive
  const [inc, setInc] = useState(() => { const r = incentiveRule(settings?.incentive); return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v)])); });
  // Work
  const [wk, setWk] = useState(() => ({
    grace_min: String(work.grace_min ?? LATE_GRACE_MIN), half_day_hours: String(work.half_day_hours ?? HALF_DAY_HOURS),
    caller_start: work.shift?.caller?.start || '09:30', caller_end: work.shift?.caller?.end || '18:30',
    field_start: work.shift?.field?.start || '10:00', field_end: work.shift?.field?.end || '19:00', weekly_off: String(work.weekly_off ?? 0),
  }));
  // People
  const [people, setPeople] = useState(() => Object.fromEntries(staff.map((s) => [s.user_id, { shift_start: String(s.shift_start).slice(0, 5), shift_end: String(s.shift_end).slice(0, 5), weekly_off: String(s.weekly_off) }])));
  // Holidays
  const [hols, setHols] = useState([]);
  const [hol, setHol] = useState({ day: '', name: '' });
  useEffect(() => { listHolidays().then(setHols); }, []);
  // Training, reports
  const [tr, setTr] = useState(() => ({ pass_pct: String(training.pass_pct ?? 80), gate: training.gate !== false }));
  const [rp, setRp] = useState(() => ({ daily: reports.daily_off !== true, weekly: reports.weekly_off !== true, phones: (reports.phones || []).join(', ') }));
  const [testMsg, setTestMsg] = useState(null);
  const managers = staff.filter((s) => s.role === 'manager' && s.active);

  return (
    <div className="px-4 lg:px-7 py-5 space-y-4 max-w-5xl">
      <header><h1 className="text-2xl font-extrabold">Settings</h1>
        <p className="text-sm text-gray-500">The team’s rules in one place. Changes apply straight away.</p></header>
      <nav aria-label="Settings sections" className="flex flex-wrap gap-1.5">
        {SECTIONS.map(([id, label]) => <a key={id} href={`#${id}`} className="h-8 px-3 rounded-full border border-gray-200 bg-white text-[12.5px] font-bold text-gray-700 inline-flex items-center no-underline">{label}</a>)}
      </nav>

      <Section id="score" title="Score: area weights and team targets" sub="Each person’s score is the weighted average of five areas. Targets here are for everyone in the role; a person’s own target in Team wins.">
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {KPA.map((a) => (
            <Field key={a.key} label={`${a.label} (%)`} htmlFor={`w-${a.key}`}><input id={`w-${a.key}`} type="number" min="0" max="100" className={input} value={w[a.key]} onChange={(e) => setW({ ...w, [a.key]: e.target.value })} /></Field>
          ))}
        </div>
        <p className={`text-[13px] font-bold ${wTotal === 100 ? 'text-green-700' : 'text-red-700'}`}>Total {wTotal}% {wTotal === 100 ? '' : '(must be 100%)'}</p>
        {TARGET_ROLES.map(([role, roleLabel]) => (
          <div key={role}>
            <p className="text-[13px] font-extrabold text-gray-700 mt-2">{roleLabel} <span className="font-semibold text-gray-500">· a month unless it says a day or %</span></p>
            <div className="grid sm:grid-cols-3 lg:grid-cols-5 gap-2 mt-1.5">
              {KPI_DEFS[role].filter((d) => d.kind !== 'money').map((d) => (
                <Field key={d.key} label={`${d.label}${d.kind === 'pct' ? ' (%)' : d.kind === 'minutes' ? ' (min)' : ''}`} htmlFor={`t-${role}-${d.key}`}>
                  <input id={`t-${role}-${d.key}`} type="number" min="0" className={input} value={tt[role][d.key] ?? ''} placeholder={String(d.def)}
                    onChange={(e) => setTt({ ...tt, [role]: { ...tt[role], [d.key]: e.target.value } })} />
                </Field>
              ))}
            </div>
          </div>
        ))}
        {msg.score && <Notice kind={msg.score.kind}>{msg.score.text}</Notice>}
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btn.primary} disabled={wTotal !== 100} onClick={() => save('score', () => saveSetting('score', {
            weights: Object.fromEntries(KPA.map((a) => [a.key, Number(w[a.key]) || 0])),
            targets: Object.fromEntries(TARGET_ROLES.map(([r]) => [r, Object.fromEntries(Object.entries(tt[r]).filter(([, v]) => Number(v) > 0).map(([k, v]) => [k, Number(v)]))])),
          }))}>Save score settings</button>
          <button type="button" className={btn.ghost} onClick={() => setW(Object.fromEntries(Object.entries(DEFAULT_WEIGHTS).map(([k, v]) => [k, String(v)])))}>Usual weights (20/15/30/25/10)</button>
        </div>
      </Section>

      <Section id="incentive" title="Incentive rule" sub="Recommended: a fixed amount per paid shop, more for yearly plans, a higher rate for the best months, and paid only if the shop keeps paying.">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <Field label="Monthly plan shop (₹)" htmlFor="i-m"><input id="i-m" type="number" min="0" className={input} value={inc.monthly} onChange={(e) => setInc({ ...inc, monthly: e.target.value })} /></Field>
          <Field label="Yearly plan shop (₹)" htmlFor="i-y"><input id="i-y" type="number" min="0" className={input} value={inc.yearly} onChange={(e) => setInc({ ...inc, yearly: e.target.value })} /></Field>
          <Field label="Higher rate after this many shops a month" htmlFor="i-s" hint="0 = no higher rate"><input id="i-s" type="number" min="0" className={input} value={inc.slab_after} onChange={(e) => setInc({ ...inc, slab_after: e.target.value })} /></Field>
          <Field label="Higher rate, monthly (₹)" htmlFor="i-sm"><input id="i-sm" type="number" min="0" className={input} value={inc.slab_monthly} onChange={(e) => setInc({ ...inc, slab_monthly: e.target.value })} /></Field>
          <Field label="Higher rate, yearly (₹)" htmlFor="i-sy"><input id="i-sy" type="number" min="0" className={input} value={inc.slab_yearly} onChange={(e) => setInc({ ...inc, slab_yearly: e.target.value })} /></Field>
          <Field label="Shop must still pay after (days)" htmlFor="i-h" hint="Checked 4 days later, after the renewal"><input id="i-h" type="number" min="0" max="120" className={input} value={inc.hold_days} onChange={(e) => setInc({ ...inc, hold_days: e.target.value })} /></Field>
          <Field label="Lead checker: monthly plan shop (₹)" htmlFor="i-vm" hint="Ads & leads, for a lead they checked"><input id="i-vm" type="number" min="0" className={input} value={inc.verifier_monthly} onChange={(e) => setInc({ ...inc, verifier_monthly: e.target.value })} /></Field>
          <Field label="Lead checker: yearly plan shop (₹)" htmlFor="i-vy"><input id="i-vy" type="number" min="0" className={input} value={inc.verifier_yearly} onChange={(e) => setInc({ ...inc, verifier_yearly: e.target.value })} /></Field>
          <span className="hidden sm:block" />
          <div className="col-span-2 sm:col-span-3"><Field label="When it is paid" htmlFor="i-p"><input id="i-p" className={input} value={inc.pay_day} onChange={(e) => setInc({ ...inc, pay_day: e.target.value })} /></Field></div>
        </div>
        <div className="rounded-xl bg-gray-50 border border-gray-200 p-3">
          <p className="text-[12px] font-extrabold uppercase tracking-wide text-gray-500">What the team sees</p>
          <ul className="mt-1 space-y-0.5 text-[13.5px] list-disc pl-5">{incentiveRuleLines(inc).map((x) => <li key={x}>{x}</li>)}</ul>
          <p className="mt-2 text-[12px] font-extrabold uppercase tracking-wide text-gray-500">What the Ads & leads team sees</p>
          <ul className="mt-1 space-y-0.5 text-[13.5px] list-disc pl-5">{incentiveRuleLines(inc, 'ads').map((x) => <li key={x}>{x}</li>)}</ul>
        </div>
        <details className="rounded-xl border border-gray-200 p-3"><summary className="text-[13px] font-bold text-green-700 cursor-pointer">See the pictures the team sees</summary>
          <div className="mt-3"><IncentiveExplainer cfg={Object.fromEntries(Object.entries(inc).map(([k, v]) => [k, k === 'pay_day' ? v : num(v)]))} /></div></details>
        {msg.incentive && <Notice kind={msg.incentive.kind}>{msg.incentive.text}</Notice>}
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btn.primary} onClick={() => save('incentive', () => {
            const r = incentiveRule(Object.fromEntries(Object.entries(inc).map(([k, v]) => [k, k === 'pay_day' ? v : num(v)])));
            return saveSetting('incentive', { ...(settings?.incentive || {}), ...r, per_paid: r.monthly, pay_day: String(inc.pay_day || '').slice(0, 80) });
          }, 'Saved. New paid shops use this rule; earlier ones keep their amount.')}>Save the rule</button>
          <button type="button" className={btn.ghost} onClick={() => setInc(Object.fromEntries(Object.entries(RECOMMENDED_INCENTIVE).map(([k, v]) => [k, String(v)])))}>Use the recommended rule</button>
        </div>
      </Section>

      <Section id="work" title="Work hours and attendance" sub="Late, half day and the usual shift for each role.">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Field label="Late after the shift start by (min)" htmlFor="wk-g"><input id="wk-g" type="number" min="0" max="120" className={input} value={wk.grace_min} onChange={(e) => setWk({ ...wk, grace_min: e.target.value })} /></Field>
          <Field label="Half day under (hours)" htmlFor="wk-h"><input id="wk-h" type="number" min="1" max="12" step="0.5" className={input} value={wk.half_day_hours} onChange={(e) => setWk({ ...wk, half_day_hours: e.target.value })} /></Field>
          <Field label="Usual weekly off" htmlFor="wk-o"><select id="wk-o" className={input} value={wk.weekly_off} onChange={(e) => setWk({ ...wk, weekly_off: e.target.value })}>{DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select></Field>
          <span />
          <Field label="Callers start" htmlFor="wk-cs" hint="Also Ads & leads"><input id="wk-cs" type="time" className={input} value={wk.caller_start} onChange={(e) => setWk({ ...wk, caller_start: e.target.value })} /></Field>
          <Field label="Callers end" htmlFor="wk-ce"><input id="wk-ce" type="time" className={input} value={wk.caller_end} onChange={(e) => setWk({ ...wk, caller_end: e.target.value })} /></Field>
          <Field label="Field starts" htmlFor="wk-fs"><input id="wk-fs" type="time" className={input} value={wk.field_start} onChange={(e) => setWk({ ...wk, field_start: e.target.value })} /></Field>
          <Field label="Field ends" htmlFor="wk-fe"><input id="wk-fe" type="time" className={input} value={wk.field_end} onChange={(e) => setWk({ ...wk, field_end: e.target.value })} /></Field>
        </div>
        {msg.work && <Notice kind={msg.work.kind}>{msg.work.text}</Notice>}
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btn.primary} onClick={() => save('work', () => saveSetting('work', {
            grace_min: Math.max(0, Math.min(120, Number(wk.grace_min) || 0)), half_day_hours: Math.max(1, Math.min(12, Number(wk.half_day_hours) || HALF_DAY_HOURS)),
            weekly_off: Number(wk.weekly_off), shift: { caller: { start: wk.caller_start, end: wk.caller_end }, field: { start: wk.field_start, end: wk.field_end } },
          }))}>Save work rules</button>
          <button type="button" className={btn.ghost} onClick={() => {
            const next = { ...people };
            for (const s of staff) if (s.role !== 'manager') { const r = s.role === 'field' ? 'field' : 'caller'; next[s.user_id] = { shift_start: wk[`${r}_start`], shift_end: wk[`${r}_end`], weekly_off: wk.weekly_off }; }
            setPeople(next);
          }}>Copy these shifts to everyone below</button>
        </div>
      </Section>

      <Section id="people" title="Shifts and weekly offs" sub="Each person’s own shift and weekly off. Attendance uses these.">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead><tr className="text-left text-[12px] uppercase tracking-wide text-gray-500"><th className="py-2 font-bold">Person</th><th className="py-2 font-bold">Starts</th><th className="py-2 font-bold">Ends</th><th className="py-2 font-bold">Weekly off</th></tr></thead>
            <tbody>
              {staff.filter((s) => s.active).map((s) => (
                <tr key={s.user_id} className="border-t border-gray-100">
                  <td className="py-2 pr-2"><div className="font-bold">{s.name}</div><div className="text-[12px] text-gray-500">{s.role}</div></td>
                  <td className="py-2 pr-2"><input aria-label={`${s.name} starts`} type="time" className={`${input} h-10`} value={people[s.user_id]?.shift_start || ''} onChange={(e) => setPeople({ ...people, [s.user_id]: { ...people[s.user_id], shift_start: e.target.value } })} /></td>
                  <td className="py-2 pr-2"><input aria-label={`${s.name} ends`} type="time" className={`${input} h-10`} value={people[s.user_id]?.shift_end || ''} onChange={(e) => setPeople({ ...people, [s.user_id]: { ...people[s.user_id], shift_end: e.target.value } })} /></td>
                  <td className="py-2"><select aria-label={`${s.name} weekly off`} className={`${input} h-10`} value={people[s.user_id]?.weekly_off ?? '0'} onChange={(e) => setPeople({ ...people, [s.user_id]: { ...people[s.user_id], weekly_off: e.target.value } })}>{DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {msg.people && <Notice kind={msg.people.kind}>{msg.people.text}</Notice>}
        <button type="button" className={btn.primary} onClick={() => save('people', async () => {
          for (const s of staff.filter((x) => x.active)) {
            const p = people[s.user_id];
            if (!p) continue;
            if (p.shift_start !== String(s.shift_start).slice(0, 5) || p.shift_end !== String(s.shift_end).slice(0, 5) || Number(p.weekly_off) !== s.weekly_off) {
              await updateStaff(s.user_id, { shift_start: p.shift_start, shift_end: p.shift_end, weekly_off: Number(p.weekly_off) });
            }
          }
          await refreshStaff();
        })}>Save shifts and weekly offs</button>
      </Section>

      <Section id="holidays" title="Holidays" sub="Nobody is marked absent on a holiday.">
        {!hols.length ? <p className="text-sm text-gray-500">No holidays yet.</p> : (
          <ul className="divide-y divide-gray-100">
            {hols.map((h) => (
              <li key={h.day} className="py-2 flex items-center gap-3 text-sm">
                <span className="w-28 font-bold text-violet-900">{shortDay(h.day)}</span><span className="flex-1">{h.name}</span>
                <button type="button" className="text-[12.5px] font-bold text-red-700" onClick={() => save('holidays', async () => { await removeHoliday(h.day); setHols(await listHolidays()); }, 'Removed.')}>Remove</button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap gap-2">
          <input aria-label="Holiday date" type="date" className={`${input} sm:w-44`} value={hol.day} onChange={(e) => setHol({ ...hol, day: e.target.value })} />
          <input aria-label="Holiday name" className={`${input} sm:w-64`} placeholder="e.g. Diwali" value={hol.name} onChange={(e) => setHol({ ...hol, name: e.target.value })} />
          <button type="button" className={btn.dark} disabled={!hol.day || !hol.name.trim()} onClick={() => save('holidays', async () => { await addHoliday(hol.day, hol.name.trim()); setHol({ day: '', name: '' }); setHols(await listHolidays()); }, 'Holiday added.')}>Add holiday</button>
        </div>
        {msg.holidays && <Notice kind={msg.holidays.kind}>{msg.holidays.text}</Notice>}
      </Section>

      <Section id="training" title="Training" sub="New people read the modules for their role (with screenshots) and pass a 15-question exam on their role. Then you sign them off in Team.">
        <div className="grid sm:grid-cols-2 gap-3 items-end">
          <Field label="Pass mark (%)" htmlFor="tr-p"><input id="tr-p" type="number" min="50" max="100" className={input} value={tr.pass_pct} onChange={(e) => setTr({ ...tr, pass_pct: e.target.value })} /></Field>
          <label className="flex items-center gap-2 text-[14px] font-semibold text-gray-800 h-11">
            <input type="checkbox" checked={tr.gate} onChange={(e) => setTr({ ...tr, gate: e.target.checked })} className="w-4 h-4 accent-green-700" />New people must pass before calling or checking in
          </label>
        </div>
        {msg.training && <Notice kind={msg.training.kind}>{msg.training.text}</Notice>}
        <button type="button" className={btn.primary} onClick={() => save('training', () => saveSetting('training', { pass_pct: Math.max(50, Math.min(100, Number(tr.pass_pct) || 80)), gate: tr.gate }))}>Save training settings</button>
      </Section>

      <Section id="reports" title="WhatsApp reports" sub="A summary every day at 7 pm and a weekly report every Monday at 9 am, to the managers’ WhatsApp. Each one is also kept in Reports.">
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="flex items-center gap-2 text-[14px] font-semibold"><input type="checkbox" checked={rp.daily} onChange={(e) => setRp({ ...rp, daily: e.target.checked })} className="w-4 h-4 accent-green-700" />Daily at 7 pm</label>
          <label className="flex items-center gap-2 text-[14px] font-semibold"><input type="checkbox" checked={rp.weekly} onChange={(e) => setRp({ ...rp, weekly: e.target.checked })} className="w-4 h-4 accent-green-700" />Weekly, Monday 9 am</label>
          <div className="sm:col-span-2"><Field label="Send to (mobile numbers, comma between)" htmlFor="rp-to" hint={`Empty = every manager with a mobile in Team (${managers.filter((m) => m.phone).length} now).`}>
            <input id="rp-to" className={input} value={rp.phones} onChange={(e) => setRp({ ...rp, phones: e.target.value })} placeholder="98xxxxxxxx" /></Field></div>
        </div>
        {msg.reports && <Notice kind={msg.reports.kind}>{msg.reports.text}</Notice>}
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btn.primary} onClick={() => save('reports', () => saveSetting('reports', {
            daily_off: !rp.daily, weekly_off: !rp.weekly,
            phones: rp.phones.split(/[,\s]+/).map((x) => x.replace(/\D/g, '').slice(-10)).filter((x) => /^[6-9][0-9]{9}$/.test(x)).slice(0, 10),
          }))}>Save report settings</button>
          <button type="button" className={btn.ghost} onClick={async () => {
            setTestMsg(null);
            try { const r = await sendTestReport(); const s = r.sent; setTestMsg(s.skipped ? { kind: 'warn', text: `Not sent: ${s.skipped}.` } : s.results?.every((x) => x.ok) ? { kind: 'ok', text: 'Sent to your WhatsApp.' } : { kind: 'error', text: `WhatsApp said no: ${s.results?.[0]?.error || 'unknown'}` }); }
            catch (e) { setTestMsg({ kind: 'error', text: e.message }); }
          }}>Send me today’s report now</button>
        </div>
        {testMsg && <Notice kind={testMsg.kind}>{testMsg.text}</Notice>}
        <div className="rounded-xl bg-gray-50 border border-gray-200 p-3 space-y-2">
          <p className="text-[13px] text-gray-700"><b>One-time setup:</b> WhatsApp only sends approved messages. Create these two templates (category Utility, English) in the WhatsApp template manager, and when they are approved, send their template links to be connected.</p>
          {[['Daily: pocketlink_sales_daily', DAILY_TEMPLATE], ['Weekly: pocketlink_sales_weekly', WEEKLY_TEMPLATE]].map(([t, body]) => (
            <div key={t} className="space-y-1">
              <div className="flex items-center gap-2"><span className="text-[12.5px] font-extrabold flex-1">{t}</span><Copy text={body} /></div>
              <p className="text-[13px] bg-white border border-gray-200 rounded-lg px-3 py-2 font-mono break-words">{body}</p>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}

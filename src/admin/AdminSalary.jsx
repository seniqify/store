// Salary: the sales team's month, worked out from the CRM (attendance, leave,
// holidays, incentives, field visits) with utils/payroll.js, the same rules the
// CRM calendar uses. Owner and Finance see it; drafts are saved after the
// month locks, the Owner approves, then whoever pays marks it paid with the
// reference. Nothing here moves money. The database checks every step
// (supabase/salary-forward.sql) and writes each one to the audit log.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAdmin } from './adminContext.js';
import {
  payrollInputs, payrollSaveDrafts, payrollApprove, payrollAdvanceAdd, payrollAdvanceRemove, payrollUnapprove,
  payrollMarkPaid, payrollUndoPaid, payrollLineAdd, payrollLineRemove, payrollDraftRemove, payrollNotify, downloadCsv,
} from './adminService.js';
import { canDo, toCsv, SALES_ROLE as ROLE_NAME } from './adminLogic.js';
import { istDate } from '../crm/crmLogic.js';
import {
  monthPays, draftOf, monthOf, addMonths, monthLabel, dayLabel, dateLabel, payDay, rupees, lineAmount, linesOf,
  isManualLine, orderedLines, PAY_DAY, PAID_BY, maskPayTo,
} from '../utils/payroll.js';
import { openPayslip } from '../utils/payslipPdf.js';
import { Chip, Icon, Kpi, Panel, Spinner, Notice, Empty } from './ui.jsx';
import { btn, input, label, th, td, muted, kicker } from './adminStyles.js';

const STATUS = {
  preview: ['Not saved yet', 'off'], draft: ['Draft', 'warn'], approved: ['Approved · to pay', 'info'], paid: ['Paid', 'ok'],
};
const ym = (month) => month.slice(0, 7);

/** The month's inputs and everyone's pay, worked out from them. */
function useMonth(month) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const load = useCallback(async () => {
    setErr('');
    try { setD(await payrollInputs(month)); } catch (x) { setErr(x.message); }
  }, [month]);
  useEffect(() => { setD(null); load(); }, [load]);
  const pays = useMemo(() => monthPays(d), [d]);
  return { d, err, load, pays };
}

/** One row per person: the saved salary if there is one, else the preview. */
function rowsOf(d, pays) {
  if (!d) return [];
  const slipBy = new Map((d.slips || []).map((s) => [s.user_id, s]));
  const payBy = new Map(pays.map((p) => [p.user_id, p]));
  const ids = [...new Set([...pays.map((p) => p.user_id), ...(d.slips || []).map((s) => s.user_id)])];
  return ids.map((id) => {
    const s = slipBy.get(id) || null;
    const p = payBy.get(id) || null;
    const src = s || p;
    const manual = s ? (s.lines || []).filter(isManualLine).reduce((a, l) => a + l.amount, 0) : 0;
    return {
      id, slip: s, pay: p, name: src.name, role: src.role, base: src.base_monthly, days: src.days || {}, lines: src.lines || [],
      net: src.net, status: s ? s.status : 'preview',
      stale: !!(s && s.status === 'draft' && p && p.net + manual !== s.net),
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

const daysText = (d) => `${String(d.paid ?? 0).replace(/\.0$/, '')} / ${d.in_month ?? ''}`;

function Steps({ d, rows }) {
  const slips = d.slips || [];
  const ended = d.today > d.to;
  const made = slips.length > 0 && rows.every((r) => r.slip);
  const approved = made && slips.every((s) => s.status !== 'draft');
  const paid = approved && slips.every((s) => s.status === 'paid');
  const paidN = slips.filter((s) => s.status === 'paid').length;
  const steps = [
    [ended, 'Month ended', dayLabel(d.to)],
    [d.locked, 'Attendance locked', d.locked ? `Locked ${dayLabel(d.lock_on)}` : `${dayLabel(d.lock_on)} · fix marks in the CRM before then`],
    [made, 'Drafts made', made ? `${slips.length} people` : d.locked ? 'Ready to make' : `After ${dayLabel(d.lock_on)}`],
    [approved, approved ? 'Approved' : 'Owner approves', approved ? 'All approved' : 'Check each line first'],
    [paid, 'Pay, then mark paid', `${dayLabel(payDay(d.month, d.settings))} · ${paidN} of ${rows.length} paid`],
  ];
  const current = steps.findIndex(([done]) => !done);
  return (
    <section aria-label="Where this month is" className="bg-[#131c17] border border-[#1f2b24] rounded-2xl px-4 py-4">
      <ol className="list-none m-0 p-0 grid gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
        {steps.map(([done, t, s], i) => (
          <li key={t} className="flex gap-2.5 items-start">
            <span aria-hidden="true" className={`flex-none w-7 h-7 rounded-full grid place-items-center text-[13px] font-extrabold ${done ? 'bg-emerald-500 text-[#052e1f]' : i === current ? 'bg-[#3a2a0c] text-[#fcd34d] border-2 border-[#fcd34d]' : 'bg-[#16211b] text-[#8fa69a] border border-[#2b3b32]'}`}>{done ? '✓' : i + 1}</span>
            <div className="min-w-0"><div className={`text-[14px] font-bold ${i === current ? 'text-amber-200' : done ? '' : 'text-[#a9bdb2]'}`}>{t}</div><div className={`text-[12.5px] ${muted}`}>{s}</div></div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function MonthNav({ month, base }) {
  const { path } = useAdmin();
  const now = monthOf(istDate());
  const next = addMonths(month, 1);
  return (
    <div className="flex items-center gap-1.5">
      <Link to={path(`${base}/${ym(addMonths(month, -1))}`)} className={btn.small} aria-label="Month before"><Icon name="back" size={15} /></Link>
      <span className="text-[14px] font-bold px-1.5 min-w-[118px] text-center">{monthLabel(month)}</span>
      {next <= now ? <Link to={path(`${base}/${ym(next)}`)} className={btn.small} aria-label="Next month"><Icon name="back" size={15} className="rotate-180" /></Link>
        : <span className={`${btn.small} opacity-40`} aria-hidden="true"><Icon name="back" size={15} className="rotate-180" /></span>}
    </div>
  );
}

function Advances({ d, pays, can, onDone }) {
  const [f, setF] = useState({ user: '', amount: '', given: istDate(), perMonth: '', note: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [why, setWhy] = useState('');
  const name = (id) => (d.staff || []).find((s) => s.user_id === id)?.name || 'Someone';
  const open = (d.advances || []).filter((a) => a.left > 0);
  const add = async (e) => {
    e.preventDefault(); setBusy(true); setMsg(null);
    try {
      await payrollAdvanceAdd(f.user, Number(f.amount), f.given, f.perMonth ? Number(f.perMonth) : null, f.note.trim());
      setMsg({ kind: 'ok', text: 'Noted. It comes off the next salary drafts by itself.' }); setF({ ...f, amount: '', perMonth: '', note: '' }); await onDone();
    } catch (x) { setMsg({ kind: 'error', text: x.message }); } finally { setBusy(false); }
  };
  const remove = async (a) => {
    setBusy(true); setMsg(null);
    try { await payrollAdvanceRemove(a.id, why.trim()); setWhy(''); await onDone(); } catch (x) { setMsg({ kind: 'error', text: x.message }); } finally { setBusy(false); }
  };
  return (
    <Panel title="Salary advances">
      {!open.length ? <Empty>No advance waiting to be taken back.</Empty> : (
        <ul className="list-none m-0 p-0">{open.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-2.5 px-4 py-3 border-b border-[#18231d]">
            <div className="flex-1 min-w-[180px]"><div className="font-bold">{name(a.user_id)} · {rupees(a.amount)}</div>
              <div className={`text-[12.5px] ${muted}`}>Given {dateLabel(a.given_on)} · {a.per_month ? `${rupees(a.per_month)} a month` : 'all of it from the next salary'} · {a.note}</div></div>
            <Chip tone={a.left === a.amount ? 'warn' : 'info'}>{rupees(a.left)} left</Chip>
            {can && a.left === a.amount && <button type="button" className={btn.small} disabled={busy || why.trim().length < 3} onClick={() => remove(a)} title="Needs a reason below">Remove</button>}
          </li>
        ))}</ul>
      )}
      {can && open.some((a) => a.left === a.amount) && (
        <div className="px-4 py-3 border-b border-[#18231d]"><label className={label} htmlFor="adv-why">Reason for removing one (goes in the log)</label><input id="adv-why" className={input} value={why} onChange={(e) => setWhy(e.target.value)} placeholder="e.g. Noted twice" /></div>
      )}
      {can && (
        <form onSubmit={add} className="p-4 space-y-3">
          <div className={kicker}>Record an advance</div>
          <p className={`m-0 text-[12.5px] ${muted}`}>You give it by UPI or cash as now. Note it here and it comes off the next salaries.</p>
          <div className="grid gap-3 grid-cols-2">
            <div className="col-span-2"><label className={label} htmlFor="adv-who">Person</label>
              <select id="adv-who" className={input} required value={f.user} onChange={(e) => setF({ ...f, user: e.target.value })}>
                <option value="">Pick a person</option>{pays.map((p) => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}
              </select></div>
            <div><label className={label} htmlFor="adv-amt">Amount (₹)</label><input id="adv-amt" inputMode="numeric" className={input} required value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value.replace(/\D/g, '') })} placeholder="2000" /></div>
            <div><label className={label} htmlFor="adv-day">Given on</label><input id="adv-day" type="date" className={input} required value={f.given} max={istDate()} onChange={(e) => setF({ ...f, given: e.target.value })} /></div>
            <div className="col-span-2"><label className={label} htmlFor="adv-pm">Take back each month (₹, empty = all next month)</label><input id="adv-pm" inputMode="numeric" className={input} value={f.perMonth} onChange={(e) => setF({ ...f, perMonth: e.target.value.replace(/\D/g, '') })} placeholder="1000" /></div>
            <div className="col-span-2"><label className={label} htmlFor="adv-note">What it was for</label><input id="adv-note" className={input} required value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="e.g. Bike repair" /></div>
          </div>
          <button type="submit" className={`${btn.ghost} w-full`} disabled={busy || !f.user || !Number(f.amount) || !f.note.trim()}>{busy ? 'Saving…' : 'Note the advance'}</button>
          {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
        </form>
      )}
    </Panel>
  );
}

export default function AdminSalary() {
  const { me, path } = useAdmin();
  const { month: mParam } = useParams();
  const today = istDate();
  const month = /^\d{4}-\d{2}$/.test(mParam || '') ? `${mParam}-01` : addMonths(monthOf(today), -1);
  const { d, err, load, pays } = useMonth(month);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null);
  const can = canDo(me.role, 'salary');
  const canApprove = canDo(me.role, 'salary_approve');
  const rows = useMemo(() => rowsOf(d, pays), [d, pays]);

  if (!can) return <Notice kind="warn">Salaries are for the Owner and Finance only.</Notice>;
  if (err) return <Notice>{err}</Notice>;
  if (!d) return <Spinner />;

  const run = async (key, fn) => { setBusy(key); setMsg(null); try { const t = await fn(); setMsg({ kind: 'ok', text: t }); await load(); } catch (x) { setMsg({ kind: 'error', text: x.message }); } finally { setBusy(''); } };
  const slips = d.slips || [];
  const drafts = slips.filter((s) => s.status === 'draft');
  const toMake = pays.filter((p) => { const s = slips.find((x) => x.user_id === p.user_id); return !s || s.status === 'draft'; });
  const total = (k) => rows.reduce((a, r) => a + linesOf(r.lines, k), 0);
  const net = rows.reduce((a, r) => a + r.net, 0);
  const missing = (d.staff || []).filter((s) => s.active && !(d.people || []).some((p) => p.user_id === s.user_id && p.active));
  const noPayTo = (d.people || []).filter((p) => p.active && !p.pay_to && pays.some((x) => x.user_id === p.user_id));
  const earned = (d.incentives || []).filter((i) => i.status === 'earned' && pays.some((p) => p.user_id === i.staff_id));
  const cancelled = (d.incentives || []).filter((i) => i.status === 'cancelled');
  const trial = rows.filter((r) => (r.days.nowork_paid || 0) > 0);
  const stale = rows.filter((r) => r.stale);
  const paidN = slips.filter((s) => s.status === 'paid').length;

  const make = () => run('make', async () => {
    const r = await payrollSaveDrafts(month, toMake.map(draftOf), 'Made from CRM attendance');
    return `Drafts saved for ${r.saved} ${r.saved === 1 ? 'person' : 'people'}: ${rupees(r.total)}.${r.skipped?.length ? ` Already approved, left as they are: ${r.skipped.join(', ')}.` : ''}`;
  });
  const approveAll = () => {
    if (!window.confirm(`Approve ${drafts.length} salaries, ${rupees(drafts.reduce((a, s) => a + s.net, 0))} in all?`)) return;
    run('approve', async () => { const n = await payrollApprove(month, null, null); return `Approved ${n}. Now pay each one and mark it paid.`; });
  };
  const exportCsv = () => {
    const head = ['Name', 'Role', 'Salary a month', 'Paid days', 'Days in month', 'Base earned', 'Incentive', 'Travel', 'Bonus', 'Advance', 'Deduction', 'Professional Tax', 'Net pay', 'Status', 'Paid on', 'Paid by', 'Reference'];
    const lines = rows.map((r) => [r.name, ROLE_NAME[r.role] || r.role, r.base, r.days.paid, r.days.in_month, linesOf(r.lines, 'base'), linesOf(r.lines, 'incentive'), linesOf(r.lines, 'travel'),
      linesOf(r.lines, 'bonus'), -linesOf(r.lines, 'advance'), -linesOf(r.lines, 'deduction'), -linesOf(r.lines, 'tax'), r.net, STATUS[r.status][0],
      r.slip?.paid_on || '', PAID_BY[r.slip?.paid_method] || '', r.slip?.paid_ref || '']);
    downloadCsv(`salary-${ym(month)}.csv`, toCsv([head, ...lines]));
  };

  let action = null;
  if (!d.locked && rows.length) action = <span className={`text-[13px] ${muted}`}>Drafts after {dayLabel(d.lock_on)}</span>;
  else if (d.locked && toMake.length && (!slips.length || stale.length || toMake.some((p) => !slips.find((s) => s.user_id === p.user_id)))) {
    action = <button type="button" className={btn.primary} disabled={!!busy} onClick={make}>{busy === 'make' ? 'Saving…' : slips.length ? 'Make drafts again' : `Make drafts · ${rupees(toMake.reduce((a, p) => a + p.net, 0))}`}</button>;
  }
  const approveBtn = canApprove && drafts.length > 0
    ? <button type="button" className={btn.primary} disabled={!!busy || stale.length > 0} onClick={approveAll}>{busy === 'approve' ? 'Approving…' : `Approve ${drafts.length} · ${rupees(drafts.reduce((a, s) => a + s.net, 0))}`}</button> : null;

  const checks = [];
  if (!d.locked) checks.push(['warn', `Preview. ${monthLabel(month)} locks on ${dayLabel(d.lock_on)}; until then attendance can still change. Drafts can be made after that.`]);
  for (const s of missing) checks.push(['warn', `${s.name} has no salary in Salary setup, so no draft is made.`]);
  for (const p of noPayTo) checks.push(['warn', `No UPI or bank details for ${(d.staff || []).find((s) => s.user_id === p.user_id)?.name || 'someone'}.`]);
  if (stale.length) checks.push(['warn', `Attendance or incentives changed after the draft for ${stale.map((r) => r.name).join(', ')}. Make drafts again before approving.`]);
  if (trial.length) checks.push(['warn', `Trial of the work rule: "Logged in, no work" days are paid this month (${trial.map((r) => `${r.name} ${r.days.nowork_paid}`).join(', ')}).`]);
  checks.push(['ok', `${earned.length} incentive${earned.length === 1 ? '' : 's'} earned and not paid yet (${rupees(earned.reduce((a, i) => a + i.amount, 0))}).${cancelled.length ? ` ${cancelled.length} cancelled this month: the shop stopped paying.` : ''}`]);
  if (!missing.length && !noPayTo.length) checks.push(['ok', 'Everyone has a salary and UPI or bank details.']);

  return (
    <div className="space-y-5 max-w-[1300px]">
      <header className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[260px]">
          <h1 className="m-0 text-[26px] font-extrabold">Salary · {monthLabel(month)}</h1>
          <p className="m-0 mt-1 text-[14px] text-[#8fa69a]">Worked out from the CRM: attendance, leave, holidays, incentives and field visits. You check it, approve it, pay it yourself, then mark it paid.</p>
        </div>
        <MonthNav month={month} base="salary" />
        <Link to={path('salary/setup')} className={btn.ghost}><Icon name="sliders" size={16} />Salary setup</Link>
        <button type="button" className={btn.ghost} onClick={exportCsv} disabled={!rows.length}><Icon name="download" size={16} />Export to Excel</button>
        {action}{approveBtn}
      </header>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      <Steps d={d} rows={rows} />

      <section aria-label="Key numbers" className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        <Kpi label={slips.length ? 'To pay' : 'Would pay'} value={rupees(net)} sub={`${rows.length} people · pay day ${dayLabel(payDay(month, d.settings))}`} />
        <Kpi label="Base pay" value={rupees(total('base'))} sub={`of ${rupees(rows.reduce((a, r) => a + r.base, 0))} a month`} />
        <Kpi label="Incentives" value={rupees(total('incentive'))} sub="still paying after 30 days" />
        <Kpi label="Field travel" value={rupees(total('travel'))} />
        <Kpi label="Advances and tax" value={rupees(total('advance') + total('tax') + total('deduction'))} tone={total('advance') + total('tax') < 0 ? 'bad' : undefined} />
        <Kpi label="Paid so far" value={`${paidN} of ${rows.length}`} sub={paidN === rows.length && rows.length ? 'all done' : 'mark each one as you pay'} />
      </section>

      <Panel title="Everyone's salary" className="overflow-hidden" right={<span className={`text-[12.5px] ${muted}`}>One day's pay = salary ÷ {d.settings.day_rate === '30' ? '30' : d.settings.day_rate === 'working' ? 'working days' : 'days in the month'}</span>}>
        {!rows.length ? <Empty>No salaries yet. Set each person's salary in <Link to={path('salary/setup')}>Salary setup</Link>.</Empty> : (
          <div className="overflow-x-auto"><table className="w-full border-collapse text-[13.5px]">
            <thead><tr>{['Person', 'A month', 'Paid days', 'Base earned', 'Incentive', 'Travel', 'Advance', 'Prof. tax', 'Net pay', 'Status', ''].map((h, i) => <th key={h || i} scope="col" className={`${th} ${i && i < 9 ? 'text-right' : ''}`}>{h || <span className="sr-only">Open</span>}</th>)}</tr></thead>
            <tbody>{rows.map((r) => {
              const [st, tone] = STATUS[r.status];
              return (
                <tr key={r.id}>
                  <td className={td}><Link to={path(`salary/${ym(month)}/${r.id}`)} className="text-[#e7efe9] font-bold no-underline hover:underline">{r.name}</Link><div className={`text-[12px] ${muted}`}>{ROLE_NAME[r.role] || r.role}</div></td>
                  <td className={`${td} text-right`}>{rupees(r.base)}</td>
                  <td className={`${td} text-right`}>{daysText(r.days)}{r.days.nowork_paid ? <div className="mt-1"><Chip tone="warn">Trial: {r.days.nowork_paid} no-work</Chip></div> : null}</td>
                  <td className={`${td} text-right`}>{rupees(linesOf(r.lines, 'base'))}</td>
                  <td className={`${td} text-right`}>{linesOf(r.lines, 'incentive') ? rupees(linesOf(r.lines, 'incentive')) : '—'}</td>
                  <td className={`${td} text-right`}>{linesOf(r.lines, 'travel') ? rupees(linesOf(r.lines, 'travel')) : '—'}</td>
                  <td className={`${td} text-right`}>{linesOf(r.lines, 'advance') ? rupees(linesOf(r.lines, 'advance')) : '—'}</td>
                  <td className={`${td} text-right`}>{rupees(linesOf(r.lines, 'tax'))}</td>
                  <td className={`${td} text-right font-extrabold text-[14.5px]`}>{rupees(r.net)}</td>
                  <td className={td}><Chip tone={tone}>{r.status === 'paid' ? `Paid · ${PAID_BY[r.slip.paid_method] || ''}` : st}</Chip>{r.stale && <div className="mt-1"><Chip tone="warn">Changed: make drafts again</Chip></div>}</td>
                  <td className={`${td} text-right`}><Link to={path(`salary/${ym(month)}/${r.id}`)} className={btn.small}>{r.status === 'approved' ? 'Pay' : 'Open'}</Link></td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </Panel>

      <div className="flex flex-wrap gap-5 items-start">
        <Panel title="Checked before you approve" className="flex-[3_1_420px] min-w-0">
          <ul className="list-none m-0 p-0">{checks.map(([k, t], i) => (
            <li key={i} className="flex gap-2.5 items-start px-4 py-3 border-b border-[#18231d] text-[13.5px] leading-snug">
              <span aria-hidden="true" className={`flex-none w-[22px] h-[22px] rounded-full grid place-items-center text-[12px] font-extrabold ${k === 'ok' ? 'bg-[#0f2e22] text-[#6ee7b7]' : 'bg-[#3a2a0c] text-[#fcd34d]'}`}>{k === 'ok' ? '✓' : '!'}</span>{t}
            </li>
          ))}</ul>
        </Panel>
        <div className="flex-[2_1_340px] min-w-0 space-y-5">
          <Advances d={d} pays={pays} can={can} onDone={load} />
          <Panel title="Past months">
            {!(d.past || []).length ? <Empty>No earlier salaries yet.</Empty> : (
              <ul className="list-none m-0 p-0">{d.past.map((m) => (
                <li key={m.month} className="flex flex-wrap items-center gap-2.5 px-4 py-3 border-b border-[#18231d]">
                  <div className="flex-1 min-w-[160px]"><Link to={path(`salary/${ym(m.month)}`)} className="text-[#e7efe9] font-bold no-underline hover:underline">{monthLabel(m.month)}</Link>
                    <div className={`text-[12.5px] ${muted}`}>{m.people} people · {m.paid === m.people ? `paid ${m.paid_on ? dateLabel(m.paid_on) : ''}` : `${m.paid} of ${m.people} paid`}</div></div>
                  <span className="font-extrabold">{rupees(m.net)}</span>
                </li>
              ))}</ul>
            )}
          </Panel>
        </div>
      </div>
      <p className={`m-0 text-[12.5px] ${muted}`}>Every draft, change, approval and payment goes into the audit log. Shop owners and the sales team never see this page; each person sees only their own pay in the CRM.</p>
    </div>
  );
}

// ── One person ──────────────────────────────────────────────────────────────
const CELL = {
  present: 'bg-[#0f2e22] text-[#6ee7b7]', late: 'bg-[#3a2a0c] text-[#fcd34d]', half: 'bg-[#3b2410] text-[#fdba74]',
  nowork_paid: 'bg-[#3a2a0c] text-[#fde68a]', nowork: 'bg-[#3b1414] text-[#fca5a5]', absent: 'bg-[#3b1414] text-[#fca5a5]',
  leave_paid: 'bg-[#0f2440] text-[#93c5fd]', leave_unpaid: 'bg-[#3b1414] text-[#fca5a5]', holiday: 'bg-[#2a1846] text-[#c4b5fd]',
  off: 'bg-[#1b2620] text-[#8fa69a]', precrm: 'bg-[#16211b] text-[#a9bdb2]', not_joined: 'bg-transparent text-[#5d7367]',
  future: 'bg-transparent text-[#5d7367] border border-dashed border-[#2b3b32]', today: 'bg-transparent text-[#e7efe9] border border-[#2b3b32]',
};

export function AdminSalaryPerson() {
  const { me, path } = useAdmin();
  const { month: mParam, userId } = useParams();
  const month = /^\d{4}-\d{2}$/.test(mParam || '') ? `${mParam}-01` : monthOf(istDate());
  const { d, err, load, pays } = useMonth(month);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null);
  const [why, setWhy] = useState('');
  const [pay, setPay] = useState({ method: 'upi', ref: '', on: istDate() });
  const [line, setLine] = useState({ kind: 'bonus', amount: '', reason: '' });
  const can = canDo(me.role, 'salary');
  const canApprove = canDo(me.role, 'salary_approve');

  if (!can) return <Notice kind="warn">Salaries are for the Owner and Finance only.</Notice>;
  if (err) return <Notice>{err}</Notice>;
  if (!d) return <Spinner />;
  const slip = (d.slips || []).find((s) => s.user_id === userId) || null;
  const p = pays.find((x) => x.user_id === userId) || null;
  const staff = (d.staff || []).find((s) => s.user_id === userId);
  const person = (d.people || []).find((x) => x.user_id === userId);
  const src = slip || p;
  if (!src) return <Notice kind="warn">No salary for this person in {monthLabel(month)}. <Link to={path('salary/setup')}>Salary setup</Link></Notice>;
  const status = slip ? slip.status : 'preview';
  const [st, tone] = STATUS[status];
  const manual = slip ? (slip.lines || []).filter(isManualLine).reduce((a, l) => a + l.amount, 0) : 0;
  const stale = slip && slip.status === 'draft' && p && p.net + manual !== slip.net;
  const days = src.days || {};
  const incs = slip ? slip.incentives || [] : p?.incentives || [];
  const cancelled = (d.incentives || []).filter((i) => i.status === 'cancelled' && i.staff_id === userId);

  const act = async (key, fn) => { setBusy(key); setMsg(null); try { const t = await fn(); setMsg({ kind: 'ok', text: t }); setWhy(''); await load(); } catch (x) { setMsg({ kind: 'error', text: x.message }); } finally { setBusy(''); } };
  const markPaid = () => act('paid', async () => {
    await payrollMarkPaid(slip.id, pay.method, pay.ref.trim(), pay.on, null);
    if (!d.settings.whatsapp_on) return `Marked paid. ${staff?.name || 'They'} can see the payslip in the CRM.`;
    try {
      const r = await payrollNotify(slip.id);
      return r.sent ? 'Marked paid. The WhatsApp message was sent and the payslip is in the CRM.' : `Marked paid. The payslip is in the CRM. WhatsApp message not sent: ${r.skipped || 'unknown reason'}.`;
    } catch (x) { return `Marked paid. The payslip is in the CRM. WhatsApp message not sent: ${x.message}`; }
  });
  const payslip = () => {
    if (!openPayslip(slip, { company: d.settings.company_name, address: d.settings.company_address, employeeNo: person?.employee_no, payTo: person?.pay_to, joinedOn: person?.joined_on, approvedBy: slip.approved_by_name })) {
      setMsg({ kind: 'error', text: 'The browser blocked the new window. Allow pop-ups for this site and try again.' });
    }
  };
  const REFS = { upi: ['UPI reference (12 digits)', '433822101290'], bank: ['UTR number', 'SBIN426051234567'], cash: ['Receipt number or note (optional)', 'Receipt 0007'] };

  return (
    <div className="space-y-5 max-w-[1300px]">
      <nav aria-label="Breadcrumb" className={`text-[13.5px] ${muted}`}><Link to={path(`salary/${ym(month)}`)}>Salary · {monthLabel(month)}</Link> <span aria-hidden="true">›</span> {src.name}</nav>
      <header className="flex flex-wrap items-center gap-3.5">
        <span aria-hidden="true" className="w-[52px] h-[52px] rounded-full bg-sky-200 text-sky-900 grid place-items-center font-extrabold text-[17px]">{String(src.name || '?').split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}</span>
        <div className="flex-1 min-w-[240px]">
          <h1 className="m-0 text-[26px] font-extrabold">{src.name}</h1>
          <p className={`m-0 mt-1 text-[14px] ${muted}`}>{ROLE_NAME[src.role] || src.role}{person?.joined_on ? ` · joined ${dateLabel(person.joined_on)}` : ''} · {person?.pay_to ? `paid to ${person.pay_to}` : 'no UPI or bank details yet'}</p>
        </div>
        <Chip tone={tone}>{status === 'paid' ? `Paid ${dateLabel(slip.paid_on)}` : st}</Chip>
      </header>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      {stale && <Notice kind="warn">Attendance or incentives changed after this draft was made. Make the drafts again on the Salary page before approving.</Notice>}

      <div className="flex flex-wrap gap-5 items-start">
        <div className="flex-[3_1_560px] min-w-0 space-y-5">
          <Panel title={`Net pay for ${monthLabel(month)}`} className="overflow-hidden" right={<span className="text-[26px] font-extrabold text-emerald-300">{rupees(src.net)}</span>}>
            <table className="w-full border-collapse text-[13.5px]">
              <thead><tr><th scope="col" className={th}>Line</th><th scope="col" className={th}>How it is worked out</th><th scope="col" className={`${th} text-right`}>Amount</th><th scope="col" className={th}><span className="sr-only">Remove</span></th></tr></thead>
              <tbody>{orderedLines(src.lines).map((l) => (
                <tr key={l.i}>
                  <td className={`${td} font-bold`}>{l.label}</td>
                  <td className={`${td} whitespace-normal ${muted}`}>{l.how}{l.by ? ` · added by ${l.by}` : ''}</td>
                  <td className={`${td} text-right font-bold ${l.amount < 0 ? 'text-red-300' : l.kind === 'base' ? '' : 'text-emerald-300'}`}>{lineAmount(l)}</td>
                  <td className={`${td} text-right`}>{status === 'draft' && isManualLine(l) && <button type="button" className={btn.small} disabled={!!busy} onClick={() => act('rm', async () => { await payrollLineRemove(slip.id, l.i, why.trim() || null); return 'Line removed.'; })}>Remove</button>}</td>
                </tr>
              ))}</tbody>
            </table>
          </Panel>

          <Panel title={`Paid days: ${String(days.paid ?? 0).replace(/\.0$/, '')} of ${days.in_month ?? ''}`}>
            <div className="flex flex-wrap gap-5 p-4">
              <div className="flex-[1_1_300px] min-w-0">
                <div className="grid grid-cols-7 gap-1.5">
                  {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((x, i) => <div key={i} className="text-[11px] font-extrabold text-[#80988b] text-center">{x}</div>)}
                  {(p?.cells || []).map((c, i) => (c ? (
                    <div key={c.day} title={`${dateLabel(c.day)}: ${PAY_DAY[c.status]?.label || ''}`} aria-label={`${dateLabel(c.day)}: ${PAY_DAY[c.status]?.label || 'to come'}`}
                      className={`h-9 rounded-lg grid place-items-center text-[12.5px] font-extrabold ${CELL[c.status] || ''}`}>{c.n}</div>
                  ) : <div key={`x${i}`} />))}
                </div>
                {slip && <p className={`m-0 mt-2 text-[12px] ${muted}`}>Calendar from today's CRM records; the numbers are the saved draft's.</p>}
              </div>
              <div className="flex-[1_1_240px] min-w-0 grid grid-cols-2 gap-2 content-start">
                {[['Present', (days.present || 0) + (days.late || 0), days.late ? `${days.late} late, paid` : ''], ['Half day', days.half || 0, 'half paid'],
                  ['Paid leave', days.leave_paid || 0, `${days.leave_left ?? 0} left after`], ['Not paid', days.unpaid || 0, [days.absent && `${days.absent} absent`, days.leave_unpaid && `${days.leave_unpaid} leave`, days.nowork && `${days.nowork} no work`, days.not_joined && `${days.not_joined} before joining`].filter(Boolean).join(', ')],
                  ['Weekly off', days.off || 0, 'paid'], ['Holidays', days.holiday || 0, 'paid'],
                  ...(days.precrm ? [['Before the CRM', days.precrm, 'no record: paid']] : []), ...(days.nowork_paid ? [['No work (trial)', days.nowork_paid, 'paid in the trial']] : [])].map(([t, v, s]) => (
                  <div key={t} className="rounded-xl bg-[#16211b] px-3 py-2.5"><div className="text-[20px] font-extrabold">{String(v).replace(/\.0$/, '')}</div><div className="text-[12px] font-bold text-[#c8d6ce]">{t}</div>{s && <div className={`text-[11.5px] ${muted}`}>{s}</div>}</div>
                ))}
              </div>
            </div>
          </Panel>

          <Panel title="Incentives in this salary" className="overflow-hidden" right={<Chip tone="ok">{rupees(incs.reduce((a, i) => a + (Number(i.amount) || 0), 0))}</Chip>}>
            {!incs.length && !cancelled.length ? <Empty>No incentive earned this time.</Empty> : (
              <div className="overflow-x-auto"><table className="w-full border-collapse text-[13.5px]">
                <thead><tr>{['Shop', 'Plan', 'Shop paid', '30-day check', 'Amount', 'Status'].map((h) => <th key={h} scope="col" className={th}>{h}</th>)}</tr></thead>
                <tbody>
                  {incs.map((i) => <tr key={i.lead_id}><td className={`${td} font-bold`}>{i.shop}</td><td className={td}>{i.plan === 'yearly' ? 'Yearly' : 'Monthly'}</td><td className={td}>{dateLabel(String(i.won_at || '').slice(0, 10))}</td><td className={td}>{dateLabel(istDate(Date.parse(i.decided_at || i.due_at || '')))}</td><td className={`${td} font-bold`}>{rupees(i.amount)}</td><td className={td}><Chip tone="ok">{status === 'paid' ? 'Paid out' : 'Earned'}</Chip></td></tr>)}
                  {cancelled.map((i) => <tr key={i.lead_id}><td className={`${td} font-bold`}>{i.shop}</td><td className={td}>{i.plan === 'yearly' ? 'Yearly' : 'Monthly'}</td><td className={td}>{dateLabel(String(i.won_at || '').slice(0, 10))}</td><td className={td}>{dateLabel(istDate(Date.parse(i.decided_at || '')))}</td><td className={`${td} font-bold`}>₹0</td><td className={td}><Chip tone="bad">Shop stopped paying</Chip></td></tr>)}
                </tbody>
              </table></div>
            )}
          </Panel>

          {(p?.travel || []).length > 0 && (
            <Panel title="Field travel" className="overflow-hidden">
              <div className="overflow-x-auto"><table className="w-full border-collapse text-[13.5px]">
                <thead><tr>{['Day', 'Visits', 'Distance', 'Pay'].map((h) => <th key={h} scope="col" className={th}>{h}</th>)}</tr></thead>
                <tbody>{p.travel.map((t) => <tr key={t.day}><td className={td}>{dayLabel(t.day)}</td><td className={td}>{t.visits}</td><td className={td}>{t.km} km</td><td className={`${td} font-bold`}>{rupees(t.pay)}</td></tr>)}</tbody>
              </table></div>
              <p className={`m-0 px-4 py-3 text-[12.5px] ${muted}`}>Start of day → each visit check-in → end of day, straight line × {d.settings.road_factor}. Visits the manager rejected are not counted.</p>
            </Panel>
          )}
        </div>

        <div className="flex-[2_1_340px] min-w-0 space-y-5">
          <Panel title={status === 'paid' ? 'Paid' : status === 'approved' ? 'Pay, then mark paid' : status === 'draft' ? 'Approve' : 'Not saved yet'}>
            <div className="p-4 space-y-3">
              {status === 'preview' && <p className="m-0 text-[13.5px] text-[#c8d6ce]">This is what the CRM shows so far. {d.locked ? 'Make the drafts on the Salary page to save it.' : `Drafts can be made after ${dayLabel(d.lock_on)}.`}</p>}
              {status === 'draft' && (canApprove ? (
                <>
                  <p className="m-0 text-[13.5px] text-[#c8d6ce]">Check the lines and the days. Add a bonus or a deduction below if needed. Nothing is paid by the system.</p>
                  <button type="button" className={`${btn.primary} w-full h-12 text-[15px]`} disabled={!!busy || stale} onClick={() => act('approve', async () => { await payrollApprove(month, [slip.id], null); return 'Approved. Pay it, then mark it paid here.'; })}>{busy === 'approve' ? 'Approving…' : `Approve ${rupees(slip.net)}`}</button>
                </>
              ) : <Notice kind="warn">Waiting for the Owner to approve.</Notice>)}
              {status === 'approved' && (
                <>
                  <p className="m-0 text-[13.5px] text-[#c8d6ce]">Pay <b>{rupees(slip.net)}</b> to <b>{person?.pay_to || 'their account'}</b> from your bank app, then note it here.</p>
                  <div role="group" aria-label="Paid by" className="flex flex-wrap gap-2">
                    {Object.entries(PAID_BY).map(([k, t]) => <button key={k} type="button" aria-pressed={pay.method === k} onClick={() => setPay({ ...pay, method: k })} className={`h-9 px-3.5 rounded-full border text-[13px] font-semibold cursor-pointer ${pay.method === k ? 'bg-[#e7efe9] text-[#0a0f0c] border-[#e7efe9]' : 'bg-[#111a15] text-[#c8d6ce] border-[#2b3b32]'}`}>{t}</button>)}
                  </div>
                  <div><label className={label} htmlFor="pay-ref">{REFS[pay.method][0]}</label><input id="pay-ref" className={input} value={pay.ref} onChange={(e) => setPay({ ...pay, ref: e.target.value })} placeholder={REFS[pay.method][1]} /></div>
                  <div><label className={label} htmlFor="pay-on">Paid on</label><input id="pay-on" type="date" className={input} value={pay.on} max={istDate()} min={month} onChange={(e) => setPay({ ...pay, on: e.target.value })} /></div>
                  <button type="button" className={`${btn.primary} w-full h-12 text-[15px]`} disabled={!!busy || (pay.method !== 'cash' && !pay.ref.trim()) || !pay.on} onClick={markPaid}>{busy === 'paid' ? 'Saving…' : 'Mark paid · send payslip'}</button>
                </>
              )}
              {status === 'paid' && (
                <>
                  <div className="text-[18px] font-extrabold text-emerald-300">Paid {rupees(slip.net)}</div>
                  <div className={`text-[13.5px] ${muted}`}>{dateLabel(slip.paid_on)} · {PAID_BY[slip.paid_method]}{slip.paid_ref ? ` · ${slip.paid_ref}` : ''}{slip.paid_by_name ? ` · marked by ${slip.paid_by_name}` : ''}</div>
                  <div className={`text-[13.5px] ${muted}`}>{slip.notified_at ? 'WhatsApp message sent.' : 'No WhatsApp message sent.'} The payslip is in their CRM, under My pay.</div>
                </>
              )}
              {slip && slip.status !== 'draft' && <button type="button" className={`${btn.ghost} w-full`} onClick={payslip}><Icon name="download" size={16} />Payslip (PDF)</button>}
              {slip && (
                <div className="pt-2 border-t border-[#1f2b24] space-y-2">
                  <div><label className={label} htmlFor="sal-why">Reason (goes in the log)</label><input id="sal-why" className={input} value={why} onChange={(e) => setWhy(e.target.value)} placeholder="e.g. Wrong UPI reference" /></div>
                  <div className="flex flex-wrap gap-2">
                    {status === 'draft' && <button type="button" className={btn.danger} disabled={!!busy || why.trim().length < 3} onClick={() => act('rmdraft', async () => { await payrollDraftRemove(slip.id, why.trim()); return 'Draft removed.'; })}>Remove this draft</button>}
                    {status === 'approved' && canApprove && <button type="button" className={btn.ghost} disabled={!!busy || why.trim().length < 3} onClick={() => act('back', async () => { await payrollUnapprove(slip.id, why.trim()); return 'Back to draft.'; })}>Back to draft</button>}
                    {status === 'paid' && canApprove && <button type="button" className={btn.danger} disabled={!!busy || why.trim().length < 3} onClick={() => { if (window.confirm('Undo this payment? Its incentives go back to "Earned" in the CRM.')) act('undo', async () => { await payrollUndoPaid(slip.id, why.trim()); return 'Payment undone. It is approved and waiting to be paid again.'; }); }}>Undo payment</button>}
                  </div>
                </div>
              )}
            </div>
          </Panel>

          {status === 'draft' && (
            <Panel title="Add a bonus or a deduction">
              <form className="p-4 space-y-3" onSubmit={(e) => { e.preventDefault(); act('line', async () => { await payrollLineAdd(slip.id, line.kind, Number(line.amount), line.reason.trim()); setLine({ ...line, amount: '', reason: '' }); return 'Added.'; }); }}>
                <div role="group" aria-label="Kind of line" className="flex gap-2">
                  {[['bonus', 'Bonus'], ['deduction', 'Deduction']].map(([k, t]) => <button key={k} type="button" aria-pressed={line.kind === k} onClick={() => setLine({ ...line, kind: k })} className={`h-9 px-3.5 rounded-full border text-[13px] font-semibold cursor-pointer ${line.kind === k ? 'bg-[#e7efe9] text-[#0a0f0c] border-[#e7efe9]' : 'bg-[#111a15] text-[#c8d6ce] border-[#2b3b32]'}`}>{t}</button>)}
                </div>
                <div className="flex gap-2.5">
                  <div className="w-[120px] flex-none"><label className={label} htmlFor="ln-amt">Amount (₹)</label><input id="ln-amt" inputMode="numeric" className={input} value={line.amount} onChange={(e) => setLine({ ...line, amount: e.target.value.replace(/\D/g, '') })} placeholder="500" /></div>
                  <div className="flex-1 min-w-0"><label className={label} htmlFor="ln-why">Reason (they see it)</label><input id="ln-why" className={input} value={line.reason} onChange={(e) => setLine({ ...line, reason: e.target.value })} placeholder="Best caller in November" /></div>
                </div>
                <button type="submit" className={`${btn.ghost} w-full`} disabled={!!busy || !Number(line.amount) || line.reason.trim().length < 3}>Add to this salary</button>
                <p className={`m-0 text-[12.5px] ${muted}`}>Only before it is approved. Each line goes into the audit log with your name.</p>
              </form>
            </Panel>
          )}
          {slip && (
            <Panel title="History">
              <ul className="list-none m-0 p-0 text-[13.5px]">
                {[[slip.paid_at, `Marked paid by ${slip.paid_by_name || 'Admin'}`], [slip.approved_at, `Approved by ${slip.approved_by_name || 'the Owner'}`], [slip.made_at, 'Draft made from the CRM']]
                  .filter(([at]) => at).map(([at, t]) => <li key={t} className="flex gap-3 px-4 py-2.5 border-b border-[#18231d]"><span className={`w-[130px] flex-none ${muted}`}>{dayLabel(istDate(Date.parse(at)))}</span>{t}</li>)}
              </ul>
              <p className={`m-0 px-4 py-3 text-[12.5px] ${muted}`}>Every change is in the <Link to={path('log')}>audit log</Link>.</p>
            </Panel>
          )}
          <p className={`m-0 text-[12.5px] ${muted}`}>Pays to: {person?.pay_to ? `${person.pay_to} (shown to them as ${maskPayTo(person.pay_to)})` : 'not set'}.</p>
        </div>
      </div>
    </div>
  );
}

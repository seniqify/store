// My pay: your own salary, never anyone else's (sales_my_pay checks it is you).
// "So far this month" is worked out on this phone from your own attendance,
// incentives and visits with the same rules Admin uses (utils/payroll.js), so
// it matches the payslip you get after the month. Payslips appear here once
// the Owner approves them; a PDF can be saved from each.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useCrm } from './crmContext.js';
import { myPay, attendanceBetween, listHolidays, listLeave, workDays, listIncentives, visitsBetween, askQuestion } from './crmService.js';
import { istDate, istInstant } from './crmLogic.js';
import {
  computePay, monthOf, monthEnd, monthLabel, dayLabel, dateLabel, payDay, rupees, lineAmount, orderedLines, PAID_BY, monthDays,
} from '../utils/payroll.js';
import { openPayslip } from '../utils/payslipPdf.js';
import { Spinner, Notice, Empty } from './ui.jsx';
import { btn, card } from './crmStyles.js';

const days = (n) => String(Number(n) || 0).replace(/\.0$/, '');

function useMyPay(me) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const load = useCallback(async () => {
    setErr('');
    const today = istDate();
    const month = monthOf(today);
    const end = monthEnd(month);
    try {
      const [pay, rows, holidays, leave, works, incs, visits] = await Promise.all([
        myPay(), attendanceBetween(month, end), listHolidays(), listLeave(), workDays(month, today < end ? today : end), listIncentives(),
        me.role === 'field' ? visitsBetween(new Date(istInstant(month)).toISOString(), new Date(istInstant(end) + 86400000).toISOString()) : Promise.resolve([]),
      ]);
      setD({ today, month, pay, rows, holidays, leave, works, incs: incs.filter((i) => i.staff_id === me.user_id), visits });
    } catch (x) { setErr(x.message); }
  }, [me.role, me.user_id]);
  useEffect(() => { load(); }, [load]);
  return { d, err, load };
}

function Lines({ lines, openIdx, setOpen }) {
  return orderedLines(lines).map((l, i) => (
    <button key={i} type="button" aria-expanded={openIdx === i} onClick={() => setOpen(openIdx === i ? -1 : i)}
      className="w-full flex items-center gap-2.5 px-4 py-3 border-t border-gray-100 text-left bg-transparent">
      <span className="flex-1 min-w-0"><span className="block text-[14px] font-bold">{l.label}</span>
        {openIdx === i && <span className="block text-[12.5px] text-gray-600 mt-1 leading-snug">{l.how}{l.by ? ` · added by ${l.by}` : ''}</span>}</span>
      <span className={`text-[14.5px] font-extrabold ${l.amount < 0 ? 'text-red-700' : l.kind === 'base' ? '' : 'text-green-700'}`}>{lineAmount(l)}</span>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={openIdx === i ? 'rotate-180' : ''}><path d="M6 9l6 6 6-6" /></svg>
    </button>
  ));
}

function Payslip({ slip, pay, me }) {
  const { path } = useCrm();
  const [open, setOpen] = useState(0);
  const [ask, setAsk] = useState(null);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState('');
  const d = slip.days || {};
  const paid = slip.status === 'paid';
  const pdf = () => {
    if (!openPayslip(slip, { company: pay.settings?.company_name, address: pay.settings?.company_address, employeeNo: pay.person?.employee_no, payTo: pay.person?.pay_to, joinedOn: pay.person?.joined_on, approvedBy: slip.approved_by_name })) {
      setErr('Your browser blocked the new window. Allow pop-ups for this site and try again.');
    }
  };
  const send = async () => {
    setErr('');
    try { await askQuestion(me.user_id, `About my ${monthLabel(slip.month)} payslip: ${ask.trim()}`); setSent(true); setAsk(null); } catch (x) { setErr(x.message); }
  };
  return (
    <div className="max-w-xl mx-auto px-4 py-5 space-y-3">
      <Link to={path('pay')} className="text-sm font-bold">‹ My pay</Link>
      <section className="rounded-2xl bg-[#0f1f18] text-white p-4 space-y-1.5">
        <div className="flex items-center gap-2"><span className={`h-6 px-2 rounded-full text-[12px] font-extrabold inline-flex items-center ${paid ? 'bg-green-500 text-green-950' : 'bg-amber-300 text-amber-950'}`}>{paid ? 'Paid' : 'Approved'}</span>
          <span className="text-[13px] text-green-200 font-bold">{paid ? `${dayLabel(slip.paid_on)} · ${PAID_BY[slip.paid_method] || ''}${slip.paid_ref ? ` · ref ${String(slip.paid_ref).slice(-4).padStart(6, '•')}` : ''}` : `To be paid on ${dayLabel(payDay(slip.month, pay.settings))}`}</span></div>
        <h1 className="m-0 text-[15px] font-bold text-gray-300">{monthLabel(slip.month)} payslip</h1>
        <div className="text-[32px] font-extrabold tracking-tight">{rupees(slip.net)}</div>
        <div className="text-[12.5px] text-gray-300">{days(d.paid)} paid days of {d.in_month} · present {days((d.present || 0) + (d.late || 0) + (d.precrm || 0))} · half day {days(d.half)} · paid leave {days(d.leave_paid)}</div>
      </section>
      <section aria-label="How your pay is made" className={`${card} overflow-hidden`}>
        <div className="px-4 pt-3 pb-2"><h2 className="m-0 text-[15px] font-extrabold">How your pay is made</h2><div className="text-[12.5px] text-gray-600">Tap a line to see why.</div></div>
        <Lines lines={slip.lines} openIdx={open} setOpen={setOpen} />
        <div className="flex items-center px-4 py-3 border-t-2 border-gray-900 bg-gray-50"><span className="flex-1 font-extrabold">Net pay</span><span className="text-[17px] font-extrabold text-green-700">{rupees(slip.net)}</span></div>
      </section>
      {(slip.incentives || []).length > 0 && (
        <section className={`${card} p-4`}>
          <h2 className="m-0 mb-2 text-[15px] font-extrabold">Incentives in this salary</h2>
          <ul className="m-0 p-0 list-none space-y-1.5 text-[13.5px]">{slip.incentives.map((i) => <li key={i.lead_id} className="flex gap-2"><span className="flex-1">{i.shop} · {i.plan === 'yearly' ? 'yearly' : 'monthly'}</span><b>{rupees(i.amount)}</b></li>)}</ul>
        </section>
      )}
      {err && <Notice>{err}</Notice>}
      <button type="button" className={`${btn.primary} w-full`} onClick={pdf}>Download PDF</button>
      {ask === null ? (
        <button type="button" className={`${btn.ghost} w-full`} onClick={() => { setSent(false); setAsk(''); }}>{sent ? 'Sent to your manager · the answer comes in FAQ & help' : 'Something wrong? Ask the manager'}</button>
      ) : (
        <div className={`${card} p-3 space-y-2`}>
          <label htmlFor="pay-q" className="block text-sm font-bold">What looks wrong?</label>
          <textarea id="pay-q" rows={3} className="w-full rounded-xl border border-gray-200 p-3 text-[15px]" value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="e.g. 18 Nov was a holiday for me" />
          <div className="flex gap-2"><button type="button" className={`${btn.primary} flex-1`} disabled={ask.trim().length < 3} onClick={send}>Send</button><button type="button" className={btn.ghost} onClick={() => setAsk(null)}>Cancel</button></div>
        </div>
      )}
    </div>
  );
}

export default function CrmMyPay() {
  const { me, settings, path } = useCrm();
  const { month: mParam } = useParams();
  const { d, err } = useMyPay(me);
  const [open, setOpen] = useState(-1);

  const est = useMemo(() => {
    if (!d?.pay?.person) return null;
    const inSlips = new Set((d.pay.slips || []).filter((s) => s.status === 'approved').flatMap((s) => (s.incentives || []).map((i) => i.lead_id)));
    const incentives = d.incs.filter((i) => i.status === 'earned' && !inSlips.has(i.lead_id)).map((i) => ({ lead_id: i.lead_id, staff_id: i.staff_id, amount: i.incentive, status: 'earned', shop: i.sales_leads?.shop_name }));
    const visits = (d.visits || []).filter((v) => v.review !== 'rejected').map((v) => ({ ...v, at: v.created_at }));
    return computePay({
      month: d.month, today: d.today, staff: me, person: d.pay.person, rules: d.pay.settings, workRules: settings?.work,
      attendance: d.rows, holidays: d.holidays, leaves: d.leave, works: d.works, visits, incentives, advances: (d.pay.advances || []).map((a) => ({ ...a, user_id: me.user_id })),
      leaveLeft: d.pay.leave_left ?? null,
    });
  }, [d, me, settings]);

  if (err) return <div className="max-w-xl mx-auto px-4 py-5"><Notice>{err}</Notice></div>;
  if (!d) return <Spinner />;
  const { pay } = d;
  if (mParam) {
    const slip = (pay.slips || []).find((s) => s.month.slice(0, 7) === mParam);
    return slip ? <Payslip slip={slip} pay={pay} me={me} /> : <div className="max-w-xl mx-auto px-4 py-5 space-y-3"><Link to={path('pay')} className="text-sm font-bold">‹ My pay</Link><Empty>No payslip for this month yet.</Empty></div>;
  }

  const waiting = d.incs.filter((i) => i.status === 'waiting' || i.status === 'check');
  const gone = Number(d.today.slice(8, 10));
  const inMonth = monthDays(d.month);
  const trialOn = pay.settings?.nowork_paid_until && d.today <= pay.settings.nowork_paid_until;
  const shown = est ? est.lines.filter((l) => l.amount !== 0 || l.kind === 'base') : [];
  const soFar = est ? est.lines.filter((l) => l.amount > 0).reduce((a, l) => a + l.amount, 0) : 0;

  return (
    <div className="max-w-xl mx-auto px-4 py-5 space-y-3">
      <h1 className="m-0 text-xl font-extrabold">My pay</h1>
      {!pay.person ? (
        <Notice kind="warn">Your salary is not set up here yet. Ask your manager; until then your incentives are under <Link to={path('incentives')}>My incentive</Link>.</Notice>
      ) : (
        <>
          <section className="rounded-2xl bg-[#0f1f18] text-white p-4 space-y-1.5">
            <div className="text-[13px] text-green-200 font-bold">{monthLabel(d.month).split(' ')[0]} so far · {dayLabel(d.today)}</div>
            <div className="text-[30px] font-extrabold tracking-tight">{rupees(soFar)}</div>
            <div className="text-[12.5px] text-gray-300">{days(est.days.paid)} paid days{est.incentives.length ? ` and ${est.incentives.length} incentive${est.incentives.length === 1 ? '' : 's'}` : ''} · paid on {dayLabel(payDay(d.month, pay.settings))}</div>
            <div role="img" aria-label={`${gone} of ${inMonth} days of the month gone`} className="h-2 rounded-full bg-white/15 overflow-hidden mt-1"><div className="h-full bg-green-500" style={{ width: `${Math.round((gone / inMonth) * 100)}%` }} /></div>
            <div className="text-[11.5px] text-gray-300">{gone} of {inMonth} days gone · salary {rupees(pay.person.base_monthly)} a month</div>
          </section>

          <section aria-label="So far this month" className={`${card} overflow-hidden`}>
            <div className="px-4 pt-3 pb-2"><h2 className="m-0 text-[15px] font-extrabold">So far this month</h2><div className="text-[12.5px] text-gray-600">Tap a line to see how. It can change until the month locks on the 2nd.</div></div>
            <Lines lines={shown} openIdx={open} setOpen={setOpen} />
          </section>
        </>
      )}

      <section aria-label="Incentives waiting" className={`${card} overflow-hidden`}>
        <div className="px-4 pt-3 pb-2"><h2 className="m-0 text-[15px] font-extrabold">Waiting for the 30-day check</h2><div className="text-[12.5px] text-gray-600">Shops that get orders keep paying. Help them start.</div></div>
        {!waiting.length ? <p className="m-0 px-4 pb-3 text-sm text-gray-500">None right now.</p> : waiting.map((i) => (
          <div key={i.lead_id} className="flex items-center gap-2.5 px-4 py-2.5 border-t border-gray-100">
            <div className="flex-1 min-w-0"><div className="text-[14px] font-bold truncate">{i.sales_leads?.shop_name || 'A shop'}</div><div className="text-[12.5px] text-gray-600">{i.plan === 'yearly' ? 'Yearly' : 'Monthly'} · check {dayLabel(istDate(Date.parse(i.due_at)))}</div></div>
            <span className="h-6 px-2.5 rounded-full bg-amber-100 text-amber-900 text-[12.5px] font-extrabold inline-flex items-center">{rupees(i.incentive)}</span>
          </div>
        ))}
        <div className="px-4 py-2.5 border-t border-gray-100"><Link to={path('incentives')} className="text-sm font-bold">All my incentives</Link></div>
      </section>

      {trialOn && <div className="rounded-2xl bg-amber-50 border border-amber-200 px-3.5 py-2.5 text-[12.5px] text-amber-900 leading-snug"><b>Trial until {dateLabel(pay.settings.nowork_paid_until)}:</b> a day with a login but no real work is still paid. After that it is not.{est?.days.nowork_paid ? ` This month so far: ${est.days.nowork_paid}.` : ' You have none this month.'}</div>}

      <section aria-label="Payslips" className={`${card} overflow-hidden`}>
        <div className="px-4 pt-3 pb-2"><h2 className="m-0 text-[15px] font-extrabold">Payslips</h2></div>
        {!(pay.slips || []).length ? <p className="m-0 px-4 pb-3 text-sm text-gray-500">Your first payslip appears here after the month ends and the Owner approves it.</p> : pay.slips.map((s) => (
          <Link key={s.id} to={path(`pay/${s.month.slice(0, 7)}`)} className="flex items-center gap-3 px-4 py-3 border-t border-gray-100 no-underline text-gray-900">
            <span className="flex-1 min-w-0"><span className="block text-[12.5px] text-gray-600 font-semibold">{monthLabel(s.month)}</span><span className="block text-[16px] font-extrabold">{rupees(s.net)} · {s.status === 'paid' ? `paid ${dayLabel(s.paid_on)}` : `to be paid ${dayLabel(payDay(s.month, pay.settings))}`}</span></span>
            <span className="text-[13px] font-extrabold text-green-700">Payslip</span>
          </Link>
        ))}
      </section>
    </div>
  );
}

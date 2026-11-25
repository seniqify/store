// Incentives: one row per paid shop credited to someone. Earned only when the
// shop is still paying after the hold period (checked by the database every
// night). Shows the plan and the amount paid, never any shop data. A manager
// sees everyone, confirms manager-approved wins after the hold and marks
// earned incentives paid out.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCrm, initials } from './crmContext.js';
import { listIncentives, setIncentive } from './crmService.js';
import { istDate, shortDay, incentiveRuleLines, INCENTIVE_STATUS } from './crmLogic.js';
import { Spinner, Notice, Empty } from './ui.jsx';
import IncentiveExplainer from './CrmIncentiveExplainer.jsx';
import { btn, card } from './crmStyles.js';

const inr = (n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;
const BASIS = { link: 'Your link', worked: 'Your calls or visits', approved: 'Approved by the manager', verified: 'Lead you checked' };
const dayOf = (v) => (v ? shortDay(istDate(Date.parse(v))) : '');

function Totals({ rows }) {
  const sum = (st) => rows.filter((r) => st.includes(r.status)).reduce((s, r) => s + r.incentive, 0);
  const monthStart = `${istDate().slice(0, 7)}-01`;
  const paidMonth = rows.filter((r) => r.status === 'paid' && r.paid_at && istDate(Date.parse(r.paid_at)) >= monthStart).reduce((s, r) => s + r.incentive, 0);
  return (
    <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {[['Waiting for the check', sum(['waiting', 'check']), 'shops in their first 30 days'], ['Earned, to be paid', sum(['earned']), 'paid with salary'],
        ['Paid this month', paidMonth, ''], ['Cancelled', sum(['cancelled']), 'shop stopped paying']].map(([label, v, sub]) => (
        <div key={label} className={`${card} px-4 py-3`}><div className="text-[11.5px] font-bold uppercase tracking-wide text-gray-500">{label}</div>
          <div className="text-2xl font-extrabold mt-0.5">{inr(v)}</div>{sub && <div className="text-[12.5px] text-gray-500">{sub}</div>}</div>
      ))}
    </section>
  );
}

export default function CrmIncentives() {
  const { me, staff, settings, nameOf, path } = useCrm();
  const isManager = me.role === 'manager';
  const isAds = me.role === 'ads';
  const [rows, setRows] = useState(null);
  const [who, setWho] = useState('all');
  const [err, setErr] = useState('');
  const load = useCallback(async () => setRows(await listIncentives()), []);
  useEffect(() => { load(); }, [load]);

  // One person's row on a lead (a paid lead can have two: the seller's and the lead checker's).
  const act = async (r, status) => { setErr(''); try { await setIncentive(r.lead_id, status, null, r.staff_id); await load(); } catch (e) { setErr(e.message); } };
  const shown = useMemo(() => (rows || []).filter((r) => who === 'all' || r.staff_id === who), [rows, who]);
  const people = useMemo(() => {
    const m = new Map();
    for (const r of rows || []) {
      if (!m.has(r.staff_id)) m.set(r.staff_id, { waiting: 0, earned: 0, paid: 0, cancelled: 0, n: 0 });
      const p = m.get(r.staff_id);
      p.n++;
      if (r.status === 'waiting' || r.status === 'check') p.waiting += r.incentive;
      else p[r.status] += r.incentive;
    }
    return [...m.entries()];
  }, [rows]);

  if (!rows) return <Spinner />;
  return (
    <div className="px-4 lg:px-7 py-5 space-y-4">
      <header className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[220px]"><h1 className="text-2xl font-extrabold">{isManager ? 'Incentives' : 'My incentive'}</h1>
          <p className="text-sm text-gray-500">Only for shops that really paid, and still pay after 30 days. Shows the plan and the amount, nothing else about the shop.</p></div>
        {isManager && <Link to={path('settings')} className={btn.ghost}>Change the rule</Link>}
      </header>
      {err && <Notice>{err}</Notice>}

      <section className={`${card} p-4`}>
        <h2 className="font-extrabold">The rule</h2>
        <ul className="mt-1.5 space-y-1 text-[14px] text-gray-800 list-disc pl-5">{incentiveRuleLines(settings?.incentive, isAds ? 'ads' : undefined).map((x) => <li key={x}>{x}</li>)}</ul>
        {isManager && <><p className="mt-3 text-[13px] font-extrabold text-gray-700">Ads &amp; leads team</p>
          <ul className="mt-1 space-y-1 text-[14px] text-gray-800 list-disc pl-5">{incentiveRuleLines(settings?.incentive, 'ads').slice(0, 1).map((x) => <li key={x}>{x}</li>)}</ul></>}
      </section>

      <IncentiveExplainer cfg={settings?.incentive} compact={isManager} role={isAds ? 'ads' : undefined} />

      <Totals rows={shown} />

      {isManager && people.length > 0 && (
        <section aria-label="By person" className={`${card} overflow-hidden`}>
          <h2 className="px-4 pt-3 pb-2 font-extrabold">By person</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[620px]">
              <thead><tr className="text-left text-[12px] uppercase tracking-wide text-gray-500">
                <th className="px-4 py-2 font-bold">Person</th><th className="px-2 py-2 font-bold">Paid shops</th><th className="px-2 py-2 font-bold">Waiting</th>
                <th className="px-2 py-2 font-bold">Earned, to pay</th><th className="px-2 py-2 font-bold">Paid</th><th className="px-4 py-2 font-bold" />
              </tr></thead>
              <tbody>
                {people.map(([uid, p]) => (
                  <tr key={uid} className="border-t border-gray-100">
                    <td className="px-4 py-3"><div className="flex items-center gap-2.5"><span aria-hidden="true" className="w-8 h-8 rounded-full bg-blue-100 text-blue-800 grid place-items-center text-[11px] font-extrabold">{initials(nameOf(uid))}</span><span className="font-bold">{nameOf(uid) || 'Someone'}</span></div></td>
                    <td className="px-2 py-3">{p.n}</td><td className="px-2 py-3">{inr(p.waiting)}</td>
                    <td className="px-2 py-3 font-extrabold">{inr(p.earned)}</td><td className="px-2 py-3">{inr(p.paid)}</td>
                    <td className="px-4 py-3 text-right">{p.earned > 0 && (
                      <button type="button" className={btn.smallGreen} onClick={async () => {
                        if (!window.confirm(`Mark ${inr(p.earned)} as paid to ${nameOf(uid)}?`)) return;
                        for (const r of rows.filter((x) => x.staff_id === uid && x.status === 'earned')) await act(r, 'paid');
                      }}>Mark {inr(p.earned)} paid</button>)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section aria-label="Paid shops" className={`${card} overflow-hidden`}>
        <div className="flex flex-wrap items-center gap-2 px-4 pt-3 pb-2">
          <h2 className="font-extrabold flex-1">Paid shops</h2>
          {isManager && (
            <select aria-label="Person" className="h-9 rounded-lg border border-gray-200 px-2 text-[13px]" value={who} onChange={(e) => setWho(e.target.value)}>
              <option value="all">Everyone</option>{staff.filter((s) => s.role !== 'manager').map((s) => <option key={s.user_id} value={s.user_id}>{s.name}</option>)}
            </select>
          )}
        </div>
        {!shown.length ? <Empty>{isAds ? 'No paid shops from your checked leads yet. When a shop from a lead you verified pays, it shows here.' : 'No paid shops yet. Share your own sign-up link with every shop you talk to: when a shop pays, it shows here.'}</Empty> : (
          <ul className="divide-y divide-gray-100">
            {shown.map((r) => {
              const st = INCENTIVE_STATUS[r.status] || INCENTIVE_STATUS.waiting;
              return (
                <li key={`${r.lead_id}:${r.staff_id}`} className="px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="flex-1 min-w-[200px]">
                    {isAds ? <span className="font-bold text-gray-900">{r.sales_leads?.shop_name || 'Paid shop'}</span>
                      : <Link to={path(`leads/${r.lead_id}`)} className="font-bold text-gray-900">{r.sales_leads?.shop_name || 'Paid shop'}</Link>}
                    <span className="block text-[12.5px] text-gray-500">Paid {inr(r.paid_amount)} · {r.plan} plan · {dayOf(r.won_at)}{isManager ? ` · ${nameOf(r.staff_id)}` : ''} · {BASIS[r.basis]}</span>
                  </span>
                  <span className="font-extrabold">{inr(r.incentive)}</span>
                  <span className={`text-[12px] font-bold rounded-full px-2.5 py-0.5 ${st.cls}`}>{r.status === 'waiting' ? `Check on ${dayOf(r.due_at)}` : st.label}</span>
                  {isManager && r.status === 'check' && (
                    <span className="flex gap-2"><button type="button" className={btn.smallGreen} onClick={() => act(r, 'earned')}>Still paying: earned</button>
                      <button type="button" className={btn.small} onClick={() => act(r, 'cancelled')}>Stopped: cancel</button></span>
                  )}
                  {isManager && r.status === 'earned' && <button type="button" className={btn.small} onClick={() => act(r, 'paid')}>Mark paid</button>}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

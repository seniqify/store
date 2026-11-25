// Manager: the daily (7 pm) and weekly (Monday) reports, as sent on WhatsApp,
// with each person's numbers. Today's numbers so far are shown live.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCrm } from './crmContext.js';
import { listReports, reportData } from './crmService.js';
import { istDate, istTime, shortDay } from './crmLogic.js';
import { DAILY_TEMPLATE, WEEKLY_TEMPLATE, dailyValues, weeklyValues, fillTemplate } from '../../shared/sales-report-text.mjs';
import { Spinner, Empty, Notice } from './ui.jsx';
import { btn, card } from './crmStyles.js';

const inr = (n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;

function People({ d }) {
  if (!d?.people?.length) return null;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-[620px]">
        <thead><tr className="text-left text-[12px] uppercase tracking-wide text-gray-500">
          <th className="py-2 font-bold">Person</th><th className="py-2 font-bold">Calls (picked up)</th><th className="py-2 font-bold">Visits</th>
          <th className="py-2 font-bold">Demos</th><th className="py-2 font-bold">Paid shops</th><th className="py-2 font-bold">Late follow-ups</th><th className="py-2 font-bold">Days in</th>
        </tr></thead>
        <tbody>
          {d.people.map((p) => (
            <tr key={p.name} className="border-t border-gray-100">
              <td className="py-2 font-bold">{p.name}</td><td className="py-2">{p.calls} ({p.answered})</td><td className="py-2">{p.visits}</td>
              <td className="py-2">{p.demos}</td><td className="py-2 font-bold">{p.paid}</td><td className="py-2">{p.late}</td>
              <td className="py-2">{p.days_in}{d.days === 1 && p.first_login ? ` · in ${istTime(p.first_login)}` : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function CrmReports() {
  const { path } = useCrm();
  const [list, setList] = useState(null);
  const [today, setToday] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    listReports().then(setList);
    const t = istDate();
    reportData(t, t).then(setToday).catch((e) => setErr(e.message));
  }, []);

  if (!list) return <Spinner />;
  return (
    <div className="px-4 lg:px-7 py-5 space-y-4 max-w-5xl">
      <header className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[220px]"><h1 className="text-2xl font-extrabold">Reports</h1>
          <p className="text-sm text-gray-500">Sent on WhatsApp at 7 pm every day and on Monday mornings for the week.</p></div>
        <Link to={`${path('settings')}#reports`} className={btn.ghost}>Report settings</Link>
      </header>
      {err && <Notice>{err}</Notice>}

      {today && (
        <section className={`${card} p-4 space-y-2`}>
          <h2 className="font-extrabold">Today so far</h2>
          <p className="text-[14.5px] text-gray-800">{fillTemplate(DAILY_TEMPLATE, dailyValues(today)).replace(/ Details: .*$/, '')}</p>
          <People d={today} />
        </section>
      )}

      {!list.length ? <Empty>No reports yet. The first daily report is made at 7 pm.</Empty> : list.map((r) => {
        const text = fillTemplate(r.kind === 'weekly' ? WEEKLY_TEMPLATE : DAILY_TEMPLATE, r.kind === 'weekly' ? weeklyValues(r.data) : dailyValues(r.data)).replace(/ Details: .*$/, '');
        const s = r.sent || {};
        return (
          <section key={r.id} className={`${card} p-4 space-y-2`}>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-extrabold flex-1">{r.kind === 'weekly' ? `Week ${shortDay(r.period_from)} – ${shortDay(r.period_to)}` : shortDay(r.period_to)}</h2>
              <span className={`text-[12px] font-bold rounded-full px-2.5 py-0.5 ${s.skipped ? 'bg-amber-100 text-amber-900' : (s.results || []).every((x) => x.ok) ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                {s.skipped ? `Saved, not sent: ${s.skipped}` : (s.results || []).every((x) => x.ok) ? `Sent on WhatsApp · ${istTime(r.created_at)}` : 'WhatsApp failed'}
              </span>
            </div>
            <p className="text-[14.5px] text-gray-800">{text}</p>
            {r.kind === 'weekly' && <p className="text-[13px] text-gray-600">Collected {inr(r.data.collected)} · incentive earned {inr(r.data.incentive_earned)}</p>}
            <details><summary className="text-[13px] font-bold text-green-700 cursor-pointer">Each person</summary><People d={r.data} /></details>
          </section>
        );
      })}
    </div>
  );
}

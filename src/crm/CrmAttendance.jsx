// Attendance. Login time = the first time someone opens the CRM that day;
// field executives also start and end the day with their location. Monthly
// calendar with working days, weekly offs, holidays, late, half day, absent and
// leave. A manager sees everyone, approves leave, sets holidays and can mark a
// day by hand; others see their own month and ask for leave.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useCrm, initials } from './crmContext.js';
import {
  attendanceBetween, listHolidays, addHoliday, removeHoliday, listLeave, askLeave, decideLeave, setAttendanceOverride,
} from './crmService.js';
import { istDate, istTime, monthCalendar, attendancePercent, DAY_STATUS, shortDay, hoursLabel, dayStatus, leaveDaySet } from './crmLogic.js';
import { DayCard } from './CrmToday.jsx';
import { Field, Spinner, Notice, Empty } from './ui.jsx';
import { btn, card, input } from './crmStyles.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const SUMMARY = [['present', 'Present'], ['late', 'Late'], ['half', 'Half day'], ['absent', 'Absent'], ['leave', 'Leave'], ['holiday', 'Holidays'], ['off', 'Weekly offs']];

function Calendar({ cal, onPickDay, today }) {
  return (
    <div>
      <div className="grid grid-cols-7 gap-1.5">
        {WEEK.map((d) => <div key={d} className="text-center text-[11.5px] font-extrabold text-gray-500 py-1">{d}</div>)}
        {cal.cells.map((c, i) => (c ? (
          <button key={c.day} type="button" disabled={!onPickDay} onClick={() => onPickDay?.(c)}
            aria-label={`${c.day}: ${DAY_STATUS[c.status]?.label || 'coming'}`}
            className={`min-h-[64px] rounded-lg p-1.5 text-left flex flex-col ${DAY_STATUS[c.status]?.cls || ''} ${c.day === today ? 'ring-2 ring-gray-900' : ''}`}>
            <span className="text-[13px] font-extrabold">{c.n}</span>
            <span className="text-[10.5px] font-bold leading-tight hidden sm:block">{DAY_STATUS[c.status]?.label}</span>
            {c.inAt && <span className="text-[10.5px] leading-tight">in {istTime(c.inAt)}</span>}
          </button>
        ) : <span key={`b${i}`} />))}
      </div>
      <div className="flex flex-wrap gap-3 mt-3 text-[12px] text-gray-700">
        {['present', 'late', 'half', 'absent', 'leave', 'holiday', 'off'].map((k) => (
          <span key={k} className="inline-flex items-center gap-1.5"><span aria-hidden="true" className={`w-3.5 h-3.5 rounded ${DAY_STATUS[k].cls}`} />{DAY_STATUS[k].label}</span>
        ))}
      </div>
    </div>
  );
}

function downloadCsv(name, rows) {
  const csv = rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export default function CrmAttendance() {
  const { me, staff } = useCrm();
  const today = istDate();
  const [ym, setYm] = useState({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) });
  const [rows, setRows] = useState(null);
  const [holidays, setHolidays] = useState([]);
  const [leave, setLeave] = useState([]);
  const [who, setWho] = useState(me.user_id);
  const [err, setErr] = useState('');
  const [hol, setHol] = useState({ day: '', name: '' });
  const [ask, setAsk] = useState({ from: '', to: '', reason: '' });
  const [pickDay, setPickDay] = useState(null);
  const isManager = me.role === 'manager';

  const first = `${ym.y}-${String(ym.m).padStart(2, '0')}-01`;
  const last = `${ym.y}-${String(ym.m).padStart(2, '0')}-${new Date(Date.UTC(ym.y, ym.m, 0)).getUTCDate()}`;

  const load = useCallback(async () => {
    const lo = first < today ? first : today;
    const [r, h, l] = await Promise.all([attendanceBetween(lo, last > today ? last : today), listHolidays(), listLeave()]);
    setRows(r); setHolidays(h); setLeave(l);
  }, [first, last, today]);
  useEffect(() => { load(); }, [load]);

  const run = async (fn) => { setErr(''); try { await fn(); await load(); } catch (e) { setErr(e.message); } };
  const person = staff.find((s) => s.user_id === who) || me;
  const cal = useMemo(() => (rows ? monthCalendar({ year: ym.y, month: ym.m, today, staff: person, rows, holidays, leaves: leave }) : null),
    [rows, ym, today, person, holidays, leave]);
  const holidaySet = useMemo(() => new Set(holidays.map((h) => h.day)), [holidays]);
  const shiftMonth = (d) => setYm(({ y, m }) => { const n = m + d; return n < 1 ? { y: y - 1, m: 12 } : n > 12 ? { y: y + 1, m: 1 } : { y, m: n }; });

  if (!rows || !cal) return <Spinner />;
  const pct = attendancePercent(cal.counts, cal.workedSoFar, cal.leaveSoFar);
  const myRow = rows.find((r) => r.staff_id === me.user_id && r.day === today);

  const exportMonth = () => {
    const header = ['Name', 'Role', ...cal.cells.filter(Boolean).map((c) => c.day), 'Working days', 'Present', 'Late', 'Half day', 'Absent', 'Leave'];
    const lines = staff.filter((s) => s.active).map((s) => {
      const c = monthCalendar({ year: ym.y, month: ym.m, today, staff: s, rows, holidays, leaves: leave });
      return [s.name, s.role, ...c.cells.filter(Boolean).map((x) => `${DAY_STATUS[x.status]?.label || ''}${x.inAt ? ` ${istTime(x.inAt)}` : ''}`),
        c.workingDays, c.counts.present, c.counts.late, c.counts.half, c.counts.absent, c.counts.leave];
    });
    downloadCsv(`attendance-${first.slice(0, 7)}.csv`, [header, ...lines]);
  };

  return (
    <div className="px-4 lg:px-7 py-5 space-y-4">
      <header className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[220px]"><h1 className="text-2xl font-extrabold">{isManager ? 'Attendance' : 'My attendance'}</h1>
          <p className="text-sm text-gray-500">Login time is the first time you open the CRM that day.</p></div>
        {isManager && <button type="button" className={btn.ghost} onClick={exportMonth}>Download month (Excel)</button>}
      </header>
      {err && <Notice>{err}</Notice>}

      {!isManager && <DayCard me={me} row={myRow} onChanged={load} />}

      {isManager && (
        <section aria-label="Today" className={`${card} overflow-hidden`}>
          <h2 className="px-4 pt-3 pb-2 font-extrabold">Today · {shortDay(today)}</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[760px]">
              <thead><tr className="text-left text-[12px] uppercase tracking-wide text-gray-500">
                <th className="px-4 py-2 font-bold">Person</th><th className="px-2 py-2 font-bold">Today</th><th className="px-2 py-2 font-bold">Logged in</th>
                <th className="px-2 py-2 font-bold">Day started / ended</th><th className="px-2 py-2 font-bold">Last active</th><th className="px-4 py-2 font-bold">Shift · weekly off</th>
              </tr></thead>
              <tbody>
                {staff.filter((s) => s.active).map((s) => {
                  const r = rows.find((x) => x.staff_id === s.user_id && x.day === today);
                  const st = dayStatus({ day: today, today, staff: s, row: r, holidays: holidaySet, leaveDays: leaveDaySet(leave, s.user_id) });
                  return (
                    <tr key={s.user_id} className="border-t border-gray-100">
                      <td className="px-4 py-3"><div className="flex items-center gap-2.5"><span aria-hidden="true" className="w-8 h-8 rounded-full bg-blue-100 text-blue-800 grid place-items-center text-[11px] font-extrabold">{initials(s.name)}</span>
                        <div><div className="font-bold">{s.name}</div><div className="text-[12px] text-gray-500">{s.role}</div></div></div></td>
                      <td className="px-2 py-3"><span className={`text-[12px] font-bold rounded-full px-2 py-0.5 ${DAY_STATUS[st]?.cls}`}>{DAY_STATUS[st]?.label}</span></td>
                      <td className="px-2 py-3 font-bold">{istTime(r?.first_seen_at) || '—'}</td>
                      <td className="px-2 py-3">{r?.day_start_at ? `${istTime(r.day_start_at)}${r.day_end_at ? ` – ${istTime(r.day_end_at)}` : ''}` : '—'}
                        {r?.day_start_at && <div className="text-[12px] text-gray-500">{hoursLabel(r.day_start_at, r.day_end_at || new Date().toISOString())}</div>}</td>
                      <td className="px-2 py-3 text-gray-700">{istTime(r?.last_seen_at) || '—'}</td>
                      <td className="px-4 py-3 text-[13px] text-gray-700">{String(s.shift_start).slice(0, 5)} – {String(s.shift_end).slice(0, 5)} · {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][s.weekly_off]}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="flex flex-col xl:flex-row gap-4 items-start">
        <section aria-label="Month" className={`${card} flex-1 min-w-0 w-full p-4 space-y-3`}>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" aria-label="Previous month" className={btn.small} onClick={() => shiftMonth(-1)}>‹</button>
            <h2 className="text-lg font-extrabold">{MONTHS[ym.m - 1]} {ym.y}</h2>
            <button type="button" aria-label="Next month" className={btn.small} onClick={() => shiftMonth(1)}>›</button>
            <span className="flex-1" />
            {isManager && (
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Person">
                {staff.filter((s) => s.active).map((s) => (
                  <button key={s.user_id} type="button" aria-pressed={who === s.user_id} onClick={() => setWho(s.user_id)}
                    className={`h-9 px-3 rounded-full border text-[13px] font-bold ${who === s.user_id ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-200 text-gray-700'}`}>{s.name.split(' ')[0]}</button>
                ))}
              </div>
            )}
          </div>
          <Calendar cal={cal} today={today} onPickDay={isManager ? setPickDay : null} />
          {isManager && pickDay && (
            <div className="border border-gray-200 rounded-xl p-3 flex flex-wrap items-center gap-2">
              <span className="text-sm font-bold">{person.name} · {shortDay(pickDay.day)}:</span>
              {['present', 'late', 'half', 'absent', 'leave'].map((k) => (
                <button key={k} type="button" className={btn.small} onClick={() => run(async () => { await setAttendanceOverride(person.user_id, pickDay.day, k); setPickDay(null); })}>{DAY_STATUS[k].label}</button>
              ))}
              <button type="button" className={btn.small} onClick={() => run(async () => { await setAttendanceOverride(person.user_id, pickDay.day, null); setPickDay(null); })}>Automatic</button>
            </div>
          )}
        </section>

        <aside className="w-full xl:w-[380px] shrink-0 space-y-4">
          <section aria-label="Summary" className={`${card} p-4`}>
            <h2 className="font-extrabold">{person.name} · {MONTHS[ym.m - 1]}</h2>
            <p className="text-[13px] text-gray-500 mt-0.5">{cal.workingDays} working days · {cal.workedSoFar} so far</p>
            <div className="flex items-baseline gap-2 mt-2"><span className="text-3xl font-extrabold">{pct == null ? '—' : `${pct}%`}</span><span className="text-[13px] text-gray-500 font-semibold">attendance so far</span></div>
            <div className="grid grid-cols-2 gap-2 mt-3">
              <div className="rounded-lg bg-gray-50 px-3 py-2"><div className="text-[12px] font-bold text-gray-600">Working days</div><div className="text-lg font-extrabold">{cal.workingDays}</div></div>
              {SUMMARY.map(([k, label]) => (
                <div key={k} className={`rounded-lg px-3 py-2 ${DAY_STATUS[k].cls}`}><div className="text-[12px] font-bold">{label}</div><div className="text-lg font-extrabold">{cal.counts[k]}</div></div>
              ))}
            </div>
          </section>

          <section aria-label="Leave" className={`${card} p-4 space-y-3`}>
            <h2 className="font-extrabold">{isManager ? 'Leave requests' : 'Ask for leave'}</h2>
            {!isManager && (
              <div className="grid grid-cols-2 gap-2">
                <Field label="From" htmlFor="lf"><input id="lf" type="date" className={input} value={ask.from} onChange={(e) => setAsk({ ...ask, from: e.target.value, to: ask.to || e.target.value })} /></Field>
                <Field label="To" htmlFor="lt"><input id="lt" type="date" className={input} value={ask.to} onChange={(e) => setAsk({ ...ask, to: e.target.value })} /></Field>
                <div className="col-span-2"><Field label="Reason" htmlFor="lr"><input id="lr" className={input} value={ask.reason} onChange={(e) => setAsk({ ...ask, reason: e.target.value })} /></Field></div>
                <button type="button" className={`${btn.primary} col-span-2`} disabled={!ask.from || !ask.to || ask.to < ask.from}
                  onClick={() => run(async () => { await askLeave(me.user_id, ask.from, ask.to, ask.reason.trim() || null); setAsk({ from: '', to: '', reason: '' }); })}>Ask for leave</button>
              </div>
            )}
            {!leave.length ? <Empty>No leave requests.</Empty> : (
              <ul className="divide-y divide-gray-100">
                {leave.slice(0, 15).map((l) => (
                  <li key={l.id} className="py-2.5">
                    <div className="text-sm font-bold">{isManager ? `${staff.find((s) => s.user_id === l.staff_id)?.name || ''} · ` : ''}{shortDay(l.from_day)}{l.to_day !== l.from_day ? ` – ${shortDay(l.to_day)}` : ''}</div>
                    {l.reason && <div className="text-[13px] text-gray-700">{l.reason}</div>}
                    {l.status === 'pending' && isManager ? (
                      <div className="flex gap-2 mt-1.5">
                        <button type="button" className={btn.smallGreen} onClick={() => run(() => decideLeave(l.id, 'approved', me.user_id))}>Approve</button>
                        <button type="button" className={btn.small} onClick={() => run(() => decideLeave(l.id, 'rejected', me.user_id))}>Reject</button>
                      </div>
                    ) : <div className={`text-[12.5px] font-bold mt-0.5 ${l.status === 'approved' ? 'text-green-700' : l.status === 'rejected' ? 'text-red-700' : 'text-amber-700'}`}>{l.status === 'pending' ? 'Waiting for the manager' : l.status === 'approved' ? 'Approved' : 'Not approved'}</div>}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-label="Holidays" className={`${card} p-4 space-y-2`}>
            <h2 className="font-extrabold">Holidays</h2>
            {!holidays.length ? <p className="text-sm text-gray-500">No holidays added yet.</p> : (
              <ul className="divide-y divide-gray-100">
                {holidays.filter((h) => h.day >= `${ym.y}-01-01`).slice(0, 20).map((h) => (
                  <li key={h.day} className="py-2 flex items-center gap-3 text-sm">
                    <span className="w-28 font-bold text-violet-900">{shortDay(h.day)}</span><span className="flex-1">{h.name}</span>
                    {isManager && <button type="button" className="text-[12.5px] font-bold text-red-700" onClick={() => run(() => removeHoliday(h.day))}>Remove</button>}
                  </li>
                ))}
              </ul>
            )}
            {isManager && (
              <div className="flex gap-2 pt-1">
                <input aria-label="Holiday date" type="date" className={`${input} w-40`} value={hol.day} onChange={(e) => setHol({ ...hol, day: e.target.value })} />
                <input aria-label="Holiday name" className={input} placeholder="e.g. Diwali" value={hol.name} onChange={(e) => setHol({ ...hol, name: e.target.value })} />
                <button type="button" className={btn.dark} disabled={!hol.day || !hol.name.trim()} onClick={() => run(async () => { await addHoliday(hol.day, hol.name.trim()); setHol({ day: '', name: '' }); })}>Add</button>
              </div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

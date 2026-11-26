// Today. A manager sees the team: who is in and when they logged in, calls and
// visits so far, late follow-ups, wins this month, and what needs them. Anyone
// else sees their own day: login time, start / end of day, what to do next.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCrm, initials } from './crmContext.js';
import { listLeads, activitiesSince, attendanceBetween, getLocation, startOrEndDay, listLeave, listQuestions, workDays } from './crmService.js';
import { pendingWins } from './crmService.js';
import MyLinkCard from './CrmMyLink.jsx';
import { AdsToday } from './CrmCheckLeads.jsx';
import { istDate, istInstant, istTime, buildQueue, dueLabel, followupColumns, shortDay, hoursLabel, dayStatus, DAY_STATUS, workRule, workLine, quietNow, minutesLabel, fieldGapLine, roleNeed } from './crmLogic.js';
import { Icon, Spinner, Notice } from './ui.jsx';
import { btn, card } from './crmStyles.js';

function Stat({ label, value, sub }) {
  return (
    <div className={`${card} px-4 py-3`}>
      <div className="text-[11.5px] font-bold uppercase tracking-wide text-gray-500">{label}</div>
      <div className="text-2xl font-extrabold mt-0.5">{value}</div>
      {sub && <div className="text-[12.5px] text-gray-500 mt-0.5">{sub}</div>}
    </div>
  );
}

export function DayCard({ me, row, onChanged, work, rule }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const act = async (action) => {
    setBusy(true); setErr('');
    try { await startOrEndDay(action, await getLocation()); await onChanged(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const started = row?.day_start_at;
  const ended = row?.day_end_at;
  return (
    <div className="bg-[#0f1f18] text-white rounded-2xl p-4 space-y-2">
      <div className="text-[13px] text-green-200 font-bold">{shortDay(istDate())}</div>
      <div className="text-lg font-extrabold">
        {ended ? `${istTime(started || row.first_seen_at)} – ${istTime(ended)} · ${hoursLabel(started || row.first_seen_at, ended)}`
          : started ? `Day started ${istTime(started)} · ${hoursLabel(started, new Date().toISOString())}`
          : row?.first_seen_at ? `Logged in ${istTime(row.first_seen_at)}` : 'Not in yet'}
      </div>
      {work && <div className="text-[13px] font-semibold text-green-100">Today: {workLine(me.role, work, rule)}</div>}
      {rule?.on !== false && rule?.from && rule.from <= istDate() && me.role !== 'manager' && (() => { const n = roleNeed(me.role, rule); return n.key && <p className="text-[12.5px] text-gray-300">A day counts when you reach {n.need} {n.word}{n.hours ? ` and ${n.hours} h active` : ''}. Logging in alone does not.</p>; })()}
      {me.role === 'field' && (
        <button type="button" disabled={busy} onClick={() => act(started && !ended ? 'end' : 'start')}
          className={`inline-flex items-center justify-center w-full h-11 rounded-xl text-sm font-bold disabled:opacity-60 ${started && !ended ? 'bg-white text-gray-900' : 'bg-green-500 text-green-950'}`}>
          {busy ? 'Getting your location…' : started && !ended ? 'End my day' : ended ? 'Start again' : 'Start my day'}
        </button>
      )}
      {me.role === 'field' && !started && <p className="text-[12.5px] text-gray-300">Your location is saved when you start and end the day.</p>}
      {err && <Notice>{err}</Notice>}
    </div>
  );
}

export default function CrmToday() {
  const { me, staff, path, settings } = useCrm();
  const [leads, setLeads] = useState(null);
  const [acts, setActs] = useState([]);
  const [att, setAtt] = useState([]);
  const [leave, setLeave] = useState([]);
  const [qs, setQs] = useState([]);
  const [loadedAt, setLoadedAt] = useState(0);
  const [wins, setWins] = useState([]);
  const [works, setWorks] = useState([]);
  const [notify, setNotify] = useState(() => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission));
  const today = istDate();
  const isManager = me.role === 'manager';

  const load = useCallback(async () => {
    const monthStart = `${today.slice(0, 8)}01`;
    const [ls, as, at, lv, q, wk] = await Promise.all([
      listLeads(), activitiesSince(new Date(istInstant(monthStart)).toISOString()), attendanceBetween(today, today), listLeave(), listQuestions(), workDays(today, today),
    ]);
    setLeads(ls); setActs(as); setAtt(at); setLeave(lv); setQs(q); setWorks(wk); setLoadedAt(Date.now());
    if (me.role === 'manager') setWins(await pendingWins());
  }, [today, me.role]);
  useEffect(() => { load(); }, [load]);
  // A manager's Today stays fresh (who is quiet changes by the minute).
  useEffect(() => {
    if (!isManager) return undefined;
    const t = setInterval(load, 5 * 60000);
    return () => clearInterval(t);
  }, [isManager, load]);
  const rule = useMemo(() => workRule(settings?.work), [settings]);

  const dayStart = istInstant(today);
  const todayActs = useMemo(() => acts.filter((a) => Date.parse(a.created_at) >= dayStart), [acts, dayStart]);
  const count = (xs, f) => xs.filter(f).length;

  const perPerson = useMemo(() => staff.filter((s) => s.active).map((s) => {
    const mine = todayActs.filter((a) => a.staff_id === s.user_id);
    const row = att.find((r) => r.staff_id === s.user_id && r.day === today);
    const late = (leads || []).filter((l) => l.assigned_to === s.user_id && l.stage !== 'won' && l.stage !== 'lost' && l.next_action_at && Date.parse(l.next_action_at) < dayStart).length;
    const won = acts.filter((a) => a.staff_id === s.user_id && a.kind === 'stage' && a.outcome === 'won').length;
    const status = dayStatus({ day: today, today, staff: s, row, holidays: new Set(), leaveDays: new Set(), rules: settings?.work });
    const work = works.find((w) => w.staff_id === s.user_id && w.day === today) || null;
    const quiet = quietNow({ staff: s, row, work, rule, today, now: loadedAt });
    return {
      s, row, late, won, status, work, quiet,
      calls: count(mine, (a) => a.kind === 'call'),
      picked: count(mine, (a) => a.kind === 'call' && !['no_answer', 'wrong_number'].includes(a.outcome)),
      visits: count(mine, (a) => a.kind === 'visit'),
      checked: count(mine, (a) => a.kind === 'system' && String(a.outcome || '').startsWith('checked_')),
    };
  }), [staff, todayActs, att, leads, acts, dayStart, today, settings, works, rule, loadedAt]);

  if (!leads) return <Spinner />;

  if (me.role === 'ads') {
    const row = att.find((r) => r.staff_id === me.user_id && r.day === today);
    return (
      <AdsToday dayCard={<DayCard me={me} row={row} onChanged={load} work={works.find((w) => w.staff_id === me.user_id) || null} rule={rule} />} todayActs={todayActs}
        trainingNotice={me.must_train && !me.qualified_at && settings?.training?.gate !== false && (
          <Link to={path('training')} className="block no-underline"><Notice kind="warn"><b>Start here: your training.</b> Short modules for your role, with screenshots, and a short exam. Check leads opens when you pass.</Notice></Link>
        )} />
    );
  }

  if (!isManager) {
    const mineLeads = leads.filter((l) => l.assigned_to === me.user_id);
    const q = buildQueue(mineLeads);
    const mineToday = todayActs.filter((a) => a.staff_id === me.user_id);
    const row = att.find((r) => r.staff_id === me.user_id && r.day === today);
    const nextUp = [...q.now, ...q.later].slice(0, 5);
    return (
      <div className="px-4 lg:px-7 py-5 max-w-3xl space-y-4">
        <h1 className="text-2xl font-extrabold">Hi {me.name.split(' ')[0]}</h1>
        <DayCard me={me} row={row} onChanged={load} work={works.find((w) => w.staff_id === me.user_id) || null} rule={rule} />
        {me.must_train && !me.qualified_at && settings?.training?.gate !== false && (
          <Link to={path('training')} className="block no-underline"><Notice kind="warn"><b>Start here: your training.</b> Short modules for your role, with screenshots, and a short exam. {me.role === 'field' ? 'Check-ins open' : 'The call queue opens'} when you pass.</Notice></Link>
        )}
        {notify === 'default' && (
          <button type="button" className={`${btn.ghost} w-full`} onClick={async () => { try { setNotify(await Notification.requestPermission()); } catch { setNotify('denied'); } }}>
            <Icon name="bolt" size={16} />Turn on new-lead alerts
          </button>
        )}
        {leave.filter((l) => l.staff_id === me.user_id && l.status !== 'pending' && l.decided_at && loadedAt - Date.parse(l.decided_at) < 7 * 86400000).slice(0, 2).map((l) => (
          <Notice key={l.id} kind={l.status === 'approved' ? 'ok' : 'warn'}>Your leave for {shortDay(l.from_day)}{l.to_day !== l.from_day ? ` – ${shortDay(l.to_day)}` : ''} was {l.status === 'approved' ? 'approved' : 'not approved'}.</Notice>
        ))}
        {qs.filter((q) => q.asked_by === me.user_id && q.answer && q.answered_at && loadedAt - Date.parse(q.answered_at) < 3 * 86400000).slice(0, 2).map((q) => (
          <Link key={q.id} to={path('help')} className="block no-underline"><Notice kind="ok">Your manager answered: “{q.question.slice(0, 80)}”. Tap to read.</Notice></Link>
        ))}
        <div className="grid grid-cols-3 gap-3">
          {me.role === 'field'
            ? <Stat label="Visits" value={count(mineToday, (a) => a.kind === 'visit')} sub={me.daily_target ? `of ${me.daily_target}` : 'today'} />
            : <Stat label="Calls" value={count(mineToday, (a) => a.kind === 'call')} sub={me.daily_target ? `of ${me.daily_target}` : 'today'} />}
          <Stat label="Due now" value={q.now.length} sub="call or visit" />
          <Stat label="New for you" value={q.fresh.length} sub="never contacted" />
        </div>
        <MyLinkCard compact />
        <Link to={path(me.role === 'field' ? 'checkin' : 'queue')} className={`${btn.primary} w-full h-12 text-base`}>
          <Icon name={me.role === 'field' ? 'pin' : 'phone'} />{me.role === 'field' ? 'Check in at a shop' : 'Open my call queue'}
        </Link>
        <section className={`${card} overflow-hidden`}>
          <h2 className="px-4 pt-3 pb-2 font-extrabold">Next up</h2>
          {!nextUp.length ? <p className="px-4 pb-4 text-sm text-gray-500">Nothing due today.</p> : (
            <ul className="divide-y divide-gray-100">
              {nextUp.map((l) => (
                <li key={l.id}><Link to={path(`leads/${l.id}`)} className="flex gap-3 items-center px-4 py-3 text-gray-900 no-underline">
                  <span className="flex-1 min-w-0"><span className="block font-bold truncate">{l.shop_name}</span><span className="block text-[12.5px] text-gray-500">{l.next_action}</span></span>
                  <span className="text-[12px] font-bold text-amber-700">{dueLabel(l.next_action_at)}</span></Link></li>
              ))}
            </ul>
          )}
        </section>
      </div>
    );
  }

  const unassigned = count(leads, (l) => !l.assigned_to && l.stage !== 'won' && l.stage !== 'lost');
  const pendingLeave = leave.filter((l) => l.status === 'pending');
  const waitingQs = qs.filter((q) => !q.answer);
  const notCalled = count(leads, (l) => l.assigned_to && l.stage === 'new' && !l.last_activity_at && Date.parse(l.created_at) < loadedAt - 86400000);
  const late = followupColumns(leads).late.length;
  const inToday = perPerson.filter((p) => p.row?.first_seen_at || p.row?.day_start_at).length;
  return (
    <div className="px-4 lg:px-7 py-5 space-y-4">
      <header className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[220px]"><h1 className="text-2xl font-extrabold">Team today</h1>
          <p className="text-sm text-gray-500">{shortDay(today)} · {inToday} of {perPerson.length} in</p></div>
        <Link to={path('assign')} className={btn.ghost}>Assign leads</Link>
        <Link to={path('add')} className={btn.primary}><Icon name="plus" size={16} />Add lead</Link>
      </header>
      <section className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Stat label="Calls" value={count(todayActs, (a) => a.kind === 'call')} sub={`${count(todayActs, (a) => a.kind === 'call' && !['no_answer', 'wrong_number'].includes(a.outcome))} picked up`} />
        <Stat label="Shop visits" value={count(todayActs, (a) => a.kind === 'visit')} sub="with photo + place" />
        <Stat label="Demos booked" value={count(todayActs, (a) => a.outcome === 'demo' || a.outcome?.endsWith('_demo'))} sub="today" />
        <Stat label="Won" value={count(todayActs, (a) => a.kind === 'stage' && a.outcome === 'won')} sub={`${count(acts, (a) => a.kind === 'stage' && a.outcome === 'won')} this month`} />
        <Stat label="Late follow-ups" value={late} sub="across the team" />
      </section>
      <div className="flex flex-col xl:flex-row gap-4 items-start">
        <section aria-label="Team" className={`${card} flex-1 min-w-0 w-full overflow-hidden`}>
          <h2 className="px-4 pt-3 pb-2 font-extrabold">How each person is doing</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead><tr className="text-left text-[12px] uppercase tracking-wide text-gray-500">
                <th className="px-4 py-2 font-bold">Person</th><th className="px-2 py-2 font-bold">Logged in · last seen</th>
                <th className="px-2 py-2 font-bold">Calls / visits / checks</th><th className="px-2 py-2 font-bold">Late follow-ups</th><th className="px-4 py-2 font-bold">Won this month</th>
              </tr></thead>
              <tbody>
                {perPerson.map(({ s, row, late: lt, won, calls, picked, visits, checked, status, work, quiet }) => (
                  <tr key={s.user_id} className="border-t border-gray-100">
                    <td className="px-4 py-3"><div className="flex items-center gap-2.5">
                      <span aria-hidden="true" className="w-8 h-8 rounded-full bg-blue-100 text-blue-800 grid place-items-center text-[11px] font-extrabold">{initials(s.name)}</span>
                      <div><div className="font-bold">{s.name}</div><div className="text-[12px] text-gray-500">{s.role}</div></div></div></td>
                    <td className="px-2 py-3">
                      <span className={`text-[12px] font-bold rounded-full px-2 py-0.5 ${DAY_STATUS[status]?.cls || ''}`}>{DAY_STATUS[status]?.label || status}</span>
                      <div className="text-[12.5px] text-gray-600 mt-1">{row ? `In ${istTime(row.day_start_at || row.first_seen_at)} · last ${istTime(row.last_seen_at)}` : '—'}</div>
                      {work && <div className="text-[12.5px] text-gray-800 font-semibold mt-0.5">Active {minutesLabel(work.active_min)}{work.last_work_at ? ` · last work ${istTime(work.last_work_at)}` : ''}</div>}
                      {quiet && <div className="text-[12.5px] text-amber-800 font-bold mt-0.5">{quiet.what === 'no visit' ? 'No visit' : 'Quiet'} for {minutesLabel(quiet.min)}</div>}
                      {s.role === 'field' && fieldGapLine(work, rule) && <div className="text-[12.5px] text-amber-800 mt-0.5">{fieldGapLine(work, rule)}</div>}
                    </td>
                    <td className="px-2 py-3 font-semibold">{s.role === 'field' ? `${visits} visits` : s.role === 'ads' ? `${checked} leads checked` : `${calls} calls · ${picked} picked up`}</td>
                    <td className="px-2 py-3"><span className={`font-bold rounded-lg px-2 py-0.5 ${lt ? 'bg-amber-50 text-amber-800' : 'bg-green-50 text-green-800'}`}>{lt ? `${lt} late` : 'None'}</span></td>
                    <td className="px-4 py-3 font-bold">{won}{s.monthly_target ? ` of ${s.monthly_target}` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section aria-label="Needs you" className={`${card} w-full xl:w-[340px] shrink-0 p-4 space-y-3`}>
          <h2 className="font-extrabold">Needs you</h2>
          {unassigned > 0 && (
            <div className="border border-amber-200 bg-amber-50 rounded-xl p-3 flex items-center gap-3">
              <div className="flex-1"><div className="font-bold text-sm">{unassigned} leads not assigned</div><div className="text-[12.5px] text-amber-800">Give them to someone</div></div>
              <Link to={path('assign')} className={btn.dark + ' h-9'}>Assign</Link>
            </div>
          )}
          {wins.length > 0 && (
            <div className="border border-amber-200 bg-amber-50 rounded-xl p-3 flex items-center gap-3">
              <div className="flex-1"><div className="font-bold text-sm">{wins.length} win{wins.length === 1 ? '' : 's'} waiting for proof</div><div className="text-[12.5px] text-amber-800">No payment seen yet</div></div>
              <Link to={path('performance')} className={btn.small}>Check</Link>
            </div>
          )}
          {pendingLeave.length > 0 && (
            <div className="border border-blue-200 bg-blue-50 rounded-xl p-3 flex items-center gap-3">
              <div className="flex-1"><div className="font-bold text-sm">{pendingLeave.length} leave request{pendingLeave.length === 1 ? '' : 's'}</div>
                <div className="text-[12.5px] text-blue-900">{pendingLeave.slice(0, 2).map((l) => `${staff.find((s) => s.user_id === l.staff_id)?.name || ''} · ${shortDay(l.from_day)}`).join(', ')}</div></div>
              <Link to={path('attendance')} className={btn.small}>See</Link>
            </div>
          )}
          {waitingQs.length > 0 && (
            <div className="border border-gray-200 rounded-xl p-3 flex items-center gap-3">
              <div className="flex-1"><div className="font-bold text-sm">{waitingQs.length} question{waitingQs.length === 1 ? '' : 's'} from the team</div><div className="text-[12.5px] text-gray-600 truncate">{waitingQs[0].question}</div></div>
              <Link to={path('help')} className={btn.small}>Answer</Link>
            </div>
          )}
          {notCalled > 0 && (
            <div className="border border-amber-200 bg-amber-50 rounded-xl p-3 flex items-center gap-3">
              <div className="flex-1"><div className="font-bold text-sm">{notCalled} new lead{notCalled === 1 ? '' : 's'} not called for 24 h</div><div className="text-[12.5px] text-amber-800">Given out, but nobody has called yet</div></div>
              <Link to={path('leads')} className={btn.small}>See</Link>
            </div>
          )}
          {perPerson.filter((p) => p.late >= 3).map((p) => (
            <div key={p.s.user_id} className="border border-gray-200 rounded-xl p-3 flex items-center gap-3">
              <div className="flex-1"><div className="font-bold text-sm">{p.s.name} has {p.late} late follow-ups</div></div>
              <Link to={path('followups')} className={btn.small}>See</Link>
            </div>
          ))}
          {perPerson.filter((p) => p.quiet).map((p) => (
            <div key={`q-${p.s.user_id}`} className="border border-amber-200 bg-amber-50 rounded-xl p-3 text-sm">
              <b>{p.s.name}</b>: {p.quiet.what} for {minutesLabel(p.quiet.min)} <span className="text-amber-800">(since {istTime(new Date(p.quiet.since).toISOString())})</span>
            </div>
          ))}
          {perPerson.filter((p) => p.status === 'today' && p.s.role !== 'manager').map((p) => (
            <div key={`in-${p.s.user_id}`} className="border border-gray-200 rounded-xl p-3 text-sm"><b>{p.s.name}</b> has not logged in today.</div>
          ))}
          {!unassigned && !wins.length && !pendingLeave.length && !waitingQs.length && !notCalled && !perPerson.some((p) => p.late >= 3 || p.quiet) && <p className="text-sm text-gray-500">All clear.</p>}
        </section>
      </div>
    </div>
  );
}

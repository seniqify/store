// Performance. Five areas (KPAs): Activity 20%, Reach 15%, Conversion 30%,
// Revenue 25%, Discipline 10%. Each KPI is actual against the person's target
// (Team & targets), up to 100%; monthly targets are counted "by today".
// A manager sees the leaderboard, the KPA grid and each person's KPIs; anyone
// else sees their own score, rank and what to work on.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCrm, initials, ROLE_LABEL } from './crmContext.js';
import { fetchScoreboard, downloadCsv, pendingWins, reviewWin } from './crmService.js';
import { istDate, addDays, KPA, band, rankBoard, periodShare, kpiValue } from './crmLogic.js';
import { PRICE } from '../utils/planLimits.js';
import { Spinner, Notice, Empty } from './ui.jsx';
import { btn, card } from './crmStyles.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const inr = (n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;

/** First and last India date of the month `back` months before today's. */
function monthRange(today, back) {
  let y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7)) - back;
  while (m < 1) { m += 12; y -= 1; }
  const from = `${y}-${String(m).padStart(2, '0')}-01`;
  const to = addDays(m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`, -1);
  return { from, to, label: MONTHS[m - 1] };
}

const heat = (v) => (v == null ? 'bg-gray-100 text-gray-400' : v >= 90 ? 'bg-green-700 text-white' : v >= 75 ? 'bg-green-200 text-green-900' : v >= 60 ? 'bg-amber-200 text-amber-900' : 'bg-red-200 text-red-900');
const bar = (v) => (v >= 90 ? 'bg-green-600' : v >= 75 ? 'bg-green-400' : v >= 60 ? 'bg-amber-500' : 'bg-red-500');

function BandPill({ score }) {
  const b = band(score);
  return <span className={`inline-block text-[12px] font-bold rounded-full px-2.5 py-0.5 ${b.cls}`}>{b.label}</span>;
}

function Trend({ now, before }) {
  if (now == null || before == null) return <span className="text-gray-400">—</span>;
  const d = now - before;
  return <span className={`font-bold ${d >= 0 ? 'text-green-700' : 'text-red-700'}`}>{d >= 0 ? '+' : ''}{d}</span>;
}

/** One person's KPA / KPI table. */
function KpiTable({ p }) {
  return (
    <>
    {/* Phone: one block per area, no sideways scrolling. */}
    <ul className="sm:hidden divide-y divide-gray-200">
      {KPA.map((a) => (
        <li key={a.key} className="px-4 py-3 space-y-2">
          <div className="flex items-center gap-2"><span className="font-extrabold flex-1">{a.label} <span className="text-gray-500 font-bold text-[12.5px]">· {a.weight}%</span></span>
            <span className={`min-w-[40px] text-center rounded-md px-2 py-0.5 text-[13px] font-extrabold ${heat(p.kpa[a.key])}`}>{p.kpa[a.key] ?? '—'}</span></div>
          {p.kpis.filter((k) => k.kpa === a.key).map((k) => (
            <div key={k.key}>
              <div className="flex items-baseline gap-2 text-[13.5px]"><span className="flex-1">{k.label}</span>
                <span className="font-bold">{kpiValue(k.kind, k.actual)}</span><span className="text-gray-500">/ {kpiValue(k.kind, k.target)}</span></div>
              {k.pct == null ? <div className="text-[12px] text-gray-400">no data yet</div> : (
                <div className="flex items-center gap-2 mt-1"><div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className={`h-full ${bar(k.pct)}`} style={{ width: `${k.pct}%` }} /></div><span className="text-[12px] font-bold w-9 text-right">{k.pct}%</span></div>
              )}
            </div>
          ))}
        </li>
      ))}
    </ul>
    <div className="hidden sm:block overflow-x-auto">
      <table className="w-full text-sm min-w-[640px]">
        <thead><tr className="text-left text-[12px] uppercase tracking-wide text-gray-500">
          <th className="px-3 py-2 font-bold">Area · weight</th><th className="px-2 py-2 font-bold">KPI</th><th className="px-2 py-2 font-bold">Target</th>
          <th className="px-2 py-2 font-bold">Actual</th><th className="px-2 py-2 font-bold w-40">Achieved</th><th className="px-3 py-2 font-bold text-right">Area score</th>
        </tr></thead>
        <tbody>
          {KPA.map((a) => p.kpis.filter((k) => k.kpa === a.key).map((k, i) => (
            <tr key={k.key} className={i === 0 ? 'border-t border-gray-200' : ''}>
              <td className="px-3 py-2 font-bold align-top">{i === 0 ? `${a.label} · ${a.weight}%` : ''}</td>
              <td className="px-2 py-2">{k.label}</td>
              <td className="px-2 py-2 text-gray-700">{kpiValue(k.kind, k.target)}
                {(k.kind === 'count' || k.kind === 'money') && k.target !== k.full && <span className="block text-[11.5px] text-gray-500">by today · {kpiValue(k.kind, k.full)} a month</span>}</td>
              <td className="px-2 py-2 font-bold">{kpiValue(k.kind, k.actual)}</td>
              <td className="px-2 py-2">{k.pct == null ? <span className="text-[12.5px] text-gray-400">no data yet</span> : (
                <div className="flex items-center gap-2"><div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden"><div className={`h-full ${bar(k.pct)}`} style={{ width: `${k.pct}%` }} /></div><span className="text-[12.5px] font-bold w-10 text-right">{k.pct}%</span></div>
              )}</td>
              <td className="px-3 py-2 text-right font-extrabold">{i === 0 ? (p.kpa[a.key] ?? '—') : ''}</td>
            </tr>
          )))}
        </tbody>
      </table>
    </div>
    </>
  );
}

function Advice({ p }) {
  if (!p.weakest) return null;
  const w = p.weakest, s = p.strongest;
  return (
    <div className="grid sm:grid-cols-2 gap-3">
      {s && s !== w && <div className="rounded-xl bg-green-50 border border-green-200 p-3 text-sm"><b className="text-green-800">Strong at</b><div>{s.label}: {kpiValue(s.kind, s.actual)} against {kpiValue(s.kind, s.target)}.</div></div>}
      <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm"><b className="text-amber-900">Work on</b><div>{w.label}: {kpiValue(w.kind, w.actual)} of {kpiValue(w.kind, w.target)}. This is the biggest gap to a higher score.</div></div>
    </div>
  );
}

export default function CrmPerformance() {
  const { me, settings, path, nameOf } = useCrm();
  const today = istDate();
  const [back, setBack] = useState(0);
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [sel, setSel] = useState(null);
  const [pending, setPending] = useState([]);
  const [reload, setReload] = useState(0);
  const isManager = me.role === 'manager';
  const perPaid = Number(settings?.incentive?.per_paid) || 0;

  const cur = monthRange(today, back);
  const prev = monthRange(today, back + 1);
  useEffect(() => {
    let alive = true;
    setData(null); setErr('');
    Promise.all([fetchScoreboard(cur.from, cur.to), fetchScoreboard(prev.from, prev.to)])
      .then(([a, b]) => { if (alive) setData({ now: a, before: b }); })
      .catch((e) => { if (alive) { setErr(e.message); setData({ now: [], before: [] }); } });
    if (isManager) pendingWins().then((p) => { if (alive) setPending(p); });
    return () => { alive = false; };
  }, [cur.from, cur.to, prev.from, prev.to, isManager, reload]);

  const board = useMemo(() => (data ? rankBoard(data.now, { share: periodShare(cur.from, cur.to, today), price: PRICE.monthly }) : []), [data, cur.from, cur.to, today]);
  const lastScore = useMemo(() => {
    const m = new Map();
    if (data) for (const p of rankBoard(data.before, { share: 1, price: PRICE.monthly })) m.set(p.row.user_id, p.score);
    return m;
  }, [data]);

  if (!data) return <Spinner />;
  const daysLeft = back === 0 ? Math.max(0, Math.round((Date.parse(`${cur.to}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000)) : 0;
  const periodPicker = (
    <div className="flex gap-1.5" role="group" aria-label="Period">
      {[[0, 'This month'], [1, 'Last month']].map(([k, label]) => (
        <button key={k} type="button" aria-pressed={back === k} onClick={() => setBack(k)}
          className={`h-9 px-3 rounded-full border text-[13px] font-bold ${back === k ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-200 text-gray-700'}`}>{label}</button>
      ))}
    </div>
  );

  if (!isManager) {
    const p = board.find((x) => x.row.user_id === me.user_id);
    return (
      <div className="px-4 lg:px-7 py-5 max-w-3xl space-y-4">
        <header className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-extrabold flex-1">My performance · {cur.label}</h1>{periodPicker}
        </header>
        {err && <Notice>{err}</Notice>}
        {!p ? <Empty>Your score starts with your first call or visit.</Empty> : (
          <>
            <section className="bg-[#0f1f18] text-white rounded-2xl p-5 space-y-3">
              <div className="flex items-end gap-3">
                <span className="text-5xl font-extrabold leading-none">{p.score ?? '—'}</span>
                <div className="pb-1"><BandPill score={p.score} />
                  <div className="text-[13px] text-green-100 mt-1">Rank {p.rank} of {board.length}{lastScore.has(me.user_id) && p.score != null && lastScore.get(me.user_id) != null ? ` · ${p.score - lastScore.get(me.user_id) >= 0 ? 'up' : 'down'} ${Math.abs(p.score - lastScore.get(me.user_id))} from ${prev.label}` : ''}</div></div>
              </div>
              <div className="relative h-2.5 rounded-full bg-gradient-to-r from-red-400 via-amber-300 to-green-500" aria-hidden="true">
                {p.score != null && <span className="absolute -top-1 w-1.5 h-[18px] rounded bg-white shadow" style={{ left: `calc(${Math.min(100, p.score)}% - 3px)` }} />}
              </div>
              <div className="flex justify-between text-[11.5px] text-green-100"><span>0</span><span>60</span><span>75</span><span>90 Excellent</span></div>
              {back === 0 && <p className="text-[12.5px] text-green-100">{daysLeft} days left this month. Monthly targets are counted by today, so the score is fair on any day.</p>}
            </section>
            {p.row.pending_wins > 0 && <Notice kind="warn">{p.row.pending_wins} win{p.row.pending_wins === 1 ? '' : 's'} waiting for proof. {p.row.pending_wins === 1 ? 'It counts' : 'They count'} once PocketLink sees the payment, or your manager approves.</Notice>}
            <Advice p={p} />
            <section className={`${card} overflow-hidden`}><h2 className="px-4 pt-3 pb-1 font-extrabold">My 5 areas</h2><KpiTable p={p} /></section>
            {perPaid > 0 && (
              <section className={`${card} p-4 flex items-center gap-3`}>
                <div className="flex-1"><div className="font-extrabold">Incentive so far</div><div className="text-[13px] text-gray-500">{inr(perPaid)} for each paid shop{settings?.incentive?.pay_day ? ` · paid ${settings.incentive.pay_day}` : ''}</div></div>
                <div className="text-2xl font-extrabold">{inr(p.row.won * perPaid)}</div>
              </section>
            )}
          </>
        )}
      </div>
    );
  }

  const chosen = board.find((x) => x.row.user_id === sel) || board[0];
  const scored = board.filter((p) => p.score != null);
  const teamScore = scored.length ? Math.round(scored.reduce((s, p) => s + p.score, 0) / scored.length) : null;
  const sum = (f) => board.reduce((s, p) => s + (Number(f(p)) || 0), 0);
  const paidTarget = sum((p) => p.kpis.find((k) => k.key === 'paid')?.full);
  const moneyTarget = sum((p) => p.kpis.find((k) => k.key === 'money')?.full);
  const demos = sum((p) => p.row.demos), won = sum((p) => p.row.won);
  const open = sum((p) => p.row.open_followups), late = sum((p) => p.row.late_followups);

  const exportReport = () => {
    const keys = [...new Set(board.flatMap((p) => p.kpis.map((k) => k.key)))];
    const header = ['Rank', 'Name', 'Role', 'Score', 'Band', ...KPA.map((a) => `${a.label} (${a.weight}%)`), 'Paid shops', 'Money collected', ...keys];
    const lines = board.map((p) => [p.rank, p.row.name, ROLE_LABEL[p.row.role], p.score ?? '', band(p.score).label, ...KPA.map((a) => p.kpa[a.key] ?? ''),
      p.row.won, p.row.money, ...keys.map((k) => { const x = p.kpis.find((y) => y.key === k); return x ? `${kpiValue(x.kind, x.actual)} / ${kpiValue(x.kind, x.target)}` : ''; })]);
    downloadCsv(`performance-${cur.from.slice(0, 7)}.csv`, [header, ...lines]);
  };

  return (
    <div className="px-4 lg:px-7 py-5 space-y-4">
      <header className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[220px]"><h1 className="text-2xl font-extrabold">Performance · {cur.label}</h1>
          <p className="text-sm text-gray-500">From calls, visits and wins. {back === 0 ? `${daysLeft} days left. Monthly targets are counted by today.` : 'The full month.'}</p></div>
        {periodPicker}
        <button type="button" className={btn.ghost} onClick={exportReport} disabled={!board.length}>Download report</button>
      </header>
      {err && <Notice>{err}</Notice>}
      {!board.length ? <Empty>No callers or field executives yet. Add them in <Link to={path('team')} className="font-bold">Team &amp; targets</Link>.</Empty> : (
        <>
          <section className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <div className={`${card} px-4 py-3`}><div className="text-[11.5px] font-bold uppercase tracking-wide text-gray-500">Team score</div>
              <div className="text-2xl font-extrabold mt-0.5">{teamScore ?? '—'}</div><BandPill score={teamScore} /></div>
            <div className={`${card} px-4 py-3`}><div className="text-[11.5px] font-bold uppercase tracking-wide text-gray-500">Paid shops</div>
              <div className="text-2xl font-extrabold mt-0.5">{won}</div><div className="text-[12.5px] text-gray-500">of {Math.round(paidTarget)} this month</div></div>
            <div className={`${card} px-4 py-3`}><div className="text-[11.5px] font-bold uppercase tracking-wide text-gray-500">Money collected</div>
              <div className="text-2xl font-extrabold mt-0.5">{inr(sum((p) => p.row.money))}</div><div className="text-[12.5px] text-gray-500">of {inr(moneyTarget)} target</div></div>
            <div className={`${card} px-4 py-3`}><div className="text-[11.5px] font-bold uppercase tracking-wide text-gray-500">Demo to won</div>
              <div className="text-2xl font-extrabold mt-0.5">{demos ? `${Math.round((won / demos) * 100)}%` : '—'}</div><div className="text-[12.5px] text-gray-500">{won} won from {demos} demos</div></div>
            <div className={`${card} px-4 py-3`}><div className="text-[11.5px] font-bold uppercase tracking-wide text-gray-500">Follow-ups on time</div>
              <div className="text-2xl font-extrabold mt-0.5">{open ? `${Math.round(100 - (late / open) * 100)}%` : '—'}</div><div className="text-[12.5px] text-gray-500">{late} late of {open}</div></div>
          </section>

          <div className="flex flex-col xl:flex-row gap-4 items-start">
            <section aria-label="Leaderboard" className={`${card} flex-1 min-w-0 w-full overflow-hidden`}>
              <h2 className="px-4 pt-3 pb-1 font-extrabold">Leaderboard</h2>
              <p className="px-4 pb-2 text-[12.5px] text-gray-500">Click a person to see their KPIs.</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[640px]">
                  <thead><tr className="text-left text-[12px] uppercase tracking-wide text-gray-500">
                    <th className="px-4 py-2 font-bold">#</th><th className="px-2 py-2 font-bold">Person</th><th className="px-2 py-2 font-bold">Score</th>
                    <th className="px-2 py-2 font-bold">vs {prev.label.slice(0, 3)}</th><th className="px-2 py-2 font-bold">Paid shops</th><th className="px-2 py-2 font-bold">Collected</th>
                    {perPaid > 0 && <th className="px-4 py-2 font-bold">Incentive</th>}
                  </tr></thead>
                  <tbody>
                    {board.map((p) => (
                      <tr key={p.row.user_id} onClick={() => setSel(p.row.user_id)} className={`border-t border-gray-100 cursor-pointer ${chosen?.row.user_id === p.row.user_id ? 'bg-green-50' : 'hover:bg-gray-50'}`}>
                        <td className="px-4 py-3 font-extrabold">{p.rank}</td>
                        <td className="px-2 py-3"><button type="button" className="flex items-center gap-2.5 text-left" onClick={() => setSel(p.row.user_id)}>
                          <span aria-hidden="true" className="w-8 h-8 rounded-full bg-blue-100 text-blue-800 grid place-items-center text-[11px] font-extrabold">{initials(p.row.name)}</span>
                          <span><span className="block font-bold">{p.row.name}</span><span className="block text-[12px] text-gray-500">{ROLE_LABEL[p.row.role]}</span></span></button></td>
                        <td className="px-2 py-3"><span className="font-extrabold text-base mr-2">{p.score ?? '—'}</span><BandPill score={p.score} /></td>
                        <td className="px-2 py-3"><Trend now={p.score} before={lastScore.get(p.row.user_id)} /></td>
                        <td className="px-2 py-3 font-bold">{p.row.won}{p.row.pending_wins > 0 && <span className="block text-[11.5px] font-semibold text-amber-700">+{p.row.pending_wins} waiting</span>}</td>
                        <td className="px-2 py-3">{inr(p.row.money)}</td>
                        {perPaid > 0 && <td className="px-4 py-3 font-bold">{inr(p.row.won * perPaid)}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!perPaid && <p className="px-4 py-3 text-[12.5px] text-gray-500 border-t border-gray-100">Set an incentive per paid shop in <Link to={path('team')} className="font-bold">Team &amp; targets</Link> to show it here.</p>}
            </section>

            <section aria-label="Areas at a glance" className={`${card} w-full xl:w-[420px] shrink-0 p-4`}>
              <h2 className="font-extrabold mb-2">Areas at a glance</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead><tr><th className="text-left py-1 font-bold text-gray-500" />{KPA.map((a) => <th key={a.key} className="py-1 px-0.5 font-bold text-gray-500 text-[11.5px]">{a.label}</th>)}</tr></thead>
                  <tbody>
                    {board.map((p) => (
                      <tr key={p.row.user_id}><td className="py-1 pr-2 font-bold whitespace-nowrap">{p.row.name.split(' ')[0]}</td>
                        {KPA.map((a) => <td key={a.key} className="p-0.5"><div className={`rounded-md text-center font-extrabold py-1.5 ${heat(p.kpa[a.key])}`}>{p.kpa[a.key] ?? '—'}</div></td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap gap-3 mt-3 text-[11.5px] text-gray-700">
                {[[95, '90+ Excellent'], [80, '75–89 Good'], [65, '60–74 Needs work'], [10, 'below 60 At risk']].map(([v, l]) => (
                  <span key={l} className="inline-flex items-center gap-1.5"><span aria-hidden="true" className={`w-3 h-3 rounded ${heat(v)}`} />{l}</span>
                ))}
              </div>
            </section>
          </div>

          {pending.length > 0 && (
            <section aria-label="Wins waiting for proof" className={`${card} border-amber-300 overflow-hidden`}>
              <h2 className="px-4 pt-3 pb-1 font-extrabold">Wins waiting for proof · {pending.length}</h2>
              <p className="px-4 pb-2 text-[12.5px] text-gray-500">Marked won, but PocketLink has not seen a payment for the shop. Approve if they paid another way; they count in the score once approved.</p>
              <ul className="divide-y divide-gray-100">
                {pending.map((w) => (
                  <li key={w.lead_id} className="px-4 py-2.5 flex flex-wrap items-center gap-2">
                    <span className="flex-1 min-w-[200px]"><Link to={path(`leads/${w.lead_id}`)} className="font-bold text-gray-900">{w.shop_name}</Link>
                      <span className="block text-[12.5px] text-gray-500">{nameOf(w.staff_id)} · {w.won_plan === 'yearly' ? 'yearly' : 'monthly'} · {w.signed_up ? 'has a shop' : 'no shop made yet'}</span></span>
                    <button type="button" className={btn.smallGreen} onClick={async () => { try { await reviewWin(w.lead_id, true); setReload((n) => n + 1); } catch (e) { setErr(e.message); } }}>Approve</button>
                    <button type="button" className={btn.small} onClick={async () => { try { await reviewWin(w.lead_id, false); setReload((n) => n + 1); } catch (e) { setErr(e.message); } }}>Not paid yet</button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {chosen && (
            <section aria-label="Person" className={`${card} overflow-hidden`}>
              <div className="flex flex-wrap items-center gap-3 px-4 pt-4 pb-2">
                <div className="flex-1 min-w-[200px]"><h2 className="text-lg font-extrabold">{chosen.row.name}</h2>
                  <p className="text-[13px] text-gray-500">{ROLE_LABEL[chosen.row.role]} · rank {chosen.rank} of {board.length}</p></div>
                <span className="text-3xl font-extrabold">{chosen.score ?? '—'}</span><BandPill score={chosen.score} />
              </div>
              <KpiTable p={chosen} />
              <div className="p-4"><Advice p={chosen} /></div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

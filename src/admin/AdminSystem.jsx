// System and switches: platform switches (new sign-ups, a banner on every
// shop dashboard, maintenance), the jobs that run by themselves (Run now,
// Pause), deleted shops on their way to "removed for good", whether every
// server function answers, and which connection keys are set. Changes are
// Owner only; each one asks for a reason and goes in the audit log.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAdmin } from './adminContext.js';
import { switchesList, switchSet, jobsList, jobRun, jobPause, purgeList, systemKeys, systemPing } from './adminService.js';
import { SWITCHES, cronWords, jobLabel, jobWhat, jobState, purgeState, whenLabel, num, canDo } from './adminLogic.js';
import { Icon, Chip, Panel, Spinner, Notice, Empty } from './ui.jsx';
import { btn, input, label, th, td, muted } from './adminStyles.js';

const SUPABASE = 'https://supabase.com/dashboard/project/uoyqbexemoheipwrtkcz';

function Toggle({ on, label: name, disabled, onChange }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={name} disabled={disabled} onClick={onChange}
      className={`relative w-11 h-[26px] flex-none rounded-full border-0 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${on ? 'bg-emerald-500' : 'bg-[#3a4a41]'}`}>
      <span aria-hidden="true" className={`absolute top-[3px] w-5 h-5 rounded-full bg-white transition-[left] ${on ? 'left-[21px]' : 'left-[3px]'}`} />
    </button>
  );
}

function Switches({ owner }) {
  const [rows, setRows] = useState(null);
  const [notes, setNotes] = useState({});
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null);
  const load = useCallback(async () => {
    try {
      const r = await switchesList();
      setRows(r);
      setNotes(Object.fromEntries(r.map((s) => [s.key, s.note || ''])));
    } catch (x) { setMsg({ kind: 'error', text: x.message }); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const okReason = reason.trim().length >= 3;
  const save = async (meta, on, text) => {
    if (on !== undefined && !window.confirm(`${on ? 'Turn on' : 'Turn off'} "${meta.name}"? This changes it for every shop at once.`)) return;
    const cur = rows.find((r) => r.key === meta.key);
    setBusy(meta.key); setMsg(null);
    try {
      await switchSet(meta.key, on ?? cur?.on ?? false, meta.text ? text : null, reason);
      setMsg({ kind: 'ok', text: `Saved: ${meta.name}.` });
      setReason('');
      await load();
    } catch (x) { setMsg({ kind: 'error', text: x.message }); } finally { setBusy(''); }
  };
  return (
    <Panel title="Platform switches" right={<span className={`text-[12.5px] ${muted}`}>{owner ? 'each change asks to confirm and is logged' : 'only the Owner can change these'}</span>}>
      {!rows ? <Spinner /> : (
        <div>
          {owner && (
            <div className="px-4 pt-3.5 max-w-xl">
              <label className={label} htmlFor="sw-why">Reason (needed for any change, goes in the log)</label>
              <input id="sw-why" className={input} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Expo stall is full for today" />
            </div>
          )}
          <ul className="list-none m-0 p-0">
            {SWITCHES.map((meta) => {
              const s = rows.find((r) => r.key === meta.key) || { on: meta.key === 'signups', note: '' };
              const draft = notes[meta.key] ?? '';
              const textChanged = meta.text && draft.trim() !== (s.note || '');
              return (
                <li key={meta.key} className="px-4 py-3.5 border-b border-[#18231d] last:border-b-0">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2"><span className="font-bold text-[14px]">{meta.name}</span><Chip tone={s.on ? (meta.key === 'signups' ? 'ok' : 'warn') : 'off'}>{s.on ? 'On' : 'Off'}</Chip></div>
                      <p className="m-0 mt-1 text-[13px] text-[#8fa69a]">{meta.sub}</p>
                      {s.at && s.by && <p className="m-0 mt-1 text-[12px] text-[#73897d]">Last changed by {s.by}, {whenLabel(s.at)}</p>}
                    </div>
                    <Toggle on={Boolean(s.on)} label={meta.name} disabled={!owner || !okReason || !!busy || (meta.key === 'banner' && !s.on && !draft.trim())}
                      onChange={() => save(meta, !s.on, draft)} />
                  </div>
                  {meta.text && (
                    <div className="mt-2.5 flex flex-wrap gap-2 items-end max-w-2xl">
                      <div className="flex-1 min-w-[220px]">
                        <label className="sr-only" htmlFor={`sw-${meta.key}`}>{meta.name}: text</label>
                        <input id={`sw-${meta.key}`} className={input} maxLength={200} value={draft} disabled={!owner} placeholder={meta.placeholder}
                          onChange={(e) => setNotes({ ...notes, [meta.key]: e.target.value })} />
                      </div>
                      {owner && <button type="button" className={btn.ghost} disabled={!textChanged || !okReason || !!busy} onClick={() => save(meta, undefined, draft)}>{busy === meta.key ? 'Saving…' : 'Save text'}</button>}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {owner && !okReason && <p className={`m-0 px-4 pb-3 text-[12.5px] ${muted}`}>Write a reason above to change a switch.</p>}
          {msg && <div className="px-4 pb-3.5"><Notice kind={msg.kind}>{msg.text}</Notice></div>}
        </div>
      )}
    </Panel>
  );
}

function Jobs({ owner }) {
  const [jobs, setJobs] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null);
  const load = useCallback(async () => { try { setJobs(await jobsList()); } catch (x) { setMsg({ kind: 'error', text: x.message }); } }, []);
  useEffect(() => { load(); }, [load]);
  const okReason = reason.trim().length >= 3;
  const run = async (j) => {
    if (!window.confirm(`Run "${jobLabel(j.name)}" now, once? It does exactly what it does on its schedule.`)) return;
    setBusy(`run-${j.id}`); setMsg(null);
    try {
      const r = await jobRun(j.id, reason);
      setMsg(r?.ok ? { kind: 'ok', text: `Started: ${jobLabel(j.name)}.` } : { kind: 'error', text: `${jobLabel(j.name)} did not start: ${r?.error || 'unknown error'}` });
      setReason('');
      await load();
    } catch (x) { setMsg({ kind: 'error', text: x.message }); } finally { setBusy(''); }
  };
  const pause = async (j) => {
    if (j.active && !window.confirm(`Pause "${jobLabel(j.name)}"? It stops running until you resume it.`)) return;
    setBusy(`pause-${j.id}`); setMsg(null);
    try {
      await jobPause(j.id, !j.active, reason);
      setMsg({ kind: 'ok', text: `${jobLabel(j.name)} is ${j.active ? 'paused' : 'running again'}.` });
      setReason('');
      await load();
    } catch (x) { setMsg({ kind: 'error', text: x.message }); } finally { setBusy(''); }
  };
  const fine = (jobs || []).filter((j) => j.active && j.last_status !== 'failed').length;
  return (
    <Panel title="Jobs that run by themselves" className="overflow-hidden"
      right={jobs && <span className={`text-[12.5px] ${muted}`}>{fine} of {jobs.length} fine · times are India time</span>}>
      {!jobs ? <Spinner /> : !jobs.length ? <Empty>No scheduled jobs found.</Empty> : (
        <>
          {owner && (
            <div className="px-4 pt-3.5 max-w-xl">
              <label className={label} htmlFor="job-why">Reason (needed to run or pause a job, goes in the log)</label>
              <input id="job-why" className={input} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Leads piling up, run the move now" />
            </div>
          )}
          <div className="overflow-x-auto mt-2">
            <table className="w-full border-collapse text-[13.5px]">
              <thead><tr>{['Job', 'When', 'Last run', 'Result', 'Last 24 hours', ...(owner ? [''] : [])].map((h, i) => <th key={i} scope="col" className={th}>{h}</th>)}</tr></thead>
              <tbody>{jobs.map((j) => {
                const st = jobState(j);
                return (
                  <tr key={j.id}>
                    <td className={`${td} whitespace-normal min-w-[220px]`}><div className="font-semibold">{jobLabel(j.name)}</div><div className="text-[12px] text-[#8fa69a]">{jobWhat(j.name) || j.name}</div></td>
                    <td className={td}>{cronWords(j.schedule)}</td>
                    <td className={`${td} text-[#c8d6ce]`}>{j.last_start ? whenLabel(j.last_start) : '—'}</td>
                    <td className={td}><span title={j.last_message || ''}><Chip tone={st.tone}>{st.label}</Chip></span>{j.last_status === 'failed' && j.last_message && <div className="text-[12px] text-red-300 mt-1 max-w-[260px] whitespace-normal break-words">{j.last_message}</div>}</td>
                    <td className={td}>{num(j.runs_24h)} {j.runs_24h === 1 ? 'run' : 'runs'}{j.fails_24h > 0 && <span className="text-red-300"> · {num(j.fails_24h)} failed</span>}</td>
                    {owner && (
                      <td className={td}><div className="flex gap-1.5">
                        <button type="button" className={btn.small} disabled={!okReason || !!busy || !j.active} onClick={() => run(j)}>{busy === `run-${j.id}` ? 'Starting…' : 'Run now'}</button>
                        <button type="button" className={btn.small} disabled={!okReason || !!busy} onClick={() => pause(j)}>{busy === `pause-${j.id}` ? 'Saving…' : j.active ? 'Pause' : 'Resume'}</button>
                      </div></td>
                    )}
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        </>
      )}
      {msg && <div className="px-4 py-3"><Notice kind={msg.kind}>{msg.text}</Notice></div>}
    </Panel>
  );
}

function Removal() {
  const { path } = useAdmin();
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { purgeList().then(setRows).catch((x) => setErr(x.message)); }, []);
  return (
    <Panel title="Deleted shops" className="overflow-hidden"
      right={<span className={`text-[12.5px] ${muted}`}>kept 30 days after delete, then the Owner can remove them for good</span>}>
      {err ? <div className="p-4"><Notice>{err}</Notice></div> : !rows ? <Spinner /> : !rows.length ? <Empty>No deleted shops.</Empty> : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13.5px]">
            <thead><tr>{['Shop', 'Deleted', 'Now', ''].map((h, i) => <th key={i} scope="col" className={th}>{h}</th>)}</tr></thead>
            <tbody>{rows.map((r) => {
              const p = purgeState(r);
              return (
                <tr key={r.slug}>
                  <td className={td}><div className="font-semibold">{r.name || r.slug}</div><div className="text-[12px] text-[#8fa69a]">{r.slug}</div></td>
                  <td className={`${td} text-[#c8d6ce]`}>{whenLabel(r.deleted_at)}</td>
                  <td className={td}><Chip tone={p.tone}>{p.label}</Chip></td>
                  <td className={td}><Link to={`${path(`stores/${r.slug}`)}?tab=danger`} className={btn.small}>{p.key === 'ready' ? 'Open to remove' : 'Open'}</Link></td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function Functions() {
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const check = async () => {
    setBusy(true); setErr('');
    try { setRes((await systemPing()).functions || []); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  const ok = (res || []).filter((f) => f.state === 'ok').length;
  const sorted = [...(res || [])].sort((a, b) => (a.state === 'ok') - (b.state === 'ok') || a.name.localeCompare(b.name));
  const TONE = { ok: ['Answers', 'ok'], missing: ['Not found', 'bad'], failing: ['Not starting', 'bad'] };
  return (
    <Panel title="Server functions" className="overflow-hidden" right={<button type="button" className={btn.small} disabled={busy} onClick={check}>{busy ? 'Checking…' : res ? 'Check again' : 'Check all functions'}</button>}>
      <div className="px-4 py-3 text-[13px] text-[#8fa69a]">
        {res ? <span className={ok === res.length ? 'text-emerald-300 font-semibold' : 'text-red-300 font-semibold'}>{ok} of {res.length} answer.</span> : 'Asks every server function “are you there?”. It does not run anything.'}
        {' '}Calls and error messages: <a href={`${SUPABASE}/functions`} target="_blank" rel="noreferrer">Supabase → Edge Functions</a>.
      </div>
      {err && <div className="px-4 pb-3"><Notice>{err}</Notice></div>}
      {res && (
        <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
          <table className="w-full border-collapse text-[13.5px]">
            <thead><tr>{['Function', 'State', 'Answer time'].map((h) => <th key={h} scope="col" className={th}>{h}</th>)}</tr></thead>
            <tbody>{sorted.map((f) => (
              <tr key={f.name}>
                <td className={`${td} font-mono text-[12.5px]`}>{f.name}</td>
                <td className={td}><Chip tone={TONE[f.state]?.[1] || 'warn'}>{TONE[f.state]?.[0] || f.state}</Chip>{f.state !== 'ok' && f.note && <div className="text-[12px] text-red-300 mt-1 max-w-[280px] whitespace-normal break-words">{f.status ? `${f.status} · ` : ''}{f.note}</div>}</td>
                <td className={`${td} text-[#c8d6ce]`}>{num(f.ms)} ms</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function Keys() {
  const [keys, setKeys] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { systemKeys().then((r) => setKeys(r.keys || [])).catch((x) => setErr(x.message)); }, []);
  const missing = (keys || []).filter((k) => !k.set).length;
  return (
    <Panel title="Connection keys" className="overflow-hidden"
      right={keys && <span className={`text-[12.5px] ${missing ? 'text-amber-300' : muted}`}>{missing ? `${missing} not set` : 'all set'}</span>}>
      <div className="px-4 py-3 text-[13px] text-[#8fa69a]">Values are never shown here. To add or replace one: <a href={`${SUPABASE}/functions/secrets`} target="_blank" rel="noreferrer">Supabase → Edge Functions → Secrets</a>.</div>
      {err ? <div className="px-4 pb-3"><Notice>{err}</Notice></div> : !keys ? <Spinner /> : (
        <ul className="list-none m-0 p-0 max-h-[420px] overflow-y-auto">
          {[...keys].sort((a, b) => a.set - b.set).map((k) => (
            <li key={k.name} className="flex items-center gap-3 px-4 py-2.5 border-t border-[#18231d]">
              <div className="flex-1 min-w-0"><div className="font-mono text-[12.5px] break-all">{k.name}</div><div className="text-[12px] text-[#8fa69a]">{k.use}</div></div>
              <Chip tone={k.set ? 'ok' : 'bad'}>{k.set ? 'Set' : 'Not set'}</Chip>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export default function AdminSystem() {
  const { me, path } = useAdmin();
  const owner = canDo(me.role, 'system');
  return (
    <div className="space-y-5 max-w-[1300px]">
      <header className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[240px]">
          <h1 className="m-0 text-[26px] font-extrabold">System and switches</h1>
          <p className="m-0 mt-1 text-[14px] text-[#8fa69a]">Switches for every shop, the jobs that run by themselves, deleted shops, and the server functions and their keys.</p>
        </div>
        <Link to={path('log')} className={btn.ghost}><Icon name="list" size={16} />Go to the audit log</Link>
      </header>
      {!owner && <Notice kind="warn">You can see everything here. Only the Owner can change a switch, run or pause a job, or remove a shop for good.</Notice>}
      <Switches owner={owner} />
      <Jobs owner={owner} />
      <Removal />
      <div className="flex flex-wrap gap-5 items-start">
        <div className="flex-[1_1_420px] min-w-0"><Functions /></div>
        <div className="flex-[1_1_420px] min-w-0"><Keys /></div>
      </div>
    </div>
  );
}

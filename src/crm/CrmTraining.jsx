// Training: nine modules to read, then a 15-question exam graded on the
// server (sales_exam_submit). New people must pass before they start calling
// or checking in. A manager sees everyone's progress and results.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useCrm, initials } from './crmContext.js';
import { trainingDone, markModuleDone, examStart, examSubmit, examAttempts } from './crmService.js';
import { istTime, shortDay, istDate } from './crmLogic.js';
import { MODULES, EXAM_SIZE } from './crmTraining.js';
import { Icon, Spinner, Notice } from './ui.jsx';
import { btn, card } from './crmStyles.js';

function ModuleView({ m, done, onDone, onBack }) {
  const [busy, setBusy] = useState(false);
  return (
    <article className={`${card} p-5 space-y-4 max-w-3xl`}>
      <button type="button" className="text-sm font-bold text-green-700" onClick={onBack}>← All modules</button>
      <header><h2 className="text-xl font-extrabold">{m.title}</h2><p className="text-[13px] text-gray-500">About {m.minutes} minutes</p></header>
      <p className="text-[15px] text-gray-800">{m.intro}</p>
      {m.sections.map((s) => (
        <section key={s.h} className="space-y-1.5">
          <h3 className="font-extrabold">{s.h}</h3>
          {s.p && <p className="text-[14.5px] leading-relaxed text-gray-800">{s.p}</p>}
          {s.list && <ul className="list-disc pl-5 space-y-1 text-[14.5px] leading-relaxed text-gray-800">{s.list.map((x) => <li key={x}>{x}</li>)}</ul>}
        </section>
      ))}
      <section className="rounded-xl bg-green-50 border border-green-200 p-4">
        <h3 className="font-extrabold text-green-900">Remember</h3>
        <ul className="mt-1 space-y-1 text-[14px] text-green-900">{m.points.map((x) => <li key={x} className="flex gap-2"><Icon name="check" size={16} className="mt-0.5 shrink-0" />{x}</li>)}</ul>
      </section>
      {done ? <Notice kind="ok">You finished this module.</Notice> : (
        <button type="button" className={btn.primary} disabled={busy} onClick={async () => { setBusy(true); try { await onDone(m.key); } finally { setBusy(false); } }}>{busy ? 'Saving…' : 'I have read this'}</button>
      )}
    </article>
  );
}

function Exam({ onFinished }) {
  const [exam, setExam] = useState(null);
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const start = async () => {
    setBusy(true); setErr(''); setResult(null); setAnswers({});
    try { setExam(await examStart()); } catch (e) { setErr(e.message.includes('three tries') ? 'You have used your three tries today. Read the modules again and try tomorrow.' : e.message); } finally { setBusy(false); }
  };
  const submit = async () => {
    setBusy(true); setErr('');
    try { const r = await examSubmit(exam.attempt_id, answers); setResult(r); setExam(null); onFinished?.(r); }
    catch (e) { setErr(e.message.includes('time is up') ? 'Time is up (60 minutes). Start again.' : e.message); } finally { setBusy(false); }
  };

  if (result) {
    const topics = [...new Set((result.wrong || []).map((w) => w.topic))];
    return (
      <section className={`${card} p-5 space-y-3 max-w-3xl`}>
        <h2 className="text-xl font-extrabold">{result.passed ? 'Passed. Well done!' : 'Not passed yet'}</h2>
        <p className="text-[15px]">{result.score} of {result.total} right · pass mark {result.pass_pct}%</p>
        {result.passed ? <Notice kind="ok">You can now use the call queue and check-ins.</Notice>
          : <Notice kind="warn">Read again: {topics.join(', ') || 'the modules'}. You have three tries a day.</Notice>}
        {!result.passed && <button type="button" className={btn.primary} onClick={start} disabled={busy}>Try again</button>}
      </section>
    );
  }
  if (!exam) {
    return (
      <section className={`${card} p-5 space-y-3 max-w-3xl`}>
        <h2 className="text-xl font-extrabold">The exam</h2>
        <p className="text-[14.5px] text-gray-700">{EXAM_SIZE} questions from all the modules, one answer each. 60 minutes, three tries a day. The pass mark is set by your manager (usually 80%).</p>
        {err && <Notice>{err}</Notice>}
        <button type="button" className={btn.primary} onClick={start} disabled={busy}>{busy ? 'Starting…' : 'Start the exam'}</button>
      </section>
    );
  }
  const left = exam.questions.filter((q) => answers[q.id] == null).length;
  return (
    <section className="space-y-3 max-w-3xl">
      {exam.questions.map((q, i) => (
        <fieldset key={q.id} className={`${card} p-4`}>
          <legend className="sr-only">Question {i + 1}</legend>
          <p className="text-[12px] font-bold uppercase tracking-wide text-gray-500">Question {i + 1} · {q.topic}</p>
          <p className="font-bold text-[15px] mt-1">{q.question}</p>
          <div className="mt-2 space-y-1.5">
            {q.options.map((o, k) => (
              <label key={o} className={`flex gap-2.5 items-start rounded-xl border-2 px-3 py-2.5 cursor-pointer text-[14.5px] ${answers[q.id] === k ? 'border-green-700 bg-green-50' : 'border-gray-200'}`}>
                <input type="radio" name={`q${q.id}`} checked={answers[q.id] === k} onChange={() => setAnswers({ ...answers, [q.id]: k })} className="mt-1 accent-green-700" />{o}
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      {err && <Notice>{err}</Notice>}
      <button type="button" className={`${btn.primary} w-full h-12`} disabled={busy || left > 0} onClick={submit}>{busy ? 'Checking…' : left ? `${left} question${left === 1 ? '' : 's'} left` : 'Hand in'}</button>
    </section>
  );
}

export default function CrmTraining() {
  const { me, staff, refreshMe } = useCrm();
  const isManager = me.role === 'manager';
  const [params, setParams] = useSearchParams();
  const [done, setDone] = useState(null);
  const [attempts, setAttempts] = useState([]);
  const [passedNow, setPassedNow] = useState(false);

  const load = useCallback(async () => {
    const [d, a] = await Promise.all([trainingDone(), examAttempts()]);
    setDone(d); setAttempts(a);
  }, []);
  useEffect(() => { load(); }, [load]);

  const mine = useMemo(() => new Set((done || []).filter((d) => d.staff_id === me.user_id).map((d) => d.module)), [done, me.user_id]);
  const open = MODULES.find((m) => m.key === params.get('m'));
  const allRead = MODULES.every((m) => mine.has(m.key));
  const qualified = !!me.qualified_at || passedNow;
  const go = (k) => setParams(k ? { m: k } : {}, { replace: false });

  if (!done) return <Spinner />;
  if (open) {
    return (
      <div className="px-4 lg:px-7 py-5">
        <ModuleView m={open} done={mine.has(open.key)} onBack={() => go(null)}
          onDone={async (k) => { await markModuleDone(me.user_id, k); await load(); const i = MODULES.findIndex((x) => x.key === k); go(MODULES[i + 1]?.key || null); }} />
      </div>
    );
  }
  if (params.get('exam') === '1') {
    return (
      <div className="px-4 lg:px-7 py-5 space-y-3">
        <button type="button" className="text-sm font-bold text-green-700" onClick={() => setParams({})}>← Training</button>
        <Exam onFinished={(r) => { if (r.passed) { setPassedNow(true); refreshMe?.(); } load(); }} />
      </div>
    );
  }

  return (
    <div className="px-4 lg:px-7 py-5 space-y-4">
      <header><h1 className="text-2xl font-extrabold">Training</h1>
        <p className="text-sm text-gray-500">Nine short modules, then a {EXAM_SIZE}-question exam. New team members pass it before they start calling or visiting.</p></header>

      {!isManager && (
        qualified ? <Notice kind="ok"><b>You are qualified.</b> Read the modules again whenever you like.</Notice>
          : me.must_train ? <Notice kind="warn"><b>Finish the training and pass the exam to start.</b> Read all nine modules, then take the exam.</Notice> : null
      )}

      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {MODULES.map((m, i) => (
          <button key={m.key} type="button" onClick={() => go(m.key)} className={`${card} p-4 text-left hover:border-green-300`}>
            <div className="flex items-center gap-2">
              <span className={`w-7 h-7 rounded-full grid place-items-center text-[12px] font-extrabold ${mine.has(m.key) ? 'bg-green-700 text-white' : 'bg-gray-100 text-gray-700'}`}>{mine.has(m.key) ? <Icon name="check" size={14} /> : i + 1}</span>
              <span className="font-extrabold flex-1">{m.title}</span>
            </div>
            <p className="text-[13px] text-gray-600 mt-1.5">{m.intro}</p>
            <p className="text-[12px] text-gray-500 mt-1">About {m.minutes} min{mine.has(m.key) ? ' · done' : ''}</p>
          </button>
        ))}
      </div>

      {!isManager && (
        <section className={`${card} p-4 flex flex-wrap items-center gap-3`}>
          <div className="flex-1 min-w-[220px]"><h2 className="font-extrabold">The exam</h2>
            <p className="text-[13px] text-gray-600">{allRead ? 'You have read every module.' : `Read all modules first (${mine.size} of ${MODULES.length} done).`}</p></div>
          <button type="button" className={btn.primary} disabled={!allRead} onClick={() => setParams({ exam: '1' })}><Icon name="book" size={16} />{qualified ? 'Take it again' : 'Take the exam'}</button>
        </section>
      )}

      {isManager && (
        <section className={`${card} overflow-hidden`}>
          <h2 className="px-4 pt-3 pb-2 font-extrabold">The team</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[620px]">
              <thead><tr className="text-left text-[12px] uppercase tracking-wide text-gray-500">
                <th className="px-4 py-2 font-bold">Person</th><th className="px-2 py-2 font-bold">Modules</th><th className="px-2 py-2 font-bold">Best exam</th><th className="px-4 py-2 font-bold">Status</th>
              </tr></thead>
              <tbody>
                {staff.filter((s) => s.active && s.role !== 'manager').map((s) => {
                  const n = (done || []).filter((d) => d.staff_id === s.user_id).length;
                  const tries = attempts.filter((a) => a.staff_id === s.user_id && a.submitted_at);
                  const bestTry = [...tries].sort((a, b) => (b.score || 0) - (a.score || 0))[0];
                  return (
                    <tr key={s.user_id} className="border-t border-gray-100">
                      <td className="px-4 py-3"><div className="flex items-center gap-2.5"><span aria-hidden="true" className="w-8 h-8 rounded-full bg-blue-100 text-blue-800 grid place-items-center text-[11px] font-extrabold">{initials(s.name)}</span><span className="font-bold">{s.name}</span></div></td>
                      <td className="px-2 py-3">{n} of {MODULES.length}</td>
                      <td className="px-2 py-3">{bestTry ? `${bestTry.score}/${bestTry.total} · ${shortDay(istDate(Date.parse(bestTry.submitted_at)))} ${istTime(bestTry.submitted_at)}` : '—'}{tries.length > 1 ? ` (${tries.length} tries)` : ''}</td>
                      <td className="px-4 py-3">{s.qualified_at ? <span className="text-[12px] font-bold rounded-full px-2 py-0.5 bg-green-100 text-green-800">Qualified</span>
                        : s.must_train ? <span className="text-[12px] font-bold rounded-full px-2 py-0.5 bg-amber-100 text-amber-900">Training</span>
                          : <span className="text-[12px] font-bold rounded-full px-2 py-0.5 bg-gray-100 text-gray-700">Not required</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="px-4 py-2 text-[12px] text-gray-500 border-t border-gray-100">New people must pass before they can call or check in. Change who must train in Team.</p>
        </section>
      )}
    </div>
  );
}

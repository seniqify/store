// FAQ & help: answers to customer questions and the team's own doubts, plus
// "Ask the manager". The answers only a manager can give (trial, discount,
// cash, incentive) are filled in here by the manager; a good answered
// question can be added to the FAQ for everyone.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useCrm } from './crmContext.js';
import { listQuestions, askQuestion, answerQuestion, deleteQuestion, saveSetting } from './crmService.js';
import { waHref, shortDay, istDate } from './crmLogic.js';
import { CUSTOMER_FAQ, TEAM_FAQ, CUSTOMER_CATS, TEAM_CATS, POLICY_LABELS, POLICY_HINTS } from './crmFaq.js';
import { Icon, Notice, Empty } from './ui.jsx';
import { btn, card, input } from './crmStyles.js';

function PolicyEditor({ k, value, onSaved }) {
  const [text, setText] = useState(value || '');
  const [busy, setBusy] = useState(false);
  return (
    <div className="mt-2 space-y-2">
      <textarea aria-label={POLICY_LABELS[k]} rows={3} className={`${input} h-auto py-2`} value={text} onChange={(e) => setText(e.target.value)} placeholder="Write the answer your team should give" />
      <button type="button" className={btn.smallGreen} disabled={busy || text.trim() === (value || '')} onClick={async () => { setBusy(true); try { await onSaved(k, text.trim()); } finally { setBusy(false); } }}>
        {busy ? 'Saving…' : 'Save answer'}
      </button>
    </div>
  );
}

function AnswerBox({ q, me, onDone }) {
  const [text, setText] = useState(q.answer || '');
  const [faq, setFaq] = useState(q.in_faq);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const save = async () => {
    setBusy(true); setErr('');
    try { await answerQuestion(q.id, me.user_id, text.trim(), faq && !!text.trim()); await onDone(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="mt-2 space-y-2">
      <textarea aria-label="Answer" rows={2} className={`${input} h-auto py-2`} value={text} onChange={(e) => setText(e.target.value)} placeholder="Your answer" />
      <label className="flex items-center gap-2 text-[13px] font-semibold text-gray-700">
        <input type="checkbox" checked={faq} onChange={(e) => setFaq(e.target.checked)} className="w-4 h-4 accent-green-700" />Add to the FAQ for everyone
      </label>
      {err && <Notice>{err}</Notice>}
      <div className="flex gap-2">
        <button type="button" className={btn.smallGreen} disabled={busy || !text.trim()} onClick={save}>{busy ? 'Saving…' : q.answer ? 'Update answer' : 'Answer'}</button>
        <button type="button" className={btn.small} disabled={busy} onClick={async () => { if (window.confirm('Delete this question?')) { await deleteQuestion(q.id); await onDone(); } }}>Delete</button>
      </div>
    </div>
  );
}

export default function CrmHelp() {
  const { me, staff, settings, refreshSettings, nameOf } = useCrm();
  const isManager = me.role === 'manager';
  const [tab, setTab] = useState('customer');
  const [cat, setCat] = useState('all');
  const [open, setOpen] = useState(0);
  const [qs, setQs] = useState([]);
  const [ask, setAsk] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const policies = settings?.policies || {};
  const incentive = settings?.incentive || {};

  const loadQs = useCallback(async () => setQs(await listQuestions()), []);
  useEffect(() => { loadQs(); }, [loadQs]);

  const savePolicy = async (k, text) => {
    if (k === 'incentive') await saveSetting('incentive', { ...incentive, rule: text });
    else await saveSetting('policies', { ...policies, [k]: text });
    await refreshSettings();
  };
  const policyText = (k) => (k === 'incentive'
    ? [incentive.rule, Number(incentive.per_paid) > 0 ? `₹${Number(incentive.per_paid).toLocaleString('en-IN')} for each paid shop.` : '', incentive.pay_day ? `Paid ${incentive.pay_day}.` : ''].filter(Boolean).join(' ')
    : policies[k] || '');

  const fromTeam = useMemo(() => qs.filter((q) => q.in_faq && q.answer).map((q) => ['team', q.question, q.answer]), [qs]);
  const src = tab === 'customer' ? CUSTOMER_FAQ : [...TEAM_FAQ, ...fromTeam];
  const cats = tab === 'customer' ? CUSTOMER_CATS : TEAM_CATS;
  const shown = src.filter((r) => cat === 'all' || r[0] === cat);
  const catLabel = Object.fromEntries(cats);
  const manager = staff.find((s) => s.role === 'manager' && s.active && s.phone && s.user_id !== me.user_id);
  const waiting = qs.filter((q) => !q.answer);
  const mine = qs.filter((q) => q.asked_by === me.user_id);

  const send = async () => {
    setBusy(true); setMsg(null);
    try { await askQuestion(me.user_id, ask.trim()); setAsk(''); setMsg({ kind: 'ok', text: 'Sent. The answer shows here when your manager replies.' }); await loadQs(); }
    catch (e) { setMsg({ kind: 'error', text: e.message }); } finally { setBusy(false); }
  };

  return (
    <div className="px-4 lg:px-7 py-5 space-y-4">
      <header><h1 className="text-2xl font-extrabold">FAQ &amp; help</h1>
        <p className="text-sm text-gray-500">Answers for customers and for you. Not here? Ask the manager.</p></header>

      <div className="flex flex-col xl:flex-row gap-4 items-start">
        <section className="flex-1 min-w-0 w-full space-y-3">
          <div className="flex flex-wrap gap-2">
            {[['customer', 'Customer questions', CUSTOMER_FAQ.length], ['team', 'Team doubts', TEAM_FAQ.length + fromTeam.length]].map(([k, label, n]) => (
              <button key={k} type="button" aria-pressed={tab === k} onClick={() => { setTab(k); setCat('all'); setOpen(0); }}
                className={`h-10 px-4 rounded-full border text-[13.5px] font-bold ${tab === k ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-200 text-gray-700'}`}>{label} · {n}</button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {cats.map(([k, label]) => (
              <button key={k} type="button" aria-pressed={cat === k} onClick={() => { setCat(k); setOpen(0); }}
                className={`h-8 px-3 rounded-full border text-[12.5px] font-bold ${cat === k ? 'border-green-700 bg-green-50 text-green-800' : 'border-gray-200 bg-white text-gray-700'}`}>{label}</button>
            ))}
          </div>
          <ul className={`${card} divide-y divide-gray-100 overflow-hidden`}>
            {!shown.length && <li><Empty>Nothing here yet.</Empty></li>}
            {shown.map(([c, q, a, policy], i) => {
              const answer = policy ? policyText(policy) : a;
              return (
                <li key={q} className={open === i ? 'bg-gray-50' : ''}>
                  <button type="button" aria-expanded={open === i} onClick={() => setOpen(open === i ? -1 : i)} className="w-full flex items-center gap-3 px-4 py-3 text-left">
                    <span className="flex-1"><span className="block font-bold text-[14.5px]">{q}</span><span className="block text-[12px] text-gray-500">{catLabel[c]}</span></span>
                    <span aria-hidden="true" className="text-gray-400 text-lg">{open === i ? '−' : '+'}</span>
                  </button>
                  {open === i && (
                    <div className="px-4 pb-4 text-[14.5px] text-gray-800">
                      {answer ? <p>{answer}</p> : <p className="text-amber-800">Your manager has not written this answer yet.{!isManager && ' Ask below.'}</p>}
                      {policy && POLICY_HINTS[policy] && <p className="text-[13px] text-gray-600 mt-1">{POLICY_HINTS[policy]}</p>}
                      {isManager && policy && (
                        policy === 'incentive'
                          ? <p className="text-[13px] text-gray-600 mt-2">Set the amount per paid shop and the pay date in Team &amp; targets; the words here:</p>
                          : null
                      )}
                      {isManager && policy && <PolicyEditor key={policy + (policy === 'incentive' ? incentive.rule : policies[policy])} k={policy} value={policy === 'incentive' ? incentive.rule : policies[policy]} onSaved={savePolicy} />}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        <aside className="w-full xl:w-[400px] shrink-0 space-y-4">
          {!isManager && (
            <section className={`${card} p-4 space-y-3`}>
              <h2 className="font-extrabold">Ask the manager</h2>
              <textarea aria-label="Your question" rows={3} className={`${input} h-auto py-2`} value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="e.g. Customer wants the shop in Marathi. Can we do that?" maxLength={500} />
              {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
              <div className="flex flex-wrap gap-2">
                <button type="button" className={btn.primary} disabled={busy || ask.trim().length < 3} onClick={send}>{busy ? 'Sending…' : 'Ask'}</button>
                {manager && <a className={btn.ghost} href={waHref(manager.phone, ask.trim() || 'Namaskar, I have a question:')} target="_blank" rel="noreferrer"><Icon name="wa" size={16} />WhatsApp {manager.name.split(' ')[0]}</a>}
              </div>
              {!!mine.length && (
                <ul className="divide-y divide-gray-100 border-t border-gray-100">
                  {mine.map((q) => (
                    <li key={q.id} className="py-2.5 text-sm">
                      <div className="font-bold">{q.question}</div>
                      {q.answer ? <div className="text-gray-800 mt-0.5"><b className="text-green-800">{nameOf(q.answered_by) || 'Manager'}:</b> {q.answer}</div>
                        : <div className="text-amber-800 text-[12.5px] font-bold mt-0.5">Waiting for the manager · asked {shortDay(istDate(Date.parse(q.created_at)))}</div>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
          {isManager && (
            <section className={`${card} p-4 space-y-3`}>
              <h2 className="font-extrabold">Questions from the team{waiting.length ? ` · ${waiting.length} waiting` : ''}</h2>
              {!qs.length ? <p className="text-sm text-gray-500">No questions yet. When someone asks, it shows here.</p> : (
                <ul className="divide-y divide-gray-100">
                  {[...waiting, ...qs.filter((q) => q.answer)].slice(0, 40).map((q) => (
                    <li key={q.id} className="py-3 text-sm">
                      <div className="text-[12px] text-gray-500 font-bold">{nameOf(q.asked_by)} · {shortDay(istDate(Date.parse(q.created_at)))}{q.in_faq ? ' · in the FAQ' : ''}</div>
                      <div className="font-bold">{q.question}</div>
                      <AnswerBox q={q} me={me} onDone={loadQs} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

// Small shared pieces for the Sales CRM. PocketLink look: Inter, green-700
// actions, white cards with gray-200 borders, rounded-2xl.
import { useState } from 'react';
import { stageOf, CALL_OUTCOMES, WHEN_LABELS, whenPresets, LOST_REASONS, callResult, secondsLabel } from './crmLogic.js';
import { btn, input } from './crmStyles.js';

const PATHS = {
  home: <><path d="M3 12l9-8 9 8" /><path d="M5 10v10h14V10" /></>,
  leads: <><circle cx="9" cy="8" r="4" /><path d="M2 21c0-4 3-6 7-6s7 2 7 6" /></>,
  phone: <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z" />,
  pin: <><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z" /><circle cx="12" cy="10" r="2.5" /></>,
  calendar: <><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  team: <path d="M3 21V10M10 21V4M17 21v-8" />,
  assign: <><path d="M16 11l2 2 4-4" /><circle cx="9" cy="8" r="4" /><path d="M2 21c0-4 3-6 7-6 1.5 0 2.8.3 4 .8" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  back: <path d="M15 18l-6-6 6-6" />,
  out: <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />,
  camera: <><path d="M3 7h3l2-3h8l2 3h3v13H3z" /><circle cx="12" cy="13" r="4" /></>,
  wa: <path d="M3 21l1.7-5A8.5 8.5 0 1 1 8 19.3z" />,
  map: <path d="M3 11l18-8-8 18-2-8z" />,
  check: <path d="M20 6L9 17l-5-5" />,
  chart: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
  script: <><path d="M4 4h12a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4z" /><path d="M8 9h8M8 13h6" /></>,
  help: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5v.01" /></>,
  more: <><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></>,
  copy: <><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h8" /></>,
  x: <path d="M18 6L6 18M6 6l12 12" />,
  upload: <><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 16v4h16v-4" /></>,
  bolt: <path d="M13 2L4 14h7l-1 8 9-12h-7z" />,
  eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  eyeOff: <><path d="M3 3l18 18M10.6 10.6a3 3 0 0 0 4.2 4.2M9.4 5.2A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.1 4M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 4.1-.9" /></>,
  shield: <><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /><path d="M9 12l2 2 4-4" /></>,
  book: <><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z" /><path d="M4 19V5" /></>,
  coin: <><circle cx="12" cy="12" r="9" /><path d="M9 9h6M9 12h6M12 12l-3 4" /></>,
  wallet: <path d="M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7zM3 7l12-4v4M16 13.5h2" />,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>,
  report: <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6M8 13h8M8 17h5" /></>,
};

export function Icon({ name, size = 18, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>{PATHS[name]}</svg>
  );
}


export function Field({ label, htmlFor, children, hint }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-[13px] font-bold text-gray-700 mb-1.5">{label}</label>
      {children}
      {hint && <p className="mt-1 text-[12.5px] text-gray-500">{hint}</p>}
    </div>
  );
}

export function StagePill({ stage }) {
  const s = stageOf(stage);
  return <span className={`inline-block text-[12px] font-bold rounded-full px-2.5 py-0.5 ${s.cls}`}>{s.label}</span>;
}

export function Spinner({ label = 'Loading…' }) {
  return (
    <div className="flex items-center gap-2 text-sm text-gray-500 py-10 justify-center" role="status">
      <span className="w-4 h-4 border-2 border-gray-200 border-t-gray-500 rounded-full animate-spin" />{label}
    </div>
  );
}

export function Empty({ children }) {
  return <p className="text-sm text-gray-500 text-center py-10 px-4">{children}</p>;
}

export function Notice({ kind = 'error', children }) {
  const cls = kind === 'error' ? 'bg-red-50 border-red-200 text-red-800' : kind === 'ok' ? 'bg-green-50 border-green-200 text-green-800' : 'bg-amber-50 border-amber-200 text-amber-900';
  return <div className={`border rounded-xl px-3 py-2 text-[13.5px] ${cls}`} role={kind === 'error' ? 'alert' : 'status'}>{children}</div>;
}


/**
 * How did the call go? One tap per outcome, the follow-up it needs, a note,
 * Save. Calls onSave({ outcome, stage, nextAt, next, lost, note, wonPlan, wonAmount }).
 */
export function OutcomePanel({ lead, onSave, busy, saveLabel = 'Save', callSecs = null, onClearCall }) {
  const [out, setOut] = useState(null);
  const [whenKey, setWhenKey] = useState('tomorrow');
  const [custom, setCustom] = useState('');
  const [demoAt, setDemoAt] = useState('');
  const [demoHow, setDemoHow] = useState('Field visit');
  const [lost, setLost] = useState(LOST_REASONS[0]);
  const [wonPlan, setWonPlan] = useState('monthly');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const o = CALL_OUTCOMES.find((x) => x.key === out);

  const save = () => {
    setErr('');
    try {
      const presets = whenPresets();
      const when = whenKey === 'custom' ? (custom ? Date.parse(custom) : null) : presets[whenKey];
      if (o?.ask === 'when' && !when) { setErr('Pick when to call again.'); return; }
      const r = callResult(lead, out, { when, demoAt: demoAt ? Date.parse(demoAt) : null, demoHow, lostReason: lost });
      onSave({ ...r, note, duration: out === 'no_answer' ? null : callSecs, wonPlan: out === 'won' ? wonPlan : null, wonAmount: out === 'won' ? (wonPlan === 'yearly' ? 14999 : 1499) : null });
    } catch (e) {
      setErr(e.message === 'pick the demo time' ? 'Pick the demo day and time.' : e.message);
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {CALL_OUTCOMES.map((x) => (
          <button key={x.key} type="button" aria-pressed={out === x.key} onClick={() => setOut(x.key)}
            className={`h-12 rounded-xl border-2 text-sm font-bold ${out === x.key ? 'border-green-700 bg-green-50' : 'border-gray-200 bg-white'}`}>{x.label}</button>
        ))}
      </div>
      {o?.ask === 'when' && (
        <div>
          <p className="text-[13px] font-bold text-gray-700 mb-1.5">{out === 'busy' ? 'Call again' : 'Follow up'}</p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(WHEN_LABELS).map(([k, label]) => (
              <button key={k} type="button" aria-pressed={whenKey === k} onClick={() => setWhenKey(k)}
                className={`h-10 px-3 rounded-lg border text-[13px] font-bold ${whenKey === k ? 'border-green-700 bg-green-50' : 'border-gray-200 bg-white'}`}>{label}</button>
            ))}
            <button type="button" aria-pressed={whenKey === 'custom'} onClick={() => setWhenKey('custom')}
              className={`h-10 px-3 rounded-lg border text-[13px] font-bold ${whenKey === 'custom' ? 'border-green-700 bg-green-50' : 'border-gray-200 bg-white'}`}>Pick a time</button>
          </div>
          {whenKey === 'custom' && <input type="datetime-local" aria-label="Call again at" className={`${input} mt-2`} value={custom} onChange={(e) => setCustom(e.target.value)} />}
        </div>
      )}
      {o?.ask === 'demo' && (
        <div className="grid sm:grid-cols-2 gap-2">
          <Field label="Demo day and time" htmlFor="demoat"><input id="demoat" type="datetime-local" className={input} value={demoAt} onChange={(e) => setDemoAt(e.target.value)} /></Field>
          <Field label="How" htmlFor="demohow">
            <select id="demohow" className={input} value={demoHow} onChange={(e) => setDemoHow(e.target.value)}>
              <option>Field visit</option><option>Video call</option><option>Phone screen share</option>
            </select>
          </Field>
        </div>
      )}
      {o?.ask === 'lost' && (
        <div>
          <p className="text-[13px] font-bold text-gray-700 mb-1.5">Why not?</p>
          <div className="flex flex-wrap gap-2">
            {LOST_REASONS.filter((r) => r !== 'Wrong number').map((r) => (
              <button key={r} type="button" aria-pressed={lost === r} onClick={() => setLost(r)}
                className={`h-10 px-3 rounded-full border text-[13px] font-semibold ${lost === r ? 'border-green-700 bg-green-50' : 'border-gray-200 bg-white'}`}>{r}</button>
            ))}
          </div>
        </div>
      )}
      {o?.ask === 'won' && (
        <div>
          <p className="text-[13px] font-bold text-gray-700 mb-1.5">Which plan did they pay for?</p>
          <div className="flex gap-2">
            {[['monthly', '₹1,499 a month'], ['yearly', '₹14,999 a year']].map(([k, label]) => (
              <button key={k} type="button" aria-pressed={wonPlan === k} onClick={() => setWonPlan(k)}
                className={`h-10 px-3 rounded-lg border text-[13px] font-bold ${wonPlan === k ? 'border-green-700 bg-green-50' : 'border-gray-200 bg-white'}`}>{label}</button>
            ))}
          </div>
        </div>
      )}
      <Field label="Note (optional)" htmlFor="outnote">
        <textarea id="outnote" rows={2} className={`${input} h-auto py-2`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything the next person should know" />
      </Field>
      {callSecs != null && out !== 'no_answer' && (
        <p className="text-[13px] text-gray-600">Call time about <b>{secondsLabel(callSecs)}</b> (from tapping Call to coming back).{' '}
          {onClearCall && <button type="button" className="font-bold text-gray-700 underline" onClick={onClearCall}>Not right? Clear it</button>}</p>
      )}
      {out === 'won' && <p className="text-[12.5px] text-gray-500">It counts in your score once PocketLink sees their payment, or your manager approves it.</p>}
      {err && <Notice>{err}</Notice>}
      <button type="button" className={btn.primary} disabled={!out || busy} onClick={save}>{busy ? 'Saving…' : saveLabel}</button>
    </div>
  );
}

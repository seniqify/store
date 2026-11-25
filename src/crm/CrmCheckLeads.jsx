// Ads & leads executive (and the manager): check the leads that arrive from
// ads and the website, and the ones they add or import. A check says it is a
// real person with a real business (fixing the name, type and place), or
// closes it as spam, a wrong number, a duplicate or not a business. Ad leads
// are already with a caller (nobody waits for the check); leads the Ads &
// leads person added wait here and are given out by the rules once checked.
// The database decides what each login may see and check (sales_verify_lead).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCrm } from './crmContext.js';
import { listLeads, verifyLead, autoAssign } from './crmService.js';
import {
  VERIFY_RESULTS, AD_SOURCES, toCheck, waitedLabel, sourceLabel, BUSINESS_TYPES, prettyPhone, telHref, waHref, istDate, istInstant, shortDay,
} from './crmLogic.js';
import { Icon, Field, Notice, Spinner, Empty, StagePill } from './ui.jsx';
import { btn, card, input } from './crmStyles.js';

const WINDOW_DAYS = 14;
const FAST_MIN = 30;
const isAdSource = (l) => AD_SOURCES.includes(l.source);

/** The leads this screen is about: from ads and the website, or added by the Ads & leads team. */
function useCheckLeads() {
  const { me, staff } = useCrm();
  const [leads, setLeads] = useState(null);
  const [now, setNow] = useState(0);
  const load = useCallback(async () => { const ls = await listLeads(); setLeads(ls); setNow(Date.now()); }, []);
  useEffect(() => { load(); }, [load]);
  const adsIds = useMemo(() => new Set(staff.filter((s) => s.role === 'ads').map((s) => s.user_id)), [staff]);
  const mine = useMemo(() => (leads || []).filter((l) => isAdSource(l) || adsIds.has(l.created_by) || l.verified_by === me.user_id), [leads, adsIds, me.user_id]);
  return { leads: leads && mine, load, now };
}

function CheckCard({ l, now, onDone }) {
  const { nameOf } = useCrm();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ shop_name: l.shop_name || '', owner_name: l.owner_name || '', business_type: l.business_type || '', city: l.city || '', area: l.area || '', note: '' });
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const late = isAdSource(l) && now - Date.parse(l.created_at) > FAST_MIN * 60000;

  const decide = async (status) => {
    setBusy(status); setErr('');
    try {
      const fix = {};
      if (status === 'verified') {
        for (const k of ['shop_name', 'owner_name', 'business_type', 'city', 'area']) if ((f[k] || '').trim() !== (l[k] || '')) fix[k] = f[k].trim();
        if (fix.shop_name === '') delete fix.shop_name;
      }
      await verifyLead(l.id, status, f.note.trim(), Object.keys(fix).length ? fix : null);
      setOpen(false);
      await onDone(l.id, status);
    } catch (e) { setErr(e.message); } finally { setBusy(''); }
  };

  return (
    <li className="px-4 py-3 space-y-2">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <div className="flex-1 min-w-[200px]">
          <div className="font-bold text-[15px]">{l.shop_name}</div>
          <div className="text-[12.5px] text-gray-500">{[l.owner_name, prettyPhone(l.phone), l.business_type, l.city].filter(Boolean).join(' · ')}</div>
          <div className="text-[12.5px] text-gray-500">{sourceLabel(l.source)}{l.source_detail ? ` · ${l.source_detail}` : ''} · {l.assigned_to ? `with ${nameOf(l.assigned_to) || 'a caller'}` : 'not given out yet'}</div>
        </div>
        <span className={`text-[12px] font-bold rounded-full px-2.5 py-0.5 ${late ? 'bg-amber-100 text-amber-900' : 'bg-gray-100 text-gray-700'}`}>{waitedLabel(l.created_at, now)} ago</span>
      </div>
      <div className="flex flex-wrap gap-2">
        <a href={telHref(l.phone)} className={btn.small}><Icon name="phone" size={14} />Call</a>
        <a href={waHref(l.phone, 'Namaskar, this is PocketLink. You asked about an online shop for your business. Is this a good time to talk?')} target="_blank" rel="noreferrer" className={btn.small}><Icon name="wa" size={14} />WhatsApp</a>
        <button type="button" className={open ? btn.small : btn.smallGreen} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Close' : 'Check this lead'}</button>
      </div>
      {open && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 space-y-3">
          <p className="text-[13px] text-gray-700">Is it a real person with a real business, and does the number work? Fix anything wrong before you mark it Verified.</p>
          <div className="grid sm:grid-cols-2 gap-2">
            <Field label="Shop name" htmlFor={`cs-${l.id}`}><input id={`cs-${l.id}`} className={input} value={f.shop_name} onChange={set('shop_name')} /></Field>
            <Field label="Owner’s name" htmlFor={`co-${l.id}`}><input id={`co-${l.id}`} className={input} value={f.owner_name} onChange={set('owner_name')} /></Field>
            <Field label="Type of business" htmlFor={`cb-${l.id}`}>
              <select id={`cb-${l.id}`} className={input} value={f.business_type} onChange={set('business_type')}>
                <option value="">Not known</option>{BUSINESS_TYPES.map((b) => <option key={b}>{b}</option>)}
                {f.business_type && !BUSINESS_TYPES.includes(f.business_type) && <option>{f.business_type}</option>}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="City" htmlFor={`cc-${l.id}`}><input id={`cc-${l.id}`} className={input} value={f.city} onChange={set('city')} /></Field>
              <Field label="Area" htmlFor={`ca-${l.id}`}><input id={`ca-${l.id}`} className={input} value={f.area} onChange={set('area')} /></Field>
            </div>
          </div>
          <Field label="Note (what you found)" htmlFor={`cn-${l.id}`}><input id={`cn-${l.id}`} className={input} value={f.note} onChange={set('note')} maxLength={300} placeholder="e.g. Owner confirmed on WhatsApp, sells sarees" /></Field>
          {err && <Notice>{err}</Notice>}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btn.primary} disabled={!!busy} onClick={() => decide('verified')}><Icon name="check" size={16} />{busy === 'verified' ? 'Saving…' : 'Verified: a real lead'}</button>
            {['spam', 'wrong_number', 'duplicate', 'not_business'].map((k) => (
              <button key={k} type="button" className={btn.ghost} disabled={!!busy} title={VERIFY_RESULTS[k].hint} onClick={() => decide(k)}>{busy === k ? 'Saving…' : VERIFY_RESULTS[k].label}</button>
            ))}
          </div>
          <p className="text-[12px] text-gray-500">Spam, wrong number, duplicate and not a business close the lead as lost, so nobody calls it.</p>
        </div>
      )}
    </li>
  );
}

export default function CrmCheckLeads() {
  const { me, path, settings } = useCrm();
  const { leads, load, now } = useCheckLeads();
  const [tab, setTab] = useState('todo');
  const [only, setOnly] = useState('all');
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const rulesOn = !!settings?.auto_assign?.on;

  const since = now - WINDOW_DAYS * 86400000;
  const todo = useMemo(() => toCheck(leads).filter((l) => Date.parse(l.created_at) >= since)
    .filter((l) => only === 'all' || (only === 'ads' ? isAdSource(l) : l.created_by === me.user_id)), [leads, since, only, me.user_id]);
  const done = useMemo(() => (leads || []).filter((l) => l.verified_by === me.user_id)
    .sort((a, b) => Date.parse(b.verified_at) - Date.parse(a.verified_at)).slice(0, 200), [leads, me.user_id]);
  const ready = useMemo(() => (leads || []).filter((l) => l.verify_status === 'verified' && !l.assigned_to && l.stage !== 'won' && l.stage !== 'lost'
    && (l.verified_by === me.user_id || l.created_by === me.user_id)), [leads, me.user_id]);

  const onDone = async (id, status) => {
    setMsg({ kind: status === 'verified' ? 'ok' : 'warn', text: status === 'verified' ? 'Checked: a real lead.' : `Closed as ${VERIFY_RESULTS[status].label.toLowerCase()}.` });
    await load();
  };
  const giveOut = async () => {
    setBusy(true); setMsg(null);
    try {
      const n = await autoAssign(ready.map((l) => l.id));
      setMsg({ kind: 'ok', text: n ? `${n} checked lead${n === 1 ? '' : 's'} given out by the rules. They are at the top of each caller’s queue.` : 'Nobody to give them to: the rules have no one in them. Tell your manager.' });
      await load();
    } catch (e) { setMsg({ kind: 'error', text: e.message }); } finally { setBusy(false); }
  };

  if (!leads) return <Spinner />;
  return (
    <div className="px-4 lg:px-7 py-5 max-w-4xl space-y-4">
      <header className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[220px]"><h1 className="text-2xl font-extrabold">Check leads</h1>
          <p className="text-sm text-gray-500">A real person, a real business, a working number? Check, fix, pass the good ones on.</p></div>
        <Link to={path('add')} className={btn.ghost}><Icon name="plus" size={16} />Add leads</Link>
      </header>

      {ready.length > 0 && (
        <section aria-label="Ready to give out" className={`${card} border-green-300 p-4 flex flex-wrap items-center gap-3`}>
          <div className="flex-1 min-w-[220px]">
            <div className="font-extrabold">{ready.length} checked lead{ready.length === 1 ? '' : 's'} with no owner yet</div>
            <div className="text-[13px] text-gray-600">{rulesOn ? 'Give them to the callers by the auto-assign rules.' : 'Auto-assign is off. Ask your manager to turn it on in Assign, or to give them out.'}</div>
          </div>
          <button type="button" className={btn.primary} disabled={!rulesOn || busy} onClick={giveOut}>{busy ? 'Giving…' : `Give out ${ready.length} by the rules`}</button>
        </section>
      )}
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Which leads">
        {[['todo', `To check (${toCheck(leads).filter((l) => Date.parse(l.created_at) >= since).length})`], ['done', `Checked by me (${done.length})`]].map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`h-10 px-4 rounded-full border text-[13.5px] font-bold ${tab === k ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-200 text-gray-700'}`}>{label}</button>
        ))}
        {tab === 'todo' && (
          <select aria-label="Show" className={`${input} h-10 w-auto ml-auto`} value={only} onChange={(e) => setOnly(e.target.value)}>
            <option value="all">All</option><option value="ads">From ads and the website</option><option value="mine">Added by me</option>
          </select>
        )}
      </div>

      {tab === 'todo' ? (
        <section aria-label="To check" className={`${card} overflow-hidden`}>
          {!todo.length ? <Empty>Nothing to check. New ad and website leads appear here as they arrive.</Empty> : (
            <ul className="divide-y divide-gray-100">{todo.map((l) => <CheckCard key={l.id} l={l} now={now} onDone={onDone} />)}</ul>
          )}
          <p className="px-4 py-2.5 border-t border-gray-100 text-[12px] text-gray-500">Leads from the last {WINDOW_DAYS} days. Ad leads are with a caller already: check them within {FAST_MIN} minutes so a fake one is not called twice.</p>
        </section>
      ) : (
        <section aria-label="Checked by me" className={`${card} overflow-hidden`}>
          {!done.length ? <Empty>You have not checked any leads yet.</Empty> : (
            <ul className="divide-y divide-gray-100">
              {done.map((l) => {
                const r = VERIFY_RESULTS[l.verify_status] || VERIFY_RESULTS.verified;
                return (
                  <li key={l.id} className="px-4 py-3 flex flex-wrap items-center gap-3">
                    <span className="flex-1 min-w-[200px]"><span className="block font-bold">{l.shop_name}</span>
                      <span className="block text-[12.5px] text-gray-500">{sourceLabel(l.source)} · checked {shortDay(istDate(Date.parse(l.verified_at)))}{l.verify_note ? ` · ${l.verify_note}` : ''}</span></span>
                    <span className={`text-[12px] font-bold rounded-full px-2.5 py-0.5 ${r.cls}`}>{r.short}</span>
                    {l.verify_status === 'verified' && (l.stage === 'won' && l.won_proof ? <span className="text-[12px] font-bold rounded-full px-2.5 py-0.5 bg-green-700 text-white">Paid</span> : <StagePill stage={l.stage} />)}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function Stat({ label, value, sub, warn }) {
  return (
    <div className={`${card} px-4 py-3 ${warn ? 'border-amber-300' : ''}`}>
      <div className="text-[11.5px] font-bold uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`text-2xl font-extrabold mt-0.5 ${warn ? 'text-amber-800' : ''}`}>{value}</div>
      {sub && <div className="text-[12.5px] text-gray-500 mt-0.5">{sub}</div>}
    </div>
  );
}

/** Today for the Ads & leads executive: their day, what waits, what they checked. */
export function AdsToday({ dayCard, todayActs, trainingNotice }) {
  const { me, path } = useCrm();
  const { leads, now } = useCheckLeads();
  if (!leads) return <Spinner />;
  const today = istInstant(istDate());
  const waiting = toCheck(leads).filter((l) => Date.parse(l.created_at) >= now - WINDOW_DAYS * 86400000);
  const lateAds = waiting.filter((l) => isAdSource(l) && now - Date.parse(l.created_at) > FAST_MIN * 60000);
  const mine = todayActs.filter((a) => a.staff_id === me.user_id && String(a.outcome || '').startsWith('checked_'));
  const real = mine.filter((a) => a.outcome === 'checked_verified').length;
  const oldest = [...waiting].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)).slice(0, 5);
  const addedToday = leads.filter((l) => l.created_by === me.user_id && Date.parse(l.created_at) >= today).length;
  return (
    <div className="px-4 lg:px-7 py-5 max-w-3xl space-y-4">
      <h1 className="text-2xl font-extrabold">Hi {me.name.split(' ')[0]}</h1>
      {dayCard}
      {trainingNotice}
      {lateAds.length > 0 && <Notice kind="warn"><b>{lateAds.length} ad lead{lateAds.length === 1 ? '' : 's'} waiting over {FAST_MIN} minutes.</b> Check them first.</Notice>}
      <div className="grid grid-cols-3 gap-3">
        <Stat label="To check" value={waiting.length} sub="last 14 days" warn={lateAds.length > 0} />
        <Stat label="Checked" value={mine.length} sub={me.daily_target ? `of ${me.daily_target} today` : 'today'} />
        <Stat label="Real leads" value={real} sub={`today · ${addedToday} added`} />
      </div>
      <Link to={path('check')} className={`${btn.primary} w-full h-12 text-base`}><Icon name="shield" />Open Check leads</Link>
      <section className={`${card} overflow-hidden`}>
        <h2 className="px-4 pt-3 pb-2 font-extrabold">Waiting longest</h2>
        {!oldest.length ? <p className="px-4 pb-4 text-sm text-gray-500">Nothing waiting.</p> : (
          <ul className="divide-y divide-gray-100">
            {oldest.map((l) => (
              <li key={l.id}><Link to={path('check')} className="flex gap-3 items-center px-4 py-3 text-gray-900 no-underline">
                <span className="flex-1 min-w-0"><span className="block font-bold truncate">{l.shop_name}</span><span className="block text-[12.5px] text-gray-500">{sourceLabel(l.source)}{l.source_detail ? ` · ${l.source_detail}` : ''}</span></span>
                <span className="text-[12px] font-bold text-amber-700">{waitedLabel(l.created_at, now)}</span></Link></li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

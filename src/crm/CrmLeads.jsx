// Leads: search and filter, one lead's full history, and everything you can do
// to it (call, WhatsApp, log how a call went, stage, owner, next step, notes).
// A manager sees every lead; a caller or field executive only their own.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useCrm } from './crmContext.js';
import {
  listLeads, getLead, updateLead, listActivities, logActivity, assignLeads, photoUrl,
} from './crmService.js';
import {
  STAGES, sourceLabel, SOURCES, prettyPhone, telHref, waHref, mapHref, dueLabel, istTime, shortDay, istDate,
} from './crmLogic.js';
import { Icon, Field, StagePill, Spinner, Empty, Notice, OutcomePanel } from './ui.jsx';
import { btn, input, card, toLocalInput, toInstantLocal } from './crmStyles.js';

const ACT_LABEL = {
  call: 'Call', visit: 'Visit', note: 'Note', stage: 'Stage', assign: 'Given to', system: '',
};
const OUTCOME_LABEL = {
  no_answer: 'did not pick up', busy: 'busy, call later', interested: 'interested', demo: 'demo booked', won: 'won · paid',
  not_interested: 'not interested', wrong_number: 'wrong number', moved_from_hub: 'Moved from the Hub', signed_up: 'Signed up on PocketLink',
};

function Photo({ path }) {
  const [url, setUrl] = useState('');
  useEffect(() => { let alive = true; photoUrl(path).then((u) => { if (alive) setUrl(u); }); return () => { alive = false; }; }, [path]);
  return url ? <a href={url} target="_blank" rel="noreferrer"><img src={url} alt="Visit photo" className="w-16 h-16 rounded-lg object-cover border border-gray-200" /></a>
    : <span className="w-16 h-16 rounded-lg bg-gray-100 inline-block" aria-hidden="true" />;
}

function History({ items, nameOf }) {
  if (!items) return <Spinner />;
  if (!items.length) return <Empty>No history yet.</Empty>;
  return (
    <ol className="divide-y divide-gray-100">
      {items.map((a) => {
        const what = a.kind === 'system' ? (OUTCOME_LABEL[a.outcome] || 'Update')
          : a.kind === 'assign' ? `Given to ${nameOf(a.outcome) || 'nobody'}`
          : a.kind === 'stage' ? `Stage → ${STAGES.find((s) => s.key === a.outcome)?.label || a.outcome}`
          : `${ACT_LABEL[a.kind]}${a.outcome ? ` · ${OUTCOME_LABEL[a.outcome] || a.outcome.replace(/_/g, ' ')}` : ''}`;
        return (
          <li key={a.id} className="py-2.5 flex gap-3">
            <span aria-hidden="true" className={`w-8 h-8 rounded-full grid place-items-center text-[11px] font-extrabold shrink-0 ${a.kind === 'visit' ? 'bg-green-100 text-green-800' : a.kind === 'call' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-700'}`}>
              {a.kind === 'visit' ? 'V' : a.kind === 'call' ? 'C' : 'i'}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-[13.5px] font-bold">{what}</div>
              {a.note && <div className="text-[13px] text-gray-700 whitespace-pre-line mt-0.5">{a.note}</div>}
              <div className="text-[12px] text-gray-500 mt-0.5">
                {[nameOf(a.staff_id), `${shortDay(istDate(Date.parse(a.created_at)))} ${istTime(a.created_at)}`].filter(Boolean).join(' · ')}
                {a.lat != null && <> · <a href={mapHref(a.lat, a.lng)} target="_blank" rel="noreferrer" className="font-semibold">place ±{a.accuracy_m ?? '?'} m</a></>}
              </div>
            </div>
            {a.photo_path && <Photo path={a.photo_path} />}
          </li>
        );
      })}
    </ol>
  );
}

/** One lead with everything you can do to it. */
export function LeadDetail({ leadId, onChanged }) {
  const { me, staff, nameOf, path } = useCrm();
  const [lead, setLead] = useState(null);
  const [hist, setHist] = useState(null);
  const [mode, setMode] = useState(null);          // 'call' | 'edit'
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [nextAt, setNextAt] = useState('');
  const [nextText, setNextText] = useState('');
  const [edit, setEdit] = useState({});
  const isManager = me.role === 'manager';

  const load = useCallback(async () => {
    setErr('');
    try {
      const l = await getLead(leadId);
      setLead(l);
      setNextAt(l?.next_action_at ? toLocalInput(Date.parse(l.next_action_at)) : '');
      setNextText(l?.next_action || '');
      setHist(await listActivities(leadId));
    } catch (e) { setErr(e.message); }
  }, [leadId]);
  useEffect(() => { setLead(null); setHist(null); setMode(null); load(); }, [load]);

  const run = async (fn) => {
    setBusy(true); setErr('');
    try { await fn(); await load(); onChanged?.(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  if (!lead) return err ? <Notice>{err}</Notice> : <Spinner />;
  const canWork = isManager || lead.assigned_to === me.user_id;

  return (
    <div className="space-y-4">
      <div className="flex gap-3 items-start">
        <div className="flex-1 min-w-0">
          <h2 className="text-xl font-extrabold leading-tight">{lead.shop_name}</h2>
          <p className="text-[13.5px] text-gray-600 mt-0.5">{[lead.owner_name, lead.business_type, [lead.area, lead.city].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}</p>
          <p className="text-[13px] text-gray-500 mt-0.5">{prettyPhone(lead.phone)} · {sourceLabel(lead.source)}{lead.signed_up ? ' · Signed up' : ''}</p>
        </div>
        <StagePill stage={lead.stage} />
      </div>

      <div className="grid grid-cols-3 gap-2">
        <a href={telHref(lead.phone)} className={btn.primary}><Icon name="phone" size={16} />Call</a>
        <a href={waHref(lead.phone)} target="_blank" rel="noreferrer" className={btn.ghost}>WhatsApp</a>
        {canWork ? <button type="button" className={btn.ghost} onClick={() => setMode(mode === 'call' ? null : 'call')}>Log call</button>
          : <span className={`${btn.ghost} opacity-50`}>Log call</span>}
      </div>

      {mode === 'call' && (
        <div className={`${card} p-4`}>
          <h3 className="font-extrabold mb-3">How did the call go?</h3>
          <OutcomePanel lead={lead} busy={busy} onSave={(r) => run(async () => {
            await logActivity({ leadId: lead.id, kind: 'call', outcome: r.outcome, note: r.note, stage: r.stage, nextAt: r.nextAt, next: r.next, lost: r.lost });
            if (r.outcome === 'won') await updateLead(lead.id, { won_plan: r.wonPlan, won_amount: r.wonAmount });
            setMode(null);
          })} />
        </div>
      )}

      {err && <Notice>{err}</Notice>}

      {canWork && (
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Stage" htmlFor="stg">
            <select id="stg" className={input} value={lead.stage} disabled={busy}
              onChange={(e) => run(() => logActivity({ leadId: lead.id, kind: 'note', note: null, stage: e.target.value }))}>
              {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </Field>
          {isManager ? (
            <Field label="Owner" htmlFor="own">
              <select id="own" className={input} value={lead.assigned_to || ''} disabled={busy}
                onChange={(e) => run(() => assignLeads([lead.id], e.target.value || null))}>
                <option value="">Not assigned</option>
                {staff.filter((s) => s.active).map((s) => <option key={s.user_id} value={s.user_id}>{s.name}</option>)}
              </select>
            </Field>
          ) : (
            <Field label="Owner" htmlFor="own"><input id="own" className={input} value={nameOf(lead.assigned_to) || 'Not assigned'} readOnly /></Field>
          )}
          <Field label="Next step" htmlFor="nxt">
            <input id="nxt" className={input} value={nextText} onChange={(e) => setNextText(e.target.value)} placeholder="e.g. Call back, demo, send prices" />
          </Field>
          <Field label="When" htmlFor="nxa">
            <div className="flex gap-2">
              <input id="nxa" type="datetime-local" className={`${input} min-w-0 flex-1`} value={nextAt} onChange={(e) => setNextAt(e.target.value)} />
              <button type="button" className={btn.small + ' h-11 shrink-0'} disabled={busy}
                onClick={() => run(() => updateLead(lead.id, { next_action_at: nextAt ? toInstantLocal(nextAt) : null, next_action: nextText || null }))}>Save</button>
            </div>
          </Field>
        </div>
      )}
      {lead.next_action_at && <p className="text-[13px] font-semibold text-gray-700">Next: {lead.next_action || 'follow up'} · {dueLabel(lead.next_action_at)}</p>}

      {canWork && (
        <div className="flex gap-2">
          <textarea aria-label="Add a note" rows={2} className={`${input} h-auto py-2`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note: what did they say?" />
          <button type="button" className={btn.dark} disabled={busy || !note.trim()} onClick={() => run(async () => { await logActivity({ leadId: lead.id, kind: 'note', note }); setNote(''); })}>Add</button>
        </div>
      )}

      {canWork && (
        <details className={`${card} p-3`} open={mode === 'edit'} onToggle={(e) => { if (e.target.open) setEdit({ shop_name: lead.shop_name, owner_name: lead.owner_name || '', business_type: lead.business_type || '', city: lead.city || '', area: lead.area || '' }); }}>
          <summary className="text-[13px] font-bold cursor-pointer">Edit details</summary>
          <div className="grid sm:grid-cols-2 gap-2 mt-3">
            {[['shop_name', 'Shop name'], ['owner_name', 'Owner’s name'], ['business_type', 'Type of business'], ['city', 'City'], ['area', 'Area']].map(([k, label]) => (
              <Field key={k} label={label} htmlFor={`ed-${k}`}><input id={`ed-${k}`} className={input} value={edit[k] ?? ''} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} /></Field>
            ))}
          </div>
          <button type="button" className={`${btn.small} mt-3`} disabled={busy || !String(edit.shop_name || '').trim()}
            onClick={() => run(() => updateLead(lead.id, Object.fromEntries(Object.entries(edit).map(([k, v]) => [k, String(v).trim() || null]))))}>Save details</button>
        </details>
      )}

      <div>
        <h3 className="text-[13px] font-extrabold uppercase tracking-wide text-gray-500 mb-1">History</h3>
        <History items={hist} nameOf={nameOf} />
      </div>
      {me.role !== 'caller' && canWork && (
        <Link to={`${path('checkin')}?lead=${lead.id}`} className={btn.ghost}><Icon name="pin" size={16} />Check in at this shop</Link>
      )}
    </div>
  );
}

/** Full page for one lead (phones, and links from elsewhere). */
export function CrmLeadPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  return (
    <div className="max-w-2xl mx-auto px-4 py-4">
      <button type="button" onClick={() => navigate(-1)} className="flex items-center gap-1 text-sm font-bold text-gray-700 mb-3"><Icon name="back" size={18} />Back</button>
      <div className={`${card} p-4`}><LeadDetail leadId={id} /></div>
    </div>
  );
}

export function CrmLeads() {
  const { me, staff, nameOf, path } = useCrm();
  const navigate = useNavigate();
  const [leads, setLeads] = useState(null);
  const [q, setQ] = useState('');
  const [stage, setStage] = useState('all');
  const [src, setSrc] = useState('all');
  const [owner, setOwner] = useState('all');
  const [sel, setSel] = useState(null);
  const [show, setShow] = useState(60);
  const isManager = me.role === 'manager';

  const [loadedAt, setLoadedAt] = useState(0);
  const load = useCallback(async () => { const ls = await listLeads(); setLeads(ls); setLoadedAt(Date.now()); }, []);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    if (!leads) return [];
    const term = q.trim().toLowerCase();
    const digits = term.replace(/\D/g, '');
    return leads
      .filter((l) => stage === 'all' || l.stage === stage)
      .filter((l) => src === 'all' || l.source === src)
      .filter((l) => owner === 'all' || (owner === 'none' ? !l.assigned_to : l.assigned_to === owner))
      .filter((l) => !term || l.shop_name.toLowerCase().includes(term) || (l.owner_name || '').toLowerCase().includes(term)
        || (digits.length >= 3 && l.phone.includes(digits)) || (l.city || '').toLowerCase().includes(term))
      .sort((a, b) => Date.parse(b.last_activity_at || b.created_at) - Date.parse(a.last_activity_at || a.created_at));
  }, [leads, q, stage, src, owner]);

  const counts = useMemo(() => {
    const c = { all: leads?.length || 0 };
    for (const l of leads || []) c[l.stage] = (c[l.stage] || 0) + 1;
    return c;
  }, [leads]);

  const pick = (id) => {
    if (window.matchMedia('(min-width: 1024px)').matches) setSel(id);
    else navigate(path(`leads/${id}`));
  };

  return (
    <div className="px-4 lg:px-7 py-5 space-y-4">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-extrabold flex-1">{isManager ? 'Leads' : 'My leads'} <span className="text-base text-gray-500 font-semibold">{leads ? leads.length : ''}</span></h1>
        {isManager && <Link to={path('assign')} className={btn.ghost}>Assign leads</Link>}
        <Link to={path('add')} className={btn.primary}><Icon name="plus" size={16} />Add lead</Link>
      </header>

      <div className="flex flex-wrap gap-2 items-center">
        <input aria-label="Search leads" className={`${input} sm:w-72`} placeholder="Search shop, owner, phone, city" value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label="Came from" className={`${input} sm:w-56`} value={src} onChange={(e) => setSrc(e.target.value)}>
          <option value="all">All sources</option>
          {Object.entries(SOURCES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {isManager && (
          <select aria-label="Owner" className={`${input} sm:w-56`} value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="all">Everyone</option><option value="none">Not assigned</option>
            {staff.map((s) => <option key={s.user_id} value={s.user_id}>{s.name}</option>)}
          </select>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {[{ key: 'all', label: 'All' }, ...STAGES].map((s) => (
          <button key={s.key} type="button" aria-pressed={stage === s.key} onClick={() => setStage(s.key)}
            className={`h-9 px-3 rounded-full border text-[13px] font-bold ${stage === s.key ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-200 text-gray-700'}`}>
            {s.label} · {counts[s.key] || 0}
          </button>
        ))}
      </div>

      <div className="flex gap-4 items-start">
        <section aria-label="Lead list" className={`${card} flex-1 min-w-0 overflow-hidden`}>
          {!leads ? <Spinner /> : !filtered.length ? <Empty>No leads match.</Empty> : (
            <ul className="divide-y divide-gray-100">
              {filtered.slice(0, show).map((l) => (
                <li key={l.id}>
                  <button type="button" onClick={() => pick(l.id)} className={`w-full text-left px-4 py-3 flex gap-3 items-center ${sel === l.id ? 'bg-green-50' : 'bg-white'}`}>
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-[14.5px] truncate">{l.shop_name}</div>
                      <div className="text-[12.5px] text-gray-500 truncate">{[l.owner_name, l.city, sourceLabel(l.source)].filter(Boolean).join(' · ')}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <StagePill stage={l.stage} />
                      <div className={`text-[12px] mt-1 font-semibold ${l.next_action_at && Date.parse(l.next_action_at) < loadedAt ? 'text-amber-700' : 'text-gray-500'}`}>
                        {l.next_action_at ? dueLabel(l.next_action_at, loadedAt) : isManager ? (nameOf(l.assigned_to) || 'Not assigned') : ''}
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {filtered.length > show && (
            <button type="button" className="w-full py-3 text-sm font-bold text-green-700 border-t border-gray-100" onClick={() => setShow(show + 60)}>
              Show more ({filtered.length - show} left)
            </button>
          )}
        </section>
        <aside aria-label="Lead details" className={`${card} hidden lg:block w-[440px] shrink-0 p-4 sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto`}>
          {sel ? <LeadDetail leadId={sel} onChanged={load} /> : <Empty>Pick a lead to see its history.</Empty>}
        </aside>
      </div>
    </div>
  );
}

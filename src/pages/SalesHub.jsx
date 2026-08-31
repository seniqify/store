import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  LayoutDashboard, Activity, Users, CalendarClock, RefreshCw, Plus, Phone,
  MessageCircle, LogOut, Search, Check, X, Store,
} from 'lucide-react';
import {
  hubSession, onHubAuthChange, hubSignIn, hubSignOut, fetchTeam,
  listLeads, addLead, updateLead, fetchStoresLite, fetchRecentOrders,
  fetchViewsSince, todayIST, istDaysAgo,
} from '../utils/hubService';

/**
 * Sales Hub — internal CRM for the PocketLink team (founder + sales execs).
 * Hidden route (/hub), Supabase-auth gated; all CRM reads are additionally
 * RLS-gated on crm_team membership (see supabase-sales-hub.sql).
 *
 * Deliberately lean: Today (numbers) · Activity (live platform feed — zero
 * data entry) · Leads (30-second capture + pipeline) · Follow-ups · Renewals
 * (derived from stores.planExpiresAt — zero data entry).
 */

const EMERALD = '#0d9488';

const CATEGORIES = [
  'Bakery', 'Restaurant', 'Mobile Shop', 'Jewellery', 'Medical Store', 'Clothing',
  'Hardware', 'Electronics', 'Protein Store', 'Salon', 'Furniture', 'Gift Shop',
  'Architect / Interior', 'Events', 'Other',
];
const SOURCES = ['Walk In', 'Cold Visit', 'Referral', 'Instagram', 'Facebook', 'Google', 'Website', 'WhatsApp', 'YouTube', 'Other'];
const REASONS = ['AI Search', 'Online Store', 'Marketplace', 'WhatsApp Ordering', 'Online Payments', 'Easy Setup', 'Affordable Pricing', 'Referral', 'Recommended', 'Other'];

const STATUS = {
  'new':        { label: 'New',        cls: 'bg-amber-100 text-amber-700'     },
  'contacted':  { label: 'Contacted',  cls: 'bg-sky-100 text-sky-700'         },
  'demo':       { label: 'Demo given', cls: 'bg-indigo-100 text-indigo-700'   },
  'interested': { label: 'Interested', cls: 'bg-violet-100 text-violet-700'   },
  'won-paid':   { label: 'Won · Paid', cls: 'bg-emerald-100 text-emerald-700' },
  'won-free':   { label: 'Won · Free', cls: 'bg-teal-100 text-teal-700'       },
  'lost':       { label: 'Lost',       cls: 'bg-gray-100 text-gray-500'       },
};
const OPEN_STATUSES = ['new', 'contacted', 'demo', 'interested'];

const PLAN_NAME = { free: 'Free', business: 'Growth', premium: 'Pro', pro: 'Pro (legacy)', starter: 'Starter' };

const EMPTY_LEAD = {
  business_name: '', owner_name: '', phone: '', category: '', city: 'Solapur', area: '',
  source: '', status: 'new', plan: '', amount: '', reasons: [], objection: '',
  next_follow_up: '', priority: '', notes: '',
};

/** DB rows carry NULLs for empty fields — coerce them back to the form's ''
 *  shape so controlled inputs and `.trim()` on save don't blow up. */
function leadToForm(lead) {
  return {
    ...EMPTY_LEAD, ...lead,
    owner_name: lead.owner_name ?? '', category: lead.category ?? '',
    city: lead.city ?? '', area: lead.area ?? '', source: lead.source ?? '',
    plan: lead.plan ?? '', objection: lead.objection ?? '', priority: lead.priority ?? '',
    notes: lead.notes ?? '', amount: lead.amount ?? '', reasons: lead.reasons ?? [],
    next_follow_up: lead.next_follow_up ?? '',
  };
}

function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);  if (h < 24) return `${h} hr ago`;
  const d = Math.floor(h / 24);  if (d < 7)  return `${d} day${d > 1 ? 's' : ''} ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function istDateOf(iso) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(iso));
}

const inputCls = `w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white text-gray-900
                  placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-300 transition-all`;
const labelCls = 'text-xs font-semibold text-gray-500 mb-1 block';

// ══ Login ═══════════════════════════════════════════════════════════════════
function HubLogin({ onDone }) {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState('');

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await hubSignIn(email.trim(), password);
      onDone();
    } catch (err) {
      setError(err.message || 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4"
         style={{ background: 'linear-gradient(160deg, #061310 0%, #0a2a20 52%, #05110d 100%)' }}>
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <img src="/pocketlink-logo.svg" alt="PocketLink" className="h-9 w-auto mx-auto brightness-0 invert" />
          <p className="text-white/55 text-sm mt-2 font-semibold">Sales Hub · team sign-in</p>
        </div>
        <form onSubmit={submit}
              className="rounded-3xl border border-white/10 bg-white/[0.06] backdrop-blur-xl p-6 space-y-4 shadow-2xl">
          <div>
            <label className="text-xs font-bold text-white/75 mb-2 block">Email</label>
            <input type="email" value={email} onChange={(e) => { setEmail(e.target.value); setError(''); }}
                   autoFocus required placeholder="you@example.com"
                   className="w-full bg-white rounded-xl px-4 py-3 text-sm text-gray-900 placeholder-gray-400 shadow-md
                              focus:outline-none focus:ring-4 focus:ring-emerald-400/40 transition-all" />
          </div>
          <div>
            <label className="text-xs font-bold text-white/75 mb-2 block">Password</label>
            <input type="password" value={password} onChange={(e) => { setPassword(e.target.value); setError(''); }}
                   required placeholder="••••••••"
                   className="w-full bg-white rounded-xl px-4 py-3 text-sm text-gray-900 placeholder-gray-400 shadow-md
                              focus:outline-none focus:ring-4 focus:ring-emerald-400/40 transition-all" />
          </div>
          {error && <p className="text-xs text-red-300">{error}</p>}
          <button type="submit" disabled={busy || !email || !password}
                  className="w-full py-3.5 rounded-xl text-sm font-bold text-white bg-[#25D366] hover:bg-[#1ebe5d]
                             transition-all active:scale-[0.98] shadow-lg shadow-emerald-500/30
                             disabled:opacity-40 disabled:cursor-not-allowed">
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <p className="text-center text-[11px] text-white/35 mt-4">Internal tool — team accounts only.</p>
      </div>
    </div>
  );
}

// ══ Small pieces ═════════════════════════════════════════════════════════════
function Kpi({ label, value, sub }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white shadow-sm p-4">
      <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">{label}</p>
      <p className="text-2xl font-extrabold text-gray-900 mt-1 tabular-nums">{value}</p>
      {sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function StatusChip({ status }) {
  const st = STATUS[status] || STATUS.new;
  return <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${st.cls}`}>{st.label}</span>;
}

function CallWa({ phone, waText = '' }) {
  const p = String(phone || '').replace(/\D/g, '').slice(-10);
  if (!p) return null;
  return (
    <div className="flex items-center gap-2">
      <a href={`https://wa.me/91${p}${waText ? `?text=${encodeURIComponent(waText)}` : ''}`}
         target="_blank" rel="noopener noreferrer"
         className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs font-bold text-white py-2 rounded-xl active:scale-95"
         style={{ backgroundColor: '#25D366' }}>
        <MessageCircle size={14} /> WhatsApp
      </a>
      <a href={`tel:+91${p}`}
         className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs font-semibold text-gray-600 border border-gray-200 py-2 rounded-xl hover:bg-gray-50 active:scale-95">
        <Phone size={13} /> Call
      </a>
    </div>
  );
}

// ══ Lead form ════════════════════════════════════════════════════════════════
function LeadForm({ me, team, initial, onSaved, onCancel }) {
  const [form, setForm] = useState(initial ?? { ...EMPTY_LEAD });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const editing = Boolean(initial?.id);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const won = form.status === 'won-paid' || form.status === 'won-free';

  async function submit(e) {
    e.preventDefault();
    if (!form.business_name.trim() || form.phone.replace(/\D/g, '').length !== 10) {
      setError('Business name and a 10-digit phone are required.');
      return;
    }
    setBusy(true); setError('');
    try {
      const row = {
        business_name: form.business_name.trim(),
        owner_name:    form.owner_name.trim() || null,
        phone:         form.phone.replace(/\D/g, '').slice(-10),
        category:      form.category || null,
        city:          form.city.trim() || null,
        area:          form.area.trim() || null,
        source:        form.source || null,
        status:        form.status,
        plan:          won ? (form.plan || null) : null,
        amount:        won && form.amount !== '' ? Number(form.amount) : null,
        reasons:       won && form.reasons.length ? form.reasons : null,
        objection:     form.objection.trim() || null,
        next_follow_up: form.next_follow_up || null,
        priority:      form.priority || null,
        notes:         form.notes.trim() || null,
        assigned_to:   form.assigned_to ?? me.user_id,
      };
      if (editing) {
        onSaved(await updateLead(initial.id, row));
      } else {
        onSaved(await addLead({ ...row, created_by: me.user_id }));
      }
    } catch (err) {
      setError(err.message || 'Could not save the lead.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-gray-100 bg-white shadow-sm p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-extrabold text-gray-900">{editing ? 'Edit lead' : 'New lead'}</h3>
        <button type="button" onClick={onCancel} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100"><X size={16} /></button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 sm:col-span-1">
          <label className={labelCls}>Business name *</label>
          <input value={form.business_name} onChange={(e) => set('business_name', e.target.value)} placeholder="ABC Bakery" className={inputCls} autoFocus />
        </div>
        <div className="col-span-2 sm:col-span-1">
          <label className={labelCls}>Owner name</label>
          <input value={form.owner_name} onChange={(e) => set('owner_name', e.target.value)} placeholder="Full name" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Phone *</label>
          <input value={form.phone} inputMode="numeric"
                 onChange={(e) => set('phone', e.target.value.replace(/\D/g, '').slice(0, 10))}
                 placeholder="10-digit" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Category</label>
          <select value={form.category} onChange={(e) => set('category', e.target.value)} className={inputCls}>
            <option value="">Select…</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>City</label>
          <input value={form.city} onChange={(e) => set('city', e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Area</label>
          <input value={form.area} onChange={(e) => set('area', e.target.value)} placeholder="Locality" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Source</label>
          <select value={form.source} onChange={(e) => set('source', e.target.value)} className={inputCls}>
            <option value="">Select…</option>
            {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Status</label>
          <select value={form.status} onChange={(e) => set('status', e.target.value)} className={inputCls}>
            {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
      </div>

      {won && (
        <div className="rounded-xl bg-emerald-50/60 border border-emerald-100 p-3.5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Plan</label>
              <select value={form.plan} onChange={(e) => set('plan', e.target.value)} className={inputCls}>
                <option value="">Select…</option>
                <option value="free">Free</option>
                <option value="business">Growth ₹199</option>
                <option value="premium">Pro ₹599</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>₹ collected (if direct)</label>
              <input value={form.amount} inputMode="numeric"
                     onChange={(e) => set('amount', e.target.value.replace(/\D/g, ''))}
                     placeholder="0" className={inputCls} />
            </div>
          </div>
          <div>
            <label className={labelCls}>Why they bought (tap all that apply)</label>
            <div className="flex flex-wrap gap-1.5">
              {REASONS.map((r) => {
                const on = form.reasons.includes(r);
                return (
                  <button key={r} type="button"
                          onClick={() => set('reasons', on ? form.reasons.filter((x) => x !== r) : [...form.reasons, r])}
                          className={[
                            'text-[11px] font-semibold px-2.5 py-1 rounded-full border transition',
                            on ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300',
                          ].join(' ')}>
                    {on && <Check size={10} className="inline mr-0.5 -mt-0.5" />}{r}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {(form.status === 'lost' || form.status === 'won-free') && (
        <div>
          <label className={labelCls}>{form.status === 'lost' ? 'Why not? (objection)' : 'Why free instead of paid?'}</label>
          <input value={form.objection} onChange={(e) => set('objection', e.target.value)}
                 placeholder="e.g. wants to try first / too expensive / partner decision" className={inputCls} />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Next follow-up</label>
          <input type="date" value={form.next_follow_up || ''} onChange={(e) => set('next_follow_up', e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Priority</label>
          <select value={form.priority || ''} onChange={(e) => set('priority', e.target.value)} className={inputCls}>
            <option value="">—</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>
      </div>

      {me.role === 'admin' && team.length > 1 && (
        <div>
          <label className={labelCls}>Assigned to</label>
          <select value={form.assigned_to ?? me.user_id} onChange={(e) => set('assigned_to', e.target.value)} className={inputCls}>
            {team.map((t) => <option key={t.user_id} value={t.user_id}>{t.name}</option>)}
          </select>
        </div>
      )}

      <div>
        <label className={labelCls}>Notes</label>
        <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={2}
                  placeholder="Anything worth remembering…" className={`${inputCls} resize-none`} />
      </div>

      {error && <p className="text-xs text-red-500">{error}</p>}
      <button type="submit" disabled={busy}
              className="w-full py-3 rounded-xl text-sm font-bold text-white shadow-sm transition-all
                         hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
              style={{ backgroundColor: EMERALD }}>
        {busy ? 'Saving…' : editing ? 'Save changes' : 'Add lead'}
      </button>
    </form>
  );
}

// ══ Lead card ════════════════════════════════════════════════════════════════
function LeadCard({ lead, team, onEdit, onQuickStatus }) {
  const assignee = team.find((t) => t.user_id === lead.assigned_to)?.name;
  return (
    <div className="rounded-2xl border border-gray-100 bg-white shadow-sm p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-extrabold text-gray-900 leading-tight truncate">{lead.business_name}</p>
          <p className="text-xs text-gray-500 mt-0.5 truncate">
            {[lead.owner_name, lead.category, lead.area || lead.city].filter(Boolean).join(' · ')}
          </p>
        </div>
        <StatusChip status={lead.status} />
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-[11px] text-gray-400">
        <span className="tabular-nums">+91 {lead.phone}</span>
        {lead.source && <span>via {lead.source}</span>}
        {assignee && <span>👤 {assignee}</span>}
        {lead.next_follow_up && <span>📅 {new Date(lead.next_follow_up).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>}
        {lead.plan && <span className="font-semibold text-emerald-600">{PLAN_NAME[lead.plan] || lead.plan}{lead.amount ? ` · ₹${lead.amount}` : ''}</span>}
      </div>

      {(lead.reasons?.length || lead.objection) && (
        <p className="mt-1.5 text-[11px] text-gray-500 line-clamp-2">
          {lead.reasons?.length ? `💡 ${lead.reasons.join(', ')}` : `🚫 ${lead.objection}`}
        </p>
      )}
      {lead.notes && <p className="mt-1 text-[11px] text-gray-400 line-clamp-2">📝 {lead.notes}</p>}

      <div className="mt-3 space-y-2">
        {OPEN_STATUSES.includes(lead.status) && (
          <div className="flex gap-2">
            {lead.status === 'new' && (
              <button onClick={() => onQuickStatus(lead, 'contacted')}
                      className="flex-1 text-xs font-bold text-white py-2 rounded-xl active:scale-95" style={{ backgroundColor: EMERALD }}>
                Mark contacted
              </button>
            )}
            {lead.status !== 'new' && (
              <button onClick={() => onQuickStatus(lead, 'won-paid')}
                      className="flex-1 text-xs font-bold text-white py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-95">
                Won · Paid 🎉
              </button>
            )}
            <button onClick={() => onEdit(lead)}
                    className="flex-1 text-xs font-semibold text-gray-600 border border-gray-200 py-2 rounded-xl hover:bg-gray-50 active:scale-95">
              Edit / update
            </button>
          </div>
        )}
        {!OPEN_STATUSES.includes(lead.status) && (
          <button onClick={() => onEdit(lead)}
                  className="w-full text-xs font-semibold text-gray-600 border border-gray-200 py-2 rounded-xl hover:bg-gray-50 active:scale-95">
            Edit / update
          </button>
        )}
        <CallWa phone={lead.phone}
                waText={`Hi${lead.owner_name ? ` ${lead.owner_name}` : ''}! This is PocketLink — following up on your online store for ${lead.business_name}. 😊`} />
      </div>
    </div>
  );
}

// ══ Main ═════════════════════════════════════════════════════════════════════
export default function SalesHub() {
  const [session, setSession] = useState(undefined);   // undefined = booting
  const [team, setTeam]       = useState(null);        // null = loading
  const [tab, setTab]         = useState('today');

  const [leads, setLeads]   = useState(null);
  const [stores, setStores] = useState([]);
  const [orders, setOrders] = useState([]);
  const [views, setViews]   = useState([]);

  const [showForm, setShowForm] = useState(false);
  const [editLead, setEditLead] = useState(null);
  const [q, setQ]               = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [refreshing, setRefreshing] = useState(false);
  const [scope, setScope] = useState('mine');   // 'mine' = my leads · 'all' = whole team

  useEffect(() => {
    document.title = 'Sales Hub · PocketLink';
    hubSession().then(setSession);
    return onHubAuthChange(setSession);
  }, []);

  const me = useMemo(
    () => (team || []).find((t) => t.user_id === session?.user?.id) ?? null,
    [team, session],
  );
  const isAdmin = me?.role === 'admin';

  const loadAll = useCallback(async () => {
    const [t, l, s, o, v] = await Promise.all([
      fetchTeam(),
      listLeads(),
      fetchStoresLite(),
      fetchRecentOrders(new Date(Date.now() - 7 * 86400000).toISOString()),
      fetchViewsSince(istDaysAgo(7)),
    ]);
    setTeam(t); setLeads(l); setStores(s); setOrders(o); setViews(v);
  }, []);

  useEffect(() => {
    if (session) loadAll();
  }, [session, loadAll]);

  // Execs keep the tab open all day — refetch quietly whenever they come back.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && session) loadAll();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [session, loadAll]);

  // Default an exec to their own work; an admin to the whole team.
  useEffect(() => { if (me?.user_id) setScope(me.role === 'admin' ? 'all' : 'mine'); }, [me?.user_id, me?.role]);


  const refresh = useCallback(async () => {
    setRefreshing(true);
    try { await loadAll(); } finally { setRefreshing(false); }
  }, [loadAll]);

  // ── Derived data ──
  const today = todayIST();

  // Sales members are locked to their own work; only an admin can view team-wide.
  const effScope = isAdmin ? scope : 'mine';
  const teamMap = useMemo(() => Object.fromEntries((team || []).map((t) => [t.user_id, t.name])), [team]);
  // Stores this view may see: null = all (admin "Team"); a Set of my assigned slugs otherwise.
  const myStoreSlugs = useMemo(
    () => (effScope === 'all' ? null : new Set(stores.filter((s) => s.mgr === me?.user_id).map((s) => s.slug))),
    [stores, effScope, me?.user_id],
  );
  const seeStore = useCallback((slug) => !myStoreSlugs || myStoreSlugs.has(slug), [myStoreSlugs]);

  // Leads scoped to the current view (mine vs whole team).
  const scopedLeads = useMemo(
    () => (effScope === 'all' ? (leads || []) : (leads || []).filter((x) => x.assigned_to === me?.user_id)),
    [leads, effScope, me?.user_id],
  );

  const kpis = useMemo(() => {
    const l = scopedLeads;
    const monthPrefix = today.slice(0, 7);
    const wonPaidMonth = l.filter((x) => x.status === 'won-paid' && istDateOf(x.created_at).startsWith(monthPrefix));
    return {
      leadsToday:      l.filter((x) => istDateOf(x.created_at) === today).length,
      followupsDue:    l.filter((x) => x.next_follow_up && x.next_follow_up <= today && OPEN_STATUSES.includes(x.status)).length,
      newStoresToday:  stores.filter((s) => seeStore(s.slug) && istDateOf(s.created_at) === today).length,
      ordersToday:     orders.filter((o) => seeStore(o.store_slug) && istDateOf(o.created_at) === today && Number(o.total) > 0).length,
      wonPaidMonth:    wonPaidMonth.length,
      collectedMonth:  wonPaidMonth.reduce((s, x) => s + (Number(x.amount) || 0), 0),
      renewals7:       stores.filter((s) => seeStore(s.slug) && s.exp && new Date(s.exp) > new Date() && new Date(s.exp) <= new Date(Date.now() + 7 * 86400000)).length,
      openLeads:       l.filter((x) => OPEN_STATUSES.includes(x.status)).length,
    };
  }, [scopedLeads, stores, orders, today, seeStore]);

  const perExec = useMemo(() => {
    const l = leads || [];
    return (team || []).map((t) => ({
      ...t,
      today:   l.filter((x) => x.assigned_to === t.user_id && istDateOf(x.created_at) === today).length,
      wonWeek: l.filter((x) => x.assigned_to === t.user_id && (x.status === 'won-paid' || x.status === 'won-free')
                            && new Date(x.updated_at) > new Date(Date.now() - 7 * 86400000)).length,
      open:    l.filter((x) => x.assigned_to === t.user_id && OPEN_STATUSES.includes(x.status)).length,
    }));
  }, [team, leads, today]);

  const storeName = useCallback(
    (slug) => stores.find((s) => s.slug === slug)?.name || slug,
    [stores],
  );

  const feed = useMemo(() => {
    const ev = [];
    for (const s of stores) {
      if (seeStore(s.slug) && new Date(s.created_at) > new Date(Date.now() - 7 * 86400000)) {
        ev.push({ at: s.created_at, icon: '🏪', text: `New store registered — ${s.name || s.slug}`, sub: `${PLAN_NAME[s.plan] || s.plan || 'Free'}${s.city ? ` · ${s.city}` : ''}` });
      }
    }
    for (const o of orders) {
      if (!seeStore(o.store_slug)) continue;
      ev.push(Number(o.total) > 0
        ? { at: o.created_at, icon: '🛒', text: `Order ₹${Number(o.total).toLocaleString('en-IN')} — ${storeName(o.store_slug)}`, sub: `${o.item_count} item${o.item_count === 1 ? '' : 's'} · ${o.customer_name || 'customer'}` }
        : { at: o.created_at, icon: '💼', text: `Quote lead — ${storeName(o.store_slug)}`, sub: o.customer_name || 'customer' });
    }
    return ev.sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 40);
  }, [stores, orders, storeName, seeStore]);

  const health = useMemo(() => {
    const map = {};
    for (const s of stores) if (seeStore(s.slug)) map[s.slug] = { ...s, views7: 0, orders7: 0, rev7: 0 };
    for (const v of views)  { if (map[v.store_slug]) map[v.store_slug].views7 += 1; }
    for (const o of orders) {
      if (!map[o.store_slug]) continue;
      map[o.store_slug].orders7 += 1;
      map[o.store_slug].rev7 += Number(o.total) || 0;
    }
    return Object.values(map).sort((a, b) => b.views7 - a.views7);
  }, [stores, views, orders, seeStore]);

  const followBuckets = useMemo(() => {
    const l = scopedLeads.filter((x) => x.next_follow_up && OPEN_STATUSES.includes(x.status));
    return {
      overdue:  l.filter((x) => x.next_follow_up <  today).sort((a, b) => a.next_follow_up.localeCompare(b.next_follow_up)),
      today:    l.filter((x) => x.next_follow_up === today),
      upcoming: l.filter((x) => x.next_follow_up >  today).sort((a, b) => a.next_follow_up.localeCompare(b.next_follow_up)).slice(0, 30),
    };
  }, [scopedLeads, today]);

  const renewBuckets = useMemo(() => {
    const now = Date.now();
    const withExp = stores.filter((s) => seeStore(s.slug) && s.exp && s.plan && s.plan !== 'free');
    const days = (s) => Math.ceil((new Date(s.exp).getTime() - now) / 86400000);
    return {
      expired: withExp.filter((s) => days(s) <= 0).sort((a, b) => new Date(b.exp) - new Date(a.exp)).slice(0, 25),
      d7:      withExp.filter((s) => days(s) > 0  && days(s) <= 7).sort((a, b) => new Date(a.exp) - new Date(b.exp)),
      d15:     withExp.filter((s) => days(s) > 7  && days(s) <= 15).sort((a, b) => new Date(a.exp) - new Date(b.exp)),
      d30:     withExp.filter((s) => days(s) > 15 && days(s) <= 30).sort((a, b) => new Date(a.exp) - new Date(b.exp)),
    };
  }, [stores, seeStore]);

  const visibleLeads = useMemo(() => {
    let l = scopedLeads;
    if (statusFilter !== 'all') l = l.filter((x) => x.status === statusFilter);
    const needle = q.trim().toLowerCase();
    if (needle) {
      l = l.filter((x) =>
        [x.business_name, x.owner_name, x.phone, x.category, x.city, x.area]
          .filter(Boolean).some((f) => String(f).toLowerCase().includes(needle)));
    }
    return l;
  }, [scopedLeads, statusFilter, q]);

  async function quickStatus(lead, status) {
    const updated = await updateLead(lead.id, { status }).catch(() => null);
    if (updated) setLeads((ls) => ls.map((x) => (x.id === lead.id ? updated : x)));
  }

  async function followAction(lead, patch) {
    const updated = await updateLead(lead.id, patch).catch(() => null);
    if (updated) setLeads((ls) => ls.map((x) => (x.id === lead.id ? updated : x)));
  }

  // ── Gates ──
  if (session === undefined) {
    return <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-8 h-8 border-4 border-gray-200 border-t-gray-700 rounded-full animate-spin" />
    </div>;
  }
  if (!session) return <HubLogin onDone={() => hubSession().then(setSession)} />;
  if (team !== null && !me) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="rounded-2xl border border-gray-100 bg-white shadow-sm p-8 text-center max-w-sm">
          <p className="text-3xl mb-2">🔒</p>
          <p className="font-extrabold text-gray-900">Not authorized</p>
          <p className="text-sm text-gray-500 mt-1.5">This account isn’t on the sales team. Ask the admin to add you in crm_team.</p>
          <button onClick={() => hubSignOut()} className="mt-5 text-sm font-bold text-gray-600 border border-gray-200 px-4 py-2 rounded-xl hover:bg-gray-50">
            Sign out
          </button>
        </div>
      </div>
    );
  }

  const TABS = [
    { key: 'today',    label: 'Today',      icon: LayoutDashboard },
    { key: 'activity', label: 'Activity',   icon: Activity },
    { key: 'leads',    label: 'Leads',      icon: Users },
    { key: 'follow',   label: 'Follow-ups', icon: CalendarClock, badge: kpis.followupsDue },
    { key: 'renew',    label: 'Renewals',   icon: RefreshCw, badge: kpis.renewals7 },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100/40">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-md border-b border-gray-100 sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center gap-3">
          <img src="/pocketlink-logo.svg" alt="PocketLink" className="h-7 w-auto" />
          <span className="text-sm font-extrabold text-gray-900">Sales Hub</span>
          <div className="flex-1" />
          {me && (
            <span className="hidden sm:inline-flex items-center gap-1.5 text-xs font-semibold bg-emerald-50 border border-emerald-200 text-emerald-700 px-3 py-1.5 rounded-full">
              {me.name}{isAdmin ? ' · admin' : ''}
            </span>
          )}
          <button onClick={refresh} aria-label="Refresh" disabled={refreshing}
                  className="p-2 rounded-xl text-gray-500 hover:bg-gray-100 transition-colors disabled:opacity-50">
            <RefreshCw size={17} className={refreshing ? 'animate-spin' : ''} />
          </button>
          <button onClick={() => hubSignOut()} aria-label="Sign out"
                  className="p-2 rounded-xl text-gray-500 hover:bg-gray-100 transition-colors">
            <LogOut size={18} />
          </button>
        </div>
      </header>

      {/* Tabs */}
      <div className="max-w-5xl mx-auto px-4 pt-4">
        <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-1 px-1 pb-1">
          {TABS.map(({ key, label, icon: Icon, badge }) => {
            const active = tab === key;
            return (
              <button key={key} onClick={() => setTab(key)}
                className={[
                  'flex-shrink-0 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold border transition',
                  active ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300',
                ].join(' ')}>
                <Icon size={14} /> {label}
                {badge > 0 && (
                  <span className={`min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center ${active ? 'bg-white text-gray-900' : 'bg-red-500 text-white'}`}>
                    {badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* My-work / Team scope — admin only; sales members are locked to their own */}
      {isAdmin && team && team.length > 1 && ['today', 'leads', 'follow', 'activity', 'renew'].includes(tab) && (
        <div className="max-w-5xl mx-auto px-4 pt-3 flex justify-end">
          <div className="inline-flex rounded-full border border-gray-200 bg-white overflow-hidden text-[11px] font-bold">
            <button onClick={() => setScope('mine')}
              className={scope === 'mine' ? 'bg-gray-900 text-white px-3.5 py-1.5' : 'text-gray-600 px-3.5 py-1.5 hover:bg-gray-50'}>My work</button>
            <button onClick={() => setScope('all')}
              className={scope === 'all' ? 'bg-gray-900 text-white px-3.5 py-1.5' : 'text-gray-600 px-3.5 py-1.5 hover:bg-gray-50'}>Team</button>
          </div>
        </div>
      )}

      <main className="max-w-5xl mx-auto px-4 py-5 pb-24">
        {leads === null ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="rounded-2xl border border-gray-100 bg-white p-4 animate-pulse">
                <div className="h-3.5 w-1/3 bg-gray-200 rounded mb-3" />
                <div className="h-3 w-2/3 bg-gray-100 rounded" />
              </div>
            ))}
          </div>
        ) : tab === 'today' ? (
          <div className="space-y-5 animate-pl-fade-up">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Kpi label="Leads today"      value={kpis.leadsToday} />
              <Kpi label="Follow-ups due"   value={kpis.followupsDue} sub={kpis.followupsDue > 0 ? 'open the Follow-ups tab' : 'all clear'} />
              <Kpi label="New stores today" value={kpis.newStoresToday} />
              <Kpi label="Orders today"     value={kpis.ordersToday} sub="across all stores" />
              <Kpi label="Won · paid (month)" value={kpis.wonPaidMonth} />
              {isAdmin && <Kpi label="₹ collected (month)" value={`₹${kpis.collectedMonth.toLocaleString('en-IN')}`} sub="logged in leads" />}
              <Kpi label="Open leads"       value={kpis.openLeads} />
              <Kpi label="Renewals ≤ 7 days" value={kpis.renewals7} />
            </div>

            {isAdmin && scope === 'all' && perExec.length > 0 && (
              <div className="rounded-2xl border border-gray-100 bg-white shadow-sm p-5">
                <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-3">Team today</p>
                <div className="space-y-2.5">
                  {perExec.map((t) => (
                    <div key={t.user_id} className="flex items-center justify-between text-sm">
                      <span className="font-semibold text-gray-800">{t.name}{t.role === 'admin' ? ' ✦' : ''}</span>
                      <span className="text-xs text-gray-500 tabular-nums">
                        {t.today} lead{t.today === 1 ? '' : 's'} today · {t.open} open · {t.wonWeek} won this week
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <button onClick={() => { setEditLead(null); setShowForm(true); setTab('leads'); }}
                    className="w-full inline-flex items-center justify-center gap-2 py-3.5 rounded-xl text-sm font-bold text-white shadow-sm active:scale-[0.98]"
                    style={{ backgroundColor: EMERALD }}>
              <Plus size={16} /> Add a lead
            </button>
          </div>
        ) : tab === 'activity' ? (
          <div className="space-y-5 animate-pl-fade-up">
            <div className="rounded-2xl border border-gray-100 bg-white shadow-sm p-5">
              <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-3">Last 7 days — live feed</p>
              {feed.length === 0 ? (
                <p className="text-sm text-gray-400 py-4 text-center">No activity yet this week.</p>
              ) : (
                <div className="space-y-3">
                  {feed.map((e, i) => (
                    <div key={i} className="flex items-start gap-3">
                      <span className="text-lg leading-none mt-0.5">{e.icon}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-800 leading-tight truncate">{e.text}</p>
                        <p className="text-[11px] text-gray-400">{e.sub} · {timeAgo(e.at)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
              <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400 px-5 pt-4 pb-2">
                Store health — views · orders (7 days)
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] text-gray-400 border-b border-gray-100">
                      <th className="px-5 py-2 font-semibold">Store</th>
                      <th className="px-3 py-2 font-semibold">Plan</th>
                      <th className="px-3 py-2 font-semibold text-right">Views</th>
                      <th className="px-3 py-2 font-semibold text-right">Orders</th>
                      <th className="px-5 py-2 font-semibold text-right">₹ (7d)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {health.slice(0, 25).map((s) => (
                      <tr key={s.slug} className="border-b border-gray-50 last:border-0">
                        <td className="px-5 py-2.5">
                          <a href={`/${s.slug}`} target="_blank" rel="noopener noreferrer" className="font-semibold text-gray-800 hover:text-emerald-700">
                            {s.name || s.slug}
                          </a>
                          {s.city && <span className="text-[11px] text-gray-400 ml-1.5">{s.city}</span>}
                          {isAdmin && effScope === 'all' && s.mgr && <span className="text-[11px] text-gray-400 ml-1.5">· 👤 {teamMap[s.mgr] || 'assigned'}</span>}
                        </td>
                        <td className="px-3 py-2.5 text-xs text-gray-500">{PLAN_NAME[s.plan] || s.plan || 'Free'}{s.sub ? ' ✓' : ''}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums font-semibold text-gray-800">{s.views7}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-gray-600">{s.orders7}</td>
                        <td className="px-5 py-2.5 text-right tabular-nums text-gray-600">{s.rev7 > 0 ? `₹${s.rev7.toLocaleString('en-IN')}` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-gray-400 px-5 py-3">✓ = active paid subscription · views are unique visitors/day · sorted by reach</p>
            </div>
          </div>
        ) : tab === 'leads' ? (
          <div className="space-y-4 animate-pl-fade-up">
            {showForm ? (
              <LeadForm me={me} team={team || []} initial={editLead}
                        onSaved={(saved) => {
                          setLeads((ls) => {
                            const exists = ls.some((x) => x.id === saved.id);
                            return exists ? ls.map((x) => (x.id === saved.id ? saved : x)) : [saved, ...ls];
                          });
                          setShowForm(false); setEditLead(null);
                        }}
                        onCancel={() => { setShowForm(false); setEditLead(null); }} />
            ) : (
              <button onClick={() => { setEditLead(null); setShowForm(true); }}
                      className="w-full inline-flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold text-white shadow-sm active:scale-[0.98]"
                      style={{ backgroundColor: EMERALD }}>
                <Plus size={16} /> New lead
              </button>
            )}

            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search business, owner, phone…"
                       className={`${inputCls} pl-8`} />
              </div>
            </div>
            <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-1 px-1">
              {['all', ...Object.keys(STATUS)].map((k) => {
                const active = statusFilter === k;
                const n = k === 'all' ? scopedLeads.length : scopedLeads.filter((x) => x.status === k).length;
                return (
                  <button key={k} onClick={() => setStatusFilter(k)}
                    className={[
                      'flex-shrink-0 px-3 py-1.5 rounded-full text-[11px] font-bold border transition',
                      active ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200',
                    ].join(' ')}>
                    {k === 'all' ? 'All' : STATUS[k].label} {n > 0 && <span className={active ? 'opacity-70' : 'text-gray-400'}>({n})</span>}
                  </button>
                );
              })}
            </div>

            {visibleLeads.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50/50 p-10 text-center">
                <div className="text-4xl mb-3">🎯</div>
                <p className="font-bold text-gray-800">No leads here yet</p>
                <p className="text-sm text-gray-400 mt-1">Every shop you pitch goes in — wins AND losses. The objections are the gold.</p>
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 gap-3 items-start">
                {visibleLeads.map((l) => (
                  <LeadCard key={l.id} lead={l} team={team || []}
                            onEdit={(lead) => {
                              setEditLead(leadToForm(lead));
                              setShowForm(true);
                              window.scrollTo({ top: 0, behavior: 'smooth' });
                            }}
                            onQuickStatus={quickStatus} />
                ))}
              </div>
            )}
          </div>
        ) : tab === 'follow' ? (
          <div className="space-y-5 animate-pl-fade-up">
            {[['🔴 Overdue', followBuckets.overdue], ['📅 Today', followBuckets.today], ['🔜 Upcoming', followBuckets.upcoming]].map(([title, list]) => (
              <div key={title}>
                <p className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-2">{title} ({list.length})</p>
                {list.length === 0 ? (
                  <p className="text-sm text-gray-400 rounded-2xl border border-dashed border-gray-200 bg-gray-50/50 p-4 text-center">Nothing here 🎉</p>
                ) : (
                  <div className="space-y-2.5">
                    {list.map((l) => (
                      <div key={l.id} className="rounded-2xl border border-gray-100 bg-white shadow-sm p-4">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-extrabold text-gray-900 leading-tight truncate">{l.business_name}</p>
                            <p className="text-[11px] text-gray-400 mt-0.5">
                              {new Date(l.next_follow_up).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                              {l.priority ? ` · ${l.priority} priority` : ''} · {(team || []).find((t) => t.user_id === l.assigned_to)?.name || '—'}
                            </p>
                          </div>
                          <StatusChip status={l.status} />
                        </div>
                        <div className="mt-3 flex gap-2">
                          <button onClick={() => followAction(l, { next_follow_up: null })}
                                  className="flex-1 text-xs font-bold text-white py-2 rounded-xl active:scale-95" style={{ backgroundColor: EMERALD }}>
                            <Check size={12} className="inline -mt-0.5 mr-1" />Done
                          </button>
                          <button onClick={() => followAction(l, { next_follow_up: istDaysAgo(-1) })}
                                  className="flex-1 text-xs font-semibold text-gray-600 border border-gray-200 py-2 rounded-xl hover:bg-gray-50 active:scale-95">
                            +1 day
                          </button>
                          <button onClick={() => followAction(l, { next_follow_up: istDaysAgo(-3) })}
                                  className="flex-1 text-xs font-semibold text-gray-600 border border-gray-200 py-2 rounded-xl hover:bg-gray-50 active:scale-95">
                            +3 days
                          </button>
                        </div>
                        <div className="mt-2">
                          <CallWa phone={l.phone} waText={`Hi${l.owner_name ? ` ${l.owner_name}` : ''}! Following up about the online store for ${l.business_name} 😊`} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-5 animate-pl-fade-up">
            {[['⏰ Expiring in 7 days', renewBuckets.d7], ['📆 8–15 days', renewBuckets.d15], ['🗓️ 16–30 days', renewBuckets.d30], ['❌ Expired', renewBuckets.expired]].map(([title, list]) => (
              <div key={title}>
                <p className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-2">{title} ({list.length})</p>
                {list.length === 0 ? (
                  <p className="text-sm text-gray-400 rounded-2xl border border-dashed border-gray-200 bg-gray-50/50 p-4 text-center">None</p>
                ) : (
                  <div className="space-y-2.5">
                    {list.map((s) => {
                      const waRenew = `Hi! Your PocketLink ${PLAN_NAME[s.plan] || s.plan} plan for ${s.name || s.slug} ${new Date(s.exp) < new Date() ? 'has expired' : `expires on ${new Date(s.exp).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`}. Renew from just ₹199/mo and keep everything running: https://www.pocketlink.store/plans 😊`;
                      return (
                        <div key={s.slug} className="rounded-2xl border border-gray-100 bg-white shadow-sm p-4">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <a href={`/${s.slug}`} target="_blank" rel="noopener noreferrer"
                                 className="font-extrabold text-gray-900 leading-tight truncate hover:text-emerald-700 inline-flex items-center gap-1.5">
                                <Store size={14} className="text-gray-400" /> {s.name || s.slug}
                              </a>
                              <p className="text-[11px] text-gray-400 mt-0.5">
                                {PLAN_NAME[s.plan] || s.plan}{s.sub ? ' · auto-pay ✓' : ' · manual/coupon'}
                                {' · '}{new Date(s.exp) < new Date() ? 'expired' : 'expires'} {new Date(s.exp).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                                {isAdmin && effScope === 'all' && s.mgr ? ` · 👤 ${teamMap[s.mgr] || 'assigned'}` : ''}
                              </p>
                            </div>
                            {s.sub
                              ? <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 whitespace-nowrap">auto-renews</span>
                              : <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 whitespace-nowrap">needs renewal</span>}
                          </div>
                          {!s.sub && (
                            <div className="mt-3">
                              <CallWa phone={s.wa} waText={waRenew} />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
            <p className="text-[11px] text-gray-400 text-center">
              Derived live from every store’s plan expiry — nothing to enter manually. “auto-renews” = active Razorpay mandate.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}

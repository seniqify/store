import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  LayoutDashboard, Store as StoreIcon, LogOut, Search, RefreshCw, X, Check,
  ShieldAlert, ExternalLink, Moon, Sun, AlertTriangle, TrendingUp,
  CalendarClock, MessageCircle, Wallet, Send, Sparkles, Box, Users,
} from 'lucide-react';
import {
  consoleSession, onConsoleAuthChange, consoleSignIn, consoleSignOut,
  fetchMyTeamRow, fetchStoresConsole, fetchConsoleOrders, fetchTeam,
  consoleUpdateStore, askAssistant, manageTeam, yearsFromNowIso,
} from '../utils/consoleService';
import { formatINR } from '../utils/currency';

/**
 * PocketLink Console — founder mission-control (hidden route /console).
 * Supabase-auth gated, restricted to crm_team role = 'admin' (the founder).
 * A dark "mission control" cockpit: nav rail + Overview · Stores · Growth ·
 * Renewals · Billing · Orders · Access · an AI Assistant. Every write goes
 * through the admin-gated, audit-logged console_update_store RPC.
 */

const PLAN_NAME  = { free: 'Free', starter: 'Starter', business: 'Growth', premium: 'Pro', pro: 'Pro (legacy)' };
const SELECTABLE = ['free', 'business', 'premium'];
const PAID = new Set(['starter', 'business', 'pro', 'premium']);
const DAY = 86400000;

// dark palette (near-black, warm-green tint) reused across the cockpit
const BG = '#0a0f0c', PANEL = '#131c17', ELEV = '#1b241e';
const LINE = 'border-white/[0.07]';
const INK = 'text-[#eef4f0]', BODY = 'text-[#c3d3ca]', DIM = 'text-[#8b9d93]', FAINT = 'text-[#5d6e64]';
const CARD = `rounded-2xl border ${LINE}`;

// ── helpers ───────────────────────────────────────────────────────────────────
function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
function timeAgo(iso) {
  if (!iso) return '';
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60); if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24); return `${d}d`;
}
function storeStatus(s) {
  const plan = s.plan || 'free';
  const exp  = s.exp ? new Date(s.exp).getTime() : null;
  const now  = Date.now();
  if (!PAID.has(plan))             return { key: 'free',     label: 'Free',     cls: 'bg-white/[0.06] text-[#8b9d93]' };
  if (exp && exp < now)            return { key: 'expired',  label: 'Expired',  cls: 'bg-rose-500/15 text-rose-300' };
  if (exp && exp - now < 14 * DAY) return { key: 'expiring', label: 'Expiring', cls: 'bg-amber-500/15 text-amber-300' };
  return { key: 'active', label: 'Active', cls: 'bg-emerald-500/15 text-emerald-300' };
}
function planBadgeCls(plan) {
  if (plan === 'premium') return 'bg-emerald-500 text-[#06120b]';
  if (plan === 'business') return 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/25';
  return 'bg-white/[0.06] text-[#8b9d93]';
}
function daysLeft(iso) { return iso ? Math.ceil((new Date(iso).getTime() - Date.now()) / DAY) : null; }
function nudgeLink(s) {
  const digits = String(s.wa || '').replace(/\D/g, '');
  if (!digits) return null;
  const phone = digits.length === 10 ? `91${digits}` : digits;
  const msg = `Hi 👋 Your *${s.name || 'store'}* ${PLAN_NAME[s.plan] || ''} plan on PocketLink `
    + `expired${s.exp ? ` on ${fmtDate(s.exp)}` : ''}. Renew now to keep your online store & `
    + `WhatsApp orders live — reply here and I'll set it up for you. 🙏`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
}
function rowFromConfig(s, cfg) {
  if (!cfg || typeof cfg !== 'object') return s;
  return { ...s, plan: cfg.plan ?? s.plan, exp: cfg.planExpiresAt ?? null, theme: cfg.theme ?? s.theme, billing: cfg.billingNote ?? s.billing };
}

const darkInput = `w-full rounded-xl px-3 py-2.5 text-sm bg-[#0d1310] border border-white/[0.09] text-[#eef4f0]
                   placeholder-[#5d6e64] focus:outline-none focus:border-emerald-500/50 transition`;

// ══ Login ═════════════════════════════════════════════════════════════════════
function ConsoleLogin({ onDone }) {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState('');
  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError('');
    try { await consoleSignIn(email.trim(), password); onDone(); }
    catch (err) { setError(err.message || 'Sign-in failed'); }
    finally { setBusy(false); }
  }
  return (
    <div className="min-h-screen flex items-center justify-center px-4"
         style={{ background: 'linear-gradient(160deg,#061310 0%,#06251c 55%,#05100c 100%)' }}>
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="text-2xl font-extrabold text-white tracking-tight">PocketLink <span className="text-white/45 font-semibold">Console</span></div>
          <p className="text-white/50 text-sm mt-2 font-semibold">Founder sign-in</p>
        </div>
        <form onSubmit={submit} className="rounded-3xl border border-white/10 bg-white/[0.06] backdrop-blur-xl p-6 space-y-4 shadow-2xl">
          <div>
            <label className="text-xs font-bold text-white/75 mb-2 block">Email</label>
            <input type="email" value={email} autoFocus required placeholder="you@example.com"
                   onChange={(e) => { setEmail(e.target.value); setError(''); }}
                   className="w-full bg-white rounded-xl px-4 py-3 text-sm text-gray-900 placeholder-gray-400 shadow-md focus:outline-none focus:ring-4 focus:ring-emerald-400/40 transition" />
          </div>
          <div>
            <label className="text-xs font-bold text-white/75 mb-2 block">Password</label>
            <input type="password" value={password} required placeholder="••••••••"
                   onChange={(e) => { setPassword(e.target.value); setError(''); }}
                   className="w-full bg-white rounded-xl px-4 py-3 text-sm text-gray-900 placeholder-gray-400 shadow-md focus:outline-none focus:ring-4 focus:ring-emerald-400/40 transition" />
          </div>
          {error && <p className="text-xs text-rose-300">{error}</p>}
          <button type="submit" disabled={busy || !email || !password}
                  className="w-full py-3.5 rounded-xl text-sm font-bold text-white bg-emerald-500 hover:bg-emerald-600 transition active:scale-[0.98] shadow-lg shadow-emerald-500/30 disabled:opacity-40">
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ══ pieces ════════════════════════════════════════════════════════════════════
function Tile({ label, value, sub, tone }) {
  const toneCls = tone === 'amber' ? 'text-amber-400' : tone === 'rose' ? 'text-rose-400' : 'text-white';
  return (
    <div className={`${CARD} p-4`} style={{ background: PANEL }}>
      <p className={`text-xs font-semibold ${DIM}`}>{label}</p>
      <p className={`text-2xl font-extrabold mt-1 tabular-nums ${toneCls}`}>{value}</p>
      {sub && <p className={`text-[11px] ${FAINT} mt-0.5`}>{sub}</p>}
    </div>
  );
}
function MixBars({ rows }) {
  const max = Math.max(1, ...rows.map((r) => r[1]));
  return (
    <div className="space-y-2.5">
      {rows.map(([label, val, color]) => (
        <div key={label} className="flex items-center gap-3">
          <span className={`text-xs font-semibold ${BODY} w-16 flex-shrink-0`}>{label}</span>
          <div className="flex-1 h-2.5 rounded-full bg-white/[0.06] overflow-hidden">
            <div className="h-full rounded-full transition-all" style={{ width: `${(val / max) * 100}%`, background: color }} />
          </div>
          <span className={`text-xs font-bold ${INK} tabular-nums w-8 text-right`}>{val}</span>
        </div>
      ))}
    </div>
  );
}
function Panel({ title, icon: Icon, count, right, children }) {
  return (
    <div className={`${CARD} overflow-hidden`} style={{ background: PANEL }}>
      {title && (
        <div className={`flex items-center gap-2 px-4 py-3 border-b ${LINE}`}>
          {Icon && <Icon size={15} className="text-emerald-400" />}
          <h3 className={`text-sm font-bold ${INK}`}>{title}</h3>
          {count != null && <span className={`text-xs ${FAINT}`}>{count}</span>}
          {right && <span className={`ml-auto text-[11px] ${FAINT}`}>{right}</span>}
        </div>
      )}
      {children}
    </div>
  );
}

// ══ Plan / payment modal ══════════════════════════════════════════════════════
function PlanModal({ store, onClose, onApply, busy }) {
  const [plan, setPlan]     = useState(store.plan && SELECTABLE.includes(store.plan) ? store.plan : 'premium');
  const [term, setTerm]     = useState('1y');
  const [customDate, setCustomDate] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const isPaid = PAID.has(plan);
  function expiryIso() {
    if (!isPaid) return null;
    if (term === '1y') return yearsFromNowIso(1);
    if (term === '1m') return new Date(Date.now() + 30 * DAY).toISOString();
    if (term === 'custom' && customDate) return new Date(`${customDate}T18:30:00Z`).toISOString();
    return null;
  }
  function submit() {
    const exp = expiryIso();
    const patch = { plan, planExpiresAt: isPaid ? exp : null };
    const amt = Number(amount);
    if (isPaid && amt > 0) patch.billingNote = {
      plan, planName: PLAN_NAME[plan], amount: amt, currency: 'INR', method,
      term: term === 'custom' ? 'custom' : term, collected: true,
      startedAt: new Date().toISOString().slice(0, 10), expiresAt: exp ? exp.slice(0, 10) : null, setBy: 'console',
    };
    onApply(store.slug, patch, 'plan-change');
  }
  const exp = expiryIso();
  const seg = (on) => `flex-1 py-2.5 rounded-xl text-sm font-bold border transition ${on ? 'border-emerald-500 bg-emerald-500/15 text-emerald-300' : 'border-white/[0.08] text-[#8b9d93] hover:border-white/20'}`;
  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/60 px-3 py-6" onClick={onClose}>
      <div className={`w-full max-w-md ${CARD} shadow-2xl overflow-hidden`} style={{ background: '#0f1712' }} onClick={(e) => e.stopPropagation()}>
        <div className={`flex items-center justify-between px-5 py-4 border-b ${LINE}`}>
          <div>
            <p className={`text-xs ${FAINT} font-semibold`}>Manage plan</p>
            <h3 className={`text-base font-extrabold ${INK} truncate max-w-[16rem]`}>{store.name || store.slug}</h3>
          </div>
          <button onClick={onClose} className={`p-2 rounded-xl hover:bg-white/[0.06] ${DIM}`}><X size={18} /></button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div>
            <label className={`text-xs font-semibold ${DIM} mb-1.5 block`}>Plan</label>
            <div className="flex gap-2">
              {SELECTABLE.map((p) => <button key={p} onClick={() => setPlan(p)} className={seg(plan === p)}>{PLAN_NAME[p]}</button>)}
            </div>
          </div>
          {isPaid && (
            <>
              <div>
                <label className={`text-xs font-semibold ${DIM} mb-1.5 block`}>Valid for</label>
                <div className="flex flex-wrap gap-2">
                  {[['1y', '1 year'], ['1m', '1 month'], ['custom', 'Custom'], ['none', 'No expiry']].map(([k, l]) => (
                    <button key={k} onClick={() => setTerm(k)}
                      className={`px-3 py-2 rounded-xl text-xs font-bold border transition ${term === k ? 'border-emerald-500 bg-emerald-500/15 text-emerald-300' : 'border-white/[0.08] text-[#8b9d93] hover:border-white/20'}`}>{l}</button>
                  ))}
                </div>
                {term === 'custom' && <input type="date" value={customDate} onChange={(e) => setCustomDate(e.target.value)} className={`${darkInput} mt-2`} />}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={`text-xs font-semibold ${DIM} mb-1.5 block`}>Cash collected (₹)</label>
                  <input type="number" inputMode="numeric" value={amount} placeholder="optional" onChange={(e) => setAmount(e.target.value)} className={darkInput} />
                </div>
                <div>
                  <label className={`text-xs font-semibold ${DIM} mb-1.5 block`}>Method</label>
                  <select value={method} onChange={(e) => setMethod(e.target.value)} className={darkInput}>
                    <option value="cash">Cash</option><option value="upi">UPI</option><option value="bank">Bank</option><option value="other">Other</option>
                  </select>
                </div>
              </div>
            </>
          )}
          <div className={`rounded-xl border ${LINE} px-3 py-2.5 text-[12px] ${BODY} leading-relaxed`} style={{ background: '#0d1310' }}>
            Sets <b className={INK}>{store.name || store.slug}</b> to <b className={INK}>{PLAN_NAME[plan]}</b>
            {isPaid ? <> · expires <b className={INK}>{exp ? fmtDate(exp) : 'never'}</b></> : <> · keeps the PocketLink badge</>}
            {isPaid && Number(amount) > 0 && <> · logs <b className={INK}>₹{Number(amount).toLocaleString('en-IN')} {method}</b></>}.
          </div>
        </div>
        <div className={`flex gap-2 px-5 py-4 border-t ${LINE}`}>
          <button onClick={onClose} className={`flex-1 py-2.5 rounded-xl text-sm font-bold ${BODY} border border-white/[0.08] hover:bg-white/[0.04]`}>Cancel</button>
          <button onClick={submit} disabled={busy} className="flex-1 py-2.5 rounded-xl text-sm font-bold text-[#06120b] bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 active:scale-[0.98] transition">
            {busy ? 'Saving…' : 'Apply change'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ══ Main ══════════════════════════════════════════════════════════════════════
export default function Console() {
  const [session, setSession] = useState(undefined);
  const [me, setMe]           = useState(undefined);
  const [stores, setStores]   = useState([]);
  const [orders, setOrders]   = useState([]);
  const [team, setTeam]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab]         = useState('overview');
  const [query, setQuery]     = useState('');
  const [busySlug, setBusySlug] = useState(null);
  const [modal, setModal]     = useState(null);
  const [toast, setToast]     = useState('');
  const [chat, setChat]       = useState([]);
  const [asking, setAsking]   = useState(false);
  const [ask, setAsk]         = useState('');
  const [tf, setTf]           = useState({ email: '', name: '', role: 'exec' });  // team add form
  const [tBusy, setTBusy]     = useState(false);
  const [newCred, setNewCred] = useState(null);   // {email,password} for a just-created account

  useEffect(() => { consoleSession().then((s) => setSession(s)); return onConsoleAuthChange((s) => setSession(s)); }, []);
  useEffect(() => {
    if (session === undefined) return;
    if (!session) { setMe(null); return; }
    setMe(undefined);
    fetchMyTeamRow(session.user.id).then(setMe);
  }, [session]);
  const isAdmin = me?.role === 'admin';

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [st, od, tm] = await Promise.all([
      fetchStoresConsole(),
      fetchConsoleOrders(new Date(Date.now() - 7 * DAY).toISOString()),
      fetchTeam(),
    ]);
    setStores(st); setOrders(od); setTeam(tm); setLoading(false);
  }, []);
  useEffect(() => { if (isAdmin) loadAll(); }, [isAdmin, loadAll]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 3200); return () => clearTimeout(t); }, [toast]);

  // ── writes ──
  async function applyPatch(slug, patch, action) {
    setBusySlug(slug);
    try {
      const cfg = await consoleUpdateStore(slug, patch, action);
      setStores((prev) => prev.map((s) => (s.slug === slug ? rowFromConfig(s, cfg) : s)));
      setModal(null); setToast(`✓ ${slug} updated`);
    } catch (e) { setToast(`⚠ ${e.message}`); } finally { setBusySlug(null); }
  }
  function toggleTheme(s) {
    const next = s.theme?.mode === 'dark' ? 'light' : 'dark';
    const verb = next === 'dark' ? 'Switch to Premium Dark' : 'Switch to Light';
    if (!window.confirm(`${verb} for "${s.name || s.slug}"? Customers see this immediately.`)) return;
    applyPatch(s.slug, { theme: { ...(s.theme || {}), mode: next } }, 'theme');
  }

  // ── assistant ──
  function assistantPatch(action) {
    if (!action || typeof action !== 'object') return null;
    const store = stores.find((s) => s.slug === action.slug);
    if (!store) return null;
    if (action.type === 'set_theme' && (action.mode === 'light' || action.mode === 'dark')) {
      return { store, label: 'assistant:theme', patch: { theme: { ...(store.theme || {}), mode: action.mode } },
        desc: `Switch ${store.name || store.slug} to ${action.mode === 'dark' ? 'Premium Dark' : 'Light'}` };
    }
    if (action.type === 'set_plan' && SELECTABLE.includes(action.plan)) {
      const patch = { plan: action.plan }; let exp = null; const amt = Number(action.amount);
      if (PAID.has(action.plan)) {
        exp = action.term === '1y' ? yearsFromNowIso(1) : action.term === '1m' ? new Date(Date.now() + 30 * DAY).toISOString() : null;
        patch.planExpiresAt = exp;
        if (amt > 0) patch.billingNote = { plan: action.plan, planName: PLAN_NAME[action.plan], amount: amt, currency: 'INR',
          method: action.method || 'cash', term: action.term, collected: true,
          startedAt: new Date().toISOString().slice(0, 10), expiresAt: exp ? exp.slice(0, 10) : null, setBy: 'console-assistant' };
      } else { patch.planExpiresAt = null; }
      return { store, label: 'assistant:plan', patch,
        desc: `Set ${store.name || store.slug} to ${PLAN_NAME[action.plan]}`
          + (PAID.has(action.plan) ? ` · expires ${exp ? fmtDate(exp) : 'never'}` : '')
          + (amt > 0 ? ` · log ₹${amt.toLocaleString('en-IN')} ${action.method || 'cash'}` : '') };
    }
    return null;
  }
  async function sendAssistant() {
    const q = ask.trim(); if (!q || asking) return;
    setAsk(''); setChat((c) => [...c, { role: 'me', text: q }]); setAsking(true);
    try {
      const context = { stores: stores.map((s) => ({ slug: s.slug, name: s.name, plan: s.plan, status: storeStatus(s).key,
        expires: s.exp || null, theme: s.theme?.mode || 'light', cash: s.billing?.amount || null, whatsapp: Boolean(s.wa) })) };
      const res = await askAssistant(q, context);
      if (res?.error === 'not_configured') setChat((c) => [...c, { role: 'ai', notConfigured: true }]);
      else if (res?.error) setChat((c) => [...c, { role: 'ai', text: `⚠ ${res.message || res.error}` }]);
      else setChat((c) => [...c, { role: 'ai', text: res.reply || '(no reply)', action: res.action || null }]);
    } catch (e) { setChat((c) => [...c, { role: 'ai', text: `⚠ ${e.message}` }]); } finally { setAsking(false); }
  }
  async function approveAssistant(idx, action) {
    const built = assistantPatch(action);
    if (!built) { setToast('⚠ Could not apply that action'); return; }
    setBusySlug(built.store.slug);
    try {
      const cfg = await consoleUpdateStore(built.store.slug, built.patch, built.label);
      setStores((prev) => prev.map((s) => (s.slug === built.store.slug ? rowFromConfig(s, cfg) : s)));
      setChat((c) => c.map((m, i) => (i === idx ? { ...m, done: true } : m)));
      setToast(`✓ ${built.store.slug} updated`);
    } catch (e) { setToast(`⚠ ${e.message}`); } finally { setBusySlug(null); }
  }

  // ── team access ──
  async function addMember() {
    const email = tf.email.trim();
    if (!email || tBusy) return;
    setTBusy(true); setNewCred(null);
    try {
      const res = await manageTeam({ action: 'add', email, name: tf.name.trim(), role: tf.role });
      if (res?.error) { setToast(`⚠ ${res.message || res.error}`); }
      else {
        setTf({ email: '', name: '', role: 'exec' });
        setTeam(await fetchTeam());
        if (res.created && res.tempPassword) setNewCred({ email, password: res.tempPassword });
        setToast(`✓ ${email} added`);
      }
    } catch (e) { setToast(`⚠ ${e.message}`); } finally { setTBusy(false); }
  }
  async function removeMember(t) {
    if (!window.confirm(`Remove ${t.name || 'this member'} from the team?`)) return;
    setTBusy(true);
    try {
      const res = await manageTeam({ action: 'remove', userId: t.user_id });
      if (res?.error) setToast(`⚠ ${res.message || res.error}`);
      else { setTeam(await fetchTeam()); setToast('✓ Member removed'); }
    } catch (e) { setToast(`⚠ ${e.message}`); } finally { setTBusy(false); }
  }

  // ── derived ──
  const kpis = useMemo(() => {
    let active = 0, expiring = 0, expired = 0, dark = 0;
    for (const s of stores) {
      const st = storeStatus(s);
      if (st.key === 'active') active++;
      else if (st.key === 'expiring') { active++; expiring++; }
      else if (st.key === 'expired') expired++;
      if (s.theme?.mode === 'dark') dark++;
    }
    return { total: stores.length, active, expiring, expired, dark, orders7: orders.length,
      gmv: orders.reduce((s, o) => s + (Number(o.total) || 0), 0) };
  }, [stores, orders]);

  const attention = useMemo(() => {
    const items = [];
    stores.forEach((s) => {
      const st = storeStatus(s);
      if (st.key === 'expiring') { const d = daysLeft(s.exp);
        items.push({ key: `exp-${s.slug}`, tone: 'amber', title: `${s.name || s.slug} — ${PLAN_NAME[s.plan] || s.plan} expires in ${d} day${d === 1 ? '' : 's'}`, sub: `Renews ${fmtDate(s.exp)}`, store: s }); }
      else if (st.key === 'expired')
        items.push({ key: `expd-${s.slug}`, tone: 'rose', title: `${s.name || s.slug} — ${PLAN_NAME[s.plan] || s.plan} expired`, sub: `Lapsed ${fmtDate(s.exp)} · now on Free`, store: s });
      if (s.theme?.mode === 'dark')
        items.push({ key: `dark-${s.slug}`, tone: 'slate', title: `${s.name || s.slug} is live in Premium Dark`, sub: 'Customers see the dark storefront', store: s, themeItem: true });
    });
    return items.sort((a, b) => (a.tone === 'slate' ? 1 : 0) - (b.tone === 'slate' ? 1 : 0)).slice(0, 8);
  }, [stores]);

  const shownStores = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? stores.filter((s) => (s.name || '').toLowerCase().includes(q) || s.slug.toLowerCase().includes(q)) : stores;
    return [...list].sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0));
  }, [stores, query]);

  const growth = useMemo(() => {
    const now = Date.now();
    const weeks = Array.from({ length: 8 }, () => 0);
    const planCount = { premium: 0, business: 0, free: 0 };
    const statusCount = { active: 0, expiring: 0, expired: 0, free: 0 };
    let paidActive = 0, paidExpired = 0;
    stores.forEach((s) => {
      if (s.created_at) { const wk = Math.floor((now - new Date(s.created_at).getTime()) / (7 * DAY)); if (wk >= 0 && wk < 8) weeks[wk]++; }
      const p = s.plan || 'free';
      if (p === 'premium') planCount.premium++; else if (p === 'business') planCount.business++; else if (!PAID.has(p)) planCount.free++;
      const st = storeStatus(s); statusCount[st.key] = (statusCount[st.key] || 0) + 1;
      if (st.key === 'active' || st.key === 'expiring') paidActive++; else if (st.key === 'expired') paidExpired++;
    });
    const paidTotal = paidActive + paidExpired;
    return { total: stores.length, newThisWeek: weeks[0], weekly: weeks.slice().reverse(), planCount, statusCount, paidActive, paidExpired,
      churnPct: paidTotal ? Math.round((paidExpired / paidTotal) * 100) : 0 };
  }, [stores]);

  const renewals = useMemo(() => {
    const list = stores.filter((s) => { const k = storeStatus(s).key; return k === 'expired' || k === 'expiring'; })
      .sort((a, b) => new Date(b.exp || 0) - new Date(a.exp || 0));
    const lapsed = list.filter((s) => storeStatus(s).key === 'expired').length;
    return { list, lapsed, expiring: list.length - lapsed, reachable: list.filter((s) => s.wa).length };
  }, [stores]);

  const billing = useMemo(() => {
    const month = new Date().toISOString().slice(0, 7);
    const ledger = stores.filter((s) => s.billing && Number(s.billing.amount) > 0)
      .map((s) => ({ slug: s.slug, name: s.name || s.slug, plan: s.plan, amount: Number(s.billing.amount), method: s.billing.method || '—',
        startedAt: s.billing.startedAt, expiresAt: s.billing.expiresAt || s.exp }))
      .sort((a, b) => new Date(b.startedAt || 0) - new Date(a.startedAt || 0));
    return { ledger, cashTotal: ledger.reduce((s, l) => s + l.amount, 0),
      monthTotal: ledger.filter((l) => (l.startedAt || '').slice(0, 7) === month).reduce((s, l) => s + l.amount, 0),
      onAutopay: stores.filter((s) => s.sub).length };
  }, [stores]);

  const ordersView = useMemo(() => {
    const active = orders.filter((o) => o.status !== 'cancelled');
    return {
      gmv: active.reduce((s, o) => s + (Number(o.total) || 0), 0),
      codDue: active.filter((o) => o.payment_method === 'cod' && !o.paid).reduce((s, o) => s + (Number(o.total) || 0), 0),
      paid: orders.filter((o) => o.paid).length,
      list: orders.slice(0, 120),
    };
  }, [orders]);

  // ── gates ──
  if (session === undefined || (session && me === undefined))
    return <div className="min-h-screen grid place-items-center" style={{ background: BG }}><div className="w-8 h-8 border-4 border-white/10 border-t-emerald-500 rounded-full animate-spin" /></div>;
  if (!session) return <ConsoleLogin onDone={() => consoleSession().then(setSession)} />;
  if (!isAdmin) return (
    <div className="min-h-screen grid place-items-center px-4" style={{ background: BG }}>
      <div className={`max-w-sm text-center ${CARD} p-8`} style={{ background: PANEL }}>
        <ShieldAlert className="mx-auto text-amber-400" size={32} />
        <p className={`font-extrabold ${INK} mt-3`}>Founder access only</p>
        <p className={`text-sm ${DIM} mt-1.5`}>This console is limited to the founder account.</p>
        <button onClick={() => consoleSignOut().then(() => setSession(null))} className="mt-4 text-sm font-bold text-emerald-400">Sign out</button>
      </div>
    </div>
  );

  const NAV = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'stores',   label: 'Stores',   icon: StoreIcon, count: stores.length },
    { id: 'growth',   label: 'Growth',   icon: TrendingUp },
    { id: 'renewals', label: 'Renewals', icon: CalendarClock, count: renewals.list.length || undefined },
    { id: 'billing',  label: 'Billing',  icon: Wallet },
    { id: 'orders',   label: 'Orders',   icon: Box, count: orders.length || undefined },
    { id: 'assistant',label: 'Assistant',icon: Sparkles },
    { id: 'access',   label: 'Access',   icon: Users, count: team.length || undefined },
  ];
  const attn = kpis.expiring + kpis.expired;

  return (
    <div className="min-h-screen" style={{ background: BG, colorScheme: 'dark' }}>
      {/* top bar */}
      <header className={`sticky top-0 z-40 h-14 flex items-center gap-3 px-4 border-b ${LINE}`} style={{ background: 'rgba(10,15,12,.85)', backdropFilter: 'blur(8px)' }}>
        <div className="flex items-center gap-2">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="#22c55e"><path d="M12 1l1.9 6.6L20.5 6l-4.7 4.9 4.7 4.9-6.6-1.6L12 23l-1.9-8.8L3.5 15.8l4.7-4.9L3.5 6l6.6 1.6z" /></svg>
          <span className={`font-extrabold tracking-tight ${INK}`}>PocketLink <span className={DIM}>Console</span></span>
        </div>
        <span className="text-[10px] font-bold uppercase tracking-wide text-emerald-300 bg-emerald-500/12 border border-emerald-500/25 px-2 py-0.5 rounded-full inline-flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Production
        </span>
        <div className="flex-1" />
        {attn > 0 && <span className="hidden sm:inline text-xs font-bold text-amber-300">⚠ {attn} need attention</span>}
        <button onClick={loadAll} title="Refresh" className={`p-2 rounded-lg ${DIM} hover:bg-white/[0.05]`}><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button>
        <span className={`text-sm font-semibold ${BODY} hidden sm:block`}>{me?.name || 'Founder'}</span>
        <button onClick={() => consoleSignOut().then(() => setSession(null))} title="Sign out" className={`p-2 rounded-lg ${DIM} hover:text-rose-400 hover:bg-rose-500/10`}><LogOut size={16} /></button>
      </header>

      <div className="max-w-7xl mx-auto flex flex-col lg:flex-row">
        {/* nav rail */}
        <nav className={`lg:w-52 lg:shrink-0 lg:sticky lg:top-14 lg:self-start p-3 flex lg:flex-col gap-1 overflow-x-auto lg:border-r ${LINE}`}>
          {NAV.map((n) => {
            const on = tab === n.id;
            return (
              <button key={n.id} onClick={() => setTab(n.id)}
                className={['flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-semibold whitespace-nowrap transition border',
                  on ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25' : `${DIM} border-transparent hover:bg-white/[0.04]`].join(' ')}>
                <n.icon size={16} /> {n.label}
                {n.count != null && <span className={`lg:ml-auto text-[11px] ${on ? 'text-emerald-300/80' : FAINT}`}>{n.count}</span>}
              </button>
            );
          })}
        </nav>

        {/* main */}
        <main className="flex-1 min-w-0 p-4 lg:p-6">
          {/* OVERVIEW */}
          {tab === 'overview' && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Tile label="Active stores" value={kpis.active} sub={`${kpis.total} total`} />
                <Tile label="Expiring ≤14d" value={kpis.expiring} tone={kpis.expiring ? 'amber' : undefined} sub="need a renewal" />
                <Tile label="Orders · 7d" value={kpis.orders7} sub={`${formatINR(Math.round(kpis.gmv))} GMV`} />
                <Tile label="Expired" value={kpis.expired} tone={kpis.expired ? 'rose' : undefined} sub="on Free now" />
              </div>
              <Panel title="Needs attention" icon={AlertTriangle} count={attention.length}>
                {loading ? <div className={`p-6 text-center text-sm ${FAINT}`}>Loading…</div>
                  : attention.length === 0 ? <div className={`p-6 text-center text-sm ${FAINT}`}>All clear — nothing needs you right now. 🎉</div>
                  : <div className="divide-y divide-white/[0.05]">
                      {attention.map((it) => (
                        <div key={it.key} className="flex items-center gap-3 px-4 py-3">
                          <span className={`w-1.5 h-8 rounded-full flex-shrink-0 ${it.tone === 'rose' ? 'bg-rose-400' : it.tone === 'amber' ? 'bg-amber-400' : 'bg-slate-500'}`} />
                          <div className="min-w-0 flex-1">
                            <p className={`text-sm font-semibold ${BODY} truncate`}>{it.title}</p>
                            <p className={`text-[11px] ${FAINT}`}>{it.sub}</p>
                          </div>
                          {it.themeItem
                            ? <button onClick={() => toggleTheme(it.store)} disabled={busySlug === it.store.slug} className={`text-xs font-bold ${BODY} border border-white/[0.08] rounded-lg px-2.5 py-1.5 hover:border-white/20 disabled:opacity-50`}>Revert to light</button>
                            : <button onClick={() => setModal(it.store)} className="text-xs font-bold text-emerald-300 border border-emerald-500/25 bg-emerald-500/10 rounded-lg px-2.5 py-1.5 hover:border-emerald-500/50">Manage</button>}
                        </div>
                      ))}
                    </div>}
              </Panel>
            </div>
          )}

          {/* STORES */}
          {tab === 'stores' && (
            <Panel>
              <div className={`flex items-center gap-2 px-4 py-3 border-b ${LINE}`}>
                <div className="flex items-center gap-2 flex-1 rounded-xl px-3 py-2 border border-white/[0.08]" style={{ background: '#0d1310' }}>
                  <Search size={14} className={FAINT} />
                  <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search stores or slugs…" className={`flex-1 bg-transparent text-sm ${BODY} placeholder-[#5d6e64] outline-none`} />
                </div>
                <span className={`text-xs ${FAINT} tabular-nums`}>{shownStores.length}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className={`text-[10.5px] uppercase tracking-wide ${FAINT}`}>
                    <th className="text-left font-bold px-4 py-2.5">Store</th><th className="text-left font-bold px-3 py-2.5">Plan</th>
                    <th className="text-left font-bold px-3 py-2.5">Status</th><th className="text-left font-bold px-3 py-2.5">Expires</th>
                    <th className="text-left font-bold px-3 py-2.5">Theme</th><th className="px-3 py-2.5"></th>
                  </tr></thead>
                  <tbody>
                    {loading ? <tr><td colSpan={6} className={`px-4 py-8 text-center ${FAINT}`}>Loading stores…</td></tr>
                    : shownStores.map((s) => {
                      const st = storeStatus(s); const dark = s.theme?.mode === 'dark';
                      return (
                        <tr key={s.slug} className={`border-t ${LINE} hover:bg-white/[0.02]`}>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <span className="w-8 h-8 rounded-lg grid place-items-center text-sm flex-shrink-0" style={{ background: (s.theme?.primary || '#22c55e') + '22', color: s.theme?.primary || '#34d399' }}>{s.logoEmoji || '🏪'}</span>
                              <div className="min-w-0">
                                <div className={`font-bold ${INK} truncate max-w-[14rem]`}>{s.name || s.slug}</div>
                                <div className={`text-[10.5px] ${FAINT} font-mono truncate max-w-[14rem]`}>{s.slug}{s.billing?.amount ? ` · ₹${Number(s.billing.amount).toLocaleString('en-IN')}` : ''}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-2.5"><span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${planBadgeCls(s.plan)}`}>{PLAN_NAME[s.plan] || s.plan || 'Free'}</span></td>
                          <td className="px-3 py-2.5"><span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${st.cls}`}>{st.label}</span></td>
                          <td className={`px-3 py-2.5 text-[12px] ${DIM} tabular-nums whitespace-nowrap`}>{PAID.has(s.plan) ? fmtDate(s.exp) : '—'}</td>
                          <td className="px-3 py-2.5">
                            <button onClick={() => toggleTheme(s)} disabled={busySlug === s.slug} className={`inline-flex items-center gap-1.5 text-[11px] font-semibold ${BODY} border border-white/[0.08] rounded-lg px-2 py-1 hover:border-white/20 disabled:opacity-50`}>
                              {dark ? <Moon size={11} /> : <Sun size={11} />} {dark ? 'Dark' : 'Light'}
                            </button>
                          </td>
                          <td className="px-3 py-2.5 text-right whitespace-nowrap">
                            <a href={`/${s.slug}`} target="_blank" rel="noreferrer" className={`inline-flex items-center p-1.5 rounded-lg ${FAINT} hover:bg-white/[0.05] mr-1`} title="Open storefront"><ExternalLink size={14} /></a>
                            <button onClick={() => setModal(s)} className="text-[11px] font-bold text-emerald-300 border border-emerald-500/25 bg-emerald-500/10 rounded-lg px-2.5 py-1.5 hover:border-emerald-500/50">Manage</button>
                          </td>
                        </tr>
                      );
                    })}
                    {!loading && shownStores.length === 0 && <tr><td colSpan={6} className={`px-4 py-8 text-center ${FAINT}`}>No stores match “{query}”.</td></tr>}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}

          {/* GROWTH */}
          {tab === 'growth' && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Tile label="Total stores" value={growth.total} sub={`${growth.newThisWeek} new this week`} />
                <Tile label="Paid · active" value={growth.paidActive} sub="on Growth or Pro" />
                <Tile label="Churned" value={growth.paidExpired} tone={growth.paidExpired ? 'rose' : undefined} sub={`${growth.churnPct}% of paid lapsed`} />
                <Tile label="On Free" value={growth.statusCount.free || 0} sub="incl. never paid" />
              </div>
              <Panel title="New stores · last 8 weeks">
                <div className="p-4">
                  <div className="flex items-end gap-2 h-28">
                    {growth.weekly.map((v, i) => { const max = Math.max(1, ...growth.weekly);
                      return <div key={i} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
                        <div className="w-full rounded-t-md bg-emerald-500/80" style={{ height: `${(v / max) * 100}%`, minHeight: v ? 6 : 2 }} title={`${v} new`} />
                        <span className={`text-[10px] ${FAINT} tabular-nums`}>{v}</span>
                      </div>; })}
                  </div>
                  <div className={`flex justify-between mt-1 text-[10px] ${FAINT}`}><span>8 weeks ago</span><span>this week</span></div>
                </div>
              </Panel>
              <div className="grid sm:grid-cols-2 gap-3">
                <Panel title="Plan mix"><div className="p-4"><MixBars rows={[['Pro', growth.planCount.premium, '#22c55e'], ['Growth', growth.planCount.business, '#34d399'], ['Free', growth.planCount.free, '#3f4c45']]} /></div></Panel>
                <Panel title="Store status"><div className="p-4"><MixBars rows={[['Active', growth.statusCount.active || 0, '#22c55e'], ['Expiring', growth.statusCount.expiring || 0, '#f59e0b'], ['Expired', growth.statusCount.expired || 0, '#f43f5e'], ['Free', growth.statusCount.free || 0, '#3f4c45']]} /></div></Panel>
              </div>
            </div>
          )}

          {/* RENEWALS */}
          {tab === 'renewals' && (
            <div className="space-y-5">
              <div className="grid grid-cols-3 gap-3">
                <Tile label="Lapsed" value={renewals.lapsed} tone={renewals.lapsed ? 'rose' : undefined} sub="paid → Free" />
                <Tile label="Expiring ≤14d" value={renewals.expiring} tone={renewals.expiring ? 'amber' : undefined} sub="renew before they drop" />
                <Tile label="Reachable" value={renewals.reachable} sub="have a WhatsApp #" />
              </div>
              <Panel title="Renewal list" icon={CalendarClock} count={renewals.list.length} right="freshest lapse first">
                {loading ? <div className={`p-6 text-center text-sm ${FAINT}`}>Loading…</div>
                  : renewals.list.length === 0 ? <div className={`p-6 text-center text-sm ${FAINT}`}>No renewals pending — every paid store is current. 🎉</div>
                  : <div className="divide-y divide-white/[0.05]">
                      {renewals.list.map((s) => {
                        const link = nudgeLink(s); const lapsed = storeStatus(s).key === 'expired'; const dl = daysLeft(s.exp);
                        return (
                          <div key={s.slug} className="flex items-center gap-3 px-4 py-3">
                            <span className={`w-1.5 h-9 rounded-full flex-shrink-0 ${lapsed ? 'bg-rose-400' : 'bg-amber-400'}`} />
                            <div className="min-w-0 flex-1">
                              <p className={`text-sm font-bold ${INK} truncate`}>{s.name || s.slug} <span className={`text-[11px] font-semibold ${FAINT}`}>· {PLAN_NAME[s.plan] || s.plan}</span></p>
                              <p className={`text-[11px] ${FAINT}`}>{lapsed ? `Lapsed ${fmtDate(s.exp)}` : `Expires in ${dl}d · ${fmtDate(s.exp)}`}{s.wa ? ` · +91 ${s.wa}` : ' · no WhatsApp #'}</p>
                            </div>
                            {link ? <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs font-bold text-white bg-[#25D366] rounded-lg px-2.5 py-1.5 hover:bg-[#1ebe5d] transition active:scale-95"><MessageCircle size={13} /> Nudge</a>
                              : <span className={`text-[11px] ${FAINT} px-2`}>no WhatsApp</span>}
                            <button onClick={() => setModal(s)} className="text-xs font-bold text-emerald-300 border border-emerald-500/25 bg-emerald-500/10 rounded-lg px-2.5 py-1.5 hover:border-emerald-500/50">Renew</button>
                          </div>
                        );
                      })}
                    </div>}
              </Panel>
            </div>
          )}

          {/* BILLING */}
          {tab === 'billing' && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Tile label="Cash collected" value={formatINR(billing.cashTotal)} sub={`${billing.ledger.length} logged`} />
                <Tile label="This month" value={formatINR(billing.monthTotal)} sub="cash in" />
                <Tile label="On auto-pay" value={billing.onAutopay} sub="Razorpay subscription" />
                <Tile label="Manual / cash" value={billing.ledger.length} sub="logged in Console" />
              </div>
              <Panel title="Cash ledger" icon={Wallet} count={billing.ledger.length} right="newest first">
                {loading ? <div className={`p-6 text-center text-sm ${FAINT}`}>Loading…</div>
                  : billing.ledger.length === 0 ? <div className={`p-6 text-center text-sm ${FAINT}`}>No cash payments logged yet.</div>
                  : <div className="overflow-x-auto"><table className="w-full text-sm">
                      <thead><tr className={`text-[10.5px] uppercase tracking-wide ${FAINT}`}>
                        <th className="text-left font-bold px-4 py-2.5">Store</th><th className="text-left font-bold px-3 py-2.5">Plan</th>
                        <th className="text-right font-bold px-3 py-2.5">Amount</th><th className="text-left font-bold px-3 py-2.5">Method</th>
                        <th className="text-left font-bold px-3 py-2.5">On</th><th className="text-left font-bold px-3 py-2.5">Expires</th></tr></thead>
                      <tbody>{billing.ledger.map((l) => (
                        <tr key={l.slug} className={`border-t ${LINE} hover:bg-white/[0.02]`}>
                          <td className={`px-4 py-2.5 font-bold ${INK} truncate max-w-[14rem]`}>{l.name}</td>
                          <td className="px-3 py-2.5"><span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${planBadgeCls(l.plan)}`}>{PLAN_NAME[l.plan] || l.plan}</span></td>
                          <td className={`px-3 py-2.5 text-right font-extrabold ${INK} tabular-nums`}>{formatINR(l.amount)}</td>
                          <td className={`px-3 py-2.5 ${BODY} capitalize`}>{l.method}</td>
                          <td className={`px-3 py-2.5 text-[12px] ${DIM} tabular-nums whitespace-nowrap`}>{l.startedAt ? fmtDate(l.startedAt) : '—'}</td>
                          <td className={`px-3 py-2.5 text-[12px] ${DIM} tabular-nums whitespace-nowrap`}>{l.expiresAt ? fmtDate(l.expiresAt) : '—'}</td>
                        </tr>))}</tbody></table></div>}
              </Panel>
            </div>
          )}

          {/* ORDERS */}
          {tab === 'orders' && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <Tile label="Orders · 7d" value={orders.length} sub="across all stores" />
                <Tile label="GMV · 7d" value={formatINR(Math.round(ordersView.gmv))} sub="value ordered" />
                <Tile label="COD to collect" value={formatINR(Math.round(ordersView.codDue))} tone={ordersView.codDue ? 'amber' : undefined} sub="unpaid COD" />
                <Tile label="Paid" value={ordersView.paid} sub="marked paid" />
              </div>
              <Panel title="Recent orders" icon={Box} count={ordersView.list.length} right="last 7 days">
                {loading ? <div className={`p-6 text-center text-sm ${FAINT}`}>Loading…</div>
                  : ordersView.list.length === 0 ? <div className={`p-6 text-center text-sm ${FAINT}`}>No orders in the last 7 days.</div>
                  : <div className="overflow-x-auto"><table className="w-full text-sm">
                      <thead><tr className={`text-[10.5px] uppercase tracking-wide ${FAINT}`}>
                        <th className="text-left font-bold px-4 py-2.5">Store</th><th className="text-left font-bold px-3 py-2.5">Customer</th>
                        <th className="text-right font-bold px-3 py-2.5">Total</th><th className="text-left font-bold px-3 py-2.5">Pay</th>
                        <th className="text-left font-bold px-3 py-2.5">Status</th><th className="text-right font-bold px-3 py-2.5">When</th></tr></thead>
                      <tbody>{ordersView.list.map((o) => (
                        <tr key={o.id} className={`border-t ${LINE} hover:bg-white/[0.02]`}>
                          <td className={`px-4 py-2.5 font-mono text-[11px] ${DIM} truncate max-w-[12rem]`}>{o.store_slug}</td>
                          <td className={`px-3 py-2.5 ${BODY} truncate max-w-[10rem]`}>{o.customer_name || '—'}</td>
                          <td className={`px-3 py-2.5 text-right font-bold ${INK} tabular-nums`}>{formatINR(o.total || 0)}</td>
                          <td className="px-3 py-2.5">
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${o.paid ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}`}>{o.paid ? 'Paid' : (o.payment_method || 'unpaid').toUpperCase()}</span>
                          </td>
                          <td className={`px-3 py-2.5 text-[12px] ${DIM} capitalize`}>{o.status || '—'}</td>
                          <td className={`px-3 py-2.5 text-right text-[11px] ${FAINT} tabular-nums whitespace-nowrap`}>{timeAgo(o.created_at)}</td>
                        </tr>))}</tbody></table></div>}
              </Panel>
            </div>
          )}

          {/* ACCESS */}
          {tab === 'access' && (
            <div className="space-y-4">
              <div className={`${CARD} p-4`} style={{ background: PANEL }}>
                <p className={`text-sm font-bold ${INK} mb-3 flex items-center gap-2`}><Users size={15} className="text-emerald-400" /> Add a team member</p>
                <div className="grid sm:grid-cols-[1fr_1fr_auto_auto] gap-2">
                  <input value={tf.email} onChange={(e) => setTf({ ...tf, email: e.target.value })} placeholder="email@address.com" className={darkInput} />
                  <input value={tf.name} onChange={(e) => setTf({ ...tf, name: e.target.value })} placeholder="Name (optional)" className={darkInput} />
                  <select value={tf.role} onChange={(e) => setTf({ ...tf, role: e.target.value })} className={darkInput}><option value="exec">Exec</option><option value="admin">Admin</option></select>
                  <button onClick={addMember} disabled={tBusy || !tf.email.trim()} className="px-4 py-2.5 rounded-xl text-sm font-bold text-[#06120b] bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 whitespace-nowrap">{tBusy ? 'Working…' : 'Add'}</button>
                </div>
                <p className={`text-[11px] ${FAINT} mt-2`}>Exec = Sales Hub access · Admin = full Console. If they’ve no account yet, one is created and a one-time password is shown.</p>
                {newCred && (
                  <div className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 flex items-center gap-3">
                    <div className="min-w-0 flex-1 text-[12px]">
                      <span className="text-emerald-200 font-semibold">Account created for {newCred.email}.</span>{' '}
                      <span className="text-emerald-100">Temp password: </span><span className="font-mono font-bold text-white select-all">{newCred.password}</span>{' '}
                      <span className={FAINT}>— share it; they can change it after signing in.</span>
                    </div>
                    <button onClick={() => setNewCred(null)} className={`${DIM} hover:${INK}`}><X size={15} /></button>
                  </div>
                )}
              </div>

              <Panel title="Team access" icon={Users} count={team.length}>
                {loading ? <div className={`p-6 text-center text-sm ${FAINT}`}>Loading…</div>
                  : team.length === 0 ? <div className={`p-6 text-center text-sm ${FAINT}`}>No team members.</div>
                  : <div className="divide-y divide-white/[0.05]">
                      {team.map((t) => {
                        const self = t.user_id === me?.user_id;
                        return (
                          <div key={t.user_id} className="flex items-center gap-3 px-4 py-3">
                            <span className="w-9 h-9 rounded-lg grid place-items-center font-extrabold text-[13px] text-[#06120b]" style={{ background: 'linear-gradient(140deg,#22c55e,#16a34a)' }}>{(t.name || '?').slice(0, 2).toUpperCase()}</span>
                            <div className="min-w-0 flex-1">
                              <p className={`text-sm font-bold ${INK} truncate`}>{t.name || 'Unnamed'}{self ? ' · you' : ''}</p>
                              <p className={`text-[11px] ${FAINT} font-mono truncate`}>{t.user_id}</p>
                            </div>
                            <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${t.role === 'admin' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/[0.06] text-[#8b9d93]'}`}>{t.role === 'admin' ? '✦ Admin' : t.role || 'member'}</span>
                            {!self && <button onClick={() => removeMember(t)} disabled={tBusy} title="Remove" className={`p-1.5 rounded-lg ${FAINT} hover:text-rose-400 hover:bg-rose-500/10 disabled:opacity-40`}><X size={15} /></button>}
                          </div>
                        );
                      })}
                    </div>}
              </Panel>
            </div>
          )}

          {/* ASSISTANT */}
          {tab === 'assistant' && (
            <div className="max-w-2xl mx-auto flex flex-col" style={{ minHeight: '62vh' }}>
              <div className="flex-1 space-y-3">
                {chat.length === 0 && (
                  <div className={`${CARD} p-6 text-center`} style={{ background: PANEL }}>
                    <div className="w-11 h-11 rounded-xl bg-emerald-500/12 grid place-items-center mx-auto mb-3"><Sparkles size={20} className="text-emerald-400" /></div>
                    <p className={`font-bold ${INK}`}>Ask your Console</p>
                    <p className={`text-sm ${DIM} mt-1`}>Questions about your stores, or tell me a change — I’ll propose it for your one-tap approval.</p>
                    <div className="flex flex-wrap gap-2 justify-center mt-4">
                      {['Which stores expire this month?', 'Who has churned?', 'How much cash have I collected?', 'Renew Krupa Agarbatti Work as Pro for 1 year, ₹6000 cash'].map((s) => (
                        <button key={s} onClick={() => setAsk(s)} className={`text-xs font-semibold ${BODY} border border-white/[0.08] rounded-full px-3 py-1.5 hover:border-white/20`} style={{ background: ELEV }}>{s}</button>
                      ))}
                    </div>
                  </div>
                )}
                {chat.map((m, i) => (
                  <div key={i} className={m.role === 'me' ? 'flex justify-end' : ''}>
                    {m.role === 'me' ? <div className="max-w-[85%] bg-emerald-500 text-[#06120b] rounded-2xl rounded-br-md px-3.5 py-2 text-sm font-medium">{m.text}</div>
                      : m.notConfigured ? <div className="max-w-[92%] rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">🔑 The assistant needs an <b>Anthropic API key</b> (ANTHROPIC_API_KEY in Supabase secrets).</div>
                      : <div className="max-w-[92%]">
                          <div className="text-[10px] font-bold uppercase tracking-wide text-emerald-400 mb-1 flex items-center gap-1"><Sparkles size={11} /> Assistant</div>
                          <div className={`text-sm ${BODY} whitespace-pre-wrap`}>{m.text}</div>
                          {m.action && (
                            <div className="mt-2 rounded-xl border border-emerald-500/25 p-3" style={{ background: 'rgba(34,197,94,.06)' }}>
                              <p className={`text-xs font-bold ${INK} mb-2`}>{assistantPatch(m.action)?.desc || m.action.summary || 'Proposed change'}</p>
                              {m.done ? <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-300"><Check size={13} /> Applied · logged</span>
                                : assistantPatch(m.action) ? <div className="flex gap-2">
                                    <button onClick={() => approveAssistant(i, m.action)} disabled={!!busySlug} className="text-xs font-bold text-[#06120b] bg-emerald-500 rounded-lg px-3 py-1.5 hover:bg-emerald-400 disabled:opacity-50">Approve &amp; apply</button>
                                    <button onClick={() => setChat((c) => c.map((x, j) => (j === i ? { ...x, action: null } : x)))} className={`text-xs font-bold ${DIM} rounded-lg px-3 py-1.5 hover:bg-white/[0.05]`}>Dismiss</button>
                                  </div> : <span className={`text-[11px] ${FAINT}`}>Couldn’t map this to a safe action.</span>}
                            </div>
                          )}
                        </div>}
                  </div>
                ))}
                {asking && <div className={`text-xs ${FAINT} flex items-center gap-2`}><span className="w-3 h-3 border-2 border-white/10 border-t-emerald-500 rounded-full animate-spin" /> thinking…</div>}
              </div>
              <div className="sticky bottom-3 mt-4">
                <div className="flex items-center gap-2 rounded-xl px-3 py-2 border border-white/[0.09]" style={{ background: ELEV }}>
                  <input value={ask} onChange={(e) => setAsk(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') sendAssistant(); }}
                    placeholder="Ask, or tell me a change to make…" className={`flex-1 text-sm outline-none ${INK} placeholder-[#5d6e64] bg-transparent`} />
                  <button onClick={sendAssistant} disabled={!ask.trim() || asking} className="w-9 h-9 rounded-lg bg-emerald-500 grid place-items-center text-[#06120b] disabled:opacity-40"><Send size={15} /></button>
                </div>
                <p className={`text-[10px] ${FAINT} mt-1.5 px-1`}>Reads your live store data · proposes changes for your approval · never writes on its own.</p>
              </div>
            </div>
          )}
        </main>
      </div>

      {modal && <PlanModal store={modal} busy={busySlug === modal.slug} onClose={() => setModal(null)} onApply={applyPatch} />}
      {toast && <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[90] px-4 py-2.5 rounded-xl bg-emerald-500 text-[#06120b] text-sm font-bold shadow-lg">{toast}</div>}
    </div>
  );
}

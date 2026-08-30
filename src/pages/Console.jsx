import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  LayoutDashboard, Store as StoreIcon, LogOut, Search, RefreshCw, X, Check,
  ShieldAlert, ExternalLink, Moon, Sun, AlertTriangle, Wallet, Clock,
} from 'lucide-react';
import {
  consoleSession, onConsoleAuthChange, consoleSignIn, consoleSignOut,
  fetchMyTeamRow, fetchStoresConsole, fetchConsoleOrders, consoleUpdateStore,
  yearsFromNowIso,
} from '../utils/consoleService';
import { formatINR } from '../utils/currency';

/**
 * PocketLink Console — founder mission-control (hidden route /console).
 * Supabase-auth gated and further restricted to crm_team role = 'admin' (the
 * founder). Phase 1: Overview + Stores, with plan/subscription, cash-payment
 * logging and theme controls — every write goes through the admin-gated,
 * audit-logged console_update_store RPC (see supabase/console-setup.sql).
 */

const ACCENT = '#059669';                       // emerald-600
const PLAN_NAME  = { free: 'Free', starter: 'Starter', business: 'Growth', premium: 'Pro', pro: 'Pro (legacy)' };
const SELECTABLE = ['free', 'business', 'premium'];   // plans the console offers
const PAID = new Set(['starter', 'business', 'pro', 'premium']);
const DAY = 86400000;

// ── helpers ───────────────────────────────────────────────────────────────────
function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
function timeAgo(iso) {
  if (!iso) return '';
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); return `${d}d ago`;
}
/** Live status of a store from its plan + expiry. */
function storeStatus(s) {
  const plan = s.plan || 'free';
  const exp  = s.exp ? new Date(s.exp).getTime() : null;
  const now  = Date.now();
  if (!PAID.has(plan))            return { key: 'free',     label: 'Free',     cls: 'bg-gray-100 text-gray-500' };
  if (exp && exp < now)           return { key: 'expired',  label: 'Expired',  cls: 'bg-rose-100 text-rose-700' };
  if (exp && exp - now < 14 * DAY) return { key: 'expiring', label: 'Expiring', cls: 'bg-amber-100 text-amber-700' };
  return { key: 'active', label: 'Active', cls: 'bg-emerald-100 text-emerald-700' };
}
function planBadgeCls(plan) {
  if (plan === 'premium') return 'bg-emerald-600 text-white';
  if (plan === 'business') return 'bg-emerald-50 text-emerald-700 border border-emerald-200';
  return 'bg-gray-100 text-gray-600';
}
function daysLeft(iso) {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / DAY);
}
/** Rebuild a store row from the full config the RPC returns. */
function rowFromConfig(s, cfg) {
  if (!cfg || typeof cfg !== 'object') return s;
  return {
    ...s,
    plan: cfg.plan ?? s.plan,
    exp: cfg.planExpiresAt ?? null,
    theme: cfg.theme ?? s.theme,
    billing: cfg.billingNote ?? s.billing,
  };
}

const inputCls = `w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white text-gray-900
                  placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-200 focus:border-emerald-300 transition`;

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

// ══ KPI tile ══════════════════════════════════════════════════════════════════
function Tile({ label, value, sub, tone }) {
  const toneCls = tone === 'amber' ? 'text-amber-600' : tone === 'rose' ? 'text-rose-600' : 'text-gray-900';
  return (
    <div className="rounded-2xl border border-gray-100 bg-white shadow-sm p-4">
      <p className="text-xs font-semibold text-gray-500">{label}</p>
      <p className={`text-2xl font-extrabold mt-1 tabular-nums ${toneCls}`}>{value}</p>
      {sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}
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
    return null; // "no expiry"
  }
  function submit() {
    const exp = expiryIso();
    const patch = { plan, planExpiresAt: isPaid ? exp : null };
    const amt = Number(amount);
    if (isPaid && amt > 0) {
      patch.billingNote = {
        plan, planName: PLAN_NAME[plan], amount: amt, currency: 'INR', method,
        term: term === 'custom' ? 'custom' : term, collected: true,
        startedAt: new Date().toISOString().slice(0, 10),
        expiresAt: exp ? exp.slice(0, 10) : null, setBy: 'console',
      };
    }
    onApply(store.slug, patch, 'plan-change');
  }
  const exp = expiryIso();
  return (
    <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/50 px-3 py-6" onClick={onClose}>
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <p className="text-xs text-gray-400 font-semibold">Manage plan</p>
            <h3 className="text-base font-extrabold text-gray-900 truncate max-w-[16rem]">{store.name || store.slug}</h3>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100 text-gray-400"><X size={18} /></button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="text-xs font-semibold text-gray-500 mb-1.5 block">Plan</label>
            <div className="flex gap-2">
              {SELECTABLE.map((p) => (
                <button key={p} onClick={() => setPlan(p)}
                  className={['flex-1 py-2.5 rounded-xl text-sm font-bold border transition',
                    plan === p ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'].join(' ')}>
                  {PLAN_NAME[p]}
                </button>
              ))}
            </div>
          </div>

          {isPaid && (
            <>
              <div>
                <label className="text-xs font-semibold text-gray-500 mb-1.5 block">Valid for</label>
                <div className="flex flex-wrap gap-2">
                  {[['1y', '1 year'], ['1m', '1 month'], ['custom', 'Custom date'], ['none', 'No expiry']].map(([k, l]) => (
                    <button key={k} onClick={() => setTerm(k)}
                      className={['px-3 py-2 rounded-xl text-xs font-bold border transition',
                        term === k ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'].join(' ')}>
                      {l}
                    </button>
                  ))}
                </div>
                {term === 'custom' && (
                  <input type="date" value={customDate} onChange={(e) => setCustomDate(e.target.value)} className={`${inputCls} mt-2`} />
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-500 mb-1.5 block">Cash collected (₹)</label>
                  <input type="number" inputMode="numeric" value={amount} placeholder="optional"
                         onChange={(e) => setAmount(e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 mb-1.5 block">Method</label>
                  <select value={method} onChange={(e) => setMethod(e.target.value)} className={inputCls}>
                    <option value="cash">Cash</option>
                    <option value="upi">UPI</option>
                    <option value="bank">Bank</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>
            </>
          )}

          <div className="rounded-xl bg-gray-50 border border-gray-100 px-3 py-2.5 text-[12px] text-gray-600 leading-relaxed">
            Sets <b className="text-gray-900">{store.name || store.slug}</b> to <b className="text-gray-900">{PLAN_NAME[plan]}</b>
            {isPaid ? <> · expires <b className="text-gray-900">{exp ? fmtDate(exp) : 'never'}</b></> : <> · storefront keeps the PocketLink badge</>}
            {isPaid && Number(amount) > 0 && <> · logs <b className="text-gray-900">₹{Number(amount).toLocaleString('en-IN')} {method}</b> to billing</>}.
          </div>
        </div>

        <div className="flex gap-2 px-5 py-4 border-t border-gray-100">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-bold text-gray-600 border border-gray-200 hover:bg-gray-50">Cancel</button>
          <button onClick={submit} disabled={busy}
                  className="flex-1 py-2.5 rounded-xl text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 active:scale-[0.98] transition">
            {busy ? 'Saving…' : 'Apply change'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ══ Main ══════════════════════════════════════════════════════════════════════
export default function Console() {
  const [session, setSession] = useState(undefined);  // undefined = booting
  const [me, setMe]           = useState(undefined);   // undefined = loading team
  const [stores, setStores]   = useState([]);
  const [orders, setOrders]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab]         = useState('overview');
  const [query, setQuery]     = useState('');
  const [busySlug, setBusySlug] = useState(null);
  const [modal, setModal]     = useState(null);        // store being edited
  const [toast, setToast]     = useState('');

  // Auth boot
  useEffect(() => {
    consoleSession().then((s) => setSession(s));
    return onConsoleAuthChange((s) => setSession(s));
  }, []);
  // Team row → founder check
  useEffect(() => {
    if (session === undefined) return;
    if (!session) { setMe(null); return; }
    setMe(undefined);
    fetchMyTeamRow(session.user.id).then(setMe);
  }, [session]);
  const isAdmin = me?.role === 'admin';

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [st, od] = await Promise.all([
      fetchStoresConsole(),
      fetchConsoleOrders(new Date(Date.now() - 7 * DAY).toISOString()),
    ]);
    setStores(st); setOrders(od); setLoading(false);
  }, []);
  useEffect(() => { if (isAdmin) loadAll(); }, [isAdmin, loadAll]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  // ── writes ──
  async function applyPatch(slug, patch, action) {
    setBusySlug(slug);
    try {
      const cfg = await consoleUpdateStore(slug, patch, action);
      setStores((prev) => prev.map((s) => (s.slug === slug ? rowFromConfig(s, cfg) : s)));
      setModal(null);
      setToast(`✓ ${slug} updated`);
    } catch (e) {
      setToast(`⚠ ${e.message}`);
    } finally {
      setBusySlug(null);
    }
  }
  function toggleTheme(s) {
    const next = s.theme?.mode === 'dark' ? 'light' : 'dark';
    const verb = next === 'dark' ? 'Switch to Premium Dark' : 'Switch to Light';
    if (!window.confirm(`${verb} for "${s.name || s.slug}"? Customers will see this immediately.`)) return;
    applyPatch(s.slug, { theme: { ...(s.theme || {}), mode: next } }, 'theme');
  }

  // ── derived ──
  const kpis = useMemo(() => {
    const total = stores.length;
    let active = 0, expiring = 0, expired = 0, dark = 0;
    for (const s of stores) {
      const st = storeStatus(s);
      if (st.key === 'active') active++;
      else if (st.key === 'expiring') { active++; expiring++; }
      else if (st.key === 'expired') expired++;
      if (s.theme?.mode === 'dark') dark++;
    }
    const gmv = orders.reduce((sum, o) => sum + (Number(o.total) || 0), 0);
    return { total, active, expiring, expired, dark, orders7: orders.length, gmv };
  }, [stores, orders]);

  const attention = useMemo(() => {
    const items = [];
    stores.forEach((s) => {
      const st = storeStatus(s);
      if (st.key === 'expiring') {
        const d = daysLeft(s.exp);
        items.push({ key: `exp-${s.slug}`, tone: 'amber', slug: s.slug,
          title: `${s.name || s.slug} — ${PLAN_NAME[s.plan] || s.plan} expires in ${d} day${d === 1 ? '' : 's'}`,
          sub: `Renews ${fmtDate(s.exp)}`, store: s });
      } else if (st.key === 'expired') {
        items.push({ key: `expd-${s.slug}`, tone: 'rose', slug: s.slug,
          title: `${s.name || s.slug} — ${PLAN_NAME[s.plan] || s.plan} expired`,
          sub: `Lapsed ${fmtDate(s.exp)} · now on Free features`, store: s });
      }
      if (s.theme?.mode === 'dark') {
        items.push({ key: `dark-${s.slug}`, tone: 'slate', slug: s.slug,
          title: `${s.name || s.slug} is live in Premium Dark`,
          sub: 'Customers see the dark storefront', store: s, themeItem: true });
      }
    });
    // expiring/expired first, then dark notices
    return items.sort((a, b) => (a.tone === 'slate' ? 1 : 0) - (b.tone === 'slate' ? 1 : 0)).slice(0, 8);
  }, [stores]);

  const shownStores = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? stores.filter((s) => (s.name || '').toLowerCase().includes(q) || s.slug.toLowerCase().includes(q)) : stores;
    return [...list].sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0));
  }, [stores, query]);

  // ── gates ──
  if (session === undefined || (session && me === undefined)) {
    return <div className="min-h-screen grid place-items-center bg-gray-50"><div className="w-8 h-8 border-4 border-gray-200 border-t-emerald-600 rounded-full animate-spin" /></div>;
  }
  if (!session) return <ConsoleLogin onDone={() => consoleSession().then(setSession)} />;
  if (!isAdmin) {
    return (
      <div className="min-h-screen grid place-items-center bg-gray-50 px-4">
        <div className="max-w-sm text-center bg-white rounded-2xl border border-gray-100 shadow-sm p-8">
          <ShieldAlert className="mx-auto text-amber-500" size={32} />
          <p className="font-extrabold text-gray-900 mt-3">Founder access only</p>
          <p className="text-sm text-gray-500 mt-1.5">This console is limited to the founder account. {me ? 'Your account is on the team but not an admin.' : 'This account isn’t on the team.'}</p>
          <button onClick={() => consoleSignOut().then(() => setSession(null))} className="mt-4 text-sm font-bold text-emerald-700">Sign out</button>
        </div>
      </div>
    );
  }

  // ── cockpit ──
  const NAV = [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'stores',   label: 'Stores',   icon: StoreIcon, count: stores.length },
  ];
  const SOON = ['Billing', 'Orders', 'Access', 'Growth', 'Assistant'];

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      {/* top bar */}
      <header className="sticky top-0 z-40 h-14 flex items-center gap-3 px-4 border-b border-gray-100 bg-white">
        <div className="font-extrabold tracking-tight">PocketLink <span className="text-gray-400 font-semibold">Console</span></div>
        <span className="text-[10px] font-bold uppercase tracking-wide text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">Production</span>
        <div className="flex-1" />
        <button onClick={loadAll} title="Refresh" className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button>
        <div className="text-sm font-semibold text-gray-700 hidden sm:block">{me?.name || 'Founder'}</div>
        <button onClick={() => consoleSignOut().then(() => setSession(null))} title="Sign out" className="p-2 rounded-lg text-gray-400 hover:text-rose-600 hover:bg-rose-50"><LogOut size={16} /></button>
      </header>

      <div className="max-w-6xl mx-auto px-3 sm:px-5 py-5">
        {/* nav */}
        <div className="flex items-center gap-1.5 mb-5 overflow-x-auto">
          {NAV.map((n) => (
            <button key={n.id} onClick={() => setTab(n.id)}
              className={['inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-bold transition whitespace-nowrap',
                tab === n.id ? 'bg-emerald-600 text-white' : 'text-gray-600 hover:bg-gray-100'].join(' ')}>
              <n.icon size={15} /> {n.label}
              {n.count != null && <span className={`text-[11px] ${tab === n.id ? 'text-white/80' : 'text-gray-400'}`}>{n.count}</span>}
            </button>
          ))}
          {SOON.map((s) => (
            <span key={s} className="px-3 py-2 rounded-xl text-sm font-semibold text-gray-300 whitespace-nowrap cursor-default" title="Coming next">{s}</span>
          ))}
        </div>

        {/* ── OVERVIEW ── */}
        {tab === 'overview' && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Tile label="Active stores" value={kpis.active} sub={`${kpis.total} total`} />
              <Tile label="Expiring ≤14d" value={kpis.expiring} tone={kpis.expiring ? 'amber' : undefined} sub="need a renewal" />
              <Tile label="Orders · 7d" value={kpis.orders7} sub={`${formatINR(Math.round(kpis.gmv))} GMV`} />
              <Tile label="Expired" value={kpis.expired} tone={kpis.expired ? 'rose' : undefined} sub="on Free now" />
            </div>

            <div className="rounded-2xl border border-gray-100 bg-white shadow-sm">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
                <AlertTriangle size={15} className="text-amber-500" />
                <h3 className="text-sm font-bold text-gray-900">Needs attention</h3>
                <span className="text-xs text-gray-400">{attention.length}</span>
              </div>
              {loading ? (
                <div className="p-6 text-center text-sm text-gray-400">Loading…</div>
              ) : attention.length === 0 ? (
                <div className="p-6 text-center text-sm text-gray-400">All clear — nothing needs you right now. 🎉</div>
              ) : (
                <div className="divide-y divide-gray-50">
                  {attention.map((it) => (
                    <div key={it.key} className="flex items-center gap-3 px-4 py-3">
                      <span className={`w-1.5 h-8 rounded-full flex-shrink-0 ${it.tone === 'rose' ? 'bg-rose-400' : it.tone === 'amber' ? 'bg-amber-400' : 'bg-slate-300'}`} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-gray-800 truncate">{it.title}</p>
                        <p className="text-[11px] text-gray-400">{it.sub}</p>
                      </div>
                      {it.themeItem ? (
                        <button onClick={() => toggleTheme(it.store)} disabled={busySlug === it.slug}
                          className="text-xs font-bold text-gray-600 border border-gray-200 rounded-lg px-2.5 py-1.5 hover:border-gray-300 disabled:opacity-50">Revert to light</button>
                      ) : (
                        <button onClick={() => setModal(it.store)}
                          className="text-xs font-bold text-emerald-700 border border-emerald-200 bg-emerald-50 rounded-lg px-2.5 py-1.5 hover:border-emerald-300">Manage</button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── STORES ── */}
        {tab === 'stores' && (
          <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
              <div className="flex items-center gap-2 flex-1 bg-gray-50 border border-gray-100 rounded-xl px-3 py-2">
                <Search size={14} className="text-gray-400" />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search stores or slugs…"
                       className="flex-1 bg-transparent text-sm text-gray-800 placeholder-gray-400 outline-none" />
              </div>
              <span className="text-xs text-gray-400 tabular-nums">{shownStores.length}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10.5px] uppercase tracking-wide text-gray-400">
                    <th className="text-left font-bold px-4 py-2.5">Store</th>
                    <th className="text-left font-bold px-3 py-2.5">Plan</th>
                    <th className="text-left font-bold px-3 py-2.5">Status</th>
                    <th className="text-left font-bold px-3 py-2.5">Expires</th>
                    <th className="text-left font-bold px-3 py-2.5">Theme</th>
                    <th className="px-3 py-2.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">Loading stores…</td></tr>
                  ) : shownStores.map((s) => {
                    const st = storeStatus(s);
                    const dark = s.theme?.mode === 'dark';
                    return (
                      <tr key={s.slug} className="border-t border-gray-50 hover:bg-gray-50/60">
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span className="w-8 h-8 rounded-lg grid place-items-center text-sm flex-shrink-0"
                                  style={{ background: (s.theme?.primary || ACCENT) + '22', color: s.theme?.primary || ACCENT }}>
                              {s.logoEmoji || '🏪'}
                            </span>
                            <div className="min-w-0">
                              <div className="font-bold text-gray-900 truncate max-w-[14rem]">{s.name || s.slug}</div>
                              <div className="text-[10.5px] text-gray-400 font-mono truncate max-w-[14rem]">{s.slug}{s.billing?.amount ? ` · ₹${Number(s.billing.amount).toLocaleString('en-IN')} ${s.billing.method || ''}` : ''}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${planBadgeCls(s.plan)}`}>{PLAN_NAME[s.plan] || s.plan || 'Free'}</span>
                        </td>
                        <td className="px-3 py-2.5"><span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${st.cls}`}>{st.label}</span></td>
                        <td className="px-3 py-2.5 text-[12px] text-gray-500 tabular-nums whitespace-nowrap">{PAID.has(s.plan) ? fmtDate(s.exp) : '—'}</td>
                        <td className="px-3 py-2.5">
                          <button onClick={() => toggleTheme(s)} disabled={busySlug === s.slug}
                            className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-gray-600 border border-gray-200 rounded-lg px-2 py-1 hover:border-gray-300 disabled:opacity-50">
                            {dark ? <Moon size={11} /> : <Sun size={11} />} {dark ? 'Dark' : 'Light'}
                          </button>
                        </td>
                        <td className="px-3 py-2.5 text-right whitespace-nowrap">
                          <a href={`/${s.slug}`} target="_blank" rel="noreferrer" className="inline-flex items-center p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 mr-1" title="Open storefront"><ExternalLink size={14} /></a>
                          <button onClick={() => setModal(s)} className="text-[11px] font-bold text-emerald-700 border border-emerald-200 bg-emerald-50 rounded-lg px-2.5 py-1.5 hover:border-emerald-300">Manage</button>
                        </td>
                      </tr>
                    );
                  })}
                  {!loading && shownStores.length === 0 && (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">No stores match “{query}”.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {modal && <PlanModal store={modal} busy={busySlug === modal.slug} onClose={() => setModal(null)} onApply={applyPatch} />}

      {toast && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[90] px-4 py-2.5 rounded-xl bg-gray-900 text-white text-sm font-semibold shadow-lg">{toast}</div>
      )}
    </div>
  );
}

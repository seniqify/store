// PocketLink Sales CRM: crm.pocketlink.store (and /crm on the main site, for
// previews). Sign-in, the person's role, the menu for that role, the routes.
// Shows NO shop, order or admin data: CRM logins are refused those by the
// database (supabase/sales-crm-forward.sql), not just hidden here.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Routes, Route, NavLink, Navigate, useNavigate } from 'react-router-dom';
import {
  crmSession, onCrmAuthChange, crmSignIn, crmSignOut, crmResetPassword, crmSetPassword,
  fetchMe, fetchStaff, touch,
} from './crmService.js';
import { Icon, Field, Notice, Spinner } from './ui.jsx';
import { btn, input, MENUS } from './crmStyles.js';
import CrmToday from './CrmToday.jsx';
import { CrmLeads, CrmLeadPage } from './CrmLeads.jsx';
import CrmAddLead from './CrmAddLead.jsx';
import CrmAssign from './CrmAssign.jsx';
import CrmQueue from './CrmQueue.jsx';
import CrmFollowups from './CrmFollowups.jsx';
import CrmCheckin from './CrmCheckin.jsx';
import CrmAttendance from './CrmAttendance.jsx';
import CrmTeam from './CrmTeam.jsx';
import { CrmCtx, useCrm, initials, ROLE_LABEL } from './crmContext.js';


function Login({ recovery, onDone }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState(recovery ? 'set' : 'in');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      if (mode === 'in') await crmSignIn(email, password);
      else if (mode === 'forgot') { await crmResetPassword(email); setMsg({ kind: 'ok', text: 'Check your email for a link to set a new password.' }); }
      else { if (password.length < 8) throw new Error('Use at least 8 characters.'); await crmSetPassword(password); onDone?.(); }
    } catch (err) {
      setMsg({ kind: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0f1f18] flex items-center justify-center px-4 py-10">
      <form onSubmit={submit} className="w-full max-w-sm bg-white rounded-3xl p-6 space-y-4">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="w-10 h-10 rounded-xl bg-green-600 text-white grid place-items-center font-extrabold text-sm">PL</span>
          <div><h1 className="text-lg font-extrabold leading-tight">PocketLink CRM</h1><p className="text-[13px] text-gray-500">For the sales team</p></div>
        </div>
        {mode !== 'set' && (
          <Field label="Email" htmlFor="em"><input id="em" type="email" autoComplete="username" required className={input} value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        )}
        {mode !== 'forgot' && (
          <Field label={mode === 'set' ? 'New password' : 'Password'} htmlFor="pw">
            <input id="pw" type="password" autoComplete={mode === 'set' ? 'new-password' : 'current-password'} required className={input} value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
        )}
        {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
        <button type="submit" className={`${btn.primary} w-full`} disabled={busy}>
          {busy ? 'Please wait…' : mode === 'in' ? 'Sign in' : mode === 'forgot' ? 'Send reset link' : 'Save new password'}
        </button>
        {mode !== 'set' && (
          <button type="button" className="w-full text-[13px] font-bold text-gray-600" onClick={() => { setMode(mode === 'in' ? 'forgot' : 'in'); setMsg(null); }}>
            {mode === 'in' ? 'Forgot password?' : 'Back to sign in'}
          </button>
        )}
      </form>
    </div>
  );
}

function NotOnTeam() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-6 text-center">
      <div className="max-w-sm space-y-3">
        <h1 className="text-lg font-extrabold">This account is not on the sales team</h1>
        <p className="text-sm text-gray-600">Ask your manager to add you in Team.</p>
        <button type="button" className={btn.ghost} onClick={() => crmSignOut()}>Sign out</button>
      </div>
    </div>
  );
}

function Shell({ children }) {
  const { me, base } = useCrm();
  const items = MENUS[me.role] || MENUS.caller;
  const to = (p) => (p ? `${base}/${p}` : `${base}/`);
  const linkCls = ({ isActive }) => `flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm ${isActive ? 'bg-green-600/25 text-white font-bold' : 'text-gray-300 font-semibold hover:text-white'}`;
  return (
    <div className="min-h-screen bg-[#f4f5f4] lg:flex">
      <nav aria-label="CRM" className="hidden lg:flex lg:flex-col w-60 shrink-0 bg-[#0f1f18] text-white px-3 py-5 gap-1 sticky top-0 h-screen">
        <div className="flex items-center gap-2.5 px-2 pb-4">
          <span aria-hidden="true" className="w-9 h-9 rounded-xl bg-green-600 grid place-items-center font-extrabold text-[13px]">PL</span>
          <div><div className="font-extrabold">PocketLink</div><div className="text-[12px] text-green-200 font-semibold">Sales CRM</div></div>
        </div>
        {items.map(([p, label, icon]) => (
          <NavLink key={p || 'today'} to={to(p)} end={!p} className={linkCls}><Icon name={icon} />{label}</NavLink>
        ))}
        <div className="mt-auto border-t border-white/10 pt-3 px-2 flex items-center gap-2.5">
          <span aria-hidden="true" className="w-9 h-9 rounded-full bg-amber-100 text-amber-800 grid place-items-center font-extrabold text-[12px]">{initials(me.name)}</span>
          <div className="flex-1 min-w-0"><div className="text-sm font-bold truncate">{me.name}</div><div className="text-[12px] text-green-200">{ROLE_LABEL[me.role]}</div></div>
          <button type="button" aria-label="Sign out" onClick={() => crmSignOut()} className="w-9 h-9 rounded-lg bg-white/10 grid place-items-center"><Icon name="out" size={16} /></button>
        </div>
      </nav>
      <main className="flex-1 min-w-0 pb-24 lg:pb-10">{children}</main>
      <nav aria-label="Main" className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-gray-200 grid grid-cols-5 pt-2 pb-3">
        {items.slice(0, 5).map(([p, label, icon]) => (
          <NavLink key={p || 'today'} to={to(p)} end={!p}
            className={({ isActive }) => `flex flex-col items-center gap-0.5 text-[11.5px] ${isActive ? 'text-green-700 font-extrabold' : 'text-gray-500 font-semibold'}`}>
            <Icon name={icon} size={20} />{label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

export default function CrmApp({ base = '' }) {
  const [session, setSession] = useState(undefined);
  const [recovery, setRecovery] = useState(false);
  const [me, setMe] = useState(undefined);
  const [staff, setStaff] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    document.title = 'PocketLink CRM';
    const meta = document.createElement('meta');
    meta.name = 'robots'; meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);

  useEffect(() => {
    let alive = true;
    crmSession().then((s) => { if (alive) setSession(s); });
    const off = onCrmAuthChange((s) => {
      setSession(s);
      if (typeof window !== 'undefined' && window.location.hash.includes('type=recovery')) setRecovery(true);
    });
    return () => { alive = false; off(); };
  }, []);

  useEffect(() => {
    if (!session?.user) { setMe(session === null ? null : undefined); return; }
    let alive = true;
    fetchMe(session.user.id).then((row) => { if (alive) setMe(row); });
    return () => { alive = false; };
  }, [session]);

  const refreshStaff = useCallback(async () => setStaff(await fetchStaff()), []);
  useEffect(() => { if (me) refreshStaff(); }, [me, refreshStaff]);

  // Login time and "last active": once on open, then every 5 minutes while the tab is visible.
  useEffect(() => {
    if (!me) return undefined;
    touch();
    const id = setInterval(() => { if (document.visibilityState === 'visible') touch(); }, 5 * 60 * 1000);
    const vis = () => { if (document.visibilityState === 'visible') touch(); };
    document.addEventListener('visibilitychange', vis);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', vis); };
  }, [me]);

  const value = useMemo(() => ({
    me, staff, base, refreshStaff,
    path: (p = '') => (p ? `${base}/${p}` : `${base}/`),
    go: (p = '') => navigate(p ? `${base}/${p}` : `${base}/`),
    nameOf: (id) => staff.find((s) => s.user_id === id)?.name || '',
  }), [me, staff, base, refreshStaff, navigate]);

  if (session === undefined) return <Spinner />;
  if (!session || recovery) return <Login recovery={recovery} onDone={() => { setRecovery(false); window.history.replaceState(null, '', base || '/'); }} />;
  if (me === undefined) return <Spinner />;
  if (me === null) return <NotOnTeam />;

  const isManager = me.role === 'manager';
  return (
    <CrmCtx.Provider value={value}>
      <Shell>
        <Routes>
          <Route index element={<CrmToday />} />
          <Route path="leads" element={<CrmLeads />} />
          <Route path="leads/:id" element={<CrmLeadPage />} />
          <Route path="add" element={<CrmAddLead />} />
          <Route path="queue" element={<CrmQueue />} />
          <Route path="followups" element={<CrmFollowups />} />
          <Route path="checkin" element={<CrmCheckin />} />
          <Route path="attendance" element={<CrmAttendance />} />
          <Route path="assign" element={isManager ? <CrmAssign /> : <Navigate to={value.path()} replace />} />
          <Route path="team" element={isManager ? <CrmTeam /> : <Navigate to={value.path()} replace />} />
          <Route path="*" element={<Navigate to={value.path()} replace />} />
        </Routes>
      </Shell>
    </CrmCtx.Provider>
  );
}

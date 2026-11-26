// PocketLink Admin: admin.pocketlink.store (and /admin on the main site, for
// previews). Sign-in, then 2-step sign-in with an authenticator app, then the
// control center. Who may see and change what is decided by the database
// (supabase/admin-part1-forward.sql) on every call; this app only hides what a
// role cannot use.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Routes, Route, NavLink, Navigate, useLocation, useNavigate } from 'react-router-dom';
import {
  adminSession, onAdminAuthChange, adminSignIn, adminSignOut, adminMe, twoStepState, twoStepEnroll, twoStepVerify,
} from './adminService.js';
import { ROLE_LABEL, canDo } from './adminLogic.js';
import { AdminCtx, useAdmin } from './adminContext.js';
import { Icon, Notice, Spinner } from './ui.jsx';
import { btn, input, label } from './adminStyles.js';
import AdminHome from './AdminHome.jsx';
import AdminStores from './AdminStores.jsx';
import AdminStore from './AdminStore.jsx';
import AdminBilling from './AdminBilling.jsx';
import AdminLog from './AdminLog.jsx';
import AdminOrders from './AdminOrders.jsx';
import AdminPeople from './AdminPeople.jsx';
import AdminCoins from './AdminCoins.jsx';
import AdminSystem from './AdminSystem.jsx';
import AdminSalary, { AdminSalaryPerson } from './AdminSalary.jsx';
import AdminSalarySetup from './AdminSalarySetup.jsx';

const BG = 'bg-[#0a0f0c] text-[#e7efe9]';

function Frame({ children }) {
  return (
    <div className={`min-h-screen ${BG} flex items-center justify-center px-4 py-10`} style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
      <div className="w-full max-w-[400px] bg-[#131c17] border border-[#1f2b24] rounded-2xl p-6 space-y-5">
        <div className="flex items-center gap-2.5">
          <span aria-hidden="true" className="w-9 h-9 rounded-xl bg-emerald-500 text-[#052e1f] grid place-items-center font-extrabold text-[13px]">PL</span>
          <div><div className="font-extrabold">PocketLink Admin</div><div className="text-[12px] text-[#8fa69a]">admin.pocketlink.store</div></div>
        </div>
        {children}
      </div>
    </div>
  );
}

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try { await adminSignIn(email, password); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <Frame>
      <form onSubmit={submit} className="space-y-4">
        <div><h1 className="m-0 text-[22px] font-extrabold">Sign in</h1><p className="m-0 mt-1 text-[13.5px] text-[#8fa69a]">For the PocketLink admin team only. A 2-step code comes next.</p></div>
        <div><label className={label} htmlFor="ae">Email</label><input id="ae" type="email" autoComplete="username" required className={input} value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div><label className={label} htmlFor="ap">Password</label><input id="ap" type="password" autoComplete="current-password" required className={input} value={password} onChange={(e) => setPassword(e.target.value)} /></div>
        {err && <Notice>{err}</Notice>}
        <button type="submit" className={`${btn.primary} w-full h-11`} disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </Frame>
  );
}

// 2-step sign-in: add an authenticator app the first time, then a code each time.
function TwoStep({ onDone }) {
  const [state, setState] = useState(null);
  const [enroll, setEnroll] = useState(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    let alive = true;
    twoStepState().then(async (s) => {
      if (!alive) return;
      setState(s);
      if (!s.verified.length) {
        try { const e = await twoStepEnroll(); if (alive) setEnroll(e); } catch (x) { if (alive) setErr(x.message); }
      }
    }).catch((x) => alive && setErr(x.message));
    return () => { alive = false; };
  }, []);
  const factorId = enroll?.factorId || state?.verified?.[0]?.id;
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try { await twoStepVerify(factorId, code); await onDone(); } catch (x) { setErr(x.message); setCode(''); } finally { setBusy(false); }
  };
  return (
    <Frame>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <h1 className="m-0 text-[22px] font-extrabold">{enroll ? 'Set up 2-step sign-in' : '2-step sign-in'}</h1>
          <p className="m-0 mt-1 text-[13.5px] text-[#8fa69a]">{enroll
            ? 'Admin can change every shop, so it needs a second step. Scan this with Google Authenticator or Microsoft Authenticator, then type the 6-digit code it shows.'
            : 'Type the 6-digit code from your authenticator app.'}</p>
        </div>
        {enroll?.qr && (
          <div className="space-y-2">
            <div className="bg-white rounded-xl p-3 w-fit mx-auto"><img src={enroll.qr} alt="QR code to add PocketLink Admin to your authenticator app" width="180" height="180" /></div>
            <p className="m-0 text-[12px] text-[#8fa69a] text-center break-all">Cannot scan? Type this key in the app: <b className="text-[#e7efe9]">{enroll.secret}</b></p>
          </div>
        )}
        {!state && !err && <Spinner label="Getting ready…" />}
        {(enroll || state?.verified?.length > 0) && (
          <div><label className={label} htmlFor="code">6-digit code</label>
            <input id="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required className={`${input} tracking-[0.4em] text-center text-lg`} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} /></div>
        )}
        {err && <Notice>{err}</Notice>}
        <button type="submit" className={`${btn.primary} w-full h-11`} disabled={busy || code.length !== 6 || !factorId}>{busy ? 'Checking…' : 'Continue'}</button>
        <button type="button" className="w-full text-[13px] font-semibold text-[#8fa69a] hover:text-white bg-transparent border-0 cursor-pointer" onClick={() => adminSignOut()}>Sign out</button>
      </form>
    </Frame>
  );
}

function NotAdmin() {
  return (
    <Frame>
      <h1 className="m-0 text-[20px] font-extrabold">Not on the admin team</h1>
      <p className="m-0 text-[13.5px] text-[#8fa69a]">This account cannot open PocketLink Admin. Ask the owner to add you.</p>
      <button type="button" className={`${btn.ghost} w-full`} onClick={() => adminSignOut()}>Sign out</button>
    </Frame>
  );
}

const MENU = [
  ['', 'Home', 'home'], ['stores', 'Stores', 'store'], ['orders', 'Orders and delivery', 'box'], ['billing', 'Billing and plans', 'card'],
  ['coins', 'Coins and WhatsApp', 'coin'], ['people', 'People and access', 'people'], ['salary', 'Salary', 'wallet'], ['system', 'System and switches', 'server'], ['log', 'Audit log', 'list'],
];

function Shell({ children }) {
  const { me, path } = useAdmin();
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const [seen, setSeen] = useState(pathname);
  if (seen !== pathname) { setSeen(pathname); setOpen(false); }
  const link = ({ isActive }) => `flex items-center gap-2.5 min-h-10 px-3 rounded-xl text-[14px] no-underline ${isActive ? 'bg-[#173a2b] text-[#ecfdf5] font-bold' : 'text-[#a9bdb2] font-medium hover:bg-[#16211b] hover:text-[#e7efe9]'}`;
  const nav = (
    <nav aria-label="Admin" className="flex flex-col gap-4">
      <div className="flex items-center gap-2.5 px-1.5">
        <span aria-hidden="true" className="w-9 h-9 rounded-xl bg-emerald-500 text-[#052e1f] grid place-items-center font-extrabold text-[13px]">PL</span>
        <div><div className="font-extrabold text-[15px]">PocketLink Admin</div><div className="text-[12px] text-[#8fa69a]">admin.pocketlink.store</div></div>
      </div>
      <div className="flex flex-col gap-0.5">
        {MENU.filter(([p]) => p !== 'salary' || canDo(me.role, 'salary')).map(([p, t, icon]) => <NavLink key={p || 'home'} to={path(p)} end={!p} className={link}><Icon name={icon} />{t}</NavLink>)}
        <a href="https://crm.pocketlink.store" target="_blank" rel="noreferrer" className={link({ isActive: false })}><Icon name="phone" />Sales CRM<Icon name="ext" size={14} className="ml-auto opacity-60" /></a>
      </div>
    </nav>
  );
  const who = (
    <div className="flex items-center gap-2.5 border-t border-[#1d2a23] pt-3.5 px-1.5">
      <span aria-hidden="true" className="w-9 h-9 rounded-full bg-amber-200 text-amber-900 grid place-items-center font-extrabold text-[12px]">{String(me.name || '?').slice(0, 2).toUpperCase()}</span>
      <div className="flex-1 min-w-0"><div className="text-[14px] font-bold truncate">{me.name}</div><div className="text-[12px] text-[#8fa69a]">{ROLE_LABEL[me.role]} · 2-step on</div></div>
      <button type="button" aria-label="Sign out" onClick={() => adminSignOut()} className="w-9 h-9 rounded-xl border border-[#2b3b32] bg-[#16211b] text-[#c8d6ce] grid place-items-center cursor-pointer"><Icon name="out" size={16} /></button>
    </div>
  );
  return (
    <div className={`min-h-screen ${BG}`} style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
      <aside className="hidden lg:flex lg:flex-col justify-between w-[248px] fixed inset-y-0 left-0 z-30 bg-[#0d1410] border-r border-[#1d2a23] px-3.5 py-5 overflow-y-auto">{nav}{who}</aside>
      <header className="lg:hidden flex items-center gap-2.5 h-14 px-4 bg-[#0d1410] border-b border-[#1d2a23]">
        <button type="button" aria-label="Menu" aria-expanded={open} onClick={() => setOpen(!open)} className="w-9 h-9 rounded-xl border border-[#2b3b32] bg-[#16211b] text-[#e7efe9] grid place-items-center cursor-pointer"><Icon name={open ? 'x' : 'menu'} /></button>
        <span className="font-extrabold">PocketLink Admin</span>
      </header>
      {open && <div className="lg:hidden bg-[#0d1410] border-b border-[#1d2a23] px-3.5 py-4 space-y-4">{nav}{who}</div>}
      <main className="lg:ml-[248px] min-w-0 px-4 lg:px-7 py-6 pb-16">{children}</main>
    </div>
  );
}

export default function AdminApp({ base = '' }) {
  const [session, setSession] = useState(undefined);
  const [me, setMe] = useState(undefined);
  const [err, setErr] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    document.title = 'PocketLink Admin';
    const meta = document.createElement('meta');
    meta.name = 'robots'; meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);

  useEffect(() => {
    let alive = true;
    adminSession().then((s) => { if (alive) setSession(s); });
    const off = onAdminAuthChange((s) => setSession(s));
    return () => { alive = false; off(); };
  }, []);

  const loadMe = useCallback(async () => {
    setErr('');
    try { setMe(await adminMe()); } catch (x) { setErr(x.message); setMe(null); }
  }, []);
  // Re-check who this is whenever the session changes (sign-in, 2-step done).
  const token = session?.access_token;
  const signedOut = session === null;
  useEffect(() => {
    if (!token) { setMe(signedOut ? null : undefined); return; }
    loadMe();
  }, [token, signedOut, loadMe]);

  const value = useMemo(() => ({
    me, base,
    path: (p = '') => (p ? `${base}/${p}` : `${base}/`),
    go: (p = '') => navigate(p ? `${base}/${p}` : `${base}/`),
    reloadMe: loadMe,
  }), [me, base, navigate, loadMe]);

  if (session === undefined) return <div className={`min-h-screen ${BG}`}><Spinner /></div>;
  if (!session) return <Login />;
  if (me === undefined) return <div className={`min-h-screen ${BG}`}><Spinner /></div>;
  if (err) return <Frame><Notice>{err}</Notice><button type="button" className={`${btn.ghost} w-full`} onClick={() => adminSignOut()}>Sign out</button></Frame>;
  if (!me) return <NotAdmin />;
  if (!me.mfa) return <TwoStep onDone={async () => { await loadMe(); }} />;

  return (
    <AdminCtx.Provider value={value}>
      <Shell>
        <Routes>
          <Route index element={<AdminHome />} />
          <Route path="stores" element={<AdminStores />} />
          <Route path="stores/:slug" element={<AdminStore />} />
          <Route path="billing" element={<AdminBilling />} />
          <Route path="log" element={<AdminLog />} />
          <Route path="orders" element={<AdminOrders />} />
          <Route path="people" element={<AdminPeople />} />
          <Route path="coins" element={<AdminCoins />} />
          <Route path="system" element={<AdminSystem />} />
          <Route path="salary" element={<AdminSalary />} />
          <Route path="salary/setup" element={<AdminSalarySetup />} />
          <Route path="salary/:month" element={<AdminSalary />} />
          <Route path="salary/:month/:userId" element={<AdminSalaryPerson />} />
          <Route path="*" element={<Navigate to={value.path()} replace />} />
        </Routes>
      </Shell>
    </AdminCtx.Provider>
  );
}

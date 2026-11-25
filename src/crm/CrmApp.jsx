// PocketLink Sales CRM: crm.pocketlink.store (and /crm on the main site, for
// previews). Sign-in, the person's role, the menu for that role, the routes.
// Shows NO shop, order or admin data: CRM logins are refused those by the
// database (supabase/sales-crm-forward.sql), not just hidden here.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Routes, Route, NavLink, Navigate, useNavigate, useLocation } from 'react-router-dom';
import {
  crmSession, onCrmAuthChange, crmSignIn, crmSignOut, crmResetPassword, crmSetPassword,
  fetchMe, fetchStaff, touch, listLeave, listQuestions, fetchSettings,
} from './crmService.js';
import { Icon, Field, Notice, Spinner } from './ui.jsx';
import { btn, input, MENUS, PHONE_TABS } from './crmStyles.js';
import CrmToday from './CrmToday.jsx';
import { CrmLeads, CrmLeadPage } from './CrmLeads.jsx';
import CrmAddLead from './CrmAddLead.jsx';
import CrmAssign from './CrmAssign.jsx';
import CrmQueue from './CrmQueue.jsx';
import CrmFollowups from './CrmFollowups.jsx';
import CrmCheckin from './CrmCheckin.jsx';
import CrmAttendance from './CrmAttendance.jsx';
import CrmTeam from './CrmTeam.jsx';
import CrmPerformance from './CrmPerformance.jsx';
import CrmScripts from './CrmScripts.jsx';
import CrmHelp from './CrmHelp.jsx';
import CrmVisits from './CrmVisits.jsx';
import CrmAccount from './CrmAccount.jsx';
import CrmSources from './CrmSources.jsx';
import NewLeadAlert from './CrmNewLeadAlert.jsx';
import CrmSettings from './CrmSettings.jsx';
import CrmIncentives from './CrmIncentives.jsx';
import CrmTraining from './CrmTraining.jsx';
import CrmReports from './CrmReports.jsx';
import { CrmCtx, useCrm, initials, ROLE_LABEL } from './crmContext.js';


// The sign-in screen, in the look of the shop dashboard's PIN screen
// (components/manage/PinGate.jsx): the dark PocketLink panel on a computer,
// a dark header with a white sheet on a phone.
const AURORA = {
  backgroundColor: '#061310',
  backgroundImage:
    'radial-gradient(circle at 88% 4%, rgba(16,185,129,0.3), transparent 50%), '
    + 'radial-gradient(circle at 4% 96%, rgba(20,184,166,0.18), transparent 48%)',
};
const INSIDE = [
  ['phone', 'Your call queue', 'Who to call now, with the script and the follow-up'],
  ['pin', 'Shop visits', 'Check in with a photo and the place'],
  ['chart', 'Your score and incentive', 'Wins count when the shop pays'],
];

function Login({ recovery, onDone }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
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

  const title = mode === 'in' ? 'Welcome back' : mode === 'forgot' ? 'Forgot your password?' : 'Set a new password';
  const sub = mode === 'in' ? 'Sign in with the email and password your manager gave you.'
    : mode === 'forgot' ? 'Enter your email. We send you a link to set a new one.' : 'At least 8 characters.';

  return (
    <div className="min-h-screen bg-white lg:bg-[#f8faf9] lg:flex">
      <aside className="hidden lg:flex w-[540px] flex-shrink-0 flex-col gap-10 px-14 py-12 text-white" style={AURORA}>
        <img src="/pocketlink-logo.svg" alt="PocketLink" className="h-8 w-auto self-start brightness-0 invert" />
        <div className="space-y-4 mt-7">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-emerald-300">Sales CRM</p>
          <h2 className="text-[40px] leading-[1.12] font-extrabold tracking-tight">Every lead, call and visit in one place.</h2>
          <p className="text-base leading-relaxed text-[#b6d3c7]">For PocketLink’s calling and field team, and their manager.</p>
        </div>
        <ul className="space-y-[18px]">
          {INSIDE.map(([icon, t, x]) => (
            <li key={t} className="flex items-center gap-3.5">
              <span className="w-[42px] h-[42px] rounded-xl bg-emerald-400/10 border border-emerald-400/20 flex items-center justify-center flex-shrink-0 text-emerald-300"><Icon name={icon} size={20} /></span>
              <span><span className="block text-[15px] font-semibold">{t}</span><span className="block text-[13px] text-[#9cc2b3]">{x}</span></span>
            </li>
          ))}
        </ul>
        <div className="mt-auto flex items-start gap-2.5 px-4 py-3.5 rounded-[14px] bg-white/5 border border-white/10">
          <span className="text-emerald-300 mt-px"><Icon name="shield" size={18} /></span>
          <p className="text-[13px] leading-normal text-[#b6d3c7]">Only people your manager adds can sign in. Shops, orders and customers’ details are never shown here.</p>
        </div>
      </aside>

      <header className="lg:hidden h-[200px] px-4 pt-5 text-white" style={AURORA}>
        <div className="flex items-center justify-center"><img src="/pocketlink-logo.svg" alt="PocketLink" className="h-[22px] w-auto brightness-0 invert" /></div>
        <p className="mt-5 text-center text-[11px] font-bold uppercase tracking-[0.16em] text-emerald-300">Sales CRM</p>
      </header>

      <main className="relative flex-1 min-w-0 lg:flex lg:items-center lg:justify-center lg:p-10">
        <div className="relative -mt-16 lg:mt-0 rounded-t-[28px] lg:rounded-none bg-white lg:bg-transparent px-6 pt-8 pb-10 lg:p-0 w-full lg:w-[392px] mx-auto">
          <form onSubmit={submit} className="space-y-4">
            <div className="text-center lg:text-left">
              <h1 className="text-2xl lg:text-[28px] font-extrabold tracking-tight text-gray-900">{title}</h1>
              <p className="mt-1.5 text-[14.5px] text-gray-600">{sub}</p>
            </div>
            {mode !== 'set' && (
              <Field label="Email" htmlFor="em"><input id="em" type="email" autoComplete="username" required className={input} value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            )}
            {mode !== 'forgot' && (
              <Field label={mode === 'set' ? 'New password' : 'Password'} htmlFor="pw">
                <div className="relative">
                  <input id="pw" type={show ? 'text' : 'password'} autoComplete={mode === 'set' ? 'new-password' : 'current-password'} required
                    className={`${input} pr-12`} value={password} onChange={(e) => setPassword(e.target.value)} />
                  <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}
                    className="absolute right-1 top-1 w-9 h-9 grid place-items-center text-gray-500 hover:text-gray-900"><Icon name={show ? 'eyeOff' : 'eye'} size={18} /></button>
                </div>
              </Field>
            )}
            {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
            <button type="submit" className={`${btn.primary} w-full h-12 text-[15px]`} disabled={busy}>
              {busy ? 'Please wait…' : mode === 'in' ? 'Sign in' : mode === 'forgot' ? 'Send the link' : 'Save new password'}
            </button>
            {mode !== 'set' && (
              <button type="button" className="w-full text-[13.5px] font-bold text-gray-600 hover:text-gray-900 py-1" onClick={() => { setMode(mode === 'in' ? 'forgot' : 'in'); setMsg(null); }}>
                {mode === 'in' ? 'Forgot password?' : 'Back to sign in'}
              </button>
            )}
            <p className="lg:hidden text-center text-[12.5px] text-gray-500 pt-2">Only people your manager adds can sign in.</p>
          </form>
        </div>
      </main>
    </div>
  );
}

// New people pass the training exam before they call or check in (Settings → Training).
function TrainingFirst() {
  const { path } = useCrm();
  return (
    <div className="px-4 lg:px-7 py-10 max-w-md mx-auto text-center space-y-3">
      <div className="w-14 h-14 rounded-full bg-amber-100 text-amber-800 grid place-items-center mx-auto"><Icon name="book" size={26} /></div>
      <h1 className="text-xl font-extrabold">Finish your training first</h1>
      <p className="text-sm text-gray-600">Read the ten short modules and pass the exam. Then the call queue and check-ins open for you.</p>
      <NavLink to={path('training')} className={btn.primary}>Go to training</NavLink>
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

// Things waiting for the manager: leave to approve, questions to answer.
function useBadges(me) {
  const [b, setB] = useState({});
  useEffect(() => {
    if (me.role !== 'manager') return undefined;
    let alive = true;
    const load = async () => {
      const [leave, qs] = await Promise.all([listLeave(), listQuestions()]);
      if (alive) setB({ attendance: leave.filter((l) => l.status === 'pending').length, help: qs.filter((q) => !q.answer).length });
    };
    load();
    const id = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 5 * 60 * 1000);
    return () => { alive = false; clearInterval(id); };
  }, [me.role]);
  return b;
}

const Badge = ({ n }) => (n ? <span className="ml-auto min-w-[20px] h-5 px-1.5 rounded-full bg-amber-400 text-amber-950 text-[11px] font-extrabold grid place-items-center">{n}</span> : null);

function Shell({ children }) {
  const { me, base } = useCrm();
  const [more, setMore] = useState(false);
  const badges = useBadges(me);
  const { pathname } = useLocation();
  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) { setSeenPath(pathname); setMore(false); }
  const items = MENUS[me.role] || MENUS.caller;
  const tabs = items.slice(0, PHONE_TABS);
  const rest = items.slice(PHONE_TABS);
  const restBadge = rest.reduce((n, [p]) => n + (badges[p] || 0), 0);
  const to = (p) => (p ? `${base}/${p}` : `${base}/`);
  const linkCls = ({ isActive }) => `flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm no-underline ${isActive ? 'bg-green-600/25 text-white font-bold' : 'text-gray-300 font-semibold hover:text-white'}`;
  return (
    <div className="min-h-screen bg-[#f4f5f4]">
      {/* fixed, not sticky: the site's overflow-x on body stops sticky from working */}
      <nav aria-label="CRM" className="hidden lg:flex lg:flex-col w-60 fixed inset-y-0 left-0 z-30 bg-[#0f1f18] text-white px-3 py-5 gap-1 overflow-y-auto">
        <div className="flex items-center gap-2.5 px-2 pb-4">
          <span aria-hidden="true" className="w-9 h-9 rounded-xl bg-green-600 grid place-items-center font-extrabold text-[13px]">PL</span>
          <div><div className="font-extrabold">PocketLink</div><div className="text-[12px] text-green-200 font-semibold">Sales CRM</div></div>
        </div>
        {items.map(([p, label, icon]) => (
          <NavLink key={p || 'today'} to={to(p)} end={!p} className={linkCls}><Icon name={icon} />{label}<Badge n={badges[p]} /></NavLink>
        ))}
        <div className="mt-auto border-t border-white/10 pt-3 px-2 flex items-center gap-2.5">
          <NavLink to={to('account')} className="flex flex-1 min-w-0 items-center gap-2.5 rounded-lg -m-1 p-1 hover:bg-white/5 no-underline" title="My account" aria-label={`${me.name}: my account`}>
            <span aria-hidden="true" className="w-9 h-9 rounded-full bg-amber-100 text-amber-800 grid place-items-center font-extrabold text-[12px]">{initials(me.name)}</span>
            <span className="flex-1 min-w-0"><span className="block text-sm font-bold truncate text-white">{me.name}</span><span className="block text-[12px] text-green-200 truncate">{ROLE_LABEL[me.role]}</span></span>
          </NavLink>
          <button type="button" aria-label="Sign out" onClick={() => crmSignOut()} className="w-9 h-9 rounded-lg bg-white/10 grid place-items-center"><Icon name="out" size={16} /></button>
        </div>
      </nav>
      <header className="lg:hidden bg-[#0f1f18] text-white px-4 h-14 flex items-center gap-2.5">
        <span aria-hidden="true" className="w-8 h-8 rounded-lg bg-green-600 grid place-items-center font-extrabold text-[12px]">PL</span>
        <span className="font-extrabold flex-1">PocketLink CRM</span>
        <NavLink to={to('account')} aria-label="My account" className="w-9 h-9 rounded-full bg-amber-100 text-amber-800 grid place-items-center font-extrabold text-[12px] no-underline">{initials(me.name)}</NavLink>
      </header>
      <main className="min-w-0 pb-24 lg:pb-10 lg:ml-60"><NewLeadAlert />{children}</main>
      {more && (
        <div className="lg:hidden fixed inset-0 z-40 bg-black/40" onClick={() => setMore(false)} role="presentation">
          <div role="dialog" aria-modal="true" aria-label="More" onClick={(e) => e.stopPropagation()}
            className="absolute inset-x-0 bottom-0 bg-white rounded-t-3xl px-4 pt-4 pb-24 space-y-1 max-h-[80vh] overflow-y-auto">
            {rest.map(([p, label, icon]) => (
              <NavLink key={p} to={to(p)} className={({ isActive }) => `flex items-center gap-3 px-3 py-3 rounded-xl text-[15px] no-underline ${isActive ? 'bg-green-50 text-green-800 font-extrabold' : 'text-gray-900 font-semibold'}`}>
                <Icon name={icon} />{label}<Badge n={badges[p]} />
              </NavLink>
            ))}
            <NavLink to={to('account')} className="flex items-center gap-3 px-3 py-3 rounded-xl text-[15px] text-gray-900 font-semibold no-underline"><Icon name="user" />My account</NavLink>
            <button type="button" onClick={() => crmSignOut()} className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-[15px] text-red-700 font-semibold"><Icon name="out" />Sign out</button>
          </div>
        </div>
      )}
      <nav aria-label="Main" className="lg:hidden fixed bottom-0 inset-x-0 z-50 bg-white border-t border-gray-200 grid grid-cols-5 pt-2 pb-3">
        {tabs.map(([p, label, icon]) => (
          <NavLink key={p || 'today'} to={to(p)} end={!p}
            className={({ isActive }) => `flex flex-col items-center gap-0.5 text-[11.5px] no-underline ${isActive ? 'text-green-700 font-extrabold' : 'text-gray-500 font-semibold'}`}>
            <Icon name={icon} size={20} />{label}
          </NavLink>
        ))}
        <button type="button" aria-expanded={more} onClick={() => setMore((m) => !m)}
          className={`relative flex flex-col items-center gap-0.5 text-[11.5px] ${more ? 'text-green-700 font-extrabold' : 'text-gray-500 font-semibold'}`}>
          <Icon name="more" size={20} />More
          {restBadge > 0 && <span aria-label={`${restBadge} waiting`} className="absolute top-0 right-[calc(50%-18px)] w-2.5 h-2.5 rounded-full bg-amber-400" />}
        </button>
      </nav>
    </div>
  );
}

export default function CrmApp({ base = '' }) {
  const [session, setSession] = useState(undefined);
  const [recovery, setRecovery] = useState(false);
  const [me, setMe] = useState(undefined);
  const [staff, setStaff] = useState([]);
  const [settings, setSettings] = useState(null);   // null until loaded
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
  const refreshSettings = useCallback(async () => setSettings(await fetchSettings()), []);
  useEffect(() => { if (me) { refreshStaff(); refreshSettings(); } }, [me, refreshStaff, refreshSettings]);

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
    me, staff, base, refreshStaff, settings, refreshSettings,
    path: (p = '') => (p ? `${base}/${p}` : `${base}/`),
    go: (p = '') => navigate(p ? `${base}/${p}` : `${base}/`),
    nameOf: (id) => staff.find((s) => s.user_id === id)?.name || '',
    refreshMe: async () => { if (session?.user) setMe(await fetchMe(session.user.id)); },
  }), [me, staff, base, refreshStaff, settings, refreshSettings, navigate, session]);

  if (session === undefined) return <Spinner />;
  if (!session || recovery) return <Login recovery={recovery} onDone={() => { setRecovery(false); window.history.replaceState(null, '', base || '/'); }} />;
  if (me === undefined) return <Spinner />;
  if (me === null) return <NotOnTeam />;

  const isManager = me.role === 'manager';
  const needsTraining = !isManager && me.must_train && !me.qualified_at && settings?.training?.gate !== false;
  return (
    <CrmCtx.Provider value={value}>
      <Shell>
        <Routes>
          <Route index element={<CrmToday />} />
          <Route path="leads" element={<CrmLeads />} />
          <Route path="leads/:id" element={<CrmLeadPage />} />
          <Route path="add" element={<CrmAddLead />} />
          <Route path="queue" element={needsTraining ? <TrainingFirst /> : <CrmQueue />} />
          <Route path="followups" element={<CrmFollowups />} />
          <Route path="checkin" element={needsTraining ? <TrainingFirst /> : <CrmCheckin />} />
          <Route path="attendance" element={<CrmAttendance />} />
          <Route path="assign" element={isManager ? <CrmAssign /> : <Navigate to={value.path()} replace />} />
          <Route path="team" element={isManager ? <CrmTeam /> : <Navigate to={value.path()} replace />} />
          <Route path="visits" element={isManager ? <CrmVisits /> : <Navigate to={value.path()} replace />} />
          <Route path="sources" element={isManager ? <CrmSources /> : <Navigate to={value.path()} replace />} />
          <Route path="performance" element={<CrmPerformance />} />
          <Route path="scripts" element={<CrmScripts />} />
          <Route path="help" element={<CrmHelp />} />
          <Route path="account" element={<CrmAccount />} />
          <Route path="settings" element={isManager ? <CrmSettings /> : <Navigate to={value.path()} replace />} />
          <Route path="reports" element={isManager ? <CrmReports /> : <Navigate to={value.path()} replace />} />
          <Route path="incentives" element={<CrmIncentives />} />
          <Route path="training" element={<CrmTraining />} />
          <Route path="*" element={<Navigate to={value.path()} replace />} />
        </Routes>
      </Shell>
    </CrmCtx.Provider>
  );
}

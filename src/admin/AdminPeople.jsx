// People and access: the admin team (add, role, switch off, new password,
// reset 2-step, remove), the Sales CRM team and old Hub logins, and who may
// do what. The database decides who may change whom; a new or reset password
// is shown once to tell the person.
import { useCallback, useEffect, useState } from 'react';
import { useAdmin } from './adminContext.js';
import { peopleList, teamSave, teamRemove, hubRemove, personAdd, personPassword, personReset2Step } from './adminService.js';
import { ROLE_LABEL, CAN, canDo, whenLabel } from './adminLogic.js';
import { Icon, Chip, Panel, Spinner, Notice, Empty } from './ui.jsx';
import { btn, input, label, th, td } from './adminStyles.js';

const ROLES = ['owner', 'admin', 'support', 'finance', 'viewer'];
const SALES_ROLE = { manager: 'Sales manager', caller: 'Calling executive', field: 'Field executive', ads: 'Ads & leads executive' };
const ACTIONS = [
  ['see', 'See stores, orders, billing and people'], ['see_private', 'See owners’ phone numbers'], ['edit_store', 'Change shop details, reset a shop PIN, decide reported reviews'],
  ['plan', 'Change plans, give Coins, stop auto-pay, refunds'], ['pause', 'Pause a shop'], ['delete', 'Delete or restore a shop, reset someone’s 2-step'],
  ['people', 'Add, change and remove people'], ['money', 'See billing and Coins'],
];

function Secret({ title, value, onClose }) {
  return (
    <Notice kind="ok">
      <div className="flex flex-wrap items-center gap-2"><b>{title}</b> <code className="px-2 py-0.5 rounded bg-[#06120b] text-[15px] tracking-wider">{value}</code>
        <button type="button" className={btn.small} onClick={() => navigator.clipboard?.writeText(value)}>Copy</button>
        <button type="button" className={btn.small} onClick={onClose}>Done</button></div>
      <div className="mt-1 text-[12.5px]">Shown once. Send it to them on WhatsApp; they can change it after signing in.</div>
    </Notice>
  );
}

function Person({ p, meRole, onChanged }) {
  const [role, setRole] = useState(p.role);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null);
  const [secret, setSecret] = useState(null);
  const may = p.may_manage;
  const roles = meRole === 'owner' ? ROLES : ROLES.filter((r) => !['owner', 'admin'].includes(r));
  const run = async (key, fnc, ok) => {
    setBusy(key); setMsg(null);
    try { const r = await fnc(); if (r?.tempPassword) setSecret(r.tempPassword); setMsg({ kind: 'ok', text: typeof ok === 'function' ? ok(r) : ok }); await onChanged(); }
    catch (x) { setMsg({ kind: 'error', text: x.message }); } finally { setBusy(''); }
  };
  const why = reason.trim().length >= 3;
  return (
    <li className="px-4 py-3.5 border-b border-[#18231d] space-y-2.5">
      <div className="flex flex-wrap items-center gap-3">
        <span aria-hidden="true" className="w-9 h-9 rounded-full bg-[#1f2b24] grid place-items-center font-extrabold text-[12px] text-[#c8d6ce]">{String(p.name).slice(0, 2).toUpperCase()}</span>
        <div className="flex-1 min-w-[200px]"><div className="font-bold">{p.name}</div><div className="text-[12.5px] text-[#8fa69a]">{p.email} · last signed in {p.last_sign_in_at ? whenLabel(p.last_sign_in_at) : 'never'}</div></div>
        <Chip tone={p.two_step ? 'ok' : 'warn'}>{p.two_step ? '2-step on' : '2-step not set up'}</Chip>
        <Chip tone={p.active ? 'ok' : 'off'}>{p.active ? ROLE_LABEL[p.role] : `${ROLE_LABEL[p.role]} · off`}</Chip>
      </div>
      {may && (
        <div className="flex flex-wrap items-end gap-2">
          <div><label className={label} htmlFor={`r-${p.user_id}`}>Role</label>
            <select id={`r-${p.user_id}`} className={`${input} w-auto h-9`} value={role} onChange={(e) => setRole(e.target.value)}>{roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></div>
          <div className="flex-[1_1_220px]"><label className={label} htmlFor={`w-${p.user_id}`}>Reason (goes in the log)</label><input id={`w-${p.user_id}`} className={`${input} h-9`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Moved to the finance work" /></div>
          <button type="button" className={btn.small} disabled={!!busy || role === p.role} onClick={() => run('role', () => teamSave(p.user_id, p.name, role, p.active, reason), 'Role changed.')}>Save role</button>
          <button type="button" className={btn.small} disabled={!!busy} onClick={() => run('active', () => teamSave(p.user_id, p.name, p.role, !p.active, reason || (p.active ? 'switched off' : 'switched on')), p.active ? 'Switched off: they can no longer open Admin.' : 'Switched on.')}>{p.active ? 'Switch off' : 'Switch on'}</button>
          <button type="button" className={btn.small} disabled={!!busy || !why} onClick={() => run('pw', () => personPassword(p.user_id, reason), 'New password set.')}>New password</button>
          {meRole === 'owner' && <button type="button" className={btn.small} disabled={!!busy || !why || !p.two_step} onClick={() => run('2s', () => personReset2Step(p.user_id, reason), (r) => `2-step removed (${r?.removed ?? 0}). They set it up again at their next sign-in.`)}>Reset 2-step</button>}
          <button type="button" className={`${btn.small} !text-red-300`} disabled={!!busy || !why} onClick={() => { if (window.confirm(`Remove ${p.name} from the admin team?`)) run('rm', () => teamRemove(p.user_id, reason), 'Removed.'); }}>Remove</button>
        </div>
      )}
      {secret && <Secret title={`New password for ${p.name}:`} value={secret} onClose={() => setSecret(null)} />}
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
    </li>
  );
}

export default function AdminPeople() {
  const { me } = useAdmin();
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [f, setF] = useState({ name: '', email: '', role: 'support', reason: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [secret, setSecret] = useState(null);
  const [hubWhy, setHubWhy] = useState('');
  const load = useCallback(async () => { try { setD(await peopleList()); } catch (x) { setErr(x.message); } }, []);
  useEffect(() => { load(); }, [load]);
  const canPeople = canDo(me.role, 'people');

  const add = async (e) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      const r = await personAdd(f.email, f.name, f.role, f.reason);
      if (r.tempPassword) setSecret({ name: f.name, value: r.tempPassword });
      setMsg({ kind: 'ok', text: r.created ? `${f.name} added. Send them admin.pocketlink.store, their email and the password below. They set up 2-step at their first sign-in.` : `${f.name} added. They sign in with the password they already have.` });
      setF({ name: '', email: '', role: 'support', reason: '' });
      await load();
    } catch (x) { setMsg({ kind: 'error', text: x.message }); } finally { setBusy(false); }
  };

  if (err) return <Notice>{err}</Notice>;
  if (!d) return <Spinner />;
  return (
    <div className="space-y-5 max-w-[1300px]">
      <header>
        <h1 className="m-0 text-[26px] font-extrabold">People and access</h1>
        <p className="m-0 mt-1 text-[14px] text-[#8fa69a]">Everyone who can open Admin, the Sales CRM team, and old Sales Hub logins.</p>
      </header>

      <Panel title="Admin team" right={<span className="text-[12.5px] text-[#8fa69a]">{d.team.filter((t) => t.active).length} active</span>}>
        <ul className="list-none m-0 p-0">{d.team.map((p) => <Person key={p.user_id} p={p} meRole={me.role} onChanged={load} />)}</ul>
        {!canPeople && <div className="p-4"><Notice kind="warn">Your role can see the team but not change it.</Notice></div>}
      </Panel>

      {canPeople && (
        <Panel title="Add a person">
          <form onSubmit={add} className="p-4 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
            <div><label className={label} htmlFor="pn">Name</label><input id="pn" className={input} required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
            <div><label className={label} htmlFor="pe">Email (they sign in with it)</label><input id="pe" type="email" className={input} required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
            <div><label className={label} htmlFor="pr">Role</label>
              <select id="pr" className={input} value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{(me.role === 'owner' ? ROLES : ROLES.filter((r) => !['owner', 'admin'].includes(r))).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></div>
            <div><label className={label} htmlFor="pw">Reason (goes in the log)</label><input id="pw" className={input} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="e.g. New support person" /></div>
            <div className="flex items-end"><button type="submit" className={`${btn.primary} w-full`} disabled={busy}>{busy ? 'Adding…' : 'Add person'}</button></div>
          </form>
          {(msg || secret) && <div className="px-4 pb-4 space-y-2">{msg && <Notice kind={msg.kind}>{msg.text}</Notice>}{secret && <Secret title={`Password for ${secret.name}:`} value={secret.value} onClose={() => setSecret(null)} />}</div>}
        </Panel>
      )}

      <div className="flex flex-wrap gap-5 items-start">
        <Panel title="Sales CRM team" className="flex-[1_1_420px] min-w-0 overflow-hidden" right={<a href="https://crm.pocketlink.store/team" target="_blank" rel="noreferrer" className="text-[13px] font-semibold">Manage in the CRM <Icon name="ext" size={12} /></a>}>
          {!d.sales.length ? <Empty>No CRM staff.</Empty> : (
            <div className="overflow-x-auto"><table className="w-full border-collapse text-[13.5px]">
              <thead><tr><th scope="col" className={th}>Name</th><th scope="col" className={th}>Role</th><th scope="col" className={th}>Last signed in</th></tr></thead>
              <tbody>{d.sales.map((s, i) => <tr key={i}><td className={td}><b>{s.name}</b><div className="text-[12px] text-[#8fa69a]">{s.email}</div></td><td className={td}>{SALES_ROLE[s.role] || s.role}{s.active ? '' : ' · off'}</td><td className={td}>{s.last_sign_in_at ? whenLabel(s.last_sign_in_at) : 'never'}</td></tr>)}</tbody>
            </table></div>
          )}
        </Panel>
        <Panel title="Old Sales Hub logins" className="flex-[1_1_420px] min-w-0 overflow-hidden" right={<span className="text-[12.5px] text-[#8fa69a]">remove once the CRM has taken over</span>}>
          {!d.hub.length ? <Empty>None left.</Empty> : (
            <ul className="list-none m-0 p-0">
              {d.hub.map((h) => (
                <li key={h.user_id} className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-[#18231d]">
                  <div className="flex-1 min-w-[180px]"><b>{h.name}</b><div className="text-[12px] text-[#8fa69a]">{h.email} · {h.role === 'admin' ? 'Hub admin (the Console uses it)' : 'Hub sales'}</div></div>
                  {canPeople && h.role !== 'admin' && <button type="button" className={btn.small} disabled={hubWhy.trim().length < 3} onClick={async () => { try { await hubRemove(h.user_id, hubWhy); await load(); } catch (x) { setErr(x.message); } }}>Remove</button>}
                </li>
              ))}
              {canPeople && d.hub.some((h) => h.role !== 'admin') && <li className="px-4 py-3"><label className={label} htmlFor="hw">Reason for removing (goes in the log)</label><input id="hw" className={input} value={hubWhy} onChange={(e) => setHubWhy(e.target.value)} placeholder="e.g. Moved to the new CRM" /></li>}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title="Who may do what" className="overflow-hidden">
        <div className="overflow-x-auto"><table className="w-full border-collapse text-[13.5px]">
          <thead><tr><th scope="col" className={th}>Action</th>{ROLES.map((r) => <th key={r} scope="col" className={`${th} text-center`}>{ROLE_LABEL[r]}</th>)}</tr></thead>
          <tbody>{ACTIONS.map(([k, t]) => (
            <tr key={k}><td className={`${td} whitespace-normal`}>{t}</td>{ROLES.map((r) => <td key={r} className={`${td} text-center`}>{CAN[k].includes(r) ? <span className="text-emerald-300 font-extrabold" aria-label="yes">✓</span> : <span className="text-[#5d7367]" aria-label="no">·</span>}</td>)}</tr>
          ))}</tbody>
        </table></div>
        <p className="m-0 px-4 py-3 text-[12.5px] text-[#8fa69a]">Refunds over ₹5,000 are for the Owner only. Nobody can change their own role or switch themselves off, an Admin cannot change an Owner or another Admin, and there is always one active Owner.</p>
      </Panel>
    </div>
  );
}

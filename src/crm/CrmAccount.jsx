// My account: who I am in the CRM, change my own password, sign out.
import { useState } from 'react';
import { useCrm, initials, ROLE_LABEL } from './crmContext.js';
import { crmSetPassword, crmSignOut } from './crmService.js';
import { prettyPhone } from './crmLogic.js';
import { Field, Notice, Icon } from './ui.jsx';
import { btn, card, input } from './crmStyles.js';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function CrmAccount() {
  const { me } = useCrm();
  const [pw, setPw] = useState({ a: '', b: '' });
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const save = async (e) => {
    e.preventDefault();
    setMsg(null);
    if (pw.a.length < 8) { setMsg({ kind: 'error', text: 'Use at least 8 characters.' }); return; }
    if (pw.a !== pw.b) { setMsg({ kind: 'error', text: 'The two passwords are not the same.' }); return; }
    setBusy(true);
    try {
      await crmSetPassword(pw.a);
      setPw({ a: '', b: '' });
      setMsg({ kind: 'ok', text: 'Password changed. Use the new one next time you sign in.' });
    } catch (err) {
      setMsg({ kind: 'error', text: /different from the old/i.test(err.message) ? 'The new password must be different from the old one.' : err.message });
    } finally { setBusy(false); }
  };

  return (
    <div className="px-4 lg:px-7 py-5 max-w-xl space-y-4">
      <h1 className="text-2xl font-extrabold">My account</h1>
      <section className={`${card} p-5 flex items-center gap-4`}>
        <span aria-hidden="true" className="w-14 h-14 rounded-full bg-amber-100 text-amber-800 grid place-items-center font-extrabold text-lg">{initials(me.name)}</span>
        <div className="min-w-0">
          <div className="text-lg font-extrabold">{me.name}</div>
          <div className="text-sm text-gray-600">{ROLE_LABEL[me.role]}{me.area ? ` · ${me.area}` : ''}</div>
          <div className="text-[13px] text-gray-500 truncate">{me.email || ''}{me.phone ? ` · ${prettyPhone(me.phone)}` : ''}</div>
          <div className="text-[13px] text-gray-500">Shift {String(me.shift_start).slice(0, 5)} – {String(me.shift_end).slice(0, 5)} · weekly off {DAYS[me.weekly_off]}</div>
        </div>
      </section>

      <form onSubmit={save} className={`${card} p-5 space-y-3`}>
        <h2 className="font-extrabold text-lg">Change my password</h2>
        <Field label="New password" htmlFor="np1" hint="At least 8 characters.">
          <input id="np1" type={show ? 'text' : 'password'} autoComplete="new-password" className={input} value={pw.a} onChange={(e) => setPw({ ...pw, a: e.target.value })} />
        </Field>
        <Field label="New password again" htmlFor="np2">
          <input id="np2" type={show ? 'text' : 'password'} autoComplete="new-password" className={input} value={pw.b} onChange={(e) => setPw({ ...pw, b: e.target.value })} />
        </Field>
        <label className="flex items-center gap-2 text-[13px] font-semibold text-gray-700">
          <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} className="w-4 h-4 accent-green-700" />Show the password
        </label>
        {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
        <button type="submit" className={btn.primary} disabled={busy || !pw.a || !pw.b}>{busy ? 'Saving…' : 'Save new password'}</button>
      </form>

      <button type="button" className={`${btn.ghost} w-full text-red-700`} onClick={() => crmSignOut()}><Icon name="out" size={16} />Sign out</button>
    </div>
  );
}

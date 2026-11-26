// One store, with full control: details, shop settings, plan (extend, free
// days, cash, back to free), pause, delete and restore, and its own log.
// Every change asks for a reason (where it matters) and is written to the
// audit log by the database.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAdmin } from './adminContext.js';
import { adminStore, storeUpdate, setPlan, setStatus } from './adminService.js';
import {
  stateOf, planLabel, paysBy, inr, num, dayLabel, whenLabel, daysLeft, extendedEnd, extendedByYears, dateInputEnd, changedKeys, actionLabel, diffLine, isPaid,
} from './adminLogic.js';
import { Icon, Chip, Kpi, Panel, Spinner, Notice, Empty } from './ui.jsx';
import { btn, card, input, label, th, td } from './adminStyles.js';

const TABS = [['overview', 'Overview'], ['settings', 'Shop settings'], ['plan', 'Plan and payments'], ['danger', 'Pause or delete'], ['log', 'Activity log']];
const SHOP = 'https://www.pocketlink.store';

function Row({ k, children }) {
  return <div className="flex flex-wrap gap-x-4 gap-y-0.5 py-2 border-b border-[#18231d] text-[14px]"><span className="w-44 text-[#8fa69a]">{k}</span><span className="flex-1 min-w-[160px] break-words">{children || '—'}</span></div>;
}

function Settings({ s, onSaved }) {
  const c = useMemo(() => s.config || {}, [s.config]);
  const start = { businessName: c.businessName || '', tagline: c.tagline || '', whatsappNumber: c.whatsappNumber || '', businessType: c.businessType || '', city: c.city || '', area: c.area || '', address: c.address || '' };
  const [f, setF] = useState(start);
  const [mode, setMode] = useState(c.theme?.mode === 'dark' ? 'dark' : 'light');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const patch = useMemo(() => {
    const p = changedKeys(c, f);
    if (mode !== (c.theme?.mode === 'dark' ? 'dark' : 'light')) p.theme = { ...(c.theme || {}), mode };
    if (p.whatsappNumber) p.whatsappNumber = String(p.whatsappNumber).replace(/\D/g, '');
    return p;
  }, [c, f, mode]);
  const save = async () => {
    setBusy(true); setMsg(null);
    try { await storeUpdate(s.slug, patch, reason); setMsg({ kind: 'ok', text: 'Saved. The change is in the activity log.' }); setReason(''); await onSaved(); }
    catch (x) { setMsg({ kind: 'error', text: x.message }); } finally { setBusy(false); }
  };
  if (!s.can.edit) return <Notice kind="warn">Your role can see these settings but not change them.</Notice>;
  const fields = [['businessName', 'Shop name'], ['tagline', 'One line about the shop'], ['whatsappNumber', 'WhatsApp number for orders'], ['businessType', 'Type of business'], ['city', 'City'], ['area', 'Area'], ['address', 'Address']];
  return (
    <Panel title="Shop settings" right={<span className="text-[12.5px] text-[#8fa69a]">every change is logged with before and after</span>}>
      <div className="p-4 grid gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
        {fields.map(([k, t]) => (
          <div key={k}><label className={label} htmlFor={`f-${k}`}>{t}</label><input id={`f-${k}`} className={input} value={f[k]} onChange={set(k)} disabled={!s.can.private && k === 'whatsappNumber'} /></div>
        ))}
        <div><label className={label} htmlFor="f-look">Look</label>
          <select id="f-look" className={input} value={mode} onChange={(e) => setMode(e.target.value)}><option value="light">Light</option><option value="dark">Premium Dark</option></select></div>
      </div>
      <div className="px-4 pb-4 flex flex-wrap gap-3 items-end">
        <div className="flex-[1_1_280px]"><label className={label} htmlFor="f-why">Reason (optional, goes in the log)</label><input id="f-why" className={input} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Owner asked on WhatsApp" /></div>
        <button type="button" className={btn.ghost} onClick={() => { setF(start); setMode(c.theme?.mode === 'dark' ? 'dark' : 'light'); }}>Undo changes</button>
        <button type="button" className={btn.primary} disabled={busy || !Object.keys(patch).length} onClick={save}>{busy ? 'Saving…' : `Save ${Object.keys(patch).length || ''} change${Object.keys(patch).length === 1 ? '' : 's'}`}</button>
      </div>
      {msg && <div className="px-4 pb-4"><Notice kind={msg.kind}>{msg.text}</Notice></div>}
    </Panel>
  );
}

function PlanBox({ s, onSaved }) {
  const c = s.config || {};
  const paid = isPaid(c.plan);
  const [what, setWhat] = useState('extend');
  const [days, setDays] = useState('30');
  const [date, setDate] = useState('');
  const [by, setBy] = useState('cash');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [now] = useState(() => Date.now());
  const end = what === 'free' ? null : days === 'date' ? dateInputEnd(date)
    : days === '1y' ? extendedByYears(paid ? c.planExpiresAt : null, 1, now) : extendedEnd(paid ? c.planExpiresAt : null, Number(days), now);
  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      await setPlan(s.slug, { plan: what === 'free' ? 'free' : 'premium', expiresAt: end, paidBy: what === 'free' ? 'free' : by, amount: Number(amount) || 0, reason });
      setMsg({ kind: 'ok', text: what === 'free' ? 'Moved to Free.' : `Pro until ${dayLabel(end)}.` }); setReason(''); setAmount('');
      await onSaved();
    } catch (x) { setMsg({ kind: 'error', text: x.message }); } finally { setBusy(false); }
  };
  const left = daysLeft(c.planExpiresAt, now);
  return (
    <div className="space-y-5">
      <Panel title="Plan now">
        <div className="p-4 flex flex-wrap gap-4 items-start">
          <div className="flex-1 min-w-[240px]">
            <div className="text-[22px] font-extrabold">{planLabel(c.plan)}</div>
            <div className="text-[13.5px] text-[#8fa69a] mt-1">
              {paid ? (c.planExpiresAt ? `${left >= 0 ? 'Ends' : 'Ended'} ${dayLabel(c.planExpiresAt)}${left >= 0 ? ` · ${left} days left` : ''}` : 'No end date') : 'No paid plan'}
              {c.razorpaySubscriptionId ? ' · auto-pay with Razorpay' : ''}
              {c.billingNote?.amount ? ` · last cash/bank ${inr(c.billingNote.amount)} on ${c.billingNote.startedAt || ''}` : ''}
            </div>
          </div>
          <Chip tone={stateOf(s.state).tone}>{stateOf(s.state).label}</Chip>
        </div>
      </Panel>

      {s.can.plan ? (
        <Panel title="Change the plan">
          <div className="p-4 grid gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            <div><label className={label} htmlFor="p-what">What</label>
              <select id="p-what" className={input} value={what} onChange={(e) => setWhat(e.target.value)}>
                <option value="extend">{paid ? 'Extend Pro' : 'Give Pro'}</option><option value="free">Move to Free</option>
              </select></div>
            {what !== 'free' && (
              <div><label className={label} htmlFor="p-days">{paid ? 'Add' : 'For'}</label>
                <select id="p-days" className={input} value={days} onChange={(e) => setDays(e.target.value)}>
                  <option value="7">7 days</option><option value="30">1 month (30 days)</option><option value="1y">1 year</option><option value="date">Until a date…</option>
                </select></div>
            )}
            {what !== 'free' && days === 'date' && (
              <div><label className={label} htmlFor="p-date">Until</label><input id="p-date" type="date" className={input} value={date} onChange={(e) => setDate(e.target.value)} /></div>
            )}
            {what !== 'free' && (
              <div><label className={label} htmlFor="p-by">Paid by</label>
                <select id="p-by" className={input} value={by} onChange={(e) => setBy(e.target.value)}>
                  <option value="cash">Cash</option><option value="bank">Bank transfer</option><option value="razorpay">Razorpay (they paid online)</option><option value="free">Free of charge</option>
                </select></div>
            )}
            {what !== 'free' && (by === 'cash' || by === 'bank') && (
              <div><label className={label} htmlFor="p-amt">Amount received (₹)</label><input id="p-amt" inputMode="numeric" className={input} value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} placeholder="14999" /></div>
            )}
            <div className="sm:col-span-2"><label className={label} htmlFor="p-why">Reason (required, goes in the log)</label><input id="p-why" className={input} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={what === 'free' ? 'e.g. Owner asked to stop' : 'e.g. Renewed at the shop, receipt 0042'} /></div>
          </div>
          <div className="px-4 pb-4 flex flex-wrap items-center gap-3">
            <span className="flex-1 text-[13.5px] text-[#c8d6ce]">{what === 'free' ? 'The shop goes to Free now.' : end ? `New end date: ${dayLabel(end)}` : 'Pick a date'}</span>
            <button type="button" className={btn.primary} disabled={busy || reason.trim().length < 3 || (what !== 'free' && !end)} onClick={save}>{busy ? 'Saving…' : 'Save plan'}</button>
          </div>
          {c.razorpaySubscriptionId && <div className="px-4 pb-4"><Notice kind="warn">This shop pays by Razorpay auto-pay. Changing the plan here does not stop or change the auto-pay; the daily check only ever moves the end date later.</Notice></div>}
          {msg && <div className="px-4 pb-4"><Notice kind={msg.kind}>{msg.text}</Notice></div>}
        </Panel>
      ) : <Notice kind="warn">Your role cannot change plans.</Notice>}

      <Panel title="Plan history" className="overflow-hidden">
        {!(s.plans || []).length ? <Empty>No plan records yet.</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13.5px]">
              <thead><tr><th scope="col" className={th}>Recorded</th><th scope="col" className={th}>Plan</th><th scope="col" className={th}>From</th><th scope="col" className={th}>Until</th><th scope="col" className={th}>How</th><th scope="col" className={th}>Status</th></tr></thead>
              <tbody>
                {s.plans.map((p, i) => (
                  <tr key={i}>
                    <td className={td}>{dayLabel(p.created_at)}</td><td className={td}>{planLabel(p.plan)}</td><td className={td}>{dayLabel(p.starts_at) || '—'}</td><td className={td}>{dayLabel(p.expires_at) || 'No end'}</td>
                    <td className={td}>{{ console: 'Admin / Console', razorpay_subscription: 'Razorpay auto-pay', razorpay_payment: 'Razorpay payment', coupon: 'Coupon', migration_backfill: 'Before the plan ledger' }[p.source] || p.source}{p.verified ? ' · payment checked' : ''}</td>
                    <td className={td}><Chip tone={p.status === 'active' ? 'ok' : 'off'}>{p.status}</Chip></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

function Danger({ s, onSaved }) {
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState(null);
  const run = async (status, text) => {
    setBusy(status); setMsg(null);
    try { await setStatus(s.slug, status, reason, status === 'deleted' ? typed : null); setMsg({ kind: 'ok', text }); setReason(''); setTyped(''); await onSaved(); }
    catch (x) { setMsg({ kind: 'error', text: x.message }); } finally { setBusy(''); }
  };
  const st = s.admin_status;
  const autopay = Boolean(s.config?.razorpaySubscriptionId) && daysLeft(s.config?.planExpiresAt) > 0;
  const okReason = reason.trim().length >= 3;
  return (
    <section aria-label="Pause or delete" className="rounded-2xl border border-red-900 bg-[#1a0f0f]">
      <div className="px-4 py-3.5 border-b border-[#4c1d1d]"><h2 className="m-0 text-[15px] font-bold text-red-200">Pause or delete</h2></div>
      <div className="p-4 space-y-5">
        <div className="max-w-xl"><label className={label} htmlFor="d-why">Reason (required, goes in the log)</label><input id="d-why" className={input} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Fake orders reported by 3 customers" /></div>
        {st !== 'deleted' && (
          <div>
            <div className="font-bold text-[14px]">{st === 'paused' ? 'The shop is paused' : 'Pause the shop'}</div>
            <p className="m-0 mt-1 mb-2.5 text-[13px] text-[#8fa69a]">{st === 'paused' ? 'Its page says "closed for now" and it is not in the Marketplace. The owner can still sign in.' : 'The shop page says "closed for now" and leaves the Marketplace. The owner can still sign in. Open it again any time.'}</p>
            {s.can.pause ? (st === 'paused'
              ? <button type="button" className={btn.primary} disabled={!okReason || !!busy} onClick={() => run('open', 'The shop is open again.')}>{busy === 'open' ? 'Opening…' : 'Open the shop again'}</button>
              : <button type="button" className={btn.danger} disabled={!okReason || !!busy} onClick={() => run('paused', 'The shop is paused.')}>{busy === 'paused' ? 'Pausing…' : 'Pause shop'}</button>)
              : <p className="m-0 text-[13px] text-amber-200">Your role cannot pause shops.</p>}
          </div>
        )}
        <div>
          <div className="font-bold text-[14px]">{st === 'deleted' ? 'The shop is deleted' : 'Delete the shop'}</div>
          <p className="m-0 mt-1 mb-2.5 text-[13px] text-[#8fa69a]">{st === 'deleted'
            ? `Deleted ${whenLabel(s.admin_status_at)}. Its page and dashboard are closed and it is hidden everywhere. Its data is kept, so you can restore it.`
            : 'Closes the shop page and the owner’s dashboard and hides it everywhere. Its data is kept, so you can restore it.'}</p>
          {!s.can.delete ? <p className="m-0 text-[13px] text-amber-200">Only the Owner can delete or restore shops.</p>
            : st === 'deleted' ? <button type="button" className={btn.primary} disabled={!okReason || !!busy} onClick={() => run('open', 'The shop is restored.')}>{busy === 'open' ? 'Restoring…' : 'Restore the shop'}</button>
              : autopay ? <Notice kind="warn">This shop still pays by Razorpay auto-pay. Stop the subscription in Razorpay first, then delete.</Notice>
                : (
                  <div className="flex flex-wrap gap-2.5 items-end max-w-xl">
                    <div className="flex-1 min-w-[200px]"><label className={label} htmlFor="d-type">Type <b className="text-red-200">{s.slug}</b> to confirm</label><input id="d-type" className={`${input} border-red-900`} value={typed} onChange={(e) => setTyped(e.target.value.trim())} placeholder={s.slug} /></div>
                    <button type="button" className={btn.red} disabled={!okReason || typed !== s.slug || !!busy} onClick={() => run('deleted', 'The shop is deleted. You can restore it from here.')}>{busy === 'deleted' ? 'Deleting…' : 'Delete shop'}</button>
                  </div>
                )}
        </div>
        {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      </div>
    </section>
  );
}

export default function AdminStore() {
  const { slug } = useParams();
  const { path } = useAdmin();
  const [s, setS] = useState(null);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState('overview');
  const load = useCallback(async () => {
    try { setS(await adminStore(slug)); setErr(''); } catch (x) { setErr(x.message); }
  }, [slug]);
  useEffect(() => { load(); }, [load]);

  if (err && !s) return <div className="space-y-3"><Link to={path('stores')} className="text-[13px]">← Stores</Link><Notice>{err}</Notice></div>;
  if (!s) return <Spinner />;
  const c = s.config || {};
  const st = stateOf(s.state);
  const phone = c.ownerPhone || '';
  const digits = String(phone).replace(/\D/g, '');
  return (
    <div className="space-y-5 max-w-[1300px]">
      <nav aria-label="Breadcrumb" className="text-[13px] text-[#8fa69a]"><Link to={path('stores')}>Stores</Link> › {c.businessName || s.slug}</nav>
      <section aria-label="Store" className={`${card} p-4 flex flex-wrap gap-4 items-center`}>
        <span aria-hidden="true" className="w-14 h-14 rounded-2xl bg-emerald-300 text-[#052e1f] grid place-items-center font-extrabold text-[20px]">{String(c.businessName || s.slug).slice(0, 2).toUpperCase()}</span>
        <div className="flex-1 min-w-[260px] space-y-1.5">
          <h1 className="m-0 text-[24px] font-extrabold">{c.businessName || s.slug}</h1>
          <div className="text-[13.5px]"><a href={`${SHOP}/${s.slug}`} target="_blank" rel="noreferrer">pocketlink.store/{s.slug}</a> <span className="text-[#8fa69a]">· {[c.businessType, c.city].filter(Boolean).join(' · ')} · made {dayLabel(s.created_at)}</span></div>
          <div className="flex flex-wrap gap-1.5"><Chip tone={st.tone}>{st.label}</Chip><Chip tone={isPaid(c.plan) ? 'ok' : 'info'}>{planLabel(c.plan)}</Chip>{c.razorpaySubscriptionId && <Chip tone="ok">Auto-pay</Chip>}<Chip>{c.theme?.mode === 'dark' ? 'Premium Dark' : 'Light'}</Chip></div>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={`${SHOP}/${s.slug}`} target="_blank" rel="noreferrer" className={btn.ghost}><Icon name="ext" size={16} />Open shop page</a>
          {s.can.private && digits.length >= 10 && <a href={`https://wa.me/${digits.length === 10 ? `91${digits}` : digits}`} target="_blank" rel="noreferrer" className={btn.ghost}><Icon name="wa" size={16} />WhatsApp owner</a>}
        </div>
      </section>

      <section aria-label="Numbers" className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
        <Kpi label="Orders · 30 days" value={num(s.stats.orders_30)} sub={`${s.stats.online_30} paid online`} />
        <Kpi label="Sales · 30 days" value={inr(s.stats.sales_30)} />
        <Kpi label="All orders" value={num(s.stats.orders_all)} sub={s.stats.last_order_at ? `last ${dayLabel(s.stats.last_order_at)}` : 'none yet'} />
        <Kpi label="Coins" value={num(s.coins)} sub="for WhatsApp messages" />
      </section>

      <div role="tablist" aria-label="Store sections" className="flex flex-wrap gap-1 p-1.5 rounded-2xl bg-[#111a15] border border-[#1f2b24]">
        {TABS.map(([k, t]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`h-9 px-3 rounded-xl text-[13px] font-semibold border-0 cursor-pointer ${tab === k ? 'bg-[#e7efe9] text-[#0a0f0c]' : 'bg-transparent text-[#a9bdb2] hover:bg-[#16211b]'}`}>{t}</button>
        ))}
      </div>

      {tab === 'overview' && (
        <Panel title="About this shop">
          <div className="px-4 py-2">
            <Row k="Owner's mobile">{phone ? (s.can.private && digits.length >= 10 ? <a href={`tel:+${digits.length === 10 ? `91${digits}` : digits}`}>{phone}</a> : phone) : ''}</Row>
            <Row k="WhatsApp for orders">{c.whatsappNumber}</Row>
            <Row k="Type of business">{c.businessType}</Row>
            <Row k="Place">{[c.area, c.city, c.state].filter(Boolean).join(', ')}</Row>
            <Row k="Address">{c.address}</Row>
            <Row k="Plan">{planLabel(c.plan)}{isPaid(c.plan) ? ` · ${c.planExpiresAt ? `until ${dayLabel(c.planExpiresAt)}` : 'no end date'} · ${paysBy(c.razorpaySubscriptionId ? 'razorpay' : c.billingNote?.method)}` : ''}</Row>
            <Row k="Products">{Array.isArray(c.products) ? c.products.length : 0}</Row>
            <Row k="Online payments">{c.payments?.razorpay ? 'Razorpay connected' : 'Not connected'}</Row>
            <Row k="Made on">{whenLabel(s.created_at)}</Row>
            <Row k="Last changed">{whenLabel(s.updated_at)}</Row>
          </div>
        </Panel>
      )}
      {tab === 'settings' && <Settings key={s.updated_at} s={s} onSaved={load} />}
      {tab === 'plan' && <PlanBox key={`${s.updated_at}-p`} s={s} onSaved={load} />}
      {tab === 'danger' && <Danger s={s} onSaved={load} />}
      {tab === 'log' && (
        <Panel title="Changes made in Admin" className="overflow-hidden">
          {!(s.log || []).length ? <Empty>No changes made in Admin yet.</Empty> : (
            <ul className="list-none m-0 p-0">
              {s.log.map((g, i) => (
                <li key={i} className="px-4 py-3 border-b border-[#18231d]">
                  <div className="text-[14px] font-semibold">{actionLabel(g.action)} <span className="text-[#8fa69a] font-normal">· {g.who} · {whenLabel(g.at)}</span></div>
                  {diffLine(g.before, g.after) && <div className="text-[13px] text-[#c8d6ce] mt-0.5 break-words">{diffLine(g.before, g.after)}</div>}
                  {g.reason && <div className="text-[12.5px] text-[#8fa69a] mt-0.5">Reason: {g.reason}</div>}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}
    </div>
  );
}

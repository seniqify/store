// Billing and plans: renewals that did not come through, plans ending soon,
// paid sign-ups with no shop, every paying shop, cash and bank payments, and
// every plan change made in Admin. Prices are shown as they are today.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAdmin } from './adminContext.js';
import { adminBilling } from './adminService.js';
import { stateOf, planLabel, paysBy, inr, dayLabel, whenLabel, daysLeft, diffLine } from './adminLogic.js';
import { PRICE } from '../utils/planLimits.js';
import { Chip, Kpi, Panel, Spinner, Notice, Empty } from './ui.jsx';
import { btn, th, td } from './adminStyles.js';

function Table({ head, children }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[13.5px]">
        <thead><tr>{head.map((h) => <th key={h} scope="col" className={th}>{h}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export default function AdminBilling() {
  const { path } = useAdmin();
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let alive = true;
    adminBilling().then((x) => alive && setD(x)).catch((x) => alive && setErr(x.message));
    return () => { alive = false; };
  }, []);
  if (err) return <Notice>{err}</Notice>;
  if (!d) return <Spinner />;
  const subs = d.subscriptions || [];
  const missing = subs.filter((x) => x.state === 'renewal_missing');
  const ending = subs.filter((x) => x.state === 'ending');
  const paying = subs.filter((x) => x.state === 'active' || x.state === 'ending');
  const shop = (x) => <Link to={path(`stores/${x.slug}`)} className="font-bold text-[#e7efe9] no-underline hover:underline">{x.name}</Link>;
  return (
    <div className="space-y-5 max-w-[1400px]">
      <header>
        <h1 className="m-0 text-[26px] font-extrabold">Billing and plans</h1>
        <p className="m-0 mt-1 text-[14px] text-[#8fa69a]">Plans shops pay for, renewals, cash and bank payments, and every plan change made here.</p>
      </header>

      <section aria-label="Key numbers" className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
        <Kpi label="Paying shops" value={paying.length} sub={`${paying.filter((x) => x.autopay).length} by auto-pay`} />
        <Kpi label="Renewal not received" value={missing.length} sub="auto-pay, plan date passed" tone={missing.length ? 'bad' : undefined} />
        <Kpi label="Ending in 14 days" value={ending.length} tone={ending.length ? 'warn' : undefined} />
        <Kpi label="Paid, no shop yet" value={(d.unclaimed || []).length} tone={(d.unclaimed || []).length ? 'warn' : undefined} />
      </section>

      <div className="flex flex-wrap gap-5 items-start">
        <div className="flex-[3_1_620px] min-w-0 space-y-5">
          <Panel title="Auto-pay renewals not received" className="overflow-hidden" right={<span className="text-[12.5px] text-[#8fa69a]">check each in Razorpay, or extend by hand</span>}>
            {!missing.length ? <Empty>None. Every auto-pay shop is paid up.</Empty> : (
              <Table head={['Shop', 'Plan', 'Plan date passed', '']}>
                {missing.map((x) => <tr key={x.slug}><td className={td}>{shop(x)}</td><td className={td}>{planLabel(x.plan)}</td><td className={td}>{dayLabel(x.expires)}</td><td className={td}><Link to={path(`stores/${x.slug}`)} className={btn.small}>Open</Link></td></tr>)}
              </Table>
            )}
          </Panel>

          <Panel title="Ending in the next 14 days" className="overflow-hidden">
            {!ending.length ? <Empty>No plans end in the next 14 days.</Empty> : (
              <Table head={['Shop', 'Ends', 'Days left', 'Pays by']}>
                {ending.map((x) => <tr key={x.slug}><td className={td}>{shop(x)}</td><td className={td}>{dayLabel(x.expires)}</td><td className={td}>{daysLeft(x.expires)}</td><td className={td}>{paysBy(x.autopay ? 'razorpay' : x.method)}</td></tr>)}
              </Table>
            )}
          </Panel>

          <Panel title="Paid, but no shop made yet" className="overflow-hidden" right={<span className="text-[12.5px] text-[#8fa69a]">call them to finish</span>}>
            {!(d.unclaimed || []).length ? <Empty>None.</Empty> : (
              <Table head={['Mobile', 'Plan', 'Paid on', 'Plan until', 'Auto-pay']}>
                {d.unclaimed.map((u, i) => <tr key={i}><td className={td}>{u.phone}</td><td className={td}>{planLabel(u.plan)}</td><td className={td}>{whenLabel(u.at)}</td><td className={td}>{dayLabel(u.expires) || '—'}</td><td className={td}>{u.autopay ? 'Yes' : 'No'}</td></tr>)}
              </Table>
            )}
          </Panel>

          <Panel title="Every paid shop" className="overflow-hidden" right={<span className="text-[12.5px] text-[#8fa69a]">{subs.length}</span>}>
            {!subs.length ? <Empty>No paid shops.</Empty> : (
              <Table head={['Shop', 'Plan', 'Until', 'Pays by', 'Status']}>
                {subs.map((x) => { const st = stateOf(x.state); return <tr key={x.slug}><td className={td}>{shop(x)}</td><td className={td}>{planLabel(x.plan)}</td><td className={td}>{dayLabel(x.expires) || 'No end date'}</td><td className={td}>{paysBy(x.autopay ? 'razorpay' : x.method)}</td><td className={td}><Chip tone={st.tone}>{st.label}</Chip></td></tr>; })}
              </Table>
            )}
          </Panel>
        </div>

        <div className="flex-[2_1_360px] min-w-0 space-y-5">
          <Panel title="Prices today">
            <div className="p-4 space-y-3 text-[14px]">
              <div className="flex items-center gap-3"><span className="flex-1">PocketLink Pro · monthly</span><b className="text-[18px]">{inr(PRICE.monthly)}</b></div>
              <div className="flex items-center gap-3"><span className="flex-1">PocketLink Pro · yearly</span><b className="text-[18px]">{inr(PRICE.yearly)}</b></div>
              <p className="m-0 text-[12.5px] text-[#8fa69a]">GST included. Changing a price also needs a new Razorpay plan; that comes in a later part.</p>
            </div>
          </Panel>

          <Panel title="Cash and bank payments">
            {!(d.cash_notes || []).length ? <Empty>None recorded.</Empty> : (
              <ul className="list-none m-0 p-0">
                {d.cash_notes.map((c) => (
                  <li key={c.slug} className="px-4 py-2.5 border-b border-[#18231d]">
                    <div className="text-[13.5px] font-semibold"><Link to={path(`stores/${c.slug}`)} className="text-[#e7efe9] no-underline hover:underline">{c.name}</Link> · {inr(c.note?.amount)}</div>
                    <div className="text-[12.5px] text-[#8fa69a]">{paysBy(c.note?.method)} · {c.note?.startedAt || ''}{c.note?.expiresAt ? ` → ${c.note.expiresAt}` : ''}{c.note?.setBy ? ` · by ${c.note.setBy}` : ''}</div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Plan changes made in Admin">
            {!(d.changes || []).length ? <Empty>None yet.</Empty> : (
              <ul className="list-none m-0 p-0">
                {d.changes.map((c, i) => (
                  <li key={i} className="px-4 py-2.5 border-b border-[#18231d]">
                    <div className="text-[13.5px] font-semibold"><Link to={path(`stores/${c.target}`)} className="text-[#e7efe9] no-underline hover:underline">{c.target}</Link> <span className="text-[#8fa69a] font-normal">· {c.who} · {whenLabel(c.at)}</span></div>
                    <div className="text-[12.5px] text-[#c8d6ce]">{diffLine({}, c.after)}</div>
                    {c.reason && <div className="text-[12.5px] text-[#8fa69a]">Reason: {c.reason}</div>}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

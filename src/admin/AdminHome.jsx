// Admin home: the numbers that matter today and what needs the founder.
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAdmin } from './adminContext.js';
import { adminHome } from './adminService.js';
import { inr, num, dayLabel, whenLabel, daysLeft, actionLabel } from './adminLogic.js';
import { Icon, Kpi, Panel, Spinner, Notice, Empty } from './ui.jsx';
import { btn } from './adminStyles.js';

export default function AdminHome() {
  const { me, path } = useAdmin();
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let alive = true;
    adminHome().then((x) => alive && setD(x)).catch((x) => alive && setErr(x.message));
    return () => { alive = false; };
  }, []);
  if (err) return <Notice>{err}</Notice>;
  if (!d) return <Spinner />;
  const needs = d.needs || [];
  const count = needs.length + (d.unclaimed > 0 ? 1 : 0);
  return (
    <div className="space-y-5 max-w-[1400px]">
      <header className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[240px]">
          <h1 className="m-0 text-[26px] font-extrabold">Hello, {String(me.name || '').split(' ')[0]}</h1>
          <p className="m-0 mt-1 text-[14px] text-[#8fa69a]">Every shop on PocketLink, in one place.</p>
        </div>
        <Link to={path('stores')} className={btn.ghost}><Icon name="store" size={16} />All stores</Link>
      </header>

      {count > 0 && (
        <section aria-label="Today" className="flex flex-wrap items-center gap-3 rounded-2xl border border-[#5c4413] bg-[#2a1f08] px-4 py-3.5">
          <Icon name="alert" className="text-amber-300" />
          <p className="m-0 flex-1 min-w-[220px] text-[14.5px] text-amber-100"><b>{count} thing{count === 1 ? '' : 's'} need{count === 1 ? 's' : ''} you.</b> {d.renewal_missing ? `${d.renewal_missing} auto-pay renewal${d.renewal_missing === 1 ? '' : 's'} did not come through. ` : ''}{d.unclaimed ? `${d.unclaimed} paid sign-up${d.unclaimed === 1 ? '' : 's'} with no shop.` : ''}</p>
          <a href="#needs" className={btn.small}>Go through them</a>
        </section>
      )}

      <section aria-label="Key numbers" className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
        <Kpi label="Shops" value={num(d.stores)} sub={`${d.new_7d} new this week${d.paused ? ` · ${d.paused} paused` : ''}`} />
        <Kpi label="Paying shops" value={d.paying} sub={`${d.ending} end in 14 days`} />
        <Kpi label="Renewal not received" value={d.renewal_missing} sub="auto-pay, plan date passed" tone={d.renewal_missing ? 'bad' : undefined} />
        <Kpi label="Plan ended" value={d.ended} sub="paid before, not now" tone={d.ended ? 'warn' : undefined} />
        <Kpi label="Orders today" value={num(d.orders_today)} sub={`${inr(d.sales_today)} · ${d.shops_today} shops`} />
        <Kpi label="Paid, no shop yet" value={d.unclaimed} sub="sign-ups to finish" tone={d.unclaimed ? 'warn' : undefined} />
      </section>

      <div className="flex flex-wrap gap-5 items-start">
        <Panel title="Needs you" className="flex-[2_1_560px] min-w-0" right={<span className="text-[12.5px] text-[#8fa69a]">{count} open</span>}>
          <ul id="needs" className="list-none m-0 p-0">
            {d.unclaimed > 0 && (
              <li className="flex flex-wrap items-center gap-3 px-4 py-3.5 border-b border-[#18231d]">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                <div className="flex-1 min-w-[220px]"><div className="font-bold text-[14.5px]">{d.unclaimed} paid sign-up{d.unclaimed === 1 ? '' : 's'} with no shop made</div><div className="text-[13px] text-[#8fa69a]">They paid but stopped before making their shop</div></div>
                <Link to={path('billing')} className={btn.small}>See them</Link>
              </li>
            )}
            {needs.map((n) => {
              const days = daysLeft(n.exp);
              const missing = n.kind === 'renewal_missing';
              return (
                <li key={n.slug} className="flex flex-wrap items-center gap-3 px-4 py-3.5 border-b border-[#18231d]">
                  <span className={`w-2.5 h-2.5 rounded-full ${missing ? 'bg-red-400' : 'bg-amber-400'}`} />
                  <div className="flex-1 min-w-[220px]">
                    <div className="font-bold text-[14.5px]">{n.name}: {missing ? 'auto-pay renewal not received' : `plan ends in ${days} day${days === 1 ? '' : 's'}`}</div>
                    <div className="text-[13px] text-[#8fa69a]">{missing ? `Plan date passed on ${dayLabel(n.exp)}. Check Razorpay, or extend.` : `Ends ${dayLabel(n.exp)}`}</div>
                  </div>
                  <Link to={path(`stores/${n.slug}`)} className={btn.small}>Open shop</Link>
                </li>
              );
            })}
            {!count && <li><Empty>Nothing needs you right now.</Empty></li>}
          </ul>
        </Panel>

        <div className="flex-[1_1_340px] min-w-0 space-y-5">
          <Panel title="Changes made in Admin" right={<Link to={path('log')} className="text-[13px] font-semibold">Audit log</Link>}>
            {!(d.recent || []).length ? <Empty>No changes yet.</Empty> : (
              <ul className="list-none m-0 py-1.5 px-0">
                {d.recent.map((r, i) => (
                  <li key={i} className="flex gap-3 px-4 py-2.5">
                    <span className="w-[86px] flex-none text-[12px] text-[#80988b] pt-0.5">{whenLabel(r.at)}</span>
                    <div className="min-w-0"><div className="text-[13.5px] font-semibold">{actionLabel(r.action)}{r.target ? ` · ${r.target}` : ''}</div><div className="text-[12.5px] text-[#8fa69a] truncate">{r.who}{r.reason ? ` · ${r.reason}` : ''}</div></div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="New shops">
            {!(d.new_shops || []).length ? <Empty>No shops yet.</Empty> : (
              <ul className="list-none m-0 py-1.5 px-0">
                {d.new_shops.map((s) => (
                  <li key={s.slug}><Link to={path(`stores/${s.slug}`)} className="flex items-center gap-3 px-4 py-2.5 no-underline text-[#e7efe9] hover:bg-[#16211b]">
                    <span className="flex-1 min-w-0"><span className="block text-[13.5px] font-semibold truncate">{s.name}</span><span className="block text-[12px] text-[#8fa69a]">pocketlink.store/{s.slug}</span></span>
                    <span className="text-[12px] text-[#80988b]">{dayLabel(s.at)}</span></Link></li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

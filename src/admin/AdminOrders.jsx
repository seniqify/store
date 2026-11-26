// Orders and delivery: every order across shops (read only), parcels, stuck
// bookings, and the reviews shops have reported (keep or remove).
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAdmin } from './adminContext.js';
import { ordersList, ordersSummary, reviewReports, reviewDecide } from './adminService.js';
import { inr, num, whenLabel, canDo } from './adminLogic.js';
import { Chip, Kpi, Panel, Spinner, Notice, Empty } from './ui.jsx';
import { btn, input, th, td } from './adminStyles.js';

const tone = (s) => ({ delivered: 'ok', cancelled: 'off', returned: 'bad', new: 'info' }[s] || 'off');

function Review({ r, canDecide, onDone }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const decide = async (d) => {
    setBusy(d); setErr('');
    try { await reviewDecide(r.report_id, d, note); await onDone(); } catch (x) { setErr(x.message); setBusy(''); }
  };
  return (
    <li className="px-4 py-3.5 border-b border-[#18231d] space-y-2">
      <div className="text-[13.5px]"><b>{r.rating} star{r.rating === 1 ? '' : 's'}</b> · {r.store_name} · by {r.name || 'a customer'}{r.verified ? ' · verified buyer' : ''}</div>
      <div className="text-[14px]">“{r.body}”</div>
      <div className="text-[12.5px] text-[#8fa69a]">Shop says: {r.reason} · reported {whenLabel(r.reported_at)}</div>
      {canDecide && (
        <div className="flex flex-wrap gap-2 items-center">
          <input aria-label="Reason" className={`${input} h-9 flex-[1_1_240px]`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason (needed to remove)" />
          <button type="button" className={btn.small} disabled={!!busy || note.trim().length < 3} onClick={() => decide('removed')}>{busy === 'removed' ? 'Removing…' : 'Remove review'}</button>
          <button type="button" className={btn.small} disabled={!!busy} onClick={() => decide('kept')}>{busy === 'kept' ? 'Keeping…' : 'Keep it'}</button>
        </div>
      )}
      {err && <Notice>{err}</Notice>}
    </li>
  );
}

export default function AdminOrders() {
  const { me, path } = useAdmin();
  const [sum, setSum] = useState(null);
  const [rows, setRows] = useState(null);
  const [revs, setRevs] = useState(null);
  const [days, setDays] = useState(7);
  const [status, setStatus] = useState('');
  const [shop, setShop] = useState('');
  const [err, setErr] = useState('');
  const loadRevs = useCallback(async () => { try { setRevs(await reviewReports()); } catch (x) { setErr(x.message); } }, []);
  useEffect(() => {
    let alive = true;
    ordersSummary().then((s) => alive && setSum(s)).catch((x) => alive && setErr(x.message));
    loadRevs();
    return () => { alive = false; };
  }, [loadRevs]);
  useEffect(() => {
    let alive = true;
    ordersList(days, status, shop.trim().toLowerCase()).then((r) => alive && setRows(r)).catch((x) => alive && setErr(x.message));
    return () => { alive = false; };
  }, [days, status, shop]);

  if (err) return <Notice>{err}</Notice>;
  if (!sum) return <Spinner />;
  const parcels = sum.parcels || {};
  const back = parcels.delivered + parcels.returned ? Math.round((parcels.returned * 100) / (parcels.delivered + parcels.returned)) : null;
  return (
    <div className="space-y-5 max-w-[1400px]">
      <header>
        <h1 className="m-0 text-[26px] font-extrabold">Orders and delivery</h1>
        <p className="m-0 mt-1 text-[14px] text-[#8fa69a]">Every order in every shop, parcels, and reviews shops have reported. Orders are changed by the shop, in its own dashboard.</p>
      </header>

      <section aria-label="Key numbers" className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
        <Kpi label="Orders today" value={num(sum.today?.n)} sub={`${inr(sum.today?.amt)} · ${sum.today?.shops || 0} shops`} />
        <Kpi label="Last 7 days" value={num(sum.week?.n)} sub={inr(sum.week?.amt)} />
        <Kpi label="Last 30 days" value={num(sum.month?.n)} sub={inr(sum.month?.amt)} />
        <Kpi label="Parcels on the way" value={num(parcels.moving)} sub="booked in 30 days" />
        <Kpi label="Parcels coming back" value={back == null ? '—' : `${back}%`} sub={`${parcels.returned || 0} of ${(parcels.delivered || 0) + (parcels.returned || 0)} finished`} tone={back >= 20 ? 'warn' : undefined} />
        <Kpi label="Stuck bookings" value={(sum.stuck || []).length} sub="booking not finished in 10 min" tone={(sum.stuck || []).length ? 'warn' : undefined} />
      </section>

      <div className="flex flex-wrap gap-2 items-center">
        <select aria-label="Days" className={`${input} w-auto`} value={days} onChange={(e) => { setRows(null); setDays(Number(e.target.value)); }}>
          <option value={1}>Today and yesterday</option><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={92}>Last 3 months</option>
        </select>
        <select aria-label="Status" className={`${input} w-auto`} value={status} onChange={(e) => { setRows(null); setStatus(e.target.value); }}>
          <option value="">Any status</option>{(sum.by_status || []).map((s) => <option key={s.status} value={s.status}>{s.status} ({s.n})</option>)}
        </select>
        <input aria-label="Shop link" className={`${input} w-auto min-w-[200px]`} value={shop} onChange={(e) => { setRows(null); setShop(e.target.value); }} placeholder="Shop link, e.g. aanyaboutique" />
        <span className="text-[12.5px] text-[#8fa69a]">{(sum.by_method || []).map((m) => `${m.method}: ${m.n}`).join(' · ')} (30 days)</span>
      </div>

      <Panel title="Orders" className="overflow-hidden" right={<span className="text-[12.5px] text-[#8fa69a]">newest 300</span>}>
        {!rows ? <Spinner /> : !rows.length ? <Empty>No orders here.</Empty> : (
          <div className="overflow-x-auto"><table className="w-full border-collapse text-[13.5px]">
            <thead><tr>{['When', 'Shop', 'Customer', 'Items', 'Amount', 'Paid by', 'Status', 'Parcel'].map((h) => <th key={h} scope="col" className={th}>{h}</th>)}</tr></thead>
            <tbody>{rows.map((o) => (
              <tr key={o.id}>
                <td className={`${td} text-[#8fa69a]`}>{whenLabel(o.created_at)}</td>
                <td className={td}><Link to={path(`stores/${o.store_slug}`)} className="text-[#e7efe9] font-semibold no-underline hover:underline">{o.store_name}</Link></td>
                <td className={td}>{o.customer || ''}</td>
                <td className={td}>{o.item_count ?? ''}</td>
                <td className={`${td} font-bold`}>{inr(o.total)}</td>
                <td className={td}>{o.payment_method || ''}{o.paid ? ' · paid' : ''}</td>
                <td className={td}><Chip tone={tone(o.status)}>{o.status || '—'}</Chip></td>
                <td className={td}>{o.courier ? `${o.courier}${o.awb ? ` · ${o.awb}` : ''}${o.ship_end ? ` · ${o.ship_end}` : ''}` : ''}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>

      <div className="flex flex-wrap gap-5 items-start">
        <Panel title="Stuck parcel bookings" className="flex-[1_1_380px] min-w-0">
          {!(sum.stuck || []).length ? <Empty>None. Every booking finished.</Empty> : (
            <ul className="list-none m-0 p-0">{sum.stuck.map((s, i) => (
              <li key={i} className="px-4 py-3 border-b border-[#18231d] text-[13.5px]"><Link to={path(`stores/${s.store_slug}`)} className="font-semibold">{s.store_slug}</Link> · {s.courier} · started {whenLabel(s.claimed_at)}
                <div className="text-[12.5px] text-[#8fa69a]">The shop can book again from its dashboard after 2 minutes.</div></li>
            ))}</ul>
          )}
        </Panel>
        <Panel title="Reviews reported by shops" className="flex-[2_1_520px] min-w-0" right={<span className="text-[12.5px] text-[#8fa69a]">{(revs || []).length} waiting</span>}>
          {!revs ? <Spinner /> : !revs.length ? <Empty>No reported reviews.</Empty> : (
            <ul className="list-none m-0 p-0">{revs.map((r) => <Review key={r.report_id} r={r} canDecide={canDo(me.role, 'edit_store')} onDone={loadRevs} />)}</ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

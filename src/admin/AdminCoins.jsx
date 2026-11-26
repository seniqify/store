// Coins and WhatsApp: Coins sold and used this month, every shop's balance,
// and giving or taking back Coins (with a reason, in the audit log and the
// shop's own Coin history as "Admin: ...").
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAdmin } from './adminContext.js';
import { coinsSummary, coinsAdjust } from './adminService.js';
import { inr, num, whenLabel, canDo } from './adminLogic.js';
import { Kpi, Panel, Spinner, Notice, Empty } from './ui.jsx';
import { btn, input, label, th, td } from './adminStyles.js';

export default function AdminCoins() {
  const { me, path } = useAdmin();
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [f, setF] = useState({ slug: '', coins: '', reason: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [q, setQ] = useState('');
  const load = useCallback(async () => { try { setD(await coinsSummary()); } catch (x) { setErr(x.message); } }, []);
  useEffect(() => { load(); }, [load]);
  const shops = useMemo(() => (d?.shops || []).filter((s) => !q || `${s.name} ${s.slug}`.toLowerCase().includes(q.toLowerCase())), [d, q]);
  const canGive = canDo(me.role, 'plan');
  const amount = Number(f.coins);
  const give = async (e) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try { const left = await coinsAdjust(f.slug.trim().toLowerCase(), amount, f.reason); setMsg({ kind: 'ok', text: `Done. ${f.slug} now has ${num(left)} Coins.` }); setF({ slug: '', coins: '', reason: '' }); await load(); }
    catch (x) { setMsg({ kind: 'error', text: x.message }); } finally { setBusy(false); }
  };

  if (err) return <Notice>{err}</Notice>;
  if (!d) return <Spinner />;
  return (
    <div className="space-y-5 max-w-[1300px]">
      <header>
        <h1 className="m-0 text-[26px] font-extrabold">Coins and WhatsApp</h1>
        <p className="m-0 mt-1 text-[14px] text-[#8fa69a]">Coins pay for WhatsApp messages: 1 Coin = ₹0.50. Every shop gets 500 order confirmations free each month.</p>
      </header>
      <section aria-label="Key numbers" className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        <Kpi label="Coins sold this month" value={inr((d.sold_month?.paise || 0) / 100)} sub={`${d.sold_month?.n || 0} top-ups`} />
        <Kpi label="Paid messages this month" value={num(d.used_month?.messages)} sub={`${num((d.used_month?.paise || 0) / 50)} Coins used`} />
        <Kpi label="Coins held by shops" value={num((d.total_balance || 0) / 50)} sub={inr((d.total_balance || 0) / 100)} />
      </section>

      <div className="flex flex-wrap gap-5 items-start">
        <div className="flex-[1_1_380px] min-w-0 space-y-5">
          {canGive ? (
            <Panel title="Give or take back Coins">
              <form onSubmit={give} className="p-4 space-y-3">
                <div><label className={label} htmlFor="cs">Shop link</label><input id="cs" className={input} required value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value })} placeholder="e.g. aanyaboutique" list="coin-shops" />
                  <datalist id="coin-shops">{(d.shops || []).map((s) => <option key={s.slug} value={s.slug}>{s.name}</option>)}</datalist></div>
                <div><label className={label} htmlFor="cc">Coins (a minus number takes back)</label><input id="cc" inputMode="numeric" className={input} required value={f.coins} onChange={(e) => setF({ ...f, coins: e.target.value.replace(/[^0-9-]/g, '') })} placeholder="200" /></div>
                <div><label className={label} htmlFor="cr">Reason (the shop sees it in its Coin history)</label><input id="cr" className={input} required value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="e.g. Courier delay on 3 orders" /></div>
                <button type="submit" className={`${btn.primary} w-full`} disabled={busy || !f.slug.trim() || !amount || f.reason.trim().length < 3}>{busy ? 'Saving…' : amount < 0 ? `Take back ${num(-amount)} Coins` : `Give ${amount ? num(amount) : ''} Coins`}</button>
                {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
              </form>
            </Panel>
          ) : <Notice kind="warn">Your role can see Coins but not give them.</Notice>}
          <Panel title="Given or taken back here">
            {!(d.adjustments || []).length ? <Empty>None yet.</Empty> : (
              <ul className="list-none m-0 p-0">{d.adjustments.map((a, i) => (
                <li key={i} className="px-4 py-2.5 border-b border-[#18231d]">
                  <div className="text-[13.5px] font-semibold"><Link to={path(`stores/${a.slug}`)} className="text-[#e7efe9] no-underline hover:underline">{a.slug}</Link> · <span className={a.coins < 0 ? 'text-red-300' : 'text-emerald-300'}>{a.coins > 0 ? '+' : ''}{num(a.coins)}</span> → {num(a.after)}</div>
                  <div className="text-[12.5px] text-[#8fa69a]">{a.note} · {whenLabel(a.at)}</div>
                </li>
              ))}</ul>
            )}
          </Panel>
        </div>
        <Panel title="Every shop's Coins" className="flex-[2_1_520px] min-w-0 overflow-hidden" right={<input aria-label="Search shops" className={`${input} h-9 w-48`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" />}>
          {!shops.length ? <Empty>No shops with Coins yet.</Empty> : (
            <div className="overflow-x-auto"><table className="w-full border-collapse text-[13.5px]">
              <thead><tr><th scope="col" className={th}>Shop</th><th scope="col" className={th}>Coins</th><th scope="col" className={th}>Worth</th><th scope="col" className={th}>Last change</th></tr></thead>
              <tbody>{shops.map((s) => (
                <tr key={s.slug}><td className={td}><Link to={path(`stores/${s.slug}`)} className="text-[#e7efe9] font-semibold no-underline hover:underline">{s.name}</Link></td>
                  <td className={`${td} font-bold ${s.coins < 100 ? 'text-amber-300' : ''}`}>{num(s.coins)}</td><td className={td}>{inr(s.coins / 2)}</td><td className={`${td} text-[#8fa69a]`}>{whenLabel(s.updated_at)}</td></tr>
              ))}</tbody>
            </table></div>
          )}
        </Panel>
      </div>
    </div>
  );
}

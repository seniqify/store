// Every store: status tabs, search, city, sort, export. Open one to change it.
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAdmin } from './adminContext.js';
import { adminStores, downloadCsv } from './adminService.js';
import {
  STORE_TABS, tabCounts, filterStores, citiesOf, stateOf, planLabel, paysBy, inr, num, dayLabel, toCsv, isPaid,
} from './adminLogic.js';
import { Icon, Chip, Spinner, Notice, Empty } from './ui.jsx';
import { btn, card, input, th, td } from './adminStyles.js';

const PAGE = 50;

export default function AdminStores() {
  const { path } = useAdmin();
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'all';
  const [q, setQ] = useState('');
  const [city, setCity] = useState('');
  const [sort, setSort] = useState('newest');
  const [shown, setShown] = useState(PAGE);

  useEffect(() => {
    let alive = true;
    adminStores().then((r) => alive && setRows(r)).catch((x) => alive && setErr(x.message));
    return () => { alive = false; };
  }, []);

  const counts = useMemo(() => tabCounts(rows), [rows]);
  const cities = useMemo(() => citiesOf(rows), [rows]);
  const list = useMemo(() => filterStores(rows, { tab, q, city, sort }), [rows, tab, q, city, sort]);

  const exportCsv = () => downloadCsv(`pocketlink-stores-${tab}.csv`, toCsv([
    ['Store', 'Link', 'Plan', 'Paid till', 'Pays by', 'Status', 'City', 'Type of business', 'Owner mobile', 'Orders 30 days', 'Sales 30 days', 'Coins', 'Made on'],
    ...list.map((r) => [r.name, `pocketlink.store/${r.slug}`, planLabel(r.plan), dayLabel(r.plan_expires_at), isPaid(r.plan) ? paysBy(r.pays_by) : '',
      stateOf(r.state).label, r.city || '', r.business_type || '', r.owner_phone || '', r.orders_30, r.sales_30, r.coins, dayLabel(r.created_at)]),
  ]));

  if (err) return <Notice>{err}</Notice>;
  if (!rows) return <Spinner />;
  return (
    <div className="space-y-4 max-w-[1400px]">
      <header className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[240px]">
          <h1 className="m-0 text-[26px] font-extrabold">Stores <span className="text-[18px] font-semibold text-[#8fa69a]">{counts.all}</span></h1>
          <p className="m-0 mt-1 text-[14px] text-[#8fa69a]">Every shop on PocketLink. Open one to change anything in it.</p>
        </div>
        <button type="button" className={btn.ghost} onClick={exportCsv}><Icon name="download" size={16} />Export to Excel</button>
      </header>

      <div role="group" aria-label="Status" className="flex flex-wrap gap-2">
        {STORE_TABS.map(([k, t]) => (
          <button key={k} type="button" aria-pressed={tab === k} onClick={() => { setParams(k === 'all' ? {} : { tab: k }, { replace: true }); setShown(PAGE); }}
            className={`h-9 px-3 rounded-full border text-[13px] font-semibold cursor-pointer ${tab === k ? 'bg-[#e7efe9] text-[#0a0f0c] border-[#e7efe9]' : 'bg-[#111a15] text-[#c8d6ce] border-[#2b3b32]'}`}>
            {t} <span className="opacity-70">{counts[k]}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <label className="flex items-center gap-2 h-10 px-3 border border-[#2b3b32] rounded-xl bg-[#111a15] flex-[1_1_260px] min-w-[200px]">
          <Icon name="search" size={15} className="text-[#8fa69a]" />
          <input aria-label="Search stores" placeholder="Name, link, city or mobile" value={q} onChange={(e) => { setQ(e.target.value); setShown(PAGE); }}
            className="flex-1 min-w-0 bg-transparent border-0 outline-none text-[#e7efe9] text-[13.5px]" />
        </label>
        <select aria-label="City" className={`${input} w-auto h-10`} value={city} onChange={(e) => setCity(e.target.value)}>
          <option value="">Any city</option>{cities.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select aria-label="Sort" className={`${input} w-auto h-10`} value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="newest">Newest first</option><option value="orders">Most orders</option><option value="ending">Ends soonest</option><option value="name">Name A to Z</option>
        </select>
      </div>

      <section aria-label="Stores" className={`${card} overflow-hidden`}>
        {!list.length ? <Empty>No stores here.</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13.5px]">
              <thead><tr>
                <th scope="col" className={th}>Store</th><th scope="col" className={th}>Plan</th><th scope="col" className={th}>Paid till</th><th scope="col" className={th}>Pays by</th>
                <th scope="col" className={th}>Orders · 30 days</th><th scope="col" className={th}>Sales · 30 days</th><th scope="col" className={th}>Coins</th><th scope="col" className={th}>City</th><th scope="col" className={th}>Status</th>
              </tr></thead>
              <tbody>
                {list.slice(0, shown).map((r) => {
                  const st = stateOf(r.state);
                  return (
                    <tr key={r.slug} className="hover:bg-[#16211b]">
                      <td className={td}>
                        <Link to={path(`stores/${r.slug}`)} className="flex items-center gap-2.5 no-underline text-[#e7efe9]">
                          <span aria-hidden="true" className="w-8 h-8 rounded-lg bg-[#1f2b24] grid place-items-center font-extrabold text-[12px] text-[#c8d6ce]">{String(r.name).slice(0, 2).toUpperCase()}</span>
                          <span><span className="block font-bold">{r.name}</span><span className="block text-[12px] text-[#8fa69a]">pocketlink.store/{r.slug}</span></span>
                        </Link>
                      </td>
                      <td className={td}>{planLabel(r.plan)}</td>
                      <td className={td}>{isPaid(r.plan) ? dayLabel(r.plan_expires_at) || 'No end date' : ''}</td>
                      <td className={td}>{isPaid(r.plan) ? paysBy(r.pays_by) : ''}</td>
                      <td className={td}>{num(r.orders_30)}</td>
                      <td className={td}>{inr(r.sales_30)}</td>
                      <td className={td}>{num(r.coins)}</td>
                      <td className={td}>{r.city || ''}</td>
                      <td className={td}><Chip tone={st.tone}>{st.label}</Chip></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2.5 px-4 py-3 text-[13px] text-[#8fa69a]">
          <span className="flex-1">Showing {Math.min(shown, list.length)} of {list.length}</span>
          {shown < list.length && <button type="button" className={btn.small} onClick={() => setShown(shown + PAGE)}>Show {Math.min(PAGE, list.length - shown)} more</button>}
        </div>
      </section>
    </div>
  );
}

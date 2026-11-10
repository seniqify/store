import { useState, useEffect, useCallback, useMemo } from 'react';
import { RefreshCw, Upload, Check, AlertTriangle, Loader2 } from 'lucide-react';
import { formatINR } from '../../utils/currency';
import { courierInfo } from '../../utils/deliveryStatus';
import { getCodRemittance, markCodRemitted } from '../../utils/deliveryTools';
import { readReportFile, matchRemittance } from '../../utils/remittanceReport';

/**
 * Delivery → COD money: the cash couriers collected for you and still owe.
 *
 * A courier-delivered cash-on-delivery order turns Paid by itself (the courier
 * collected it), but the money reaches the shop only when the courier pays out.
 * This lists those orders until the shop marks them received -- one by one, all
 * at once, or from the courier's remittance report (matched by AWB).
 */

const OVERDUE_DAYS = 10;
const daysSince = (iso, now) => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : Math.max(0, Math.floor((now - t) / 86400000));
};

export default function CodMoney({ slug, pin, themeColor = '#0d9488' }) {
  const [data, setData]   = useState(null);   // null = loading
  const [err, setErr]     = useState('');
  const [busy, setBusy]   = useState('');
  const [report, setReport] = useState(null); // { name, paid[], missing[] }
  const [now, setNow]     = useState(0);

  const load = useCallback(async () => {
    setErr('');
    try { setData(await getCodRemittance(slug, pin)); setNow(Date.now()); }
    catch (e) { setErr(e.message); setData((d) => d || { owed: [], received_month: 0, received_month_count: 0 }); }
  }, [slug, pin]);
  useEffect(() => { load(); }, [load]);

  const owed = useMemo(() => (data?.owed || []).map((r) => ({ ...r, days: daysSince(r.delivered_at, now) })), [data, now]);
  const sum = (rows) => rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const overdue = owed.filter((r) => r.days > OVERDUE_DAYS);
  const byCourier = ['delhivery', 'shadowfax']
    .map((c) => ({ c, rows: owed.filter((r) => r.courier === c) }))
    .filter((x) => x.rows.length > 0);

  async function mark(ids, label) {
    if (!ids.length) return;
    setBusy(label); setErr('');
    try { await markCodRemitted(slug, pin, ids, true); setReport(null); await load(); }
    catch (e) { setErr(e.message); }
    finally { setBusy(''); }
  }

  async function onFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setErr(''); setBusy('report');
    try {
      const text = await readReportFile(file);
      setReport({ name: file.name, ...matchRemittance(owed, text) });
    } catch (x) {
      setErr(x.message || 'Could not read that file.');
    } finally {
      setBusy('');
    }
  }

  if (!data) {
    return <div className="py-10 grid place-items-center text-gray-400"><Loader2 className="animate-spin" size={22} /></div>;
  }

  const tile = (label, value, sub, tone) => (
    <div className={`rounded-2xl border p-3.5 ${tone === 'red' ? 'bg-rose-50 border-rose-200' : 'bg-white border-gray-100 shadow-sm'}`}>
      <p className={`text-[11.5px] font-semibold ${tone === 'red' ? 'text-rose-800' : 'text-gray-500'}`}>{label}</p>
      <p className={`text-xl font-extrabold tabular-nums mt-0.5 ${tone === 'red' ? 'text-rose-800' : tone === 'green' ? 'text-emerald-700' : 'text-gray-900'}`}>{value}</p>
      <p className={`text-[11px] mt-0.5 ${tone === 'red' ? 'text-rose-700' : 'text-gray-500'}`}>{sub}</p>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-extrabold text-gray-900">COD money</h2>
          <p className="text-xs text-gray-500 mt-0.5">Cash your couriers collected and still have to pay you</p>
        </div>
        <button type="button" onClick={load} aria-label="Refresh"
          className="w-11 h-11 grid place-items-center rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50">
          <RefreshCw size={16} />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        {tile('Couriers owe you', formatINR(sum(owed)), `${owed.length} delivered, not paid yet`)}
        {tile(`Overdue (${OVERDUE_DAYS}+ days)`, formatINR(sum(overdue)), overdue.length ? `${overdue.length} orders · ask the courier` : 'Nothing overdue', overdue.length ? 'red' : '')}
        <div className="col-span-2">
          {tile('Received this month', formatINR(Number(data.received_month) || 0), `${data.received_month_count || 0} orders marked received`, 'green')}
        </div>
      </div>

      {err && <p className="text-[12px] text-rose-700 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2">{err}</p>}

      {/* Remittance report */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
        <div>
          <p className="text-sm font-extrabold text-gray-900">Check a payout report</p>
          <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
            In your Delhivery or Shadowfax panel, download the COD remittance report (CSV or Excel) and add it here.
            PocketLink finds every order in it by AWB.
          </p>
        </div>
        <label className={`w-full h-12 rounded-xl border-2 border-dashed flex items-center justify-center gap-2 text-[13.5px] font-bold cursor-pointer ${owed.length ? 'hover:bg-gray-50' : 'opacity-50 pointer-events-none'}`}
               style={{ borderColor: `${themeColor}66`, color: themeColor }}>
          {busy === 'report' ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
          Add the report file
          <input type="file" accept=".csv,.xlsx,.txt,text/csv" onChange={onFile} className="sr-only" disabled={!owed.length} />
        </label>
        {report && (
          <div className="rounded-xl border border-gray-100 bg-gray-50/70 p-3 space-y-1.5">
            <p className="text-[12.5px] font-bold text-gray-900 truncate">{report.name}</p>
            <p className="text-[12.5px] text-emerald-800">
              <Check size={13} className="inline -mt-0.5" /> {report.paid.length} order{report.paid.length === 1 ? '' : 's'} found · {formatINR(sum(report.paid))}
            </p>
            {report.missing.filter((r) => r.days > 2).slice(0, 5).map((r) => (
              <p key={r.id} className="text-[12px] text-rose-800">
                Not in this report: {r.name || 'Customer'} · {formatINR(Number(r.amount) || 0)} · delivered {r.days} days ago
              </p>
            ))}
            {report.paid.length > 0 && (
              <button type="button" disabled={!!busy} onClick={() => mark(report.paid.map((r) => r.id), 'report-mark')}
                className="w-full h-11 rounded-xl text-white text-[13.5px] font-bold disabled:opacity-50" style={{ background: themeColor }}>
                {busy === 'report-mark' ? 'Saving…' : `Mark ${report.paid.length} as received`}
              </button>
            )}
            {report.paid.length === 0 && <p className="text-[12px] text-gray-600">None of the orders still owed are in this file. Is it the COD remittance report?</p>}
          </div>
        )}
      </div>

      {/* Who owes what */}
      {owed.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50/50 p-8 text-center">
          <p className="font-bold text-gray-800">Nothing owed right now</p>
          <p className="text-sm text-gray-500 mt-1">Cash-on-delivery orders your couriers deliver show up here until you mark the payout received.</p>
        </div>
      ) : byCourier.map(({ c, rows }) => (
        <div key={c} className="bg-white rounded-2xl border border-gray-100 shadow-sm">
          <div className="flex items-center justify-between gap-2 px-4 pt-3.5 pb-2">
            <div>
              <p className="text-sm font-extrabold text-gray-900">{courierInfo(c).name} owes you {formatINR(sum(rows))}</p>
              <p className="text-[11.5px] text-gray-500">{rows.length} order{rows.length === 1 ? '' : 's'} · oldest {Math.max(...rows.map((r) => r.days))} days</p>
            </div>
            <button type="button" disabled={!!busy}
              onClick={() => { if (window.confirm(`Mark all ${rows.length} ${courierInfo(c).name} orders (${formatINR(sum(rows))}) as received?`)) mark(rows.map((r) => r.id), `all-${c}`); }}
              className="h-9 px-3 rounded-lg border border-gray-200 text-[12px] font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50 flex-shrink-0">
              {busy === `all-${c}` ? 'Saving…' : 'All received'}
            </button>
          </div>
          {rows.map((r) => (
            <div key={r.id} className="flex items-center gap-3 px-4 py-2.5 border-t border-gray-50">
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-bold text-gray-900 truncate">{r.name || 'Customer'}</p>
                <p className={`text-[11.5px] ${r.days > OVERDUE_DAYS ? 'text-rose-700 font-semibold' : 'text-gray-500'}`}>
                  {r.days > OVERDUE_DAYS && <AlertTriangle size={11} className="inline -mt-0.5 mr-0.5" />}
                  Delivered {r.days === 0 ? 'today' : `${r.days} day${r.days === 1 ? '' : 's'} ago`} · AWB {r.awb}
                </p>
              </div>
              <span className="text-[13.5px] font-extrabold tabular-nums text-gray-900">{formatINR(Number(r.amount) || 0)}</span>
              <button type="button" disabled={!!busy} onClick={() => mark([r.id], r.id)} aria-label={`Mark ${r.name || 'order'} received`}
                className="h-9 px-2.5 rounded-lg border border-gray-200 text-[11.5px] font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                {busy === r.id ? '…' : 'Received'}
              </button>
            </div>
          ))}
        </div>
      ))}
      <p className="text-[11px] text-gray-500 px-1 leading-relaxed">
        Delhivery and Shadowfax don’t share their COD payouts with PocketLink, so you confirm them here. Orders delivered more than 45 days ago are not listed.
      </p>
    </div>
  );
}

// Manager and Ads & leads: where leads come from by themselves. Connect cards
// (website form, Google Ads lead forms, Facebook / Instagram lead ads,
// WhatsApp; manager only, they hold the keys), a live feed with how fast each
// lead was called, and this month's report per campaign: leads -> checked real
// / junk -> called -> demo -> paid, with ad spend for the cost per paid shop.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCrm } from './crmContext.js';
import { leadFeed, listLeads, saveSetting, LEAD_IN_URL } from './crmService.js';
import { istDate, istInstant, istTime, shortDay, sourceLabel, AD_SOURCES, stageOf } from './crmLogic.js';
import { Icon, Spinner, Notice, Empty, Field } from './ui.jsx';
import { btn, card, input } from './crmStyles.js';

const OUTCOME = {
  new: ['New lead', 'bg-green-100 text-green-800'], again: ['Came again', 'bg-blue-100 text-blue-800'],
  test: ['Test received', 'bg-gray-100 text-gray-700'], bad_phone: ['Wrong number', 'bg-red-100 text-red-800'],
  rate_limited: ['Too many from one address', 'bg-red-100 text-red-800'], fetch_failed: ['Could not be read', 'bg-amber-100 text-amber-900'],
};
const inr = (n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;
const randomKey = () => [...crypto.getRandomValues(new Uint8Array(18))].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 24);

function Copy({ text, label = 'Copy' }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className={btn.small} onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* old browser */ } }}>
      <Icon name={done ? 'check' : 'copy'} size={14} />{done ? 'Copied' : label}
    </button>
  );
}

function Speed({ e, now }) {
  if (!e.lead_id || !['new', 'again'].includes(e.outcome)) return null;
  const from = Date.parse(e.created_at);
  if (e.first_touch_at) {
    const m = Math.max(0, Math.round((Date.parse(e.first_touch_at) - from) / 60000));
    return <span className={`text-[12.5px] font-bold ${m <= 5 ? 'text-green-700' : m <= 30 ? 'text-amber-700' : 'text-red-700'}`}>Called in {m < 60 ? `${m} min` : `${Math.round(m / 60)} h`}</span>;
  }
  const waiting = Math.max(0, Math.round((now - from) / 60000));
  return <span className={`text-[12.5px] font-bold ${waiting <= 5 ? 'text-gray-600' : 'text-red-700'}`}>Not called yet · {waiting < 60 ? `${waiting} min` : `${Math.round(waiting / 60)} h`}</span>;
}

function Step({ n, children }) {
  return <li className="flex gap-2.5"><span className="w-5 h-5 shrink-0 rounded-full bg-gray-900 text-white grid place-items-center text-[11px] font-extrabold mt-0.5">{n}</span><span className="text-[13.5px] text-gray-800">{children}</span></li>;
}

export default function CrmSources() {
  const { me, settings, refreshSettings, nameOf, path } = useCrm();
  const isAds = me.role === 'ads';
  const today = istDate();
  const monthKey = today.slice(0, 7);
  const monthStart = `${monthKey}-01`;
  const [feed, setFeed] = useState(null);
  const [leads, setLeads] = useState([]);
  const [loadedAt, setLoadedAt] = useState(0);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState(null);
  const [spendEdit, setSpendEdit] = useState(null);
  const cfg = settings?.lead_sources || {};
  const spend = settings?.ad_spend?.[monthKey] || {};

  const load = useCallback(async () => {
    try {
      const [f, ls] = await Promise.all([leadFeed(new Date(istInstant(monthStart) - 31 * 86400000).toISOString()), listLeads()]);
      setFeed(f); setLeads(ls); setLoadedAt(Date.now());
    } catch (e) { setErr(e.message); setFeed([]); }
  }, [monthStart]);
  useEffect(() => { load(); const id = setInterval(load, 60000); return () => clearInterval(id); }, [load]);

  const save = async (patch, text) => {
    setMsg(null);
    try { await saveSetting('lead_sources', { ...cfg, ...patch }); await refreshSettings(); if (text) setMsg({ kind: 'ok', text }); }
    catch (e) { setMsg({ kind: 'error', text: e.message }); }
  };

  const monthLeads = useMemo(() => leads.filter((l) => AD_SOURCES.includes(l.source) && l.created_at >= new Date(istInstant(monthStart)).toISOString()), [leads, monthStart]);
  const report = useMemo(() => {
    const m = new Map();
    for (const l of monthLeads) {
      const k = `${l.source}|${l.source_detail || ''}`;
      if (!m.has(k)) m.set(k, { source: l.source, detail: l.source_detail || '', leads: 0, real: 0, junk: 0, called: 0, demo: 0, paid: 0, money: 0 });
      const r = m.get(k);
      r.leads++;
      if (l.verify_status === 'verified') r.real++;
      else if (l.verify_status) r.junk++;
      if (l.last_activity_at) r.called++;
      if (['demo', 'interested', 'won'].includes(l.stage)) r.demo++;
      if (l.stage === 'won' && l.won_proof) { r.paid++; r.money += Number(l.won_amount) || 0; }
    }
    return [...m.values()].sort((a, b) => b.leads - a.leads);
  }, [monthLeads]);
  const bySource = useMemo(() => {
    const o = {};
    for (const r of report) { o[r.source] ||= { leads: 0, paid: 0 }; o[r.source].leads += r.leads; o[r.source].paid += r.paid; }
    return o;
  }, [report]);
  const lastOf = (src, outcome) => (feed || []).find((e) => (src === 'facebook' ? ['facebook', 'instagram'].includes(e.source) : e.source === src) && (!outcome || e.outcome === outcome));

  if (!feed) return <Spinner />;
  const googleUrl = `${LEAD_IN_URL}?src=google`;
  const metaUrl = `${LEAD_IN_URL}?src=meta`;
  const failed = feed.filter((e) => e.outcome === 'fetch_failed');
  const lastGoogle = lastOf('google'), lastWeb = lastOf('website'), lastMeta = lastOf('facebook');

  const saveSpend = async () => {
    const clean = Object.fromEntries(Object.entries(spendEdit).map(([k, v]) => [k, Math.max(0, Math.round(Number(v) || 0))]).filter(([, v]) => v > 0));
    try {
      await saveSetting('ad_spend', { ...(settings?.ad_spend || {}), [monthKey]: clean });
      await refreshSettings(); setSpendEdit(null);
    } catch (e) { setErr(e.message); }
  };

  return (
    <div className="px-4 lg:px-7 py-5 space-y-4">
      <header><h1 className="text-2xl font-extrabold">Lead sources</h1>
        <p className="text-sm text-gray-500">{isAds
          ? 'Leads from ads and the website come in by themselves and go straight to a caller. Check each one within 30 minutes in Check leads. Enter what each source spent so the cost per paid shop is right.'
          : 'Leads from ads and the website come in by themselves, are given out by your auto-assign rules, and should be called within 5 minutes. Night leads wait for 9:30 am.'}</p></header>
      {err && <Notice>{err}</Notice>}
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}

      {isAds && (
        <section className={`${card} p-4 flex flex-wrap items-center gap-3`} aria-label="Sources">
          <p className="flex-1 min-w-[220px] text-[13.5px] text-gray-700">Website form, Google Ads lead forms, Facebook &amp; Instagram lead ads. Your manager connects them. Facebook leads not connected yet: download them from Meta’s <b>Leads Center</b> and import them.</p>
          <Link to={path('add?tab=import')} className={btn.ghost}><Icon name="upload" size={16} />Import a list</Link>
        </section>
      )}
      {!isAds && <div className="grid lg:grid-cols-2 gap-4">
        <section className={`${card} p-4 space-y-3`} aria-label="Website">
          <div className="flex items-center gap-3">
            <div className="flex-1"><h2 className="font-extrabold">Website · “Call me back” form</h2>
              <p className="text-[13px] text-gray-500">On pocketlink.store/sell, under the FAQ. At most 5 a hour from one address.</p></div>
            <span className={`text-[12px] font-bold rounded-full px-2.5 py-0.5 ${cfg.web_off ? 'bg-gray-100 text-gray-700' : 'bg-green-100 text-green-800'}`}>{cfg.web_off ? 'Off' : 'On'}</span>
          </div>
          <p className="text-[13px] text-gray-700">{bySource.website?.leads || 0} this month{lastWeb ? ` · last ${shortDay(istDate(Date.parse(lastWeb.created_at)))} ${istTime(lastWeb.created_at)}` : ''}</p>
          <div className="flex flex-wrap gap-2">
            <a className={btn.small} href="https://www.pocketlink.store/sell" target="_blank" rel="noreferrer">See the form</a>
            <button type="button" className={btn.small} onClick={() => save({ web_off: !cfg.web_off }, cfg.web_off ? 'The form takes requests again.' : 'The form is off; it says so on the site.')}>{cfg.web_off ? 'Turn on' : 'Turn off'}</button>
          </div>
        </section>

        <section className={`${card} p-4 space-y-3`} aria-label="Google Ads">
          <div className="flex items-center gap-3">
            <div className="flex-1"><h2 className="font-extrabold">Google Ads · lead forms</h2>
              <p className="text-[13px] text-gray-500">Every lead form answer comes here straight away.</p></div>
            <span className={`text-[12px] font-bold rounded-full px-2.5 py-0.5 ${lastGoogle ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'}`}>{lastGoogle ? (lastGoogle.outcome === 'test' && !bySource.google ? 'Test received' : 'Working') : 'Not set up'}</span>
          </div>
          {!cfg.google_key ? (
            <button type="button" className={btn.primary} onClick={() => save({ google_key: randomKey() }, 'Key made. Now paste the URL and the key in Google Ads.')}>Make the key</button>
          ) : (
            <>
              <div className="space-y-1.5 text-[13px]">
                <div className="flex flex-wrap items-center gap-2"><span className="font-bold w-24">Webhook URL</span><code className="bg-gray-50 border border-gray-200 rounded px-2 py-1 break-all flex-1 min-w-0">{googleUrl}</code><Copy text={googleUrl} /></div>
                <div className="flex flex-wrap items-center gap-2"><span className="font-bold w-24">Key</span><code className="bg-gray-50 border border-gray-200 rounded px-2 py-1">{cfg.google_key}</code><Copy text={cfg.google_key} /></div>
              </div>
              <ol className="space-y-1.5">
                <Step n="1">In Google Ads, open the campaign’s <b>Lead form</b> asset → <b>Lead delivery</b> → <b>Webhook integration</b>.</Step>
                <Step n="2">Paste the URL and the key, then press <b>Send test data</b>. “Test received” shows here within a minute.</Step>
              </ol>
              <p className="text-[12.5px] text-gray-500">{bySource.google?.leads || 0} this month{lastGoogle ? ` · last ${shortDay(istDate(Date.parse(lastGoogle.created_at)))} ${istTime(lastGoogle.created_at)}` : ''}</p>
            </>
          )}
        </section>

        <section className={`${card} p-4 space-y-3`} aria-label="Facebook and Instagram">
          <div className="flex items-center gap-3">
            <div className="flex-1"><h2 className="font-extrabold">Facebook &amp; Instagram · lead ads</h2>
              <p className="text-[13px] text-gray-500">Instant forms on PocketLink’s own Page.</p></div>
            <span className={`text-[12px] font-bold rounded-full px-2.5 py-0.5 ${cfg.meta_page_name ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'}`}>{cfg.meta_page_name ? `Connected · ${cfg.meta_page_name}` : 'Not connected yet'}</span>
          </div>
          {!cfg.meta_page_name && (
            <>
              <p className="text-[13.5px] text-gray-800">Connecting needs PocketLink’s Facebook Page and the Meta app to be approved for lead access. Until then:</p>
              <ol className="space-y-1.5">
                <Step n="1">In Meta Business Suite → <b>Leads Center</b>, download the leads as CSV.</Step>
                <Step n="2">In <Link to={path('add?tab=import')} className="font-bold">Import a list</Link>, choose the file and pick <b>Facebook ad</b> (or Instagram ad) as where they came from.</Step>
              </ol>
            </>
          )}
          {cfg.meta_verify && (
            <div className="space-y-1.5 text-[13px]">
              <div className="flex flex-wrap items-center gap-2"><span className="font-bold w-24">Callback URL</span><code className="bg-gray-50 border border-gray-200 rounded px-2 py-1 break-all flex-1 min-w-0">{metaUrl}</code><Copy text={metaUrl} /></div>
              <div className="flex flex-wrap items-center gap-2"><span className="font-bold w-24">Verify token</span><code className="bg-gray-50 border border-gray-200 rounded px-2 py-1">{cfg.meta_verify}</code><Copy text={cfg.meta_verify} /></div>
            </div>
          )}
          {!cfg.meta_verify && <button type="button" className={btn.small} onClick={() => save({ meta_verify: randomKey() })}>Make the Meta callback details</button>}
          {failed.length > 0 && <Notice kind="warn">{failed.length} Facebook lead{failed.length === 1 ? '' : 's'} could not be read from Facebook. Download them from Leads Center and import them.</Notice>}
          {lastMeta && <p className="text-[12.5px] text-gray-500">{(bySource.facebook?.leads || 0) + (bySource.instagram?.leads || 0)} this month · last {shortDay(istDate(Date.parse(lastMeta.created_at)))} {istTime(lastMeta.created_at)}</p>}
        </section>

        <section className={`${card} p-4 space-y-2`} aria-label="WhatsApp">
          <h2 className="font-extrabold">WhatsApp · click-to-WhatsApp ads</h2>
          <p className="text-[13.5px] text-gray-800">Needs the messages sent to PocketLink’s WhatsApp number to come to the CRM (a webhook on PocketLink’s WhatsApp Business account). Not set up yet.</p>
          <p className="text-[12.5px] text-gray-500">Meanwhile, add people who message you with <Link to={path('add')} className="font-bold">Add a lead</Link> and pick “WhatsApp ad”.</p>
        </section>
      </div>}

      <section aria-label="Live feed" className={`${card} overflow-hidden`}>
        <h2 className="px-4 pt-3 pb-1 font-extrabold">Coming in</h2>
        <p className="px-4 pb-2 text-[12.5px] text-gray-500">Updates every minute. Green = called within 5 minutes.</p>
        {!feed.length ? <Empty>Nothing has come in yet. Set up a source above.</Empty> : (
          <ul className="divide-y divide-gray-100">
            {feed.slice(0, 40).map((e) => {
              const [label, cls] = OUTCOME[e.outcome] || [e.outcome, 'bg-gray-100'];
              return (
                <li key={e.id} className="px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="w-28 text-[12.5px] text-gray-500">{shortDay(istDate(Date.parse(e.created_at)))} {istTime(e.created_at)}</span>
                  <span className="text-[12px] font-bold rounded-full px-2 py-0.5 bg-gray-100 text-gray-800">{sourceLabel(e.source)}</span>
                  <span className="flex-1 min-w-[160px]">
                    {e.lead_id ? <Link to={path(`leads/${e.lead_id}`)} className="font-bold text-gray-900">{e.shop_name || e.name || 'Lead'}</Link> : <span className="font-bold">{e.name || '—'}</span>}
                    {e.campaign && <span className="text-[12.5px] text-gray-500"> · {e.campaign}</span>}
                  </span>
                  <span className={`text-[12px] font-bold rounded-full px-2 py-0.5 ${cls}`}>{label}</span>
                  {e.assigned_to && <span className="text-[12.5px] text-gray-600">{nameOf(e.assigned_to) || 'someone'}</span>}
                  {e.stage && e.lead_id && <span className="text-[12px] text-gray-500">{stageOf(e.stage).label}</span>}
                  <Speed e={e} now={loadedAt} />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-label="This month" className={`${card} overflow-hidden`}>
        <div className="flex flex-wrap items-center gap-2 px-4 pt-3 pb-2">
          <h2 className="font-extrabold flex-1">This month by campaign</h2>
          {!spendEdit && <button type="button" className={btn.small} onClick={() => setSpendEdit(Object.fromEntries(AD_SOURCES.map((s) => [s, spend[s] ? String(spend[s]) : ''])))}>Enter ad spend</button>}
        </div>
        {spendEdit && (
          <div className="px-4 pb-3 space-y-2">
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {AD_SOURCES.filter((s) => s !== 'website').map((s) => (
                <Field key={s} label={`${sourceLabel(s)} (₹)`} htmlFor={`sp-${s}`}><input id={`sp-${s}`} type="number" min="0" className={input} value={spendEdit[s]} onChange={(e) => setSpendEdit({ ...spendEdit, [s]: e.target.value })} /></Field>
              ))}
            </div>
            <div className="flex gap-2"><button type="button" className={btn.smallGreen} onClick={saveSpend}>Save spend</button><button type="button" className={btn.small} onClick={() => setSpendEdit(null)}>Cancel</button></div>
          </div>
        )}
        {!report.length ? <Empty>No ad or website leads this month yet.</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[860px]">
              <thead><tr className="text-left text-[12px] uppercase tracking-wide text-gray-500">
                <th className="px-4 py-2 font-bold">Source · campaign</th><th className="px-2 py-2 font-bold">Leads</th><th className="px-2 py-2 font-bold">Checked real</th><th className="px-2 py-2 font-bold">Junk</th><th className="px-2 py-2 font-bold">Called</th>
                <th className="px-2 py-2 font-bold">Demo or better</th><th className="px-2 py-2 font-bold">Paid</th><th className="px-2 py-2 font-bold">Collected</th><th className="px-4 py-2 font-bold">Cost per paid shop</th>
              </tr></thead>
              <tbody>
                {report.map((r, i) => {
                  const firstOfSource = report.findIndex((x) => x.source === r.source) === i;
                  const srcSpend = Number(spend[r.source]) || 0;
                  const srcPaid = bySource[r.source]?.paid || 0;
                  return (
                    <tr key={`${r.source}|${r.detail}`} className="border-t border-gray-100">
                      <td className="px-4 py-2.5"><div className="font-bold">{sourceLabel(r.source)}</div><div className="text-[12.5px] text-gray-500">{r.detail || '—'}</div></td>
                      <td className="px-2 py-2.5 font-bold">{r.leads}</td>
                      <td className="px-2 py-2.5">{r.real}</td>
                      <td className={`px-2 py-2.5 ${r.junk && r.junk * 3 >= r.leads ? 'font-bold text-red-700' : ''}`}>{r.junk}</td>
                      <td className="px-2 py-2.5">{r.called}</td>
                      <td className="px-2 py-2.5">{r.demo}</td>
                      <td className="px-2 py-2.5 font-bold">{r.paid}</td>
                      <td className="px-2 py-2.5">{inr(r.money)}</td>
                      <td className="px-4 py-2.5 text-[13px] text-gray-700">{!firstOfSource ? '' : srcSpend ? (srcPaid ? `${inr(srcSpend / srcPaid)} (${sourceLabel(r.source)})` : `${inr(srcSpend)} spent, none paid yet`) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="px-4 py-2 text-[12px] text-gray-500 border-t border-gray-100">“Checked real” and “Junk” come from Check leads (junk = spam, wrong number, duplicate, not a business; red when it is a third or more). “Paid” counts only shops whose payment PocketLink has seen, or approved wins. Spend is per source for {monthKey}.</p>
      </section>
    </div>
  );
}

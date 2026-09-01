import { useState, useEffect } from 'react';
import { Megaphone, RefreshCw, AlertCircle, TrendingUp, Plus } from 'lucide-react';
import { fetchAdsPerformance } from '../../utils/metaAds';
import BoostPanel from './BoostPanel';

/**
 * Manage → Ads (Stage 2a): read-only Meta ad performance for a connected store.
 * All numbers come from the PIN-gated /api/meta/ads endpoint (server reads the
 * token; only aggregates arrive here). No spending, no changes.
 */

const fmtInt = (n) => Number(n || 0).toLocaleString('en-IN');

function money(n, cur = 'INR') {
  const v = Number(n || 0);
  const s = v.toLocaleString('en-IN', { maximumFractionDigits: v >= 100 ? 0 : 2 });
  return cur === 'INR' ? `₹${s}` : `${s} ${cur}`;
}

function Tile({ label, value, sub }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-3">
      <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">{label}</p>
      <p className="text-lg font-extrabold text-gray-900 mt-0.5 leading-tight tabular-nums">{value}</p>
      {sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function StatusChip({ status }) {
  const active = status === 'ACTIVE';
  return (
    <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${
      active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
      {active ? 'Active' : (status || '').toLowerCase() || 'paused'}
    </span>
  );
}

const OBJECTIVE_LABEL = {
  OUTCOME_SALES: 'Sales', OUTCOME_TRAFFIC: 'Traffic', OUTCOME_ENGAGEMENT: 'Engagement',
  OUTCOME_LEADS: 'Leads', OUTCOME_AWARENESS: 'Awareness', OUTCOME_APP_PROMOTION: 'App',
};
const objLabel = (o) => OBJECTIVE_LABEL[o] || (o ? o.replace(/^OUTCOME_/, '').toLowerCase() : '');

// 2E-2 measurement — one PocketLink campaign: funnel + Meta-vs-truth reconciliation.
function MeasuredCard({ mc, cur, themeColor }) {
  const [open, setOpen] = useState(false);
  const s = mc.snapshot || {};
  const d = mc.derived || {};
  const x = (n) => (n == null ? '—' : `${Number(n).toFixed(2)}×`);
  const funnel = [
    ['Spend', money(mc.meta.spend, cur)], ['Reach', fmtInt(mc.meta.reach)], ['Clicks', fmtInt(mc.meta.clicks)],
    ['Visits', fmtInt(mc.meta.lpv)], ['Add-to-cart', fmtInt(mc.meta.atc)], ['Checkout', fmtInt(mc.meta.checkout)],
  ];
  const recon = [
    ['Purchases / Orders', fmtInt(mc.meta.purchases), fmtInt(mc.pl.orders)],
    ['Revenue', money(mc.meta.revenue, cur), money(mc.pl.revenue, cur)],
    ['Cost / order', d.cppMeta != null ? money(d.cppMeta, cur) : '—', d.cppPl != null ? money(d.cppPl, cur) : '—'],
    ['ROAS', x(d.roasMeta), x(d.roasPl)],
  ];
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-3.5">
      <div className="flex items-center gap-2">
        <p className="text-sm font-bold text-gray-900 truncate flex-1">{mc.name || 'Campaign'}</p>
        <span className="text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full" style={{ background: `${themeColor}14`, color: themeColor }}>
          {mc.strategySource === 'pocketlink_reco' ? 'PocketLink' : (mc.strategySource || 'manual')}
        </span>
        <StatusChip status={mc.status === 'active' ? 'ACTIVE' : mc.status} />
      </div>

      <div className="grid grid-cols-3 gap-2 text-center mt-2.5">
        {funnel.map(([k, v]) => (
          <div key={k}><p className="text-[9px] text-gray-400 uppercase tracking-wide">{k}</p><p className="text-sm font-bold text-gray-900 tabular-nums">{v}</p></div>
        ))}
      </div>

      <div className="mt-3 rounded-lg border border-gray-100 overflow-hidden text-xs">
        <div className="grid grid-cols-3 bg-gray-50 font-semibold text-gray-500">
          <span className="px-2.5 py-1.5"> </span><span className="px-2.5 py-1.5 text-center">Meta</span><span className="px-2.5 py-1.5 text-center">PocketLink</span>
        </div>
        {recon.map(([k, a, b]) => (
          <div key={k} className="grid grid-cols-3 border-t border-gray-100">
            <span className="px-2.5 py-1.5 text-gray-500">{k}</span>
            <span className="px-2.5 py-1.5 text-center font-bold text-gray-900 tabular-nums">{a}</span>
            <span className="px-2.5 py-1.5 text-center font-bold text-gray-900 tabular-nums">{b}</span>
          </div>
        ))}
      </div>
      {mc.pl.deliveredOrders > 0 && (
        <p className="text-[10px] text-gray-400 mt-1">Delivered: {fmtInt(mc.pl.deliveredOrders)} orders · {money(mc.pl.deliveredRevenue, cur)}</p>
      )}

      <button type="button" onClick={() => setOpen((v) => !v)} className="mt-2 text-[11px] font-semibold text-gray-400 hover:text-gray-600">
        {open ? 'Hide' : 'Show'} what PocketLink recommended
      </button>
      {open && (
        <div className="mt-1.5 text-[11px] text-gray-500 space-y-0.5">
          {s.goal?.title && <p><b>Goal:</b> {s.goal.title}</p>}
          {s.product && <p><b>Promoting:</b> {s.product}</p>}
          {s.audienceStrategy && <p><b>Audience:</b> {s.audienceStrategy === 'auto' ? 'PocketLink finds buyers (Advantage+)' : 'Manual'}{s.location?.label ? ` · ${s.location.label}` : ''}</p>}
          {s.budget && <p><b>Budget:</b> {money(s.budget.daily, cur)}/day · {s.budget.days} days</p>}
          {s.reason && <p className="text-gray-400 italic">{s.reason}</p>}
          {mc.experimentId && <p className="text-gray-300">exp {String(mc.experimentId).slice(0, 8)} · {mc.strategySource}</p>}
        </div>
      )}
    </div>
  );
}

export default function AdsTab({ config, pin, themeColor = '#0d9488' }) {
  const [range, setRange] = useState('7d');
  const [showBoost, setShowBoost] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState({ loading: true, data: null, error: '' });

  // Fetch on mount, on range change, and on manual refresh. The effect's only
  // setState is AFTER the await (loading:true is set by the handlers below), so
  // it never sets state synchronously inside the effect body.
  useEffect(() => {
    let alive = true;
    (async () => {
      let d;
      try { d = await fetchAdsPerformance(config.slug, pin, range); }
      catch { d = { error: 'server' }; }
      if (!alive) return;
      setState(d?.error ? { loading: false, data: null, error: d.error } : { loading: false, data: d, error: '' });
    })();
    return () => { alive = false; };
  }, [config.slug, pin, range, reloadKey]);

  const refresh   = () => { setState((s) => ({ ...s, loading: true })); setReloadKey((k) => k + 1); };
  const pickRange = (r) => { if (r === range) return; setState((s) => ({ ...s, loading: true })); setRange(r); };

  const { loading, data, error } = state;

  if (showBoost) return <BoostPanel config={config} pin={pin} themeColor={themeColor} onClose={() => setShowBoost(false)} />;
  const cur = data?.currency || 'INR';
  const t = data?.totals;

  const RangeToggle = (
    <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden text-xs font-bold">
      {['7d', '30d'].map((r) => (
        <button key={r} type="button" onClick={() => pickRange(r)}
          className={`px-3 py-1.5 transition ${range === r ? 'text-white' : 'text-gray-500 bg-white hover:bg-gray-50'}`}
          style={range === r ? { background: themeColor } : undefined}>
          {r === '7d' ? '7 days' : '30 days'}
        </button>
      ))}
    </div>
  );

  return (
    <div className="animate-pl-fade-up space-y-4">
      {/* Header */}
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-extrabold text-gray-900 flex items-center gap-2">
            <Megaphone size={18} style={{ color: themeColor }} /> Ad performance
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">
            {data?.accountName ? `${data.accountName} · ` : ''}Live from Meta · read-only
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setShowBoost(true)}
            className="inline-flex items-center gap-1 text-xs font-bold text-white px-3 py-1.5 rounded-lg active:scale-95 transition"
            style={{ background: themeColor }}>
            <Plus size={14} /> Create campaign
          </button>
          {RangeToggle}
          <button type="button" onClick={refresh} disabled={loading} aria-label="Refresh"
            className="w-8 h-8 rounded-lg border border-gray-200 flex items-center justify-center text-gray-500 hover:bg-gray-50 disabled:opacity-50">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-16 text-gray-400 text-sm gap-2">
          <RefreshCw size={16} className="animate-spin" /> Loading ad performance…
        </div>
      )}

      {/* Errors */}
      {!loading && error === 'reauth' && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
          <AlertCircle size={18} className="text-amber-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-amber-800">Your Meta connection expired</p>
            <p className="text-xs text-amber-700/80 mt-1">Reconnect in <b>Settings → Connect Meta</b> to see your ad performance again.</p>
          </div>
        </div>
      )}
      {!loading && (error === 'not_connected' || error === 'no_ad_account') && (
        <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 flex items-start gap-3">
          <AlertCircle size={18} className="text-gray-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-gray-700">
              {error === 'no_ad_account' ? 'No ad account connected' : 'Meta isn’t connected'}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              Go to <b>Settings → Connect Meta</b> and make sure you share an <b>ad account</b> during sign-in.
            </p>
          </div>
        </div>
      )}
      {!loading && error && !['reauth', 'not_connected', 'no_ad_account'].includes(error) && (
        <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 flex items-center justify-between gap-3">
          <p className="text-sm text-gray-600">Couldn’t load ad performance right now.</p>
          <button type="button" onClick={refresh} className="text-xs font-bold text-white px-3 py-1.5 rounded-lg" style={{ background: themeColor }}>Try again</button>
        </div>
      )}

      {/* Data */}
      {!loading && !error && data && (
        <>
          {/* Summary tiles */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            <Tile label="Spend" value={money(t.spend, cur)} sub={range === '7d' ? 'last 7 days' : 'last 30 days'} />
            <Tile label="Reach" value={fmtInt(t.reach)} sub="people" />
            <Tile label={t.resultLabel || 'Results'} value={fmtInt(t.results)} sub={t.results > 0 && t.costPerResult != null ? `${money(t.costPerResult, cur)} each` : '—'} />
            <Tile label="Link clicks" value={fmtInt(t.linkClicks || t.clicks)} />
            <Tile label="Impressions" value={fmtInt(t.impressions)} />
            <Tile label="CTR" value={`${Number(t.ctr || 0).toFixed(2)}%`} />
          </div>

          {/* Campaigns */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp size={14} className="text-gray-400" />
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest">Campaigns</p>
            </div>

            {data.campaigns.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50/60 p-6 text-center">
                <p className="text-sm font-semibold text-gray-600">No campaigns in this period</p>
                <p className="text-xs text-gray-400 mt-1">Create a campaign in Meta Ads Manager — one-tap boosting from PocketLink is coming soon.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {data.campaigns.map((c) => (
                  <div key={c.id} className="rounded-xl border border-gray-100 bg-white p-3.5">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-bold text-gray-900 truncate flex-1">{c.name}</p>
                      <StatusChip status={c.status} />
                    </div>
                    {c.objective && <p className="text-[11px] text-gray-400 mt-0.5">{objLabel(c.objective)}</p>}
                    <div className="grid grid-cols-3 gap-2 mt-2.5 text-center">
                      <div>
                        <p className="text-[10px] text-gray-400 uppercase tracking-wide">Spend</p>
                        <p className="text-sm font-extrabold text-gray-900 tabular-nums">{money(c.spend, cur)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-gray-400 uppercase tracking-wide">{c.resultLabel || 'Results'}</p>
                        <p className="text-sm font-extrabold text-gray-900 tabular-nums">{fmtInt(c.results)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-gray-400 uppercase tracking-wide">Cost / result</p>
                        <p className="text-sm font-extrabold text-gray-900 tabular-nums">{c.costPerResult != null ? money(c.costPerResult, cur) : '—'}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 2E-2 Measurement — our launched campaigns, Meta vs PocketLink truth */}
          {data.measured?.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2 mt-1">
                <TrendingUp size={14} className="text-gray-400" />
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest">PocketLink campaigns — measurement</p>
              </div>
              <div className="space-y-2">
                {data.measured.map((mc) => <MeasuredCard key={mc.campaignId} mc={mc} cur={cur} themeColor={themeColor} />)}
              </div>
              <p className="text-[11px] text-gray-400 mt-2">
                Meta figures are ad-attributed (modeled); PocketLink figures are your actual orders in the campaign window. Shown separately, never blended.
              </p>
            </div>
          )}

          <p className="text-[11px] text-gray-400 text-center pt-1">
            Read-only — Meta numbers come straight from Meta; order/revenue truth from your PocketLink orders.
          </p>
        </>
      )}
    </div>
  );
}

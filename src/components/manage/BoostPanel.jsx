import { useState, useEffect } from 'react';
import {
  ArrowLeft, ArrowRight, AlertTriangle, Check, ChevronDown, ChevronUp, Globe,
  ShoppingBag, Users, Sparkles, Megaphone, Info,
} from 'lucide-react';
import { previewCampaign } from '../../utils/metaCampaign';
import { launchCreate, launchActivate, launchPause, launchStop } from '../../utils/metaLaunch';
import { consoleSession, fetchMyTeamRow } from '../../utils/consoleService';

/**
 * Manage → Ads → Create campaign (Stage 2E-1).
 *
 * A business-outcome wizard, NOT a Meta form. The seller answers four plain
 * questions (goal → what to promote → who to reach → budget); PocketLink's
 * recommendation engine (server-side) decides the objective, optimisation,
 * audience strategy, placements and creative, then shows a plain-language plan
 * with a reason for each choice. Meta terminology stays out of Simple mode; the
 * collapsed "Advanced controls" is where a power user can override. Everything is
 * a dry run until a founder explicitly activates — no Meta terms, no spend, here.
 */

const money = (n, cur = 'INR') => (cur === 'INR' ? `₹${Number(n || 0).toLocaleString('en-IN')}` : `${Number(n || 0).toLocaleString('en-IN')} ${cur}`);

const ERR = {
  not_connected: 'Connect Meta in Settings first.',
  no_ad_account: 'No ad account connected — reconnect Meta and share an ad account.',
  reauth: 'Your Meta connection expired — reconnect in Settings → Connect Meta.',
};

// Step 1 goals — business outcomes, no Meta words. `soon` = defined, not yet live.
const GOALS = [
  { key: 'orders',   title: 'Get more orders',              desc: 'Reach people likely to buy',   Icon: ShoppingBag },
  { key: 'visitors', title: 'Get more store visitors',      desc: 'Send more people to your store', Icon: Users },
  { key: 'retarget', title: 'Bring back interested people', desc: 'Re-reach recent visitors',       Icon: Sparkles, soon: true },
  { key: 'promote',  title: 'Promote my business',          desc: 'Get seen by more people nearby', Icon: Megaphone },
];

const STAGES = ['goal', 'promote', 'audience', 'budget', 'plan'];
const STEP_LABEL = { goal: 'Goal', promote: 'Promote', audience: 'Audience', budget: 'Budget', plan: 'Plan' };

function Row({ k, v, last }) {
  return (
    <div className={`flex items-start justify-between gap-4 py-2 ${last ? '' : 'border-b border-gray-100'}`}>
      <span className="text-xs font-semibold text-gray-500 shrink-0">{k}</span>
      <span className="text-sm text-gray-900 text-right">{v}</span>
    </div>
  );
}

// Wizard shell (module-level so it keeps a stable identity across renders — a
// nested component would remount every keystroke and drop input focus).
function Shell({ stage, idx, themeColor, onBack, title, sub, children }) {
  return (
    <div className="animate-pl-fade-up max-w-lg">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-500 hover:text-gray-800 mb-3">
        <ArrowLeft size={16} /> {stage === 'goal' ? 'Back to Ads' : 'Back'}
      </button>
      <div className="flex items-center gap-1.5 mb-3">
        {STAGES.map((s, i) => (
          <div key={s} className="flex items-center gap-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: i <= idx ? themeColor : '#cbd5e1' }}>{STEP_LABEL[s]}</span>
            {i < STAGES.length - 1 && <span className="w-4 h-px" style={{ background: i < idx ? themeColor : '#e5e7eb' }} />}
          </div>
        ))}
      </div>
      <h2 className="text-xl font-extrabold text-gray-900">{title}</h2>
      {sub && <p className="text-xs text-gray-400 mt-0.5 mb-4">{sub}</p>}
      {children}
    </div>
  );
}

export default function BoostPanel({ config, pin, themeColor = '#0d9488', onClose }) {
  const products = Array.isArray(config.products) ? config.products : [];
  const [stage, setStage] = useState('goal');
  const [biz, setBiz] = useState({
    goal: 'orders', promote: 'recommended', productId: products[0]?.id ?? '',
    audienceMode: 'auto', radiusKm: 25, ageMin: 18, ageMax: 65, gender: 'all',
    budgetMode: 'recommended', dailyBudget: 300, days: 7,
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [data, setData] = useState(null);            // preview response (incl. recommendation + resolved)
  const [approved, setApproved] = useState(false);
  const [showAdv, setShowAdv] = useState(false);
  const [showPayloads, setShowPayloads] = useState(false);
  const [isFounder, setIsFounder] = useState(false);
  const [launch, setLaunch] = useState(null);        // { launchId, status, ids, busy, error, step }
  const [confirmSpend, setConfirmSpend] = useState(false);

  const set = (patch) => setBiz((f) => ({ ...f, ...patch }));

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const s = await consoleSession();
        if (!s?.user) return;
        const row = await fetchMyTeamRow(s.user.id);
        if (alive && row?.role === 'admin') setIsFounder(true);
      } catch { /* owner dry-run flow */ }
    })();
    return () => { alive = false; };
  }, []);

  async function buildPlan(overrides) {
    const b = { ...biz, ...(overrides || {}) };
    setErr(''); setBusy(true); setApproved(false); setLaunch(null); setConfirmSpend(false);
    try {
      const d = await previewCampaign(config.slug, pin, {
        goal: b.goal, promote: b.promote, productId: b.productId,
        audienceMode: b.audienceMode, budgetMode: b.budgetMode,
        dailyBudget: Number(b.dailyBudget), days: Number(b.days),
        radiusKm: Number(b.radiusKm), ageMin: Number(b.ageMin), ageMax: Number(b.ageMax), gender: b.gender,
      });
      if (d?.error) { setErr(ERR[d.error] || 'Something went wrong. Try again.'); setBusy(false); return; }
      setData(d); setStage('plan');
    } catch {
      setErr('Could not build your plan. Try again.');
    } finally { setBusy(false); }
  }

  function launchErr(r) {
    if (r.error === 'blocked') return 'Resolve the items above before launching.';
    if (r.error === 'partial') return `Created up to the ${r.step} step — tap Launch again to resume safely.`;
    if (r.error === 'in_progress') return 'This launch is already being created — wait a moment.';
    if (r.error === 'founder_only') return 'Activation is founder-only.';
    if (r.error === 'not_connected') return 'Meta isn’t connected for this store.';
    return r.message || 'Launch failed. Try again.';
  }
  async function doLaunch() {
    const r = data?.resolved; if (!r) return;
    const launchId = launch?.launchId || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
    setLaunch({ launchId, busy: true, error: '' });
    try {
      const res = await launchCreate(config.slug, launchId, {
        objective: r.objective, promote: r.promote, productId: r.productId,
        dailyBudget: r.dailyBudget, days: r.days, audienceStrategy: r.audienceStrategy,
        radiusKm: r.radiusKm, ageMin: r.ageMin, ageMax: r.ageMax, gender: r.gender,
      });
      if (res?.error) setLaunch({ launchId, status: res.status || '', step: res.step, error: launchErr(res) });
      else setLaunch({ launchId, status: res.status, ids: res.ids });
    } catch (e) { setLaunch({ launchId, error: e.message || 'Launch failed.' }); }
  }
  async function act(fn) {
    setLaunch((l) => ({ ...l, busy: true, error: '' }));
    try {
      const res = await fn(launch.launchId);
      setLaunch((l) => (res?.error ? { ...l, busy: false, error: res.message || res.error } : { ...l, busy: false, status: res.status }));
    } catch (e) { setLaunch((l) => ({ ...l, busy: false, error: e.message })); }
  }

  const idx = STAGES.indexOf(stage);
  function back() {
    if (stage === 'plan') { setStage('budget'); return; }
    if (idx > 0) setStage(STAGES[idx - 1]); else onClose();
  }

  const label = 'block text-xs font-semibold text-gray-600 mb-1.5';
  const input = 'w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-brand';
  const cardBtn = (on) => `w-full text-left rounded-2xl border p-4 transition active:scale-[0.99] ${on ? 'border-transparent text-white shadow-sm' : 'border-gray-200 bg-white hover:border-gray-300'}`;
  const primaryBtn = 'w-full py-3 rounded-xl text-white text-sm font-bold active:scale-[0.98] transition disabled:opacity-50';

  const shellProps = { stage, idx, themeColor, onBack: back };

  // ── Step 1 · Goal ─────────────────────────────────────────────────────────────
  if (stage === 'goal') {
    return (
      <Shell {...shellProps} title="What do you want?" sub="Pick the outcome you're after — PocketLink handles the how.">
        <div className="space-y-2.5">
          {GOALS.map(({ key, title, desc, Icon, soon }) => (
            <button key={key} type="button" disabled={soon}
              onClick={() => { set({ goal: key }); setStage('promote'); }}
              className={`${cardBtn(false)} ${soon ? 'opacity-60 cursor-not-allowed' : ''} flex items-center gap-3`}>
              <span className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${themeColor}14`, color: themeColor }}><Icon size={20} /></span>
              <span className="flex-1">
                <span className="block text-sm font-bold text-gray-900">{title}{soon && <span className="ml-2 text-[10px] font-bold uppercase tracking-wide text-amber-600 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">Soon</span>}</span>
                <span className="block text-xs text-gray-500">{desc}</span>
              </span>
              {!soon && <ArrowRight size={16} className="text-gray-300" />}
            </button>
          ))}
        </div>
      </Shell>
    );
  }

  // ── Step 2 · Promote ────────────────────────────────────────────────────────
  if (stage === 'promote') {
    const opts = [
      ['recommended', '⭐ Recommended', `We'll pick your best-seller automatically`],
      ['product', 'Pick a product', 'Choose exactly what to advertise'],
      ['store', 'Whole store', 'Show a range of what you offer'],
    ];
    return (
      <Shell {...shellProps} title="What should we promote?" sub="PocketLink advertises the strongest thing by default.">
        <div className="space-y-2.5">
          {opts.map(([v, t, d]) => (
            <button key={v} type="button" onClick={() => set({ promote: v })}
              className={cardBtn(biz.promote === v)} style={biz.promote === v ? { background: themeColor } : undefined}>
              <span className="block text-sm font-bold">{t}</span>
              <span className={`block text-xs ${biz.promote === v ? 'text-white/85' : 'text-gray-500'}`}>{d}</span>
            </button>
          ))}
          {biz.promote === 'product' && (
            <div>
              <label className={label}>Which product?</label>
              <select value={biz.productId} onChange={(e) => set({ productId: e.target.value })} className={input}>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}{p.price ? ` — ₹${p.price}` : ''}</option>)}
              </select>
            </div>
          )}
        </div>
        <button type="button" onClick={() => setStage('audience')} className={`${primaryBtn} mt-5`} style={{ background: themeColor }}>Continue</button>
      </Shell>
    );
  }

  // ── Step 3 · Audience ───────────────────────────────────────────────────────
  if (stage === 'audience') {
    return (
      <Shell {...shellProps} title="Who should we reach?" sub="We let Meta's AI find the right people — you set the basics.">
        <div className="space-y-2.5">
          <button type="button" onClick={() => set({ audienceMode: 'auto' })}
            className={cardBtn(biz.audienceMode === 'auto')} style={biz.audienceMode === 'auto' ? { background: themeColor } : undefined}>
            <span className="flex items-center gap-2 text-sm font-bold"><Sparkles size={15} /> Let PocketLink find buyers <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${biz.audienceMode === 'auto' ? 'bg-white/20' : 'bg-gray-100 text-gray-500'}`}>Recommended</span></span>
            <span className={`block text-xs mt-0.5 ${biz.audienceMode === 'auto' ? 'text-white/85' : 'text-gray-500'}`}>Meta's AI finds people likely to respond — no guessing interests.</span>
          </button>
          <button type="button" onClick={() => set({ audienceMode: 'manual' })}
            className={cardBtn(biz.audienceMode === 'manual')} style={biz.audienceMode === 'manual' ? { background: themeColor } : undefined}>
            <span className="block text-sm font-bold">Choose the basics myself</span>
            <span className={`block text-xs ${biz.audienceMode === 'manual' ? 'text-white/85' : 'text-gray-500'}`}>Set only area, age and gender.</span>
          </button>
        </div>

        <div className="mt-4 space-y-2.5 rounded-xl border border-gray-200 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-gray-500">Around {config.city || 'your area'}</span>
            <select value={biz.radiusKm} onChange={(e) => set({ radiusKm: Number(e.target.value) })} className="text-xs rounded-lg border border-gray-200 bg-white px-2 py-1.5">
              {[10, 25, 40].map((km) => <option key={km} value={km}>{km} km</option>)}
            </select>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-gray-500">Show to</span>
            <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden text-xs font-semibold">
              {[['all', 'Everyone'], ['women', 'Women'], ['men', 'Men']].map(([v, t]) => (
                <button key={v} type="button" onClick={() => set({ gender: v })}
                  className={`px-2.5 py-1.5 ${biz.gender === v ? 'text-white' : 'text-gray-500 bg-white'}`} style={biz.gender === v ? { background: themeColor } : undefined}>{t}</button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-gray-500">Age</span>
            <div className="flex items-center gap-1.5">
              <input type="number" min={13} max={65} inputMode="numeric" value={biz.ageMin} onChange={(e) => set({ ageMin: e.target.value.replace(/[^0-9]/g, '') })} className="w-14 px-2 py-1.5 text-xs rounded-lg border border-gray-200" />
              <span className="text-gray-400 text-xs">to</span>
              <input type="number" min={13} max={65} inputMode="numeric" value={biz.ageMax} onChange={(e) => set({ ageMax: e.target.value.replace(/[^0-9]/g, '') })} className="w-14 px-2 py-1.5 text-xs rounded-lg border border-gray-200" />
            </div>
          </div>
        </div>
        <button type="button" onClick={() => setStage('budget')} className={`${primaryBtn} mt-5`} style={{ background: themeColor }}>Continue</button>
      </Shell>
    );
  }

  // ── Step 4 · Budget ─────────────────────────────────────────────────────────
  if (stage === 'budget') {
    const presets = [200, 500, 1000];
    const pick = (amt) => set({ budgetMode: 'preset', dailyBudget: amt });
    return (
      <Shell {...shellProps} title="How much do you want to spend?" sub="A daily budget — you can change or stop anytime.">
        <div className="space-y-2.5">
          <button type="button" onClick={() => set({ budgetMode: 'recommended' })}
            className={cardBtn(biz.budgetMode === 'recommended')} style={biz.budgetMode === 'recommended' ? { background: themeColor } : undefined}>
            <span className="block text-sm font-bold">Recommended</span>
            <span className={`block text-xs ${biz.budgetMode === 'recommended' ? 'text-white/85' : 'text-gray-500'}`}>PocketLink picks a sensible starting budget for your goal.</span>
          </button>
          <div className="grid grid-cols-3 gap-2.5">
            {presets.map((amt) => (
              <button key={amt} type="button" onClick={() => pick(amt)}
                className={`rounded-xl border p-3 text-center transition ${biz.budgetMode === 'preset' && Number(biz.dailyBudget) === amt ? 'text-white' : 'border-gray-200 bg-white hover:border-gray-300'}`}
                style={biz.budgetMode === 'preset' && Number(biz.dailyBudget) === amt ? { background: themeColor } : undefined}>
                <span className="block text-sm font-bold">₹{amt}</span><span className="block text-[10px] opacity-80">/day</span>
              </button>
            ))}
          </div>
          <button type="button" onClick={() => set({ budgetMode: 'custom' })}
            className={cardBtn(biz.budgetMode === 'custom')} style={biz.budgetMode === 'custom' ? { background: themeColor } : undefined}>
            <span className="block text-sm font-bold">Custom amount</span>
          </button>
          {biz.budgetMode === 'custom' && (
            <div className="grid grid-cols-2 gap-3">
              <div><label className={label}>Daily budget (₹)</label>
                <input type="number" min={1} inputMode="numeric" value={biz.dailyBudget} onChange={(e) => set({ dailyBudget: e.target.value.replace(/[^0-9]/g, '') })} className={input} /></div>
              <div><label className={label}>Run for (days)</label>
                <input type="number" min={1} max={30} inputMode="numeric" value={biz.days} onChange={(e) => set({ days: e.target.value.replace(/[^0-9]/g, '') })} className={input} /></div>
            </div>
          )}
          {biz.budgetMode !== 'custom' && (
            <div><label className={label}>Run for (days)</label>
              <input type="number" min={1} max={30} inputMode="numeric" value={biz.days} onChange={(e) => set({ days: e.target.value.replace(/[^0-9]/g, '') })} className={input} /></div>
          )}
        </div>
        {err && <p className="text-xs text-red-600 mt-3">{err}</p>}
        <button type="button" onClick={() => buildPlan()} disabled={busy} className={`${primaryBtn} mt-5`} style={{ background: themeColor }}>
          {busy ? 'Building your plan…' : 'See the plan PocketLink built'}
        </button>
      </Shell>
    );
  }

  // ── Step 5 · Plan ────────────────────────────────────────────────────────────
  const d = data || {};
  const rec = d.recommendation || {};
  const cur = d.currency || 'INR';
  const c = d.creative || {};
  const blockers = d.launchBlockers || [];
  const warnings = d.warnings || [];
  const R = rec.reasons || {};
  const st = launch?.status;

  return (
    <Shell {...shellProps} title="Here's the plan PocketLink built" sub="Review it — nothing runs, and nothing spends, until it's activated.">
      {/* Why, up top */}
      {rec.overall && (
        <div className="rounded-xl p-3.5 mb-4 text-sm" style={{ background: `${themeColor}0f`, border: `1px solid ${themeColor}33` }}>
          <p className="font-bold text-gray-900 flex items-center gap-1.5 mb-1"><Sparkles size={14} style={{ color: themeColor }} /> Why this plan</p>
          <p className="text-gray-700 text-[13px] leading-relaxed">{rec.overall}</p>
        </div>
      )}

      {/* Ad preview */}
      <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-1.5">Ad preview</p>
      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden max-w-sm mb-4">
        <div className="px-3 pt-3 pb-2 flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center overflow-hidden">
            {config.logo ? <img src={config.logo} alt="" className="w-full h-full object-cover" /> : <span>{config.logoEmoji || '🏪'}</span>}
          </div>
          <div className="leading-tight">
            <p className="text-[13px] font-bold text-gray-900">{d.page?.name || config.businessName || 'Your Page'}</p>
            <p className="text-[10px] text-gray-400">Sponsored · <Globe size={9} className="inline" /></p>
          </div>
        </div>
        {c.primaryText && <p className="px-3 pb-2 text-[13px] text-gray-800">{c.primaryText}</p>}
        <div className="aspect-[1.91/1] bg-gray-50">
          {c.imageUrl ? <img src={c.imageUrl} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full grid place-items-center text-3xl text-gray-300">🖼️</div>}
        </div>
        <div className="px-3 py-2.5 flex items-center gap-2 bg-gray-50 border-t border-gray-100">
          <div className="flex-1 min-w-0"><p className="text-[10px] text-gray-400 uppercase truncate">pocketlink.store</p><p className="text-[13px] font-bold text-gray-900 truncate">{c.headline}</p></div>
          <span className="text-[12px] font-bold text-gray-700 border border-gray-300 rounded-lg px-3 py-1.5 whitespace-nowrap">{c.cta || 'Shop Now'}</span>
        </div>
      </div>

      {/* The plan — business language, each line with its reason */}
      <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-3.5 space-y-0">
        <Row k="Goal" v={rec.goal?.title || '—'} />
        <Row k="Promoting" v={rec.promoting?.name || (c.promote === 'product' ? c.productName : 'Your store')} />
        <Row k="Who we reach" v={`${d.targeting?.resolved ? d.targeting.label : 'your area'} · Age ${d.targeting?.ageMin}–${d.targeting?.ageMax}${d.targeting?.genderLabel && d.targeting.genderLabel !== 'All' ? ` · ${d.targeting.genderLabel}` : ''}`} />
        <Row k="Strategy" v={d.targeting?.strategyLabel || 'PocketLink finds buyers'} />
        <Row k="Budget" v={`${money(d.budget?.daily, cur)}/day · ${d.budget?.days} days`} />
        <Row k="Up to" v={<b>{money(d.budget?.total, cur)}</b>} />
        <Row k="Facebook Page" v={d.page ? d.page.name : <span className="text-amber-600">none — connect in Settings</span>} last />
      </div>

      {/* Why each choice — the seller's transparency into PocketLink's decisions */}
      <div className="mt-3 space-y-1.5">
        {[['Goal', R.goal], ['Promoting', R.promoting], ['Audience', R.audience], ['Optimising', R.optimization], ['Creative', R.creative], ['Budget', R.budget]]
          .filter(([, v]) => v)
          .map(([k, v]) => <p key={k} className="text-[11px] text-gray-500 leading-snug"><b className="text-gray-600">{k}:</b> {v}</p>)}
      </div>

      {/* Blockers / warnings */}
      {blockers.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3.5 mt-3">
          <p className="text-sm font-bold text-red-700 flex items-center gap-1.5"><AlertTriangle size={15} /> Fix before this can run</p>
          <ul className="mt-1.5 space-y-1 text-xs text-red-700/90 list-disc pl-4">{blockers.map((b, i) => <li key={i}>{b}</li>)}</ul>
        </div>
      )}
      {warnings.length > 0 && (
        <ul className="mt-2 space-y-1 text-[11px] text-gray-500 list-disc pl-4">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
      )}

      {/* Advanced controls — collapsed by default */}
      <div className="mt-3 border border-gray-200 rounded-xl overflow-hidden">
        <button type="button" onClick={() => setShowAdv((v) => !v)} className="w-full flex items-center justify-between px-3.5 py-2.5 text-sm font-semibold text-gray-600 bg-gray-50/60">
          <span>Advanced controls</span> {showAdv ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        {showAdv && (
          <div className="p-3.5 space-y-3 text-sm border-t border-gray-100">
            <p className="text-[11px] text-gray-400 flex items-start gap-1.5"><Info size={12} className="mt-0.5 shrink-0" /> PocketLink chose these for you. Change them only if you know Meta Ads — then re-build the plan.</p>
            <div>
              <label className={label}>Audience strategy</label>
              <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden text-xs font-semibold w-full">
                {[['auto', 'PocketLink finds buyers'], ['manual', 'Manual only']].map(([v, t]) => (
                  <button key={v} type="button" onClick={() => set({ audienceMode: v })}
                    className={`flex-1 px-2.5 py-2 ${biz.audienceMode === v ? 'text-white' : 'text-gray-500 bg-white'}`} style={biz.audienceMode === v ? { background: themeColor } : undefined}>{t}</button>
                ))}
              </div>
            </div>
            <div>
              <label className={label}>Objective override</label>
              <select value={biz.goal} onChange={(e) => set({ goal: e.target.value })} className={input}>
                <option value="orders">Orders (Sales / conversions)</option>
                <option value="visitors">Store visitors (Traffic)</option>
                <option value="promote">Awareness (Reach)</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className={label}>Daily budget (₹)</label>
                <input type="number" min={1} inputMode="numeric" value={biz.dailyBudget} onChange={(e) => set({ budgetMode: 'custom', dailyBudget: e.target.value.replace(/[^0-9]/g, '') })} className={input} /></div>
              <div><label className={label}>Days</label>
                <input type="number" min={1} max={30} inputMode="numeric" value={biz.days} onChange={(e) => set({ days: e.target.value.replace(/[^0-9]/g, '') })} className={input} /></div>
            </div>
            <button type="button" onClick={() => buildPlan()} disabled={busy} className="w-full py-2 rounded-lg border border-gray-300 text-sm font-semibold text-gray-700 disabled:opacity-50">
              {busy ? 'Rebuilding…' : 'Update plan'}
            </button>
            <button type="button" onClick={() => setShowPayloads((v) => !v)} className="text-[11px] font-semibold text-gray-400 hover:text-gray-600">
              {showPayloads ? 'Hide' : 'Show'} exact Meta payloads (dry run — not sent)
            </button>
            {showPayloads && <pre className="text-[10px] bg-gray-900 text-gray-100 rounded-lg p-3 overflow-x-auto">{JSON.stringify(d.payloads, null, 2)}</pre>}
          </div>
        )}
      </div>

      {/* Launch / approve */}
      <div className="mt-4">
        {isFounder ? (
          <FounderControls
            ready={d.launchReady} launch={launch} status={st}
            confirmSpend={confirmSpend} setConfirmSpend={setConfirmSpend}
            doLaunch={doLaunch} act={act} themeColor={themeColor} money={(n) => money(n, cur)} total={d.budget?.total}
          />
        ) : (
          <div>
            <button type="button" disabled={!d.launchReady || approved} onClick={() => setApproved(true)}
              className={primaryBtn} style={{ background: themeColor }}>
              {approved ? 'Approved ✓ (dry run — no spend)' : 'Approve (dry run — no spend)'}
            </button>
            <p className="text-[11px] text-gray-400 text-center mt-2">This is a preview. Going live is done by the PocketLink team.</p>
          </div>
        )}
      </div>
    </Shell>
  );
}

// Founder-only launch controls: create PAUSED → confirm → Activate → Pause/Stop.
function FounderControls({ ready, launch, status, confirmSpend, setConfirmSpend, doLaunch, act, themeColor, money, total }) {
  const btn = 'w-full py-3 rounded-xl text-sm font-bold active:scale-[0.98] transition disabled:opacity-50';
  const busy = launch?.busy;
  if (!status) {
    return (
      <div>
        <button type="button" disabled={!ready || busy} onClick={doLaunch} className={`${btn} text-white`} style={{ background: themeColor }}>
          {busy ? 'Creating (paused)…' : 'Launch — creates it paused (no spend yet)'}
        </button>
        {launch?.error && <p className="text-xs text-red-600 mt-2">{launch.error}</p>}
        {!ready && <p className="text-[11px] text-gray-400 text-center mt-2">Resolve the items above to enable launch.</p>}
      </div>
    );
  }
  if (status === 'active') {
    return (
      <div className="space-y-2">
        <p className="text-sm font-bold text-green-700 flex items-center gap-1.5"><Check size={15} /> Live — spending now</p>
        <div className="grid grid-cols-2 gap-2.5">
          <button type="button" disabled={busy} onClick={() => act(launchPause)} className={`${btn} border border-gray-300 text-gray-700`}>Pause</button>
          <button type="button" disabled={busy} onClick={() => act(launchStop)} className={`${btn} border border-red-300 text-red-600`}>Stop</button>
        </div>
        {launch?.error && <p className="text-xs text-red-600">{launch.error}</p>}
      </div>
    );
  }
  if (status === 'stopped') return <p className="text-sm font-bold text-gray-500 flex items-center gap-1.5"><Check size={15} /> Stopped — kept in history.</p>;
  // created or paused → offer activation with an explicit spend confirmation
  return (
    <div className="space-y-2.5">
      <p className="text-sm font-bold text-gray-800">{status === 'paused' ? 'Paused' : 'Created — paused, no spend yet ✓'}</p>
      <label className="flex items-start gap-2 text-xs text-gray-600 bg-amber-50 border border-amber-200 rounded-xl p-3">
        <input type="checkbox" checked={confirmSpend} onChange={(e) => setConfirmSpend(e.target.checked)} className="mt-0.5" />
        <span>I understand activating starts real spending, up to <b>{money(total)}</b> over the run.</span>
      </label>
      <button type="button" disabled={!confirmSpend || busy} onClick={() => act(launchActivate)} className={`${btn} text-white`} style={{ background: themeColor }}>
        {busy ? 'Activating…' : 'Activate — start spending'}
      </button>
      <button type="button" disabled={busy} onClick={() => act(launchStop)} className={`${btn} border border-gray-300 text-gray-600`}>Stop</button>
      {launch?.error && <p className="text-xs text-red-600">{launch.error}</p>}
    </div>
  );
}

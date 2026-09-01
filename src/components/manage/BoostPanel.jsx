import { useState, useEffect } from 'react';
import { ArrowLeft, AlertTriangle, Info, Check, ChevronDown, ChevronUp, Globe } from 'lucide-react';
import { previewCampaign } from '../../utils/metaCampaign';
import { launchCreate, launchActivate, launchPause, launchStop } from '../../utils/metaLaunch';
import { consoleSession, fetchMyTeamRow } from '../../utils/consoleService';

/**
 * Manage → Ads → Create campaign (Stage 2C): configure → preview → approve.
 * ENTIRELY read-only — the preview is a dry run built server-side; nothing is
 * created on Meta and no money is spent. "Approve" is a dry-run acknowledgement
 * only (launching arrives in a later stage).
 */

const money = (n, cur = 'INR') => (cur === 'INR' ? `₹${Number(n || 0).toLocaleString('en-IN')}` : `${Number(n || 0).toLocaleString('en-IN')} ${cur}`);

const ERR = {
  not_connected: 'Connect Meta in Settings first.',
  no_ad_account: 'No ad account connected — reconnect Meta and share an ad account.',
  reauth: 'Your Meta connection expired — reconnect in Settings → Connect Meta.',
  objective_unavailable: 'That objective isn’t available yet.',
};

export default function BoostPanel({ config, pin, themeColor = '#0d9488', onClose }) {
  const products = Array.isArray(config.products) ? config.products : [];
  const [form, setForm] = useState({ promote: 'store', productId: products[0]?.id ?? '', dailyBudget: 200, days: 7, objective: 'traffic', gender: 'all', radiusKm: 25, ageMin: 18, ageMax: 65 });
  const [step, setStep] = useState('configure');   // configure | preview
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [data, setData] = useState(null);
  const [approved, setApproved] = useState(false);
  const [showPayloads, setShowPayloads] = useState(false);
  // Founder-only launch (Stage 2D). The server re-verifies crm_team admin; this
  // just decides whether to show the launch controls (a founder session present).
  const [isFounder, setIsFounder] = useState(false);
  const [launch, setLaunch] = useState(null);          // { launchId, status, ids, busy, error, step }
  const [confirmSpend, setConfirmSpend] = useState(false);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  async function runPreview() {
    setErr(''); setBusy(true); setApproved(false);
    try {
      const d = await previewCampaign(config.slug, pin, {
        promote: form.promote, productId: form.productId,
        dailyBudget: Number(form.dailyBudget), days: Number(form.days), objective: form.objective,
        gender: form.gender, radiusKm: Number(form.radiusKm), ageMin: Number(form.ageMin), ageMax: Number(form.ageMax),
      });
      if (d?.error) { setErr(ERR[d.error] || 'Something went wrong. Try again.'); setBusy(false); return; }
      setData(d); setStep('preview');
    } catch {
      setErr('Could not build the preview. Try again.');
    } finally { setBusy(false); }
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const s = await consoleSession();
        if (!s?.user) return;
        const row = await fetchMyTeamRow(s.user.id);
        if (alive && row?.role === 'admin') setIsFounder(true);
      } catch { /* not a founder — owner dry-run flow */ }
    })();
    return () => { alive = false; };
  }, []);

  function launchErr(r) {
    if (r.error === 'blocked') return 'Resolve the blockers above before launching.';
    if (r.error === 'partial') return `Created up to the ${r.step} step — tap Launch again to resume safely.`;
    if (r.error === 'in_progress') return 'This launch is already being created — wait a moment.';
    if (r.error === 'founder_only') return 'Founder access only.';
    if (r.error === 'not_connected') return 'Meta isn’t connected for this store.';
    return r.message || 'Launch failed. Try again.';
  }
  async function doLaunch() {
    const launchId = launch?.launchId || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
    setLaunch({ launchId, busy: true, error: '' });
    try {
      const r = await launchCreate(config.slug, launchId, { promote: form.promote, productId: form.productId, dailyBudget: Number(form.dailyBudget), days: Number(form.days), objective: form.objective, gender: form.gender, radiusKm: Number(form.radiusKm), ageMin: Number(form.ageMin), ageMax: Number(form.ageMax) });
      if (r?.error) setLaunch({ launchId, status: r.status || '', step: r.step, error: launchErr(r) });
      else setLaunch({ launchId, status: r.status, ids: r.ids });
    } catch (e) { setLaunch({ launchId, error: e.message || 'Launch failed.' }); }
  }
  async function act(fn) {
    setLaunch((l) => ({ ...l, busy: true, error: '' }));
    try {
      const r = await fn(launch.launchId);
      setLaunch((l) => (r?.error ? { ...l, busy: false, error: r.message || r.error } : { ...l, busy: false, status: r.status }));
    } catch (e) { setLaunch((l) => ({ ...l, busy: false, error: e.message })); }
  }

  const label = 'block text-xs font-semibold text-gray-600 mb-1.5';
  const input = 'w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-brand';

  // ── Configure ──────────────────────────────────────────────────────────────
  if (step === 'configure') {
    return (
      <div className="animate-pl-fade-up max-w-lg">
        <button type="button" onClick={onClose} className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-500 hover:text-gray-800 mb-3">
          <ArrowLeft size={16} /> Back to Ads
        </button>
        <h2 className="text-lg font-extrabold text-gray-900">Create a campaign</h2>
        <p className="text-xs text-gray-400 mt-0.5 mb-4">Preview exactly what would run — nothing is created or charged here.</p>

        <div className="space-y-4">
          <div>
            <label className={label}>What to promote</label>
            <div className="inline-flex rounded-xl border border-gray-200 overflow-hidden text-sm font-bold w-full">
              {[['store', 'Whole store'], ['product', 'A product']].map(([v, t]) => (
                <button key={v} type="button" onClick={() => set({ promote: v })}
                  className={`flex-1 px-3 py-2 transition ${form.promote === v ? 'text-white' : 'text-gray-500 bg-white hover:bg-gray-50'}`}
                  style={form.promote === v ? { background: themeColor } : undefined}>{t}</button>
              ))}
            </div>
          </div>

          {form.promote === 'product' && (
            <div>
              <label className={label}>Product</label>
              <select value={form.productId} onChange={(e) => set({ productId: e.target.value })} className={input}>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}{p.price ? ` — ₹${p.price}` : ''}</option>)}
              </select>
            </div>
          )}

          <div>
            <label className={label}>Goal</label>
            <select value={form.objective} onChange={(e) => set({ objective: e.target.value })} className={input}>
              <option value="traffic">Website visits (Traffic)</option>
              <option value="sales">Sales / Purchases</option>
            </select>
            <p className="mt-1 text-[11px] text-gray-400">
              {form.objective === 'sales'
                ? 'Optimises for buyers via your Meta Pixel. Best once your store has recent purchases; needs the Pixel connected.'
                : 'Sends people to your store — good for a new store building its first orders.'}
            </p>
          </div>

          <div>
            <label className={label}>Audience</label>
            <div className="space-y-2.5 rounded-xl border border-gray-200 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-gray-500">Show to</span>
                <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden text-xs font-semibold">
                  {[['all', 'Everyone'], ['women', 'Women'], ['men', 'Men']].map(([v, t]) => (
                    <button key={v} type="button" onClick={() => set({ gender: v })}
                      className={`px-2.5 py-1.5 transition ${form.gender === v ? 'text-white' : 'text-gray-500 bg-white hover:bg-gray-50'}`}
                      style={form.gender === v ? { background: themeColor } : undefined}>{t}</button>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-gray-500">Distance around {config.city || 'your area'}</span>
                <select value={form.radiusKm} onChange={(e) => set({ radiusKm: Number(e.target.value) })}
                  className="text-xs rounded-lg border border-gray-200 bg-white px-2 py-1.5">
                  {[10, 25, 40].map((km) => <option key={km} value={km}>{km} km</option>)}
                </select>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-gray-500">Age</span>
                <div className="flex items-center gap-1.5">
                  <input type="number" min={13} max={65} inputMode="numeric" value={form.ageMin}
                    onChange={(e) => set({ ageMin: e.target.value.replace(/[^0-9]/g, '') })}
                    className="w-14 px-2 py-1.5 text-xs rounded-lg border border-gray-200" />
                  <span className="text-gray-400 text-xs">to</span>
                  <input type="number" min={13} max={65} inputMode="numeric" value={form.ageMax}
                    onChange={(e) => set({ ageMax: e.target.value.replace(/[^0-9]/g, '') })}
                    className="w-14 px-2 py-1.5 text-xs rounded-lg border border-gray-200" />
                </div>
              </div>
            </div>
            <p className="mt-1 text-[11px] text-gray-400">Interests are kept broad on purpose — Meta finds buyers using your Pixel. Narrowing too far can starve delivery.</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Daily budget (₹)</label>
              <input type="number" min={1} inputMode="numeric" value={form.dailyBudget}
                     onChange={(e) => set({ dailyBudget: e.target.value.replace(/[^0-9]/g, '') })} className={input} />
            </div>
            <div>
              <label className={label}>Run for (days)</label>
              <input type="number" min={1} max={90} inputMode="numeric" value={form.days}
                     onChange={(e) => set({ days: e.target.value.replace(/[^0-9]/g, '') })} className={input} />
            </div>
          </div>
          <p className="text-xs text-gray-500">
            Estimated total: <b>{money((Number(form.dailyBudget) || 0) * (Number(form.days) || 0))}</b> over {Number(form.days) || 0} day{Number(form.days) === 1 ? '' : 's'}.
          </p>

          {err && <p className="text-xs text-red-600">{err}</p>}
          <button type="button" onClick={runPreview} disabled={busy || !form.dailyBudget || !form.days}
            className="w-full py-2.5 rounded-xl text-white text-sm font-bold active:scale-[0.98] transition disabled:opacity-50"
            style={{ background: themeColor }}>
            {busy ? 'Building preview…' : 'Preview campaign'}
          </button>
        </div>
      </div>
    );
  }

  // ── Preview + approve ──────────────────────────────────────────────────────
  const d = data || {};
  const cur = d.currency || 'INR';
  const c = d.creative || {};
  const blockers = d.launchBlockers || [];
  const warnings = d.warnings || [];

  return (
    <div className="animate-pl-fade-up max-w-lg space-y-4">
      <button type="button" onClick={() => { setStep('configure'); setApproved(false); }} className="inline-flex items-center gap-1.5 text-sm font-semibold text-gray-500 hover:text-gray-800">
        <ArrowLeft size={16} /> Edit
      </button>

      {/* Ad creative mock */}
      <div>
        <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-1.5">Ad preview</p>
        <div className="rounded-xl border border-gray-200 bg-white overflow-hidden max-w-sm">
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
            <div className="flex-1 min-w-0">
              <p className="text-[10px] text-gray-400 uppercase truncate">pocketlink.store</p>
              <p className="text-[13px] font-bold text-gray-900 truncate">{c.headline}</p>
            </div>
            <span className="text-[12px] font-bold text-gray-700 border border-gray-300 rounded-lg px-3 py-1.5 whitespace-nowrap">{c.cta || 'Shop Now'}</span>
          </div>
        </div>
      </div>

      {/* Summary */}
      <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-3.5 text-sm">
        <Row k="Goal" v={d.objective?.label || 'Website visits'} />
        <Row k="Daily budget" v={money(d.budget?.daily, cur)} />
        <Row k="Duration" v={`${d.budget?.days} days`} />
        <Row k="Estimated total" v={<b>{money(d.budget?.total, cur)}</b>} />
        <Row k="Audience" v={d.targeting?.resolved ? `${d.targeting.label} · Age ${d.targeting.ageMin}–${d.targeting.ageMax}${d.targeting.genderLabel && d.targeting.genderLabel !== 'All' ? ` · ${d.targeting.genderLabel}` : ''}` : '— not set —'} />
        <Row k="Facebook Page" v={d.page ? d.page.name : <span className="text-amber-600">none connected</span>} last />
      </div>

      {/* Blockers */}
      {blockers.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3.5">
          <p className="text-sm font-bold text-red-700 flex items-center gap-1.5"><AlertTriangle size={15} /> Fix before this can launch</p>
          <ul className="mt-1.5 space-y-1 text-xs text-red-700/90 list-disc pl-4">
            {blockers.map((b, i) => <li key={i}>{b}</li>)}
          </ul>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700 space-y-1">
          {warnings.map((w, i) => <p key={i} className="flex items-start gap-1.5"><Info size={13} className="flex-shrink-0 mt-0.5" />{w}</p>)}
        </div>
      )}

      {/* Exact payloads */}
      <div>
        <button type="button" onClick={() => setShowPayloads((s) => !s)} className="inline-flex items-center gap-1 text-xs font-semibold text-gray-500 hover:text-gray-800">
          {showPayloads ? <ChevronUp size={14} /> : <ChevronDown size={14} />} Exact API payloads (dry run — not sent)
        </button>
        {showPayloads && (
          <pre className="mt-2 text-[10px] leading-snug bg-gray-900 text-gray-100 rounded-xl p-3 overflow-x-auto">{JSON.stringify(d.payloads, null, 2)}</pre>
        )}
      </div>

      {/* Founder: real launch controls · Owner: dry-run approve only */}
      <div className="border-t border-gray-100 pt-3">
        {isFounder ? (
          !d.launchReady ? (
            <p className="text-xs text-gray-500">Resolve the blockers above before this can launch.</p>
          ) : launch?.status === 'active' ? (
            <div className="rounded-xl border border-green-200 bg-green-50 px-3.5 py-3 space-y-2">
              <p className="text-sm font-bold text-green-800">● Live — spending up to {money(d.budget?.total, cur)} over {d.budget?.days} days.</p>
              <p className="text-[11px] text-green-700/80">Meta’s ad review may hold delivery for a little while.</p>
              <div className="flex gap-2">
                <button type="button" onClick={() => act(launchPause)} disabled={launch.busy} className="text-xs font-bold px-3 py-1.5 rounded-lg border border-gray-300 text-gray-700 disabled:opacity-50">Pause</button>
                <button type="button" onClick={() => act(launchStop)} disabled={launch.busy} className="text-xs font-bold px-3 py-1.5 rounded-lg border border-red-200 text-red-600 disabled:opacity-50">Stop</button>
              </div>
              {launch.error && <p className="text-xs text-red-600">{launch.error}</p>}
            </div>
          ) : (launch?.status === 'created' || launch?.status === 'paused') ? (
            <div className="rounded-xl border border-gray-200 bg-white px-3.5 py-3 space-y-2.5">
              <p className="text-sm font-bold text-gray-800">Campaign created ({launch.status}) — <span className="text-green-700">nothing is spending yet</span>.</p>
              <label className="flex items-start gap-2 text-xs text-gray-600">
                <input type="checkbox" checked={confirmSpend} onChange={(e) => setConfirmSpend(e.target.checked)} className="mt-0.5" />
                <span>I understand this will start spending up to <b>{money(d.budget?.total, cur)}</b> over {d.budget?.days} days.</span>
              </label>
              <div className="flex gap-2">
                <button type="button" onClick={() => act(launchActivate)} disabled={!confirmSpend || launch.busy}
                  className="text-xs font-bold px-3 py-2 rounded-lg text-white disabled:opacity-40" style={{ background: themeColor }}>
                  {launch.busy ? 'Working…' : 'Activate — start spending'}
                </button>
                <button type="button" onClick={() => act(launchStop)} disabled={launch.busy} className="text-xs font-bold px-3 py-2 rounded-lg border border-red-200 text-red-600 disabled:opacity-50">Stop</button>
              </div>
              {launch.error && <p className="text-xs text-red-600">{launch.error}</p>}
            </div>
          ) : launch?.status === 'stopped' ? (
            <p className="text-sm font-semibold text-gray-600">Campaign stopped. It’s kept in Meta (paused), not deleted.</p>
          ) : (
            <>
              <button type="button" onClick={doLaunch} disabled={launch?.busy}
                className="w-full py-2.5 rounded-xl text-white text-sm font-bold active:scale-[0.98] transition disabled:opacity-50" style={{ background: themeColor }}>
                {launch?.busy ? 'Creating (paused)…' : 'Launch campaign — creates PAUSED, no spend yet'}
              </button>
              <p className="mt-1.5 text-[11px] text-gray-400 text-center">Founder-only. Creates everything paused; you activate spending in the next step.</p>
              {launch?.error && <p className="mt-1.5 text-xs text-red-600 text-center">{launch.error}</p>}
            </>
          )
        ) : approved ? (
          <div className="rounded-xl border border-green-200 bg-green-50 px-3.5 py-3 flex items-start gap-2">
            <Check size={16} className="text-green-600 mt-0.5" />
            <p className="text-sm text-green-800"><b>Approved (dry run).</b> Nothing was created or charged — the founder enables launching.</p>
          </div>
        ) : (
          <>
            <button type="button" onClick={() => setApproved(true)} disabled={!d.launchReady}
              className="w-full py-2.5 rounded-xl text-white text-sm font-bold active:scale-[0.98] transition disabled:opacity-40"
              style={{ background: themeColor }}>
              {d.launchReady ? 'Approve (dry run — no spend)' : 'Resolve the blockers above to approve'}
            </button>
            <p className="mt-1.5 text-[11px] text-gray-400 text-center">This does not create a campaign or spend money.</p>
          </>
        )}
      </div>
    </div>
  );
}

function Row({ k, v, last }) {
  return (
    <div className={`flex items-center justify-between gap-3 py-1.5 ${last ? '' : 'border-b border-gray-200/70'}`}>
      <span className="text-gray-500">{k}</span>
      <span className="text-gray-900 font-semibold text-right">{v}</span>
    </div>
  );
}

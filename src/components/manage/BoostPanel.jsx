import { useState, useEffect } from 'react';
import {
  ArrowLeft, ArrowRight, AlertTriangle, Check, ChevronDown, ChevronUp, Globe,
  ShoppingBag, Users, Sparkles, Megaphone, Info,
} from 'lucide-react';
import { previewCampaign } from '../../utils/metaCampaign';
import { fetchAdCopy } from '../../utils/metaConnect';
import { launchCreate, launchActivate, launchPause, launchStop } from '../../utils/metaLaunch';
import { consoleSession, fetchMyTeamRow } from '../../utils/consoleService';
import { sendOtp } from '../../utils/otpService';

/**
 * Manage → Ads → Create campaign.
 *
 * Product → goal → budget (per day or total) → PocketLink builds the plan: the
 * campaign, who sees it, and AI-written ad words for the product. The merchant
 * picks or edits the words, picks a photo, reviews the ad preview and approves.
 * Approving creates everything PAUSED in Meta; nothing spends until they start
 * it with the code sent to their WhatsApp number. The server screens the words,
 * checks the photo is the store's own, and enforces every budget and spend rule.
 */

const money = (n, cur = 'INR') => (cur === 'INR' ? `₹${Number(n || 0).toLocaleString('en-IN')}` : `${Number(n || 0).toLocaleString('en-IN')} ${cur}`);

const ERR = {
  not_connected: 'Connect Meta on the Ads page first.',
  no_ad_account: 'No ad account connected — reconnect Meta and share an ad account.',
  ad_account_not_selected: 'Choose your ad account on the Ads page first.',
  reauth: 'Your Meta connection expired — reconnect on the Ads page.',
};

const COPY_ERR = {
  paid_plan_required: 'AI ad writing is available on paid plans, so your product details are used for the ad.',
  copy_not_configured: 'AI ad writing isn’t switched on yet, so your product details are used for the ad.',
  busy: 'PocketLink couldn’t write ad text just now, so your product details are used. You can type your own words below.',
  declined: 'PocketLink couldn’t write text for this product, so your product details are used. You can type your own words below.',
  no_suggestion: 'PocketLink couldn’t write text for this product, so your product details are used. You can type your own words below.',
  no_product: 'That product was not found.',
};

const GOALS = [
  { key: 'orders',   title: 'Get more orders',              desc: 'Reach people likely to buy',     Icon: ShoppingBag },
  { key: 'visitors', title: 'Get more store visitors',      desc: 'Send more people to your store', Icon: Users },
  { key: 'retarget', title: 'Bring back interested people', desc: 'Re-reach recent visitors',       Icon: Sparkles, soon: true },
  { key: 'promote',  title: 'Promote my business',          desc: 'Get seen by more people nearby', Icon: Megaphone },
];

const STAGES = ['product', 'goal', 'budget', 'plan'];
const STEP_LABEL = { product: 'Product', goal: 'Goal', budget: 'Budget', plan: 'Review' };
const GENDER_LABEL = { all: 'everyone', women: 'women', men: 'men' };
const LIMITS = { headline: 40, primaryText: 125, description: 30 };

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
        <ArrowLeft size={16} /> {stage === 'product' ? 'Back to Ads' : 'Back'}
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

const isPhoto = (u) => /^https:\/\//i.test(String(u || ''));

export default function BoostPanel({ config, pin, themeColor = '#0d9488', writesEnabled = false, onClose }) {
  const products = Array.isArray(config.products) ? config.products : [];
  const [stage, setStage] = useState('product');
  const [biz, setBiz] = useState({
    promote: 'recommended', productId: '', goal: 'orders',
    budgetType: 'daily', budgetMode: 'recommended', dailyBudget: 300, totalBudget: 2100, days: 7,
    audienceMode: 'auto', radiusKm: 25, ageMin: 18, ageMax: 65, gender: 'all',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [data, setData] = useState(null);            // preview response (incl. recommendation + resolved)
  const [copy, setCopy] = useState({ loading: false, forProduct: null, variants: [], audience: null, notes: '', error: '' });
  const [pick, setPick] = useState({ source: 'store', index: -1 });   // which words the ad uses
  const [edit, setEdit] = useState(null);                              // the merchant's own words, while editing
  const [imageUrl, setImageUrl] = useState(null);                      // a store photo the merchant picked
  const [showAdv, setShowAdv] = useState(false);
  const [showPayloads, setShowPayloads] = useState(false);
  const [canActivate, setCanActivate] = useState(false); // may SPEND without an OTP (staff admin)
  const [launch, setLaunch] = useState(null);            // { launchId, status, ids, busy, error, step }
  const [confirmSpend, setConfirmSpend] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [otp, setOtp] = useState({ sent: false, busy: false, error: '' });

  const set = (patch) => setBiz((f) => ({ ...f, ...patch }));

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // Staff only: a crm_team admin may enable spend without the one-time
        // code, because they operate stores on the merchant's behalf. The server
        // enforces this independently — this just picks which control to render.
        const s = await consoleSession();
        if (!s?.user) return;
        const row = await fetchMyTeamRow(s.user.id);
        if (alive && row?.role === 'admin') setCanActivate(true);
      } catch { /* not staff — the OTP path applies */ }
    })();
    return () => { alive = false; };
  }, []);

  async function sendActivationCode() {
    const phone = String(config.whatsappNumber || '').replace(/\D/g, '');
    if (phone.length < 10) { setOtp({ sent: false, busy: false, error: 'This store has no WhatsApp number saved. Add one in Settings.' }); return; }
    setOtp({ sent: false, busy: true, error: '' });
    try {
      await sendOtp(phone.length > 10 ? phone : `91${phone}`);
      setOtp({ sent: true, busy: false, error: '' });
    } catch (e) {
      setOtp({ sent: false, busy: false, error: e.message || 'Could not send the code. Try again.' });
    }
  }

  const wordsFor = (p, e, variants) => (e || (p.source === 'ai' && variants[p.index]) || null);

  // Build (or rebuild) the plan. `words` / `image` override the current choice;
  // null means "use the store's own details / product photo".
  async function buildPlan({ overrides = {}, words, image } = {}) {
    const b = { ...biz, ...overrides };
    if (Object.keys(overrides).length) setBiz(b);
    const lifetime = b.budgetType === 'lifetime';
    setErr(''); setBusy(true); setLaunch(null); setConfirmSpend(false); setOtpCode(''); setOtp({ sent: false, busy: false, error: '' });
    try {
      const d = await previewCampaign(config.slug, pin, {
        goal: b.goal, promote: b.promote, productId: b.productId,
        audienceMode: b.audienceMode, budgetMode: lifetime ? 'custom' : b.budgetMode,
        dailyBudget: lifetime ? Math.max(1, Math.floor(Number(b.totalBudget) / Math.max(1, Number(b.days)))) : Number(b.dailyBudget),
        days: Number(b.days), radiusKm: Number(b.radiusKm), ageMin: Number(b.ageMin), ageMax: Number(b.ageMax), gender: b.gender,
        budgetType: b.budgetType,
        copy: words === undefined ? wordsFor(pick, edit, copy.variants) : words,
        imageUrl: image === undefined ? imageUrl : image,
      });
      if (d?.error) { setErr(ERR[d.error] || 'Something went wrong. Try again.'); return null; }
      setData(d); setStage('plan');
      return d;
    } catch {
      setErr('Could not build your plan. Try again.');
      return null;
    } finally { setBusy(false); }
  }

  // First build from the budget step: plan, then AI words for the product the
  // plan promotes, then rebuild with the first suggestion so the preview shows it.
  async function buildWithAi() {
    const d = await buildPlan({ words: null, image: null });
    if (!d) return;
    const productId = d.recommendation?.promoting?.type === 'product' ? String(d.recommendation.promoting.id || '') : '';
    setPick({ source: 'store', index: -1 }); setEdit(null); setImageUrl(null);
    if (copy.forProduct === productId && copy.variants.length) {
      setPick({ source: 'ai', index: 0 });
      await buildPlan({ words: copy.variants[0], image: null });
      return;
    }
    setCopy({ loading: true, forProduct: productId, variants: [], audience: null, notes: '', error: '' });
    const r = await fetchAdCopy(config.slug, pin, productId);
    if (r?.error || !Array.isArray(r?.variants) || !r.variants.length) {
      setCopy({ loading: false, forProduct: productId, variants: [], audience: null, notes: '', error: COPY_ERR[r?.error] || COPY_ERR.no_suggestion });
      return;
    }
    setCopy({ loading: false, forProduct: productId, variants: r.variants, audience: r.audience || null, notes: r.notes || '', error: '' });
    setPick({ source: 'ai', index: 0 });
    await buildPlan({ words: r.variants[0], image: null });
  }

  function chooseWords(source, index = -1) {
    setPick({ source, index }); setEdit(null);
    buildPlan({ words: source === 'ai' ? copy.variants[index] : null });
  }

  function launchErr(r) {
    if (r.error === 'blocked') return 'Resolve the items above before creating.';
    if (r.error === 'failed') {
      const why = r.message ? ` Meta said: ${r.message}` : '';
      if (r.cleanedUp === false) return `Couldn’t finish at the ${r.step} step, and we could not remove ${(r.leftovers || []).join(', ')} — check Ads Manager.${why}`;
      return `Couldn’t create your campaign at the ${r.step} step. Nothing was left in your Meta account.${why}`;
    }
    if (r.error === 'uncertain') return 'Meta didn’t confirm part of this campaign. Anything it made is paused and spends nothing — check your campaigns in a minute before trying again.';
    if (r.error === 'partial') return `Created up to the ${r.step} step — tap create again to resume safely.`;
    if (r.error === 'in_progress') return 'This campaign is already being created — wait a moment.';
    if (r.error === 'writes_disabled') return 'Creating ads from PocketLink isn’t switched on for your store yet.';
    if (r.error === 'missing_permission') return 'Reconnect Meta and allow access to your ad account to create ads.';
    if (r.error === 'ad_account_unavailable') return 'Meta has restricted this ad account. Choose another on the Ads page.';
    if (r.error === 'automation_unavailable_now') return 'Meta didn’t respond. Try again in a minute.';
    if (r.error === 'pin') return 'That PIN was not accepted. Unlock this store again and retry.';
    if (r.error === 'otp_required') return 'Enter the code we sent to your WhatsApp number to start spending.';
    if (r.error === 'activation_disabled_in_this_environment') return 'Starting ads is switched off in this environment.';
    if (r.error === 'not_connected') return 'Meta isn’t connected for this store.';
    return r.message || 'That didn’t work. Try again.';
  }

  async function doLaunch() {
    const r = data?.resolved; if (!r) return;
    const launchId = launch?.launchId || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
    setLaunch({ launchId, busy: true, error: '' });
    try {
      const res = await launchCreate(config.slug, pin, launchId, {
        objective: r.objective, promote: r.promote, productId: r.productId,
        dailyBudget: r.dailyBudget, days: r.days, audienceStrategy: r.audienceStrategy,
        radiusKm: r.radiusKm, ageMin: r.ageMin, ageMax: r.ageMax, gender: r.gender,
        budgetType: r.budgetType, copy: r.copy, imageUrl: r.imageUrl,
        recommendation: data.recommendation, strategy_source: 'pocketlink_reco', experiment_id: launchId,
      });
      // A rolled-back failure left nothing in Meta, so the next attempt must be a
      // genuinely new launch. Dropping launchId makes the retry mint a fresh one.
      if (res?.error === 'failed') setLaunch({ step: res.step, error: launchErr(res) });
      else if (res?.error) setLaunch({ launchId, status: res.status || '', step: res.step, error: launchErr(res) });
      else setLaunch({ launchId, status: res.status, ids: res.ids, verified: res.verified, adsManagerUrl: res.adsManagerUrl });
    } catch (e) { setLaunch({ launchId, error: e.message || 'That didn’t work.' }); }
  }

  async function act(fn, code) {
    setLaunch((l) => ({ ...l, busy: true, error: '' }));
    try {
      const res = await fn(config.slug, pin, launch.launchId, code);
      setLaunch((l) => (res?.error ? { ...l, busy: false, error: launchErr(res) } : { ...l, busy: false, status: res.status }));
    } catch (e) { setLaunch((l) => ({ ...l, busy: false, error: e.message })); }
  }

  const idx = STAGES.indexOf(stage);
  function back() {
    if (idx > 0) setStage(STAGES[idx - 1]); else onClose();
  }

  const label = 'block text-xs font-semibold text-gray-600 mb-1.5';
  const input = 'w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-brand';
  const cardBtn = (on) => `w-full text-left rounded-2xl border p-4 transition active:scale-[0.99] ${on ? 'border-transparent text-white shadow-sm' : 'border-gray-200 bg-white hover:border-gray-300'}`;
  const primaryBtn = 'w-full py-3 rounded-xl text-white text-sm font-bold active:scale-[0.98] transition disabled:opacity-50';
  const shellProps = { stage, idx, themeColor, onBack: back };

  // ── Step 1 · Product ─────────────────────────────────────────────────────────
  if (stage === 'product') {
    const opts = [
      ['recommended', '⭐ Let PocketLink pick', 'We’ll advertise your best-seller'],
      ['store', 'Whole store', 'Show a range of what you sell'],
    ];
    const productChosen = biz.promote !== 'product' || Boolean(biz.productId);
    return (
      <Shell {...shellProps} title="What do you want to advertise?" sub="Pick a product — PocketLink writes the ad for it.">
        <div className="space-y-2.5">
          {opts.map(([v, t, d]) => (
            <button key={v} type="button" onClick={() => set({ promote: v, productId: '' })}
              className={cardBtn(biz.promote === v)} style={biz.promote === v ? { background: themeColor } : undefined}>
              <span className="block text-sm font-bold">{t}</span>
              <span className={`block text-xs ${biz.promote === v ? 'text-white/85' : 'text-gray-500'}`}>{d}</span>
            </button>
          ))}
          {products.length > 0 && <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest pt-1">Or choose a product</p>}
          <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
            {products.map((p) => {
              const on = biz.promote === 'product' && String(biz.productId) === String(p.id);
              return (
                <button key={p.id} type="button" onClick={() => set({ promote: 'product', productId: p.id })}
                  className={`w-full text-left rounded-xl border p-2.5 flex items-center gap-3 transition active:scale-[0.99] ${on ? 'border-transparent text-white shadow-sm' : 'border-gray-200 bg-white hover:border-gray-300'}`}
                  style={on ? { background: themeColor } : undefined}>
                  {p.image
                    ? <img src={p.image} alt="" className="w-10 h-10 rounded-lg object-cover flex-shrink-0" />
                    : <span className="w-10 h-10 rounded-lg bg-gray-100 grid place-items-center flex-shrink-0">🛍️</span>}
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-bold truncate">{p.name}</span>
                    {p.price ? <span className={`block text-xs ${on ? 'text-white/85' : 'text-gray-500'}`}>₹{p.price}</span> : null}
                  </span>
                  {on && <Check size={16} />}
                </button>
              );
            })}
          </div>
        </div>
        <button type="button" disabled={!productChosen} onClick={() => setStage('goal')} className={`${primaryBtn} mt-5`} style={{ background: themeColor }}>Continue</button>
      </Shell>
    );
  }

  // ── Step 2 · Goal ────────────────────────────────────────────────────────────
  if (stage === 'goal') {
    return (
      <Shell {...shellProps} title="What do you want?" sub="Pick the outcome you're after — PocketLink handles the how.">
        <div className="space-y-2.5">
          {GOALS.map(({ key, title, desc, Icon, soon }) => (
            <button key={key} type="button" disabled={soon}
              onClick={() => { set({ goal: key }); setStage('budget'); }}
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

  // ── Step 3 · Budget ──────────────────────────────────────────────────────────
  if (stage === 'budget') {
    const presets = [200, 500, 1000];
    const lifetime = biz.budgetType === 'lifetime';
    const perDay = lifetime ? Math.floor(Number(biz.totalBudget || 0) / Math.max(1, Number(biz.days || 1))) : 0;
    return (
      <Shell {...shellProps} title="How much do you want to spend?" sub="You approve the plan first, and nothing spends until you start the ad.">
        <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden text-xs font-bold w-full mb-3">
          {[['daily', 'Per day'], ['lifetime', 'Total budget']].map(([v, t]) => (
            <button key={v} type="button" onClick={() => set({ budgetType: v })}
              className={`flex-1 px-3 py-2 ${biz.budgetType === v ? 'text-white' : 'text-gray-500 bg-white'}`}
              style={biz.budgetType === v ? { background: themeColor } : undefined}>{t}</button>
          ))}
        </div>

        {!lifetime ? (
          <div className="space-y-2.5">
            <button type="button" onClick={() => set({ budgetMode: 'recommended' })}
              className={cardBtn(biz.budgetMode === 'recommended')} style={biz.budgetMode === 'recommended' ? { background: themeColor } : undefined}>
              <span className="block text-sm font-bold">Recommended</span>
              <span className={`block text-xs ${biz.budgetMode === 'recommended' ? 'text-white/85' : 'text-gray-500'}`}>PocketLink picks a sensible starting budget for your goal.</span>
            </button>
            <div className="grid grid-cols-3 gap-2.5">
              {presets.map((amt) => {
                const on = biz.budgetMode === 'preset' && Number(biz.dailyBudget) === amt;
                return (
                  <button key={amt} type="button" onClick={() => set({ budgetMode: 'preset', dailyBudget: amt })}
                    className={`rounded-xl border p-3 text-center transition ${on ? 'text-white' : 'border-gray-200 bg-white hover:border-gray-300'}`}
                    style={on ? { background: themeColor } : undefined}>
                    <span className="block text-sm font-bold">₹{amt}</span><span className="block text-[10px] opacity-80">/day</span>
                  </button>
                );
              })}
            </div>
            <button type="button" onClick={() => set({ budgetMode: 'custom' })}
              className={cardBtn(biz.budgetMode === 'custom')} style={biz.budgetMode === 'custom' ? { background: themeColor } : undefined}>
              <span className="block text-sm font-bold">Custom amount</span>
            </button>
            <div className="grid grid-cols-2 gap-3">
              {biz.budgetMode === 'custom' && (
                <div><label htmlFor="boost-daily" className={label}>Per day (₹)</label>
                  <input id="boost-daily" type="number" min={1} inputMode="numeric" value={biz.dailyBudget} onChange={(e) => set({ dailyBudget: e.target.value.replace(/[^0-9]/g, '') })} className={input} /></div>
              )}
              <div className={biz.budgetMode === 'custom' ? '' : 'col-span-2'}><label htmlFor="boost-days" className={label}>Run for (days)</label>
                <input id="boost-days" type="number" min={1} max={30} inputMode="numeric" value={biz.days} onChange={(e) => set({ days: e.target.value.replace(/[^0-9]/g, '') })} className={input} /></div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div><label htmlFor="boost-total" className={label}>Total budget (₹)</label>
              <input id="boost-total" type="number" min={1} inputMode="numeric" value={biz.totalBudget} onChange={(e) => set({ totalBudget: e.target.value.replace(/[^0-9]/g, '') })} className={input} /></div>
            <div><label htmlFor="boost-days-total" className={label}>Run for (days)</label>
              <input id="boost-days-total" type="number" min={1} max={30} inputMode="numeric" value={biz.days} onChange={(e) => set({ days: e.target.value.replace(/[^0-9]/g, '') })} className={input} /></div>
            <p className="col-span-2 text-[11px] text-gray-500">About ₹{perDay.toLocaleString('en-IN')} a day. Meta spreads the total across the days and stops at the end date.</p>
          </div>
        )}
        {err && <p className="text-xs text-red-600 mt-3">{err}</p>}
        <button type="button" onClick={buildWithAi} disabled={busy} className={`${primaryBtn} mt-5`} style={{ background: themeColor }}>
          {busy ? 'Building your ad…' : 'Build my ad'}
        </button>
      </Shell>
    );
  }

  // ── Step 4 · Review ──────────────────────────────────────────────────────────
  const d = data || {};
  const rec = d.recommendation || {};
  const cur = d.currency || 'INR';
  const c = d.creative || {};
  const blockers = d.launchBlockers || [];
  const warnings = d.warnings || [];
  const R = rec.reasons || {};
  const st = launch?.status;
  const promotedProduct = rec.promoting?.type === 'product' ? products.find((p) => String(p.id) === String(rec.promoting.id)) || null : null;
  const photos = [...new Set([promotedProduct?.image, ...(Array.isArray(promotedProduct?.images) ? promotedProduct.images : []), config.coverImage].filter(isPhoto))].slice(0, 6);
  const suggestion = copy.audience;
  const suggestionDiffers = suggestion && (Number(suggestion.ageMin) !== Number(biz.ageMin) || Number(suggestion.ageMax) !== Number(biz.ageMax) || suggestion.gender !== biz.gender);
  const budgetText = d.budget
    ? (data?.resolved?.budgetType === 'lifetime'
      ? `${money(d.budget.total, cur)} over ${d.budget.days} ${Number(d.budget.days) === 1 ? 'day' : 'days'}`
      : `${money(d.budget.daily, cur)}/day · ${d.budget.days} ${Number(d.budget.days) === 1 ? 'day' : 'days'}`)
    : '—';

  return (
    <Shell {...shellProps} title="Here's the ad PocketLink built" sub="Review it — nothing is created until you approve, and nothing spends until you start it.">
      {rec.overall && (
        <div className="rounded-xl p-3.5 mb-4 text-sm" style={{ background: `${themeColor}0f`, border: `1px solid ${themeColor}33` }}>
          <p className="font-bold text-gray-900 flex items-center gap-1.5 mb-1"><Sparkles size={14} style={{ color: themeColor }} /> Why this plan</p>
          <p className="text-gray-700 text-[13px] leading-relaxed">{rec.overall}</p>
        </div>
      )}

      {/* Ad words */}
      <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-1.5">Ad words</p>
      <div className="space-y-2 mb-4">
        {copy.loading && (
          <p className="text-xs text-gray-500 flex items-center gap-1.5 rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5">
            <Sparkles size={13} style={{ color: themeColor }} /> PocketLink is writing your ad…
          </p>
        )}
        {!copy.loading && copy.error && <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 px-2 py-1 rounded-lg">{copy.error}</p>}
        {copy.variants.map((v, i) => {
          const on = pick.source === 'ai' && pick.index === i && !edit;
          return (
            <button key={i} type="button" disabled={busy} onClick={() => chooseWords('ai', i)}
              className={`w-full text-left rounded-xl border p-3 transition ${on ? 'border-transparent shadow-sm' : 'border-gray-200 bg-white hover:border-gray-300'}`}
              style={on ? { background: `${themeColor}14`, boxShadow: `inset 0 0 0 1.5px ${themeColor}` } : undefined}>
              <span className="flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wide text-gray-400 flex-1">{v.angle || `Option ${i + 1}`}</span>
                {on && <Check size={14} style={{ color: themeColor }} />}
              </span>
              <span className="block text-sm font-bold text-gray-900 mt-0.5">{v.headline}</span>
              <span className="block text-xs text-gray-600 mt-0.5">{v.primaryText}</span>
            </button>
          );
        })}
        <button type="button" disabled={busy} onClick={() => chooseWords('store')}
          className={`w-full text-left rounded-xl border p-3 transition ${pick.source === 'store' && !edit ? 'border-transparent shadow-sm' : 'border-gray-200 bg-white hover:border-gray-300'}`}
          style={pick.source === 'store' && !edit ? { background: `${themeColor}14`, boxShadow: `inset 0 0 0 1.5px ${themeColor}` } : undefined}>
          <span className="block text-sm font-bold text-gray-900">Use my product details</span>
          <span className="block text-xs text-gray-500">The product name, price and your shop line.</span>
        </button>

        {!edit ? (
          <button type="button" disabled={busy} onClick={() => setEdit({ headline: c.headline || '', primaryText: c.primaryText || '', description: c.description || '' })}
            className="text-[11px] font-semibold" style={{ color: themeColor }}>
            Write or edit the words myself
          </button>
        ) : (
          <div className="rounded-xl border border-gray-200 p-3 space-y-2.5">
            <div>
              <label htmlFor="boost-headline" className={label}>Headline <span className="text-gray-400 font-normal">· {edit.headline.length}/{LIMITS.headline}</span></label>
              <input id="boost-headline" maxLength={LIMITS.headline} value={edit.headline} onChange={(e) => setEdit((w) => ({ ...w, headline: e.target.value }))} className={input} />
            </div>
            <div>
              <label htmlFor="boost-primary" className={label}>Main text <span className="text-gray-400 font-normal">· {edit.primaryText.length}/{LIMITS.primaryText}</span></label>
              <textarea id="boost-primary" rows={3} maxLength={LIMITS.primaryText} value={edit.primaryText} onChange={(e) => setEdit((w) => ({ ...w, primaryText: e.target.value }))} className={input} />
            </div>
            <div>
              <label htmlFor="boost-description" className={label}>Short line <span className="text-gray-400 font-normal">· {edit.description.length}/{LIMITS.description}</span></label>
              <input id="boost-description" maxLength={LIMITS.description} value={edit.description} onChange={(e) => setEdit((w) => ({ ...w, description: e.target.value }))} className={input} />
            </div>
            <p className="text-[11px] text-gray-400">Links, phone numbers, and prices or offers your store details don’t show are removed before the ad is made.</p>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => { setEdit(null); buildPlan({ words: wordsFor(pick, null, copy.variants) }); }} className="py-2 rounded-lg border border-gray-300 text-sm font-semibold text-gray-600">Cancel</button>
              <button type="button" disabled={busy} onClick={() => buildPlan({ words: edit })} className="py-2 rounded-lg text-white text-sm font-bold disabled:opacity-50" style={{ background: themeColor }}>
                {busy ? 'Updating…' : 'Use these words'}
              </button>
            </div>
          </div>
        )}
        {copy.notes && <p className="text-[11px] text-gray-500 flex items-start gap-1.5"><Info size={12} className="mt-0.5 shrink-0" /> {copy.notes}</p>}
      </div>

      {/* Photo */}
      {photos.length > 1 && (
        <div className="mb-4">
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-1.5">Photo</p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {photos.map((u) => {
              const on = (c.imageUrl || '') === u;
              return (
                <button key={u} type="button" disabled={busy} onClick={() => { setImageUrl(u); buildPlan({ image: u }); }} aria-label="Use this photo"
                  className="w-16 h-16 rounded-xl overflow-hidden flex-shrink-0 border-2 transition" style={{ borderColor: on ? themeColor : '#e5e7eb' }}>
                  <img src={u} alt="" className="w-full h-full object-cover" />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Audience suggestion */}
      {suggestionDiffers && (
        <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-3 mb-4 flex items-start gap-3">
          <Users size={16} className="text-gray-400 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-gray-800">PocketLink suggests showing this to <b>{GENDER_LABEL[suggestion.gender] || 'everyone'}</b> aged <b>{suggestion.ageMin}–{suggestion.ageMax}</b>.</p>
            {suggestion.why && <p className="text-[11px] text-gray-500 mt-0.5">{suggestion.why}</p>}
          </div>
          <button type="button" disabled={busy} onClick={() => buildPlan({ overrides: { ageMin: suggestion.ageMin, ageMax: suggestion.ageMax, gender: suggestion.gender } })}
            className="text-xs font-bold text-white px-3 py-1.5 rounded-lg shrink-0 disabled:opacity-50" style={{ background: themeColor }}>Use this</button>
        </div>
      )}

      {/* Ad preview */}
      <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-1.5">Ad preview</p>
      <div className={`rounded-xl border border-gray-200 bg-white overflow-hidden max-w-sm mb-4 ${busy ? 'opacity-60' : ''}`}>
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
            {c.description && <p className="text-[11px] text-gray-500 truncate">{c.description}</p>}
          </div>
          <span className="text-[12px] font-bold text-gray-700 border border-gray-300 rounded-lg px-3 py-1.5 whitespace-nowrap">{String(c.cta || 'SHOP_NOW').replace(/_/g, ' ').toLowerCase().replace(/^\w/, (m) => m.toUpperCase())}</span>
        </div>
      </div>

      {/* The plan — business language, each line with its reason */}
      <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-3.5 space-y-0">
        <Row k="Goal" v={rec.goal?.title || '—'} />
        <Row k="Promoting" v={rec.promoting?.name || (c.promote === 'product' ? c.productName : 'Your store')} />
        <Row k="Who we reach" v={`${d.targeting?.resolved ? d.targeting.label : 'your area'} · Age ${d.targeting?.ageMin}–${d.targeting?.ageMax}${d.targeting?.genderLabel && d.targeting.genderLabel !== 'All' ? ` · ${d.targeting.genderLabel}` : ''}`} />
        <Row k="Strategy" v={d.targeting?.strategyLabel || 'PocketLink finds buyers'} />
        <Row k="Budget" v={budgetText} />
        {/* Say what enforces the ceiling. A daily budget is an average, so the
            total can vary a little; a total budget stops at the end date. */}
        <Row k="Up to" v={<span><b>{money(d.budget?.total, cur)}</b><span className="text-gray-400 font-normal"> · {data?.resolved?.budgetType === 'lifetime' ? 'stops at this total or on the end date' : 'daily budgets vary a little day to day'}</span></span>} />
        <Row k="Facebook Page" v={d.page ? d.page.name : <span className="text-amber-600">none — choose one on the Ads page</span>} />
        <Row k="Button" v={`${String(c.cta || 'SHOP_NOW').replace(/_/g, ' ').toLowerCase()} → ${c.destinationLabel || 'Your PocketLink shop'}`} last />
      </div>

      <div className="mt-3 space-y-1.5">
        {[['Goal', R.goal], ['Promoting', R.promoting], ['Audience', R.audience], ['Optimising', R.optimization], ['Budget', R.budget]]
          .filter(([, v]) => v)
          .map(([k, v]) => <p key={k} className="text-[11px] text-gray-500 leading-snug"><b className="text-gray-600">{k}:</b> {v}</p>)}
      </div>

      {blockers.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3.5 mt-3">
          <p className="text-sm font-bold text-red-700 flex items-center gap-1.5"><AlertTriangle size={15} /> Fix before this can run</p>
          <ul className="mt-1.5 space-y-1 text-xs text-red-700/90 list-disc pl-4">{blockers.map((b, i) => <li key={i}>{b}</li>)}</ul>
        </div>
      )}
      {warnings.length > 0 && (
        <ul className="mt-2 space-y-1 text-[11px] text-gray-500 list-disc pl-4">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
      )}
      {err && <p className="text-xs text-red-600 mt-3">{err}</p>}

      {/* Advanced controls — collapsed by default */}
      <div className="mt-3 border border-gray-200 rounded-xl overflow-hidden">
        <button type="button" onClick={() => setShowAdv((v) => !v)} className="w-full flex items-center justify-between px-3.5 py-2.5 text-sm font-semibold text-gray-600 bg-gray-50/60">
          <span>Change who sees it</span> {showAdv ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        {showAdv && (
          <div className="p-3.5 space-y-3 text-sm border-t border-gray-100">
            <p className="text-[11px] text-gray-400 flex items-start gap-1.5"><Info size={12} className="mt-0.5 shrink-0" /> PocketLink chose these for you. Change them, then update the plan.</p>
            <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden text-xs font-semibold w-full">
              {[['auto', 'PocketLink finds buyers'], ['manual', 'Only my settings']].map(([v, t]) => (
                <button key={v} type="button" onClick={() => set({ audienceMode: v })}
                  className={`flex-1 px-2.5 py-2 ${biz.audienceMode === v ? 'text-white' : 'text-gray-500 bg-white'}`} style={biz.audienceMode === v ? { background: themeColor } : undefined}>{t}</button>
              ))}
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-gray-500">Around {config.city || 'your area'}</span>
              <select value={biz.radiusKm} onChange={(e) => set({ radiusKm: Number(e.target.value) })} aria-label="Distance" className="text-xs rounded-lg border border-gray-200 bg-white px-2 py-1.5">
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
                <input type="number" min={18} max={65} inputMode="numeric" aria-label="Youngest age" value={biz.ageMin} onChange={(e) => set({ ageMin: e.target.value.replace(/[^0-9]/g, '') })} className="w-14 px-2 py-1.5 text-xs rounded-lg border border-gray-200" />
                <span className="text-gray-400 text-xs">to</span>
                <input type="number" min={18} max={65} inputMode="numeric" aria-label="Oldest age" value={biz.ageMax} onChange={(e) => set({ ageMax: e.target.value.replace(/[^0-9]/g, '') })} className="w-14 px-2 py-1.5 text-xs rounded-lg border border-gray-200" />
              </div>
            </div>
            <button type="button" onClick={() => buildPlan()} disabled={busy} className="w-full py-2 rounded-lg border border-gray-300 text-sm font-semibold text-gray-700 disabled:opacity-50">
              {busy ? 'Updating…' : 'Update plan'}
            </button>
            <button type="button" onClick={() => setShowPayloads((v) => !v)} className="text-[11px] font-semibold text-gray-400 hover:text-gray-600">
              {showPayloads ? 'Hide' : 'Show'} technical details (nothing is sent to Meta)
            </button>
            {showPayloads && <pre className="text-[10px] bg-gray-900 text-gray-100 rounded-lg p-3 overflow-x-auto">{JSON.stringify(d.payloads, null, 2)}</pre>}
          </div>
        )}
      </div>

      <div className="mt-4">
        {writesEnabled ? (
          <LaunchControls
            ready={d.launchReady && !busy && !copy.loading} launch={launch} status={st}
            confirmSpend={confirmSpend} setConfirmSpend={setConfirmSpend} canActivate={canActivate}
            otpCode={otpCode} setOtpCode={setOtpCode} otp={otp} sendActivationCode={sendActivationCode}
            doLaunch={doLaunch} act={act} themeColor={themeColor} money={(n) => money(n, cur)} total={d.budget?.total}
          />
        ) : (
          <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 px-2 py-1.5 rounded-lg">
            Creating ads from PocketLink is opening for your store soon. You can review your plan now.
          </p>
        )}
      </div>
    </Shell>
  );
}

// Approve → created PAUSED → confirm → Start → Pause / Stop.
function LaunchControls({ ready, launch, status, confirmSpend, setConfirmSpend, doLaunch, act, themeColor, money, total, canActivate, otpCode, setOtpCode, otp, sendActivationCode }) {
  const btn = 'w-full py-3 rounded-xl text-sm font-bold active:scale-[0.98] transition disabled:opacity-50';
  const busy = launch?.busy;
  if (!status) {
    return (
      <div>
        <button type="button" disabled={!ready || busy} onClick={doLaunch} className={`${btn} text-white`} style={{ background: themeColor }}>
          {busy ? 'Creating your ad in Meta (paused)…' : 'Approve — create the ad, paused'}
        </button>
        {launch?.error && <p className="text-xs text-red-600 mt-2">{launch.error}</p>}
        <p className="text-[11px] text-gray-400 text-center mt-2">Approving makes the ad in your Meta account, paused. It spends nothing until you start it.</p>
      </div>
    );
  }
  if (status === 'active') {
    return (
      <div className="space-y-2">
        <p className="text-sm font-bold text-green-700 flex items-center gap-1.5"><Check size={15} /> Running — spending now</p>
        <div className="grid grid-cols-2 gap-2.5">
          <button type="button" disabled={busy} onClick={() => act(launchPause)} className={`${btn} border border-gray-300 text-gray-700`}>Pause</button>
          <button type="button" disabled={busy} onClick={() => act(launchStop)} className={`${btn} border border-red-300 text-red-600`}>Stop</button>
        </div>
        {launch?.error && <p className="text-xs text-red-600">{launch.error}</p>}
      </div>
    );
  }
  if (status === 'stopped') return <p className="text-sm font-bold text-gray-500 flex items-center gap-1.5"><Check size={15} /> Stopped — kept in your campaigns.</p>;
  return (
    <div className="space-y-2.5">
      <p className="text-sm font-bold text-gray-800">
        {status === 'paused' ? 'Paused'
          : launch?.verified?.allPaused ? 'Created in Meta — checked: paused, no spend ✓'
          : launch?.verified ? 'Created in Meta — we could not confirm every part is paused'
          : 'Created — paused, no spend yet'}
      </p>
      {launch?.adsManagerUrl && (
        <p className="text-[11px] text-gray-500"><a href={launch.adsManagerUrl} target="_blank" rel="noopener noreferrer" className="font-semibold underline">Open in Ads Manager</a></p>
      )}
      <label className="flex items-start gap-2 text-xs text-gray-600 bg-amber-50 border border-amber-200 rounded-xl p-3">
        <input type="checkbox" checked={confirmSpend} onChange={(e) => setConfirmSpend(e.target.checked)} className="mt-0.5" />
        <span>I understand starting this ad spends real money, up to about <b>{money(total)}</b> over the run.</span>
      </label>
      {!canActivate && (
        <div>
          {!otp.sent ? (
            <button type="button" disabled={otp.busy || !confirmSpend} onClick={sendActivationCode} className={`${btn} border border-gray-300 text-gray-700`}>
              {otp.busy ? 'Sending code…' : 'Send confirmation code to my WhatsApp'}
            </button>
          ) : (
            <>
              <label htmlFor="boost-otp" className="block text-xs font-semibold text-gray-600 mb-1.5">Enter the code we just sent on WhatsApp</label>
              <input id="boost-otp" inputMode="numeric" value={otpCode} placeholder="6-digit code"
                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm tracking-[0.3em] text-center text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-brand" />
              <button type="button" onClick={sendActivationCode} disabled={otp.busy} className="text-[11px] font-semibold text-gray-400 hover:text-gray-600 mt-1.5">Didn’t get it? Send again</button>
            </>
          )}
          {otp.error && <p className="text-xs text-red-600 mt-1.5">{otp.error}</p>}
          <p className="text-[11px] text-gray-400 mt-1.5">Spending money needs more than your PIN, so we confirm on the number this store is registered with.</p>
        </div>
      )}
      <button type="button" disabled={!confirmSpend || busy || (!canActivate && (!otp.sent || otpCode.length < 4))}
        onClick={() => act(launchActivate, otpCode)} className={`${btn} text-white`} style={{ background: themeColor }}>
        {busy ? 'Starting…' : 'Start — begin spending'}
      </button>
      <button type="button" disabled={busy} onClick={() => act(launchStop)} className={`${btn} border border-gray-300 text-gray-600`}>Stop</button>
      {launch?.error && <p className="text-xs text-red-600">{launch.error}</p>}
    </div>
  );
}

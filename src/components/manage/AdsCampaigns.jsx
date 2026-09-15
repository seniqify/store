import { useState, useEffect } from 'react';
import { RefreshCw, TrendingUp, AlertTriangle, Check } from 'lucide-react';
import { launchList, launchPause, launchResume, launchActivate, launchUpdateBudget, launchUpdateTargeting, launchErrors } from '../../utils/metaLaunch';
import { sendOtp } from '../../utils/otpService';

/**
 * Manage → Ads → campaigns created from PocketLink.
 *
 * Start (needs the WhatsApp code), pause, change budget, change who sees the ad,
 * and check for problems. Every rule — PIN, spend confirmation, budget caps,
 * the pilot switch — is enforced by the server; this screen only asks.
 */

const money = (n, cur = 'INR') => (cur === 'INR' ? `₹${Number(n || 0).toLocaleString('en-IN')}` : `${Number(n || 0).toLocaleString('en-IN')} ${cur}`);

const STATUS = {
  creating: ['Setting up', 'bg-gray-100 text-gray-500'],
  created: ['Ready to start', 'bg-amber-100 text-amber-700'],
  partial: ['Needs attention', 'bg-red-100 text-red-700'],
  failed: ['Not created', 'bg-red-100 text-red-700'],
  active: ['Running', 'bg-green-100 text-green-700'],
  paused: ['Paused', 'bg-gray-100 text-gray-600'],
  stopped: ['Stopped', 'bg-gray-100 text-gray-500'],
};

const ERR = {
  writes_disabled: 'Changing ads from PocketLink isn’t switched on for your store yet.',
  otp_required: 'Enter the code we sent to your WhatsApp number to continue.',
  over_cap: 'That budget is above PocketLink’s limit (₹5,000 a day, or ₹25,000 in total).',
  invalid_budget: 'Enter a budget above ₹0.',
  budget_type_fixed: 'This campaign’s budget type can’t be changed. Create a new campaign instead.',
  activation_disabled_in_this_environment: 'Starting ads is switched off in this preview.',
  not_connected: 'Meta isn’t connected for this store.',
  automation_unavailable_now: 'Meta didn’t respond. Try again in a minute.',
  no_location: 'Set your city in Settings so PocketLink knows where to show your ad.',
  not_created: 'This campaign was not fully created.',
  pin: 'That PIN was not accepted. Unlock the store again.',
};
const errText = (r) => ERR[r?.error] || r?.message || 'Something went wrong. Try again.';

const btn = 'text-xs font-bold px-3 py-1.5 rounded-lg border transition active:scale-[0.98] disabled:opacity-50';
const input = 'w-full px-3 py-2 rounded-xl border border-gray-200 text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-brand';

// The WhatsApp one-time code, used to start an ad or raise a running budget.
function CodeStep({ config, code, setCode }) {
  const [otp, setOtp] = useState({ sent: false, busy: false, error: '' });
  async function send() {
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
  return (
    <div>
      {!otp.sent ? (
        <button type="button" onClick={send} disabled={otp.busy} className={`${btn} border-gray-300 text-gray-700 w-full py-2.5`}>
          {otp.busy ? 'Sending code…' : 'Send confirmation code to my WhatsApp'}
        </button>
      ) : (
        <>
          <input inputMode="numeric" value={code} placeholder="6-digit code" aria-label="WhatsApp code"
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            className={`${input} tracking-[0.3em] text-center`} />
          <button type="button" onClick={send} disabled={otp.busy} className="text-[11px] font-semibold text-gray-400 hover:text-gray-600 mt-1.5">Didn’t get it? Send again</button>
        </>
      )}
      {otp.error && <p className="text-xs text-red-600 mt-1.5">{otp.error}</p>}
    </div>
  );
}

function LaunchCard({ launch, config, pin, themeColor, canWrite, onChanged }) {
  const [panel, setPanel] = useState(null);   // 'start' | 'budget' | 'audience' | 'problems'
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ error: '', ok: '' });
  const [confirm, setConfirm] = useState(false);
  const [code, setCode] = useState('');
  const [needsCode, setNeedsCode] = useState(false);
  const [amount, setAmount] = useState(String(launch.budgetType === 'daily' ? launch.dailyBudget ?? '' : launch.lifetimeBudget ?? ''));
  const [aud, setAud] = useState({ ageMin: launch.targeting?.age?.min ?? 18, ageMax: launch.targeting?.age?.max ?? 65, gender: 'all', radiusKm: 25, audienceStrategy: launch.targeting?.strategy === 'manual' ? 'manual' : 'auto' });
  const [problems, setProblems] = useState(null);

  const cur = launch.currency || 'INR';
  const [label, chip] = STATUS[launch.status] || [launch.status, 'bg-gray-100 text-gray-500'];
  const total = launch.budgetType === 'daily' ? Number(launch.dailyBudget || 0) * Number(launch.days || 0) : Number(launch.lifetimeBudget || 0);
  const budgetLabel = launch.budgetType === 'daily' ? `${money(launch.dailyBudget, cur)} a day` : `${money(launch.lifetimeBudget, cur)} in total`;

  const open = (p) => { setPanel((cur2) => (cur2 === p ? null : p)); setMsg({ error: '', ok: '' }); setNeedsCode(false); setCode(''); setConfirm(false); };

  async function run(fn, okText) {
    setBusy(true); setMsg({ error: '', ok: '' });
    try {
      const r = await fn();
      if (r?.error === 'otp_required') { setNeedsCode(true); setMsg({ error: errText(r), ok: '' }); return false; }
      if (r?.error) { setMsg({ error: errText(r), ok: '' }); return false; }
      setMsg({ error: '', ok: r?.pending ? `${okText} Meta is reviewing the change.` : okText });
      await onChanged?.();
      return r;
    } catch (e) {
      setMsg({ error: e.message || 'Something went wrong. Try again.', ok: '' });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    const resume = launch.status === 'paused' && launch.activatedAt;
    const ok = await run(() => (resume ? launchResume : launchActivate)(config.slug, pin, launch.launchId, code), 'Your ad is starting.');
    if (ok) setPanel(null);
  }
  async function pause() { await run(() => launchPause(config.slug, pin, launch.launchId), 'Paused — no more spending.'); }
  async function saveBudget() {
    const ok = await run(() => launchUpdateBudget(config.slug, pin, launch.launchId, { budgetType: launch.budgetType, amount: Number(amount), otpCode: needsCode ? code : undefined }), 'Budget updated.');
    if (ok) setPanel(null);
  }
  async function saveAudience() {
    const ok = await run(() => launchUpdateTargeting(config.slug, pin, launch.launchId, { ...aud, ageMin: Number(aud.ageMin), ageMax: Number(aud.ageMax), radiusKm: Number(aud.radiusKm) }), 'Audience updated.');
    if (ok) setPanel(null);
  }
  async function checkProblems() {
    setPanel('problems'); setProblems(null); setMsg({ error: '', ok: '' });
    const r = await launchErrors(config.slug, pin, launch.launchId).catch(() => ({ error: 'server' }));
    if (r?.error) { setMsg({ error: errText(r), ok: '' }); setProblems([]); } else setProblems(r.errors || []);
  }

  const canStart = canWrite && (launch.status === 'created' || launch.status === 'paused');
  const canEdit = canWrite && ['created', 'active', 'paused'].includes(launch.status);

  return (
    <div className="rounded-xl border border-gray-100 bg-white p-3.5">
      <div className="flex items-start gap-3">
        {launch.imageUrl
          ? <img src={launch.imageUrl} alt="" className="w-12 h-12 rounded-lg object-cover flex-shrink-0 border border-gray-100" />
          : <div className="w-12 h-12 rounded-lg bg-gray-50 grid place-items-center text-lg flex-shrink-0">📣</div>}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-bold text-gray-900 truncate flex-1">{launch.headline || launch.product || 'Your campaign'}</p>
            <span className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${chip}`}>{label}</span>
          </div>
          <p className="text-[11px] text-gray-400 mt-0.5">
            {budgetLabel}{launch.days ? ` · ${launch.days} days` : ''}{launch.targeting?.location ? ` · ${launch.targeting.location}` : ''}
          </p>
        </div>
      </div>

      {(launch.status === 'partial' || launch.status === 'failed') && launch.error && (
        <p className="text-[11px] text-red-600 mt-2 break-words">Meta said: {launch.error}</p>
      )}

      <div className="flex flex-wrap gap-2 mt-3">
        {launch.status === 'active' && (
          <button type="button" disabled={busy} onClick={pause} className={`${btn} border-gray-300 text-gray-700`}>Pause</button>
        )}
        {canStart && (
          <button type="button" disabled={busy} onClick={() => open('start')} className={`${btn} text-white border-transparent`} style={{ background: themeColor }}>
            {launch.status === 'paused' && launch.activatedAt ? 'Resume' : 'Start ad'}
          </button>
        )}
        {canEdit && <button type="button" disabled={busy} onClick={() => open('budget')} className={`${btn} border-gray-200 text-gray-600`}>Budget</button>}
        {canEdit && <button type="button" disabled={busy} onClick={() => open('audience')} className={`${btn} border-gray-200 text-gray-600`}>Audience</button>}
        {launch.ids?.campaign_id && <button type="button" disabled={busy} onClick={checkProblems} className={`${btn} border-gray-200 text-gray-600`}>Check for problems</button>}
      </div>

      {panel === 'start' && (
        <div className="mt-3 space-y-2.5">
          <label className="flex items-start gap-2 text-xs text-gray-600 bg-amber-50 border border-amber-200 rounded-xl p-3">
            <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} className="mt-0.5" />
            <span>I understand starting this ad spends real money{total ? <>, up to about <b>{money(total, cur)}</b> over the run</> : null}.</span>
          </label>
          {confirm && <CodeStep config={config} code={code} setCode={setCode} />}
          <button type="button" disabled={!confirm || busy || code.length < 4} onClick={start}
            className="w-full py-2.5 rounded-xl text-white text-sm font-bold active:scale-[0.98] transition disabled:opacity-50" style={{ background: themeColor }}>
            {busy ? 'Starting…' : 'Start — begin spending'}
          </button>
        </div>
      )}

      {panel === 'budget' && (
        <div className="mt-3 space-y-2.5">
          <label htmlFor={`budget-${launch.launchId}`} className="block text-xs font-semibold text-gray-600">
            {launch.budgetType === 'daily' ? 'Budget per day (₹)' : 'Total budget (₹)'}
          </label>
          <input id={`budget-${launch.launchId}`} type="number" min={1} inputMode="numeric" value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))} className={input} />
          {needsCode && <CodeStep config={config} code={code} setCode={setCode} />}
          <button type="button" disabled={busy || !Number(amount) || (needsCode && code.length < 4)} onClick={saveBudget}
            className="w-full py-2.5 rounded-xl text-white text-sm font-bold active:scale-[0.98] transition disabled:opacity-50" style={{ background: themeColor }}>
            {busy ? 'Saving…' : 'Save budget'}
          </button>
          <p className="text-[11px] text-gray-400">Raising the budget of a running ad asks for your WhatsApp code.</p>
        </div>
      )}

      {panel === 'audience' && (
        <div className="mt-3 space-y-2.5 rounded-xl border border-gray-200 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-gray-500">Who finds buyers</span>
            <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden text-xs font-semibold">
              {[['auto', 'PocketLink'], ['manual', 'Only my settings']].map(([v, t]) => (
                <button key={v} type="button" onClick={() => setAud((a) => ({ ...a, audienceStrategy: v }))}
                  className={`px-2.5 py-1.5 ${aud.audienceStrategy === v ? 'text-white' : 'text-gray-500 bg-white'}`} style={aud.audienceStrategy === v ? { background: themeColor } : undefined}>{t}</button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-gray-500">Around {config.city || 'your area'}</span>
            <select value={aud.radiusKm} onChange={(e) => setAud((a) => ({ ...a, radiusKm: Number(e.target.value) }))} aria-label="Distance" className="text-xs rounded-lg border border-gray-200 bg-white px-2 py-1.5">
              {[10, 25, 40].map((km) => <option key={km} value={km}>{km} km</option>)}
            </select>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-gray-500">Show to</span>
            <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden text-xs font-semibold">
              {[['all', 'Everyone'], ['women', 'Women'], ['men', 'Men']].map(([v, t]) => (
                <button key={v} type="button" onClick={() => setAud((a) => ({ ...a, gender: v }))}
                  className={`px-2.5 py-1.5 ${aud.gender === v ? 'text-white' : 'text-gray-500 bg-white'}`} style={aud.gender === v ? { background: themeColor } : undefined}>{t}</button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-gray-500">Age</span>
            <div className="flex items-center gap-1.5">
              <input type="number" min={18} max={65} inputMode="numeric" aria-label="Youngest age" value={aud.ageMin} onChange={(e) => setAud((a) => ({ ...a, ageMin: e.target.value.replace(/[^0-9]/g, '') }))} className="w-14 px-2 py-1.5 text-xs rounded-lg border border-gray-200" />
              <span className="text-gray-400 text-xs">to</span>
              <input type="number" min={18} max={65} inputMode="numeric" aria-label="Oldest age" value={aud.ageMax} onChange={(e) => setAud((a) => ({ ...a, ageMax: e.target.value.replace(/[^0-9]/g, '') }))} className="w-14 px-2 py-1.5 text-xs rounded-lg border border-gray-200" />
            </div>
          </div>
          <button type="button" disabled={busy} onClick={saveAudience}
            className="w-full py-2.5 rounded-xl text-white text-sm font-bold active:scale-[0.98] transition disabled:opacity-50" style={{ background: themeColor }}>
            {busy ? 'Saving…' : 'Save audience'}
          </button>
        </div>
      )}

      {panel === 'problems' && (
        <div className="mt-3">
          {problems === null ? (
            <p className="text-xs text-gray-400 flex items-center gap-1.5"><RefreshCw size={12} className="animate-spin" /> Checking with Meta…</p>
          ) : problems.length === 0 && !msg.error ? (
            <p className="text-xs text-green-700 flex items-center gap-1.5"><Check size={13} /> No problems found.</p>
          ) : (
            <ul className="space-y-1.5">
              {problems.map((p, i) => (
                <li key={i} className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg px-2.5 py-1.5">
                  <b className="flex items-center gap-1"><AlertTriangle size={12} /> {p.title}</b>
                  {p.message && <span className="block mt-0.5">{p.message}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {msg.error && <p className="text-xs text-red-600 mt-2">{msg.error}</p>}
      {msg.ok && <p className="text-xs text-green-700 mt-2">{msg.ok}</p>}
    </div>
  );
}

export default function AdsCampaigns({ config, pin, themeColor = '#0d9488', canWrite = false, refreshKey = 0 }) {
  const [reload, setReload] = useState(0);
  const [state, setState] = useState({ loading: true, launches: [], error: '' });

  useEffect(() => {
    let alive = true;
    (async () => {
      let r;
      try { r = await launchList(config.slug, pin); } catch { r = { error: 'server' }; }
      if (!alive) return;
      setState({ loading: false, launches: Array.isArray(r?.launches) ? r.launches : [], error: r?.error ? errText(r) : '' });
    })();
    return () => { alive = false; };
  }, [config.slug, pin, refreshKey, reload]);

  const refresh = async () => { setReload((n) => n + 1); };

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <TrendingUp size={14} className="text-gray-400" />
        <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest flex-1">Your PocketLink campaigns</p>
        <button type="button" onClick={refresh} aria-label="Refresh campaigns" className="w-7 h-7 rounded-lg border border-gray-200 flex items-center justify-center text-gray-500 hover:bg-gray-50">
          <RefreshCw size={13} className={state.loading ? 'animate-spin' : ''} />
        </button>
      </div>
      {state.loading ? (
        <div className="flex items-center justify-center py-8 text-gray-400 text-sm gap-2"><RefreshCw size={15} className="animate-spin" /> Loading campaigns…</div>
      ) : state.error ? (
        <p className="text-xs text-red-600">{state.error}</p>
      ) : state.launches.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50/60 p-6 text-center">
          <p className="text-sm font-semibold text-gray-600">No campaigns from PocketLink yet</p>
          <p className="text-xs text-gray-400 mt-1">Create one above — it’s saved paused, and nothing runs until you start it.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {state.launches.map((l) => (
            <LaunchCard key={l.launchId} launch={l} config={config} pin={pin} themeColor={themeColor} canWrite={canWrite} onChanged={refresh} />
          ))}
        </div>
      )}
      {!canWrite && state.launches.length > 0 && (
        <p className="text-[11px] text-gray-400 mt-2">You can pause your ads here. Starting and editing ads from PocketLink is opening for your store soon.</p>
      )}
    </div>
  );
}

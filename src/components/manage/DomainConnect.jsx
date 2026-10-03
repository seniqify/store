import { useEffect, useRef, useState } from 'react';
import { Check, Copy, ShieldCheck } from 'lucide-react';
import { manageDomain, domainMessage, otherName, txtPanelName } from '../../utils/domainsApi';

/**
 * Settings → Your own domain. Walks the owner through connecting a domain they
 * own -- the server's own flow (called through src/utils/domainsApi.js) step by step:
 *   none → claim → [1] TXT record → verify → [2] DNS records → refresh →
 *   [3] WhatsApp code → activate → live.  Live: disconnect / use www as main.
 * Every change is PIN-checked server-side; going live, switching the main
 * address and disconnecting also need a WhatsApp code sent to the OWNER.
 *
 * Hidden entirely unless the server allows this store (`domainState.step`
 * 'hidden' while the feature is off or the store is not in the rollout list).
 */

function CopyValue({ value }) {
  const [copied, setCopied] = useState(false);
  return (
    <button type="button" title="Copy"
      onClick={() => navigator.clipboard?.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}
      className="flex-shrink-0 p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-white transition-colors">
      {copied ? <Check size={13} strokeWidth={3} /> : <Copy size={13} />}
    </button>
  );
}

function RecordTable({ records }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white divide-y divide-gray-100">
      {records.map((r, i) => (
        <div key={`${r.type}-${r.name}-${i}`} className="px-3 py-2 text-xs">
          <div className="flex items-center gap-2">
            <span className="w-12 flex-shrink-0 text-gray-400">Type</span>
            <span className="font-mono font-bold text-gray-900">{r.type}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-12 flex-shrink-0 text-gray-400">Name</span>
            <span className="font-mono text-gray-900 break-all flex-1">{r.name}</span>
            <CopyValue value={r.name} />
          </div>
          <div className="flex items-center gap-2">
            <span className="w-12 flex-shrink-0 text-gray-400">Value</span>
            <span className="font-mono text-gray-900 break-all flex-1">{r.value}</span>
            <CopyValue value={r.value} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** A DNS record's name as most panels want it: "@" for the apex, "www" for www, else the full name. */
function panelName(host, domain) {
  const apex = (domain?.hostnames || []).find((h) => h.kind === 'apex')?.hostname;
  if (apex && host === apex) return '@';
  if (apex && host === `www.${apex}`) return 'www';
  return host;
}

const fmtDate = (iso) => {
  try { return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }); }
  catch { return ''; }
};

export default function DomainConnect({ slug, pin, themeColor = '#0d9488', domainState }) {
  const { res, step, reload } = domainState || {};
  const domain = res?.domain || null;
  const host   = domain?.primary_host || '';
  const other  = otherName(domain);

  const [hostname, setHostname] = useState('');
  const [busy, setBusy]         = useState(false);
  const [err, setErr]           = useState('');
  const [dns, setDns]           = useState(null);     // null = not loaded yet; [] = nothing to add
  const [extra, setExtra]       = useState([]);       // Vercel's own verification records, if any
  const [otp, setOtp]           = useState(null);     // { challengeId, sentTo, purpose, target }
  const [code, setCode]         = useState('');
  const [confirm, setConfirm]   = useState(null);     // 'disconnect' | 'set_primary' | null
  const autoChecked = useRef('');

  async function run(action, payload = {}) {
    setErr(''); setBusy(true);
    try {
      const r = await manageDomain(slug, pin, action, payload);
      const msg = domainMessage(r.outcome);
      if (msg) setErr(msg);
      return r;
    } finally { setBusy(false); }
  }

  async function refreshDns() {
    const r = await run('refresh');
    if (r.outcome === 'ok') { setDns(r.dns_records || []); setExtra(r.vercel_verification || []); }
    await reload?.();
  }

  // Step 2 (and a broken live domain): read Vercel's records once on arrival.
  useEffect(() => {
    const key = `${step}:${host}`;
    if ((step === 'verified' || step === 'misconfigured') && autoChecked.current !== key) {
      autoChecked.current = key;
      refreshDns();
    }
  }, [step, host]); // eslint-disable-line react-hooks/exhaustive-deps

  async function claim() {
    const r = await run('claim', { hostname: hostname.trim() });
    if (r.outcome === 'claimed' || r.outcome === 'already_claimed') { setHostname(''); await reload?.(); }
  }

  async function verify() {
    const r = await run('verify');
    if (r.outcome === 'verified') { setExtra(r.vercel_verification || []); setDns(null); await reload?.(); }
  }

  async function cancelPending() {
    const r = await run('disconnect');
    if (!domainMessage(r.outcome)) await reload?.();
  }

  async function sendCode(purpose, target) {
    const r = await run('request_otp', { otpAction: purpose, ...(target ? { hostname: target } : {}) });
    if (r.outcome === 'otp_sent') { setOtp({ challengeId: r.challenge_id, sentTo: r.sent_to, purpose, target }); setCode(''); }
  }

  async function submitCode() {
    if (!otp) return;
    const base = { challengeId: otp.challengeId, code };
    const r = otp.purpose === 'activate'  ? await run('activate', base)
            : otp.purpose === 'disconnect' ? await run('disconnect', base)
            : await run('set_primary', { ...base, hostname: otp.target });
    setCode('');                                    // never keep a used code on screen
    if (!domainMessage(r.outcome)) { setOtp(null); setConfirm(null); setDns(null); await reload?.(); }
  }

  async function continueDisconnect() {
    await run('disconnect');                        // no code needed once it is disconnecting
    await reload?.();
  }

  if (!domainState || step === 'loading' || step === 'hidden') return null;

  const label = 'block text-xs font-semibold text-gray-600 mb-1.5';
  const input = 'w-full px-3 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-900 bg-white ' +
                'placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent';
  const primaryBtn = 'w-full py-2.5 rounded-xl text-white text-sm font-bold active:scale-[0.98] transition disabled:opacity-50';
  const linkBtn = 'text-xs font-semibold text-gray-400 hover:text-gray-700 disabled:opacity-50';
  const stepTitle = (n, t) => <p className="text-sm font-bold text-gray-900">Step {n} of 3 · {t}</p>;

  const codeBox = otp && (
    <div className="space-y-2">
      <p className="text-xs text-gray-600">We sent a 6-digit code to <b>{otp.sentTo}</b> on WhatsApp. It’s valid for 10 minutes.</p>
      <input type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
             onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
             placeholder="6-digit code" className={`${input} font-mono tracking-widest`} aria-label="WhatsApp code" />
      <button type="button" onClick={submitCode} disabled={busy || code.length !== 6} className={primaryBtn}
              style={{ background: themeColor }}>
        {busy ? 'Checking…' : otp.purpose === 'activate' ? 'Go live' : otp.purpose === 'disconnect' ? 'Disconnect domain' : 'Make it the main address'}
      </button>
      <button type="button" onClick={() => sendCode(otp.purpose, otp.target)} disabled={busy} className={linkBtn}>
        Send a new code
      </button>
    </div>
  );

  const errLine = err && <p className="text-xs text-red-600">{err}</p>;

  return (
    <div data-testid="domain-connect">
      <label className="block text-sm font-semibold text-gray-700 mb-1.5">
        Your own domain <span className="text-gray-400 font-normal">· open your shop at yourbrand.com</span>
      </label>

      {step === 'error' ? (
        <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-3.5 space-y-2">
          <p className="text-xs text-gray-600">{err || 'We couldn’t load your domain settings.'}</p>
          <button type="button" onClick={() => reload?.()} className={linkBtn}>Try again</button>
        </div>

      ) : step === 'none' ? (
        <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-3.5 space-y-3">
          <div className="flex items-start gap-2 text-xs text-gray-500">
            <span className="flex-shrink-0">🌐</span>
            <span>Have your own domain? Customers can open your shop at it. Your PocketLink link keeps working too.</span>
          </div>
          <div>
            <label className={label}>Your domain</label>
            <input type="text" value={hostname} onChange={(e) => setHostname(e.target.value)}
                   placeholder="yourbrand.com" className={input} autoComplete="off" autoCapitalize="none" spellCheck={false} />
          </div>
          {errLine}
          <button type="button" onClick={claim} disabled={busy || !hostname.trim()} className={primaryBtn}
                  style={{ background: themeColor }}>
            {busy ? 'Starting…' : 'Connect domain'}
          </button>
          <p className="text-[11px] text-gray-400 leading-snug flex items-start gap-1.5">
            <ShieldCheck size={13} className="flex-shrink-0 mt-px" />
            <span>Use a domain you own (from GoDaddy, Hostinger, etc.) — or a part of it, like shop.yourbrand.com. We’ll show you exactly what to add where you bought it.</span>
          </p>
        </div>

      ) : step === 'pending' ? (
        <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-3.5 space-y-3">
          {stepTitle(1, 'Prove it’s yours')}
          <p className="text-xs text-gray-600">
            Log in where you bought <b>{host}</b>, open its <b>DNS settings</b> and add this record:
          </p>
          <RecordTable records={[{ type: domain?.txt?.type || 'TXT', name: txtPanelName(domain), value: domain?.txt?.value || '' }]} />
          {txtPanelName(domain) !== domain?.txt?.name && (
            <p className="text-[11px] text-gray-400">If your DNS panel asks for the full name, use <span className="font-mono">{domain?.txt?.name}</span>.</p>
          )}
          {errLine}
          <button type="button" onClick={verify} disabled={busy} className={primaryBtn} style={{ background: themeColor }}>
            {busy ? 'Checking…' : 'I’ve added it — check'}
          </button>
          <div className="flex items-center justify-between">
            {domain?.expires_at ? <p className="text-[11px] text-gray-400">Finish before {fmtDate(domain.expires_at)}.</p> : <span />}
            <button type="button" onClick={cancelPending} disabled={busy} className={linkBtn}>Cancel</button>
          </div>
        </div>

      ) : step === 'verified' ? (
        <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-3.5 space-y-3">
          {stepTitle(2, `Point ${host} to PocketLink`)}
          {dns === null ? (
            <p className="text-xs text-gray-500">Checking your domain…</p>
          ) : dns.length || extra.length ? (
            <>
              <p className="text-xs text-gray-600">
                In the same DNS settings, add these records. If a record with the same name already exists, change it to this value.
              </p>
              <RecordTable records={[
                ...dns.filter((r) => r.value).map((r) => ({ type: r.type, name: panelName(r.host, domain), value: r.value })),
                ...extra.map((r) => ({ type: r.type, name: r.name, value: r.value })),
              ]} />
            </>
          ) : (
            <p className="text-xs text-gray-600">Your domain is almost ready. Tap <b>Check again</b>.</p>
          )}
          {errLine}
          <button type="button" onClick={refreshDns} disabled={busy} className={primaryBtn} style={{ background: themeColor }}>
            {busy ? 'Checking…' : 'Check again'}
          </button>
          <p className="text-[11px] text-gray-400">DNS changes can take up to an hour to show.</p>
        </div>

      ) : step === 'ready' ? (
        <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-3.5 space-y-3">
          {stepTitle(3, 'Go live')}
          <p className="text-xs text-gray-600"><b>{host}</b> is set up. To switch it on, confirm with a code we send to your WhatsApp.</p>
          {errLine}
          {codeBox || (
            <button type="button" onClick={() => sendCode('activate')} disabled={busy} className={primaryBtn}
                    style={{ background: themeColor }}>
              {busy ? 'Sending…' : 'Send code'}
            </button>
          )}
        </div>

      ) : step === 'connected' ? (
        <div className="rounded-xl border border-green-200 bg-green-50 px-3.5 py-3 space-y-2">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-green-500 text-white flex items-center justify-center flex-shrink-0">
              <Check size={14} strokeWidth={3} />
            </span>
            <p className="text-sm font-bold text-green-800 break-all">{host} is live</p>
          </div>
          {other && <p className="text-xs text-green-700/80">{other} opens it too.</p>}
          {res?.serving === false ? (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 px-2 py-1 rounded-lg">
              Connected — we’ll switch it on for customers soon. Until then, keep sharing your PocketLink link.
            </p>
          ) : (
            <p className="text-xs text-gray-500">
              Customers can open your shop at <b>https://{host}</b>. Your PocketLink link keeps working too.
            </p>
          )}
          {errLine}
          {confirm ? (
            <div className="rounded-xl border border-gray-200 bg-white p-3 space-y-2">
              <p className="text-xs text-gray-700">
                {confirm === 'disconnect'
                  ? <>Disconnect <b>{host}</b>? Customers using it will see “not connected”. Your PocketLink link keeps working.</>
                  : <>Make <b>{other}</b> the main address? <b>{host}</b> will open it too.</>}
              </p>
              {codeBox || (
                <div className="flex items-center gap-3">
                  <button type="button" disabled={busy}
                    onClick={() => (confirm === 'disconnect' ? sendCode('disconnect') : sendCode('set_primary', other))}
                    className="px-3 py-2 rounded-xl text-white text-xs font-bold active:scale-[0.98] transition disabled:opacity-50"
                    style={{ background: themeColor }}>
                    {busy ? 'Sending…' : 'Send code to confirm'}
                  </button>
                  <button type="button" onClick={() => { setConfirm(null); setOtp(null); setErr(''); }} className={linkBtn}>Keep it</button>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-4">
              {other && (
                <button type="button" onClick={() => setConfirm('set_primary')} disabled={busy} className={linkBtn}>
                  Use {other} as main address
                </button>
              )}
              <button type="button" onClick={() => setConfirm('disconnect')} disabled={busy}
                className="text-xs font-semibold text-gray-400 hover:text-red-500 disabled:opacity-50">
                Disconnect
              </button>
            </div>
          )}
        </div>

      ) : step === 'misconfigured' ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 space-y-3">
          <p className="text-sm font-bold text-amber-800 break-all">{host} isn’t pointing to PocketLink any more</p>
          <p className="text-xs text-amber-800/80">Customers can still use your PocketLink link. Put these records back where you bought the domain:</p>
          {dns && dns.length > 0 && (
            <RecordTable records={dns.filter((r) => r.value).map((r) => ({ type: r.type, name: panelName(r.host, domain), value: r.value }))} />
          )}
          {errLine}
          <button type="button" onClick={refreshDns} disabled={busy} className={primaryBtn} style={{ background: themeColor }}>
            {busy ? 'Checking…' : 'Check again'}
          </button>
        </div>

      ) : step === 'disconnecting' ? (
        <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-3.5 space-y-2">
          <p className="text-xs text-gray-600">Disconnecting <b>{host}</b>… this takes about a minute.</p>
          {errLine}
          <button type="button" onClick={continueDisconnect} disabled={busy} className={linkBtn}>
            {busy ? 'Checking…' : 'Check again'}
          </button>
        </div>
      ) : null}
    </div>
  );
}

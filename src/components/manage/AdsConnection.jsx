import { useState } from 'react';
import { Megaphone, ShieldCheck, RefreshCw, Check } from 'lucide-react';
import { startMetaConnect, selectMetaPage, selectMetaBusiness, selectMetaInstagram } from '../../utils/metaConnect';
import { selectAdAccount } from '../../utils/metaCampaign';

/**
 * Manage → Ads → Meta connection.
 *
 * Connect Meta, reconnect, and choose the business, Facebook Page, Instagram
 * account and ad account this store advertises with. Everything here comes from
 * the server's connection payload — no tokens reach the browser, and merchants
 * are never shown how PocketLink talks to Meta behind the scenes.
 */

const CHOICE_ERRORS = {
  not_granted: 'Meta no longer shares that with PocketLink. Reconnect and include it.',
  ig_not_on_page: 'That Instagram account is not linked to your Facebook Page.',
  page_not_selected: 'Choose your Facebook Page first.',
  reauth: 'Your Meta connection expired. Reconnect to continue.',
  ad_account_not_connected: 'That ad account is not shared with PocketLink.',
  ad_account_unreadable: 'Meta could not open that ad account right now. Try again shortly.',
  not_allowed_in_this_environment: 'Changes are switched off in this preview.',
  save_failed: 'That choice could not be saved. Try again.',
  pin: 'Incorrect PIN. Unlock the store again.',
  network: 'Check your internet connection and try again.',
};

const fmtDate = (iso) => {
  try { return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); } catch { return ''; }
};

const TONE = {
  amber: 'bg-amber-50 border-amber-200 text-amber-800',
  red: 'bg-red-50 border-red-200 text-red-700',
  gray: 'bg-gray-50 border-gray-200 text-gray-700',
};

// The one message a merchant needs about their connection, if any.
function noticeFor(conn, account) {
  if (conn.state === 'reconnect') {
    return { tone: 'amber', title: 'Your Meta connection has expired', text: 'Reconnect to see your results and manage your ads.', reconnect: true };
  }
  if (conn.reason === 'account_unavailable') {
    return { tone: 'red', title: 'This ad account can’t be used right now', text: account?.unusableReason || 'Meta has restricted this ad account. Check it in Meta Business Settings, or choose another ad account below.' };
  }
  if (conn.reason === 'missing_permissions') {
    return { tone: 'amber', title: 'PocketLink needs access to your ads', text: 'Reconnect Meta and allow access to your ad account to create and track ads.', reconnect: true };
  }
  if (conn.reason === 'automation_unavailable') {
    return {
      tone: 'gray',
      title: 'Advanced ads automation isn’t available for this ad account yet',
      text: conn.canCreate
        ? 'You can still create, pause and track your ads here. Meta is switching it on for ad accounts gradually.'
        : 'You can still see how your ads are doing here. Meta is switching it on for ad accounts gradually.',
    };
  }
  if (conn.tokenStatus === 'expiring') {
    return { tone: 'amber', title: 'Your Meta connection ends soon', text: `Reconnect before ${fmtDate(conn.expiresAt)} so your ads can be managed without a break.`, reconnect: true };
  }
  return null;
}

function Picker({ id, label, value, options, onPick, saving, placeholder }) {
  return (
    <div>
      <label htmlFor={id} className="block text-[11px] font-semibold text-gray-500 mb-1">{label}</label>
      <div className="flex items-center gap-2">
        <select id={id} value={value} disabled={saving} onChange={(e) => onPick(e.target.value)}
          className="flex-1 min-w-0 text-sm rounded-xl border border-gray-200 bg-white px-3 py-2 disabled:opacity-60">
          {placeholder && <option value="" disabled={!options.some((o) => o.value === '')}>{placeholder}</option>}
          {options.map((o) => <option key={o.value || 'none'} value={o.value} disabled={o.disabled}>{o.label}</option>)}
        </select>
        {saving && <RefreshCw size={14} className="animate-spin text-gray-400 flex-shrink-0" />}
      </div>
    </div>
  );
}

export default function AdsConnection({ config, pin, themeColor = '#0d9488', conn, onRefresh }) {
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState(false);

  async function connect() {
    setErr(''); setBusy('connect');
    try {
      await startMetaConnect(config.slug, pin);   // redirects to Meta on success
    } catch (e) {
      setErr(e.message || 'Could not start the connection. Please try again.');
      setBusy('');
    }
  }

  async function choose(kind, value) {
    setErr(''); setBusy(kind);
    try {
      let r;
      if (kind === 'page') {
        r = await selectMetaPage(config.slug, pin, value).then((d) => ({ ok: true, ...d }), (e) => ({ message: e.message }));
      } else if (kind === 'business') {
        r = await selectMetaBusiness(config.slug, pin, value);
      } else if (kind === 'instagram') {
        r = await selectMetaInstagram(config.slug, pin, value);
      } else {
        r = await selectAdAccount(config.slug, pin, value);
      }
      if (r?.ok) await onRefresh?.();
      else setErr(r?.message || CHOICE_ERRORS[r?.error] || 'That choice could not be saved. Try again.');
    } finally {
      setBusy('');
    }
  }

  const header = (status) => (
    <div className="px-4 py-3 flex items-center gap-2" style={{ background: `linear-gradient(135deg, ${themeColor}14, transparent)` }}>
      <Megaphone size={15} style={{ color: themeColor }} />
      <p className="text-[11px] font-bold uppercase tracking-widest text-gray-600 flex-1">Meta ads</p>
      {status}
    </div>
  );

  if (!conn) {
    return (
      <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
        {header(null)}
        <div className="p-4 flex items-center gap-2 text-sm text-gray-400"><RefreshCw size={15} className="animate-spin" /> Checking your Meta connection…</div>
      </div>
    );
  }

  if (conn.state === 'error') {
    return (
      <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
        {header(null)}
        <div className="p-4 flex items-center justify-between gap-3">
          <p className="text-sm text-gray-600">{conn.error === 'pin' ? 'That PIN was not accepted. Unlock the store again.' : 'Couldn’t check your Meta connection.'}</p>
          <button type="button" onClick={() => onRefresh?.()} className="text-xs font-bold text-white px-3 py-1.5 rounded-lg" style={{ background: themeColor }}>Try again</button>
        </div>
      </div>
    );
  }

  if (conn.state === 'not_connected') {
    return (
      <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
        {header(null)}
        <div className="p-4 space-y-3">
          <p className="text-sm font-bold text-gray-900">Advertise your products on Facebook and Instagram</p>
          <p className="text-xs text-gray-500 leading-relaxed">
            Connect Meta once. PocketLink then builds ads for your products, and you approve every ad before it runs or spends anything.
          </p>
          {err && <p className="text-xs text-red-600">{err}</p>}
          <button type="button" onClick={connect} disabled={busy === 'connect'}
            className="w-full py-2.5 rounded-xl text-white text-sm font-bold active:scale-[0.98] transition disabled:opacity-50"
            style={{ background: themeColor }}>
            {busy === 'connect' ? 'Redirecting…' : 'Connect Meta'}
          </button>
          <p className="text-[11px] text-gray-400 leading-snug flex items-start gap-1.5">
            <ShieldCheck size={13} className="flex-shrink-0 mt-px" />
            <span>You’ll sign in with Facebook and choose which business, Page and ad account to share. We never see your password, and your access is stored securely — never in your browser.</span>
          </p>
        </div>
      </div>
    );
  }

  const adAccounts = Array.isArray(conn.adAccounts) ? conn.adAccounts : [];
  const pages = Array.isArray(conn.pages) ? conn.pages : [];
  const businesses = Array.isArray(conn.businesses) ? conn.businesses : [];
  const selectedAccount = adAccounts.find((a) => a.id === conn.selected?.adAccountId) || null;
  const selectedPage = pages.find((p) => p.id === conn.selected?.pageId) || null;
  const selectedBusiness = businesses.find((b) => b.id === conn.selected?.businessId) || null;
  const notice = noticeFor(conn, selectedAccount);
  const missingChoice = conn.needsAdAccountChoice || !selectedPage;
  const showPickers = editing || missingChoice;
  const reconnectNeeded = conn.state === 'reconnect';

  const summary = [
    ['Business', selectedBusiness?.name || config.meta?.businessName || '—'],
    ['Facebook Page', selectedPage?.name || 'Not chosen'],
    ['Instagram', conn.selected?.instagramId && selectedPage?.instagram ? `@${selectedPage.instagram.username}` : 'Facebook only'],
    ['Ad account', selectedAccount ? (selectedAccount.name || selectedAccount.id) : 'Not chosen'],
  ];

  return (
    <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
      {header(reconnectNeeded
        ? <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Reconnect</span>
        : <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-green-100 text-green-700 inline-flex items-center gap-1"><Check size={10} strokeWidth={3} /> Connected</span>)}

      <div className="p-4 space-y-3">
        {notice && (
          <div className={`rounded-xl border px-3 py-2.5 ${TONE[notice.tone]}`}>
            <p className="text-sm font-bold">{notice.title}</p>
            <p className="text-xs mt-0.5 opacity-90 leading-relaxed">{notice.text}</p>
            {notice.reconnect && (
              <button type="button" onClick={connect} disabled={busy === 'connect'} className="mt-2 text-xs font-bold underline underline-offset-2 disabled:opacity-50">
                {busy === 'connect' ? 'Redirecting…' : 'Reconnect Meta'}
              </button>
            )}
          </div>
        )}

        {!reconnectNeeded && !showPickers && (
          <div className="rounded-xl border border-gray-100 bg-gray-50/60 px-3.5 py-1">
            {summary.map(([k, v], i) => (
              <div key={k} className={`flex items-center justify-between gap-4 py-2 ${i < summary.length - 1 ? 'border-b border-gray-100' : ''}`}>
                <span className="text-xs font-semibold text-gray-500 shrink-0">{k}</span>
                <span className="text-sm text-gray-900 text-right truncate">{v}</span>
              </div>
            ))}
          </div>
        )}

        {!reconnectNeeded && showPickers && (
          <div className="space-y-2.5">
            {missingChoice && <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 px-2.5 py-1.5 rounded-lg">Choose where your ads come from to start advertising.</p>}
            {businesses.length > 0 && (
              <Picker id="ads-business" label="Business" value={conn.selected?.businessId || ''} saving={busy === 'business'} placeholder="Choose a business"
                options={businesses.map((b) => ({ value: b.id, label: b.name || b.id }))} onPick={(v) => choose('business', v)} />
            )}
            {pages.length === 0 ? (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 px-2.5 py-1.5 rounded-lg">No Facebook Page was shared. Add a Page in Meta, then reconnect.</p>
            ) : (
              <Picker id="ads-page" label="Facebook Page" value={selectedPage?.id || ''} saving={busy === 'page'} placeholder="Choose a Page"
                options={pages.map((p) => ({ value: p.id, label: p.name }))} onPick={(v) => choose('page', v)} />
            )}
            {selectedPage && (
              <Picker id="ads-instagram" label="Instagram" value={conn.selected?.instagramId && selectedPage.instagram ? selectedPage.instagram.id : ''} saving={busy === 'instagram'}
                options={[{ value: '', label: 'Facebook only' }, ...(selectedPage.instagram ? [{ value: selectedPage.instagram.id, label: `@${selectedPage.instagram.username}` }] : [])]}
                onPick={(v) => choose('instagram', v)} />
            )}
            {adAccounts.length === 0 ? (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 px-2.5 py-1.5 rounded-lg">No ad account was shared. Reconnect and include your ad account.</p>
            ) : (
              <Picker id="ads-account" label="Ad account" value={selectedAccount?.id || ''} saving={busy === 'adAccount'} placeholder="Choose an ad account"
                options={adAccounts.map((a) => ({ value: a.id, label: `${a.name || a.id}${a.currency ? ` · ${a.currency}` : ''}${a.usable ? '' : ' · unavailable'}`, disabled: !a.usable }))}
                onPick={(v) => choose('adAccount', v)} />
            )}
          </div>
        )}

        {err && <p className="text-xs text-red-600">{err}</p>}

        <div className="flex items-center gap-4 flex-wrap">
          {!reconnectNeeded && !missingChoice && (
            <button type="button" onClick={() => setEditing((v) => !v)} className="text-xs font-semibold" style={{ color: themeColor }}>
              {editing ? 'Done' : 'Change'}
            </button>
          )}
          {!reconnectNeeded && (
            <button type="button" onClick={connect} disabled={busy === 'connect'} className="text-xs font-semibold text-gray-400 hover:text-gray-600 disabled:opacity-50">
              {busy === 'connect' ? 'Redirecting…' : 'Reconnect'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

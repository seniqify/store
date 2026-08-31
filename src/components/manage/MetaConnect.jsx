import { useState, useEffect } from 'react';
import { Check, Share2, ShieldCheck } from 'lucide-react';
import { startMetaConnect, disconnectMeta, selectMetaPage } from '../../utils/metaConnect';

/**
 * Settings → Connect Meta (Facebook Login for Business, Stage 1).
 *
 * "Connect Meta" hands the seller off to Meta's login; our server-side callback
 * exchanges the code, stores the token in the RLS-locked store_meta_accounts
 * table, and mirrors a public-safe summary onto config.meta — which is all this
 * card ever reads. The token never touches the browser. Mirrors the idiom of
 * PaymentsConnect / ShippingConnect.
 */

// Friendly copy for the ?meta=error&reason=… values the callback may redirect with.
const REASONS = {
  denied:   'You cancelled the Meta authorization — no problem, you can connect any time.',
  state:    'That connection link expired. Please tap Connect Meta again.',
  config:   'Meta connection isn’t fully set up yet. Please try again shortly.',
  exchange: 'Meta couldn’t complete the sign-in. Please try connecting again.',
  nocode:   'Meta didn’t return an authorization. Please try again.',
  store:    'We couldn’t save the connection. Please try again.',
  server:   'Something went wrong connecting to Meta. Please try again.',
};

// Read the one-time connect result Meta's callback appended to the URL.
function readMetaNotice() {
  if (typeof window === 'undefined') return null;
  const p = new URLSearchParams(window.location.search);
  const m = p.get('meta');
  if (m === 'connected') return { type: 'success', text: 'Meta connected successfully.' };
  if (m === 'error') return { type: 'error', text: REASONS[p.get('reason')] || 'Could not connect to Meta. Please try again.' };
  return null;
}

export default function MetaConnect({ config, pin, themeColor = '#0d9488', onConfig }) {
  const meta      = config.meta || {};
  const connected = Boolean(meta.connected);
  const [busy, setBusy]     = useState(false);
  const [err, setErr]       = useState('');
  // Compute the result banner once from the URL (lazy init — no setState in an
  // effect). Connection status itself comes from config.meta, which ManageStore
  // refreshes from the DB after the round-trip.
  const [notice, setNotice] = useState(readMetaNotice);

  // Facebook Page (ad identity). meta.pages === null → an older connection made
  // before Page capture existed → the seller must reconnect. The selected Page
  // (meta.pageId) is the single source of truth for 2C preview / 2D launch.
  const pages      = Array.isArray(meta.pages) ? meta.pages : null;
  const selectedId = meta.pageId ? String(meta.pageId) : '';
  const selectedPage = (pages && pages.find((p) => p.id === selectedId))
    || (selectedId ? { id: selectedId, name: meta.pageName || 'Facebook Page' } : null);
  const [choice, setChoice]         = useState(selectedId);
  const [savingPage, setSavingPage] = useState(false);
  const [changing, setChanging]     = useState(false);

  async function savePage(id) {
    if (!id) { setErr('Please choose a Page.'); return; }
    setErr(''); setSavingPage(true);
    try {
      const d = await selectMetaPage(config.slug, pin, id);
      onConfig?.({ meta: { ...meta, pageId: d.pageId, pageName: d.pageName, igId: d.ig?.id || null, igUsername: d.ig?.username || null } });
      setChanging(false);
    } catch (e) {
      setErr(e.message || 'Could not save the Page.');
    } finally { setSavingPage(false); }
  }

  // Strip the ?meta=… params so a refresh doesn't re-show the banner.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const p = new URLSearchParams(window.location.search);
    if (!p.has('meta')) return;
    p.delete('meta'); p.delete('reason');
    const qs = p.toString();
    window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''));
  }, []);

  async function connect() {
    setErr(''); setBusy(true);
    try {
      await startMetaConnect(config.slug, pin);   // redirects to Meta on success
    } catch (e) {
      setErr(e.message || 'Could not start the connection. Please try again.');
      setBusy(false);
    }
  }

  async function disconnect() {
    setErr(''); setBusy(true);
    try {
      await disconnectMeta(config.slug, pin);
      onConfig?.({ meta: { connected: false } });   // keep in-memory config in sync
      setNotice(null);
    } catch (e) {
      setErr(e.message || 'Could not disconnect. Please try again.');
    } finally { setBusy(false); }
  }

  return (
    <div>
      <label className="block text-sm font-semibold text-gray-700 mb-1.5">
        Connect Meta <span className="text-gray-400 font-normal">· Facebook / Instagram business</span>
      </label>

      {notice && (
        <div className={`mb-2 rounded-xl px-3 py-2 text-xs font-medium border ${
          notice.type === 'success'
            ? 'bg-green-50 text-green-700 border-green-200'
            : 'bg-red-50 text-red-600 border-red-200'}`}>
          {notice.text}
        </div>
      )}

      {connected ? (
        /* Connected state */
        <div className="rounded-xl border border-green-200 bg-green-50 px-3.5 py-3">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-green-500 text-white flex items-center justify-center flex-shrink-0">
              <Check size={14} strokeWidth={3} />
            </span>
            <p className="text-sm font-bold text-green-800">Meta Connected ✓</p>
          </div>
          {meta.businessName && (
            <p className="text-xs text-green-700/90 mt-1.5">
              Business: <b>{meta.businessName}</b>
              {meta.adAccountCount ? ` · ${meta.adAccountCount} ad account${meta.adAccountCount === 1 ? '' : 's'}` : ''}
            </p>
          )}

          {/* Facebook Page = the ad identity used for campaigns (Stage 2C/2D). */}
          {pages === null ? (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 mt-2">
              Reconnect to enable ads — Page access needed.
            </p>
          ) : selectedPage && !changing ? (
            <div className="text-xs text-green-700/90 mt-1.5">
              Page: <b>{selectedPage.name}</b>
              {meta.igUsername ? <> · IG: <b>@{meta.igUsername}</b></> : null}
              {pages.length > 1 && (
                <button type="button" onClick={() => { setChoice(selectedId); setChanging(true); }}
                  className="ml-2 font-semibold text-green-800 hover:underline">Change</button>
              )}
            </div>
          ) : pages.length === 0 ? (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 mt-2">
              No Facebook Page found in your Meta business. Add a Page, then reconnect to run ads.
            </p>
          ) : (
            <div className="mt-2">
              <label className="block text-[11px] font-semibold text-green-800 mb-1">
                {selectedPage ? 'Change the Facebook Page to advertise from' : 'Choose the Facebook Page to advertise from'}
              </label>
              <div className="flex gap-2">
                <select value={choice} onChange={(e) => setChoice(e.target.value)}
                  className="flex-1 text-xs rounded-lg border border-green-200 bg-white px-2 py-1.5">
                  <option value="">Select a Page…</option>
                  {pages.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}{p.ig ? ` (IG @${p.ig.username})` : ''}</option>
                  ))}
                </select>
                <button type="button" onClick={() => savePage(choice)} disabled={savingPage || !choice}
                  className="text-xs font-bold text-white px-3 rounded-lg disabled:opacity-50" style={{ background: themeColor }}>
                  {savingPage ? 'Saving…' : 'Save'}
                </button>
              </div>
              {changing && (
                <button type="button" onClick={() => setChanging(false)}
                  className="mt-1 text-[11px] text-gray-400 hover:text-gray-600">Cancel</button>
              )}
            </div>
          )}

          <p className="text-xs text-gray-500 mt-2">
            Your Facebook / Instagram business is linked to PocketLink. Manage your ads in the <b>Ads</b> tab.
          </p>
          {err && <p className="text-xs text-red-600 mt-2">{err}</p>}
          <div className="mt-2.5 flex items-center gap-4">
            <button type="button" onClick={connect} disabled={busy}
              className="text-xs font-semibold disabled:opacity-50" style={{ color: themeColor }}>
              {busy ? 'Redirecting…' : 'Reconnect'}
            </button>
            <button type="button" onClick={disconnect} disabled={busy}
              className="text-xs font-semibold text-gray-400 hover:text-red-500 disabled:opacity-50">
              {busy ? 'Disconnecting…' : 'Disconnect'}
            </button>
          </div>
        </div>
      ) : (
        /* Connect prompt */
        <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-3.5 space-y-3">
          <div className="flex items-start gap-2 text-xs text-gray-500">
            <Share2 size={15} className="flex-shrink-0 mt-0.5" style={{ color: themeColor }} />
            <span>Connect your Facebook / Instagram business assets to PocketLink to manage your advertising from one place.</span>
          </div>
          {err && <p className="text-xs text-red-600">{err}</p>}
          <button type="button" onClick={connect} disabled={busy}
            className="w-full py-2.5 rounded-xl text-white text-sm font-bold active:scale-[0.98] transition disabled:opacity-50"
            style={{ background: themeColor }}>
            {busy ? 'Redirecting…' : 'Connect Meta'}
          </button>
          <p className="text-[11px] text-gray-400 leading-snug flex items-start gap-1.5">
            <ShieldCheck size={13} className="flex-shrink-0 mt-px" />
            <span>You’ll sign in with Facebook and choose which business &amp; ad accounts to share. We never see your password, and your access is stored securely — never in your browser.</span>
          </p>
        </div>
      )}
    </div>
  );
}

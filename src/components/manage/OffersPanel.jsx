import { useState, useEffect, useMemo } from 'react';
import { Megaphone, Send, Loader2, Plus, X, Check } from 'lucide-react';
import { listTemplates, requestTemplate, offerAudience, sendOffer } from '../../utils/offerService';
import { OFFER_FIELDS, placeholdersIn, fieldError, requestError, fillOffer } from '../../utils/offerText';
import { formatPaise } from '../../utils/walletPacks';

/**
 * OffersPanel — send a WhatsApp offer to the customers on screen (the active
 * segment), or write your own message for PocketLink to get approved.
 *
 * Replaces the old "Connect WhatsApp campaigns" card (paste a Seniqify API
 * link): shops now pick a ready-made, approved message, fill in their offer and
 * send. Only customers who ticked "Get offers on WhatsApp" at this shop's
 * checkout receive it, at most once every 3 days, Rs 1.50 each from the
 * message wallet — the server decides all of that (supabase/offers-forward.sql).
 */

const STATUS = {
  requested: { text: 'Waiting for approval', cls: 'bg-amber-50 text-amber-700' },
  approved:  { text: 'Approved',             cls: 'bg-emerald-50 text-emerald-700' },
  rejected:  { text: 'Not approved',         cls: 'bg-rose-50 text-rose-700' },
};

export default function OffersPanel({ slug, pin, businessName = '', audience = [], audienceLabel = 'all', themeColor = '#0d9488' }) {
  const [templates, setTemplates] = useState(null);     // null = loading; [] or array; false = failed
  const [pickedId, setPickedId]   = useState('');
  const [fields, setFields]       = useState({});
  const [check, setCheck]         = useState(null);     // offer_audience result, shown before sending
  const [busy, setBusy]           = useState('');       // '' | 'checking' | 'sending'
  const [progress, setProgress]   = useState(null);
  const [result, setResult]       = useState(null);
  const [error, setError]         = useState('');
  const [writing, setWriting]     = useState(false);
  const [draft, setDraft]         = useState({ name: '', body: '' });
  const [draftMsg, setDraftMsg]   = useState('');

  useEffect(() => {
    let alive = true;
    listTemplates(slug, pin).then((t) => { if (alive) setTemplates(t === null ? false : t); });
    return () => { alive = false; };
  }, [slug, pin]);

  const approved = useMemo(() => (templates || []).filter((t) => t.status === 'approved'), [templates]);
  const own = useMemo(() => (templates || []).filter((t) => t.own && t.status !== 'approved'), [templates]);
  const picked = approved.find((t) => t.id === pickedId) || null;
  const pickedFields = picked ? placeholdersIn(picked.body).keys.filter((k) => k in OFFER_FIELDS) : [];
  const uniqueFields = [...new Set(pickedFields)];
  const phones = audience.map((c) => c.phone);
  const sample = audience[0];

  function reset() { setCheck(null); setResult(null); setError(''); setProgress(null); }

  async function checkAudience() {
    reset();
    const bad = uniqueFields.find((k) => fieldError(fields[k]));
    if (bad) { setError(`${OFFER_FIELDS[bad].label}: ${fieldError(fields[bad])}`); return; }
    setBusy('checking');
    const r = await offerAudience(slug, pin, picked.id, phones, fields);
    setBusy('');
    if (!r?.ok) { setError(r?.error || 'Could not check who can receive it.'); return; }
    setCheck(r);
  }

  async function send() {
    setBusy('sending');
    setError('');
    try {
      const r = await sendOffer({ slug, pin, templateId: picked.id, fields, phones, onProgress: setProgress });
      setResult(r);
      setCheck(null);
    } catch (e) {
      setError(e?.message || 'Sending stopped. Please try again.');
    } finally {
      setBusy('');
    }
  }

  async function submitDraft() {
    const err = requestError(draft.name, draft.body);
    if (err) { setDraftMsg(err); return; }
    setDraftMsg('');
    setBusy('requesting');
    const r = await requestTemplate(slug, pin, draft.name, draft.body);
    setBusy('');
    if (!r?.ok) { setDraftMsg(r?.error || 'Could not send the request.'); return; }
    setDraft({ name: '', body: '' });
    setWriting(false);
    const fresh = await listTemplates(slug, pin);
    if (fresh) setTemplates(fresh);
  }

  if (templates === null) return <div className="h-24 rounded-2xl bg-white border border-gray-100 animate-pulse" />;

  const who = audienceLabel === 'all' ? 'customers' : `${audienceLabel} customers`;

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Megaphone size={16} className="text-emerald-600" />
        <p className="font-bold text-gray-900 text-sm">Send an offer on WhatsApp</p>
      </div>
      <p className="text-[12px] text-gray-500 leading-relaxed">
        Goes only to customers who ticked &ldquo;Get offers on WhatsApp&rdquo; at your checkout, at most once every 3 days.
        ₹1.50 each from your message wallet.
      </p>

      {templates === false && <p className="text-[12px] text-rose-600">Could not load your messages. Refresh to try again.</p>}

      {/* Approved messages */}
      {approved.length > 0 ? (
        <div className="space-y-2">
          {approved.map((t) => (
            <button key={t.id} type="button" onClick={() => { setPickedId(t.id); reset(); }}
              className={['w-full text-left rounded-xl border px-3 py-2.5 transition-colors',
                          t.id === pickedId ? 'border-emerald-400 bg-emerald-50/50' : 'border-gray-200 hover:border-gray-300'].join(' ')}>
              <span className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-bold text-gray-900 truncate">{t.name}</span>
                {t.own && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 flex-shrink-0">Yours</span>}
              </span>
              <span className="block text-[12px] text-gray-500 mt-0.5 line-clamp-2">{t.body}</span>
            </button>
          ))}
        </div>
      ) : templates !== false && (
        <p className="text-[12px] text-gray-400">No ready-made messages yet — PocketLink is getting them approved. You can write your own below.</p>
      )}

      {/* Fill + preview + send */}
      {picked && (
        <div className="space-y-2.5 pt-1">
          {uniqueFields.map((k) => (
            <label key={k} className="block">
              <span className="block text-[11px] font-semibold text-gray-500 mb-1">{OFFER_FIELDS[k].label}</span>
              <input value={fields[k] || ''} maxLength={60}
                onChange={(e) => { setFields((f) => ({ ...f, [k]: e.target.value })); setCheck(null); }}
                placeholder={OFFER_FIELDS[k].placeholder}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-emerald-200" />
            </label>
          ))}

          <div className="rounded-xl bg-[#e7ffdb] px-3 py-2.5 text-[12.5px] text-gray-800 leading-snug whitespace-pre-line">
            {fillOffer(picked.body, { name: sample?.name, shop: businessName, fields })}
            <span className="block mt-2 pt-1.5 border-t border-emerald-200/70 text-center text-[12px] font-semibold text-sky-600">Shop now</span>
          </div>

          {error && <p className="text-[12px] text-rose-600">{error}</p>}

          {result ? (
            <div className="text-xs font-semibold">
              <p className={result.failed || result.stoppedFor ? 'text-amber-700' : 'text-emerald-700'}>
                {result.sent > 0 ? `✅ Sent to ${result.sent} customer${result.sent === 1 ? '' : 's'}.` : 'Nothing was sent.'}
                {result.failed > 0 && ` ${result.failed} could not be delivered — refunded to your wallet.`}
                {result.stoppedFor === 'no_balance' && ' Your wallet ran out — top it up to send to the rest.'}
              </p>
              <button type="button" onClick={reset} className="mt-1 underline text-gray-500 font-normal">Done</button>
            </div>
          ) : check ? (
            <div className="rounded-xl border border-gray-200 px-3 py-2.5 space-y-2">
              <p className="text-xs text-gray-700">
                <b>{check.eligible}</b> of {phones.length} {who} can receive it
                {check.eligible > 0 && <> · <b>{formatPaise(check.cost_paise)}</b> from your wallet ({formatPaise(check.balance_paise)} left)</>}.
              </p>
              {(check.no_consent > 0 || check.recent > 0) && (
                <p className="text-[11px] text-gray-400">
                  {check.no_consent > 0 && `${check.no_consent} haven’t agreed to WhatsApp offers. `}
                  {check.recent > 0 && `${check.recent} got an offer in the last 3 days.`}
                </p>
              )}
              {check.eligible > 0 && Number(check.balance_paise) < Number(check.cost_paise) && (
                <p className="text-[11px] text-amber-700">Your wallet covers {Math.floor(Number(check.balance_paise) / Number(check.price_paise))} — top it up to reach everyone.</p>
              )}
              {busy === 'sending' && progress && (
                <p className="text-[11px] text-gray-500">Sending… {progress.done} of {progress.total}</p>
              )}
              <div className="flex items-center gap-2">
                <button type="button" onClick={send} disabled={busy !== '' || check.eligible === 0}
                  className="inline-flex items-center gap-1.5 text-xs font-bold text-white px-4 py-2 rounded-xl bg-emerald-600 active:scale-95 disabled:opacity-40">
                  {busy === 'sending' ? <Loader2 size={14} className="animate-spin" /> : <Send size={13} />} Send now
                </button>
                <button type="button" onClick={() => setCheck(null)} disabled={busy === 'sending'}
                  className="text-xs font-semibold text-gray-500 px-3 py-2 rounded-xl hover:bg-gray-100">Cancel</button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={checkAudience} disabled={busy !== '' || phones.length === 0}
              className="w-full inline-flex items-center justify-center gap-2 text-sm font-bold text-white py-2.5 rounded-xl active:scale-95 disabled:opacity-40"
              style={{ backgroundColor: themeColor }}>
              {busy === 'checking' ? <Loader2 size={15} className="animate-spin" /> : <Megaphone size={15} />}
              Send to {phones.length} {who}
            </button>
          )}
        </div>
      )}

      {/* The shop's own messages, until approved */}
      {own.length > 0 && (
        <div className="pt-1 space-y-1.5">
          <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400">Your messages</p>
          {own.map((t) => (
            <div key={t.id} className="rounded-xl border border-gray-100 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] font-semibold text-gray-800 truncate">{t.name}</span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${STATUS[t.status]?.cls || ''}`}>
                  {STATUS[t.status]?.text || t.status}
                </span>
              </div>
              {t.status === 'rejected' && t.reject_reason && <p className="text-[11px] text-rose-600 mt-0.5">{t.reject_reason}</p>}
            </div>
          ))}
        </div>
      )}

      {/* Write your own */}
      {writing ? (
        <div className="rounded-xl border border-gray-200 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[12px] font-bold text-gray-800">Write your own message</p>
            <button type="button" onClick={() => { setWriting(false); setDraftMsg(''); }} aria-label="Close"
              className="text-gray-300 hover:text-gray-600"><X size={15} /></button>
          </div>
          <input value={draft.name} maxLength={40} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            placeholder="Name it, e.g. Diwali sale"
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-emerald-200" />
          <textarea value={draft.body} rows={4} maxLength={600} onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
            placeholder={'Hi {name}! {shop} has {offer} this Diwali. Tap below to shop.'}
            className="w-full border border-gray-200 rounded-xl px-3 py-2 text-[13px] resize-none focus:outline-none focus:ring-2 focus:ring-emerald-200" />
          <p className="text-[11px] text-gray-400 leading-snug">
            Use <b>{'{name}'}</b> for the customer&rsquo;s name and <b>{'{shop}'}</b> for your shop; <b>{'{offer}'}</b>, <b>{'{item}'}</b>,
            {' '}<b>{'{code}'}</b>, <b>{'{date}'}</b> are filled in when you send. A <b>Shop now</b> button is added. PocketLink gets it approved by WhatsApp, usually within a day.
          </p>
          {draftMsg && <p className="text-[12px] text-rose-600">{draftMsg}</p>}
          <button type="button" onClick={submitDraft} disabled={busy === 'requesting'}
            className="inline-flex items-center gap-1.5 text-xs font-bold text-white px-4 py-2 rounded-xl bg-emerald-600 active:scale-95 disabled:opacity-50">
            {busy === 'requesting' ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Send for approval
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => setWriting(true)}
          className="inline-flex items-center gap-1 text-[12px] font-semibold text-emerald-600">
          <Plus size={13} /> Write your own message
        </button>
      )}
    </div>
  );
}

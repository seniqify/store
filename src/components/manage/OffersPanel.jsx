import { useState, useEffect, useMemo } from 'react';
import { Megaphone, Send, Loader2, Plus, X, Check, Languages } from 'lucide-react';
import { listTemplates, requestTemplate, offerAudience, sendOffer } from '../../utils/offerService';
import { fetchOfferSummary } from '../../utils/cartReminderService';
import {
  OFFER_FIELDS, OFFER_LANGS, OFFER_BUTTONS, offerLanguage, placeholdersIn, fieldError, requestError, fillOffer,
} from '../../utils/offerText';
import { formatPaise } from '../../utils/walletPacks';
import { formatINR } from '../../utils/currency';

/**
 * OffersPanel — "Send an offer" to the customers on screen (the active
 * segment), or write your own message for PocketLink to get approved.
 *
 * Pick an approved message (ready-made, or the shop's own), fill in the offer,
 * see the WhatsApp preview, then "Send to N customers": the server first says
 * how many can actually receive it and what it costs. Only customers who ticked
 * "Get offers on WhatsApp" at this shop's checkout receive it, at most once
 * every 3 days, Rs 1.50 each from the wallet (supabase/offers-forward.sql).
 * Each offer carries its own link, so the results line shows opens and the
 * orders it brought (supabase/messages-v2-forward.sql).
 * Ready-made messages come in English and Marathi; when both exist, an
 * English | मराठी switch shows one language at a time (remembered per device).
 */

const LANG_KEY = 'pl_offer_lang_v1';

const STATUS = {
  requested: { text: 'Waiting for approval', cls: 'bg-amber-50 text-amber-700' },
  approved:  { text: 'Approved',             cls: 'bg-emerald-50 text-emerald-700' },
  rejected:  { text: 'Not approved',         cls: 'bg-rose-50 text-rose-700' },
};

function hint(t) {
  const f = placeholdersIn(t.body).keys.find((k) => k in OFFER_FIELDS);
  return f ? OFFER_FIELDS[f].label : 'Ready to send';
}

export default function OffersPanel({ slug, pin, businessName = '', audience = [], audienceLabel = 'all', themeColor = '#0d9488' }) {
  const [templates, setTemplates] = useState(null);     // null = loading; [] or array; false = failed
  const [results, setResults]     = useState(null);
  const [pickedId, setPickedId]   = useState('');
  const [fields, setFields]       = useState({});
  const [check, setCheck]         = useState(null);     // offer_audience result, shown before sending
  const [busy, setBusy]           = useState('');       // '' | 'checking' | 'sending' | 'requesting'
  const [progress, setProgress]   = useState(null);
  const [result, setResult]       = useState(null);
  const [error, setError]         = useState('');
  const [writing, setWriting]     = useState(false);
  const [draft, setDraft]         = useState({ name: '', body: '' });
  const [draftMsg, setDraftMsg]   = useState('');
  const [lang, setLang]           = useState(() => {
    try { return localStorage.getItem(LANG_KEY) === 'mr' ? 'mr' : 'en'; } catch { return 'en'; }
  });

  useEffect(() => {
    let alive = true;
    Promise.all([listTemplates(slug, pin), fetchOfferSummary(slug, pin)]).then(([t, s]) => {
      if (!alive) return;
      setTemplates(t === null ? false : t);
      setResults(s);
    });
    return () => { alive = false; };
  }, [slug, pin]);

  const approved = useMemo(() => (templates || []).filter((t) => t.status === 'approved'), [templates]);
  const own = useMemo(() => (templates || []).filter((t) => t.own && t.status !== 'approved'), [templates]);
  const bothLangs = new Set(approved.map((t) => offerLanguage(t.body))).size > 1;
  const shown = bothLangs ? approved.filter((t) => offerLanguage(t.body) === lang) : approved;
  const picked = shown.find((t) => t.id === pickedId) || shown[0] || null;
  const pickedLang = picked ? offerLanguage(picked.body) : 'en';
  const uniqueFields = picked ? [...new Set(placeholdersIn(picked.body).keys.filter((k) => k in OFFER_FIELDS))] : [];
  const phones = audience.map((c) => c.phone);
  const sample = audience[0];
  const who = audienceLabel === 'all' ? 'customers' : `${audienceLabel} customers`;

  function reset() { setCheck(null); setResult(null); setError(''); setProgress(null); }

  function chooseLang(code) {
    setLang(code);
    setPickedId('');
    reset();
    try { localStorage.setItem(LANG_KEY, code); } catch { /* private mode */ }
  }

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
      setResults(await fetchOfferSummary(slug, pin));
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

  const sent = Number(results?.sent_30d) || 0;

  return (
    <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
      <div className="px-4 py-3 flex items-center gap-2" style={{ background: `linear-gradient(135deg, ${themeColor}1f, transparent)` }}>
        <Megaphone size={15} style={{ color: themeColor }} />
        <span className="text-[11px] font-extrabold uppercase tracking-widest text-gray-700">Send an offer</span>
        <span className="ml-auto text-[11.5px] font-bold text-gray-600 truncate">
          To: {audienceLabel === 'all' ? 'All' : audienceLabel} · {phones.length}
        </span>
      </div>

      <div className="px-4 pt-3 pb-4 space-y-3">
        {templates === false && <p className="text-[12px] text-rose-600">Could not load your messages. Refresh to try again.</p>}

        {bothLangs && (
          <div className="flex justify-end">
            <div className="inline-flex items-center gap-0.5 bg-white border border-gray-200 rounded-full p-0.5 shadow-sm">
              <Languages size={13} className="text-gray-400 ml-1.5 mr-0.5 flex-shrink-0" />
              {OFFER_LANGS.map((l) => {
                const active = lang === l.code;
                return (
                  <button key={l.code} type="button" onClick={() => chooseLang(l.code)} aria-pressed={active}
                    className={['text-xs font-bold px-2.5 py-1 rounded-full transition-colors', active ? 'text-white' : 'text-gray-600 hover:bg-gray-100'].join(' ')}
                    style={active ? { backgroundColor: themeColor } : undefined}>
                    {l.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {shown.length > 0 ? (
          <div className="grid grid-cols-3 gap-2">
            {shown.map((t) => {
              const on = picked?.id === t.id;
              return (
                <button key={t.id} type="button" onClick={() => { setPickedId(t.id); reset(); }}
                  className={['rounded-xl px-2.5 py-2 text-left transition-colors border',
                              on ? 'border-[1.5px]' : 'border-gray-200 hover:border-gray-300 bg-white'].join(' ')}
                  style={on ? { borderColor: themeColor, backgroundColor: `${themeColor}14` } : undefined}>
                  <span className="block text-[12.5px] font-extrabold text-gray-900 truncate">{t.name}</span>
                  <span className="block text-[11px] text-gray-500 mt-0.5 truncate">{t.own ? 'Yours' : hint(t)}</span>
                </button>
              );
            })}
          </div>
        ) : templates !== false && (
          <p className="text-[12px] text-gray-500">No ready-made messages yet — PocketLink is getting them approved. You can write your own below.</p>
        )}

        {picked && (
          <>
            {uniqueFields.map((k) => (
              <label key={k} className="block">
                <span className="block text-[11.5px] font-bold text-gray-600 mb-1">{OFFER_FIELDS[k].label}</span>
                <input value={fields[k] || ''} maxLength={60}
                  onChange={(e) => { setFields((f) => ({ ...f, [k]: e.target.value })); setCheck(null); }}
                  placeholder={pickedLang === 'mr' ? OFFER_FIELDS[k].placeholderMr : OFFER_FIELDS[k].placeholder}
                  className="w-full h-[42px] border border-gray-200 rounded-xl px-3 text-[13.5px] focus:outline-none focus:ring-2 focus:ring-emerald-200" />
              </label>
            ))}

            <div className="rounded-2xl bg-[#e7ffdb] px-3 pt-2.5 text-[13px] leading-snug text-gray-800">
              <p className="whitespace-pre-line">{fillOffer(picked.body, { name: sample?.name, shop: businessName, fields })}</p>
              <div className="mt-2 border-t border-[#c7eab4] grid grid-cols-2">
                <span className="py-2 text-center text-[12.5px] font-bold text-sky-600">{OFFER_BUTTONS[pickedLang].shop}</span>
                <span className="py-2 text-center text-[12.5px] font-bold text-sky-600 border-l border-[#c7eab4]">{OFFER_BUTTONS[pickedLang].stop}</span>
              </div>
            </div>

            {error && <p className="text-[12px] text-rose-600">{error}</p>}

            {result ? (
              <div className="text-xs font-semibold">
                <p className={result.failed || result.stoppedFor ? 'text-amber-700' : 'text-emerald-700'}>
                  {result.sent > 0 ? `Sent to ${result.sent} customer${result.sent === 1 ? '' : 's'}.` : 'Nothing was sent.'}
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
                  <p className="text-[11.5px] text-gray-500">
                    {check.no_consent > 0 && `${check.no_consent} haven’t agreed to WhatsApp offers at your checkout yet. `}
                    {check.recent > 0 && `${check.recent} got an offer in the last 3 days.`}
                  </p>
                )}
                {check.eligible > 0 && Number(check.balance_paise) < Number(check.cost_paise) && (
                  <p className="text-[11.5px] text-amber-700">Your wallet covers {Math.floor(Number(check.balance_paise) / Number(check.price_paise))} — top it up to reach everyone.</p>
                )}
                {busy === 'sending' && progress && (
                  <p className="text-[11.5px] text-gray-500">Sending… {progress.done} of {progress.total}</p>
                )}
                <div className="flex items-center gap-2">
                  <button type="button" onClick={send} disabled={busy !== '' || check.eligible === 0}
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-white px-4 py-2.5 rounded-xl active:scale-95 disabled:opacity-40"
                    style={{ backgroundColor: themeColor }}>
                    {busy === 'sending' ? <Loader2 size={14} className="animate-spin" /> : <Send size={13} />} Send now
                  </button>
                  <button type="button" onClick={() => setCheck(null)} disabled={busy === 'sending'}
                    className="text-xs font-semibold text-gray-500 px-3 py-2 rounded-xl hover:bg-gray-100">Cancel</button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={checkAudience} disabled={busy !== '' || phones.length === 0}
                className="w-full h-[50px] inline-flex items-center justify-center gap-2 text-[15px] font-extrabold text-white rounded-xl active:scale-[0.98] transition-transform disabled:opacity-40"
                style={{ backgroundColor: themeColor }}>
                {busy === 'checking' ? <Loader2 size={16} className="animate-spin" /> : <Send size={15} />}
                Send to {phones.length} {who}
              </button>
            )}
          </>
        )}

        {sent > 0 && (
          <p className="text-[11.5px] text-gray-500">
            Last 30 days: <b>{sent}</b> sent · <b>{Number(results.clicked_30d) || 0}</b> opened · <b>{Number(results.ordered_30d) || 0}</b> ordered
            {Number(results.ordered_value_30d) > 0 && <> · spent {formatPaise(results.spent_paise_30d)} → <b className="text-emerald-700">{formatINR(Number(results.ordered_value_30d))}</b></>}
          </p>
        )}

        {own.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[10.5px] font-extrabold uppercase tracking-wider text-gray-500">Your messages</p>
            {own.map((t) => (
              <div key={t.id} className="rounded-xl border border-gray-100 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12.5px] font-semibold text-gray-800 truncate">{t.name}</span>
                  <span className={`text-[10.5px] font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${STATUS[t.status]?.cls || ''}`}>
                    {STATUS[t.status]?.text || t.status}
                  </span>
                </div>
                {t.status === 'rejected' && t.reject_reason && <p className="text-[11.5px] text-rose-600 mt-0.5">{t.reject_reason}</p>}
              </div>
            ))}
          </div>
        )}

        {writing ? (
          <div className="rounded-xl border border-gray-200 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[12.5px] font-bold text-gray-800">Write your own message</p>
              <button type="button" onClick={() => { setWriting(false); setDraftMsg(''); }} aria-label="Close"
                className="text-gray-400 hover:text-gray-600"><X size={15} /></button>
            </div>
            <input value={draft.name} maxLength={40} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder="Name it, e.g. Diwali sale" aria-label="Message name"
              className="w-full h-10 border border-gray-200 rounded-xl px-3 text-[13px] focus:outline-none focus:ring-2 focus:ring-emerald-200" />
            <textarea value={draft.body} rows={4} maxLength={600} onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
              placeholder={'Hi {name}! {shop} has {offer} this Diwali. Tap below to shop.'} aria-label="Message text"
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-[13px] resize-none focus:outline-none focus:ring-2 focus:ring-emerald-200" />
            <p className="text-[11.5px] text-gray-500 leading-snug">
              Use <b>{'{name}'}</b> for the customer&rsquo;s name and <b>{'{shop}'}</b> for your shop; <b>{'{offer}'}</b>, <b>{'{item}'}</b>,
              {' '}<b>{'{code}'}</b>, <b>{'{date}'}</b> are filled in when you send. A <b>Shop now</b> button is added. PocketLink gets it approved by WhatsApp, usually within a day.
            </p>
            {draftMsg && <p className="text-[12px] text-rose-600">{draftMsg}</p>}
            <button type="button" onClick={submitDraft} disabled={busy === 'requesting'}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-white px-4 py-2.5 rounded-xl active:scale-95 disabled:opacity-50"
              style={{ backgroundColor: themeColor }}>
              {busy === 'requesting' ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Send for approval
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => setWriting(true)}
            className="inline-flex items-center gap-1 text-[12.5px] font-bold" style={{ color: themeColor }}>
            <Plus size={13} /> Write your own message
          </button>
        )}
      </div>
    </div>
  );
}

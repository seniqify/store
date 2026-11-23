import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { MessageCircle, Send, Loader2, X, Check } from 'lucide-react';
import { useScrollLock } from '../../hooks/useScrollLock';
import {
  fetchCartReminderSummary, setCartReminders, fetchReminderPreview, sendRemindersNow, setCartReminderLang,
} from '../../utils/cartReminderService';
import { cartReminderMessage, CART_REMINDER_LANGS } from '../../utils/cartReminderText';
import { formatCoins, coinsOf } from '../../utils/walletPacks';
import { formatINR } from '../../utils/currency';

/**
 * RecoveryCard — "Win back these carts" at the top of the Abandoned tab.
 *
 *   Send reminder to all  → a confirm sheet (how many, what it costs, who is
 *                            skipped and why, the message) → sent now, by the
 *                            server, to every cart it decides is eligible.
 *   Send automatically    → the switch: one reminder ~1 hour after a cart is left.
 *   Results (30 days)     → Sent · Opened · Ordered · ₹ won back, what the
 *                            messages cost, and the latest wins by name — so the
 *                            shop can see the reminders pay for themselves.
 *
 * Rules live on the server (supabase/messages-v2-forward.sql): last 7 days, one
 * per customer per week, never after they ordered or asked to stop, 9 am – 9 pm,
 * Rs 1.50 each from the wallet, refunded when WhatsApp refuses one.
 */

function shortDay(iso) {
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? '' : t.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function ConfirmSheet({ preview, sample, storeName, themeColor, sending, progress, onSend, onClose, lang = 'en' }) {
  const cost = Number(preview.cost_paise) || 0;
  const balance = Number(preview.balance_paise) || 0;
  const short = cost > balance;
  const affordable = Math.floor(balance / (Number(preview.price_paise) || 150));
  const msg = cartReminderMessage(lang, sample || {}, storeName);
  useScrollLock(true);

  // Rendered on <body>: every Manage tab sits inside an `animate-pl-fade-up`
  // wrapper, and its leftover transform traps `position: fixed` children. Kept
  // inline, the dim layer covered only the tab and the sheet sat at the bottom
  // of the long tab, off screen on phones.
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/40" role="dialog" aria-modal="true" aria-label="Send cart reminders"
         onKeyDown={(e) => { if (e.key === 'Escape' && !sending) onClose(); }}>
      <div className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl px-5 pt-3 pb-6 space-y-4 max-h-[92vh] overflow-y-auto">
        <div className="w-10 h-1 rounded-full bg-gray-300 mx-auto sm:hidden" />
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-extrabold text-gray-900">Send cart reminders</h3>
            <p className="text-[12.5px] text-gray-500 mt-0.5">One WhatsApp to each customer below</p>
          </div>
          <button type="button" onClick={onClose} disabled={sending} aria-label="Close"
            className="w-9 h-9 rounded-xl bg-gray-100 flex items-center justify-center text-gray-500 disabled:opacity-40">
            <X size={16} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-2xl bg-gray-50 p-3">
            <p className="text-2xl font-extrabold text-gray-900 tabular-nums">{Number(preview.eligible) || 0}</p>
            <p className="text-xs text-gray-600">customers get it</p>
          </div>
          <div className="rounded-2xl bg-gray-50 p-3">
            <p className="text-2xl font-extrabold text-gray-900 tabular-nums">{formatCoins(coinsOf(cost))}</p>
            <p className="text-xs text-gray-600">{short ? `your Coins cover ${affordable}` : `${formatCoins(coinsOf(balance - cost))} left after`}</p>
          </div>
        </div>

        <div className="space-y-1.5 text-[12.5px] text-gray-700">
          {Number(preview.reminded_recently) > 0 && (
            <p className="flex items-center gap-2"><Check size={15} className="text-emerald-700 flex-shrink-0" />
              {preview.reminded_recently} skipped — already reminded this week</p>
          )}
          <p className="flex items-center gap-2"><Check size={15} className="text-emerald-700 flex-shrink-0" />Anyone who orders before it goes is skipped</p>
          <p className="flex items-center gap-2"><Check size={15} className="text-emerald-700 flex-shrink-0" />Failed messages come back to your wallet</p>
          {short && (
            <p className="text-amber-700 font-semibold">Your wallet covers {affordable} — the rest wait until you top up.</p>
          )}
        </div>

        <div className="space-y-1.5">
          <p className="text-[11px] font-extrabold uppercase tracking-wider text-gray-500">What they get</p>
          <div className="rounded-2xl bg-[#e7ffdb] px-3 pt-2.5 text-[13px] leading-snug text-gray-800">
            <p className="whitespace-pre-line">{msg.text}</p>
            <div className="mt-2 border-t border-[#c7eab4] grid grid-cols-2">
              {msg.buttons.map((label, i) => (
                <span key={label} className={['py-2 text-center text-[12.5px] font-bold text-sky-600', i ? 'border-l border-[#c7eab4]' : ''].join(' ')}>{label}</span>
              ))}
            </div>
          </div>
          <p className="text-[11.5px] text-gray-500">Each customer sees their own name, cart and total.</p>
        </div>

        <button type="button" onClick={onSend} disabled={sending || !Number(preview.eligible) || affordable < 1}
          className="w-full h-[52px] rounded-2xl text-white text-[15px] font-extrabold inline-flex items-center justify-center gap-2
                     active:scale-[0.98] transition-transform disabled:opacity-50"
          style={{ backgroundColor: themeColor }}>
          {sending ? <Loader2 size={17} className="animate-spin" /> : <Send size={16} />}
          {sending
            ? `Sending… ${progress?.sent || 0} sent`
            : `Send to ${Math.min(Number(preview.eligible) || 0, affordable)} customers · ${formatCoins(coinsOf(Math.min(cost, affordable * (Number(preview.price_paise) || 150))))}`}
        </button>
        <button type="button" onClick={onClose} disabled={sending}
          className="w-full text-[13px] font-bold text-gray-500 py-1.5 disabled:opacity-40">Cancel</button>
      </div>
    </div>,
    document.body,
  );
}

export default function RecoveryCard({ slug, pin, themeColor = '#0d9488', storeName = '', sample = null, version = 0, onSent, onSummary }) {
  const [summary, setSummary] = useState(null);   // null = loading; else { ok, data }
  const [preview, setPreview] = useState(null);
  const [saving, setSaving]   = useState(false);
  const [sheet, setSheet]     = useState(false);
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState(null);
  const [notice, setNotice]   = useState(null);   // { ok, text }
  const [langBusy, setLangBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([fetchCartReminderSummary(slug, pin), fetchReminderPreview(slug, pin)]).then(([s, p]) => {
      if (!alive) return;
      setSummary(s);
      setPreview(p);
      onSummary?.(s?.ok ? s.data : null);   // the tab's tiles show the same numbers
    });
    return () => { alive = false; };
  }, [slug, pin, version, onSummary]);

  const toggle = useCallback(async () => {
    if (!summary?.ok) return;
    setSaving(true);
    try {
      const next = await setCartReminders(slug, pin, !summary.data.enabled);
      setSummary({ ok: true, data: { ...summary.data, enabled: next } });
      onSummary?.({ ...summary.data, enabled: next });
    } catch (e) {
      setNotice({ ok: false, text: e?.message || 'Could not change the setting.' });
    } finally {
      setSaving(false);
    }
  }, [slug, pin, summary, onSummary]);

  // English or मराठी for every reminder from now on (the server keeps it).
  const pickLang = useCallback(async (next) => {
    if (!summary?.ok || (summary.data.lang || 'en') === next) return;
    setLangBusy(true);
    try {
      const saved = await setCartReminderLang(slug, pin, next);
      const data = { ...summary.data, lang: saved };
      setSummary({ ok: true, data });
      onSummary?.(data);
    } catch (e) {
      setNotice({ ok: false, text: e?.message || 'Could not change the language.' });
    } finally {
      setLangBusy(false);
    }
  }, [slug, pin, summary, onSummary]);

  async function sendAll() {
    setSending(true);
    setNotice(null);
    try {
      const r = await sendRemindersNow({ slug, pin, onProgress: setProgress });
      let text = r.sent > 0 ? `Sent to ${r.sent} customer${r.sent === 1 ? '' : 's'}.` : 'Nothing was sent.';
      if (r.failed > 0) text += ` ${r.failed} couldn’t be delivered — refunded to your wallet.`;
      if (r.stoppedFor === 'no_balance') text += ' Your wallet ran out — top up to send the rest.';
      if (r.stoppedFor === 'night') text += ' Reminders can be sent 9 am – 9 pm.';
      setNotice({ ok: r.sent > 0 && !r.failed, text });
      setSheet(false);
      onSent?.();
    } catch (e) {
      setNotice({ ok: false, text: e?.message || 'Sending stopped. Please try again.' });
    } finally {
      setSending(false);
      setProgress(null);
    }
  }

  if (summary === null) return <div className="h-56 rounded-2xl bg-white border border-gray-100 animate-pulse" />;
  if (!summary.ok) return null;   // the cart list below still works; the wallet strip offers its own retry

  const s = summary.data;
  const on = s.enabled === true;
  const eligible = Number(preview?.eligible) || 0;
  const night = preview?.night === true;
  const spent = Number(s.spent_paise_30d) || 0;
  const won = Number(s.recovered_value_30d) || 0;
  const wins = Array.isArray(s.wins) ? s.wins.slice(0, 3) : [];
  const lang = s.lang === 'mr' ? 'mr' : 'en';
  // Which language brings more orders, once both have been sent.
  const byLang = s.by_lang && s.by_lang.en && s.by_lang.mr ? s.by_lang : null;
  const bothUsed = byLang && Number(byLang.en.sent) > 0 && Number(byLang.mr.sent) > 0;

  return (
    <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
      <div className="px-4 py-3 flex items-center gap-2" style={{ background: `linear-gradient(135deg, ${themeColor}1f, transparent)` }}>
        <MessageCircle size={15} style={{ color: themeColor }} />
        <span className="text-[11px] font-extrabold uppercase tracking-widest text-gray-700">Win back these carts</span>
      </div>

      <div className="px-4 pt-3.5 pb-4 space-y-3">
        <button type="button" onClick={() => { setNotice(null); setSheet(true); }}
          disabled={!preview || night || eligible === 0}
          className="w-full h-[50px] rounded-xl text-white text-[15px] font-extrabold inline-flex items-center justify-center gap-2
                     active:scale-[0.98] transition-transform disabled:opacity-50"
          style={{ backgroundColor: themeColor }}>
          <Send size={16} /> Send reminder to all
        </button>
        <p className="-mt-1 text-xs text-gray-600 text-center">
          {!preview ? 'Checking who can get one…'
            : night ? 'Reminders can be sent 9 am – 9 pm.'
            : eligible === 0 ? 'Everyone here has been reminded this week, or has ordered.'
            : <><b>{eligible}</b> not reminded yet · <b>{formatCoins(coinsOf(preview.cost_paise))}</b> (3 Coins each)</>}
        </p>

        {notice && (
          <p className={`text-xs font-semibold px-3 py-2 rounded-xl border ${notice.ok
            ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-amber-50 text-amber-700 border-amber-100'}`}>{notice.text}</p>
        )}

        <div className="h-px bg-gray-100" />

        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[13px] font-bold text-gray-900">Send automatically</p>
            <p className="text-[11.5px] text-gray-500 leading-snug">1 hour after a customer leaves checkout · 9 am – 9 pm</p>
          </div>
          <button type="button" role="switch" aria-checked={on} aria-label="Send reminders automatically"
            disabled={saving} onClick={toggle}
            className="relative w-11 h-6 rounded-full transition-colors flex-shrink-0 disabled:opacity-60"
            style={{ backgroundColor: on ? themeColor : '#d1d5db' }}>
            <span className={['absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform',
                              on ? 'translate-x-5' : ''].join(' ')} />
          </button>
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[13px] font-bold text-gray-900">Reminder language</p>
            <p className="text-[11.5px] text-gray-500 leading-snug">Every reminder goes in this language</p>
          </div>
          <div className="inline-flex p-0.5 gap-0.5 rounded-lg bg-gray-100 flex-shrink-0" role="group" aria-label="Reminder language">
            {CART_REMINDER_LANGS.map((l) => {
              const on = lang === l.code;
              return (
                <button key={l.code} type="button" aria-pressed={on} disabled={langBusy} onClick={() => pickLang(l.code)}
                  className={['h-8 px-3 rounded-md text-[12.5px] font-bold transition disabled:opacity-60',
                    on ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'].join(' ')}>
                  {l.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-4 gap-1.5 text-center">
          {[['Sent', s.sent_30d], ['Opened', s.clicked_30d], ['Ordered', s.recovered_30d]].map(([label, n]) => (
            <div key={label} className="rounded-xl bg-gray-50 px-1 py-2">
              <p className="text-base font-extrabold text-gray-900 tabular-nums">{(Number(n) || 0).toLocaleString('en-IN')}</p>
              <p className="text-[10.5px] text-gray-500">{label}</p>
            </div>
          ))}
          <div className="rounded-xl bg-emerald-50 px-1 py-2">
            <p className="text-[15px] font-extrabold text-emerald-700 tabular-nums">{formatINR(won)}</p>
            <p className="text-[10.5px] text-emerald-700">Won back</p>
          </div>
        </div>
        <p className="-mt-1 text-[11px] text-gray-500">
          Last 30 days{spent > 0 ? <> · used <b>{formatCoins(coinsOf(spent))}</b> on reminders → <b className="text-emerald-700">{formatINR(won)}</b> in orders</> : ''}
          {Number(s.via_link_30d) > 0 ? ` · ${s.via_link_30d} through the reminder link` : ''}
        </p>

        {bothUsed && (
          <p className="-mt-1 text-[11px] text-gray-500">
            By language: मराठी <b>{byLang.mr.won} of {byLang.mr.sent}</b> ordered · English <b>{byLang.en.won} of {byLang.en.sent}</b>
          </p>
        )}

        {wins.length > 0 && (
          <div className="rounded-xl border border-emerald-100 bg-emerald-50/40 px-3 py-2 space-y-1">
            <p className="text-[10.5px] font-extrabold uppercase tracking-wider text-emerald-700">Won back</p>
            {wins.map((w, i) => (
              <div key={`${w.at}-${i}`} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate text-gray-700"><b>{w.name}</b> · {w.via_link ? 'via reminder link' : 'ordered after reminder'}</span>
                <span className="flex-shrink-0 text-gray-500 tabular-nums">{formatINR(Number(w.total) || 0)} · {shortDay(w.at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {sheet && preview && (
        <ConfirmSheet preview={preview} sample={sample} storeName={storeName} themeColor={themeColor} lang={lang}
          sending={sending} progress={progress} onSend={sendAll} onClose={() => setSheet(false)} />
      )}
    </div>
  );
}

import { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Send, Play, Check, X, Star, MessageCircle, RefreshCw } from 'lucide-react';
import { CartThumbs } from './CartChat';
import { createReviewInvite, setReviewAskSkip } from '../../utils/reviewService';
import { reviewLink, reviewInviteMessage } from '../../utils/reviewShape';
import { phone10, daysAgo, ASK_WINDOW_DAYS } from '../../utils/reviewAsks';
import { shipmentRef } from '../../utils/deliveryStatus';
import { formatINR } from '../../utils/currency';
import { pinColors } from '../../utils/pinGate';
import { useScrollLock } from '../../hooks/useScrollLock';

/**
 * "Ask for reviews" (founder, 2026-11-16; mockup 4G4RXkGPxexuUZYPDdwZeH).
 * Delivered orders are listed here, so asking no longer means searching Orders
 * and tapping each card. "Send one by one" walks through the ticked customers:
 * WhatsApp opens with the message ready, the shop presses send, comes back, and
 * the next customer is waiting. Free: it goes from the shop's own WhatsApp.
 *
 * The lists come from buildReviewAsks (src/utils/reviewAsks.js).
 */

const LIST_CAP = 8;
const LANG_KEY = (slug) => `pl-review-ask-lang:${slug}`;

function readLang(slug) {
  try { return localStorage.getItem(LANG_KEY(slug)) === 'mr' ? 'mr' : 'en'; } catch { return 'en'; }
}
function saveLang(slug, lang) {
  try { localStorage.setItem(LANG_KEY(slug), lang); } catch { /* private mode: just this visit */ }
}

const itemsLine = (o) => (o.items || [])
  .map((it) => `${it.name}${Number(it.qty) > 1 ? ` × ${it.qty}` : ''}`).join(', ');
const firstName = (o) => String(o.customer_name || '').trim().split(/\s+/)[0] || 'the customer';

// Opens WhatsApp with this order's review link. The tab is opened inside the tap
// (browsers block window.open after an await) and filled once the link exists.
// `opened: false` = the browser blocked the tab: the screen then shows a plain
// link instead of leaving Manage. Throws with the server's reason.
async function openReviewAsk({ o, slug, pin, storeName, lang }) {
  const win = window.open('', '_blank');
  if (win) win.opener = null;
  try {
    const token = await createReviewInvite(slug, pin, o.id);
    const text = reviewInviteMessage({
      customerName: o.customer_name, storeName, link: reviewLink(window.location.origin, token), lang,
    });
    const url = `https://wa.me/91${phone10(o.customer_phone)}?text=${encodeURIComponent(text)}`;
    if (win) win.location.href = url;
    return { url, opened: Boolean(win) };
  } catch (e) {
    if (win) win.close();
    throw e;
  }
}

function Stars({ value = 0 }) {
  return (
    <span className="inline-flex items-center" role="img" aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} size={13} className={n <= Math.round(value) ? 'fill-amber-400 text-amber-400' : 'fill-gray-200 text-gray-300'} />
      ))}
    </span>
  );
}

function LangSwitch({ lang, onChange }) {
  return (
    <span className="inline-flex rounded-full bg-gray-100 p-0.5" role="group" aria-label="Message language">
      {[['en', 'English'], ['mr', 'मराठी']].map(([k, label]) => (
        <button key={k} type="button" onClick={() => onChange(k)} aria-pressed={lang === k}
          className={['h-7 px-3 rounded-full text-[12px] font-bold transition',
            lang === k ? 'bg-gray-900 text-white' : 'text-gray-600 hover:text-gray-900'].join(' ')}>
          {label}
        </button>
      ))}
    </span>
  );
}

function Row({ r, mode, checked, onToggle, onAsk, state, products, btn, now }) {
  const o = r.o;
  const meta = mode === 'ask'
    ? `Delivered ${daysAgo(r.deliveredAt, now)} · #${shipmentRef(o)}`
    : mode === 'asked'
      ? `Asked ${daysAgo(r.askedAt, now)}${r.askCount > 1 ? ` · ${r.askCount} times` : ''} · no review yet`
      : `${r.reviews} review${r.reviews === 1 ? '' : 's'} · #${shipmentRef(o)}`;
  const busy = state?.busy;
  return (
    <li className="flex items-center gap-3 px-4 lg:px-5 py-3 border-t border-gray-100">
      {mode === 'ask' && (
        <input type="checkbox" checked={checked} onChange={onToggle}
          aria-label={`Ask ${o.customer_name || 'this customer'}`}
          className="w-[18px] h-[18px] flex-shrink-0 cursor-pointer" style={{ accentColor: btn }} />
      )}
      <CartThumbs items={o.items || []} products={products} />
      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-bold text-gray-900 truncate">{o.customer_name || 'Customer'}</p>
        <p className="text-[13px] text-gray-600 truncate">{itemsLine(o)}</p>
        <p className="text-[12px] text-gray-500 mt-0.5 truncate inline-flex items-center gap-1.5 max-w-full">
          {mode === 'reviewed' ? <Stars value={r.rating} /> : mode === 'ask' ? <Check size={12} className="text-emerald-600 flex-shrink-0" /> : null}
          <span className="truncate">{meta}</span>
        </p>
        {state?.err && <p className="text-[12px] text-red-600 mt-0.5" role="alert">{state.err}</p>}
        {state?.url && (
          <a href={state.url} target="_blank" rel="noopener noreferrer" className="text-[12.5px] font-bold underline" style={{ color: btn }}>
            WhatsApp didn’t open. Tap here to open it
          </a>
        )}
      </div>
      <span className="hidden sm:block text-[14px] font-extrabold tabular-nums text-gray-900">{formatINR(Number(o.total) || 0)}</span>
      {mode !== 'reviewed' && (
        <button type="button" onClick={() => onAsk(r)} disabled={busy}
          title="Send it yourself on WhatsApp, free"
          className={['h-9 px-3 rounded-xl text-[12.5px] font-bold inline-flex items-center gap-1.5 flex-shrink-0 active:scale-95 disabled:opacity-60',
            mode === 'ask' ? 'border border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100'
              : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50'].join(' ')}>
          {mode === 'ask' ? <Star size={13} className="fill-current" /> : <Send size={13} />}
          {busy ? '…' : mode === 'ask' ? 'Ask' : 'Ask again'}
        </button>
      )}
    </li>
  );
}

/** The full-screen (phone) / centred (computer) walk through the ticked customers. */
function OneByOne({ rows, slug, pin, storeName, lang, onLang, products, btn, now, onAsked, onSkipped, onClose }) {
  useScrollLock(true);
  const [pos, setPos]   = useState(0);
  const [done, setDone] = useState({});        // order id -> 'sent' | 'skipped' | 'hidden'
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState('');
  const [link, setLink] = useState('');        // the WhatsApp link, when the browser blocked the tab

  const cur = rows[pos];
  const finished = !cur;
  const next = (id, how) => {
    setDone((d) => ({ ...d, [id]: how }));
    setErr('');
    setLink('');
    setPos((p) => p + 1);
  };

  async function send() {
    setErr('');
    setBusy(true);
    try {
      const { url, opened } = await openReviewAsk({ o: cur.o, slug, pin, storeName, lang });
      onAsked(cur.id);
      if (opened) next(cur.id, 'sent');
      else { setDone((d) => ({ ...d, [cur.id]: 'sent' })); setLink(url); }
    } catch (e) {
      setErr(e.message || 'Could not create the review link.');
    } finally {
      setBusy(false);
    }
  }

  async function dontAsk() {
    setErr('');
    setBusy(true);
    try {
      await setReviewAskSkip(slug, pin, cur.o.id, true);
      onSkipped(cur.id);
      next(cur.id, 'hidden');
    } catch (e) {
      setErr(e.message || 'Could not save that.');
    } finally {
      setBusy(false);
    }
  }

  const sent = Object.values(done).filter((v) => v === 'sent').length;
  const sentNames = rows.filter((r) => done[r.id] === 'sent').map((r) => firstName(r.o));
  // The real link is made at the tap; the preview shows where it goes.
  const preview = cur ? reviewInviteMessage({
    customerName: cur.o.customer_name, storeName, link: `${window.location.host.replace(/^www\./, '')}/review/…`, lang,
  }) : '';
  const handled = Object.keys(done).length;

  return createPortal(
    <div className="fixed inset-0 z-[70] bg-black/40 lg:grid lg:place-items-center"
         onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label="Send one by one"
           className="bg-white h-full w-full flex flex-col overflow-hidden lg:h-auto lg:max-h-[92vh] lg:w-[440px] lg:rounded-3xl lg:shadow-2xl">
        <header className="px-4 pt-3.5 pb-3 border-b border-gray-100 flex-shrink-0"
                style={{ paddingTop: 'max(14px, env(safe-area-inset-top, 0px))' }}>
          <div className="flex items-center gap-2.5">
            <button type="button" onClick={onClose} aria-label="Close" autoFocus
              className="w-10 h-10 rounded-xl bg-gray-100 grid place-items-center text-gray-700 hover:bg-gray-200 flex-shrink-0">
              <X size={18} />
            </button>
            <div className="flex-1 min-w-0">
              <p className="text-[17px] font-extrabold text-gray-900 leading-tight">Send one by one</p>
              <p className="text-[12.5px] text-gray-600">Free · from your own WhatsApp</p>
            </div>
            <span className="text-[14px] font-extrabold tabular-nums text-gray-900">
              {finished ? `${rows.length} of ${rows.length}` : `${pos + 1} of ${rows.length}`}
            </span>
          </div>
          {rows.length <= 12 ? (
            <div className="mt-3 flex gap-1" aria-hidden="true">
              {rows.map((r, i) => (
                <span key={r.id} className="h-1.5 flex-1 rounded-full"
                  style={{ background: done[r.id] === 'sent' ? '#16a34a' : done[r.id] ? '#d1d5db' : i === pos ? '#f59e0b' : '#e5e7eb' }} />
              ))}
            </div>
          ) : (
            <div className="mt-3 h-1.5 rounded-full bg-gray-200 overflow-hidden" aria-hidden="true">
              <div className="h-full rounded-full bg-emerald-600 transition-all" style={{ width: `${Math.round((handled / rows.length) * 100)}%` }} />
            </div>
          )}
          {sentNames.length > 0 && (
            <div className="mt-2.5 flex gap-1.5 flex-wrap">
              {sentNames.slice(-4).map((n, i) => (
                <span key={`${n}-${i}`} className="text-[12px] font-bold text-emerald-800 bg-emerald-50 rounded-full px-2.5 py-1 inline-flex items-center gap-1">
                  <Check size={12} strokeWidth={3} /> {n} · sent
                </span>
              ))}
              {sentNames.length > 4 && <span className="text-[12px] font-semibold text-gray-500 py-1">+{sentNames.length - 4} more</span>}
            </div>
          )}
        </header>

        {finished ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-6 py-10 gap-3">
            <span className="w-14 h-14 rounded-full bg-emerald-50 text-emerald-600 grid place-items-center"><Check size={28} strokeWidth={3} /></span>
            <p className="text-[19px] font-extrabold text-gray-900">All done</p>
            <p className="text-[14px] text-gray-600 max-w-xs">
              {sent > 0 ? `You asked ${sent} customer${sent === 1 ? '' : 's'}. Their reviews will show here as they come in.` : 'Nobody was asked this time.'}
            </p>
            <button type="button" onClick={onClose}
              className="mt-2 h-12 px-8 rounded-xl text-[15px] font-bold text-white active:scale-[0.98]" style={{ backgroundColor: btn }}>
              Close
            </button>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3.5">
            <div className="flex items-center gap-3.5">
              <CartThumbs items={cur.o.items || []} products={products} />
              <div className="min-w-0">
                <p className="text-[18px] font-extrabold text-gray-900 leading-tight truncate">{cur.o.customer_name || 'Customer'}</p>
                <p className="text-[13.5px] text-gray-700 truncate">{itemsLine(cur.o)} · {formatINR(Number(cur.o.total) || 0)}</p>
                <p className="text-[12.5px] text-gray-600 inline-flex items-center gap-1">
                  <Check size={13} className="text-emerald-600" /> Delivered {daysAgo(cur.deliveredAt, now)} · #{shipmentRef(cur.o)}
                </p>
              </div>
            </div>

            <div className="rounded-2xl bg-[#efeae2] p-3">
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-[12px] font-bold text-gray-600">The message, ready to send</span>
                <LangSwitch lang={lang} onChange={onLang} />
              </div>
              <p className="ml-6 bg-[#d9fdd3] rounded-xl rounded-br px-3 py-2.5 text-[13.5px] leading-relaxed text-gray-900 whitespace-pre-line shadow-[0_1px_1px_rgba(0,0,0,.08)]">
                {preview.replace(/\*/g, '')}
              </p>
            </div>

            {link ? (
              <a href={link} target="_blank" rel="noopener noreferrer" onClick={() => next(cur.id, 'sent')}
                className="w-full h-[52px] rounded-2xl text-[15.5px] font-extrabold text-white flex items-center justify-center gap-2"
                style={{ backgroundColor: '#16a34a' }}>
                <MessageCircle size={18} /> Open WhatsApp for {firstName(cur.o)}
              </a>
            ) : (
              <button type="button" onClick={send} disabled={busy}
                className="w-full h-[52px] rounded-2xl text-[15.5px] font-extrabold text-white flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-60"
                style={{ backgroundColor: '#16a34a' }}>
                <MessageCircle size={18} /> {busy ? 'Making the link…' : `Send to ${firstName(cur.o)} on WhatsApp`}
              </button>
            )}
            {err && <p className="text-[13px] text-red-600 text-center" role="alert">{err}</p>}
            <p className="text-[12.5px] text-gray-600 text-center leading-snug">
              {link ? 'Your browser stopped WhatsApp from opening. Tap the button above.'
                : 'WhatsApp opens with this message. Press send, come back, and the next customer is ready.'}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => next(cur.id, 'skipped')} disabled={busy}
                className="h-11 rounded-xl border border-gray-200 bg-white text-[13.5px] font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-60">
                {link ? 'Next customer' : 'Skip for now'}
              </button>
              <button type="button" onClick={dontAsk} disabled={busy || Boolean(link)}
                className="h-11 rounded-xl border border-gray-200 bg-white text-[13.5px] font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-60 truncate px-2">
                Don’t ask {firstName(cur.o)}
              </button>
            </div>

            {rows.length > pos + 1 && (
              <div className="border-t border-gray-100 pt-3">
                <p className="text-[12.5px] font-extrabold text-gray-700 mb-2">Up next</p>
                <ul className="space-y-2">
                  {rows.slice(pos + 1, pos + 4).map((r) => (
                    <li key={r.id} className="flex items-center gap-2.5">
                      <span className="flex-1 min-w-0 text-[13.5px] font-bold text-gray-800 truncate">{r.o.customer_name || 'Customer'}</span>
                      <span className="text-[12px] text-gray-500 flex-shrink-0">{daysAgo(r.deliveredAt, now)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

export default function ReviewAsks({
  data, error = '', onRetry, slug, pin, storeName = '', products = [], themeColor = '#0d9488',
  onAsked, onSkipped, cardRef = null,
}) {
  const [tab, setTab]           = useState('ask');      // 'ask' | 'asked' | 'reviewed'
  const [unticked, setUnticked] = useState(() => new Set());
  const [showOlder, setShowOlder] = useState(false);
  const [showAll, setShowAll]   = useState(false);
  const [lang, setLangState]    = useState(() => readLang(slug));
  const [rowState, setRowState] = useState({});        // order id -> { busy, err, url }
  const [queue, setQueue]       = useState(null);      // the rows being sent one by one
  const btn = pinColors(themeColor).button;
  const now = Date.now();

  const setLang = (v) => { setLangState(v); saveLang(slug, v); };
  const askRows = useMemo(
    () => (data ? (showOlder ? [...data.toAsk, ...data.older] : data.toAsk) : []),
    [data, showOlder],
  );
  const rows = tab === 'ask' ? askRows : tab === 'asked' ? (data?.asked || []) : (data?.reviewed || []);
  const shown = showAll ? rows : rows.slice(0, LIST_CAP);
  const ticked = askRows.filter((r) => !unticked.has(r.id));

  function toggle(id) {
    setUnticked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }
  function toggleAll() {
    setUnticked(ticked.length === askRows.length ? new Set(askRows.map((r) => r.id)) : new Set());
  }

  async function askOne(r) {
    setRowState((s) => ({ ...s, [r.id]: { busy: true } }));
    try {
      const { url, opened } = await openReviewAsk({ o: r.o, slug, pin, storeName, lang });
      setRowState((s) => ({ ...s, [r.id]: opened ? undefined : { url } }));
      onAsked(r.id);
    } catch (e) {
      setRowState((s) => ({ ...s, [r.id]: { err: e.message || 'Could not create the review link.' } }));
    }
  }

  const head = (
    <div className="px-4 lg:px-5 pt-4 pb-3 flex flex-wrap items-center gap-3">
      <div className="flex-1 min-w-[220px]">
        <h2 className="text-[17px] font-extrabold text-gray-900">Ask for reviews</h2>
        <p className="text-[13px] text-gray-500">Delivered orders, ready to ask. No searching, no copying.</p>
      </div>
      {data && (
        <div className="flex gap-1.5 flex-wrap">
          {[['ask', 'To ask', askRows.length], ['asked', 'Asked, waiting', data.asked.length], ['reviewed', 'Reviewed', data.reviewed.length]].map(([k, label, n]) => {
            const on = tab === k;
            return (
              <button key={k} type="button" aria-pressed={on} onClick={() => { setTab(k); setShowAll(false); }}
                className={['px-3.5 py-1.5 rounded-full text-xs font-semibold border transition',
                  on ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'].join(' ')}>
                {label} <span className={on ? 'opacity-70' : 'text-gray-400'}>{n}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );

  let body;
  if (error) {
    body = (
      <div className="mx-4 lg:mx-5 mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-800 flex items-center gap-3">
        <span className="flex-1">Couldn’t load who was asked: {error}</span>
        {onRetry && (
          <button type="button" onClick={onRetry} className="inline-flex items-center gap-1.5 font-bold text-amber-900">
            <RefreshCw size={13} /> Try again
          </button>
        )}
      </div>
    );
  } else if (!data) {
    body = (
      <ul aria-label="Loading">
        {[0, 1, 2].map((i) => (
          <li key={i} className="flex items-center gap-3 px-4 lg:px-5 py-3 border-t border-gray-100 animate-pulse">
            <span className="w-10 h-10 rounded-lg bg-gray-100" />
            <span className="flex-1 space-y-2"><span className="block h-3 w-1/3 bg-gray-200 rounded" /><span className="block h-3 w-1/2 bg-gray-100 rounded" /></span>
          </li>
        ))}
      </ul>
    );
  } else if (rows.length === 0) {
    const msg = tab === 'ask'
      ? (data.asked.length + data.reviewed.length > 0
        ? `Everyone delivered in the last ${ASK_WINDOW_DAYS} days has been asked.`
        : 'No delivered orders yet. When an order is marked Delivered, it shows here.')
      : tab === 'asked' ? 'Nobody is waiting. Everyone you asked has reviewed, or you have not asked anyone yet.'
        : 'No reviews from your asks yet. They show here as they come in.';
    body = (
      <div className="border-t border-gray-100 px-5 py-8 text-center">
        <p className="text-[14px] font-bold text-gray-800">{msg}</p>
        {tab === 'ask' && data.older.length > 0 && !showOlder && (
          <button type="button" onClick={() => setShowOlder(true)} className="mt-2 text-[13px] font-bold" style={{ color: btn }}>
            Show {data.older.length} older delivered order{data.older.length === 1 ? '' : 's'}
          </button>
        )}
      </div>
    );
  } else {
    body = (
      <>
        {tab === 'ask' && (
          <div className="border-t border-gray-100 bg-gray-50/70 px-4 lg:px-5 py-2.5 flex items-center gap-2.5 flex-wrap">
            <input id="review-ask-all" type="checkbox" checked={ticked.length === askRows.length}
              onChange={toggleAll} className="w-[18px] h-[18px] cursor-pointer" style={{ accentColor: btn }} />
            <label htmlFor="review-ask-all" className="text-[13px] font-bold text-gray-900 cursor-pointer">
              {ticked.length === askRows.length ? `All ${askRows.length} selected` : `${ticked.length} of ${askRows.length} selected`}
            </label>
            <span className="ml-auto text-[12px] text-gray-500">
              {showOlder ? 'All delivered orders' : `Delivered in the last ${ASK_WINDOW_DAYS} days`} · oldest first
            </span>
          </div>
        )}
        <ul>
          {shown.map((r) => (
            <Row key={r.id} r={r} mode={tab} checked={!unticked.has(r.id)} onToggle={() => toggle(r.id)}
              onAsk={askOne} state={rowState[r.id]} products={products} btn={btn} now={now} />
          ))}
        </ul>
        {(rows.length > LIST_CAP && !showAll) || (tab === 'ask' && !showOlder && data.older.length > 0) ? (
          <div className="border-t border-gray-100 px-4 lg:px-5 py-2.5 flex gap-4 flex-wrap">
            {rows.length > LIST_CAP && !showAll && (
              <button type="button" onClick={() => setShowAll(true)} className="text-[13px] font-bold" style={{ color: btn }}>
                Show {rows.length - LIST_CAP} more
              </button>
            )}
            {tab === 'ask' && !showOlder && data.older.length > 0 && (
              <button type="button" onClick={() => setShowOlder(true)} className="text-[13px] font-semibold text-gray-600">
                + {data.older.length} delivered before that, never asked
              </button>
            )}
          </div>
        ) : null}
        {tab === 'ask' && (
          <div className="border-t border-gray-200 bg-gray-50 px-4 lg:px-5 py-3.5 flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[180px]">
              <p className="text-[14px] font-extrabold text-gray-900">{ticked.length} customer{ticked.length === 1 ? '' : 's'} selected</p>
              <p className="text-[12px] text-gray-500">Each gets a link for their own order only</p>
            </div>
            <LangSwitch lang={lang} onChange={setLang} />
            <button type="button" onClick={() => setQueue(ticked)} disabled={ticked.length === 0}
              className="h-12 px-5 rounded-xl text-[14.5px] font-extrabold text-white inline-flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-50 w-full sm:w-auto"
              style={{ backgroundColor: btn }}>
              <Play size={15} className="fill-current" /> Send one by one · free
            </button>
          </div>
        )}
      </>
    );
  }

  return (
    <section ref={cardRef} className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden scroll-mt-24">
      {head}
      {body}
      {queue && (
        <OneByOne rows={queue} slug={slug} pin={pin} storeName={storeName} lang={lang} onLang={setLang}
          products={products} btn={btn} now={now}
          onAsked={onAsked} onSkipped={onSkipped}
          onClose={() => setQueue(null)} />
      )}
    </section>
  );
}

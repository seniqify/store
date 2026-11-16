import { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Send, Play, Check, X, Star, MessageCircle, RefreshCw, ShoppingBag } from 'lucide-react';
import { createReviewInvite, setReviewAskSkip, askAllReviews } from '../../utils/reviewService';
import { reviewLink, reviewInviteMessage } from '../../utils/reviewShape';
import { phone10, daysAgo, orderImage, ASK_WINDOW_DAYS } from '../../utils/reviewAsks';
import { shipmentRef } from '../../utils/deliveryStatus';
import { formatINR } from '../../utils/currency';
import { coinsOf, formatCoins } from '../../utils/walletPacks';
import { pinColors } from '../../utils/pinGate';
import { useScrollLock } from '../../hooks/useScrollLock';

/**
 * "Ask for reviews" (founder, 2026-11-16; mockup 4G4RXkGPxexuUZYPDdwZeH).
 * Delivered orders are listed here, so asking no longer means searching Orders.
 *
 *   Ask all N on WhatsApp   PocketLink sends each ticked customer the review
 *                           request from its WhatsApp, 1 Coin each
 *                           (review-asks-now). Starts once WhatsApp approves
 *                           the template (`ready`).
 *   Send one by one · free  WhatsApp opens on the shop's phone with the message
 *                           ready for each ticked customer; press send, come
 *                           back, the next one is waiting.
 *
 * On a phone the "N customers to ask" card comes first and the list opens from
 * "See the N orders". The lists come from buildReviewAsks (utils/reviewAsks.js).
 */

const LIST_CAP = 8;
const WA_GREEN = '#16a34a';
const LANG_KEY = (slug) => `pl-review-ask-lang:${slug}`;

function readLang(slug, fallback) {
  try {
    const v = localStorage.getItem(LANG_KEY(slug));
    return v === 'mr' || v === 'en' ? v : fallback;
  } catch { return fallback; }
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

function Pic({ src, size = 46, round = false, className = '' }) {
  const shape = round ? 'rounded-full' : 'rounded-[10px]';
  return src ? (
    <img src={src} alt="" className={`${shape} object-cover border border-gray-100 flex-shrink-0 bg-gray-50 ${className}`} style={{ width: size, height: size }} />
  ) : (
    <span className={`${shape} bg-gray-100 text-gray-400 grid place-items-center flex-shrink-0 ${className}`} style={{ width: size, height: size }}>
      <ShoppingBag size={Math.round(size * 0.38)} />
    </span>
  );
}

function LangSwitch({ lang, onChange }) {
  return (
    <span className="inline-flex rounded-full bg-white p-0.5" role="group" aria-label="Message language">
      {[['en', 'English'], ['mr', 'मराठी']].map(([k, label]) => (
        <button key={k} type="button" onClick={() => onChange(k)} aria-pressed={lang === k}
          className={['h-[26px] px-2.5 rounded-full text-[12px] font-bold transition',
            lang === k ? 'bg-gray-900 text-white' : 'text-gray-700 hover:text-gray-900'].join(' ')}>
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
    <li className="flex items-center gap-3.5 px-4 lg:px-5 py-3 border-t border-gray-100">
      {mode === 'ask' && (
        <input type="checkbox" checked={checked} onChange={onToggle}
          aria-label={`Ask ${o.customer_name || 'this customer'}`}
          className="w-[18px] h-[18px] flex-shrink-0 cursor-pointer" style={{ accentColor: btn }} />
      )}
      <Pic src={orderImage(o, products)} />
      <div className="flex-1 min-w-0">
        <p className="text-[14px] font-bold text-gray-900 truncate">{o.customer_name || 'Customer'}</p>
        <p className="text-[13px] text-gray-600 truncate">{itemsLine(o)}</p>
        <p className="text-[12px] text-gray-500 mt-0.5 flex items-center gap-1.5 min-w-0">
          {mode === 'reviewed'
            ? <span className="text-amber-700 font-extrabold flex-shrink-0">{'★'.repeat(Math.round(r.rating))}{'☆'.repeat(5 - Math.round(r.rating))}</span>
            : mode === 'ask' ? <Check size={13} strokeWidth={2.6} className="text-emerald-600 flex-shrink-0" /> : null}
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
          aria-label={`Ask ${o.customer_name || 'this customer'} yourself on WhatsApp`}
          title="Send it yourself on WhatsApp, free"
          className={['h-9 px-3 rounded-[10px] text-[12.5px] font-bold inline-flex items-center gap-1.5 flex-shrink-0 active:scale-95 disabled:opacity-60',
            mode === 'ask' ? 'border border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100'
              : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50'].join(' ')}>
          {mode === 'ask' ? <Star size={14} className="fill-current" /> : <Send size={13} />}
          {busy ? '…' : mode === 'ask' ? 'Ask' : 'Ask again'}
        </button>
      )}
    </li>
  );
}

/** "Ask all": the cost, then PocketLink sends. */
function AskAllSheet({ count, total, balancePaise, lang, sending, progress, result, err, onSend, onClose, btn }) {
  useScrollLock(true);
  const cost = count * 50;
  const short = cost > (Number(balancePaise) || 0);
  const covers = coinsOf(balancePaise);
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-black/40" role="dialog" aria-modal="true" aria-label="Ask all on WhatsApp"
         onKeyDown={(e) => { if (e.key === 'Escape' && !sending) onClose(); }}>
      <div className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl px-5 pt-3 pb-6 space-y-4 max-h-[92vh] overflow-y-auto">
        <div className="w-10 h-1 rounded-full bg-gray-300 mx-auto sm:hidden" />
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-extrabold text-gray-900">Ask {count} customer{count === 1 ? '' : 's'} on WhatsApp</h3>
            <p className="text-[12.5px] text-gray-600 mt-0.5">From PocketLink’s WhatsApp, with your shop’s name · {lang === 'mr' ? 'मराठी' : 'English'}</p>
          </div>
          <button type="button" onClick={onClose} disabled={sending} aria-label="Close" autoFocus
            className="w-9 h-9 rounded-xl bg-gray-100 flex items-center justify-center text-gray-600 disabled:opacity-40">
            <X size={16} />
          </button>
        </div>
        {result ? (
          <div className="space-y-2 text-[14px] text-gray-800">
            <p className="text-[16px] font-extrabold text-gray-900">Sent to {result.sent} customer{result.sent === 1 ? '' : 's'}</p>
            {result.failed > 0 && <p>{result.failed} could not be sent (not on WhatsApp). Their Coins came back.</p>}
            {result.stoppedFor === 'no_balance' && <p className="text-amber-800 font-semibold">Your Coins ran out. Add Coins to ask the rest.</p>}
            {result.stoppedFor === 'night' && <p className="text-amber-800 font-semibold">It’s night now. The rest can go after 9 am.</p>}
            {result.skipped > 0 && !result.stoppedFor && <p>{result.skipped} skipped: already asked, or they asked to stop messages.</p>}
            <button type="button" onClick={onClose} className="w-full h-12 rounded-xl text-white text-[15px] font-bold" style={{ backgroundColor: btn }}>Done</button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-2xl bg-gray-50 p-3">
                <p className="text-2xl font-extrabold text-gray-900 tabular-nums">{formatCoins(count)}</p>
                <p className="text-xs text-gray-600">1 Coin each</p>
              </div>
              <div className="rounded-2xl bg-gray-50 p-3">
                <p className="text-2xl font-extrabold text-gray-900 tabular-nums">{formatCoins(covers)}</p>
                <p className="text-xs text-gray-600">{short ? `cover ${covers} of them` : 'in your wallet'}</p>
              </div>
            </div>
            <div className="space-y-1.5 text-[12.5px] text-gray-700">
              <p className="flex items-center gap-2"><Check size={15} className="text-emerald-700 flex-shrink-0" />Each gets a link for their own order only</p>
              <p className="flex items-center gap-2"><Check size={15} className="text-emerald-700 flex-shrink-0" />Anyone already asked, or who asked to stop, is skipped</p>
              <p className="flex items-center gap-2"><Check size={15} className="text-emerald-700 flex-shrink-0" />Failed messages come back to your wallet</p>
              {short && <p className="text-amber-700 font-semibold">Your Coins cover {covers}. The rest wait until you add Coins.</p>}
            </div>
            {err && <p className="text-[13px] text-red-600" role="alert">{err}</p>}
            <button type="button" onClick={onSend} disabled={sending || covers === 0}
              className="w-full h-[52px] rounded-2xl text-white text-[15.5px] font-extrabold inline-flex items-center justify-center gap-2 disabled:opacity-60"
              style={{ backgroundColor: WA_GREEN }}>
              <Send size={17} /> {sending ? `Sending… ${progress?.sent || 0} of ${total || count} sent` : `${err ? `Send to the other ${count}` : 'Send'} · ${formatCoins(Math.min(count, covers))}`}
            </button>
            {sending && <p className="text-[12px] text-gray-600 text-center">About a second each. Keep this open until it finishes.</p>}
          </>
        )}
      </div>
    </div>,
    document.body,
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
                <span key={r.id} className="h-[5px] flex-1 rounded-full"
                  style={{ background: done[r.id] === 'sent' ? WA_GREEN : done[r.id] ? '#d1d5db' : i === pos ? '#f59e0b' : '#e5e7eb' }} />
              ))}
            </div>
          ) : (
            <div className="mt-3 h-[5px] rounded-full bg-gray-200 overflow-hidden" aria-hidden="true">
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
              <Pic src={orderImage(cur.o, products)} size={64} className="rounded-[14px]" />
              <div className="min-w-0">
                <p className="text-[19px] font-extrabold text-gray-900 leading-tight truncate">{cur.o.customer_name || 'Customer'}</p>
                <p className="text-[13.5px] text-gray-700 truncate">{itemsLine(cur.o)} · {formatINR(Number(cur.o.total) || 0)}</p>
                <p className="text-[12.5px] text-gray-600 inline-flex items-center gap-1">
                  <Check size={13} strokeWidth={2.6} className="text-emerald-600" /> Delivered {daysAgo(cur.deliveredAt, now)} · #{shipmentRef(cur.o)}
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
                className="w-full h-[54px] rounded-2xl text-[16px] font-extrabold text-white flex items-center justify-center gap-2.5"
                style={{ backgroundColor: WA_GREEN }}>
                <MessageCircle size={19} /> Open WhatsApp for {firstName(cur.o)}
              </a>
            ) : (
              <button type="button" onClick={send} disabled={busy}
                className="w-full h-[54px] rounded-2xl text-[16px] font-extrabold text-white flex items-center justify-center gap-2.5 active:scale-[0.98] disabled:opacity-60"
                style={{ backgroundColor: WA_GREEN }}>
                <MessageCircle size={19} /> {busy ? 'Making the link…' : `Send to ${firstName(cur.o)} on WhatsApp`}
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
                      <Pic src={orderImage(r.o, products)} size={32} className="rounded-lg" />
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
  onAsked, onSkipped, cardRef = null, ready = false, auto = null, onSpent, phoneMiddle = null,
  listOpen = false, onListOpen, tab: tabProp, onTab,
}) {
  const [tabState, setTabState] = useState('ask');      // 'ask' | 'asked' | 'reviewed'
  const tab = tabProp || tabState;
  const setTab = (t) => { setTabState(t); onTab?.(t); };
  const [unticked, setUnticked] = useState(() => new Set());
  const [showOlder, setShowOlder] = useState(false);
  const [showAll, setShowAll]   = useState(false);
  const [lang, setLangState]    = useState(() => readLang(slug, auto?.lang === 'mr' ? 'mr' : 'en'));
  const [rowState, setRowState] = useState({});        // order id -> { busy, err, url }
  const [queue, setQueue]       = useState(null);      // the rows being sent one by one
  const [askAll, setAskAll]     = useState(null);      // { rows, sending, progress, result, err }
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
  const autoLang = auto?.lang === 'mr' ? 'mr' : 'en';

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

  async function sendAll() {
    const ids = askAll.rows.map((r) => r.o.id);
    setAskAll((a) => ({ ...a, sending: true, err: '', progress: { sent: 0 }, total: ids.length }));
    // Ten at a time (askAllReviews): each batch moves to "Asked, waiting" as it goes.
    const onProgress = (p) => {
      (p.sentIds || []).forEach((id) => onAsked(id, 'all'));
      setAskAll((a) => (a ? { ...a, progress: p } : a));
    };
    try {
      const res = await askAllReviews(slug, pin, ids, autoLang, onProgress);
      setAskAll((a) => ({ ...a, sending: false, result: res }));
    } catch (e) {
      // Stopped part-way: offer the rest. The ones already sent are off the list,
      // and the server skips anyone asked meanwhile, so nobody gets it twice.
      const done = new Set((e.partial?.sentIds || []).map(String));
      setAskAll((a) => ({
        ...a, sending: false, err: e.message || 'Sending stopped. Please try again.',
        rows: a.rows.filter((r) => !done.has(String(r.o.id))),
      }));
    } finally {
      onSpent?.();
    }
  }

  const askAllButton = (list, phone = false) => (
    <button type="button" onClick={() => setAskAll({ rows: list })} disabled={!ready || list.length === 0}
      className={['rounded-xl text-white font-extrabold inline-flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-50',
        phone ? 'w-full h-[52px] rounded-[14px] text-[15.5px]' : 'h-[46px] px-[18px] text-[14.5px] w-full sm:w-auto'].join(' ')}
      style={{ backgroundColor: WA_GREEN }}>
      <Send size={phone ? 17 : 16} /> Ask all {list.length} on WhatsApp
      <span className="bg-white/25 rounded-lg px-2 py-[3px] text-[12.5px]">{formatCoins(list.length)}</span>
    </button>
  );
  const oneByOneButton = (list, phone = false) => (
    <button type="button" onClick={() => setQueue(list)} disabled={list.length === 0}
      className={['rounded-xl border border-gray-300 bg-white text-gray-900 font-bold inline-flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-50',
        phone ? 'w-full h-[46px] rounded-[14px] text-[14.5px]' : 'h-[46px] px-4 text-[14px] w-full sm:w-auto'].join(' ')}>
      <Play size={14} className="fill-current" /> {phone ? 'Send one by one yourself · free' : 'Send one by one · free'}
    </button>
  );
  const notReadyNote = !ready && (
    <p className="text-[12px] text-amber-800 font-semibold">“Ask all” starts when WhatsApp approves the message. “Send one by one” works now.</p>
  );

  // ── Phone: "N customers to ask" ────────────────────────────────────────────
  const n = data ? data.toAsk.length : 0;
  const pics = data ? data.toAsk.slice(0, 3).map((r) => orderImage(r.o, products)) : [];
  const phoneSummary = (
    <section className="lg:hidden rounded-[18px] border border-amber-200 bg-white shadow-sm p-4">
      {!data ? (
        <div className="h-24 animate-pulse rounded-xl bg-gray-50" aria-label="Loading" />
      ) : n === 0 ? (
        <div>
          <h2 className="text-[17px] font-extrabold text-gray-900">Nobody to ask right now</h2>
          <p className="text-[12.5px] text-gray-600 mt-0.5">When an order is delivered, it shows here.</p>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3">
            <div className="flex flex-shrink-0">
              {pics.map((src, i) => (
                <Pic key={i} src={src} size={38} round className={['border-2 border-white', i ? '-ml-3' : ''].join(' ')} />
              ))}
              {n > 3 && (
                <span className="-ml-3 w-[38px] h-[38px] rounded-full border-2 border-white bg-amber-100 text-amber-800 text-[12px] font-extrabold grid place-items-center">+{n - 3}</span>
              )}
            </div>
            <div className="min-w-0">
              <h2 className="text-[17px] font-extrabold text-gray-900 leading-tight">{n} customer{n === 1 ? '' : 's'} to ask</h2>
              <p className="text-[12.5px] text-gray-600 mt-0.5">Their orders were delivered. Nobody has asked them yet.</p>
            </div>
          </div>
          <div className="mt-3.5">{askAllButton(data.toAsk, true)}</div>
          <div className="mt-2">{oneByOneButton(data.toAsk, true)}</div>
          {!ready && <div className="mt-2">{notReadyNote}</div>}
          <button type="button" onClick={() => { setTab('ask'); onListOpen?.(!listOpen); }}
            className="mt-2.5 w-full text-center text-[13px] font-bold" style={{ color: btn }}>
            {listOpen ? 'Hide the orders' : `See the ${n} order${n === 1 ? '' : 's'}`}
          </button>
        </>
      )}
    </section>
  );

  // ── The list ───────────────────────────────────────────────────────────────
  const head = (
    <div className="px-4 lg:px-5 pt-[18px] pb-3.5 flex flex-wrap items-center gap-3">
      <div className="flex-1 min-w-[220px]">
        <h2 className="text-[18px] font-extrabold text-gray-900">Ask for reviews</h2>
        <p className="text-[13px] text-gray-500 mt-0.5">Delivered orders, ready to ask. No searching, no copying.</p>
      </div>
      {data && (
        <div className="flex gap-1.5 flex-wrap">
          {[['ask', 'To ask', askRows.length], ['asked', 'Asked, waiting', data.asked.length], ['reviewed', 'Reviewed', data.reviewed.length]].map(([k, label, c]) => {
            const on = tab === k;
            return (
              <button key={k} type="button" aria-pressed={on} onClick={() => { setTab(k); setShowAll(false); }}
                className={['h-8 px-3.5 rounded-full text-[12.5px] border transition',
                  on ? 'bg-gray-900 text-white border-gray-900 font-bold' : 'bg-white text-gray-700 border-gray-200 hover:border-gray-300 font-semibold'].join(' ')}>
                {label} · {c}
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
            <span className="w-[46px] h-[46px] rounded-[10px] bg-gray-100" />
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
          <div className="border-t border-gray-100 bg-gray-50/80 px-4 lg:px-5 py-2.5 flex items-center gap-2.5 flex-wrap">
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
          <div className="border-t border-gray-200 bg-gray-50 px-4 lg:px-5 py-3.5 space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-[200px]">
                <p className="text-[14px] font-extrabold text-gray-900">{ticked.length} customer{ticked.length === 1 ? '' : 's'} selected</p>
                <p className="text-[12px] text-gray-500">Each gets a link for their own order only</p>
              </div>
              {oneByOneButton(ticked)}
              {askAllButton(ticked)}
            </div>
            {notReadyNote}
          </div>
        )}
      </>
    );
  }

  return (
    <>
      {phoneSummary}
      {phoneMiddle && <div className="lg:hidden space-y-3">{phoneMiddle}</div>}
      <section ref={cardRef}
        className={['rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden scroll-mt-24', listOpen ? '' : 'hidden lg:block'].join(' ')}>
        {head}
        {body}
      </section>
      {queue && (
        <OneByOne rows={queue} slug={slug} pin={pin} storeName={storeName} lang={lang} onLang={setLang}
          products={products} btn={btn} now={now}
          onAsked={onAsked} onSkipped={onSkipped}
          onClose={() => setQueue(null)} />
      )}
      {askAll && (
        <AskAllSheet count={askAll.rows.length} total={askAll.total} balancePaise={auto?.balance_paise} lang={autoLang}
          sending={askAll.sending} progress={askAll.progress} result={askAll.result} err={askAll.err}
          onSend={sendAll} onClose={() => setAskAll(null)} btn={btn} />
      )}
    </>
  );
}

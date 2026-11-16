import { createPortal } from 'react-dom';
import { Zap, ChevronLeft, ChevronRight, X, ExternalLink, Star } from 'lucide-react';
import { Switch } from './ShipUpdates';
import { coinsOf, formatCoins } from '../../utils/walletPacks';
import { reviewAskMessage } from '../../utils/reviewAskText';
import { useScrollLock } from '../../hooks/useScrollLock';

/**
 * "Ask automatically" (founder, 2026-11-16; mockup 4G4RXkGPxexuUZYPDdwZeH):
 *   AutoCard        the card in the left column on a computer
 *   AutoRow         the row on the phone; opens AutoSheet
 *   AutoSheet       the full settings screen on the phone
 *   CustomerPreview what the customer gets on WhatsApp (the template, filled in)
 *
 * `auto` is get_review_ask_auto's answer ({ on, days, lang, couriers, manual,
 * balance_paise, auto_30d, auto_reviewed_30d }), or null while loading.
 * Until WhatsApp approves the template (`ready` false) the switch still saves,
 * and a line says nothing goes out yet.
 */

const DAYS = [1, 2, 3, 5];
const langName = (l) => (l === 'mr' ? 'मराठी' : 'English');
const daysAfter = (d) => `${d} day${d === 1 ? '' : 's'} after delivery`;

function CoinGlyph({ size = 22 }) {
  return (
    <span aria-hidden="true" className="rounded-full bg-amber-400 flex-shrink-0"
      style={{ width: size, height: size, boxShadow: 'inset 0 0 0 3px #f59e0b' }} />
  );
}

function ZapTile({ size = 36 }) {
  return (
    <span className="rounded-[10px] bg-emerald-50 text-emerald-700 grid place-items-center flex-shrink-0" style={{ width: size, height: size }}>
      <Zap size={Math.round(size / 2)} />
    </span>
  );
}

function NotReady() {
  return (
    <p className="text-[12px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
      Starts when WhatsApp approves the message. Your choices are saved.
    </p>
  );
}

/** Computer: the card under the rating panel. */
export function AutoCard({ auto, ready, busy, err, btn, onChange, onPreview }) {
  const on = Boolean(auto?.on);
  const chip = (sel) => ['h-[34px] rounded-[10px] text-[12.5px] transition',
    sel ? 'font-bold text-white' : 'font-semibold text-gray-700 border border-gray-200 bg-white hover:bg-gray-50'].join(' ');
  return (
    <section className="rounded-2xl border border-emerald-200 bg-white shadow-sm px-5 py-[18px]">
      <div className="flex items-start gap-2.5">
        <ZapTile size={34} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <h2 className="text-[15px] font-extrabold text-gray-900 whitespace-nowrap">Ask automatically</h2>
            <span className="text-[10px] font-extrabold text-orange-800 bg-orange-100 rounded-full px-1.5 py-[2px]">NEW</span>
          </div>
          <p className="mt-1 text-[12.5px] text-gray-600 leading-relaxed">
            After an order is delivered, PocketLink sends the customer a WhatsApp with a review link for that order.
          </p>
        </div>
        <Switch on={on} disabled={!auto || busy} color={btn} label="Ask automatically" onClick={() => onChange({ on: !on })} />
      </div>
      {!ready && <div className="mt-3"><NotReady /></div>}

      <p className="mt-3.5 text-[12px] font-bold text-gray-700">When</p>
      <div className="mt-1.5 grid grid-cols-4 gap-1.5">
        {DAYS.map((d) => {
          const sel = auto?.days === d;
          return (
            <button key={d} type="button" aria-pressed={sel} disabled={!auto || busy} onClick={() => onChange({ days: d })}
              className={chip(sel)} style={sel ? { backgroundColor: btn } : undefined}>
              {d} day{d === 1 ? '' : 's'}
            </button>
          );
        })}
      </div>
      <p className="mt-1 text-[11.5px] text-gray-500">after delivery, at 11 am, so it never arrives at night</p>

      <p className="mt-3 text-[12px] font-bold text-gray-700">Language</p>
      <div className="mt-1.5 grid grid-cols-2 gap-1.5">
        {['en', 'mr'].map((l) => {
          const sel = (auto?.lang || 'en') === l;
          return (
            <button key={l} type="button" aria-pressed={sel} disabled={!auto || busy} onClick={() => onChange({ lang: l })}
              className={chip(sel)} style={sel ? { backgroundColor: btn } : undefined}>
              {langName(l)}
            </button>
          );
        })}
      </div>
      <button type="button" onClick={onPreview} className="mt-2 inline-flex items-center gap-1 text-[12.5px] font-bold" style={{ color: btn }}>
        See what the customer gets <ChevronRight size={14} />
      </button>

      <div className="mt-3.5 flex items-center gap-2.5 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
        <CoinGlyph />
        <p className="text-[12.5px] text-amber-900 leading-snug">
          <b>1 Coin</b> per customer · you have <b className="whitespace-nowrap">{formatCoins(coinsOf(auto?.balance_paise))}</b><br />
          <span className="text-amber-800">No Coins left? It pauses, nothing is lost.</span>
        </p>
      </div>
      <p className="mt-2.5 text-[11.5px] text-gray-500 leading-relaxed">
        Never asks the same order twice, never asks anyone who asked to stop, and skips cancelled or returned orders.
      </p>
      {err && <p className="mt-2 text-[12px] text-red-600" role="alert">{err}</p>}
    </section>
  );
}

/** Phone: the row under "N customers to ask". Tapping it opens AutoSheet. */
export function AutoRow({ auto, busy, btn, onOpen, onChange }) {
  const on = Boolean(auto?.on);
  return (
    <section className="rounded-[18px] border border-emerald-200 bg-white shadow-sm px-4 py-3.5 flex items-center gap-3">
      <ZapTile size={38} />
      <button type="button" onClick={onOpen} className="flex-1 min-w-0 text-left">
        <span className="block text-[14.5px] font-extrabold text-gray-900">Ask automatically</span>
        <span className="block text-[12.5px] text-gray-600 leading-snug">
          {auto ? `${daysAfter(auto.days)} · ${langName(auto.lang)} · 1 Coin each` : 'Loading…'}
        </span>
      </button>
      <Switch on={on} disabled={!auto || busy} color={btn} label="Ask automatically" onClick={() => onChange({ on: !on })} />
    </section>
  );
}

/** Phone: the full settings screen. */
export function AutoSheet({ auto, ready, busy, err, btn, onChange, onClose, onPreview, onAddCoins }) {
  useScrollLock(true);
  const on = Boolean(auto?.on);
  const opt = (sel) => ['h-11 rounded-xl text-[13.5px] transition',
    sel ? 'border-2 font-extrabold' : 'border border-gray-200 bg-white font-semibold text-gray-700'].join(' ');
  const selStyle = { borderColor: btn, background: `${btn}12`, color: btn };
  const asked = Number(auto?.auto_30d) || 0;
  const wrote = Number(auto?.auto_reviewed_30d) || 0;
  return createPortal(
    <div className="fixed inset-0 z-[70] bg-[#f4f5f4] flex flex-col" role="dialog" aria-modal="true" aria-label="Ask automatically"
         onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-2.5 flex-shrink-0"
              style={{ paddingTop: 'max(12px, env(safe-area-inset-top, 0px))' }}>
        <button type="button" onClick={onClose} aria-label="Back" autoFocus
          className="w-10 h-10 rounded-xl bg-gray-100 grid place-items-center text-gray-700">
          <ChevronLeft size={18} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-[17px] font-extrabold text-gray-900 leading-tight">Ask automatically</p>
          <p className="text-[12.5px] text-gray-600">Also in WhatsApp → Automatic messages</p>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-3.5 space-y-3">
        <section className="rounded-[18px] border border-emerald-200 bg-white px-4 py-3.5 flex items-center gap-3">
          <ZapTile size={40} />
          <div className="flex-1 min-w-0">
            <p className="text-[15px] font-extrabold text-gray-900">{on ? 'On' : 'Off'}</p>
            <p className="text-[12.5px] text-gray-600">{on ? 'Every delivered order is asked once' : 'Turn on to ask after every delivery'}</p>
          </div>
          <Switch on={on} disabled={!auto || busy} color={btn} label="Ask automatically" onClick={() => onChange({ on: !on })} />
        </section>
        {!ready && <NotReady />}

        <section className="rounded-[18px] border border-gray-100 bg-white px-4 py-3.5">
          <p className="text-[13.5px] font-extrabold text-gray-900">When to ask</p>
          <p className="text-[12px] text-gray-600 mt-0.5">Counted from the day it was delivered. Sent at 11 am.</p>
          <div className="mt-2.5 grid grid-cols-2 gap-2">
            {DAYS.map((d) => {
              const sel = auto?.days === d;
              return (
                <button key={d} type="button" aria-pressed={sel} disabled={!auto || busy} onClick={() => onChange({ days: d })}
                  className={opt(sel)} style={sel ? selStyle : undefined}>
                  {d === 1 ? 'Next day' : `After ${d} days`}
                </button>
              );
            })}
          </div>
          <p className="text-[12px] text-gray-600 mt-2">Food: 1–2 days. Clothes or gifts: 3–5 days, once they’ve used it.</p>
        </section>

        <section className="rounded-[18px] border border-gray-100 bg-white px-4 py-3.5">
          <p className="text-[13.5px] font-extrabold text-gray-900">Language</p>
          <div className="mt-2.5 grid grid-cols-2 gap-2">
            {['en', 'mr'].map((l) => {
              const sel = (auto?.lang || 'en') === l;
              return (
                <button key={l} type="button" aria-pressed={sel} disabled={!auto || busy} onClick={() => onChange({ lang: l })}
                  className={opt(sel)} style={sel ? selStyle : undefined}>
                  {langName(l)}
                </button>
              );
            })}
          </div>
          <button type="button" onClick={onPreview} className="mt-2.5 inline-flex items-center gap-1 text-[13px] font-bold" style={{ color: btn }}>
            See what the customer gets <ChevronRight size={14} />
          </button>
        </section>

        <section className="rounded-[18px] border border-gray-100 bg-white px-4 py-3.5">
          <p className="text-[13.5px] font-extrabold text-gray-900">Which orders</p>
          {[['couriers', 'Delivered by courier (Delhivery, Shadowfax)'], ['manual', 'Orders you mark Delivered yourself']].map(([k, label]) => (
            <label key={k} className="mt-2.5 flex items-center gap-2.5 text-[13.5px] text-gray-900">
              <input type="checkbox" checked={Boolean(auto?.[k])} disabled={!auto || busy}
                onChange={() => onChange({ [k]: !auto?.[k] })}
                className="w-[18px] h-[18px]" style={{ accentColor: btn }} />
              {label}
            </label>
          ))}
        </section>

        <section className="rounded-[18px] border border-amber-200 bg-amber-50 px-4 py-3 flex items-center gap-3">
          <CoinGlyph size={26} />
          <p className="flex-1 min-w-0 text-[13px] text-amber-900 leading-snug">
            <b>1 Coin</b> per customer<br />You have <b>{formatCoins(coinsOf(auto?.balance_paise))}</b>
          </p>
          <button type="button" onClick={onAddCoins} className="h-[38px] px-3 rounded-[10px] bg-gray-900 text-white text-[13px] font-bold">Add Coins</button>
        </section>

        {err && <p className="text-[12.5px] text-red-600 px-1" role="alert">{err}</p>}
        <p className="text-[12px] text-gray-600 leading-relaxed px-1">
          {asked > 0 ? `Last 30 days: ${asked} asked automatically, ${wrote} wrote a review. ` : ''}
          Never asks one order twice, never asks anyone who asked to stop, and skips cancelled or returned orders.
        </p>
      </div>
    </div>,
    document.body,
  );
}

/** What the customer gets: PocketLink's WhatsApp, the approved template, filled in. */
export function CustomerPreview({ lang, onLang, storeName, sample, onClose }) {
  useScrollLock(true);
  const msg = reviewAskMessage(lang, { name: sample?.name, store: storeName, item: sample?.item });
  const tapNote = lang === 'mr'
    ? `“${msg.button}” दाबल्यावर त्यांच्या ऑर्डरचे पेज उघडते:`
    : `Tapping “${msg.button}” opens the page for their own order:`;
  return createPortal(
    <div className="fixed inset-0 z-[75] bg-black/40 lg:grid lg:place-items-center"
         onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label="What the customer gets"
           className="bg-[#efeae2] h-full w-full flex flex-col overflow-hidden lg:h-[760px] lg:max-h-[92vh] lg:w-[400px] lg:rounded-3xl lg:shadow-2xl">
        <header className="bg-[#075e54] text-white px-3.5 py-3 flex items-center gap-2.5 flex-shrink-0"
                style={{ paddingTop: 'max(12px, env(safe-area-inset-top, 0px))' }}>
          <button type="button" onClick={onClose} aria-label="Close" autoFocus className="w-8 h-8 grid place-items-center rounded-full hover:bg-white/10">
            <X size={18} />
          </button>
          <span aria-hidden="true" className="w-[38px] h-[38px] rounded-full bg-white text-emerald-700 font-extrabold text-[13px] grid place-items-center">PL</span>
          <div className="flex-1 min-w-0">
            <p className="text-[16px] font-bold leading-tight">PocketLink</p>
            <p className="text-[12px] text-white/85">Business account · what {sample?.name ? String(sample.name).split(' ')[0] : 'the customer'} gets</p>
          </div>
        </header>
        <div className="bg-white/90 px-3 py-2 flex items-center justify-center gap-2 flex-shrink-0">
          {['en', 'mr'].map((l) => (
            <button key={l} type="button" aria-pressed={lang === l} onClick={() => onLang(l)}
              className={['h-7 px-3 rounded-full text-[12px] font-bold', lang === l ? 'bg-gray-900 text-white' : 'text-gray-600 bg-gray-100'].join(' ')}>
              {langName(l)}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto px-3 pt-3 pb-4 flex flex-col gap-2">
          <span className="self-center bg-white text-gray-600 text-[12px] font-semibold rounded-lg px-2.5 py-1 shadow-[0_1px_1px_rgba(0,0,0,.06)]">Today</span>
          <div className="max-w-[86%]">
            <div className="bg-white rounded-t-xl rounded-tl px-3 pt-2.5 pb-1.5 text-[14px] leading-normal text-gray-900 shadow-[0_1px_1px_rgba(0,0,0,.08)]">
              <p className="whitespace-pre-line">{msg.text}</p>
              <p className="text-right text-[11px] text-gray-500 mt-0.5">11:00 am</p>
            </div>
            <div className="bg-white rounded-b-xl border-t border-gray-200 h-[42px] flex items-center justify-center gap-2 text-[14.5px] font-semibold text-[#027eb5] shadow-[0_1px_1px_rgba(0,0,0,.08)]">
              <ExternalLink size={16} /> {msg.button}
            </div>
          </div>
          <div className="mt-1.5 bg-white rounded-2xl p-3 shadow-[0_1px_2px_rgba(0,0,0,.08)]">
            <p className="text-[12px] font-bold text-gray-600">{tapNote}</p>
            <div className="mt-2 flex items-center gap-2.5">
              {sample?.image
                ? <img src={sample.image} alt="" className="w-11 h-11 rounded-[10px] object-cover" />
                : <span className="w-11 h-11 rounded-[10px] bg-gray-100" />}
              <div className="min-w-0">
                <p className="text-[13.5px] font-bold text-gray-900 truncate">{sample?.item || 'Their order'}</p>
                <span className="flex gap-0.5 mt-0.5" role="img" aria-label="Tap a star to rate">
                  {[1, 2, 3, 4, 5].map((n) => <Star key={n} size={22} className={n <= 4 ? 'fill-amber-400 text-amber-400' : 'fill-gray-200 text-gray-200'} />)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

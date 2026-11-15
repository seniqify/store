import { useEffect, useRef } from 'react';
import { X, ChevronLeft, ShoppingCart, Loader2 } from 'lucide-react';
import { cartReminderMessage } from '../../utils/cartReminderText';
import { shipmentRef } from '../../utils/deliveryStatus';
import { formatINR } from '../../utils/currency';

/**
 * CartChat — one abandoned cart, as a WhatsApp chat (founder, 2026-11-15):
 * the reminder exactly as the customer got it (English or मराठी), then what
 * they did with it — tapped "Complete my order", placed the order, or asked to
 * stop. The courier-style "what happened" for marketing messages.
 *
 * Shows only what PocketLink records (cart_reminder_statuses): sent or failed,
 * opened, the order it won back, asked to stop. No read ticks (WhatsApp doesn't
 * report them) and no typed replies. Never the customer's number.
 */

const TZ = 'Asia/Kolkata';
function fmtTime(iso) {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '';
  return t.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: TZ }).toLowerCase();
}
function fmtDay(iso) {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '';
  const key = (d) => d.toLocaleDateString('en-CA', { timeZone: TZ });
  if (key(t) === key(new Date())) return 'Today';
  return t.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ });
}
const firstName = (c) => String(c?.customer_name || '').trim().split(/\s+/)[0] || 'Customer';

/** The cart's product photos, overlapping, from the shop's own products. */
export function CartThumbs({ items, products = [] }) {
  const pics = items.slice(0, Math.min(items.length, 3)).map((it) => {
    const p = products.find((x) => String(x.id) === String(it.id)) || products.find((x) => x.name === it.name);
    return p?.image || (Array.isArray(p?.images) ? p.images[0] : '') || '';
  });
  return (
    <div className="flex -space-x-2 flex-shrink-0">
      {pics.length === 0 ? (
        <span className="w-10 h-10 rounded-lg bg-gray-100 grid place-items-center text-gray-400"><ShoppingCart size={16} /></span>
      ) : pics.map((src, i) => (src ? (
        <img key={i} src={src} alt="" className="w-10 h-10 rounded-lg object-cover bg-gray-100 ring-2 ring-white" />
      ) : (
        <span key={i} className="w-10 h-10 rounded-lg bg-gray-100 ring-2 ring-white grid place-items-center text-gray-400"><ShoppingCart size={15} /></span>
      )))}
    </div>
  );
}

function Day({ children }) {
  return <span className="self-center bg-white text-[#54656f] text-[11.5px] font-bold px-2.5 py-0.5 rounded-lg shadow-[0_1px_1px_rgba(0,0,0,.06)]">{children}</span>;
}
function Note({ children }) {
  return <span className="self-center max-w-[92%] text-center bg-[#fff8d6] text-[#6b5800] text-[11.5px] font-semibold px-2.5 py-1 rounded-lg leading-snug">{children}</span>;
}
function Did({ first, children, time, tone = 'green' }) {
  const bg = tone === 'won' ? 'bg-[#bbf7d0]' : tone === 'stop' ? 'bg-[#fee2e2]' : 'bg-[#d9fdd3]';
  return (
    <div className={`self-end max-w-[86%] rounded-[10px] rounded-tr-[2px] px-2.5 pt-1.5 pb-1 shadow-[0_1px_1px_rgba(0,0,0,.08)] ${bg}`}>
      <p className={`text-[11.5px] font-extrabold ${tone === 'stop' ? 'text-red-800' : 'text-green-800'}`}>{first}</p>
      <div className="text-[13.5px] text-gray-900 leading-snug">{children}</div>
      <p className="text-right text-[10.5px] text-[#667781] mt-0.5">{time}</p>
    </div>
  );
}

export default function CartChat({
  cart, reminder, outcome, storeName = '', products = [], shopLang = 'en',
  canSend = false, sending = false, problem = '', note = '', onSend, onClose, full = false,
}) {
  const bodyRef = useRef(null);
  const items = Array.isArray(cart?.items) ? cart.items : [];
  const first = firstName(cart);
  // The language it went in; before a reminder, the shop's current choice.
  const lang = reminder ? (reminder.lang === 'mr' ? 'mr' : 'en') : (shopLang === 'mr' ? 'mr' : 'en');
  const msg = cartReminderMessage(lang, cart, storeName);
  const key = outcome?.key || 'none';
  const tapped = key === 'opened' || key === 'won' ? 0 : key === 'stopped' ? 1 : -1;
  const sentDay = reminder?.sent_at ? fmtDay(reminder.sent_at) : '';
  const leftDay = fmtDay(cart?.created_at);

  // Like WhatsApp: open on the newest message.
  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [cart?.id, key, reminder?.sent_at]);

  return (
    <div className={['flex flex-col bg-[#efeae2] overflow-hidden min-h-0',
      full ? 'h-full' : 'rounded-2xl border border-gray-200 shadow-sm max-h-[calc(100vh-104px)]'].join(' ')}>
      <header className="bg-[#075e54] text-white px-3 py-2.5 flex items-center gap-2.5 flex-shrink-0"
              style={full ? { paddingTop: 'max(10px, env(safe-area-inset-top, 0px))' } : undefined}>
        <button type="button" onClick={onClose} aria-label={full ? 'Back to carts' : 'Close chat'}
          className="w-8 h-8 grid place-items-center rounded-full hover:bg-white/10 flex-shrink-0">
          {full ? <ChevronLeft size={20} /> : <X size={17} />}
        </button>
        <span className="w-8 h-8 rounded-full bg-white/20 grid place-items-center text-[12px] font-extrabold flex-shrink-0">PL</span>
        <span className="flex-1 min-w-0">
          <b className="block text-[14px] truncate">WhatsApp to {first}</b>
          <span className="block text-[11.5px] text-white/80 truncate">
            Number hidden · sent by PocketLink{reminder ? ` · in ${lang === 'mr' ? 'मराठी' : 'English'}` : ''}
          </span>
        </span>
      </header>

      <div className="bg-white border-b border-gray-200 px-3 py-2 flex items-center gap-2.5 flex-shrink-0">
        <CartThumbs items={items} products={products} />
        <span className="flex-1 min-w-0">
          <b className="block text-[13.5px] text-gray-900 truncate">{cart?.customer_name || 'Customer'}</b>
          <span className="block text-[12px] text-gray-500 truncate">
            {items.map((it) => `${it.name}${it.qty > 1 ? ` × ${it.qty}` : ''}`).join(', ') || 'Cart'}
          </span>
        </span>
        <b className="text-[14px] tabular-nums">{formatINR(cart?.total || 0)}</b>
      </div>

      <div ref={bodyRef} className="flex-1 min-h-[240px] overflow-y-auto px-2.5 py-3 flex flex-col gap-2">
        {leftDay && <Day>{leftDay}</Day>}
        <Note>
          🛒 <b className="text-[#92400e]">Left the cart</b> · {fmtTime(cart?.created_at)} · {formatINR(cart?.total || 0)}
          {cart?.attempts > 1 ? ` · came to checkout ${cart.attempts} times` : ''}
        </Note>

        {!reminder ? (
          <>
            <Note>No reminder yet. Here is what {first} would get{lang === 'mr' ? ', in मराठी' : ''}:</Note>
            <Bubble msg={msg} kind="Preview" dashed />
          </>
        ) : (
          <>
            {sentDay && sentDay !== leftDay && <Day>{sentDay}</Day>}
            <Bubble msg={msg} tapped={tapped} failed={reminder.status === 'failed'}
              kind={`${reminder.source === 'manual' ? 'sent by you' : 'automatic'} · ${lang === 'mr' ? 'मराठी' : 'English'}`}
              time={reminder.sent_at ? fmtTime(reminder.sent_at) : (reminder.status === 'sending' ? 'sending…' : '')} />
            {reminder.status === 'failed' && (
              <Note>WhatsApp refused it. This number may not be on WhatsApp. <b className="text-[#92400e]">Coins returned.</b></Note>
            )}
            {reminder.clicked_at && (
              <Did first={first} time={fmtTime(reminder.clicked_at)}>
                👆 Tapped “{msg.buttons[0]}”
                <span className="block text-[11.5px] text-gray-600">opened their saved cart</span>
              </Did>
            )}
            {key === 'won' && (
              <Did first={first} tone="won" time={fmtTime(reminder.won_at)}>
                🎉 Placed order <b>#{shipmentRef({ id: reminder.won_order_id })}</b> · {formatINR(Number(reminder.won_total) || 0)}
                <span className="block text-[11.5px] text-green-800">
                  {reminder.won_via_link ? 'through the reminder' : 'within 7 days of the reminder'}
                </span>
              </Did>
            )}
            {key === 'stopped' && (
              <>
                <Did first={first} tone="stop" time={fmtTime(reminder.stopped_at)}>✋ Asked to stop offers</Did>
                <Note>{first} won’t get reminders or offers from this shop any more.</Note>
              </>
            )}
            {key === 'opened' && <Note>Opened, but no order yet.</Note>}
            {key === 'sent' && <Note>No tap yet.{note ? ` ${note}.` : ''}</Note>}
          </>
        )}
      </div>

      {(canSend || problem) && (
        <div className="bg-white border-t border-gray-200 px-3 py-2.5 flex items-center gap-2 flex-wrap flex-shrink-0">
          {problem && <p className="text-[12px] text-amber-700 flex-1 min-w-[140px]">{problem}</p>}
          {canSend && (
            <>
              {!problem && <p className="text-[12px] text-gray-500 flex-1 min-w-[140px]">Goes in <b>{lang === 'mr' ? 'मराठी' : 'English'}</b> · 3 Coins</p>}
              <button type="button" onClick={onSend} disabled={sending}
                className="h-10 px-4 rounded-xl bg-[#075e54] text-white text-[13px] font-extrabold inline-flex items-center gap-1.5 active:scale-[0.98] disabled:opacity-60">
                {sending && <Loader2 size={14} className="animate-spin" />}
                Send reminder · ₹1.50
              </button>
            </>
          )}
        </div>
      )}
      <p className="bg-[#f0f2f5] text-[11px] text-[#54656f] px-3 py-2 border-t border-gray-200 leading-snug flex-shrink-0">
        ✓ = sent. WhatsApp doesn’t tell us when it’s read; a reply they type isn’t shown here.
      </p>
    </div>
  );
}

function Bubble({ msg, kind, time = '', tapped = -1, failed = false, dashed = false }) {
  return (
    <div className={['self-start max-w-[88%] rounded-[10px] rounded-tl-[2px] px-2.5 pt-1.5 pb-1 shadow-[0_1px_1px_rgba(0,0,0,.08)]',
      failed ? 'bg-[#fff1f1]' : dashed ? 'bg-white border-2 border-dashed border-gray-300' : 'bg-white'].join(' ')}>
      <p className="text-[11.5px] font-extrabold text-teal-700">Cart reminder <span className="font-semibold text-gray-500">· {kind}</span></p>
      <p className="text-[13.5px] text-gray-900 leading-snug whitespace-pre-line">{msg.text}</p>
      {time && (
        <p className={`text-right text-[10.5px] mt-0.5 ${failed ? 'text-red-700 font-bold' : 'text-[#667781]'}`}>
          {time} {failed ? '· not delivered' : <span className="font-extrabold text-[#8696a0]" title="Sent">✓</span>}
        </p>
      )}
      {msg.buttons.map((b, i) => (
        <span key={b} className={['block -mx-2.5 border-t border-[#e9edef] py-2 text-center text-[13.5px] text-[#0b84c6]',
          i === msg.buttons.length - 1 ? '-mb-1' : '', tapped === i ? 'bg-[#e7f3ff] font-extrabold' : 'font-semibold'].join(' ')}>
          ↗ {b}
        </span>
      ))}
    </div>
  );
}

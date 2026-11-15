import { useState, useEffect, useCallback } from 'react';
import { Wallet, RefreshCw, Loader2, Coins } from 'lucide-react';
import { fetchWallet, confirmTopups, buyPack } from '../../utils/wallet';
import { WALLET_PACKS, coinsOf, formatCoins, packCoins, ledgerLabel, customTopup, CUSTOM_MIN_RUPEES } from '../../utils/walletPacks';

/**
 * WalletCard — the shop's prepaid WhatsApp-message balance with PocketLink.
 *
 * Buy a pack (paid to PocketLink through Razorpay), see how many messages are
 * left, and the last few movements. Every automatic WhatsApp message PocketLink
 * sends for the shop is paid from here; one that cannot be sent is refunded.
 *
 * Opening the card also settles any top-up whose Checkout callback never made it
 * back (closed tab, dropped network): the server asks Razorpay and credits it.
 */

const TONE = {
  ok:   'bg-emerald-50 text-emerald-700 border-emerald-100',
  wait: 'bg-amber-50 text-amber-700 border-amber-100',
  err:  'bg-rose-50 text-rose-700 border-rose-100',
};

function shortDate(iso) {
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? '' : t.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/** Read the wallet, first settling any top-up still waiting on Razorpay. */
async function readWallet(slug, pin) {
  const w = await fetchWallet(slug, pin);
  if (w.ok && Number(w.data?.pending_topups) > 0) {
    const r = await confirmTopups(slug, pin);
    if (r.credited > 0) return { wallet: await fetchWallet(slug, pin), settled: true };
  }
  return { wallet: w, settled: false };
}

const SETTLED = { tone: 'ok', text: 'Your payment came through — the Coins are in your wallet.' };

/**
 * `compact`: a one-line strip (messages left + Top up) that opens into the full
 * card when tapped — used where sending is the main job (Abandoned, Customers).
 * `version`: bump it to re-read the balance after the parent sent messages.
 */
export default function WalletCard({ slug, pin, themeColor = '#0d9488', storeName = '', waPhone = '', compact = false, version = 0 }) {
  const [wallet, setWallet] = useState(null);     // null = loading; else { ok, data }
  const [buying, setBuying] = useState(0);        // the pack being bought
  const [notice, setNotice] = useState(null);     // { tone, text }
  const [open, setOpen] = useState(false);        // compact strip opened into the full card
  // The ways to add Coins stay folded behind one button (founder, 2026-11-15:
  // showing the packs straight away was confusing), with a typed amount too.
  const [adding, setAdding] = useState(false);
  const [custom, setCustom] = useState('');

  useEffect(() => {
    let alive = true;
    readWallet(slug, pin).then((r) => {
      if (!alive) return;
      setWallet(r.wallet);
      if (r.settled) setNotice(SETTLED);
    });
    return () => { alive = false; };
  }, [slug, pin, version]);

  const load = useCallback(async () => {
    const r = await readWallet(slug, pin);
    setWallet(r.wallet);
    if (r.settled) setNotice(SETTLED);
  }, [slug, pin]);

  // A pack (by its message count) or a typed amount ({ rupees }).
  async function buy(messages, typed = null) {
    setNotice(null);
    setBuying(typed ? 'custom' : messages);
    try {
      const r = await buyPack({ slug, pin, messages, rupees: typed?.rupees, storeName, phone: waPhone, themeColor });
      if (r.paid) {
        const total = typed ? typed.total : packCoins(WALLET_PACKS.find((p) => p.messages === messages)).total;
        setNotice(r.credited
          ? { tone: 'ok', text: `${formatCoins(total)} added.` }
          : { tone: 'wait', text: 'Payment received — your Coins will show in a minute. Tap refresh.' });
        setWallet(await fetchWallet(slug, pin));
        setAdding(false); setCustom('');
      }
    } catch (e) {
      setNotice({ tone: 'err', text: e?.message || 'Payment failed. Please try again.' });
    } finally {
      setBuying(0);
    }
  }

  if (wallet === null) {
    return <div className={`${compact ? 'h-14' : 'h-40'} rounded-2xl bg-white border border-gray-100 animate-pulse`} />;
  }

  if (!wallet.ok || !wallet.data) {
    return (
      <div className="rounded-2xl border border-amber-100 bg-amber-50/60 px-4 py-3.5 flex items-center gap-3">
        <Wallet size={18} className="text-amber-500 flex-shrink-0" />
        <div className="min-w-0 flex-grow">
          <p className="text-sm font-bold text-gray-900">Coins couldn&rsquo;t load</p>
          <p className="text-xs text-gray-500 mt-0.5">Your Coins are safe — this screen couldn&rsquo;t reach them.</p>
        </div>
        <button type="button" onClick={load}
          className="flex-shrink-0 text-xs font-bold px-3 py-2 rounded-xl text-white active:scale-[0.98] transition-transform"
          style={{ backgroundColor: themeColor }}>
          Try again
        </button>
      </div>
    );
  }

  const balance = Number(wallet.data.balance_paise) || 0;
  const coins = coinsOf(balance);
  const recent = Array.isArray(wallet.data.recent) ? wallet.data.recent.slice(0, 5) : [];
  const rate = (
    <span className="inline-block text-[10.5px] font-extrabold text-white bg-teal-700 rounded-full px-2 py-0.5">1 Coin = ₹0.50</span>
  );

  if (compact && !open) {
    return (
      <div className="rounded-2xl border border-gray-200 bg-white px-3 py-2.5">
        <div className="flex items-center gap-2.5">
          <Coins size={18} className="text-amber-500 flex-shrink-0" />
          <div className="min-w-0 flex-grow">
            <p className="text-[13px] font-extrabold text-gray-900 tabular-nums">{formatCoins(coins)}</p>
            <p className="text-[11.5px] text-gray-500">1 Coin = ₹0.50 · reminder or offer = 3 Coins</p>
          </div>
          <button type="button" onClick={() => { setOpen(true); setAdding(true); }}
            className="h-9 px-3.5 rounded-xl border border-gray-200 bg-white text-[12.5px] font-bold text-gray-900
                       hover:bg-gray-50 active:scale-[0.98] transition-all flex-shrink-0">
            Add Coins
          </button>
        </div>
        {notice && (
          <p className={`mt-2 text-xs font-semibold px-3 py-2 rounded-xl border ${TONE[notice.tone] || TONE.wait}`}>{notice.text}</p>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
      {/* The balance, on the dark PocketLink panel with a glow of the shop colour */}
      <div className="p-4 text-white"
           style={{ background: `radial-gradient(circle at 100% 0%, ${themeColor}55, transparent 50%), linear-gradient(135deg, #0b1f19, #061310)` }}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-white/70">
              <Coins size={14} className="text-amber-300" /> WhatsApp Coins
            </p>
            <p className="text-[36px] font-extrabold tabular-nums leading-none mt-2">
              {coins.toLocaleString('en-IN')}
              <span className="ml-2 text-sm font-semibold text-white/70">{coins === 1 ? 'Coin' : 'Coins'}</span>
            </p>
            <p className="text-[13px] text-white/75 mt-2">
              = ₹{(balance / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })} · 1 Coin = ₹0.50
            </p>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {!adding && (
              <button type="button" onClick={() => setAdding(true)}
                className="h-9 px-3.5 rounded-xl bg-white text-gray-900 text-[13px] font-bold hover:bg-gray-100 active:scale-[0.98] transition">
                + Add Coins
              </button>
            )}
            <button type="button" onClick={load} aria-label="Refresh"
              className="p-2 rounded-xl text-white/70 hover:text-white hover:bg-white/10 active:scale-95 transition">
              <RefreshCw size={15} />
            </button>
            {compact && (
              <button type="button" onClick={() => { setOpen(false); setAdding(false); }}
                className="text-xs font-bold text-white/80 px-2 py-2 rounded-xl hover:bg-white/10">Done</button>
            )}
          </div>
        </div>
        <p className="text-xs text-white/70 mt-3">Shipping update = 1 Coin · Cart reminder or offer = 3 Coins</p>
      </div>
      <div className="p-4 pt-1">

      {notice && (
        <p className={`mt-3 text-xs font-semibold px-3 py-2 rounded-xl border ${TONE[notice.tone] || TONE.wait}`}>{notice.text}</p>
      )}

      {adding && (() => {
        const typed = customTopup(custom);
        return (
        <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50/60 p-3 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[13px] font-extrabold text-gray-900">Add Coins</p>
            <button type="button" onClick={() => { setAdding(false); setCustom(''); }}
              className="text-xs font-bold text-gray-500 px-2 py-1 rounded-lg hover:bg-gray-100">Cancel</button>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {WALLET_PACKS.map((p) => {
              const c = packCoins(p);
              return (
                <button key={p.messages} type="button" disabled={Boolean(buying)} onClick={() => buy(p.messages)}
                  className="rounded-xl border border-gray-200 bg-white px-2 py-2.5 text-center shadow-sm
                             hover:bg-gray-50 active:scale-[0.98] transition-all disabled:opacity-60">
                  <span className="block text-sm font-extrabold text-gray-900 tabular-nums">
                    {buying === p.messages ? <Loader2 size={14} className="inline animate-spin" /> : c.total.toLocaleString('en-IN')}
                  </span>
                  <span className="block text-[11px] text-gray-500">Coins · {c.price}</span>
                  {c.bonus > 0 && <span className="block text-[10.5px] font-bold text-amber-700">incl. {c.bonus.toLocaleString('en-IN')} bonus</span>}
                </button>
              );
            })}
          </div>
          {/* Any amount: whole rupees, Rs 50 to Rs 50,000; the bonus steps apply too */}
          <div>
            <label htmlFor={`coins-custom-${slug}`} className="block text-[12px] font-bold text-gray-700 mb-1">Or enter any amount</label>
            <div className="flex gap-2">
              <div className="relative flex-1 min-w-0">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400 pointer-events-none">₹</span>
                <input id={`coins-custom-${slug}`} type="text" inputMode="numeric" autoComplete="off" maxLength={5}
                  placeholder={`${CUSTOM_MIN_RUPEES} or more`} value={custom}
                  onChange={(e) => setCustom(e.target.value.replace(/[^0-9]/g, ''))}
                  className="w-full h-11 pl-7 pr-3 rounded-xl border border-gray-200 bg-white text-[15px] font-bold text-gray-900
                             focus:outline-none focus:border-gray-400 focus:ring-4 focus:ring-gray-100" />
              </div>
              <button type="button" disabled={!typed.ok || Boolean(buying)} onClick={() => buy(null, typed)}
                className="h-11 px-4 rounded-xl text-white text-[13px] font-bold whitespace-nowrap active:scale-[0.98] transition disabled:opacity-50"
                style={{ backgroundColor: themeColor }}>
                {buying === 'custom' ? <Loader2 size={15} className="inline animate-spin" /> : typed.ok ? `Pay ₹${typed.rupees.toLocaleString('en-IN')}` : 'Pay'}
              </button>
            </div>
            <p className={`text-[12px] mt-1.5 ${typed.ok ? 'text-gray-600' : typed.error ? 'text-red-600' : 'text-gray-400'}`}>
              {typed.ok
                ? <>You get <b className="text-gray-900">{formatCoins(typed.total)}</b>{typed.bonus > 0 ? <> (incl. {typed.bonus.toLocaleString('en-IN')} bonus)</> : null}.</>
                : typed.error || 'Every ₹1 = 2 Coins. 5% bonus from ₹750, 10% from ₹1,500.'}
            </p>
          </div>
          <p className="text-[11px] text-gray-400">
            Paid to PocketLink. Coins never expire, and a message that can&rsquo;t be sent gives its Coins back.
          </p>
        </div>
        );
      })()}

      {recent.length > 0 && (
        <div className="mt-3 pt-2 border-t border-dashed border-gray-200 space-y-1">
          {recent.map((r, i) => {
            const l = ledgerLabel(r);
            return (
              <div key={`${r.created_at}-${i}`} className="flex items-center gap-2 text-xs">
                <span className={`w-12 flex-shrink-0 font-extrabold tabular-nums ${l.tone === 'credit' ? 'text-emerald-700' : 'text-gray-900'}`}>{l.sign}{l.coins.toLocaleString('en-IN')}</span>
                <span className="truncate flex-1 text-gray-600">{l.text}</span>
                <span className="text-gray-400 flex-shrink-0">{shortDate(r.created_at)}</span>
              </div>
            );
          })}
        </div>
      )}
      </div>
    </div>
  );
}

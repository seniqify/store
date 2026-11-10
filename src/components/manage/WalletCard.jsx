import { useState, useEffect, useCallback } from 'react';
import { Wallet, RefreshCw, Loader2, Coins } from 'lucide-react';
import { fetchWallet, confirmTopups, buyPack } from '../../utils/wallet';
import { WALLET_PACKS, coinsOf, formatCoins, packCoins, ledgerLabel } from '../../utils/walletPacks';

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

  async function buy(messages) {
    setNotice(null);
    setBuying(messages);
    try {
      const r = await buyPack({ slug, pin, messages, storeName, phone: waPhone, themeColor });
      if (r.paid) {
        setNotice(r.credited
          ? { tone: 'ok', text: `${formatCoins(packCoins(WALLET_PACKS.find((p) => p.messages === messages)).total)} added.` }
          : { tone: 'wait', text: 'Payment received — your Coins will show in a minute. Tap refresh.' });
        setWallet(await fetchWallet(slug, pin));
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
          <button type="button" onClick={() => setOpen(true)}
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
    <div className="rounded-2xl border border-gray-100 bg-white shadow-sm p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <span className="w-12 h-12 rounded-xl bg-amber-100 grid place-items-center flex-shrink-0">
            <Coins size={24} className="text-amber-600" />
          </span>
          <div className="min-w-0">
            <p className="text-2xl font-extrabold text-gray-900 tabular-nums leading-tight">
              {coins.toLocaleString('en-IN')}
              <span className="ml-1.5 text-sm font-semibold text-gray-500">{coins === 1 ? 'Coin' : 'Coins'}</span>
            </p>
            <div className="mt-1">{rate}</div>
          </div>
        </div>
        <div className="flex items-center flex-shrink-0">
          <button type="button" onClick={load} aria-label="Refresh"
            className="p-2 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 active:scale-95 transition">
            <RefreshCw size={15} />
          </button>
          {compact && (
            <button type="button" onClick={() => setOpen(false)}
              className="text-xs font-bold text-gray-500 px-2 py-2 rounded-xl hover:bg-gray-100">Done</button>
          )}
        </div>
      </div>
      <p className="text-xs text-gray-500 mt-2">Shipping update = 1 Coin · Cart reminder or offer = 3 Coins</p>

      {notice && (
        <p className={`mt-3 text-xs font-semibold px-3 py-2 rounded-xl border ${TONE[notice.tone] || TONE.wait}`}>{notice.text}</p>
      )}

      <p className="mt-3 text-[11px] font-bold uppercase tracking-wide text-gray-400">Add Coins</p>
      <div className="mt-1.5 grid grid-cols-3 gap-2">
        {WALLET_PACKS.map((p) => {
          const c = packCoins(p);
          return (
            <button key={p.messages} type="button" disabled={buying > 0} onClick={() => buy(p.messages)}
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
      <p className="text-[11px] text-gray-400 mt-2">
        Paid to PocketLink. Coins never expire, and a message that can&rsquo;t be sent gives its Coins back.
      </p>

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
  );
}

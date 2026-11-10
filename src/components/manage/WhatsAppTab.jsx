import { useState, useEffect, useCallback } from 'react';
import { MessageCircle, ShoppingCart, Percent, AlertTriangle, CheckCircle2 } from 'lucide-react';
import WalletCard from './WalletCard';
import ShipUpdates, { Switch } from './ShipUpdates';
import { getOrderMessageUsage } from '../../utils/deliveryTools';
import { fetchCartReminderSummary, setCartReminders } from '../../utils/cartReminderService';
import { COIN_PAISE } from '../../utils/walletPacks';

/**
 * Manage → WhatsApp: every message PocketLink sends for the shop, and the
 * Coins that pay for them (1 Coin = Rs 0.50).
 *
 *   When an order comes in  500 free a month (order confirmation / payment
 *                           received), then 1 Coin each (whatsapp-coins-forward.sql)
 *   Shipping updates        1 Coin each (ShipUpdates)
 *   Win customers back      cart reminders and offers, 3 Coins each
 */

const label = 'px-1 text-[11px] font-extrabold uppercase tracking-wide text-gray-500';

export default function WhatsAppTab({ slug, pin, themeColor = '#0d9488', storeName = '', waPhone = '', cartAllowed = true, onGoTab }) {
  const [usage, setUsage] = useState(null);    // get_order_message_usage
  const [cart, setCart]   = useState(null);    // { enabled } | { error }
  const [cartBusy, setCartBusy] = useState(false);
  const [version, setVersion] = useState(0);   // re-read the Coins after a change

  const load = useCallback(async () => {
    getOrderMessageUsage(slug, pin).then(setUsage).catch(() => setUsage({ error: true }));
    fetchCartReminderSummary(slug, pin).then((r) => setCart(r.ok ? { enabled: Boolean(r.data.enabled) } : { error: true }));
  }, [slug, pin]);
  useEffect(() => { load(); }, [load]);

  async function toggleCart() {
    if (!cart || cart.error) return;
    setCartBusy(true);
    try { setCart({ enabled: await setCartReminders(slug, pin, !cart.enabled) }); }
    catch { /* the switch stays as it was */ }
    finally { setCartBusy(false); }
  }

  const limit = Number(usage?.free_limit) || 500;
  const used = Math.min(limit, Number(usage?.free_used) || 0);
  const allFreeUsed = usage && !usage.error && used >= limit;
  const paused = allFreeUsed && Number(usage.balance_paise) < COIN_PAISE;

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div>
        <h2 className="text-lg font-extrabold text-gray-900 flex items-center gap-2">
          <MessageCircle size={18} style={{ color: themeColor }} /> WhatsApp
        </h2>
        <p className="text-xs text-gray-500 mt-0.5">Every message PocketLink sends for your shop, and the Coins that pay for them</p>
      </div>

      <WalletCard slug={slug} pin={pin} themeColor={themeColor} storeName={storeName} waPhone={waPhone} version={version} />

      {/* When an order comes in: 500 free a month, then 1 Coin */}
      <p className={label}>When an order comes in · {limit} free a month</p>
      {paused && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 space-y-1.5" role="alert">
          <p className="flex items-center gap-1.5 text-sm font-extrabold text-rose-800"><AlertTriangle size={16} /> Order confirmations paused</p>
          <p className="text-[12.5px] text-rose-800 leading-snug">
            This month&rsquo;s {limit} free are used and you have no Coins left, so new orders are not getting their WhatsApp.
            Add Coins above, or confirm each order yourself from its order card.
          </p>
        </div>
      )}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
        {[
          ['Order confirmation', 'Cash-on-delivery orders get a “Confirm my order” button'],
          ['Payment received', 'Online-paid orders get a thank-you with Track order'],
        ].map(([t, d]) => (
          <div key={t} className="flex items-start gap-3">
            <CheckCircle2 size={16} className="text-emerald-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-[13.5px] font-bold text-gray-900">{t}</p>
              <p className="text-[11.5px] text-gray-500">{d}</p>
            </div>
            <span className="text-[10.5px] font-bold text-gray-500 flex-shrink-0">Always on</span>
          </div>
        ))}
        <div className="pt-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[13px] font-extrabold text-gray-900 tabular-nums">
              {usage?.error ? 'Couldn’t load this month’s count' : usage ? `${used.toLocaleString('en-IN')} of ${limit} free this month` : 'Loading…'}
            </p>
            <p className="text-[11.5px] text-gray-500 flex-shrink-0">then 1 Coin each</p>
          </div>
          <div className="mt-1.5 h-2 rounded-full bg-gray-100 overflow-hidden">
            <div className="h-full rounded-full transition-all" style={{ width: `${(used / limit) * 100}%`, backgroundColor: allFreeUsed ? '#dc2626' : themeColor }} />
          </div>
          <p className="mt-2 text-[11.5px] text-gray-500 leading-snug">
            {allFreeUsed
              ? `All ${limit} free used: each new one takes 1 Coin${Number(usage.paid) > 0 ? ` (${usage.paid} so far)` : ''}. Back to ${limit} free on the 1st.`
              : `${(limit - used).toLocaleString('en-IN')} free left. Resets to ${limit} on the 1st of every month.`}
            {' '}The confirmation cuts fake and refused cash-on-delivery orders, so it stays on.
          </p>
        </div>
      </div>

      {/* Shipping updates: 1 Coin each */}
      <p className={label}>Shipping updates · 1 Coin each</p>
      <ShipUpdates slug={slug} pin={pin} themeColor={themeColor} storeName={storeName} />

      {/* Win customers back: 3 Coins each */}
      <p className={label}>Win customers back · 3 Coins each</p>
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
        {cartAllowed ? (
          <div className="flex items-center gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-[13.5px] font-bold text-gray-900">Automatic cart reminder</p>
              <p className="text-[11.5px] text-gray-500">One WhatsApp about an hour after someone leaves their cart</p>
            </div>
            <Switch on={Boolean(cart?.enabled)} disabled={cartBusy || !cart || cart.error} color={themeColor}
                    label="Automatic cart reminder" onClick={toggleCart} />
          </div>
        ) : (
          <p className="text-[12px] text-gray-500">Cart reminders come with a paid plan.</p>
        )}
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => onGoTab?.('customers')}
            className="h-11 rounded-xl text-white text-[13px] font-bold inline-flex items-center justify-center gap-1.5 active:scale-[0.98]"
            style={{ backgroundColor: themeColor }}>
            <Percent size={15} /> Send an offer
          </button>
          <button type="button" onClick={() => onGoTab?.('abandoned')}
            className="h-11 rounded-xl border border-gray-200 bg-white text-[13px] font-bold text-gray-800 inline-flex items-center justify-center gap-1.5 hover:bg-gray-50 active:scale-[0.98]">
            <ShoppingCart size={15} /> Remind carts
          </button>
        </div>
        <p className="text-[11.5px] text-gray-500">Both show the cost in Coins before anything is sent.</p>
      </div>

      <button type="button" onClick={() => { setVersion((v) => v + 1); load(); }}
        className="w-full h-10 text-[12px] font-bold text-gray-500 hover:text-gray-700">Refresh</button>
    </div>
  );
}

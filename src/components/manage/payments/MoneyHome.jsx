import { ChevronRight, Banknote, Package, AlertTriangle, Truck, CreditCard, Bike, Link2 } from 'lucide-react';
import { formatINR } from '../../../utils/currency';
import { PAYMENT_RANGES } from '../../../utils/paymentsMetrics';

/**
 * Payments → Money: the home screen (Payments redesign, founder-approved
 * 2026-10-23). Where the shop's money is, and what to do next.
 *
 *   1. One bar for everything sold: in your hand / coming in / lost to returns.
 *   2. "Get your money in": only the things the shop can act on, each opening
 *      its list in Coming in. Money already with a courier is shown with
 *      nothing to do.
 *   3. The period chips, over the orders PLACED in the window - every order
 *      has that date, so nothing needs a "date not recorded" footnote.
 *   4. How the money came in.
 *   5. Online payments that never went through: not money owed, so kept out
 *      of every figure above, one tap away.
 *
 * Every figure is from buildMoneyHome over the uncapped facts feed. Pure
 * presentation: the parent owns loading, refresh and every action.
 */

const rs = (n) => formatINR(Math.round(Number(n) || 0));
const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function BarRow({ dot, label, sub, amount, tone, onClick }) {
  return (
    <button type="button" onClick={onClick} disabled={!onClick}
            className="w-full min-h-[56px] flex items-center gap-3 text-left border-b last:border-b-0 border-gray-100 disabled:cursor-default">
      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: dot }} />
      <span className="flex-grow min-w-0">
        <span className="block text-sm font-bold text-gray-900">{label}</span>
        <span className="block text-xs text-gray-500">{sub}</span>
      </span>
      <span className={`text-base font-extrabold tabular-nums ${tone}`}>{amount}</span>
      {onClick ? <ChevronRight size={16} className="text-gray-400 flex-shrink-0" /> : <span className="w-4" />}
    </button>
  );
}

function ActionRow({ icon: Icon, iconCls, title, sub, cta, primary, onClick, themeColor }) {
  return (
    <div className="flex items-center gap-3">
      <span className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${iconCls}`}>
        <Icon size={19} />
      </span>
      <span className="flex-grow min-w-0">
        <span className="block text-sm font-bold text-gray-900">{title}</span>
        <span className="block text-xs text-gray-500">{sub}</span>
      </span>
      <button type="button" onClick={onClick}
              className={['min-h-[44px] px-3.5 rounded-xl text-[13px] font-bold flex-shrink-0 active:scale-[0.98] transition-transform',
                primary ? 'text-white' : 'border-[1.5px] border-gray-200 bg-white text-gray-900'].join(' ')}
              style={primary ? { backgroundColor: themeColor } : undefined}>
        {cta}
      </button>
    </div>
  );
}

export default function MoneyHome({ acc, range, setRange, themeColor = '#0d9488', onOpen, received = [] }) {
  const gross = acc.balances.grossSales;
  const inHand = acc.balances.collected.amount;
  const coming = acc.balances.outstanding;
  const lost = acc.balances.writtenOff;
  const c = acc.comingIn;
  const actionable = c.with_rider.amount + c.not_shipped.amount + c.stuck.amount + c.to_check.amount;
  const hasActions = c.with_rider.count + c.not_shipped.count + c.stuck.count + c.to_check.count > 0;
  const placed = acc.period.orders;
  const rangeLabel = PAYMENT_RANGES.find((r) => r.days === range)?.label || '';
  const periodWords = range === 1 ? 'today' : `in the last ${rangeLabel}`;
  const paid = acc.channels;
  const paidTotal = paid.cod.amount + paid.online.amount + paid.other.amount;

  return (
    <div className="space-y-4">
      {/* 1. Everything sold, in one bar */}
      <section className="rounded-2xl border border-gray-100 bg-white shadow-sm px-4 pt-4 pb-1">
        <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500">Your money · all time</p>
        <p className="text-[28px] font-extrabold text-gray-900 tabular-nums mt-1 leading-tight">{rs(gross)}</p>
        <p className="text-xs text-gray-500">sold in {plural(acc.canonical.population.revenueOrders.count, 'order', 'orders')}</p>
        <div className="flex gap-[3px] h-3.5 mt-4" role="img"
             aria-label={`${pct(inHand, gross)}% in your hand, ${pct(coming.amount, gross)}% coming in, ${pct(lost.amount, gross)}% lost to returns`}>
          {inHand > 0 && <div className="rounded-l-full" style={{ flex: inHand, backgroundColor: '#059669' }} />}
          {coming.amount > 0 && <div style={{ flex: coming.amount, backgroundColor: '#f59e0b' }} />}
          {lost.amount > 0 && <div className="rounded-r-full" style={{ flex: lost.amount, backgroundColor: '#9f1239' }} />}
          {gross <= 0 && <div className="flex-1 rounded-full bg-gray-100" />}
        </div>
        <div className="mt-2">
          <BarRow dot="#059669" label="In your hand" sub={`collected · ${pct(inHand, gross)}%`}
                  amount={rs(inHand)} tone="text-emerald-700" />
          <BarRow dot="#f59e0b" label="Coming in" sub={`${plural(coming.count, 'order', 'orders')} not paid yet · ${pct(coming.amount, gross)}%`}
                  amount={rs(coming.amount)} tone="text-amber-700" onClick={() => onOpen('coming')} />
          <BarRow dot="#9f1239" label="Lost to returns" sub={`${plural(lost.count, 'parcel', 'parcels')} came back · ${pct(lost.amount, gross)}%`}
                  amount={rs(lost.amount)} tone="text-rose-800" onClick={() => onOpen('returns')} />
        </div>
      </section>

      {/* 2. Get your money in */}
      {(hasActions || c.with_courier.count > 0) && (
        <section className="rounded-2xl border border-gray-100 bg-white shadow-sm p-4">
          <h3 className="text-base font-extrabold text-gray-900">Get your money in</h3>
          {hasActions && <p className="text-[13px] text-gray-500 mt-0.5">{rs(actionable)} you can act on today</p>}
          <div className="space-y-3 mt-3.5">
            {c.with_rider.count > 0 && (
              <ActionRow icon={Bike} iconCls="bg-emerald-50 text-emerald-700" themeColor={themeColor} primary
                         title="Mark delivered orders" sub={`${plural(c.with_rider.count, 'order', 'orders')} with your delivery boy · ${rs(c.with_rider.amount)}`}
                         cta="Review" onClick={() => onOpen('coming', 'with_rider')} />
            )}
            {c.not_shipped.count > 0 && (
              <ActionRow icon={Package} iconCls="bg-amber-50 text-amber-700" themeColor={themeColor}
                         title="Ship to get paid" sub={`${plural(c.not_shipped.count, 'order', 'orders')} not sent yet · ${rs(c.not_shipped.amount)}`}
                         cta="See" onClick={() => onOpen('coming', 'not_shipped')} />
            )}
            {c.stuck.count > 0 && (
              <ActionRow icon={AlertTriangle} iconCls="bg-rose-50 text-rose-800" themeColor={themeColor}
                         title="Fix stuck parcels" sub={`${plural(c.stuck.count, 'parcel', 'parcels')} with a delivery problem · ${rs(c.stuck.amount)}`}
                         cta="Fix" onClick={() => onOpen('coming', 'stuck')} />
            )}
            {c.to_check.count > 0 && (
              <ActionRow icon={Link2} iconCls="bg-indigo-50 text-indigo-700" themeColor={themeColor}
                         title="Check payments" sub={`${plural(c.to_check.count, 'order', 'orders')} waiting on a payment · ${rs(c.to_check.amount)}`}
                         cta="See" onClick={() => onOpen('coming', 'to_check')} />
            )}
            {c.with_courier.count > 0 && (
              <button type="button" onClick={() => onOpen('coming', 'with_courier')}
                      className="w-full flex items-center gap-3 p-3 rounded-2xl bg-gray-50 text-left">
                <span className="w-10 h-10 rounded-xl bg-white text-gray-500 flex items-center justify-center flex-shrink-0">
                  <Truck size={19} />
                </span>
                <span className="flex-grow min-w-0">
                  <span className="block text-sm font-bold text-gray-900">{rs(c.with_courier.amount)} is with the courier</span>
                  <span className="block text-xs text-gray-600">{plural(c.with_courier.count, 'parcel', 'parcels')} on the way. Nothing to do: it is paid to you after delivery.</span>
                </span>
              </button>
            )}
          </div>
        </section>
      )}

      {/* 3. The period, over orders placed in it */}
      <section className="rounded-2xl border border-gray-100 bg-white shadow-sm p-4">
        <div className="flex gap-2" role="tablist" aria-label="Period">
          {PAYMENT_RANGES.map((r) => {
            const active = r.days === range;
            return (
              <button key={r.days} type="button" role="tab" aria-selected={active} onClick={() => setRange(r.days)}
                      className={['min-h-[34px] px-3.5 rounded-full text-xs border transition',
                        active ? 'bg-gray-900 border-gray-900 text-white font-bold' : 'bg-white border-gray-200 text-gray-600 font-semibold'].join(' ')}>
                {r.label}
              </button>
            );
          })}
        </div>
        <p className="text-[13px] text-gray-500 mt-4">Orders placed {periodWords}</p>
        <p className="mt-0.5 flex items-baseline gap-2">
          <span className="text-2xl font-extrabold text-gray-900 tabular-nums">{rs(placed.sold.amount)}</span>
          <span className="text-[13px] text-gray-500">sold · {plural(placed.sold.count, 'order', 'orders')}</span>
        </p>
        <div className="flex gap-[3px] h-2.5 mt-3" aria-hidden="true">
          {placed.collected.amount > 0 && <div className="rounded-l-full" style={{ flex: placed.collected.amount, backgroundColor: '#059669' }} />}
          {placed.outstanding.amount > 0 && <div style={{ flex: placed.outstanding.amount, backgroundColor: '#f59e0b' }} />}
          {placed.writtenOff.amount > 0 && <div className="rounded-r-full" style={{ flex: placed.writtenOff.amount, backgroundColor: '#9f1239' }} />}
          {placed.sold.amount <= 0 && <div className="flex-1 rounded-full bg-gray-100" />}
        </div>
        <div className="grid grid-cols-3 gap-2 mt-3">
          <div><p className="text-[15px] font-extrabold text-emerald-700 tabular-nums">{rs(placed.collected.amount)}</p><p className="text-xs text-gray-500">in your hand</p></div>
          <div><p className="text-[15px] font-extrabold text-amber-700 tabular-nums">{rs(placed.outstanding.amount)}</p><p className="text-xs text-gray-500">coming in</p></div>
          <div><p className="text-[15px] font-extrabold text-rose-800 tabular-nums">{rs(placed.writtenOff.amount)}</p><p className="text-xs text-gray-500">came back</p></div>
        </div>
        <div className="mt-4 pt-3.5 border-t border-gray-100">
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-gray-700">Money received {periodWords}</span>
            <span className="text-sm font-extrabold text-emerald-700 tabular-nums">
              {rs(acc.period.received.amount)} · {plural(acc.period.received.count, 'payment', 'payments')}
            </span>
          </div>
          {/* Money collected before payment dates were recorded can't be placed
              in a period, so it is never added to one - say so, once, quietly. */}
          {acc.balances.undatedCollected.count > 0 && (
            <p className="text-[11px] text-gray-400 mt-1">
              {plural(acc.balances.undatedCollected.count, 'older payment has', 'older payments have')} no recorded date: counted in In your hand, not here.
            </p>
          )}
          {received.length > 0 && (
            <ul className="mt-2 space-y-1">
              {received.slice(0, 5).map(({ order: o, amount, label }) => (
                <li key={o.id} className="flex items-center justify-between text-xs text-gray-500">
                  <span className="truncate pr-2">{o.customer_name || 'Customer'} · {label}</span>
                  <span className="tabular-nums font-semibold text-gray-700">{rs(amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* 4. How the money came in */}
      {paidTotal > 0 && (
        <section className="rounded-2xl border border-gray-100 bg-white shadow-sm p-4">
          <p className="text-[11px] font-bold uppercase tracking-widest text-gray-500">How you got paid</p>
          <div className="space-y-3 mt-3">
            {[['Cash on delivery', paid.cod.amount], ['Online (UPI, cards)', paid.online.amount], ['Marked paid by you', paid.other.amount]]
              .filter(([, v]) => v > 0)
              .map(([label, v]) => (
                <div key={label}>
                  <div className="flex justify-between text-[13px]"><span className="text-gray-700">{label}</span><span className="font-bold tabular-nums">{rs(v)}</span></div>
                  <div className="h-1.5 rounded-full bg-gray-100 mt-1.5">
                    <div className="h-1.5 rounded-full" style={{ width: `${Math.max(2, pct(v, paidTotal))}%`, backgroundColor: '#059669' }} />
                  </div>
                </div>
              ))}
          </div>
        </section>
      )}

      {/* 5. Not money owed */}
      {acc.notPaid.all.count > 0 && (
        <button type="button" onClick={() => onOpen('notpaid')}
                className="w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl border-[1.5px] border-dashed border-gray-300 text-left">
          <span className="w-10 h-10 rounded-xl bg-gray-100 text-gray-500 flex items-center justify-center flex-shrink-0">
            <CreditCard size={19} />
          </span>
          <span className="flex-grow min-w-0">
            <span className="block text-sm font-bold text-gray-900">{plural(acc.notPaid.all.count, 'online payment', 'online payments')} didn&rsquo;t go through</span>
            <span className="block text-xs text-gray-600">{rs(acc.notPaid.all.amount)} · not money owed, kept out of your sales</span>
          </span>
          <ChevronRight size={16} className="text-gray-400 flex-shrink-0" />
        </button>
      )}

      {/* Nothing sold yet */}
      {gross <= 0 && acc.notPaid.all.count === 0 && (
        <div className="text-center py-8 px-4 rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50/50">
          <Banknote size={26} className="mx-auto text-gray-300" />
          <p className="text-sm font-semibold text-gray-700 mt-2">No sales yet</p>
          <p className="text-xs text-gray-400 mt-1">Your money shows up here from the first order.</p>
        </div>
      )}
    </div>
  );
}

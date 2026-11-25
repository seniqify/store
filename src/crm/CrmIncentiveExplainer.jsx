// The incentive, explained with pictures: the timeline from link to payout,
// who gets the credit, how much per shop (a small chart), and a worked month.
// Every number comes from the rule in Settings (incentiveRule), so the
// pictures change when the manager changes the rule.
import { useState } from 'react';
import { incentiveRule } from './crmLogic.js';
import { Icon } from './ui.jsx';
import { card } from './crmStyles.js';

const inr = (n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;
// Validated pair (dataviz validator, light surface): normal rate, higher rate.
const NORMAL = '#4cb874';
const HIGHER = '#167a3c';

function Timeline({ r }) {
  const steps = [
    { icon: 'wa', title: 'Share your link or code', text: 'With every shop you call or visit.' },
    { icon: 'user', title: 'The shop signs up', text: 'With your link: the lead becomes yours.' },
    { icon: 'coin', title: 'Day 0: the shop pays', text: 'The CRM marks it Won with the plan and amount. Your incentive starts “waiting”.' },
    { icon: 'calendar', title: `Day ${r.hold_days}: the first renewal`, text: 'A monthly shop pays its second month.' },
    { icon: 'shield', title: `Day ${r.hold_days + 4}: the CRM checks`, text: 'Still paying: Earned. Stopped: Cancelled.' },
    { icon: 'check', title: 'You are paid', text: `Paid ${r.pay_day}.` },
  ];
  return (
    <ol className="grid sm:grid-cols-3 lg:grid-cols-6 gap-2" aria-label="From your link to your payout">
      {steps.map((s, i) => (
        <li key={s.title} className="relative rounded-xl border border-gray-200 bg-white p-3">
          <div className="flex items-center gap-2">
            <span className={`w-8 h-8 rounded-full grid place-items-center shrink-0 ${i === 4 ? 'bg-amber-100 text-amber-900' : i === 5 ? 'bg-green-700 text-white' : 'bg-green-100 text-green-800'}`}><Icon name={s.icon} size={16} /></span>
            <span className="text-[11.5px] font-extrabold text-gray-500">STEP {i + 1}</span>
          </div>
          <div className="font-extrabold text-[14px] mt-2 leading-snug">{s.title}</div>
          <p className="text-[12.5px] text-gray-600 mt-0.5">{s.text}</p>
          {i === 4 && (
            <div className="mt-2 grid grid-cols-2 gap-1 text-[11.5px] font-bold">
              <span className="rounded-md bg-green-100 text-green-800 px-1.5 py-1 text-center">✓ Earned</span>
              <span className="rounded-md bg-red-100 text-red-800 px-1.5 py-1 text-center">✗ Cancelled</span>
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}

function Box({ tone = 'q', children }) {
  const cls = tone === 'yes' ? 'bg-green-700 text-white border-green-700' : tone === 'no' ? 'bg-gray-100 text-gray-700 border-gray-200' : 'bg-white text-gray-900 border-gray-300';
  return <div className={`rounded-xl border-2 px-3 py-2.5 text-[13.5px] font-bold text-center ${cls}`}>{children}</div>;
}
const Down = ({ label }) => (
  <div className="flex flex-col items-center text-[11.5px] font-extrabold text-gray-500 py-1" aria-hidden="true">
    {label && <span>{label}</span>}<span className="text-lg leading-none">↓</span>
  </div>
);

function CreditFlow() {
  return (
    <div className="grid md:grid-cols-2 gap-4" aria-label="Who gets the credit for a paid shop">
      <div>
        <Box>A shop pays for PocketLink</Box>
        <Down />
        <Box>Did it sign up with your link or code?</Box>
        <div className="grid grid-cols-2 gap-3 mt-1">
          <div><Down label="YES" /><Box tone="yes">The win and incentive are yours</Box></div>
          <div>
            <Down label="NO" />
            <Box>Did you call or visit it before it paid?</Box>
            <div className="grid grid-cols-2 gap-2 mt-1">
              <div><Down label="YES" /><Box tone="yes">Yours</Box></div>
              <div><Down label="NO" /><Box tone="no">Nobody’s: it paid by itself</Box></div>
            </div>
          </div>
        </div>
      </div>
      <div>
        <Box>You tapped “Won · paid”, but PocketLink sees no payment</Box>
        <Down />
        <Box>Your manager checks it (e.g. paid another way)</Box>
        <div className="grid grid-cols-2 gap-3 mt-1">
          <div><Down label="APPROVED" /><Box tone="yes">Yours, confirmed again after 30 days</Box></div>
          <div><Down label="NOT PAID" /><Box tone="no">Back to Interested, not counted</Box></div>
        </div>
        <p className="text-[12.5px] text-gray-600 mt-3">Someone else worked the lead in the last 14 days? It stays with them, even if the shop used your link. Ask your manager if you think that is wrong.</p>
      </div>
    </div>
  );
}

/** Amount per paid shop, by its number in the month (monthly plan), as bars. */
function AmountChart({ r }) {
  const [hover, setHover] = useState(null);
  const n = Math.max(12, Math.min(16, (r.slab_after || 10) + 4));
  const bars = Array.from({ length: n }, (_, i) => ({ k: i + 1, v: r.slab_after > 0 && i >= r.slab_after ? r.slab_monthly : r.monthly }));
  const max = Math.max(...bars.map((b) => b.v), 1);
  const W = 560, H = 180, top = 34, base = 150, slot = W / n, bw = Math.min(24, slot - 6);
  const y = (v) => base - ((base - top) * v) / max;
  const firstHigh = bars.findIndex((b) => b.v !== r.monthly);
  return (
    <figure className="space-y-2">
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img"
          aria-label={`Monthly plan: ${inr(r.monthly)} for each of your first ${r.slab_after} paid shops in a month, then ${inr(r.slab_monthly)} each.`}>
          <line x1="0" x2={W} y1={base} y2={base} stroke="#e5e7eb" strokeWidth="1" />
          {bars.map((b, i) => {
            const x = i * slot + (slot - bw) / 2, yy = y(b.v);
            const high = firstHigh >= 0 && i >= firstHigh;
            return (
              <g key={b.k} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex={0}>
                <rect x={i * slot} y={top - 10} width={slot} height={base - top + 30} fill="transparent" />
                <path d={`M${x},${base} V${yy + 4} Q${x},${yy} ${x + 4},${yy} H${x + bw - 4} Q${x + bw},${yy} ${x + bw},${yy + 4} V${base} Z`} fill={high ? HIGHER : NORMAL} opacity={hover == null || hover === i ? 1 : 0.55} />
                {(b.k === 1 || b.k === r.slab_after || b.k === r.slab_after + 1 || b.k === n) && (
                  <text x={x + bw / 2} y={base + 16} textAnchor="middle" fontSize="12" fill="#6b7280">{b.k}</text>
                )}
              </g>
            );
          })}
          <text x={(slot * Math.min(r.slab_after || n, n)) / 2} y={y(r.monthly) - 10} textAnchor="middle" fontSize="13" fontWeight="700" fill="#111827">
            {inr(r.monthly)} each{r.slab_after > 0 ? ` · shops 1–${r.slab_after}` : ''}
          </text>
          {firstHigh >= 0 && (
            <text x={slot * firstHigh + (slot * (n - firstHigh)) / 2} y={y(r.slab_monthly) - 10} textAnchor="middle" fontSize="13" fontWeight="700" fill="#111827">
              {inr(r.slab_monthly)} each
            </text>
          )}
          <text x={W / 2} y={H - 2} textAnchor="middle" fontSize="11.5" fill="#6b7280">Your paid shops in a month, in order</text>
        </svg>
        {hover != null && (
          <div role="status" className="absolute -top-1 right-0 rounded-lg bg-gray-900 text-white text-[12.5px] font-bold px-2.5 py-1.5 pointer-events-none">
            Shop {bars[hover].k}: {inr(bars[hover].v)} (monthly plan)
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-2 text-[12.5px]">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 px-2.5 py-1"><span className="w-3 h-3 rounded-sm" style={{ background: NORMAL }} aria-hidden="true" />Normal rate</span>
        {firstHigh >= 0 && <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 px-2.5 py-1"><span className="w-3 h-3 rounded-sm" style={{ background: HIGHER }} aria-hidden="true" />Higher rate from shop {r.slab_after + 1}</span>}
        <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-900 text-white px-2.5 py-1 font-bold">Yearly plan: {inr(r.yearly)}{r.slab_after > 0 ? ` → ${inr(r.slab_yearly)} from shop ${r.slab_after + 1}` : ''}</span>
      </div>
      <details className="text-[13px]">
        <summary className="font-bold text-green-700 cursor-pointer">See as a table</summary>
        <table className="mt-2 text-[13px]">
          <thead><tr className="text-left text-gray-500"><th className="pr-4 py-1">Paid shop in the month</th><th className="pr-4 py-1">Monthly plan</th><th className="py-1">Yearly plan</th></tr></thead>
          <tbody>
            <tr><td className="pr-4 py-1">1st to {r.slab_after > 0 ? `${r.slab_after}th` : 'every'}</td><td className="pr-4 py-1">{inr(r.monthly)}</td><td className="py-1">{inr(r.yearly)}</td></tr>
            {r.slab_after > 0 && <tr><td className="pr-4 py-1">{r.slab_after + 1}th and after</td><td className="pr-4 py-1">{inr(r.slab_monthly)}</td><td className="py-1">{inr(r.slab_yearly)}</td></tr>}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

/** A worked month: 13 paid shops, one that stopped paying. */
function Example({ r }) {
  const plans = ['monthly', 'monthly', 'monthly', 'yearly', 'monthly', 'monthly', 'monthly', 'monthly', 'yearly', 'monthly', 'monthly', 'yearly', 'monthly'];
  const stopped = new Set([13]);
  const rows = plans.map((p, i) => {
    const high = r.slab_after > 0 && i >= r.slab_after;
    const amt = p === 'yearly' ? (high ? r.slab_yearly : r.yearly) : (high ? r.slab_monthly : r.monthly);
    return { k: i + 1, p, amt, ok: !stopped.has(i + 1) };
  });
  const earned = rows.filter((x) => x.ok).reduce((s, x) => s + x.amt, 0);
  const lost = rows.filter((x) => !x.ok).reduce((s, x) => s + x.amt, 0);
  return (
    <div className="space-y-2">
      <p className="text-[13.5px] text-gray-700">Example: in November, 13 shops pay after your calls, visits or with your link. Shop 13 stops paying before its check.</p>
      <div className="flex flex-wrap gap-1.5" aria-label="The 13 shops">
        {rows.map((x) => (
          <span key={x.k} title={`Shop ${x.k}: ${x.p} plan, ${inr(x.amt)}${x.ok ? '' : ', cancelled'}`}
            className={`rounded-lg px-2 py-1.5 text-[12px] font-bold border ${!x.ok ? 'bg-red-50 border-red-200 text-red-800 line-through' : r.slab_after > 0 && x.k > r.slab_after ? 'text-white border-transparent' : 'bg-white border-gray-200 text-gray-800'}`}
            style={x.ok && r.slab_after > 0 && x.k > r.slab_after ? { background: HIGHER } : undefined}>
            #{x.k} {x.p === 'yearly' ? 'Y' : 'M'} {inr(x.amt)}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-green-50 border border-green-200 p-2"><div className="text-[11.5px] font-bold text-green-800">EARNED</div><div className="text-xl font-extrabold">{inr(earned)}</div></div>
        <div className="rounded-xl bg-red-50 border border-red-200 p-2"><div className="text-[11.5px] font-bold text-red-800">CANCELLED</div><div className="text-xl font-extrabold">{inr(lost)}</div></div>
        <div className="rounded-xl bg-gray-50 border border-gray-200 p-2"><div className="text-[11.5px] font-bold text-gray-600">PAID</div><div className="text-[13px] font-extrabold leading-tight mt-1">{r.pay_day}</div></div>
      </div>
      <p className="text-[12px] text-gray-500">M = monthly plan, Y = yearly plan. Each shop is checked {r.hold_days + 4} days after it paid, so a shop that paid late in November is checked in December.</p>
    </div>
  );
}

/** The Ads & leads executive's small amount: from a checked lead to a payout. */
function CheckerTimeline({ r }) {
  const steps = [
    { icon: 'bolt', title: 'A lead comes in', text: 'From an ad, the website, or a list you import.' },
    { icon: 'shield', title: 'You check it: Verified', text: 'A real person, a real business, a working number.' },
    { icon: 'phone', title: 'A caller sells it', text: 'The rules give it to a caller, who calls and shows a demo.' },
    { icon: 'coin', title: 'Day 0: the shop pays', text: `Your ${inr(r.verifier_monthly)} (monthly) or ${inr(r.verifier_yearly)} (yearly) starts “waiting”.` },
    { icon: 'calendar', title: `Day ${r.hold_days + 4}: the CRM checks`, text: 'Still paying: Earned. Stopped: Cancelled.' },
    { icon: 'check', title: 'You are paid', text: `Paid ${r.pay_day}.` },
  ];
  return (
    <ol className="grid sm:grid-cols-3 lg:grid-cols-6 gap-2" aria-label="From a checked lead to your payout">
      {steps.map((s, i) => (
        <li key={s.title} className="rounded-xl border border-gray-200 bg-white p-3">
          <div className="flex items-center gap-2">
            <span className={`w-8 h-8 rounded-full grid place-items-center shrink-0 ${i === 4 ? 'bg-amber-100 text-amber-900' : i === 5 ? 'bg-green-700 text-white' : 'bg-green-100 text-green-800'}`}><Icon name={s.icon} size={16} /></span>
            <span className="text-[11.5px] font-extrabold text-gray-500">STEP {i + 1}</span>
          </div>
          <div className="font-extrabold text-[14px] mt-2 leading-snug">{s.title}</div>
          <p className="text-[12.5px] text-gray-600 mt-0.5">{s.text}</p>
        </li>
      ))}
    </ol>
  );
}

/** A worked month for the lead checker: 220 checked, 160 real, 7 paid, 1 stopped. */
function CheckerExample({ r }) {
  const paid = [['monthly', true], ['monthly', true], ['yearly', true], ['monthly', true], ['monthly', true], ['monthly', true], ['monthly', false]];
  const amt = (p) => (p === 'yearly' ? r.verifier_yearly : r.verifier_monthly);
  const earned = paid.filter(([, ok]) => ok).reduce((s, [p]) => s + amt(p), 0);
  const lost = paid.filter(([, ok]) => !ok).reduce((s, [p]) => s + amt(p), 0);
  return (
    <div className="space-y-2">
      <p className="text-[13.5px] text-gray-700">Example: in November you check 220 leads. 160 are real (Verified), 60 are junk. Callers sell to 7 of your real leads; the 7th stops paying before its check.</p>
      <div className="grid grid-cols-3 gap-2 text-center" aria-label="The month in numbers">
        {[['CHECKED', '220'], ['REAL', '160'], ['PAID', '7']].map(([k, v]) => (
          <div key={k} className="rounded-xl bg-white border border-gray-200 p-2"><div className="text-[11.5px] font-bold text-gray-500">{k}</div><div className="text-xl font-extrabold">{v}</div></div>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5" aria-label="The 7 paid shops">
        {paid.map(([p, ok], i) => (
          <span key={i} className={`rounded-lg px-2 py-1.5 text-[12px] font-bold border ${ok ? 'bg-white border-gray-200 text-gray-800' : 'bg-red-50 border-red-200 text-red-800 line-through'}`}>#{i + 1} {p === 'yearly' ? 'Y' : 'M'} {inr(amt(p))}</span>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-green-50 border border-green-200 p-2"><div className="text-[11.5px] font-bold text-green-800">EARNED</div><div className="text-xl font-extrabold">{inr(earned)}</div></div>
        <div className="rounded-xl bg-red-50 border border-red-200 p-2"><div className="text-[11.5px] font-bold text-red-800">CANCELLED</div><div className="text-xl font-extrabold">{inr(lost)}</div></div>
        <div className="rounded-xl bg-gray-50 border border-gray-200 p-2"><div className="text-[11.5px] font-bold text-gray-600">PAID</div><div className="text-[13px] font-extrabold leading-tight mt-1">{r.pay_day}</div></div>
      </div>
      <p className="text-[12px] text-gray-500">Junk earns nothing, and neither does a lead you marked Verified that turns out fake. Check carefully: real leads are what callers can sell.</p>
    </div>
  );
}

export default function IncentiveExplainer({ cfg, compact = false, role }) {
  const r = incentiveRule(cfg);
  if (role === 'ads') {
    return (
      <div className="space-y-4">
        <section className={`${card} p-4 space-y-3`}>
          <h2 className="font-extrabold">How you earn it</h2>
          <CheckerTimeline r={r} />
        </section>
        <section className={`${card} p-4 space-y-3`}>
          <h2 className="font-extrabold">A worked month</h2>
          <CheckerExample r={r} />
        </section>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <section className={`${card} p-4 space-y-3`}>
        <h2 className="font-extrabold">How you earn it</h2>
        <Timeline r={r} />
      </section>
      <section className={`${card} p-4 space-y-3`}>
        <h2 className="font-extrabold">How much for each paid shop</h2>
        <AmountChart r={r} />
      </section>
      {!compact && (
        <>
          <section className={`${card} p-4 space-y-3`}>
            <h2 className="font-extrabold">Who gets the credit</h2>
            <CreditFlow />
          </section>
          <section className={`${card} p-4 space-y-3`}>
            <h2 className="font-extrabold">A worked month</h2>
            <Example r={r} />
          </section>
        </>
      )}
    </div>
  );
}

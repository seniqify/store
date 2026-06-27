import { useState, useEffect, useCallback, useMemo } from 'react';
import { Users, RefreshCw, Search, MessageCircle, Phone, ChevronDown, Megaphone } from 'lucide-react';
import { fetchOrders } from '../../utils/orderService';
import { formatINR } from '../../utils/currency';
import { buildCustomers, summarizeCustomers, segmentCounts, SEGMENTS } from '../../utils/customers';

/**
 * CustomersTab — the owner's customer list, built entirely from their orders.
 *
 * Groups orders by phone into profiles (orders, spend, last seen, favourites),
 * auto-tags segments (Loyal / Win-back / Big spender / New), and lets the owner
 * message any customer in one tap (manual wa.me for now — the segment broadcast
 * comes in Phase 2). No new data is collected; this just organises what they own.
 */
export default function CustomersTab({ slug, pin, themeColor = '#0d9488', businessName = '' }) {
  const [orders,    setOrders]    = useState(null);   // null = loading
  const [seg,       setSeg]       = useState('all');
  const [query,     setQuery]     = useState('');
  const [openPhone, setOpenPhone] = useState(null);

  const load = useCallback(async () => { setOrders(null); setOrders(await fetchOrders(slug, pin)); }, [slug, pin]);
  useEffect(() => { load(); }, [load]);

  const customers = useMemo(() => (orders ? buildCustomers(orders) : []), [orders]);
  const summary   = useMemo(() => summarizeCustomers(customers), [customers]);
  const counts    = useMemo(() => segmentCounts(customers), [customers]);

  const filtered = useMemo(() => {
    let list = seg === 'all' ? customers : customers.filter((c) => c.segments.includes(seg));
    const q = query.trim().toLowerCase();
    if (q) {
      const digits = q.replace(/\D/g, '');
      list = list.filter((c) => c.name.toLowerCase().includes(q) || (digits && c.phone.includes(digits)));
    }
    return list;
  }, [customers, seg, query]);

  // ── Loading ──
  if (orders === null) {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-16 rounded-2xl bg-white border border-gray-100 animate-pulse" />)}
        </div>
        {[0, 1, 2].map((i) => <div key={i} className="h-16 rounded-2xl bg-white border border-gray-100 animate-pulse" />)}
      </div>
    );
  }

  // ── Empty (no customers with a usable number yet) ──
  if (customers.length === 0) {
    return (
      <div className="space-y-4">
        <Header themeColor={themeColor} count={0} onRefresh={load} />
        <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50/50 p-10 text-center">
          <div className="text-4xl mb-3">👥</div>
          <p className="font-bold text-gray-800">No customers yet</p>
          <p className="text-sm text-gray-400 mt-1 max-w-xs mx-auto">
            As customers place orders from your page, they'll be collected here — with what they buy and when they last came.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Header themeColor={themeColor} count={summary.total} onRefresh={load} />

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Customers"   value={summary.total} />
        <Stat label="Repeat rate" value={`${summary.repeatRate}%`} tint={themeColor} />
        <Stat label="Win-back"    value={summary.winback} tint={summary.winback > 0 ? '#dc2626' : undefined} />
        <Stat label="Avg / customer" value={formatINR(summary.avgClv)} />
      </div>

      {/* Search */}
      <div className="flex items-center gap-2 bg-white rounded-xl border border-gray-200 px-3 py-2">
        <Search size={15} className="text-gray-400 flex-shrink-0" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name or number…"
               className="flex-1 min-w-0 bg-transparent text-sm text-gray-900 placeholder-gray-400 focus:outline-none" />
      </div>

      {/* Segment chips */}
      <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-1 px-1">
        <Chip active={seg === 'all'} onClick={() => setSeg('all')} label="All" n={customers.length} />
        {Object.entries(SEGMENTS).map(([key, meta]) =>
          counts[key] > 0 ? (
            <Chip key={key} active={seg === key} onClick={() => setSeg(key)}
                  label={`${meta.emoji} ${meta.label}`} n={counts[key]} title={meta.desc} />
          ) : null
        )}
      </div>

      {/* Segment hint + future broadcast teaser */}
      {seg !== 'all' && SEGMENTS[seg] && (
        <p className="flex items-center gap-1.5 text-[11px] text-gray-400 px-1">
          <Megaphone size={12} className="flex-shrink-0" style={{ color: themeColor }} />
          {SEGMENTS[seg].desc}. Tap a customer to message them — one-tap broadcast to a whole segment is coming soon.
        </p>
      )}

      {/* Customer list */}
      <div className="space-y-2">
        {filtered.map((c) => (
          <CustomerRow key={c.phone} c={c} themeColor={themeColor} businessName={businessName}
                       open={openPhone === c.phone}
                       onToggle={() => setOpenPhone((p) => (p === c.phone ? null : c.phone))} />
        ))}
        {filtered.length === 0 && (
          <p className="text-center text-sm text-gray-400 py-8">No customers match.</p>
        )}
      </div>
    </div>
  );
}

// ── pieces ───────────────────────────────────────────────────────────────────

function Header({ themeColor, count, onRefresh }) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h2 className="text-lg font-extrabold text-gray-900 flex items-center gap-2">
          <Users size={18} style={{ color: themeColor }} /> Customers
        </h2>
        <p className="text-xs text-gray-400 mt-0.5">{count === 0 ? 'Built from your orders' : `${count} from your orders`}</p>
      </div>
      <button onClick={onRefresh}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-600 border border-gray-200
                   rounded-xl px-3 py-2 hover:bg-gray-50 active:scale-95 transition">
        <RefreshCw size={13} /> Refresh
      </button>
    </div>
  );
}

function Stat({ label, value, tint }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-3 shadow-sm">
      <p className="text-[11px] font-semibold text-gray-400">{label}</p>
      <p className="text-xl font-extrabold text-gray-900 mt-0.5 tabular-nums" style={tint ? { color: tint } : undefined}>{value}</p>
    </div>
  );
}

function Chip({ active, onClick, label, n, title }) {
  return (
    <button onClick={onClick} title={title}
      className={[
        'flex-shrink-0 px-3.5 py-1.5 rounded-full text-xs font-semibold border transition whitespace-nowrap',
        active ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300',
      ].join(' ')}>
      {label} {n > 0 && <span className={active ? 'opacity-70' : 'text-gray-400'}>({n})</span>}
    </button>
  );
}

function CustomerRow({ c, themeColor, businessName, open, onToggle }) {
  const waMsg = encodeURIComponent(reengageMsg(c, businessName));
  const waLink = `https://wa.me/91${c.phone}?text=${waMsg}`;

  return (
    <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
      {/* Row header (tap to expand) */}
      <div className="flex items-center gap-3 p-3 cursor-pointer" onClick={onToggle}>
        <span className="w-10 h-10 rounded-full flex items-center justify-center text-xs font-extrabold flex-shrink-0"
              style={{ backgroundColor: `${themeColor}14`, color: themeColor }}>
          {initials(c.name, c.phone)}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="font-bold text-gray-900 truncate leading-tight">{c.name || `+91 ${c.phone}`}</p>
            {c.segments.map((s) => (
              <span key={s} title={SEGMENTS[s].label} className="text-[11px] leading-none flex-shrink-0">{SEGMENTS[s].emoji}</span>
            ))}
          </div>
          <p className="text-[11px] text-gray-400 truncate mt-0.5">
            {c.orderCount} order{c.orderCount === 1 ? '' : 's'} · {formatINR(c.totalSpent)} · last {lastSeen(c.daysSinceLast)}
          </p>
        </div>
        <a href={waLink} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
           aria-label="Message on WhatsApp"
           className="flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center text-white active:scale-95"
           style={{ backgroundColor: '#25D366' }}>
          <MessageCircle size={16} />
        </a>
        <ChevronDown size={16} className={`text-gray-300 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </div>

      {/* Expanded: favourites + order history + actions */}
      {open && (
        <div className="border-t border-gray-100 px-4 py-3 space-y-3 bg-gray-50/40">
          {c.topItems.length > 0 && (
            <p className="text-xs text-gray-500">
              <span className="font-semibold text-gray-600">Usually buys:</span>{' '}
              {c.topItems.map((it) => it.name).join(' · ')}
            </p>
          )}

          <div className="space-y-1.5">
            {c.history.slice(0, 8).map((o) => (
              <div key={o.id} className="flex items-start justify-between gap-2 text-xs">
                <div className="min-w-0">
                  <span className="text-gray-400">{fmtDate(o.created_at)}</span>
                  {o.status === 'cancelled' && <span className="ml-1.5 text-red-400">(cancelled)</span>}
                  <span className="block text-gray-600 truncate">
                    {(o.items || []).map((it) => `${it.name}${it.qty > 1 ? `×${it.qty}` : ''}`).join(', ') || '—'}
                  </span>
                </div>
                <span className="tabular-nums text-gray-700 font-semibold flex-shrink-0">{formatINR(o.total || 0)}</span>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2 pt-1">
            <a href={waLink} target="_blank" rel="noopener noreferrer"
               className="inline-flex items-center gap-1.5 text-xs font-bold text-white px-3 py-2 rounded-xl active:scale-95"
               style={{ backgroundColor: '#25D366' }}>
              <MessageCircle size={13} /> Message
            </a>
            <a href={`tel:+91${c.phone}`}
               className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-600 border border-gray-200 px-3 py-2 rounded-xl hover:bg-gray-50 active:scale-95">
              <Phone size={13} /> Call
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

// ── helpers ──
function initials(name, phone) {
  const n = String(name || '').trim();
  if (n) return n.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  return phone.slice(-2);
}

function lastSeen(days) {
  if (days == null) return '—';
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  const m = Math.floor(days / 30);
  return m < 12 ? `${m}mo ago` : `${Math.floor(m / 12)}y ago`;
}

function fmtDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function reengageMsg(c, storeName) {
  const name = c.name || 'there';
  const at = storeName ? ` at ${storeName}` : '';
  if (c.segments.includes('winback'))
    return `Hi ${name}, we've missed you${at}! 😊 We've got something special for you — come see what's new.`;
  return `Hi ${name}, thank you for shopping with us${at}! 🙏 Here's what's new this week —`;
}

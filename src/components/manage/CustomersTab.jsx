import { useState, useEffect, useCallback, useMemo } from 'react';
import { Users, RefreshCw, Search, MessageCircle, Phone, ChevronDown, Megaphone, Download } from 'lucide-react';
import { fetchOrders } from '../../utils/orderService';
import { formatINR } from '../../utils/currency';
import { buildCustomers, summarizeCustomers, segmentCounts, SEGMENTS } from '../../utils/customers';
import { buildContactRows, contactsToCsv, downloadCsv, contactsFilename } from '../../utils/exportCustomers';
import OffersPanel from './OffersPanel';
import WalletCard from './WalletCard';
import { recordOptOut } from '../../utils/offerService';

/**
 * CustomersTab — the owner's customer list, built entirely from their orders.
 *
 * Groups orders by phone into profiles (orders, spend, last seen, favourites),
 * auto-tags segments (Loyal / Win-back / Big spender / New), and lets the owner
 * message any customer in one tap, or send an approved WhatsApp offer to the
 * whole segment (OffersPanel, paid from the message wallet, never to customers
 * who asked to stop). No new data is collected; this organises what they own.
 */
export default function CustomersTab({ slug, pin, themeColor = '#0d9488', businessName = '' }) {
  const [orders,    setOrders]    = useState(null);   // null = loading
  const [seg,       setSeg]       = useState('all');
  const [query,     setQuery]     = useState('');
  const [openPhone, setOpenPhone] = useState(null);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => { setOrders(null); setOrders(await fetchOrders(slug, pin)); }, [slug, pin]);
  useEffect(() => { load(); }, [load]);

  // Export ALL contacts — buyers + abandoned-cart leads — as a CSV the owner can
  // import into WhatsApp / contacts to win repeat sales. Re-fetches with
  // abandoned rows included (the on-screen list hides those by default).
  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      const all  = await fetchOrders(slug, pin, { includeAbandoned: true });
      const rows = buildContactRows(all);
      if (!rows.length) {
        alert('No customer contacts yet — they’ll appear here as orders (and abandoned carts) come in.');
        return;
      }
      downloadCsv(contactsFilename(businessName, slug), contactsToCsv(rows));
    } catch {
      alert('Could not export contacts. Please try again.');
    } finally {
      setExporting(false);
    }
  }, [slug, pin, businessName]);

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
        <Header themeColor={themeColor} count={0} onRefresh={load} onExport={handleExport} exporting={exporting} />
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

  const repeat = customers.filter((c) => c.orderCount >= 2).length;

  return (
    <div className="space-y-4">
      <Header themeColor={themeColor} count={summary.total} onRefresh={load} onExport={handleExport} exporting={exporting} />

      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Customers" value={summary.total} />
        <Stat label="Came back" value={repeat} />
        <Stat label="Not seen 30+ days" value={summary.winback} alert={summary.winback > 0} />
      </div>

      {/* Search */}
      <div className="flex items-center gap-2 bg-white rounded-xl border border-gray-200 px-3 h-[42px]">
        <Search size={15} className="text-gray-400 flex-shrink-0" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name or number…"
               aria-label="Search customers"
               className="flex-1 min-w-0 bg-transparent text-sm text-gray-900 placeholder-gray-400 focus:outline-none" />
      </div>

      {/* Segment chips */}
      <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-1 px-1">
        <Chip active={seg === 'all'} onClick={() => setSeg('all')} label="All" n={customers.length} />
        {Object.entries(SEGMENTS).map(([key, meta]) =>
          counts[key] > 0 ? (
            <Chip key={key} active={seg === key} onClick={() => setSeg(key)}
                  label={meta.label} n={counts[key]} title={meta.desc} />
          ) : null
        )}
      </div>

      {/* Segment hint */}
      {seg !== 'all' && SEGMENTS[seg] && (
        <p className="flex items-center gap-1.5 text-[11.5px] text-gray-500 px-1 -mt-2">
          <Megaphone size={12} className="flex-shrink-0" style={{ color: themeColor }} />
          {SEGMENTS[seg].label}: {SEGMENTS[seg].desc.charAt(0).toLowerCase() + SEGMENTS[seg].desc.slice(1)}.
        </p>
      )}

      {/* WhatsApp offers to the active segment, paid from the message wallet */}
      <OffersPanel slug={slug} pin={pin} businessName={businessName} themeColor={themeColor}
                   audience={filtered} audienceLabel={seg === 'all' ? 'all' : SEGMENTS[seg]?.label || seg} />
      <WalletCard slug={slug} pin={pin} themeColor={themeColor} storeName={businessName} compact />

      {/* Customer list */}
      <div className="space-y-2">
        {filtered.map((c) => (
          <CustomerRow key={c.phone} c={c} themeColor={themeColor} businessName={businessName}
                       slug={slug} pin={pin}
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

function Header({ themeColor, count, onRefresh, onExport, exporting }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="min-w-0">
        <h2 className="text-lg font-extrabold text-gray-900 flex items-center gap-2">
          <Users size={18} style={{ color: themeColor }} /> Customers
        </h2>
        <p className="text-xs text-gray-400 mt-0.5">{count === 0 ? 'Built from your orders' : `${count} from your orders`}</p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <button onClick={onExport} disabled={exporting}
          title="Download all contacts (buyers + abandoned carts) as a CSV — for WhatsApp / contacts import"
          className="inline-flex items-center gap-1.5 h-9 text-xs font-bold text-gray-700 border border-gray-200 bg-white
                     rounded-xl px-3 hover:bg-gray-50 active:scale-95 transition disabled:opacity-60 disabled:active:scale-100">
          <Download size={13} /> {exporting ? 'Exporting…' : 'Export'}
        </button>
        <button onClick={onRefresh} aria-label="Refresh"
          className="inline-flex items-center justify-center w-9 h-9 text-gray-500 border border-gray-200 bg-white
                     rounded-xl hover:bg-gray-50 active:scale-95 transition">
          <RefreshCw size={14} />
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value, alert = false }) {
  return (
    <div className={['rounded-2xl border px-3 py-2.5', alert ? 'border-red-100 bg-red-50/60' : 'border-gray-100 bg-white shadow-sm'].join(' ')}>
      <p className={['text-xl font-extrabold tabular-nums leading-tight', alert ? 'text-red-700' : 'text-gray-900'].join(' ')}>{value}</p>
      <p className={['text-[11.5px] mt-0.5 leading-tight', alert ? 'text-red-700' : 'text-gray-500'].join(' ')}>{label}</p>
    </div>
  );
}

function Chip({ active, onClick, label, n, title }) {
  return (
    <button onClick={onClick} title={title}
      className={[
        'flex-shrink-0 h-[34px] px-3.5 rounded-full text-[12.5px] border transition whitespace-nowrap',
        active ? 'bg-gray-900 text-white border-gray-900 font-bold' : 'bg-white text-gray-700 border-gray-200 hover:border-gray-300 font-semibold',
      ].join(' ')}>
      {label} {n > 0 && <span className={active ? 'opacity-70' : 'text-gray-400'}>{n}</span>}
    </button>
  );
}

// Segment tags on each customer: words, not emoji, coloured by meaning.
const TAG = {
  winback:    'bg-red-50 text-red-700',
  bigspender: 'bg-amber-50 text-amber-700',
  loyal:      'bg-emerald-50 text-emerald-700',
  new:        'bg-blue-50 text-blue-700',
};

function CustomerRow({ c, themeColor, businessName, slug, pin, open, onToggle }) {
  const waMsg = encodeURIComponent(reengageMsg(c, businessName));
  const waLink = `https://wa.me/91${c.phone}?text=${waMsg}`;
  const [stopped, setStopped] = useState('');   // '' | 'saving' | 'done' | 'error'

  // The customer asked the shop (in person, on a call, on WhatsApp) to stop
  // offers: from now on no offer or cart reminder goes to them from this shop.
  async function stopOffers() {
    if (!window.confirm(`Stop WhatsApp offers and cart reminders to ${c.name || 'this customer'}?`)) return;
    setStopped('saving');
    try { await recordOptOut(slug, pin, c.phone); setStopped('done'); } catch { setStopped('error'); }
  }

  return (
    <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
      {/* Row header (tap to expand) */}
      <div className="flex items-center gap-3 p-3 cursor-pointer" onClick={onToggle}>
        <span className="w-10 h-10 rounded-full flex items-center justify-center text-xs font-extrabold flex-shrink-0"
              style={{ backgroundColor: `${themeColor}14`, color: themeColor }}>
          {initials(c.name, c.phone)}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="font-extrabold text-gray-900 truncate leading-tight max-w-full">{c.name || `+91 ${c.phone}`}</p>
            {c.segments.filter((s) => s !== 'new').map((s) => (
              <span key={s} className={`text-[10.5px] font-bold px-1.5 py-0.5 rounded-full leading-none flex-shrink-0 ${TAG[s] || 'bg-gray-100 text-gray-600'}`}>
                {SEGMENTS[s].label}
              </span>
            ))}
          </div>
          <p className="text-xs text-gray-500 truncate mt-0.5">
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
        <div className="border-t border-gray-100 px-4 py-3 space-y-3">
          {c.topItems.length > 0 && (
            <div className="rounded-xl bg-gray-50 px-3 py-2">
              <p className="text-[10.5px] font-extrabold uppercase tracking-wider text-gray-500">Usually buys</p>
              <p className="text-xs text-gray-700 mt-0.5">{c.topItems.map((it) => `${it.name} × ${it.qty}`).join(' · ')}</p>
            </div>
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

          <div className="grid grid-cols-2 gap-2 pt-1">
            <a href={waLink} target="_blank" rel="noopener noreferrer"
               className="inline-flex items-center justify-center gap-1.5 h-10 text-[13px] font-extrabold text-white rounded-xl active:scale-95"
               style={{ backgroundColor: '#25D366' }}>
              <MessageCircle size={15} /> Message
            </a>
            <a href={`tel:+91${c.phone}`}
               className="inline-flex items-center justify-center gap-1.5 h-10 text-[13px] font-bold text-gray-700 border border-gray-200 bg-white rounded-xl hover:bg-gray-50 active:scale-95">
              <Phone size={14} /> Call
            </a>
          </div>
          <button type="button" onClick={stopOffers} disabled={stopped === 'saving' || stopped === 'done'}
            className="text-[11px] font-semibold text-gray-400 hover:text-gray-600 underline underline-offset-2 disabled:no-underline">
            {stopped === 'done' ? 'Offers stopped for this customer'
              : stopped === 'error' ? 'Could not save — try again'
              : 'Customer asked to stop offers'}
          </button>
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

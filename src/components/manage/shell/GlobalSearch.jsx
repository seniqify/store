import { useState, useMemo, useRef, useEffect } from 'react';
import { Search, ShoppingBag, Users, ChevronLeft, CornerDownLeft } from 'lucide-react';
import { searchSuggestions } from '../../../utils/dashboardShell';
import { isImageSrc } from '../../../utils/pinGate';
import { formatINR } from '../../../utils/currency';

/**
 * One search box for the whole dashboard. Typing offers: find this in Orders,
 * find it in Customers, matching products, and matching sections. Picking a row
 * opens that section with the text already in its own search box.
 *
 *   variant="bar"  -- the box in the computer's top bar, results drop down
 *   variant="page" -- the phone's full-screen search (with a back arrow)
 */
export default function GlobalSearch({ tabs = [], products = [], onFind, onSection, variant = 'bar', onClose }) {
  const page = variant === 'page';
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(page);
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  useEffect(() => { if (page) inputRef.current?.focus(); }, [page]);

  const rows = useMemo(() => {
    const s = searchSuggestions(q, { tabs, products });
    if (!s.find) return [];
    const ordersTab = tabs.find((t) => t.key === 'orders');
    const custTab = tabs.find((t) => t.key === 'customers');
    const out = [];
    if (ordersTab) out.push({ key: 'orders', Icon: ShoppingBag, title: `Find “${s.find}” in ${ordersTab.label}`, sub: 'Name, phone, order number or item', run: () => onFind('orders', s.find) });
    if (custTab) out.push({ key: 'customers', Icon: Users, title: `Find “${s.find}” in Customers`, sub: 'Name or phone number', run: () => onFind('customers', s.find) });
    s.products.forEach((p) => {
      const img = p.image || (Array.isArray(p.images) ? p.images[0] : null);
      out.push({ key: `p-${p.id}`, img: isImageSrc(img) ? img : null, emoji: p.emoji, title: p.name,
        sub: Number(p.price) > 0 ? formatINR(Number(p.price)) : 'Product', run: () => onFind('products', p.name) });
    });
    s.sections.forEach((t) => out.push({ key: `s-${t.key}`, Icon: t.icon, title: t.label, sub: 'Open this section', run: () => onSection(t.key) }));
    return out;
  }, [q, tabs, products, onFind, onSection]);

  const choose = (row) => { row.run(); setQ(''); setOpen(false); inputRef.current?.blur(); onClose?.(); };
  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(rows.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter' && rows[active]) { e.preventDefault(); choose(rows[active]); }
    else if (e.key === 'Escape') { if (page) onClose?.(); else { setOpen(false); inputRef.current?.blur(); } }
  };

  const list = (
    <div role="listbox" aria-label="Search results">
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-sm text-gray-500 text-center">
          {q.trim() ? 'Press Enter to search' : 'Type a customer name, phone number, order number or product'}
        </p>
      ) : rows.map((r, i) => (
        <button key={r.key} type="button" role="option" aria-selected={i === active}
          onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setActive(i)} onClick={() => choose(r)}
          className={`w-full flex items-center gap-3 px-4 py-2.5 text-left ${i === active ? 'bg-gray-50' : ''}`}>
          {r.img ? <img src={r.img} alt="" className="w-9 h-9 rounded-lg object-cover bg-gray-100 flex-shrink-0" />
            : r.Icon ? <span className="w-9 h-9 rounded-lg bg-gray-100 text-gray-600 grid place-items-center flex-shrink-0"><r.Icon size={17} /></span>
            : <span className="w-9 h-9 rounded-lg bg-gray-100 grid place-items-center flex-shrink-0 text-lg">{r.emoji || '📦'}</span>}
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-bold text-gray-900 truncate">{r.title}</span>
            <span className="block text-[12px] text-gray-500 truncate">{r.sub}</span>
          </span>
          {i === active && !page && <CornerDownLeft size={14} className="text-gray-400 flex-shrink-0" />}
        </button>
      ))}
    </div>
  );

  const input = (
    <input ref={inputRef} value={q} type="search" enterKeyHint="search"
      onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(0); }}
      onFocus={() => setOpen(true)} onBlur={() => { if (!page) setTimeout(() => setOpen(false), 120); }}
      onKeyDown={onKeyDown}
      placeholder="Search orders, customers, products" aria-label="Search the dashboard"
      className="w-full h-10 pl-10 pr-3 rounded-xl border border-gray-200 bg-white text-sm text-gray-900 placeholder:text-gray-400
                 focus:outline-none focus:border-gray-400 focus:ring-4 focus:ring-gray-200/70" />
  );

  if (page) {
    return (
      <div className="lg:hidden fixed inset-0 z-50 bg-white flex flex-col">
        <div className="flex-shrink-0 px-3 h-[60px] flex items-center gap-2 border-b border-gray-100">
          <button type="button" aria-label="Close search" onClick={onClose}
            className="w-9 h-9 rounded-full grid place-items-center text-gray-700 flex-shrink-0">
            <ChevronLeft size={22} />
          </button>
          <div className="relative flex-1">
            <Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            {input}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto py-1">{list}</div>
      </div>
    );
  }

  return (
    <div className="relative w-full">
      <Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
      {input}
      {open && (q.trim() || rows.length > 0) && (
        <div className="absolute top-12 left-0 right-0 z-40 bg-white rounded-2xl border border-gray-200 shadow-xl max-h-[420px] overflow-y-auto py-1">
          {list}
        </div>
      )}
    </div>
  );
}

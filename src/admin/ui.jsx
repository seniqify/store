// Small shared pieces for PocketLink Admin (dark cockpit, like the Console).
import { card, kicker, TONE } from './adminStyles.js';

const PATHS = {
  home: 'M3 11l9-8 9 8M5 10v10h14V10',
  store: 'M3 9l2-5h14l2 5M4 9v11h16V9M3 9h18M9 20v-6h6v6',
  card: 'M3 6h18v12H3zM3 10h18M7 15h3',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  box: 'M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8',
  people: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21c0-4 3-6 7-6s7 2 7 6M16 3.5a4 4 0 0 1 0 7.5M22 21c0-3-1.7-5-4-5.7',
  coin: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v10',
  server: 'M4 4h16v6H4zM4 14h16v6H4zM8 7h.01M8 17h.01',
  phone: 'M22 16.9v3a2 2 0 0 1-2.2 2A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z',
  out: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  menu: 'M3 6h18M3 12h18M3 18h18',
  x: 'M18 6L6 18M6 6l12 12',
  ext: 'M14 3h7v7M10 14L21 3M21 14v7H3V3h7',
  wa: 'M3 21l1.7-5A8.5 8.5 0 1 1 8 19.3z',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  download: 'M12 3v12M7 10l5 5 5-5M4 21h16',
  back: 'M15 18l-6-6 6-6',
  alert: 'M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
};

export function Icon({ name, size = 18, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d={PATHS[name] || PATHS.list} />
    </svg>
  );
}

export function Chip({ tone = 'off', children }) {
  return <span className={`inline-flex items-center h-6 px-2.5 rounded-full text-[12px] font-semibold whitespace-nowrap ${TONE[tone] || TONE.off}`}>{children}</span>;
}

export function Kpi({ label, value, sub, tone }) {
  const color = { bad: 'text-red-300', warn: 'text-amber-300' }[tone] || 'text-[#e7efe9]';
  return (
    <div className={`${card} px-4 py-3.5`}>
      <div className={kicker}>{label}</div>
      <div className={`text-[24px] font-extrabold mt-1 tracking-tight ${color}`}>{value}</div>
      {sub && <div className="text-[12.5px] text-[#8fa69a] mt-0.5">{sub}</div>}
    </div>
  );
}

export function Panel({ title, right, children, className = '' }) {
  return (
    <section aria-label={title} className={`${card} ${className}`}>
      {(title || right) && (
        <div className="flex flex-wrap items-center gap-2.5 px-4 py-3.5 border-b border-[#1f2b24]">
          <h2 className="m-0 text-[15px] font-bold flex-1">{title}</h2>{right}
        </div>
      )}
      {children}
    </section>
  );
}

export function Spinner({ label = 'Loading…' }) {
  return (
    <div className="flex items-center gap-2 text-sm text-[#8fa69a] py-12 justify-center" role="status">
      <span className="w-4 h-4 border-2 border-[#2b3b32] border-t-emerald-400 rounded-full animate-spin" />{label}
    </div>
  );
}

export function Notice({ kind = 'error', children }) {
  const cls = kind === 'ok' ? 'bg-[#0f2e22] border-emerald-800 text-[#a7f3d0]' : kind === 'warn' ? 'bg-[#2a1f08] border-[#5c4413] text-[#fde68a]' : 'bg-[#2a0f0f] border-red-900 text-red-200';
  return <div role={kind === 'error' ? 'alert' : 'status'} className={`border rounded-xl px-3.5 py-2.5 text-[13.5px] ${cls}`}>{children}</div>;
}

export function Empty({ children }) {
  return <p className="text-sm text-[#8fa69a] text-center py-10 px-4 m-0">{children}</p>;
}

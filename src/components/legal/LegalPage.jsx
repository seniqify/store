import { useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * LegalPage — a polished, tabbed layout shared by Terms and Privacy.
 *
 * Pages pass a `sections` array ({ id, title, icon, content }). On desktop the
 * sections become a sticky vertical tab navigator beside a content card; on
 * mobile they collapse to a swipeable row of tab pills. Prev/Next walks through
 * them. Brand-emerald throughout, matching the rest of PocketLink.
 */
export default function LegalPage({ kicker, title, lastUpdated, intro, summary, sections = [], other }) {
  const [active, setActive] = useState(sections[0]?.id);
  const idx = Math.max(0, sections.findIndex((s) => s.id === active));
  const current = sections[idx] || sections[0];
  const articleRef = useRef(null);

  function go(i) {
    const s = sections[i];
    if (!s) return;
    setActive(s.id);
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      requestAnimationFrame(() => articleRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  }

  const Icon = current?.icon;

  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-50/50 via-white to-white">

      {/* Top nav */}
      <nav className="border-b border-gray-100 bg-white/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
          <Link to="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <img src="/pocketlink-logo.svg" alt="PocketLink" className="h-6 w-auto" />
          </Link>
          <Link to="/" className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-emerald-700 transition-colors">
            <ArrowLeft size={13} /> Back to home
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <header className="max-w-5xl mx-auto px-4 pt-11 pb-7">
        {kicker && <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-emerald-600 mb-2">{kicker}</p>}
        <h1 className="text-3xl sm:text-4xl font-extrabold text-gray-900 tracking-tight">{title}</h1>
        <p className="text-sm text-gray-400 mt-2">Last updated: {lastUpdated}</p>
        {intro && <p className="text-[15px] text-gray-600 leading-relaxed mt-4 max-w-2xl">{intro}</p>}
        {summary && (
          <div className="mt-6 rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4 sm:p-5">
            <p className="text-[11px] font-bold uppercase tracking-wide text-emerald-700 mb-1.5">The short version</p>
            <p className="text-sm text-gray-700 leading-relaxed">{summary}</p>
          </div>
        )}
      </header>

      {/* Tabbed body */}
      <main className="max-w-5xl mx-auto px-4 pb-14">
        <div className="lg:grid lg:grid-cols-[260px_1fr] lg:gap-6 lg:items-start">

          {/* Tab navigator — vertical on desktop, swipeable pills on mobile */}
          <nav className="lg:sticky lg:top-20">
            <div className="flex lg:flex-col gap-1.5 overflow-x-auto scrollbar-hide -mx-4 px-4 lg:mx-0 lg:px-0 pb-1.5 lg:pb-0">
              {sections.map((s, i) => {
                const on = s.id === active;
                const TabIcon = s.icon;
                return (
                  <button key={s.id} onClick={() => go(i)}
                    className={[
                      'group flex items-center gap-2.5 flex-shrink-0 lg:flex-shrink rounded-xl px-3 py-2.5 text-left transition',
                      on ? 'bg-emerald-50 ring-1 ring-emerald-200' : 'hover:bg-white hover:ring-1 hover:ring-gray-100',
                    ].join(' ')}>
                    <span className={[
                      'flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center transition',
                      on ? 'bg-emerald-500 text-white' : 'bg-gray-100 text-gray-400 group-hover:bg-gray-200',
                    ].join(' ')}>
                      {TabIcon ? <TabIcon size={15} /> : i + 1}
                    </span>
                    <span className={[
                      'text-[13px] whitespace-nowrap lg:whitespace-normal lg:leading-tight',
                      on ? 'font-bold text-emerald-800' : 'font-medium text-gray-500 group-hover:text-gray-700',
                    ].join(' ')}>
                      {s.title}
                    </span>
                  </button>
                );
              })}
            </div>
          </nav>

          {/* Active section */}
          <article ref={articleRef} className="mt-4 lg:mt-0 scroll-mt-20">
            <div className="rounded-2xl border border-gray-100 bg-white p-5 sm:p-7 shadow-sm">
              <div className="flex items-center gap-3 mb-5 pb-4 border-b border-gray-100">
                <span className="flex-shrink-0 w-11 h-11 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
                  {Icon ? <Icon size={20} /> : idx + 1}
                </span>
                <div className="min-w-0">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-emerald-600">Section {idx + 1} of {sections.length}</p>
                  <h2 className="text-lg sm:text-xl font-extrabold text-gray-900 leading-tight">{current?.title}</h2>
                </div>
              </div>
              <div className="text-[14px] text-gray-600 leading-relaxed space-y-3 [&_strong]:font-semibold [&_strong]:text-gray-800 [&_a]:text-emerald-700 [&_a]:font-medium [&_a:hover]:underline">
                {current?.content}
              </div>
            </div>

            {/* Prev / Next */}
            <div className="flex items-center justify-between gap-3 mt-4">
              <button onClick={() => go(idx - 1)} disabled={idx === 0}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-600 bg-white border border-gray-200 rounded-xl px-3.5 py-2 hover:bg-gray-50 active:scale-95 transition disabled:opacity-40 disabled:pointer-events-none">
                <ChevronLeft size={14} /> Previous
              </button>
              <span className="text-[11px] text-gray-400 tabular-nums">{idx + 1} / {sections.length}</span>
              <button onClick={() => go(idx + 1)} disabled={idx === sections.length - 1}
                className="inline-flex items-center gap-1.5 text-xs font-bold text-white bg-emerald-600 rounded-xl px-3.5 py-2 hover:bg-emerald-700 active:scale-95 transition disabled:opacity-40 disabled:pointer-events-none">
                Next <ChevronRight size={14} />
              </button>
            </div>
          </article>
        </div>

        <div className="mt-8 rounded-2xl border border-gray-100 bg-gray-50 p-5 text-center">
          <p className="text-sm text-gray-600">
            Questions? Email{' '}
            <a href="mailto:hello@pocketlink.store" className="font-semibold text-emerald-700 hover:underline">hello@pocketlink.store</a>
          </p>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-100 px-4 py-8 text-center text-xs text-gray-400">
        <div className="flex items-center justify-center gap-3">
          <Link to="/" className="hover:text-gray-700 transition-colors">PocketLink home</Link>
          {other && (
            <>
              <span className="text-gray-300">·</span>
              <Link to={other.to} className="hover:text-gray-700 transition-colors">{other.label}</Link>
            </>
          )}
        </div>
        <p className="mt-3">© {new Date().getFullYear()} PocketLink · Made in India 🇮🇳</p>
      </footer>
    </div>
  );
}

/** Tidy emerald-bulleted list. `items` may contain JSX (e.g. bold). */
export function Bullets({ items }) {
  return (
    <ul className="space-y-1.5">
      {items.map((it, i) => (
        <li key={i} className="flex gap-2">
          <span className="text-emerald-500 mt-px flex-shrink-0">•</span>
          <span>{it}</span>
        </li>
      ))}
    </ul>
  );
}

/** Highlighted callout for points that must stand out (e.g. no refunds). */
export function Callout({ tone = 'amber', title, children }) {
  const tones = {
    amber:   'border-amber-200 bg-amber-50 text-amber-900',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    rose:    'border-rose-200 bg-rose-50 text-rose-900',
  };
  return (
    <div className={`rounded-xl border p-3.5 ${tones[tone]}`}>
      {title && <p className="font-bold text-sm mb-1">{title}</p>}
      <div className="text-[13px] leading-relaxed [&_strong]:font-bold">{children}</div>
    </div>
  );
}

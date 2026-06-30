import { useState } from 'react';
import {
  Bot, ArrowRight, CheckCircle2, Circle, ChevronDown,
  Rocket, PartyPopper, MessageCircleQuestion, Share2, Languages,
} from 'lucide-react';
import { buildCoach } from '../../utils/storeCoach';
import { coachText, LANGS } from '../../utils/coachI18n';

const LANG_KEY = 'pocketlink_coach_lang';

/**
 * AssistantTab — "Pocket", the in-dashboard setup coach (English / हिंदी / मराठी).
 *
 * A free, instant, no-AI helper for every owner. storeCoach.js grades the store
 * config (language-independent); coachI18n.js supplies all text per language.
 * It surfaces the highest-impact next step, a tappable checklist that jumps to
 * the right tab, and a plain-language FAQ. Zero network, zero cost.
 *
 * Props:
 *   config        — the store business config
 *   themeColor    — brand colour for accents
 *   onGoTab(key)  — switch the Manage dashboard to another tab
 *   businessName  — for the greeting
 */
export default function AssistantTab({ config = {}, themeColor = '#0d9488', onGoTab, businessName = '' }) {
  const [lang, setLang] = useState(() => {
    try { return localStorage.getItem(LANG_KEY) || 'en'; } catch { return 'en'; }
  });
  function chooseLang(code) {
    setLang(code);
    try { localStorage.setItem(LANG_KEY, code); } catch { /* private mode */ }
  }

  const T = coachText(lang);
  const { todo, done, doneCount, total, score, nextTask } = buildCoach(config);
  const nx = nextTask ? T.tasks[nextTask.id] : null;

  return (
    <div className="space-y-4">

      {/* ── Language switcher ────────────────────────────────────────────── */}
      <div className="flex justify-end">
        <div className="inline-flex items-center gap-0.5 bg-white border border-gray-200 rounded-full p-0.5 shadow-sm">
          <Languages size={13} className="text-gray-400 ml-1.5 mr-0.5 flex-shrink-0" />
          {LANGS.map((l) => {
            const active = lang === l.code;
            return (
              <button key={l.code} type="button" onClick={() => chooseLang(l.code)}
                className={['text-xs font-bold px-2.5 py-1 rounded-full transition-colors', active ? 'text-white' : 'text-gray-600 hover:bg-gray-100'].join(' ')}
                style={active ? { backgroundColor: themeColor } : undefined}>
                {l.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Bot greeting + store-health ring ─────────────────────────────── */}
      <div className="relative overflow-hidden rounded-2xl p-5 text-white shadow-lg"
           style={{ background: `linear-gradient(135deg, ${themeColor}, ${themeColor}cc)` }}>
        <div className="absolute inset-0 opacity-15 pointer-events-none"
             style={{ backgroundImage: 'radial-gradient(#fff 1px, transparent 1px)', backgroundSize: '15px 15px' }} />
        <div className="relative flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center flex-shrink-0 ring-1 ring-white/30">
            <Bot size={26} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-bold uppercase tracking-widest text-white/80">{T.ui.subtitle}</p>
            <p className="text-sm font-semibold leading-snug mt-1">{T.greeting(score, businessName)}</p>
          </div>
          <Ring score={score} />
        </div>
        {score < 100 && (
          <p className="relative mt-3 text-xs font-medium text-white/80">
            {T.ui.stepsProgress.replace('{done}', doneCount).replace('{total}', total)}
          </p>
        )}
      </div>

      {/* ── Next best step / all-done celebration ────────────────────────── */}
      {nx ? (
        <button type="button" onClick={() => onGoTab?.(nextTask.tab)}
          className="w-full text-left rounded-2xl border-2 p-4 transition-all hover:shadow-md active:scale-[0.99]"
          style={{ borderColor: `${themeColor}55`, background: `${themeColor}0c` }}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white flex-shrink-0 shadow-sm"
                 style={{ backgroundColor: themeColor }}>
              <Rocket size={20} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: themeColor }}>{T.ui.doNext}</p>
              <p className="text-sm font-extrabold text-gray-900 leading-tight">{nx.title}</p>
              <p className="text-xs text-gray-500 mt-0.5 leading-snug">{nx.desc}</p>
            </div>
            <ArrowRight size={18} className="flex-shrink-0" style={{ color: themeColor }} />
          </div>
        </button>
      ) : (
        <div className="rounded-2xl border-2 p-4" style={{ borderColor: `${themeColor}55`, background: `${themeColor}0c` }}>
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white flex-shrink-0 shadow-sm"
                 style={{ backgroundColor: themeColor }}>
              <PartyPopper size={20} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-extrabold text-gray-900">{T.ui.allSetTitle}</p>
              <p className="text-xs text-gray-600 mt-1 leading-relaxed">{T.ui.bringCustomers}</p>
              <ul className="mt-1.5 space-y-1 text-xs text-gray-600">
                {T.ui.shareTips.map((tip, i) => <li key={i}>• {tip}</li>)}
              </ul>
              <button type="button" onClick={() => onGoTab?.('settings')}
                className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-white px-3.5 py-2 rounded-lg active:scale-95 transition-transform"
                style={{ backgroundColor: themeColor }}>
                <Share2 size={13} /> {T.ui.shareBtn}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Setup checklist ──────────────────────────────────────────────── */}
      <div>
        <h3 className="flex items-center gap-2 text-sm font-extrabold text-gray-900 mb-2.5">
          <span className="w-1.5 h-5 rounded-full inline-block flex-shrink-0" style={{ backgroundColor: themeColor }} />
          {T.ui.checklist}
        </h3>

        {todo.length > 0 ? (
          <div className="space-y-2">
            {todo.map((t) => {
              const tx = T.tasks[t.id];
              return (
                <button key={t.id} type="button" onClick={() => onGoTab?.(t.tab)}
                  className="w-full text-left flex items-center gap-3 rounded-xl border border-gray-100 bg-white p-3 shadow-sm
                             hover:border-gray-200 hover:shadow active:scale-[0.99] transition-all">
                  <Circle size={20} className="text-gray-300 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-gray-900 leading-tight">{tx.title}</p>
                    <p className="text-xs text-gray-500 mt-0.5 leading-snug">{tx.desc}</p>
                  </div>
                  <span className="flex-shrink-0 inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1.5 rounded-lg"
                        style={{ color: themeColor, background: `${themeColor}14` }}>
                    {tx.cta} <ArrowRight size={12} />
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-gray-500 bg-white rounded-xl border border-gray-100 p-3 shadow-sm">
            {T.ui.allStepsDone}
          </p>
        )}

        {/* Completed (collapsed) */}
        {done.length > 0 && (
          <CompletedList items={done} tasks={T.tasks} themeColor={themeColor}
            label={T.ui.completed.replace('{n}', done.length)} />
        )}
      </div>

      {/* ── FAQ ──────────────────────────────────────────────────────────── */}
      <div>
        <h3 className="flex items-center gap-2 text-sm font-extrabold text-gray-900 mb-2.5">
          <MessageCircleQuestion size={17} style={{ color: themeColor }} />
          {T.ui.gotQuestion}
        </h3>
        <div className="space-y-2">
          {T.faqs.map((f, i) => (
            <Faq key={i} item={f} themeColor={themeColor} onGoTab={onGoTab}
              takeThere={T.ui.takeThere} seePlans={T.ui.seePlans} />
          ))}
        </div>
      </div>

    </div>
  );
}

// ── Store-health ring (compact SVG donut) ─────────────────────────────────────
function Ring({ score }) {
  const r = 20, c = 2 * Math.PI * r;
  const off = c * (1 - Math.max(0, Math.min(100, score)) / 100);
  return (
    <div className="relative flex-shrink-0 w-14 h-14">
      <svg viewBox="0 0 48 48" className="w-14 h-14 -rotate-90">
        <circle cx="24" cy="24" r={r} fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="5" />
        <circle cx="24" cy="24" r={r} fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round"
                strokeDasharray={c} strokeDashoffset={off} style={{ transition: 'stroke-dashoffset 600ms ease' }} />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-sm font-extrabold tabular-nums">{score}%</span>
    </div>
  );
}

// ── Completed checklist (collapsible) ─────────────────────────────────────────
function CompletedList({ items, tasks, themeColor, label }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      <button type="button" onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs font-bold text-gray-500 hover:text-gray-700 transition-colors py-1">
        <CheckCircle2 size={14} style={{ color: themeColor }} />
        {label}
        <ChevronDown size={14} className={['transition-transform', open ? 'rotate-180' : ''].join(' ')} />
      </button>
      {open && (
        <div className="mt-1.5 space-y-1.5">
          {items.map((t) => (
            <div key={t.id} className="flex items-center gap-3 rounded-xl border border-gray-50 bg-gray-50/60 p-2.5">
              <CheckCircle2 size={18} style={{ color: themeColor }} className="flex-shrink-0" />
              <p className="text-sm font-semibold text-gray-500 line-through decoration-gray-300">{tasks[t.id]?.title}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── FAQ accordion row ─────────────────────────────────────────────────────────
function Faq({ item, themeColor, onGoTab, takeThere, seePlans }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden">
      <button type="button" onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 p-3 text-left">
        <span className="text-sm font-bold text-gray-800">{item.q}</span>
        <ChevronDown size={16} className={['text-gray-400 flex-shrink-0 transition-transform', open ? 'rotate-180' : ''].join(' ')} />
      </button>
      {open && (
        <div className="px-3 pb-3 -mt-0.5">
          <p className="text-[13px] text-gray-600 leading-relaxed">{item.a}</p>
          {item.tab && (
            <button type="button" onClick={() => onGoTab?.(item.tab)}
              className="mt-2.5 inline-flex items-center gap-1 text-xs font-bold active:scale-95 transition-transform"
              style={{ color: themeColor }}>
              {takeThere} <ArrowRight size={12} />
            </button>
          )}
          {item.link && (
            <a href={item.link}
              className="mt-2.5 inline-flex items-center gap-1 text-xs font-bold active:scale-95 transition-transform"
              style={{ color: themeColor }}>
              {seePlans} <ArrowRight size={12} />
            </a>
          )}
        </div>
      )}
    </div>
  );
}

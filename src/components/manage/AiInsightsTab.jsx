import { useState, useEffect } from 'react';
import {
  Sparkles, Search, TrendingUp, Target, HelpCircle, Lightbulb,
  Lock, RefreshCw, MessageSquareText, PackagePlus,
} from 'lucide-react';
import { fetchAiSearches, analyzeSearches, buildInsightSummary, generateRecommendations } from '../../utils/aiInsights';

/**
 * AiInsightsTab — Premium dashboard analysing storefront AI Search Bar queries.
 * Tells the owner what customers want: top searches, missed-opportunity products,
 * intent mix, unanswered questions, trends, and AI-written recommendations.
 */
export default function AiInsightsTab({ slug, pin, themeColor = '#0d9488', enabled = false, businessName = 'your store' }) {
  const [loading, setLoading]   = useState(true);
  const [insights, setInsights] = useState(null);

  const [recs, setRecs]               = useState(null);
  const [recsLoading, setRecsLoading] = useState(false);
  const [recsError, setRecsError]     = useState('');

  useEffect(() => {
    if (!enabled) { setLoading(false); return; }
    let alive = true;
    (async () => {
      const rows = await fetchAiSearches(slug, pin);
      if (alive) { setInsights(analyzeSearches(rows)); setLoading(false); }
    })();
    return () => { alive = false; };
  }, [slug, pin, enabled]);

  async function genRecs() {
    if (!insights) return;
    setRecsLoading(true); setRecsError('');
    const out = await generateRecommendations(slug, buildInsightSummary(insights));
    if (!out.length) setRecsError('Couldn’t generate insights right now — please try again.');
    setRecs(out);
    setRecsLoading(false);
  }

  // ── Premium gate ───────────────────────────────────────────────────────────
  if (!enabled) {
    return (
      <div className="rounded-2xl border-2 border-dashed p-6 text-center" style={{ borderColor: `${themeColor}44`, background: `${themeColor}08` }}>
        <div className="w-12 h-12 mx-auto mb-3 rounded-2xl flex items-center justify-center text-white shadow-sm" style={{ backgroundColor: themeColor }}>
          <Sparkles size={22} />
        </div>
        <h3 className="text-base font-extrabold text-gray-900">AI Insights</h3>
        <p className="text-sm text-gray-500 mt-1.5 max-w-sm mx-auto leading-relaxed">
          See exactly what customers ask your store’s AI — top searches, products they wanted but you don’t stock, and
          <strong className="text-gray-700"> AI-written tips to sell more</strong>. A Premium feature.
        </p>
        <a href="/plans"
          className="inline-flex items-center gap-1.5 mt-4 text-sm font-bold text-white px-5 py-2.5 rounded-xl shadow-sm hover:opacity-90 active:scale-95 transition-all"
          style={{ backgroundColor: themeColor }}>
          <Lock size={14} /> Upgrade to Premium →
        </a>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => <div key={i} className="h-20 rounded-2xl bg-gray-100 animate-pulse" />)}
        </div>
        <div className="h-40 rounded-2xl bg-gray-100 animate-pulse" />
      </div>
    );
  }

  const hasData = insights && insights.total.all > 0;

  if (!hasData) {
    return (
      <div className="text-center py-12 px-4">
        <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-gray-50 border border-gray-100 flex items-center justify-center text-gray-300">
          <Search size={24} />
        </div>
        <p className="text-sm font-bold text-gray-700">No AI searches yet</p>
        <p className="text-xs text-gray-400 mt-1 max-w-xs mx-auto">
          When customers use the ✨ Ask bar on your store page, their questions show up here as insights.
        </p>
      </div>
    );
  }

  const maxKw = Math.max(...insights.topKeywords.map((k) => k.count), 1);
  const intentTotal = insights.intentTotal || 1;

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center gap-2">
        <Sparkles size={18} style={{ color: themeColor }} />
        <h3 className="text-base font-extrabold text-gray-900">AI Insights</h3>
        <span className="text-[11px] text-gray-400">· what customers are asking</span>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Today"      value={insights.total.today} themeColor={themeColor} />
        <StatCard label="This week"  value={insights.total.week}  themeColor={themeColor} />
        <StatCard label="This month" value={insights.total.month} themeColor={themeColor} />
      </div>

      {/* AI Recommendations (headline) */}
      <div className="rounded-2xl p-4 border" style={{ borderColor: `${themeColor}33`, background: `${themeColor}08` }}>
        <div className="flex items-center justify-between gap-2 mb-2">
          <p className="flex items-center gap-1.5 text-sm font-extrabold text-gray-900">
            <Lightbulb size={16} style={{ color: themeColor }} /> Recommendations for you
          </p>
          <button onClick={genRecs} disabled={recsLoading}
            className="inline-flex items-center gap-1.5 text-xs font-bold text-white px-3 py-1.5 rounded-lg disabled:opacity-50 active:scale-95 transition-transform"
            style={{ backgroundColor: themeColor }}>
            {recsLoading ? <><RefreshCw size={13} className="animate-spin" /> Thinking…</> : <><Sparkles size={13} /> {recs ? 'Regenerate' : 'Generate'}</>}
          </button>
        </div>
        {recsError && <p className="text-xs text-red-500">{recsError}</p>}
        {!recs && !recsLoading && !recsError && (
          <p className="text-xs text-gray-500">Tap <strong>Generate</strong> for AI-written tips based on the searches below — what to stock, price, or add to your store.</p>
        )}
        {recs && recs.length > 0 && (
          <ul className="space-y-2 mt-1">
            {recs.map((r, i) => (
              <li key={i} className="flex items-start gap-2 text-[13px] text-gray-700 leading-snug bg-white rounded-xl border border-gray-100 px-3 py-2.5">
                <span className="flex-shrink-0 mt-0.5" style={{ color: themeColor }}>•</span>
                <span>{r}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Top searches */}
      <Section icon={<Search size={15} />} title="Top searches" themeColor={themeColor}>
        {insights.topKeywords.length === 0 ? <Empty text="No keywords yet." /> : (
          <div className="space-y-2">
            {insights.topKeywords.map((k) => (
              <BarRow key={k.term} label={k.term} value={k.count} max={maxKw} themeColor={themeColor} />
            ))}
          </div>
        )}
      </Section>

      {/* Missed opportunities */}
      <Section icon={<PackagePlus size={15} />} title="Wanted but not in your catalogue" themeColor={themeColor}
        subtitle="Searches that didn’t match any product — consider stocking these.">
        {insights.notFound.length === 0 ? <Empty text="Every search matched a product. 🎉" /> : (
          <div className="divide-y divide-gray-50">
            {insights.notFound.map((x) => (
              <div key={x.term} className="flex items-center justify-between py-2">
                <span className="text-sm font-semibold text-gray-800 capitalize">{x.term}</span>
                <span className="text-xs font-bold text-rose-600 bg-rose-50 px-2 py-0.5 rounded-full">searched ×{x.count}</span>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Customer intent */}
      <Section icon={<Target size={15} />} title="What customers are after" themeColor={themeColor}>
        <div className="space-y-2">
          {insights.intentList.map((it) => (
            <BarRow key={it.key} label={it.label} value={it.count} max={intentTotal} themeColor={themeColor}
              suffix={`${Math.round((it.count / intentTotal) * 100)}%`} />
          ))}
        </div>
      </Section>

      {/* Trending */}
      {insights.trending.length > 0 && (
        <Section icon={<TrendingUp size={15} />} title="Trending this week" themeColor={themeColor}>
          <div className="flex flex-wrap gap-2">
            {insights.trending.map((t) => (
              <span key={t.term} className="inline-flex items-center gap-1 text-xs font-bold capitalize px-3 py-1.5 rounded-full"
                style={{ color: themeColor, background: `${themeColor}14` }}>
                <TrendingUp size={12} /> {t.term}
              </span>
            ))}
          </div>
        </Section>
      )}

      {/* Couldn't answer */}
      {insights.unanswered.length > 0 && (
        <Section icon={<HelpCircle size={15} />} title="Questions the AI couldn’t answer" themeColor={themeColor}
          subtitle="Add this info to your store so the AI can answer next time.">
          <ul className="space-y-1.5">
            {insights.unanswered.map((q, i) => (
              <li key={i} className="text-[13px] text-gray-600 bg-gray-50 rounded-lg px-3 py-2">“{q}”</li>
            ))}
          </ul>
        </Section>
      )}

      {/* FAQ */}
      {insights.faqs.length > 0 && (
        <Section icon={<MessageSquareText size={15} />} title="Frequently asked" themeColor={themeColor}>
          <ul className="space-y-1.5">
            {insights.faqs.map((f, i) => (
              <li key={i} className="flex items-center justify-between gap-3 text-[13px] text-gray-700 py-1">
                <span className="min-w-0 truncate">“{f.q}”</span>
                <span className="flex-shrink-0 text-xs font-bold text-gray-400">×{f.count}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────
function StatCard({ label, value, themeColor }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-3 text-center shadow-sm">
      <p className="text-2xl font-extrabold tabular-nums" style={{ color: themeColor }}>{value}</p>
      <p className="text-[11px] font-semibold text-gray-400 mt-0.5">{label}</p>
    </div>
  );
}

function Section({ icon, title, subtitle, themeColor, children }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 mb-0.5">
        <span style={{ color: themeColor }}>{icon}</span>
        <h4 className="text-sm font-extrabold text-gray-900">{title}</h4>
      </div>
      {subtitle && <p className="text-[11px] text-gray-400 mb-2.5 ml-6">{subtitle}</p>}
      <div className={subtitle ? '' : 'mt-2.5'}>{children}</div>
    </div>
  );
}

function BarRow({ label, value, max, themeColor, suffix }) {
  const pct = Math.max(4, Math.round((value / max) * 100));
  return (
    <div className="flex items-center gap-3">
      <span className="w-28 sm:w-36 flex-shrink-0 text-[13px] font-semibold text-gray-700 capitalize truncate">{label}</span>
      <div className="flex-1 h-2.5 rounded-full bg-gray-100 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: themeColor }} />
      </div>
      <span className="w-12 flex-shrink-0 text-right text-xs font-bold text-gray-500 tabular-nums">{suffix ?? value}</span>
    </div>
  );
}

function Empty({ text }) {
  return <p className="text-xs text-gray-400 py-2">{text}</p>;
}

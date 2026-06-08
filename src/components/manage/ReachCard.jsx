import { useState, useEffect } from 'react';
import { Eye, TrendingUp, TrendingDown, Share2, Copy, Check } from 'lucide-react';
import { fetchViewStats, weekTrend } from '../../utils/viewService';

/**
 * ReachCard — the owner's "people are looking" hook, shown at the top of Manage.
 *
 * Free for every store on purpose: seeing reach (and an easy Share button right
 * there) is what nudges owners to circulate their page → word-of-mouth growth.
 * The empty state never shows a deflating "0" — it invites them to share for
 * their first visitors. Deeper analytics stay in the Pro "Stats" tab.
 */

const MILESTONE = 50;   // celebrate + ask for a referral once a page crosses this

export default function ReachCard({ slug, themeColor = '#0d9488', businessName = '', upgrade = false, phone = '' }) {
  const [stats,  setStats]  = useState(null);   // null = loading
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchViewStats(slug).then((s) => { if (alive) setStats(s ?? { today: 0, week: 0, lastWeek: 0, total: 0 }); });
    return () => { alive = false; };
  }, [slug]);

  const storeUrl  = `${window.location.origin}/${slug}`;
  const shareText = `🛍️ Order from ${businessName || 'my shop'} on WhatsApp — browse & order here:\n${storeUrl}`;
  const waShare   = `https://wa.me/?text=${encodeURIComponent(shareText)}`;
  const refText   = `I made a free WhatsApp page for my business on PocketLink in 2 minutes — catalogue, cart & orders all on WhatsApp. You should make one too 👇\nhttps://pocketlink.store/start`;
  const waRefer   = `https://wa.me/?text=${encodeURIComponent(refText)}`;

  function copyLink() {
    navigator.clipboard?.writeText(storeUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  // ── Loading skeleton ──
  if (stats === null) {
    return (
      <div className="rounded-2xl border border-gray-100 bg-white shadow-sm p-4 mb-5 animate-pulse">
        <div className="h-3 w-24 bg-gray-100 rounded mb-3" />
        <div className="h-6 w-48 bg-gray-200 rounded mb-3" />
        <div className="h-9 w-full bg-gray-100 rounded-xl" />
      </div>
    );
  }

  const { today, week, total } = stats;
  const trend   = weekTrend(stats);
  const hasAny  = total > 0;

  const ShareButtons = (
    <div className="flex gap-2">
      <a href={waShare} target="_blank" rel="noopener noreferrer"
         className="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-bold
                    text-white bg-[#25D366] hover:bg-[#1ebe5d] transition-colors active:scale-[0.98]">
        <Share2 size={15} /> Share my page
      </a>
      <button type="button" onClick={copyLink}
              className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl text-sm font-bold
                         border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors active:scale-[0.98]">
        {copied ? <Check size={15} className="text-green-600" /> : <Copy size={15} />}
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );

  return (
    <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden mb-5">
      {/* tinted header strip */}
      <div className="px-4 pt-3.5 pb-3" style={{ background: `linear-gradient(135deg, ${themeColor}14, transparent)` }}>
        <div className="flex items-center gap-1.5 mb-1.5">
          <Eye size={14} style={{ color: themeColor }} />
          <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: themeColor }}>
            Your reach
          </span>
        </div>

        {hasAny ? (
          <>
            {week > 0 ? (
              <p className="text-[15px] font-extrabold text-gray-900 leading-snug">
                👀 {week.toLocaleString('en-IN')} {week === 1 ? 'person' : 'people'} viewed your page this week
              </p>
            ) : (
              <p className="text-[15px] font-extrabold text-gray-900 leading-snug">
                Your page has {total.toLocaleString('en-IN')} total views — share it to get more this week 👀
              </p>
            )}
            <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-1.5 text-[11px] text-gray-500">
              {trend !== null && (
                <span className={[
                  'inline-flex items-center gap-1 font-bold',
                  trend >= 0 ? 'text-emerald-600' : 'text-amber-600',
                ].join(' ')}>
                  {trend >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                  {trend >= 0 ? '+' : ''}{trend}% vs last week
                </span>
              )}
              <span>{today.toLocaleString('en-IN')} today</span>
              <span>·</span>
              <span>{total.toLocaleString('en-IN')} all-time</span>
            </div>
          </>
        ) : (
          <>
            <p className="text-[15px] font-extrabold text-gray-900 leading-snug">
              Your page is live 🎉
            </p>
            <p className="text-xs text-gray-500 mt-1 leading-snug">
              Share it on WhatsApp & status to get your first visitors — the more you share, the more orders come in.
            </p>
          </>
        )}
      </div>

      {/* actions */}
      <div className="px-4 py-3">
        {ShareButtons}

        {/* Upsell — only when this plan doesn't include analytics */}
        {upgrade && (
          <a href="/plans"
             onClick={() => { try { sessionStorage.setItem('pocketlink_verified_phone', String(phone).replace(/\D/g, '')); } catch { /* ignore */ } }}
             className="mt-3 flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 border transition-colors hover:opacity-90"
             style={{ borderColor: `${themeColor}33`, backgroundColor: `${themeColor}0d` }}>
            <span className="text-[11px] text-gray-600 leading-snug">
              📊 See <b className="font-bold">where</b> visitors come from &amp; <b className="font-bold">what</b> they view
            </span>
            <span className="text-[11px] font-extrabold flex-shrink-0" style={{ color: themeColor }}>Pro →</span>
          </a>
        )}

        {/* Milestone → turn pride into a shop-owner referral */}
        {total >= MILESTONE && (
          <div className="mt-3 pt-3 border-t border-dashed border-gray-100 flex items-center justify-between gap-2">
            <p className="text-[11px] text-gray-500 leading-snug">
              🎉 {total.toLocaleString('en-IN')} people have found your page! Know another shop owner?
            </p>
            <a href={waRefer} target="_blank" rel="noopener noreferrer"
               className="flex-shrink-0 text-[11px] font-bold px-3 py-1.5 rounded-lg transition-colors"
               style={{ color: themeColor, backgroundColor: `${themeColor}14` }}>
              Invite →
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

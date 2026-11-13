import { ExternalLink, Share2, Check, ChevronRight, LogOut } from 'lucide-react';
import ShopMark from './ShopMark';
import { navGroups } from '../../../utils/dashboardShell';

// Shorter names where the full one does not fit a tile.
const SHORT = { abandoned: 'Carts', insights: 'AI Insights' };

/**
 * The phone's "More" screen: every section as a tile, under the shop's own
 * header (dark, like the computer's side menu). Replaces the old slide-out drawer.
 */
export default function MoreScreen({ config, tabs, badges = {}, colors, address, planName, planText,
  onSelect, onPlan, onLock, onShare, shared, viewHref }) {
  const groups = navGroups(tabs);
  // Understand + Set up are short; one row of tiles each would waste space.
  const merged = [];
  for (const g of groups) {
    const last = merged[merged.length - 1];
    if (last && last.title === 'Understand' && g.title === 'Set up') {
      merged[merged.length - 1] = { title: 'Understand & set up', items: [...last.items, ...g.items] };
    } else merged.push(g);
  }

  return (
    <div className="lg:hidden -mx-4 -mt-6">
      <div className="px-5 pt-5 pb-10 text-white" style={{ backgroundColor: colors.sidebarBg, backgroundImage: colors.sidebarGlow }}>
        <div className="flex items-center gap-3">
          <ShopMark config={config} size={48} accent={colors.accent} />
          <div className="min-w-0">
            <p className="text-[17px] font-extrabold leading-tight truncate">{config.businessName}</p>
            <p className="text-[12px] text-white/60 truncate">{address}</p>
          </div>
        </div>
        <div className="flex gap-2 mt-4">
          <a href={viewHref} target="_blank" rel="noopener noreferrer"
            className="flex-1 h-10 rounded-xl bg-white text-gray-900 text-sm font-bold flex items-center justify-center gap-2 active:scale-[0.98] transition">
            <ExternalLink size={16} />View page
          </a>
          <button type="button" onClick={onShare}
            className="flex-1 h-10 rounded-xl border border-white/20 bg-white/10 text-sm font-bold flex items-center justify-center gap-2 active:scale-[0.98] transition">
            {shared ? <Check size={16} /> : <Share2 size={16} />}{shared ? 'Link copied' : 'Share page'}
          </button>
        </div>
      </div>

      <div className="relative -mt-5 rounded-t-[24px] bg-[#f5f6f5] px-4 pt-5 space-y-5">
        {merged.map((g) => (
          <section key={g.title}>
            <p className="px-1 mb-2 text-[11px] font-bold uppercase tracking-widest text-gray-500">{g.title}</p>
            <div className="grid grid-cols-4 gap-2">
              {g.items.map(({ key, label, icon: Icon }) => {
                const count = badges[key] || 0;
                return (
                  <button key={key} type="button" onClick={() => onSelect(key)}
                    aria-label={count > 0 ? `${label}, ${count}` : label}
                    className="relative h-[74px] rounded-2xl bg-white border border-gray-100 shadow-sm flex flex-col items-center justify-center gap-1.5 active:scale-[0.97] transition">
                    <Icon size={21} style={{ color: colors.button }} />
                    <span className="text-[11px] font-bold text-gray-700 leading-none px-1 text-center">{SHORT[key] || label}</span>
                    {count > 0 && (
                      <span className={[
                        'absolute top-1.5 right-1.5 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-extrabold tabular-nums grid place-items-center',
                        key === 'orders' ? 'bg-red-600 text-white' : 'bg-gray-200 text-gray-800',
                      ].join(' ')}>{count > 9 ? '9+' : count}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        ))}

        <button type="button" onClick={onPlan}
          className="w-full flex items-center gap-3 rounded-2xl bg-white border border-gray-100 shadow-sm p-4 text-left active:scale-[0.99] transition">
          <span className="w-10 h-10 rounded-xl grid place-items-center flex-shrink-0" style={{ backgroundColor: colors.tint, color: colors.button }}>
            <Check size={18} strokeWidth={3} />
          </span>
          <span className="flex-1 min-w-0">
            <span className="block font-bold text-gray-900">{planName}</span>
            {planText && <span className="block text-[12px] text-gray-500">{planText}</span>}
          </span>
          <ChevronRight size={18} className="text-gray-400" />
        </button>

        <button type="button" onClick={onLock}
          className="w-full h-11 rounded-xl border border-gray-200 bg-white text-sm font-bold text-gray-800 flex items-center justify-center gap-2 active:scale-[0.98] transition">
          <LogOut size={17} />Lock &amp; exit
        </button>
      </div>
    </div>
  );
}

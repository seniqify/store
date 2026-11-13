import { LogOut } from 'lucide-react';
import ShopMark from './ShopMark';
import { navGroups } from '../../../utils/dashboardShell';

/**
 * The computer's side menu: dark, with a soft glow of the shop colour (the
 * same look as the PIN screen). Shop at the top, the sections in four groups
 * with counts, the plan and Lock & exit at the bottom.
 */
export default function ManageSidebar({ config, tabs, tab, onSelect, badges = {}, colors, planName, planText, onPlan, onLock }) {
  const groups = navGroups(tabs);
  return (
    <aside className="hidden lg:flex lg:flex-col fixed inset-y-0 left-0 w-64 z-30 text-white"
           style={{ backgroundColor: colors.sidebarBg, backgroundImage: colors.sidebarGlow }}>
      <div className="px-5 pt-5 pb-3 flex items-center gap-3">
        <ShopMark config={config} size={44} accent={colors.accent} />
        <div className="min-w-0">
          <p className="text-[15px] font-extrabold leading-tight line-clamp-2">{config.businessName}</p>
          <p className="flex items-center gap-1.5 text-[12px] text-white/60 mt-0.5">
            <span className="w-[7px] h-[7px] rounded-full bg-green-500 flex-shrink-0" />Page is live
          </p>
        </div>
      </div>

      <nav aria-label="Dashboard sections" className="flex-1 overflow-y-auto px-3.5 pb-2 space-y-3 [scrollbar-width:thin]">
        {groups.map((g) => (
          <div key={g.title}>
            <p className="px-3 mb-1 text-[10.5px] font-bold uppercase tracking-[0.14em] text-white/60">{g.title}</p>
            <div className="space-y-0.5">
              {g.items.map(({ key, label, icon: Icon }) => {
                const active = tab === key;
                const count = badges[key] || 0;
                return (
                  <button key={key} type="button" onClick={() => onSelect(key)}
                    aria-current={active ? 'page' : undefined}
                    aria-label={count > 0 ? `${label}, ${count}` : label}
                    className={[
                      'w-full flex items-center gap-3 h-[38px] px-3 rounded-[10px] text-[14px] transition-colors',
                      'focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/70',
                      active ? 'bg-white/[0.12] text-white font-bold' : 'text-white/[0.86] font-semibold hover:bg-white/[0.07]',
                    ].join(' ')}>
                    <Icon size={18} className="flex-shrink-0" style={{ color: active ? colors.activeIcon : 'rgba(255,255,255,0.72)' }} />
                    <span className="truncate">{label}</span>
                    {count > 0 && (
                      <span className={[
                        'ml-auto min-w-[22px] h-5 px-1.5 rounded-full text-[11px] font-extrabold tabular-nums grid place-items-center',
                        key === 'orders' ? 'bg-red-600 text-white' : 'bg-white/[0.16] text-white',
                      ].join(' ')}>
                        {count > 99 ? '99+' : count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="px-3.5 pb-3.5 pt-2 space-y-1">
        <button type="button" onClick={onPlan}
          className="w-full text-left rounded-xl px-3 py-2.5 bg-white/[0.07] border border-white/[0.12] hover:bg-white/[0.1] transition-colors">
          <span className="block text-[13px] font-extrabold">{planName}</span>
          {planText && <span className="block text-[12px] text-white/60">{planText}</span>}
        </button>
        <button type="button" onClick={onLock}
          className="w-full flex items-center gap-3 h-9 px-3 rounded-[10px] text-[14px] font-semibold text-white/[0.86] hover:bg-white/[0.07] transition-colors">
          <LogOut size={18} className="flex-shrink-0 text-white/70" />
          Lock &amp; exit
        </button>
        <img src="/pocketlink-logo.svg" alt="PocketLink" className="h-5 w-auto ml-3 mt-1 brightness-0 invert opacity-80" />
      </div>
    </aside>
  );
}

import { Share2, ExternalLink, Search, ChevronLeft, Check } from 'lucide-react';
import ShopMark from './ShopMark';

/**
 * The computer's top bar: the section name, the dashboard search, the bell,
 * Share page and View page.
 */
export function DesktopTopBar({ title, subtitle, search, bell, onShare, shared, viewHref, colors }) {
  return (
    <header className="hidden lg:block sticky top-0 z-20 bg-[#f5f6f5]/90 backdrop-blur border-b border-gray-200/70">
      <div className="max-w-[1240px] mx-auto px-8 h-[72px] flex items-center gap-3">
        <div className="min-w-0 mr-auto">
          <h1 className="text-[20px] font-extrabold text-gray-900 leading-tight truncate">{title}</h1>
          {subtitle && <p className="text-[13px] text-gray-500 truncate">{subtitle}</p>}
        </div>
        <div className="w-[300px] xl:w-[340px] flex-shrink">{search}</div>
        {bell}
        <button type="button" onClick={onShare}
          className="hidden xl:inline-flex h-10 px-4 rounded-xl border border-gray-200 bg-white text-sm font-bold text-gray-800 items-center gap-2 hover:bg-gray-50 active:scale-[0.98] transition">
          {shared ? <Check size={16} className="text-emerald-600" /> : <Share2 size={16} />}
          {shared ? 'Link copied' : 'Share page'}
        </button>
        <a href={viewHref} target="_blank" rel="noopener noreferrer"
          className="h-10 px-4 rounded-xl text-white text-sm font-bold inline-flex items-center gap-2 whitespace-nowrap shadow-sm hover:opacity-90 active:scale-[0.98] transition"
          style={{ backgroundColor: colors.button }}>
          <ExternalLink size={16} />View page
        </a>
      </div>
    </header>
  );
}

/**
 * The phone's top bar. On Home it shows the shop; elsewhere the section name,
 * with a back arrow for the sections opened from "More".
 */
export function PhoneTopBar({ config, colors, isHome, title, showBack, onBack, onSearch, bell }) {
  return (
    <header className="lg:hidden sticky top-0 z-20 bg-white border-b border-gray-100">
      <div className="max-w-lg mx-auto px-4 h-[60px] flex items-center gap-2">
        {isHome ? (
          <>
            <ShopMark config={config} size={36} accent={colors.accent} />
            <div className="min-w-0 flex-1 ml-0.5">
              <p className="text-[15px] font-extrabold text-gray-900 leading-tight truncate">{config.businessName}</p>
              <p className="text-[11px] text-gray-500 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500" />Page is live
              </p>
            </div>
          </>
        ) : (
          <>
            {showBack && (
              <button type="button" aria-label="Back to all sections" onClick={onBack}
                className="w-9 h-9 -ml-2 rounded-full grid place-items-center text-gray-700 hover:bg-gray-100 flex-shrink-0">
                <ChevronLeft size={22} />
              </button>
            )}
            <p className="flex-1 min-w-0 text-[17px] font-extrabold text-gray-900 truncate">{title}</p>
          </>
        )}
        <button type="button" aria-label="Search" onClick={onSearch}
          className="w-10 h-10 rounded-full grid place-items-center text-gray-700 hover:bg-gray-100 flex-shrink-0">
          <Search size={20} />
        </button>
        {bell}
      </div>
    </header>
  );
}

import { useState } from 'react';
import { Home as HomeIcon, LayoutGrid, ShoppingCart, ChevronRight } from 'lucide-react';
import { formatINR } from '../../utils/currency';

/**
 * Mobile bottom tab bar for the storefront (Home · Categories · Cart).
 * Hidden on desktop (lg+), where the sticky cart sidebar already covers this.
 * When the cart has items, a "View Cart · ₹total" CTA sits just above the tabs.
 *
 * Props:
 *   itemCount        — number of items in the cart (drives the Cart badge + CTA)
 *   cartTotal        — cart total for the CTA amount
 *   onCartClick      — open the cart (sidebar)
 *   categoriesTarget — id of the section to scroll to for "Categories" (default 'products')
 */
export default function StoreTabBar({ itemCount = 0, cartTotal = 0, onCartClick, categoriesTarget = 'products' }) {
  const [active, setActive] = useState('home');

  const goHome = () => {
    setActive('home');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const goCategories = () => {
    setActive('categories');
    document.getElementById(categoriesTarget)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-200
                    shadow-[0_-4px_20px_rgba(0,0,0,0.08)] pb-[env(safe-area-inset-bottom)]">

      {/* Contextual cart CTA — only when there are items */}
      {itemCount > 0 && (
        <div className="px-4 pt-3 pb-1.5">
          <button
            onClick={onCartClick}
            className="w-full flex items-center justify-between bg-brand hover:bg-brand-dark active:bg-brand-dark
                       text-white font-semibold rounded-xl px-4 py-3 transition-all duration-150 active:scale-[0.99]">
            <div className="flex items-center gap-2.5">
              <span className="bg-white/20 text-white text-xs font-bold w-6 h-6 rounded-lg
                               flex items-center justify-center flex-shrink-0">
                {itemCount}
              </span>
              <span className="text-sm">
                {itemCount === 1 ? '1 item' : `${itemCount} items`}
                <span className="opacity-75 ml-1 font-normal">· View Cart</span>
              </span>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <span className="font-bold tabular-nums">{formatINR(cartTotal)}</span>
              <ChevronRight size={16} className="opacity-80" />
            </div>
          </button>
        </div>
      )}

      {/* Tab bar */}
      <nav className="grid grid-cols-3">
        <Tab icon={HomeIcon}     label="Home"       active={active === 'home'}       onClick={goHome} />
        <Tab icon={LayoutGrid}   label="Categories" active={active === 'categories'} onClick={goCategories} />
        <Tab icon={ShoppingCart} label="Cart"       badge={itemCount}                onClick={onCartClick} />
      </nav>
    </div>
  );
}

function Tab({ icon: Icon, label, active, badge = 0, onClick }) {
  const tone = active ? 'text-brand' : 'text-gray-400';
  return (
    <button type="button" onClick={onClick}
      className="relative flex flex-col items-center justify-center gap-0.5 py-2 active:scale-95 transition-transform">
      <span className="relative">
        <Icon size={21} strokeWidth={active ? 2.5 : 2} className={tone} />
        {badge > 0 && (
          <span className="absolute -top-1.5 -right-2.5 min-w-[16px] h-4 px-1 rounded-full bg-brand text-white
                           text-[10px] font-bold flex items-center justify-center leading-none">
            {badge}
          </span>
        )}
      </span>
      <span className={['text-[10px] font-semibold tracking-tight', tone].join(' ')}>{label}</span>
    </button>
  );
}

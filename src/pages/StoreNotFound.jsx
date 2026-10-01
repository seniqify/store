import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

/**
 * StoreNotFound
 * ─────────────────────────────────────────────────────────────────────────────
 * "Not found" on a merchant's own domain. Unlike PocketLink's NotFound it shows
 * no other shops, no demo stores and no PocketLink sign-up: the only way out is
 * back to this shop's own home page.
 */
export default function StoreNotFound() {
  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center px-4 py-16 text-center">
      <p className="text-[6rem] font-extrabold leading-none tracking-tighter
                    bg-gradient-to-b from-gray-900 to-gray-400 bg-clip-text text-transparent select-none mb-6">
        404
      </p>
      <h1 className="text-2xl font-extrabold text-gray-900 mb-2 tracking-tight">Page not found</h1>
      <p className="text-gray-500 text-sm mb-8 leading-relaxed max-w-sm">
        This page doesn’t exist or may have moved.
      </p>
      <Link
        to="/"
        className="inline-flex items-center justify-center gap-2 bg-gray-900 hover:bg-gray-800 text-white
                   font-bold text-sm px-6 py-3 rounded-xl transition-all active:scale-[0.98] shadow-sm"
      >
        <ArrowLeft size={15} /> Back to the shop
      </Link>
    </div>
  );
}

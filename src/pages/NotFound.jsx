import { Link } from 'react-router-dom';
import { MessageCircle, ChevronRight, ArrowLeft } from 'lucide-react';
import { listBusinesses } from '../utils/BusinessLoader';

/**
 * NotFound
 * ─────────────────────────────────────────────────────────────────────────────
 * Shown when a slug doesn't match any real DB store, or an unknown path.
 *
 * Props:
 *   slug  string | undefined  — the attempted slug (for a helpful error message)
 */
export default function NotFound({ slug }) {
  const demoStores = listBusinesses().slice(0, 3);

  return (
    <div className="relative min-h-screen bg-white flex flex-col items-center justify-center px-4 py-16 overflow-hidden">

      {/* Decorative background */}
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-emerald-50/70 via-white to-white" />
      <div className="absolute -z-10 top-[-6rem] left-[-6rem] w-96 h-96 rounded-full bg-emerald-300/30 blur-3xl animate-pl-blob" />
      <div className="absolute -z-10 bottom-[-8rem] right-[-8rem] w-[26rem] h-[26rem] rounded-full bg-teal-300/25 blur-3xl animate-pl-blob" style={{ animationDelay: '5s' }} />
      <div className="absolute inset-0 -z-10 opacity-[0.4]"
           style={{ backgroundImage: 'radial-gradient(circle, #0d948814 1px, transparent 1px)', backgroundSize: '26px 26px', maskImage: 'radial-gradient(circle at center, black, transparent 75%)' }} />

      {/* Logo */}
      <Link to="/" className="mb-10">
        <img src="/pocketlink-logo.svg" alt="PocketLink" className="h-8 w-auto" />
      </Link>

      <div className="text-center max-w-md w-full animate-pl-fade-up">

        {/* Big 404 + shutter */}
        <div className="relative inline-block mb-6">
          <p className="text-[6rem] sm:text-[7rem] font-extrabold leading-none tracking-tighter
                        bg-gradient-to-b from-gray-900 to-gray-400 bg-clip-text text-transparent select-none">
            404
          </p>
          <div className="absolute -top-3 -right-5 text-4xl sm:text-5xl animate-pl-float select-none">
            🏪
          </div>
        </div>

        {/* Heading */}
        <h1 className="text-2xl font-extrabold text-gray-900 mb-2 tracking-tight">
          {slug ? 'This page isn’t live' : 'Page not found'}
        </h1>

        {/* Message */}
        <p className="text-gray-500 text-sm mb-8 leading-relaxed max-w-sm mx-auto">
          {slug ? (
            <>
              No page lives at{' '}
              <code className="bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded-md font-mono text-xs">
                /{slug}
              </code>
              {' '}— the link may be wrong, or the shop hasn’t opened yet.
            </>
          ) : (
            "The page you're looking for doesn't exist or may have moved."
          )}
        </p>

        {/* Primary CTAs */}
        <div className="flex flex-col sm:flex-row gap-3 justify-center mb-12">
          <Link
            to="/"
            className="inline-flex items-center justify-center gap-2 bg-gray-900 hover:bg-gray-800 text-white
                       font-bold text-sm px-6 py-3 rounded-xl transition-all active:scale-[0.98] shadow-sm"
          >
            <ArrowLeft size={15} /> Back to homepage
          </Link>
          <Link
            to="/start"
            className="inline-flex items-center justify-center gap-2 text-white font-bold text-sm px-6 py-3
                       rounded-xl transition-all active:scale-[0.98] shadow-lg shadow-emerald-500/25"
            style={{ backgroundColor: '#25D366' }}
          >
            <MessageCircle size={15} /> Create your free page
          </Link>
        </div>

        {/* Demo stores */}
        <div>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">
            Or browse a live demo
          </p>

          <div className="space-y-2.5">
            {demoStores.map((biz) => (
              <Link
                key={biz.slug}
                to={`/demo/${biz.slug}`}
                className="group flex items-center gap-3 bg-white border border-gray-100
                           hover:border-emerald-200 hover:shadow-md rounded-2xl px-4 py-3
                           transition-all duration-200"
              >
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0 shadow-sm"
                     style={{ backgroundColor: `${biz.theme.primary}18` }}>
                  {biz.logoEmoji}
                </div>

                <div className="flex-1 text-left min-w-0">
                  <p className="font-bold text-gray-900 text-sm leading-tight truncate">
                    {biz.businessName}
                  </p>
                  <p className="text-[11px] text-gray-400 mt-0.5 truncate">{biz.tagline}</p>
                </div>

                <span className="inline-flex items-center text-xs font-bold gap-0.5 group-hover:gap-1 transition-all flex-shrink-0"
                      style={{ color: biz.theme.primary }}>
                  View <ChevronRight size={13} />
                </span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

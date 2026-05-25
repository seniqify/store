import { Link } from 'react-router-dom';
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
    <div className="min-h-screen bg-[#f8fafc] flex items-center justify-center px-4 py-16">
      <div className="text-center max-w-md w-full">

        {/* Icon */}
        <div className="text-5xl mb-5">🏪</div>

        {/* Heading */}
        <h1 className="text-2xl font-extrabold text-gray-900 mb-2 tracking-tight">
          {slug ? 'Store not found' : 'Page not found'}
        </h1>

        {/* Message */}
        <p className="text-gray-500 text-sm mb-8 leading-relaxed">
          {slug ? (
            <>
              No store found at{' '}
              <code className="bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded-md font-mono text-xs">
                /{slug}
              </code>
              .{' '}The link may be wrong, or the store may not exist yet.
            </>
          ) : (
            "The page you're looking for doesn't exist."
          )}
        </p>

        {/* Primary CTA */}
        <div className="flex flex-col sm:flex-row gap-3 justify-center mb-10">
          <Link
            to="/"
            className="inline-flex items-center justify-center gap-2
                       bg-gray-900 hover:bg-gray-700 text-white
                       font-semibold text-sm px-5 py-2.5 rounded-xl
                       transition-colors"
          >
            ← Back to homepage
          </Link>
          <Link
            to="/onboarding"
            className="inline-flex items-center justify-center gap-2
                       bg-[#25D366] hover:bg-[#1ebe5d] text-white
                       font-semibold text-sm px-5 py-2.5 rounded-xl
                       transition-colors"
          >
            Create your free store
          </Link>
        </div>

        {/* Demo stores */}
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
            Browse live demos
          </p>

          <div className="space-y-2.5">
            {demoStores.map((biz) => (
              <Link
                key={biz.slug}
                to={`/demo/${biz.slug}`}
                className="flex items-center gap-3 bg-white border border-gray-200
                           hover:border-gray-400 rounded-xl px-4 py-3
                           transition-all duration-150 hover:shadow-sm group"
              >
                <div className="w-9 h-9 rounded-xl flex items-center justify-center
                                text-lg flex-shrink-0 shadow-sm"
                     style={{ backgroundColor: `${biz.theme.primary}18` }}>
                  {biz.logoEmoji}
                </div>

                <div className="flex-1 text-left min-w-0">
                  <p className="font-semibold text-gray-900 text-sm leading-none truncate">
                    {biz.businessName}
                  </p>
                  <p className="text-[11px] text-gray-400 mt-0.5 truncate">{biz.tagline}</p>
                </div>

                <span className="text-gray-300 group-hover:text-gray-500
                                 transition-colors text-lg flex-shrink-0">
                  →
                </span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

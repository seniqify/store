import { Link } from 'react-router-dom';
import { MapPin, ArrowRight, MessageCircle } from 'lucide-react';
import { whatsappLink } from '../../utils/theme';
import { CATEGORY_META } from '../../utils/marketplace';

const WA = '#25D366';

/**
 * One business in the marketplace grid. The whole card links to the store page;
 * the WhatsApp button opens a chat directly (and stops the card navigation).
 */
export default function BusinessCard({ biz }) {
  const waHref = biz.whatsappNumber ? whatsappLink(biz.whatsappNumber, biz.name) : null;
  const meta   = CATEGORY_META[biz.category] || CATEGORY_META.Other;

  const onWhatsApp = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (waHref) window.open(waHref, '_blank', 'noopener,noreferrer');
  };

  return (
    <Link
      to={biz.href}
      className="group relative flex flex-col bg-white rounded-3xl border border-gray-100 overflow-hidden
                 shadow-sm transition-all duration-300 hover:-translate-y-1.5 hover:border-emerald-200
                 hover:shadow-[0_24px_50px_-12px_rgba(16,185,129,0.30)]">

      {/* Banner */}
      <div className="relative h-28 w-full overflow-hidden">
        {biz.coverImage ? (
          <img src={biz.coverImage} alt="" loading="lazy"
               className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" />
        ) : (
          <div className="w-full h-full transition-transform duration-500 group-hover:scale-110"
               style={{ background: `linear-gradient(135deg, ${biz.primary}, ${biz.primaryDark})` }} />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/35 via-transparent to-transparent" />

        {/* Category chip */}
        <span className="absolute top-2.5 right-2.5 inline-flex items-center gap-1 text-[10px] font-bold text-white
                         px-2 py-0.5 rounded-full shadow-sm"
              style={{ background: `linear-gradient(135deg, ${meta.grad[0]}, ${meta.grad[1]})` }}>
          <span>{meta.emoji}</span> {biz.category}
        </span>

        {/* Live "Open" pulse */}
        <span className="absolute top-2.5 left-2.5 inline-flex items-center gap-1 text-[10px] font-semibold text-white
                         bg-black/35 backdrop-blur px-2 py-0.5 rounded-full">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400" />
          </span>
          Open
        </span>

        {biz.demo && (
          <span className="absolute bottom-2 left-2.5 text-[9px] font-bold text-white/90 bg-black/30 px-1.5 py-0.5 rounded">
            DEMO
          </span>
        )}
      </div>

      <div className="px-4 pb-4 -mt-8 flex flex-col flex-1">
        {/* Avatar */}
        <div className="w-16 h-16 rounded-2xl ring-4 ring-white shadow-lg overflow-hidden bg-white
                        flex items-center justify-center text-3xl flex-shrink-0
                        transition-transform duration-300 group-hover:scale-105 group-hover:-rotate-2"
             style={!biz.logo ? { background: `linear-gradient(135deg, ${biz.primary}, ${biz.primaryDark})` } : undefined}>
          {biz.logo
            ? <img src={biz.logo} alt={biz.name} className="w-full h-full object-cover" loading="lazy" />
            : <span className="drop-shadow-sm">{biz.logoEmoji}</span>}
        </div>

        <h3 className="mt-2.5 font-extrabold text-gray-900 leading-tight truncate
                       transition-colors group-hover:text-emerald-600">
          {biz.name}
        </h3>

        {(biz.city || biz.state) && (
          <p className="flex items-center gap-1 text-xs text-gray-400 mt-0.5 truncate">
            <MapPin size={12} className="flex-shrink-0" /> {[biz.city, biz.state].filter(Boolean).join(', ')}
          </p>
        )}

        {biz.tagline && <p className="text-sm text-gray-500 mt-1.5 line-clamp-2">{biz.tagline}</p>}

        {/* CTAs */}
        <div className="flex items-stretch gap-2 mt-auto pt-4">
          <span className="relative flex-1 inline-flex items-center justify-center gap-1 text-xs font-bold text-white
                           rounded-xl py-2.5 overflow-hidden"
                style={{ background: `linear-gradient(135deg, ${biz.primary}, ${biz.primaryDark})` }}>
            <span className="absolute inset-0 overflow-hidden rounded-xl">
              <span className="absolute top-0 h-full w-1/3 bg-white/30 blur-md -skew-x-12
                               -translate-x-[180%] group-hover:translate-x-[420%] transition-transform duration-700" />
            </span>
            <span className="relative inline-flex items-center gap-1">Browse Products <ArrowRight size={13} /></span>
          </span>

          {waHref && (
            <button type="button" onClick={onWhatsApp} aria-label="Chat on WhatsApp"
              className="flex-shrink-0 inline-flex items-center justify-center rounded-xl w-11 text-white
                         transition-transform hover:scale-110 active:scale-95"
              style={{ backgroundColor: WA }}>
              <MessageCircle size={17} />
            </button>
          )}
        </div>
      </div>
    </Link>
  );
}

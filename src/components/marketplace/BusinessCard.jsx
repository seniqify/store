import { Link } from 'react-router-dom';
import { MapPin, ArrowRight, MessageCircle } from 'lucide-react';
import { whatsappLink } from '../../utils/theme';

const WA = '#25D366';

/**
 * One business in the marketplace grid. The whole card links to the store page;
 * the WhatsApp button opens a chat directly (stops the card navigation).
 */
export default function BusinessCard({ biz }) {
  const waHref = biz.whatsappNumber ? whatsappLink(biz.whatsappNumber, biz.name) : null;

  const onWhatsApp = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (waHref) window.open(waHref, '_blank', 'noopener,noreferrer');
  };

  return (
    <Link
      to={biz.href}
      className="group flex flex-col bg-white rounded-2xl border border-gray-100 overflow-hidden
                 shadow-sm hover:shadow-xl hover:-translate-y-0.5 transition-all duration-200">

      {/* Banner */}
      <div className="relative h-24 sm:h-28 w-full overflow-hidden">
        {biz.coverImage ? (
          <img src={biz.coverImage} alt="" loading="lazy"
               className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" />
        ) : (
          <div className="w-full h-full"
               style={{ background: `linear-gradient(135deg, ${biz.primary}, ${biz.primaryDark})` }} />
        )}
        <span className="absolute top-2 right-2 text-[10px] font-bold text-gray-700 bg-white/90
                         backdrop-blur px-2 py-0.5 rounded-full shadow-sm">
          {biz.category}
        </span>
        {biz.demo && (
          <span className="absolute top-2 left-2 text-[9px] font-bold text-white bg-black/40
                           backdrop-blur px-2 py-0.5 rounded-full">
            DEMO
          </span>
        )}
      </div>

      <div className="px-3.5 pb-4 -mt-7 flex flex-col flex-1">
        {/* Avatar */}
        <div className="w-14 h-14 rounded-2xl ring-4 ring-white shadow-md overflow-hidden bg-white
                        flex items-center justify-center text-2xl flex-shrink-0"
             style={!biz.logo ? { background: `linear-gradient(135deg, ${biz.primary}, ${biz.primaryDark})` } : undefined}>
          {biz.logo
            ? <img src={biz.logo} alt={biz.name} className="w-full h-full object-cover" loading="lazy" />
            : <span className="drop-shadow-sm">{biz.logoEmoji}</span>}
        </div>

        <h3 className="mt-2.5 font-extrabold text-gray-900 leading-tight truncate">{biz.name}</h3>

        {biz.city && (
          <p className="flex items-center gap-1 text-xs text-gray-400 mt-0.5 truncate">
            <MapPin size={12} className="flex-shrink-0" /> {biz.city}
          </p>
        )}

        {biz.tagline && (
          <p className="text-sm text-gray-500 mt-1.5 line-clamp-2">{biz.tagline}</p>
        )}

        {/* CTAs */}
        <div className="flex items-center gap-2 mt-auto pt-3.5">
          <span className="flex-1 inline-flex items-center justify-center gap-1 text-xs font-bold text-white
                           rounded-xl py-2.5 transition-opacity group-hover:opacity-90"
                style={{ backgroundColor: biz.primary }}>
            Browse <ArrowRight size={13} />
          </span>
          {waHref && (
            <button type="button" onClick={onWhatsApp}
              className="flex-1 inline-flex items-center justify-center gap-1 text-xs font-bold text-white
                         rounded-xl py-2.5 transition-opacity hover:opacity-90"
              style={{ backgroundColor: WA }}>
              <MessageCircle size={13} /> WhatsApp
            </button>
          )}
        </div>
      </div>
    </Link>
  );
}

import { useBusinessConfig } from '../contexts/BusinessContext';

/**
 * PromoBanner — renders the store's promo/announcement message (config.promoText).
 *
 * Shared across the business-type templates (Lodges & Stay, Restaurant,
 * Service) so the promo set in Manage → Settings shows up everywhere, not
 * just on the default product storefront.
 *
 * Format: "🎉 Heading · optional subtitle"
 *   • leading emoji → the left icon
 *   • text before "·" → bold heading
 *   • text after "·"  → muted subtitle
 *
 * Themed with the store's brand colour. Returns null when no promo is set.
 *
 * Props:
 *   maxWidth  string  Tailwind max-width class to match the template's content
 *                     width (default 'max-w-7xl').
 */
export default function PromoBanner({ maxWidth = 'max-w-7xl' }) {
  const { promoText, theme } = useBusinessConfig();
  if (!promoText?.trim()) return null;

  const primary = theme?.primary ?? '#0d9488';
  const emoji   = promoText.match(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}]+/u)?.[0] ?? null;
  const noEmoji = promoText.replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}]+\s*/u, '').trim();
  const parts   = noEmoji.split(/\s*[·•\-–]\s*/);
  const heading = parts[0] ?? '';
  const sub     = parts[1] ?? null;

  return (
    <div className="w-full px-3 sm:px-4 pt-3 pb-1">
      <div className={`${maxWidth} mx-auto rounded-2xl overflow-hidden`}
           style={{ backgroundColor: `${primary}12`, border: `1px solid ${primary}25` }}>
        <div className="flex items-center gap-3 px-4 py-3">
          <span className="text-xl flex-shrink-0">{emoji ?? '🎉'}</span>
          <div className="min-w-0 flex-1">
            <p className="font-bold text-sm text-gray-900 leading-tight">{heading}</p>
            {sub && <p className="text-xs text-gray-500 mt-0.5 leading-snug">{sub}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

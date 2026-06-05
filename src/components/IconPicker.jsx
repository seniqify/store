import { useState } from 'react';
import { iconSuggestions, ICON_EMOJIS } from '../utils/businessCategories';

/**
 * Business-icon emoji picker. When a sub-category is chosen, shows the icons that
 * fit it (smart suggestions) with a "Show all" toggle for the full set. With no
 * category, shows the full set.
 *
 * Props: value (emoji), onChange(emoji), category (sub-category id), accent (hex)
 */
export default function IconPicker({ value, onChange, category, accent = '#0d9488' }) {
  const [showAll, setShowAll] = useState(false);
  const suggested = iconSuggestions(category);
  const hasSuggestions = suggested.length > 0;
  const full = showAll || !hasSuggestions;
  const list = full ? ICON_EMOJIS : suggested;

  return (
    <div>
      {hasSuggestions && !showAll && (
        <p className="text-[11px] text-gray-400 mb-1.5">Suggested for your category</p>
      )}
      <div className={[
        'flex flex-wrap gap-2 p-1.5 rounded-xl',
        full ? 'max-h-44 overflow-y-auto border border-gray-100 bg-gray-50/50' : '',
      ].join(' ')}>
        {list.map((emoji) => (
          <button key={emoji} type="button" onClick={() => onChange(emoji)}
            className={[
              'w-10 h-10 rounded-xl text-xl flex items-center justify-center transition-all flex-shrink-0',
              value === emoji ? 'scale-110 text-white shadow-sm' : 'bg-white hover:bg-gray-100 border border-gray-200',
            ].join(' ')}
            style={value === emoji ? { backgroundColor: accent } : {}}>
            {emoji}
          </button>
        ))}
      </div>
      {hasSuggestions && (
        <button type="button" onClick={() => setShowAll((s) => !s)}
          className="mt-2 text-xs font-semibold text-gray-500 hover:text-gray-700">
          {showAll ? '← Show suggested' : 'Show all icons →'}
        </button>
      )}
    </div>
  );
}

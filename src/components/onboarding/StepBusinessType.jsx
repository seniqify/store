/**
 * StepBusinessType — Onboarding step 1.
 * Pick what kind of business this is. Tapping a card selects it AND advances
 * (the parent sets a matching theme colour + icon on select), so it's one tap.
 */

const BUSINESS_TYPES = [
  {
    key:   'product',
    emoji: '🛒',
    label: 'Shop / Products',
    desc:  'Kirana, clothes, electronics, hardware…',
    tint:  '#0d9488',
  },
  {
    key:   'restaurant',
    emoji: '🍽️',
    label: 'Food / Restaurant',
    desc:  'Restaurant, tiffin, bakery, sweets…',
    tint:  '#ea580c',
  },
  {
    key:   'service',
    emoji: '🛠️',
    label: 'Services',
    desc:  'Salon, repairs, tailor, tuition…',
    tint:  '#9333ea',
  },
  {
    key:   'hotel',
    emoji: '🏨',
    label: 'Stay / Rooms',
    desc:  'Lodge, hotel, homestay, resort…',
    tint:  '#6366f1',
  },
];

export default function StepBusinessType({ selected, onSelect, onNext }) {
  // One tap: record the choice (parent also sets theme + icon), then move on.
  function pick(type) {
    onSelect(type);
    onNext();
  }

  return (
    <div className="space-y-6">
      <div className="text-center">
        <p className="text-2xl mb-2">👋</p>
        <h2 className="text-xl font-extrabold text-gray-900">What do you sell?</h2>
        <p className="text-sm text-gray-500 mt-1">Tap the one that fits — you can change anything later.</p>
      </div>

      <div className="space-y-3">
        {BUSINESS_TYPES.map((type) => {
          const active = selected === type.key;
          return (
            <button
              key={type.key}
              type="button"
              onClick={() => pick(type.key)}
              className={[
                'w-full flex items-center gap-4 px-4 py-4 rounded-2xl border-2 text-left',
                'transition-all duration-150 active:scale-[0.99]',
                active ? 'border-transparent' : 'border-gray-100 bg-white hover:border-gray-200 hover:bg-gray-50',
              ].join(' ')}
              style={active ? { backgroundColor: `${type.tint}12`, borderColor: `${type.tint}66` } : undefined}
            >
              <span
                className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl flex-shrink-0"
                style={{ backgroundColor: `${type.tint}1a` }}
              >
                {type.emoji}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-extrabold text-[15px] leading-tight text-gray-900">{type.label}</p>
                <p className="text-xs text-gray-500 mt-0.5 leading-snug">{type.desc}</p>
              </div>
              <span className="text-gray-300 text-lg flex-shrink-0">→</span>
            </button>
          );
        })}
      </div>

      <p className="text-center text-[11px] text-gray-400">Not sure? Pick the closest — it only sets your page layout.</p>
    </div>
  );
}

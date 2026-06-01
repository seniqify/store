const BUSINESS_TYPES = [
  {
    key:   'product',
    emoji: '🛒',
    label: 'Product / Retail',
    desc:  'Wholesalers, electronics, retail, manufacturers',
  },
  {
    key:   'restaurant',
    emoji: '🍽️',
    label: 'Restaurant / Food',
    desc:  'Restaurants, cafes, cloud kitchens',
  },
  {
    key:   'service',
    emoji: '🔧',
    label: 'Service / Agency',
    desc:  'Agencies, repair, salons, consultants',
  },
  {
    key:   'hotel',
    emoji: '🏨',
    label: 'Hotel / Lodge',
    desc:  'Hotels, lodges, resorts, homestays',
  },
  {
    key:   'portfolio',
    emoji: '💼',
    label: 'Portfolio / Leads',
    desc:  'Architects, freelancers, designers, coaches',
  },
];

export default function StepBusinessType({ selected, onSelect, onNext }) {
  return (
    <div className="space-y-6">
      <div className="text-center">
        <p className="text-2xl mb-2">👋</p>
        <h2 className="text-xl font-extrabold text-gray-900">What type of business are you?</h2>
        <p className="text-sm text-gray-500 mt-1">This sets up the right layout for your business page.</p>
      </div>

      <div className="space-y-3">
        {BUSINESS_TYPES.map((type) => {
          const active = selected === type.key;
          return (
            <button
              key={type.key}
              onClick={() => onSelect(type.key)}
              className={[
                'w-full flex items-center gap-4 px-4 py-3.5 rounded-2xl border-2 text-left',
                'transition-all duration-150 active:scale-[0.99]',
                active
                  ? 'border-teal-500 bg-teal-50'
                  : 'border-gray-100 bg-white hover:border-gray-200',
              ].join(' ')}
            >
              <span className="text-2xl leading-none flex-shrink-0">{type.emoji}</span>
              <div className="min-w-0">
                <p className={`font-bold text-sm leading-tight ${active ? 'text-teal-700' : 'text-gray-900'}`}>
                  {type.label}
                </p>
                <p className="text-xs text-gray-400 mt-0.5 leading-snug">{type.desc}</p>
              </div>
              {active && (
                <span className="ml-auto flex-shrink-0 w-5 h-5 rounded-full bg-teal-500
                                 flex items-center justify-center text-white text-xs font-bold">
                  ✓
                </span>
              )}
            </button>
          );
        })}
      </div>

      <button
        onClick={onNext}
        disabled={!selected}
        className="w-full py-3 rounded-xl text-sm font-bold text-white bg-gray-900
                   transition-all hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Continue →
      </button>
    </div>
  );
}

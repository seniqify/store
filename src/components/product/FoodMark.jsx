import { FOOD_TYPES } from '../../utils/foodType';

/**
 * The veg / non-veg / egg mark from Indian food packs: a square outline with a
 * dot, green for veg, red for non-veg, amber for egg. Nothing for other values.
 */
const COLOR = { veg: '#15803d', nonveg: '#b91c1c', egg: '#b45309' };

export default function FoodMark({ type, size = 12, className = '' }) {
  const c = COLOR[type];
  if (!c) return null;
  const label = FOOD_TYPES.find(([k]) => k === type)?.[1] || '';
  return (
    <span role="img" aria-label={label} title={label}
          className={`inline-grid place-items-center flex-shrink-0 align-[-1px] ${className}`}
          style={{ width: size, height: size, border: `1.5px solid ${c}`, borderRadius: 2 }}>
      <span style={{ width: size / 2, height: size / 2, borderRadius: 999, background: c }} />
    </span>
  );
}

import { Star } from 'lucide-react';

/**
 * Displays a star rating with optional review count
 */
export default function StarRating({ rating = 0, reviews = 0, showCount = true }) {
  const full = Math.floor(rating);
  const half = rating % 1 >= 0.5;

  return (
    <div className="flex items-center gap-1">
      <div className="flex items-center">
        {[1, 2, 3, 4, 5].map((star) => (
          <Star
            key={star}
            size={13}
            className={
              star <= full
                ? 'fill-amber-400 text-amber-400'
                : star === full + 1 && half
                ? 'fill-amber-200 text-amber-400'
                : 'fill-gray-200 text-gray-300'
            }
          />
        ))}
      </div>
      <span className="text-xs font-semibold text-amber-600">{rating.toFixed(1)}</span>
      {showCount && reviews > 0 && (
        <span className="text-xs text-gray-400">({reviews.toLocaleString('en-IN')})</span>
      )}
    </div>
  );
}

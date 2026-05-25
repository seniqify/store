/**
 * Badge — small label chip used on product cards
 */
export default function Badge({ label, colorClass = 'bg-orange-500' }) {
  if (!label) return null;
  return (
    <span className={`${colorClass} text-white text-xs font-semibold px-2 py-0.5 rounded-full`}>
      {label}
    </span>
  );
}

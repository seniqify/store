/**
 * Button — uses brand CSS custom properties so it recolors automatically
 * when BUSINESS_CONFIG.theme changes.
 *
 * variant: 'primary' | 'secondary' | 'ghost' | 'danger'
 * size:    'sm' | 'md' | 'lg'
 */
export default function Button({
  children,
  onClick,
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  disabled = false,
  type = 'button',
  className = '',
}) {
  const base =
    'inline-flex items-center justify-center gap-2 font-semibold rounded-xl ' +
    'transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-1';

  const variants = {
    primary:
      'bg-brand hover:bg-brand-dark active:bg-brand-dark text-white focus:ring-brand/50 shadow-sm',
    secondary:
      'bg-white hover:bg-brand/10 active:bg-brand/20 text-brand border-2 border-brand focus:ring-brand/30',
    ghost:
      'bg-transparent hover:bg-gray-100 active:bg-gray-200 text-gray-700 focus:ring-gray-300',
    danger:
      'bg-red-500 hover:bg-red-600 active:bg-red-700 text-white focus:ring-red-400 shadow-sm',
  };

  const sizes = {
    sm: 'text-sm px-3 py-1.5',
    md: 'text-sm px-4 py-2.5',
    lg: 'text-base px-6 py-3',
  };

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={[
        base,
        variants[variant],
        sizes[size],
        fullWidth ? 'w-full' : '',
        disabled ? 'opacity-50 cursor-not-allowed pointer-events-none' : 'cursor-pointer',
        className,
      ].join(' ')}
    >
      {children}
    </button>
  );
}

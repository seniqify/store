/**
 * HeroBanner — the colored banner behind the store header card (shown when the
 * owner hasn't uploaded a cover photo). Every style is derived purely from the
 * brand colour, so it works with any colour the owner picks. Shared by the
 * storefront and the Settings preview so what they pick is exactly what ships.
 */
export const BANNER_STYLES = [
  { id: 'aurora', label: 'Aurora' },
  { id: 'mesh',   label: 'Mesh'   },
  { id: 'solid',  label: 'Solid'  },
  { id: 'dots',   label: 'Dots'   },
];

export default function HeroBanner({ style = 'aurora', primary = '#0d9488', primaryDark = '#0f766e', className = '' }) {
  const base = `w-full h-full relative overflow-hidden ${className}`;

  if (style === 'solid') {
    return <div className={base} style={{ background: primary }} />;
  }

  if (style === 'dots') {
    return (
      <div className={base} style={{ background: primary }}>
        <div className="absolute inset-0"
             style={{ opacity: 0.14, backgroundImage: 'radial-gradient(#fff 1.5px, transparent 1.5px)', backgroundSize: '16px 16px' }} />
      </div>
    );
  }

  if (style === 'mesh') {
    return (
      <div className={base} style={{
        background:
          `radial-gradient(at 15% 20%, ${primary} 0px, transparent 50%),` +
          `radial-gradient(at 85% 12%, ${primaryDark} 0px, transparent 50%),` +
          `radial-gradient(at 70% 92%, ${primary} 0px, transparent 45%),` +
          `${primaryDark}`,
      }} />
    );
  }

  // aurora (default) — diagonal gradient + soft blur orbs + fine dot pattern
  return (
    <div className={base} style={{ background: `linear-gradient(135deg, ${primary} 0%, ${primaryDark} 100%)` }}>
      <div className="absolute -top-12 -right-8 w-60 h-60 rounded-full"
           style={{ background: '#fff', opacity: 0.15, filter: 'blur(50px)' }} />
      <div className="absolute -bottom-20 left-1/4 w-56 h-56 rounded-full"
           style={{ background: '#000', opacity: 0.18, filter: 'blur(50px)' }} />
      <div className="absolute inset-0"
           style={{ opacity: 0.08, backgroundImage: 'radial-gradient(#fff 1px, transparent 1px)', backgroundSize: '18px 18px' }} />
    </div>
  );
}

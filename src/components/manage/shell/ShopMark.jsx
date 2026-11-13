import { isImageSrc, shopInitial } from '../../../utils/pinGate';

/**
 * The shop's logo in a small rounded square: the uploaded logo, else its emoji,
 * else its first letter in the shop colour.
 */
export default function ShopMark({ config = {}, size = 44, accent = '#0d9488', className = '' }) {
  const box = { width: size, height: size };
  const name = config.businessName || '';
  if (isImageSrc(config.logo)) {
    return <img src={config.logo} alt="" style={box}
                className={`rounded-xl object-cover bg-white flex-shrink-0 ${className}`} />;
  }
  if (config.logoEmoji) {
    return (
      <span aria-hidden="true" style={{ ...box, fontSize: size * 0.5 }}
            className={`rounded-xl bg-white flex items-center justify-center flex-shrink-0 ${className}`}>
        {config.logoEmoji}
      </span>
    );
  }
  return (
    <span aria-hidden="true" style={{ ...box, background: accent, fontSize: size * 0.42 }}
          className={`rounded-xl text-white font-extrabold flex items-center justify-center flex-shrink-0 ${className}`}>
      {shopInitial(name)}
    </span>
  );
}

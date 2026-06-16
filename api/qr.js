// Branded per-store QR card (PNG) for the public store URL.
// Used as the image header in the WhatsApp store-registration welcome message.
// A plain QR looks blunt, so we wrap it in a PocketLink-branded card (emerald
// frame + wordmark + caption). The QR stays dark-on-white at high error
// correction, so it scans reliably. If anything fails, we fall back to the raw
// QR image so the message's media always resolves.
import { ImageResponse } from '@vercel/og';

export const config = { runtime: 'edge' };

const SITE  = 'https://www.pocketlink.store';
const BRAND = '#0d9488';
const DARK  = '#115e59';   // dark teal — branded but high-contrast, so it scans

// Minimal hyperscript → the element shape Satori accepts (avoids JSX).
function h(type, props, ...children) {
  const kids = children.flat().filter((c) => c != null && c !== false);
  return { type, props: { ...(props || {}), children: kids.length === 1 ? kids[0] : kids } };
}

export default function handler(req) {
  const url  = new URL(req.url);
  const slug = (url.searchParams.get('slug') || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 60);
  const target = slug ? `${SITE}/${slug}` : SITE;
  const label  = slug ? `pocketlink.store/${slug}` : 'pocketlink.store';
  const qrSrc  = `https://api.qrserver.com/v1/create-qr-code/?size=440x440&margin=0&ecc=H&qzone=1&color=${DARK.slice(1)}&data=${encodeURIComponent(target)}`;

  try {
    const card = h('div', {
      style: {
        width: '600px', height: '600px', display: 'flex',
        alignItems: 'center', justifyContent: 'center', padding: '40px',
        background: `linear-gradient(135deg, ${BRAND}, ${DARK})`,
      },
    },
      h('div', {
        style: {
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          background: 'white', borderRadius: '36px', padding: '34px 34px 26px',
        },
      },
        // Brand row
        h('div', { style: { display: 'flex', alignItems: 'center', marginBottom: '20px' } },
          h('div', {
            style: {
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: '44px', height: '44px', borderRadius: '13px', marginRight: '12px',
              fontSize: '26px', background: `linear-gradient(135deg, ${BRAND}, ${DARK})`,
            },
          }, '🛍️'),
          h('div', { style: { display: 'flex', fontSize: '32px', fontWeight: 800, color: DARK } }, 'PocketLink'),
        ),
        // QR
        h('div', { style: { display: 'flex', padding: '8px' } },
          h('img', { src: qrSrc, width: 372, height: 372, style: { width: '372px', height: '372px' } }),
        ),
        // Captions
        h('div', { style: { display: 'flex', fontSize: '25px', fontWeight: 700, color: '#111827', marginTop: '18px' } }, label),
        h('div', { style: { display: 'flex', fontSize: '19px', color: '#6b7280', marginTop: '6px' } }, '📲 Scan to order on WhatsApp'),
      ),
    );

    return new ImageResponse(card, {
      width: 600,
      height: 600,
      emoji: 'noto',
      headers: { 'Cache-Control': 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400' },
    });
  } catch {
    // Fallback: serve the plain QR so the WhatsApp media never fails.
    return fetch(qrSrc);
  }
}

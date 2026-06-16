// Premium "Scan to order" QR card (PNG) for a store.
// Used as the WhatsApp welcome image header and anywhere a shareable/printable
// card is handy. Designed to be attractive enough to display at a shop counter:
// the BUSINESS NAME is the hero (fetched live from the store), it uses the
// store's own brand colour + emoji, the QR carries the emoji in its center, and
// PocketLink branding sits tastefully at the bottom. Falls back to the raw QR if
// anything fails, so the WhatsApp media never breaks.
import { ImageResponse } from '@vercel/og';

export const config = { runtime: 'edge' };

const SITE = 'https://www.pocketlink.store';
const SB   = 'https://uoyqbexemoheipwrtkcz.supabase.co';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVveXFiZXhlbW9oZWlwd3J0a2N6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2OTYzMTksImV4cCI6MjA5NTI3MjMxOX0.LWkT6EUVGuUIUE38XYGcfmn8DgAKMz3JC20bxuTCcx0';
const QR_DARK = '#134e4a';  // dark teal modules — high contrast so it always scans

const FONT_URLS = [
  ['https://cdn.jsdelivr.net/npm/@fontsource/inter@5/files/inter-latin-800-normal.woff', 800],
  ['https://cdn.jsdelivr.net/npm/@fontsource/inter@5/files/inter-latin-600-normal.woff', 600],
  ['https://cdn.jsdelivr.net/npm/@fontsource/inter@5/files/inter-latin-400-normal.woff', 400],
];

async function loadFonts() {
  const out = [];
  for (const [u, weight] of FONT_URLS) {
    try {
      const r = await fetch(u);
      if (r.ok) out.push({ name: 'Inter', data: await r.arrayBuffer(), weight, style: 'normal' });
    } catch { /* skip */ }
  }
  return out;
}

function h(type, props, ...children) {
  const kids = children.flat().filter((c) => c != null && c !== false);
  return { type, props: { ...(props || {}), children: kids.length === 1 ? kids[0] : kids } };
}

async function loadStore(slug) {
  try {
    const r = await fetch(`${SB}/rest/v1/stores?slug=eq.${slug}&select=config&limit=1`, {
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
    });
    if (r.ok) { const rows = await r.json(); return rows[0]?.config || null; }
  } catch { /* fall through */ }
  return null;
}

export default async function handler(req) {
  const url  = new URL(req.url);
  const slug = (url.searchParams.get('slug') || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 60);
  const target = slug ? `${SITE}/${slug}` : SITE;
  const qrSrc  = `https://api.qrserver.com/v1/create-qr-code/?size=460x460&margin=0&ecc=H&qzone=1&color=${QR_DARK.slice(1)}&data=${encodeURIComponent(target)}`;

  try {
    const [fonts, cfg] = await Promise.all([loadFonts(), slug ? loadStore(slug) : null]);
    if (!fonts.length) return fetch(qrSrc);

    const name      = String(cfg?.businessName || 'Your Store').slice(0, 40);
    const emoji     = cfg?.logoEmoji || '🏪';
    const brand     = cfg?.theme?.primary     || '#0d9488';
    const brandDark = cfg?.theme?.primaryDark || '#0f766e';

    const card = h('div', {
      style: {
        width: '720px', height: '900px', display: 'flex', flexDirection: 'column',
        background: 'white', fontFamily: 'Inter',
      },
    },
      // ── Header band (brand gradient) ──────────────────────────────────────
      h('div', {
        style: {
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          padding: '40px 40px 34px', background: `linear-gradient(135deg, ${brand}, ${brandDark})`,
        },
      },
        h('div', {
          style: {
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: '92px', height: '92px', borderRadius: '26px', fontSize: '52px',
            background: 'rgba(255,255,255,0.18)', border: '2px solid rgba(255,255,255,0.45)',
          },
        }, emoji),
        h('div', {
          style: {
            display: 'flex', textAlign: 'center', color: 'white', fontWeight: 800,
            fontSize: '50px', lineHeight: '1.05', marginTop: '18px', maxWidth: '620px',
          },
        }, name),
        h('div', {
          style: {
            display: 'flex', alignItems: 'center', marginTop: '16px', color: 'white',
            fontSize: '23px', fontWeight: 600, background: 'rgba(255,255,255,0.2)',
            borderRadius: '999px', padding: '9px 20px',
          },
        }, '📲  Scan to order on WhatsApp'),
      ),

      // ── QR + caption ──────────────────────────────────────────────────────
      h('div', {
        style: { display: 'flex', flexDirection: 'column', alignItems: 'center', flexGrow: 1, justifyContent: 'center', padding: '8px 40px' },
      },
        h('div', {
          style: { display: 'flex', padding: '18px', borderRadius: '30px', background: 'white', border: `3px solid ${brand}33` },
        },
          h('div', { style: { display: 'flex', position: 'relative', width: '420px', height: '420px' } },
            h('img', { src: qrSrc, width: 420, height: 420, style: { width: '420px', height: '420px' } }),
            // Store emoji in the QR center (ECC-H keeps it scannable)
            h('div', {
              style: {
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                position: 'absolute', top: '50%', left: '50%', marginTop: '-44px', marginLeft: '-44px',
                width: '88px', height: '88px', borderRadius: '24px', fontSize: '46px',
                background: 'white', border: `4px solid ${brand}`,
              },
            }, emoji),
          ),
        ),
        h('div', {
          style: { display: 'flex', textAlign: 'center', color: '#475569', fontSize: '23px', fontWeight: 600, marginTop: '24px', maxWidth: '560px' },
        }, 'No app needed — browse the catalogue & order in seconds'),
      ),

      // ── Footer (PocketLink branding) ──────────────────────────────────────
      h('div', {
        style: {
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '20px 20px 34px', borderTop: '1px solid #eef2f1', flexShrink: 0,
        },
      },
        h('div', { style: { display: 'flex', color: '#9ca3af', fontSize: '19px', fontWeight: 600, marginRight: '12px' } }, 'Powered by'),
        h('img', { src: `${SITE}/pocketlink-wordmark.png`, width: 168, height: 34, style: { width: '168px', height: '34px' } }),
      ),
    );

    return new ImageResponse(card, {
      width: 720,
      height: 900,
      emoji: 'noto',
      fonts,
      headers: { 'Cache-Control': 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400' },
    });
  } catch {
    return fetch(qrSrc);
  }
}

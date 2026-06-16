// Premium "Scan to order" QR card (PNG) for a store.
// Business name is the hero (fetched live), with the store's brand colour +
// emoji, a framed QR carrying the store emoji in its center, and a tasteful
// "Powered by PocketLink" footer.
//
// Reliability: every external asset (QR image, logo, fonts, store data) is
// fetched HERE in parallel with timeouts, then handed to Satori as ready data
// URIs / buffers — so the render itself does NO network I/O and can't flake on a
// cold start. If the QR or fonts can't be fetched, we serve the plain QR with a
// NO-STORE header so a transient miss never gets cached.
import { ImageResponse } from '@vercel/og';

export const config = { runtime: 'edge' };

const SITE = 'https://www.pocketlink.store';
const SB   = 'https://uoyqbexemoheipwrtkcz.supabase.co';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVveXFiZXhlbW9oZWlwd3J0a2N6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2OTYzMTksImV4cCI6MjA5NTI3MjMxOX0.LWkT6EUVGuUIUE38XYGcfmn8DgAKMz3JC20bxuTCcx0';
const QR_DARK = '#134e4a';

const FONT_URLS = [
  ['https://cdn.jsdelivr.net/npm/@fontsource/inter@5/files/inter-latin-700-normal.woff', 700],
  ['https://cdn.jsdelivr.net/npm/@fontsource/inter@5/files/inter-latin-400-normal.woff', 400],
];

function withTimeout(p, ms) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
}

async function buf(url, ms = 4500) {
  const r = await withTimeout(fetch(url), ms);
  if (!r.ok) throw new Error(url + ' ' + r.status);
  return new Uint8Array(await r.arrayBuffer());
}

function toDataUri(bytes, type = 'image/png') {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return `data:${type};base64,${btoa(bin)}`;
}

async function loadStore(slug) {
  try {
    const r = await withTimeout(fetch(`${SB}/rest/v1/stores?slug=eq.${slug}&select=config&limit=1`, {
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
    }), 3500);
    if (r.ok) { const rows = await r.json(); return rows[0]?.config || null; }
  } catch { /* defaults */ }
  return null;
}

function h(type, props, ...children) {
  const kids = children.flat().filter((c) => c != null && c !== false);
  return { type, props: { ...(props || {}), children: kids.length === 1 ? kids[0] : kids } };
}

function rawQrResponse(qrSrc) {
  // Non-cacheable so a transient miss never poisons the CDN/Meta for this URL.
  return fetch(qrSrc).then((r) => new Response(r.body, {
    status: 200,
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' },
  }));
}

export default async function handler(req) {
  const url  = new URL(req.url);
  const slug = (url.searchParams.get('slug') || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 60);
  const target = slug ? `${SITE}/${slug}` : SITE;
  const qrSrc  = `https://api.qrserver.com/v1/create-qr-code/?size=460x460&margin=0&ecc=H&qzone=1&color=${QR_DARK.slice(1)}&data=${encodeURIComponent(target)}`;

  try {
    // Fetch everything up front, in parallel.
    const [fontResults, cfg, qrBytes, logoBytes] = await Promise.all([
      Promise.all(FONT_URLS.map(([u, weight]) =>
        buf(u, 4500).then((data) => ({ name: 'Inter', data, weight, style: 'normal' })).catch(() => null))),
      slug ? loadStore(slug) : null,
      buf(qrSrc, 4500),                                   // QR is required
      buf(`${SITE}/pocketlink-wordmark.png`, 4000).catch(() => null), // logo optional
    ]);

    const fonts = fontResults.filter(Boolean);
    if (!fonts.length) return rawQrResponse(qrSrc);

    const qrUri   = toDataUri(qrBytes);
    const logoUri = logoBytes ? toDataUri(logoBytes) : null;

    const name      = String(cfg?.businessName || 'Your Store').slice(0, 40);
    const emoji     = cfg?.logoEmoji || '🏪';
    const brand     = cfg?.theme?.primary     || '#0d9488';
    const brandDark = cfg?.theme?.primaryDark || '#0f766e';

    const card = h('div', {
      style: { width: '720px', height: '900px', display: 'flex', flexDirection: 'column', background: 'white', fontFamily: 'Inter' },
    },
      // Header band
      h('div', {
        style: { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 40px 34px', background: `linear-gradient(135deg, ${brand}, ${brandDark})` },
      },
        h('div', {
          style: { display: 'flex', alignItems: 'center', justifyContent: 'center', width: '92px', height: '92px', borderRadius: '26px', fontSize: '52px', background: 'rgba(255,255,255,0.18)', border: '2px solid rgba(255,255,255,0.45)' },
        }, emoji),
        h('div', {
          style: { display: 'flex', textAlign: 'center', color: 'white', fontWeight: 700, fontSize: '50px', lineHeight: '1.05', marginTop: '18px', maxWidth: '620px' },
        }, name),
        h('div', {
          style: { display: 'flex', alignItems: 'center', marginTop: '16px', color: 'white', fontSize: '23px', fontWeight: 700, background: 'rgba(255,255,255,0.2)', borderRadius: '999px', padding: '9px 20px' },
        }, '📲  Scan to order on WhatsApp'),
      ),
      // QR + caption
      h('div', {
        style: { display: 'flex', flexDirection: 'column', alignItems: 'center', flexGrow: 1, justifyContent: 'center', padding: '8px 40px' },
      },
        h('div', { style: { display: 'flex', padding: '18px', borderRadius: '30px', background: 'white', border: `3px solid ${brand}33` } },
          h('div', { style: { display: 'flex', position: 'relative', width: '420px', height: '420px' } },
            h('img', { src: qrUri, width: 420, height: 420, style: { width: '420px', height: '420px' } }),
            h('div', {
              style: { display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'absolute', top: '50%', left: '50%', marginTop: '-44px', marginLeft: '-44px', width: '88px', height: '88px', borderRadius: '24px', fontSize: '46px', background: 'white', border: `4px solid ${brand}` },
            }, emoji),
          ),
        ),
        h('div', {
          style: { display: 'flex', textAlign: 'center', color: '#475569', fontSize: '23px', fontWeight: 700, marginTop: '24px', maxWidth: '560px' },
        }, 'No app needed — browse the catalogue & order in seconds'),
      ),
      // Footer
      h('div', {
        style: { display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px 20px 34px', borderTop: '1px solid #eef2f1', flexShrink: 0 },
      },
        h('div', { style: { display: 'flex', color: '#9ca3af', fontSize: '19px', fontWeight: 700, marginRight: '12px' } }, 'Powered by'),
        logoUri
          ? h('img', { src: logoUri, width: 168, height: 34, style: { width: '168px', height: '34px' } })
          : h('div', { style: { display: 'flex', color: brandDark, fontSize: '24px', fontWeight: 700 } }, 'PocketLink'),
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
    return rawQrResponse(qrSrc);
  }
}

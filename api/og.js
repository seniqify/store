// Dynamic per-store link-preview image (1200×630 PNG). Renders a branded card
// with the shop's logo/emoji, name, tagline and brand colour — so cover-less
// stores still get a shop-specific preview. Devanagari (Hindi/Marathi) is
// supported by loading Noto Sans Devanagari; if a font fetch fails it degrades
// gracefully to @vercel/og's built-in Latin font (the card still renders).
import { ImageResponse } from '@vercel/og';

export const config = { runtime: 'edge' };

// Public anon credentials (already shipped in the client bundle — safe to inline).
const SB =
  'https://uoyqbexemoheipwrtkcz.supabase.co';
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVveXFiZXhlbW9oZWlwd3J0a2N6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2OTYzMTksImV4cCI6MjA5NTI3MjMxOX0.LWkT6EUVGuUIUE38XYGcfmn8DgAKMz3JC20bxuTCcx0';

// Noto Sans Devanagari (Latin + Devanagari subsets, weight 400) — Satori-compatible woff.
const FONT_URLS = [
  'https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-devanagari@5/files/noto-sans-devanagari-latin-400-normal.woff',
  'https://cdn.jsdelivr.net/npm/@fontsource/noto-sans-devanagari@5/files/noto-sans-devanagari-devanagari-400-normal.woff',
];

// Minimal hyperscript → the React-element shape Satori accepts (avoids JSX).
function h(type, props, ...children) {
  const kids = children.flat().filter((c) => c != null && c !== false);
  return { type, props: { ...(props || {}), children: kids.length === 1 ? kids[0] : kids } };
}

async function loadFonts() {
  try {
    const datas = await Promise.all(
      FONT_URLS.map((u) => fetch(u).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null)),
    );
    return datas.filter(Boolean).map((data) => ({ name: 'Noto', data, weight: 400, style: 'normal' }));
  } catch {
    return [];
  }
}

export default async function handler(req) {
  const url = new URL(req.url);
  const slug = (url.searchParams.get('slug') || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 60);

  let cfg = null;
  if (slug) {
    try {
      const r = await fetch(
        `${SB}/rest/v1/stores?slug=eq.${slug}&select=config&limit=1`,
        { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } },
      );
      if (r.ok) { const rows = await r.json(); cfg = rows[0]?.config || null; }
    } catch { /* fall through to defaults */ }
  }

  const name      = String(cfg?.businessName || 'PocketLink Store').slice(0, 48);
  const tagline   = String(cfg?.tagline || 'Order on WhatsApp — no app needed').slice(0, 84);
  const emoji     = cfg?.logoEmoji || '🏪';
  const logo      = typeof cfg?.logo === 'string' && cfg.logo.startsWith('http') ? cfg.logo : null;
  const brand     = cfg?.theme?.primary || '#0d9488';
  const brandDark = cfg?.theme?.primaryDark || brand;

  const fonts = await loadFonts();

  const avatar = logo
    ? h('img', { src: logo, width: 150, height: 150, style: { width: '150px', height: '150px', borderRadius: '36px', objectFit: 'cover' } })
    : h('div', {
        style: {
          width: '150px', height: '150px', borderRadius: '36px',
          background: 'rgba(255,255,255,0.18)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', fontSize: '86px',
        },
      }, emoji);

  const card = h('div', {
    style: {
      width: '1200px', height: '630px', display: 'flex', flexDirection: 'column',
      justifyContent: 'space-between', padding: '72px',
      background: `linear-gradient(135deg, ${brand}, ${brandDark})`,
      color: 'white', fontFamily: 'Noto',
    },
  },
    h('div', { style: { display: 'flex', alignItems: 'center' } }, avatar),
    h('div', { style: { display: 'flex', flexDirection: 'column' } },
      h('div', { style: { display: 'flex', fontSize: '74px', lineHeight: '1.05', marginBottom: '20px' } }, name),
      h('div', { style: { display: 'flex', fontSize: '34px', opacity: '0.92', lineHeight: '1.25' } }, tagline),
    ),
    h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
      h('div', {
        style: {
          display: 'flex', alignItems: 'center', background: '#25D366', color: 'white',
          fontSize: '30px', padding: '16px 28px', borderRadius: '18px',
        },
      }, '💬 Order on WhatsApp'),
      h('div', { style: { display: 'flex', fontSize: '28px', opacity: '0.85' } }, slug ? `pocketlink.store/${slug}` : 'pocketlink.store'),
    ),
  );

  return new ImageResponse(card, {
    width: 1200,
    height: 630,
    emoji: 'noto',
    ...(fonts.length ? { fonts } : {}),
    headers: { 'Cache-Control': 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800' },
  });
}

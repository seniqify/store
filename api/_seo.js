// Shared SEO helpers for the render function. Pure string/JSON builders — no I/O.
// (Underscore prefix tells Vercel this is a helper, not a routable function.)

export function esc(s = '') {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function absImage(src, origin) {
  if (!src || typeof src !== 'string') return null;
  if (src.startsWith('http')) return src;       // Supabase storage / external
  if (src.startsWith('/')) return origin + src; // site-relative
  return null;                                  // data: URLs etc. — skip
}

const TYPE_SCHEMA = {
  restaurant: 'Restaurant',
  hotel:      'LodgingBusiness',
  service:    'LocalBusiness',
  product:    'Store',
};


// ── Store page ────────────────────────────────────────────────────────────────
export function storeSeo(config, slug, origin) {
  const name    = config.businessName || 'Local business';
  const cat     = config.category || '';
  const city    = config.city || '';
  const tagline = (config.tagline || `Order from ${name} on WhatsApp.`).trim();

  let title = name;
  if (cat && city) title = `${name} — ${cat} in ${city}`;
  else if (city)   title = `${name} in ${city}`;
  else if (cat)    title = `${name} — ${cat}`;
  title += ' | Order on WhatsApp';

  const description = `${tagline}${city ? ` Based in ${city}.` : ''} Browse the catalogue and order directly on WhatsApp — no app needed.`.slice(0, 300);
  const url   = `${origin}/${slug}`;
  // The owner's cover photo wins; otherwise a dynamic branded card (their
  // logo/emoji + name + brand colour, rendered by /api/og) — never the generic
  // PocketLink image, so every shared link looks shop-specific.
  const image = absImage(config.coverImage, origin) || `${origin}/api/og?slug=${encodeURIComponent(slug)}`;
  const wa    = String(config.whatsappNumber || '').replace(/\D/g, '');
  const products = Array.isArray(config.products) ? config.products.slice(0, 40) : [];

  const ld = {
    '@context': 'https://schema.org',
    '@type': TYPE_SCHEMA[config.businessType] || 'LocalBusiness',
    name,
    description: tagline,
    url,
    image,
    areaServed: city || 'India',
    priceRange: '₹₹',
    ...(wa ? { telephone: `+${wa}` } : {}),
    ...((config.address || city || config.state)
      ? { address: {
            '@type': 'PostalAddress',
            ...(config.address ? { streetAddress: config.address } : {}),
            ...(city ? { addressLocality: city } : {}),
            ...(config.state ? { addressRegion: config.state } : {}),
            addressCountry: 'IN',
          } }
      : {}),
    ...(products.length
      ? { makesOffer: products.slice(0, 20).map((p) => ({
            '@type': 'Offer',
            itemOffered: { '@type': 'Product', name: p.name },
            ...(p.price ? { price: String(p.price), priceCurrency: 'INR' } : {}),
          })) }
      : {}),
  };

  return { title, description, url, image, ld, name, city, cat, tagline, wa, products };
}

export function storeBody(config, slug, origin, seo) {
  const wa = seo.wa ? `https://wa.me/${seo.wa}` : `${origin}/${slug}`;
  const items = seo.products
    .map((p) => `<li>${esc(p.name)}${p.price ? ` — ₹${esc(p.price)}` : ''}</li>`)
    .join('');
  const sub = [seo.cat, seo.city].filter(Boolean).join(' · ');
  return `<main style="max-width:680px;margin:0 auto;padding:24px;font-family:system-ui,-apple-system,sans-serif;color:#111">
  <h1>${esc(seo.name)}</h1>
  <p>${esc(seo.tagline)}</p>
  ${sub ? `<p>${esc(sub)}</p>` : ''}
  ${config.address ? `<p>${esc(config.address)}</p>` : ''}
  <p><a href="${esc(wa)}">Order on WhatsApp</a></p>
  ${items ? `<h2>Products</h2><ul>${items}</ul>` : ''}
  <p><a href="${origin}/marketplace">Discover more local businesses on PocketLink</a></p>
</main>`;
}

// ── Marketplace page ──────────────────────────────────────────────────────────
export function marketplaceSeo(stores, origin) {
  const n = stores.length;
  const title = 'Discover Local Businesses Near You | PocketLink Marketplace';
  const description = `Browse ${n ? `${n}+ ` : ''}local shops, restaurants, salons and services near you and order directly on WhatsApp. No app, no login, 0% commission.`;
  const url = `${origin}/marketplace`;
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'PocketLink Marketplace',
    url,
    description,
    isPartOf: { '@id': 'https://www.pocketlink.store/#website' },
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: n,
      itemListElement: stores.slice(0, 100).map((s, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        url: `${origin}/${s.slug}`,
        name: (s.config && s.config.businessName) || s.slug,
      })),
    },
  };
  return { title, description, url, ld };
}

export function marketplaceBody(stores, origin) {
  const items = stores.slice(0, 100).map((s) => {
    const c = s.config || {};
    return `<li><a href="${origin}/${esc(s.slug)}">${esc(c.businessName || s.slug)}</a>${c.tagline ? ` — ${esc(c.tagline)}` : ''}</li>`;
  }).join('');
  return `<main style="max-width:680px;margin:0 auto;padding:24px;font-family:system-ui,-apple-system,sans-serif;color:#111">
  <h1>Discover Local Businesses Near You</h1>
  <p>Browse local shops, eateries and services and order directly on WhatsApp — no app, no login.</p>
  ${items ? `<ul>${items}</ul>` : '<p>No businesses listed yet. Be the first to list yours.</p>'}
</main>`;
}

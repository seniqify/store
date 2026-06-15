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

// Short, stable token over the fields that change the dynamic /api/og card.
// Appended to the og:image URL so a logo/name/brand edit yields a NEW image URL
// — which busts the CDN cache and prompts scrapers to re-fetch the fresh card.
function ogToken(config) {
  const basis = [
    config.logo, config.logoEmoji, config.businessName,
    config.tagline, config.theme && config.theme.primary,
  ].join('|');
  let h = 0;
  for (let i = 0; i < basis.length; i++) h = (Math.imul(h, 31) + basis.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
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

  // Build a description that's UNIQUE per store even when the owner never wrote
  // a custom tagline (otherwise every page gets a near-identical meta description
  // → Google treats them as duplicates). Lead with the tagline when it's real,
  // else with name + category + city, then fold in a few product names.
  const productNames = (Array.isArray(config.products) ? config.products : [])
    .map((p) => p && p.name).filter(Boolean);
  const sample = productNames.slice(0, 4).join(', ');
  const genericTagline = !config.tagline
    || /order\s+(from|on|via).*whatsapp/i.test(config.tagline)
    || /just a message away/i.test(config.tagline);
  const lead = genericTagline
    ? `${name}${cat ? ` — ${cat}` : ''}${city ? ` in ${city}` : ''}.`
    : tagline.replace(/\.?$/, '.');
  const description = [
    lead,
    sample ? `Shop ${sample}${productNames.length > 4 ? ' & more' : ''}.` : '',
    'Order directly on WhatsApp — no app needed.',
  ].filter(Boolean).join(' ').slice(0, 300);
  const url   = `${origin}/${slug}`;
  // The owner's cover photo wins; otherwise a dynamic branded card (their
  // logo/emoji + name + brand colour, rendered by /api/og) — never the generic
  // PocketLink image, so every shared link looks shop-specific.
  const image = absImage(config.coverImage, origin) || `${origin}/api/og?slug=${encodeURIComponent(slug)}&v=${ogToken(config)}`;
  const wa    = String(config.whatsappNumber || '').replace(/\D/g, '');
  const products = Array.isArray(config.products) ? config.products.slice(0, 40) : [];

  const ld = {
    '@context': 'https://schema.org',
    '@type': TYPE_SCHEMA[config.businessType] || 'LocalBusiness',
    name,
    description,
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
export function marketplaceSeo(stores, origin, storeOrigin = origin) {
  const n = stores.length;
  const title = 'Discover Local Businesses Near You | PocketLink Marketplace';
  const description = `Browse ${n ? `${n}+ ` : ''}local shops, restaurants, salons and services near you and order directly on WhatsApp. No app, no login, 0% commission.`;
  // On the consumer subdomain the marketplace lives at the root.
  const url = origin.includes('//market.') ? `${origin}/` : `${origin}/marketplace`;
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
        url: `${storeOrigin}/${s.slug}`,
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

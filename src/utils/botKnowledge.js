import { formatINR } from './currency';

/**
 * WhatsApp AI Knowledge document generator.
 *
 * Turns a store's live PocketLink config (store info + every product) into a
 * clean, factual, AI-retrieval-friendly PLAIN-TEXT document the seller can
 * download and upload into Meta / WhatsApp Business AI ("AI knowledge").
 *
 * Design notes (see the CTO notes in the PR):
 *  • Plain text (.txt), not a marketing brochure or PDF — optimised for an LLM
 *    knowledge base, which retrieves text, not layout.
 *  • Images are included as their hosted URLs, never embedded. Un-uploaded
 *    base64 `data:` images are skipped (huge + useless to a text knowledge base).
 *  • Product links use PocketLink's REAL per-product route: /{slug}/p/{id}.
 *  • Missing fields are OMITTED — nothing is invented.
 *  • Pure + modular: `buildKnowledgeDoc(config)` returns a string, so a future
 *    Meta-API sync layer can reuse the exact same builder.
 */

export const STORE_ORIGIN = 'https://www.pocketlink.store';

export const storeUrl   = (slug) => `${STORE_ORIGIN}/${slug}`;
export const productUrl = (slug, id) => `${STORE_ORIGIN}/${slug}/p/${id}`;

const isHttpUrl = (s) => typeof s === 'string' && /^https?:\/\//i.test(s.trim());
const clean     = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
// Descriptions can be multi-line — keep line breaks but trim trailing space.
const cleanBlock = (s) => String(s ?? '').replace(/[ \t]+\n/g, '\n').trim();

function availability(p) {
  if (p.inStock === false) return 'Out of stock';
  const s = p.stock;
  if (s !== '' && s != null && Number.isFinite(Number(s))) {
    const n = Number(s);
    if (n <= 0) return 'Out of stock';
    if (n <= 5) return `In stock (only ${n} left)`;
  }
  return 'In stock';
}

// All usable (http) image URLs for a product: primary first, then gallery.
function imageUrls(p) {
  const all = [p.image, ...(Array.isArray(p.images) ? p.images : [])];
  return [...new Set(all.filter(isHttpUrl).map((u) => u.trim()))];
}

function priceLine(p) {
  const price = Number(p.price) || 0;
  const mrp   = Number(p.mrp) || 0;
  if (mrp > price) return `${formatINR(price)}  (MRP ${formatINR(mrp)})`;
  return formatINR(price);
}

// Priced variants (Size/Weight…) → "Small: ₹120, Large: ₹200".
function variantLine(p) {
  const v = p.variants;
  if (!v || !v.label || !Array.isArray(v.options) || !v.options.length) return '';
  const parts = v.options
    .filter((o) => o && clean(o.name))
    .map((o) => (o.price != null && o.price !== '' ? `${clean(o.name)}: ${formatINR(Number(o.price))}` : clean(o.name)));
  return parts.length ? `${clean(v.label)} — ${parts.join(', ')}` : '';
}

// Extra choice types (Colour, Pack…) with optional +₹ add-ons.
function extrasLines(p) {
  const groups = Array.isArray(p.variantExtras) ? p.variantExtras : [];
  return groups
    .filter((g) => g && clean(g.label) && Array.isArray(g.options) && g.options.length)
    .map((g) => {
      const opts = g.options
        .filter((o) => o && clean(o.name))
        .map((o) => (Number(o.addPrice) > 0 ? `${clean(o.name)} (+${formatINR(Number(o.addPrice))})` : clean(o.name)));
      return opts.length ? `${clean(g.label)} — ${opts.join(', ')}` : '';
    })
    .filter(Boolean);
}

// Descriptive attributes → "Weight: 250 g; Type: Veg".
function detailsLine(p) {
  const attrs = Array.isArray(p.attributes) ? p.attributes.filter((a) => a && clean(a.value)) : [];
  if (!attrs.length) return '';
  return attrs.map((a) => `${clean(a.label || a.key)}: ${clean(a.value)}`).join('; ');
}

// Plain label only — no decorative emoji (keep the doc factual for retrieval).
function categoryLabel(config, p) {
  const cat = (config.categories || []).find((c) => c.id === p.category);
  return cat ? clean(cat.label) : '';
}

// "+91 9175187668" from any stored form.
function prettyPhone(raw) {
  const wa = String(raw || '').replace(/\D/g, '');
  if (!wa) return '';
  const last10 = wa.slice(-10);
  return `+91 ${last10}`;
}

// ── Store header block ────────────────────────────────────────────────────────
function storeBlock(config) {
  const slug = config.slug;
  const lines = ['=================================', 'STORE INFORMATION', '================================='];
  const push = (label, val) => { const v = clean(val); if (v) lines.push(`${label}: ${v}`); };

  push('Store Name', config.businessName || config.name);
  if (clean(config.tagline)) lines.push(`About: ${clean(config.tagline)}`);
  lines.push(`Website: ${storeUrl(slug)}`);

  const wa = prettyPhone(config.whatsappNumber);
  if (wa) lines.push(`WhatsApp / Contact: ${wa}`);

  const place = [config.address, config.area, config.state].map(clean).filter(Boolean).join(', ');
  if (place) lines.push(`Location: ${place}`);
  if (clean(config.gst)) lines.push(`GSTIN: ${clean(config.gst)}`);

  const cats = (config.categories || []).filter((c) => c.id !== 'all').map((c) => clean(c.label)).filter(Boolean);
  if (cats.length) lines.push(`Product categories: ${cats.join(', ')}`);

  // Ordering / customer-service info (factual, from config only).
  lines.push('', 'HOW TO ORDER:');
  lines.push(`- Open the store link (${storeUrl(slug)}), choose products, and tap "Order on WhatsApp".`);
  if (wa) lines.push(`- Or message the shop on WhatsApp at ${wa}.`);
  const estimate = clean(config.cart?.deliveryEstimate);
  if (estimate) lines.push(`- Typical delivery time: ${estimate}.`);
  const freeAbove = Number(config.cart?.freeShippingAbove);
  if (freeAbove > 0) lines.push(`- Free delivery on orders above ${formatINR(freeAbove)}.`);

  return lines.join('\n');
}

// ── One product block ─────────────────────────────────────────────────────────
function productBlock(config, p, index) {
  const slug = config.slug;
  const lines = [`PRODUCT ${index}`];
  const push = (label, val) => { const v = clean(val); if (v) lines.push(`${label}: ${v}`); };

  push('Name', p.name);
  lines.push(`Price: ${priceLine(p)}`);
  push('Unit / Pack', p.unit);
  push('Category', categoryLabel(config, p));
  lines.push(`Availability: ${availability(p)}`);

  const desc = cleanBlock(p.description);
  if (desc) lines.push(`Description: ${desc}`);

  const variants = variantLine(p);
  if (variants) lines.push(`Options: ${variants}`);
  extrasLines(p).forEach((l) => lines.push(`Choice — ${l}`));

  const details = detailsLine(p);
  if (details) lines.push(`Details: ${details}`);

  const imgs = imageUrls(p);
  if (imgs.length) {
    lines.push(`Image: ${imgs[0]}`);
    if (imgs.length > 1) lines.push(`More images: ${imgs.slice(1).join(', ')}`);
  }

  lines.push(`Product link: ${productUrl(slug, p.id)}`);
  return lines.join('\n');
}

/**
 * Build the full knowledge document (plain text) from a store config.
 * Always reflects the CURRENT config passed in — regenerate any time.
 */
export function buildKnowledgeDoc(config = {}) {
  const products = Array.isArray(config.products) ? config.products.filter((p) => p && clean(p.name)) : [];
  const name = clean(config.businessName || config.name) || 'This store';
  const now = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

  const header = [
    `WHATSAPP AI KNOWLEDGE — ${name}`,
    `Source: PocketLink. Generated ${now}.`,
    `This document lists the store's details and every product so an AI assistant can answer customer questions accurately. Prices and availability are correct as of generation; regenerate when products change.`,
  ].join('\n');

  const productsHeader = ['=================================', `PRODUCTS (${products.length} item${products.length === 1 ? '' : 's'})`, '================================='].join('\n');
  const productBlocks = products.map((p, i) => productBlock(config, p, i + 1)).join('\n\n----------\n\n');

  return [
    header,
    storeBlock(config),
    productsHeader,
    products.length ? productBlocks : 'No products have been added to this store yet.',
    `--- End of knowledge document · ${products.length} product${products.length === 1 ? '' : 's'} ---`,
  ].join('\n\n');
}

/** A quick, honest quality summary for the UI (helps the seller improve the doc). */
export function knowledgeSummary(config = {}) {
  const products = Array.isArray(config.products) ? config.products.filter((p) => p && clean(p.name)) : [];
  return {
    products:           products.length,
    withImage:          products.filter((p) => imageUrls(p).length > 0).length,
    missingDescription: products.filter((p) => !cleanBlock(p.description)).length,
  };
}

export function knowledgeFilename(config = {}) {
  const slug = clean(config.slug) || 'store';
  return `${slug}-whatsapp-ai-knowledge.txt`;
}

/** Build + download the document as a .txt file (browser only). */
export function downloadKnowledgeDoc(config = {}) {
  const text = buildKnowledgeDoc(config);
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = knowledgeFilename(config);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return text;
}

import { formatINR } from './currency';
import { paragraphsToDocxBlob } from './docxWriter';

/**
 * WhatsApp AI Knowledge document generator.
 *
 * Turns a store's live PocketLink config (store info + every product) into a
 * factual, AI-retrieval-friendly knowledge document the seller downloads and
 * uploads into Meta / WhatsApp Business AI ("AI knowledge").
 *
 * Output is a real Word **.docx** (via docxWriter) — Meta's knowledge upload
 * rejects plain .txt, and a .docx is UTF-8 so ₹, Marathi/Devanagari and emoji
 * all survive (a dependency-free PDF can't render those). We build structured
 * paragraphs once, then derive BOTH the .docx (download) and a plain-text form
 * (Preview / Copy) from them.
 *
 * Design notes (CTO):
 *  • Images = hosted URLs, never embedded; un-uploaded base64 `data:` images are
 *    skipped (useless + huge in a knowledge base).
 *  • Product links use PocketLink's REAL per-product route: /{slug}/p/{id}.
 *  • Missing fields are OMITTED — nothing invented.
 *  • Pure + modular: `knowledgeParas(config)` is the single source of truth, so a
 *    future Meta-API sync layer can reuse it.
 */

export const STORE_ORIGIN = 'https://www.pocketlink.store';
export const storeUrl   = (slug) => `${STORE_ORIGIN}/${slug}`;
export const productUrl = (slug, id) => `${STORE_ORIGIN}/${slug}/p/${id}`;

// Font sizes in half-points (22 = 11pt).
const SZ = { title: 34, meta: 18, section: 26, product: 24, body: 21 };

const isHttpUrl = (s) => typeof s === 'string' && /^https?:\/\//i.test(s.trim());
const clean      = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
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

function imageUrls(p) {
  const all = [p.image, ...(Array.isArray(p.images) ? p.images : [])];
  return [...new Set(all.filter(isHttpUrl).map((u) => u.trim()))];
}

function priceLine(p) {
  const price = Number(p.price) || 0;
  const mrp   = Number(p.mrp) || 0;
  return mrp > price ? `${formatINR(price)}  (MRP ${formatINR(mrp)})` : formatINR(price);
}

function variantLine(p) {
  const v = p.variants;
  if (!v || !v.label || !Array.isArray(v.options) || !v.options.length) return '';
  const parts = v.options
    .filter((o) => o && clean(o.name))
    .map((o) => (o.price != null && o.price !== '' ? `${clean(o.name)}: ${formatINR(Number(o.price))}` : clean(o.name)));
  return parts.length ? `${clean(v.label)} — ${parts.join(', ')}` : '';
}

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

function prettyPhone(raw) {
  const wa = String(raw || '').replace(/\D/g, '');
  return wa ? `+91 ${wa.slice(-10)}` : '';
}

function normalizedProducts(config) {
  return Array.isArray(config.products) ? config.products.filter((p) => p && clean(p.name)) : [];
}

// ── The single source of truth: structured paragraphs ─────────────────────────
export function knowledgeParas(config = {}) {
  const slug = config.slug;
  const products = normalizedProducts(config);
  const name = clean(config.businessName || config.name) || 'This store';
  const now = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

  const paras = [];
  const P = (text, o = {}) => paras.push({ text, size: SZ.body, ...o });
  const blank = () => paras.push({ text: '' });

  // Header
  P(`WhatsApp AI Knowledge — ${name}`, { bold: true, size: SZ.title });
  P(`Source: PocketLink. Generated ${now}.`, { size: SZ.meta });
  P('This document lists the store’s details and every product so an AI assistant can answer customer questions accurately. Prices and availability are correct as of generation; regenerate when products change.', { size: SZ.meta });
  blank();

  // Store information
  P('STORE INFORMATION', { bold: true, size: SZ.section });
  const info = (label, val) => { const v = clean(val); if (v) P(`${label}: ${v}`); };
  info('Store Name', config.businessName || config.name);
  if (clean(config.tagline)) P(`About: ${clean(config.tagline)}`);
  P(`Website: ${storeUrl(slug)}`);
  const wa = prettyPhone(config.whatsappNumber);
  if (wa) P(`WhatsApp / Contact: ${wa}`);
  const place = [config.address, config.area, config.state].map(clean).filter(Boolean).join(', ');
  if (place) P(`Location: ${place}`);
  if (clean(config.gst)) P(`GSTIN: ${clean(config.gst)}`);
  const cats = (config.categories || []).filter((c) => c.id !== 'all').map((c) => clean(c.label)).filter(Boolean);
  if (cats.length) P(`Product categories: ${cats.join(', ')}`);
  blank();

  P('HOW TO ORDER', { bold: true, size: SZ.body });
  P(`- Open the store link (${storeUrl(slug)}), choose products, and tap “Order on WhatsApp”.`);
  if (wa) P(`- Or message the shop on WhatsApp at ${wa}.`);
  const estimate = clean(config.cart?.deliveryEstimate);
  if (estimate) P(`- Typical delivery time: ${estimate}.`);
  const freeAbove = Number(config.cart?.freeShippingAbove);
  if (freeAbove > 0) P(`- Free delivery on orders above ${formatINR(freeAbove)}.`);
  blank();

  // Products
  P(`PRODUCTS (${products.length} item${products.length === 1 ? '' : 's'})`, { bold: true, size: SZ.section });
  blank();

  products.forEach((p, i) => {
    P(`PRODUCT ${i + 1}: ${clean(p.name)}`, { bold: true, size: SZ.product });
    P(`Price: ${priceLine(p)}`);
    const unit = clean(p.unit); if (unit) P(`Unit / Pack: ${unit}`);
    const cat = categoryLabel(config, p); if (cat) P(`Category: ${cat}`);
    P(`Availability: ${availability(p)}`);
    const desc = cleanBlock(p.description); if (desc) P(`Description: ${desc}`);
    const variants = variantLine(p); if (variants) P(`Options: ${variants}`);
    extrasLines(p).forEach((l) => P(`Choice — ${l}`));
    const details = detailsLine(p); if (details) P(`Details: ${details}`);
    const imgs = imageUrls(p);
    if (imgs.length) {
      P(`Image: ${imgs[0]}`);
      if (imgs.length > 1) P(`More images: ${imgs.slice(1).join(', ')}`);
    }
    P(`Product link: ${productUrl(slug, p.id)}`);
    blank();
  });

  if (!products.length) P('No products have been added to this store yet.');
  P(`— End of knowledge document · ${products.length} product${products.length === 1 ? '' : 's'} —`, { size: SZ.meta });
  return paras;
}

/** Plain-text form (for Preview / Copy) — derived from the same paragraphs. */
export function buildKnowledgeDoc(config = {}) {
  return knowledgeParas(config).map((p) => p.text).join('\n');
}

/** A quick, honest quality summary for the UI. */
export function knowledgeSummary(config = {}) {
  const products = normalizedProducts(config);
  return {
    products:           products.length,
    withImage:          products.filter((p) => imageUrls(p).length > 0).length,
    missingDescription: products.filter((p) => !cleanBlock(p.description)).length,
  };
}

export function knowledgeFilename(config = {}) {
  const slug = clean(config.slug) || 'store';
  return `${slug}-whatsapp-ai-knowledge.docx`;
}

/** Build + download the knowledge document as a Word .docx (browser only). */
export function downloadKnowledgeDoc(config = {}) {
  const blob = paragraphsToDocxBlob(knowledgeParas(config));
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = knowledgeFilename(config);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

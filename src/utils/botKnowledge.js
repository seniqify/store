import { formatINR } from './currency';
import { paragraphsToDocxBlob } from './docxWriter';

/**
 * WhatsApp AI Knowledge document generator.
 *
 * Turns a store's live PocketLink config (store info + every product) into a
 * factual knowledge document the seller downloads and uploads into Meta /
 * WhatsApp Business AI. Output is a real Word **.docx** (Meta rejects .txt) with
 * the **actual product photos embedded** — not links.
 *
 * Design notes (CTO):
 *  • Real Word doc, UTF-8 → ₹, Marathi/Devanagari and emoji all survive.
 *  • Product photos are FETCHED and embedded as image parts. If an image can't be
 *    fetched (network/CORS/unsupported type), we fall back to printing its URL so
 *    nothing is lost. Only JPEG/PNG embed (Word-reliable).
 *  • Product links use PocketLink's REAL per-product route: /{slug}/p/{id}.
 *  • Missing fields are OMITTED — nothing invented.
 *  • Pure builders + a single `collectContent(config)`, so a future Meta-API sync
 *    layer can reuse it.
 */

export const STORE_ORIGIN = 'https://www.pocketlink.store';
export const storeUrl   = (slug) => `${STORE_ORIGIN}/${slug}`;
export const productUrl = (slug, id) => `${STORE_ORIGIN}/${slug}/p/${id}`;

const SZ = { title: 34, meta: 18, section: 26, product: 24, body: 21 };

const isHttpUrl = (s) => typeof s === 'string' && /^https?:\/\//i.test(s.trim());
const isDataImg = (s) => typeof s === 'string' && /^data:image\//i.test(s.trim());
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

// Embeddable sources (hosted URLs + inline data images), primary first.
function imageSrcs(p) {
  const all = [p.image, ...(Array.isArray(p.images) ? p.images : [])];
  return [...new Set(all.filter((s) => isHttpUrl(s) || isDataImg(s)).map((s) => s.trim()))];
}
const httpImageUrl = (p) => imageSrcs(p).find(isHttpUrl) || null;

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

// ── Structured content (single source of truth) ───────────────────────────────
// Text paragraphs, plus an { image:{ src, url } } marker where each product photo
// belongs. The text/docx builders each resolve that marker their own way.
function collectContent(config = {}) {
  const slug = config.slug;
  const products = normalizedProducts(config);
  const name = clean(config.businessName || config.name) || 'This store';
  const now = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

  const items = [];
  const P = (text, o = {}) => items.push({ text, size: SZ.body, ...o });
  const blank = () => items.push({ text: '' });

  P(`WhatsApp AI Knowledge — ${name}`, { bold: true, size: SZ.title });
  P(`Source: PocketLink. Generated ${now}.`, { size: SZ.meta });
  P('This document lists the store’s details and every product so an AI assistant can answer customer questions accurately. Prices and availability are correct as of generation; regenerate when products change.', { size: SZ.meta });
  blank();

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

  P(`PRODUCTS (${products.length} item${products.length === 1 ? '' : 's'})`, { bold: true, size: SZ.section });
  blank();

  products.forEach((p, i) => {
    P(`PRODUCT ${i + 1}: ${clean(p.name)}`, { bold: true, size: SZ.product });
    const srcs = imageSrcs(p);
    if (srcs.length) items.push({ image: { src: srcs[0], url: httpImageUrl(p) } });
    P(`Price: ${priceLine(p)}`);
    const unit = clean(p.unit); if (unit) P(`Unit / Pack: ${unit}`);
    const cat = categoryLabel(config, p); if (cat) P(`Category: ${cat}`);
    P(`Availability: ${availability(p)}`);
    const desc = cleanBlock(p.description); if (desc) P(`Description: ${desc}`);
    const variants = variantLine(p); if (variants) P(`Options: ${variants}`);
    extrasLines(p).forEach((l) => P(`Choice — ${l}`));
    const details = detailsLine(p); if (details) P(`Details: ${details}`);
    P(`Product link: ${productUrl(slug, p.id)}`);
    blank();
  });

  if (!products.length) P('No products have been added to this store yet.');
  P(`— End of knowledge document · ${products.length} product${products.length === 1 ? '' : 's'} —`, { size: SZ.meta });
  return items;
}

// Text paragraphs — image markers become an "Image: <url>" line (Preview / Copy).
export function knowledgeParas(config = {}) {
  return collectContent(config).flatMap((it) => {
    if (it.image) return it.image.url ? [{ text: `Image: ${it.image.url}`, size: SZ.body }] : [];
    return [it];
  });
}

/** Plain-text form (Preview / Copy). */
export function buildKnowledgeDoc(config = {}) {
  return knowledgeParas(config).map((p) => p.text).join('\n');
}

// ── Image fetch/decode for embedding (JPEG/PNG only) ──────────────────────────
async function loadImagePart(src) {
  try {
    let bytes; let contentType = '';
    if (isDataImg(src)) {
      const comma = src.indexOf(',');
      contentType = src.slice(5, comma).split(';')[0] || '';
      const bin = atob(src.slice(comma + 1));
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } else {
      const res = await fetch(src, { mode: 'cors' });
      if (!res.ok) return null;
      bytes = new Uint8Array(await res.arrayBuffer());
      contentType = res.headers.get('content-type') || '';
    }
    let ext = /jpe?g/i.test(contentType) ? 'jpeg' : /png/i.test(contentType) ? 'png' : null;
    if (!ext) {                                   // sniff magic bytes
      if (bytes[0] === 0xFF && bytes[1] === 0xD8) ext = 'jpeg';
      else if (bytes[0] === 0x89 && bytes[1] === 0x50) ext = 'png';
    }
    if (!ext) return null;
    let w = 0; let h = 0;
    try {
      if (typeof createImageBitmap === 'function') {
        const bmp = await createImageBitmap(new Blob([bytes], { type: `image/${ext}` }));
        w = bmp.width; h = bmp.height; bmp.close && bmp.close();
      }
    } catch { /* dimensions optional */ }
    return { bytes, ext, w, h };
  } catch {
    return null;
  }
}

// Docx items — product photos fetched + embedded; failed ones fall back to text.
async function buildKnowledgeItems(config = {}) {
  const content = collectContent(config);
  const srcs = [...new Set(content.filter((it) => it.image?.src).map((it) => it.image.src))];
  const loaded = new Map();
  await Promise.all(srcs.map(async (s) => { loaded.set(s, await loadImagePart(s)); }));

  const out = [];
  for (const it of content) {
    if (it.image) {
      const part = it.image.src ? loaded.get(it.image.src) : null;
      if (part) out.push({ img: part });
      else if (it.image.url) out.push({ text: `Image: ${it.image.url}`, size: SZ.body });
    } else {
      out.push(it);
    }
  }
  return out;
}

/** A quick, honest quality summary for the UI. */
export function knowledgeSummary(config = {}) {
  const products = normalizedProducts(config);
  return {
    products:           products.length,
    withImage:          products.filter((p) => imageSrcs(p).length > 0).length,
    missingDescription: products.filter((p) => !cleanBlock(p.description)).length,
  };
}

export function knowledgeFilename(config = {}) {
  const slug = clean(config.slug) || 'store';
  return `${slug}-whatsapp-ai-knowledge.docx`;
}

/** Build (fetch + embed images) and download the .docx. Async. */
export async function downloadKnowledgeDoc(config = {}) {
  const items = await buildKnowledgeItems(config);
  const blob = paragraphsToDocxBlob(items);
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = knowledgeFilename(config);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

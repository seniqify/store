// Pixel health: does a store's Meta Pixel turn ordinary page visits into
// conversions on its own?
//
// 2026-10-24, Upahar Cookies & Cakes: Meta reported ~24 purchases against 4-5
// real orders. PocketLink sends exactly one Purchase per placed order (browser
// and Conversions API share the order id, so Meta counts it once). The extra
// ones came from a rule saved on the pixel in Meta Events Manager ("when the
// page address contains pocketlink.store/upaharcookiescakes, log a Purchase"),
// so every visit to the shop became a purchase. Nothing in the storefront can
// switch such a rule off (fbq 'autoConfig' false does not stop it, tested), so
// the shop has to delete it in Events Manager. This finds it.
//
// How: Meta serves every pixel's settings as public JavaScript at
// connect.facebook.net/signals/config/<pixel id>. Rules made in Events Manager
// arrive there as `fbq.set("estRules", "<pixel id>", [ ...rules ])`, each with
// a derived_event_name and the page-address conditions that trigger it.
// The file has no CORS headers, so this runs on the server.

/** Events that a rule must never create on a PocketLink store: they are
 *  conversions, and PocketLink already sends the real ones from the order. */
export const CONVERSION_EVENTS = Object.freeze([
  'Purchase', 'AddToCart', 'InitiateCheckout', 'AddPaymentInfo', 'Lead',
  'CompleteRegistration', 'Subscribe', 'StartTrial', 'Contact', 'Schedule', 'SubmitApplication',
]);

const CONFIG_HOST = 'https://connect.facebook.net/signals/config/';

export function cleanPixelId(v) {
  const s = String(v ?? '').trim();
  return /^\d{5,20}$/.test(s) ? s : null;
}

export function configUrl(pixelId, domain = 'www.pocketlink.store') {
  return `${CONFIG_HOST}${pixelId}?v=2.9.427&r=stable&domain=${encodeURIComponent(domain)}`;
}

/** The JSON value (array or object) that starts at text[start]. Strings are
 *  skipped whole, so a bracket inside a page address cannot end it early. */
export function jsonAt(text, start) {
  const open = text[start];
  if (open !== '[' && open !== '{') return undefined;
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, i + 1)); } catch { return undefined; }
      }
    }
  }
  return undefined;
}

/** Every rule saved on this pixel, from its config script. */
export function parseEstRules(text, pixelId) {
  const src = String(text || '');
  const out = [];
  const re = /fbq\.set\(\s*"estRules"\s*,\s*"(\d+)"\s*,\s*/g;
  let m;
  while ((m = re.exec(src))) {
    if (pixelId && m[1] !== String(pixelId)) continue;
    const rules = jsonAt(src, re.lastIndex);
    if (Array.isArray(rules)) out.push(...rules.filter((r) => r && typeof r === 'object'));
  }
  return out;
}

// Every page address a rule's condition mentions, however deeply nested.
function conditionValues(node, acc = []) {
  if (Array.isArray(node)) { for (const n of node) conditionValues(n, acc); return acc; }
  if (node && typeof node === 'object') {
    if (typeof node.value === 'string' && node.value) acc.push(node.value);
    for (const [k, v] of Object.entries(node)) if (k !== 'value') conditionValues(v, acc);
  }
  return acc;
}

/**
 * The rules that make the pixel log a conversion by itself.
 *   critical  it logs a Purchase: Meta's purchase count and the ads' learning
 *             are both wrong
 *   warning   it logs another conversion (add to cart, lead, ...)
 * Paused or deleted rules are ignored.
 */
export function findingsFrom(rules) {
  const found = [];
  for (const r of Array.isArray(rules) ? rules : []) {
    const event = String(r.derived_event_name || '');
    const status = String(r.rule_status || 'ACTIVE').toUpperCase();
    if (status !== 'ACTIVE' || !CONVERSION_EVENTS.includes(event)) continue;
    found.push({
      ruleId: r.rule_id != null ? String(r.rule_id) : null,
      event,
      severity: event === 'Purchase' ? 'critical' : 'warning',
      pages: [...new Set(conditionValues(r.condition))].slice(0, 5),
    });
  }
  return found.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'critical' ? -1 : 1));
}

/**
 * Check one pixel. Never throws.
 *   { pixelId, status: 'ok' | 'problem' | 'unknown', findings }
 * 'unknown' means Meta's file could not be read: say nothing rather than
 * guess either way.
 */
export async function checkPixel(pixelId, { fetchImpl = globalThis.fetch, timeoutMs = 10000, domain } = {}) {
  const id = cleanPixelId(pixelId);
  if (!id) return { pixelId: String(pixelId ?? ''), status: 'unknown', findings: [] };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetchImpl(configUrl(id, domain), { signal: ctrl.signal });
    if (!r.ok) return { pixelId: id, status: 'unknown', findings: [] };
    const text = await r.text();
    // A real config always registers the pixel; anything else is not one.
    if (!text.includes(`"${id}"`)) return { pixelId: id, status: 'unknown', findings: [] };
    const findings = findingsFrom(parseEstRules(text, id));
    return { pixelId: id, status: findings.length ? 'problem' : 'ok', findings };
  } catch {
    return { pixelId: id, status: 'unknown', findings: [] };
  } finally {
    clearTimeout(timer);
  }
}

/** The pixels a store's pages send to: the one the owner pasted and the one
 *  its PocketLink ads use (often the same). Mirrors initMetaPixel. */
export function storePixels(config) {
  const uses = new Map();
  const add = (v, use) => { const id = cleanPixelId(v); if (id) uses.set(id, [...(uses.get(id) || []), use]); };
  add(config?.metaPixelId, 'storefront');
  add(config?.meta?.pixelId, 'ads');
  return [...uses.entries()].map(([pixelId, used]) => ({ pixelId, used }));
}

/** Check several pixels, a few at a time, each once. */
export async function checkPixels(ids, opts = {}) {
  const unique = [...new Set(ids.map(cleanPixelId).filter(Boolean))];
  const results = new Map();
  let next = 0;
  const worker = async () => {
    while (next < unique.length) {
      const id = unique[next++];
      results.set(id, await checkPixel(id, opts));
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, unique.length) }, worker));
  return results;
}

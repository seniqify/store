/**
 * similarProducts — when a shopper's search/question finds no exact product in
 * THIS store, surface the closest things the store DOES sell (instead of a dead
 * "No products found"). Pure and dependency-free so it's easy to test.
 *
 * Scoring is deliberately simple and generous: a shared word in the name is the
 * strongest signal, then category, then description, with a light substring
 * fallback ("protein" ↔ "proteins"). Anything scoring 0 is genuinely unrelated
 * and is dropped — better an empty list (→ marketplace nudge) than random items.
 */

// Words that carry no product meaning — dropped from both query and product text.
const STOP = new Set([
  'the','and','for','you','your','have','has','had','any','some','with','that','this',
  'are','can','could','would','get','got','buy','want','need','looking','under','over',
  'below','above','less','more','than','price','cost','near','nearby','store','shop',
  'please','kindly','give','show','find','tell','about','available','stock','sell',
  'me','my','is','it','of','to','in','on','do','does','did','how','much','what','which',
  'there','here','also','like','best','good','cheap','new','other','something','anything',
]);

function stem(t) {
  // Strip a trailing plural "s" (applied to both query and product tokens, so
  // "bars" ↔ "bar" and "oats" ↔ "oat" still match consistently).
  return t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t;
}

export function tokenize(s) {
  return String(s || '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 3 && !STOP.has(t))
    .map(stem);
}

/**
 * @param {string}   query     — the raw search text / question
 * @param {object[]} products  — this store's products
 * @param {object}   opts      — { limit=4, exclude=[] } (exclude = already-shown products)
 * @returns {object[]} closest products, most relevant first (may be empty)
 */
export function similarProducts(query, products = [], { limit = 4, exclude = [] } = {}) {
  const qTokens = new Set(tokenize(query));
  if (!qTokens.size) return [];

  const excludeIds = new Set((exclude || []).map((p) => p && p.id));

  const scored = [];
  for (const p of products || []) {
    if (!p || excludeIds.has(p.id)) continue;

    const nameTokens = new Set(tokenize(p.name));
    const catTokens  = new Set(tokenize(p.category));
    const descTokens = new Set(tokenize(p.description));

    let score = 0;
    for (const t of qTokens) {
      if (nameTokens.has(t))       score += 3;
      else if (catTokens.has(t))   score += 2;
      else if (descTokens.has(t))  score += 1;
      else {
        // Light substring fuzz: "chocolate" ↔ "choco", "bar" ↔ "bars".
        for (const nt of nameTokens) {
          if (nt.length >= 4 && (nt.includes(t) || t.includes(nt))) { score += 1.5; break; }
        }
      }
    }

    if (score > 0) scored.push({ p, score, inStock: p.inStock !== false });
  }

  scored.sort((a, b) => (b.score - a.score) || (Number(b.inStock) - Number(a.inStock)));
  return scored.slice(0, limit).map((s) => s.p);
}

// The packed weight of an order, from the weights saved on its products, for
// courier booking (couriers charge by weight). PURE: no React, no network.
//
//   product.weight          grams, the product as packed (pouch or box included)
//   variant option .weight  grams for that size or flavour; wins over the product's
//   store box weight        grams for the outer box, added once per order
//
// Rules, so the courier charge is right and existing shops are not surprised:
//   - every line weighed     exact sum + box
//   - some lines weighed     sum of the weighed lines + box; the others are listed
//                            in `missing` so the booking can say so
//   - nothing weighed        the old 500 g default for the whole parcel, as before

export const DEFAULT_PARCEL_G = 500;

const grams = (v) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** The product an order line refers to: by id first, then by name. */
function productFor(item, products) {
  const list = Array.isArray(products) ? products : [];
  const id = item?.productId ?? item?.id;
  return (id != null && list.find((p) => p && String(p.id) === String(id)))
    || list.find((p) => p && item?.name && p.name === item.name)
    || null;
}

/** Grams for one unit of an order line, or 0 when nobody has weighed it. */
export function lineUnitWeight(item, products) {
  const p = productFor(item, products);
  if (!p) return 0;
  const pick = item?.variant || item?.size;
  const opt = pick && Array.isArray(p.variants?.options)
    ? p.variants.options.find((o) => o && o.name === pick)
    : null;
  return grams(opt?.weight) || grams(p.weight);
}

/**
 * @returns {{ grams: number, weighed: boolean, partial: boolean, missing: string[], parts: Array<{name, qty, unitG}>, boxG: number }}
 *   weighed  every line has a weight (the total is exact)
 *   partial  some lines have one; `missing` names the rest
 */
export function orderWeight(items, products, { boxG = 0 } = {}) {
  const lines = (Array.isArray(items) ? items : []).filter(Boolean);
  const box = grams(boxG);
  const parts = [];
  const missing = [];
  let sum = 0;
  for (const it of lines) {
    const qty = Math.max(1, Math.round(Number(it.qty) || 1));
    const unitG = lineUnitWeight(it, products);
    if (unitG) { sum += unitG * qty; parts.push({ name: it.name || 'Item', qty, unitG }); }
    else missing.push(it.name || 'Item');
  }
  if (!parts.length) {
    return { grams: DEFAULT_PARCEL_G, weighed: false, partial: false, missing, parts, boxG: 0 };
  }
  return { grams: sum + box, weighed: missing.length === 0, partial: missing.length > 0, missing, parts, boxG: box };
}

/** "3 × 550 g + box 50 g" — how the total was worked out, for the booking screen. */
export function weightBreakdown(w) {
  if (!w || !w.parts?.length) return '';
  const bits = w.parts.map((p) => `${p.qty > 1 ? `${p.qty} × ` : ''}${p.unitG.toLocaleString('en-IN')} g`);
  if (w.boxG) bits.push(`box ${w.boxG.toLocaleString('en-IN')} g`);
  return bits.join(' + ');
}

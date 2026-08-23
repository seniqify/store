/**
 * variants — helpers for a product's option types.
 *
 * A product can have TWO layers of options:
 *   1. `product.variants`  — the ONE price-driving type (label + options, each
 *      with its own price/mrp/photo). Unchanged legacy shape; the customer's
 *      pick sets the base line price + swaps the photo.
 *   2. `product.variantExtras` — additional CHOICE types (Colour, Weight, Pack…),
 *      each option an optional `+₹` add-on. These don't set the base price; they
 *      only add to it. Shape: [{ label, options: [{ name, addPrice }] }].
 *
 * Keeping the two separate means the existing sale/offer + image-upload
 * pipelines (which only know `variants`) keep working untouched.
 */

/** Extra choice groups on a product, filtered to the well-formed ones. */
export function variantExtrasOf(product) {
  const groups = product?.variantExtras;
  if (!Array.isArray(groups)) return [];
  return groups.filter(
    (g) => g && g.label && Array.isArray(g.options) && g.options.some((o) => o && o.name),
  );
}

/** True when a product has any selectable option (price-driving or extra). */
export function hasAnyOptions(product) {
  const hasPriceVariant = !!(product?.variants?.options && product.variants.options.length);
  return hasPriceVariant || variantExtrasOf(product).length > 0;
}

/**
 * The buying cost of ONE unit of an ordered item, for profit maths. When the
 * product has priced variants, each option carries its OWN cost (a 250g pack
 * costs less than a 1kg pack), so we resolve the cost of the specific option the
 * customer picked — falling back to the product's base cost. Returns a positive
 * number, or null when no usable cost is set (so callers can treat it as
 * "uncovered" instead of counting it as pure profit).
 *   product — the catalog product (from config.products)
 *   item    — the ordered line (its `variantSelections`/`variant` names the pick)
 */
export function unitCostForItem(product, item) {
  if (!product) return null;
  const opts = product.variants?.options;
  if (Array.isArray(opts) && opts.length) {
    // The price-driving pick is the FIRST selection (see resolveSelection).
    const pickName = item?.variantSelections?.[0]?.name
      ?? (typeof item?.variant === 'string' ? item.variant.split(',')[0].trim() : null);
    const opt = pickName ? opts.find((o) => o && o.name === pickName) : null;
    const oc = Number(opt?.cost);
    if (Number.isFinite(oc) && oc > 0) return oc;
  }
  const bc = Number(product?.cost);
  return Number.isFinite(bc) && bc > 0 ? bc : null;
}

/** True when a product has any usable cost — a base cost or any variant cost. */
export function hasAnyCost(product) {
  const bc = Number(product?.cost);
  if (Number.isFinite(bc) && bc > 0) return true;
  const opts = product?.variants?.options;
  return Array.isArray(opts) && opts.some((o) => { const c = Number(o?.cost); return Number.isFinite(c) && c > 0; });
}

/**
 * Resolve the effective price / MRP / image and a human-readable list of picks
 * for a product, given the chosen price-variant option name and the chosen
 * extra-option names (one per extra group, in order).
 * Returns { price, mrp, image, picks: [{ label, name }] }.
 */
export function resolveSelection(product, selVariantName, selExtraNames = []) {
  const variants = product?.variants;
  const hasPriceVariant = !!(variants && variants.options && variants.options.length);
  const vOpt = hasPriceVariant
    ? variants.options.find((o) => o.name === selVariantName) || variants.options[0]
    : null;

  // Base from the price-driving variant (fallback to the product's own values).
  let price = vOpt && vOpt.price != null ? vOpt.price : product.price;
  let mrp   = vOpt ? (vOpt.mrp != null ? vOpt.mrp : null) : (product.mrp ?? null);
  let image = vOpt && vOpt.image ? vOpt.image : product.image;

  const picks = [];
  if (vOpt) picks.push({ label: variants.label || 'Options', name: vOpt.name });

  // Extras add their +₹ on top; a set MRP tracks the add-on so the strike-through
  // stays consistent with the shown price.
  variantExtrasOf(product).forEach((g, i) => {
    const opts = g.options.filter((o) => o && o.name);
    const opt = opts.find((o) => o.name === selExtraNames[i]) || opts[0];
    if (!opt) return;
    picks.push({ label: g.label, name: opt.name });
    const add = Number(opt.addPrice) || 0;
    if (add) {
      price += add;
      if (mrp != null) mrp += add;
    }
  });

  return { price, mrp, image, picks };
}

/**
 * Build the cart line for a product + its chosen options — the single shape both
 * the product card and the product page add to the cart. Encodes every pick into
 * the id (so each combo is its own line) and carries a readable `variant` string
 * (for WhatsApp / slip / order) plus structured `variantSelections` (for chips).
 * With no options selected, returns the plain product.
 */
export function buildCartItem(product, selVariantName, selExtraNames = []) {
  const { price, mrp, image, picks } = resolveSelection(product, selVariantName, selExtraNames);
  if (!picks.length) return { ...product };
  return {
    ...product,
    id:               `${product.id}::${picks.map((p) => p.name).join('::')}`,
    variant:          picks.map((p) => p.name).join(', '),
    variantLabel:     picks.length === 1 ? picks[0].label : undefined,
    variantSelections: picks,
    image,
    price,
    mrp: mrp != null ? mrp : undefined,
  };
}

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

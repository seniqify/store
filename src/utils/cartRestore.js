/**
 * Cart restore — what the reminder link (/cart/<token>) does.
 *
 * The link's page asks get_cart_reminder for the shop and the items that were
 * in the cart, leaves them here for that shop's page (sessionStorage, ten
 * minutes), and opens the shop. The shop page then rebuilds each line from its
 * CURRENT catalogue — today's price and sale, the same line shape the product
 * card adds — and opens the cart.
 *
 * A saved item is left out, never guessed, when the product is gone or out of
 * stock, or the option the customer picked no longer exists.
 *
 * Pure apart from the storage it is handed, so it is tested directly.
 */
import { buildCartItem, hasAnyOptions } from './variants.js';

const KEY = 'pl_cart_restore_v1';
const TTL_MS = 10 * 60 * 1000;
const MAX_QTY = 99;

function stockOf(product) {
  const n = Number(product?.stock);
  return product?.stock != null && product.stock !== '' && Number.isFinite(n) ? n : null;
}

/**
 * @param {Array<object>} products  the shop's products as the grid shows them (offers applied)
 * @param {Array<object>} items     saved lines: { productId, qty, variant }
 * @returns {{ lines: Array<{ line: object, qty: number }>, missing: number }}
 */
export function restoreCartLines(products, items) {
  const list = Array.isArray(products) ? products : [];
  const lines = [];
  let missing = 0;
  for (const item of Array.isArray(items) ? items : []) {
    const product = list.find((p) => p && String(p.id) === String(item?.productId ?? ''));
    const stock = product ? stockOf(product) : null;
    if (!product || product.inStock === false || (stock !== null && stock <= 0)) { missing += 1; continue; }

    const picked = String(item?.variant || '').trim();
    let line;
    if (picked) {
      const names = picked.split(', ');
      line = buildCartItem(product, names[0], names.slice(1));
      // resolveSelection falls back to the first option when a name is gone;
      // a different option than the customer chose is not "their" cart.
      if (line.variant !== picked) { missing += 1; continue; }
    } else {
      if (hasAnyOptions(product)) { missing += 1; continue; }   // options added since: we can't know their pick
      line = { ...product };
    }

    let qty = Math.trunc(Number(item?.qty));
    qty = Number.isFinite(qty) && qty > 0 ? Math.min(qty, MAX_QTY) : 1;
    if (stock !== null) qty = Math.min(qty, stock);
    lines.push({ line, qty });
  }
  return { lines, missing };
}

/** Leave the items for this shop's page to pick up. Never throws. */
export function saveRestoreIntent(slug, items, storage = globalThis.sessionStorage, now = Date.now()) {
  try {
    storage?.setItem(KEY, JSON.stringify({ slug, items: Array.isArray(items) ? items : [], at: now }));
  } catch { /* storage blocked — the shop still opens, just with an empty cart */ }
}

/** Take (and clear) the items left for THIS shop, if fresh. Null otherwise. */
export function takeRestoreIntent(slug, storage = globalThis.sessionStorage, now = Date.now()) {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return null;
    const intent = JSON.parse(raw);
    if (!intent || intent.slug !== slug) return null;   // another shop's: leave it alone
    storage.removeItem(KEY);
    if (!(now - Number(intent.at) <= TTL_MS)) return null;
    return Array.isArray(intent.items) ? intent.items : null;
  } catch {
    return null;
  }
}

// Order tracking: can this store's ads be set to find ORDERS?
//
// Meta optimises an orders campaign on a pixel, and it only accepts a pixel the
// selected ad account can use. The storefront (browser) and meta-capi (server)
// send each order's Purchase event to the store's ads pixel, config.meta.pixelId,
// so that pixel must be one of the ad account's. These helpers read that state
// and, when the merchant asks, fix it: keep the store's pixel if the ad account can
// use it, use the ad account's own pixel, or create one in the ad account.
// They never touch campaigns and never spend.
import { graphGet, getMetaAccount, getStoreConfig, resolveAdAccount } from './_meta.js';

const GRAPH = 'https://graph.facebook.com/v25.0';
const digits = (v) => String(v ?? '').replace(/\D/g, '');

/** The pixel this store's campaigns and server Purchase events use. */
export function storePixelId(config) {
  return digits(config?.meta?.pixelId) || digits(config?.metaPixelId) || null;
}

/** Whether the storefront's Meta Pixel ID field is empty or holds PocketLink's ads
 *  pixel, so PocketLink may set it. A pixel the owner added themselves stays. */
export function storefrontPixelIsPocketLinks(config) {
  const own = digits(config?.metaPixelId);
  return !own || own === digits(config?.meta?.pixelId);
}

/**
 * Pixels the ad account can use, most recently active first.
 * → { pixels: [{ id, name, lastFiredAt }] } | { error: 'reauth' | 'unreadable' }
 */
export async function accountPixels(adAccount, token) {
  const r = await graphGet(`${adAccount}/adspixels`, { fields: 'id,name,last_fired_time', limit: '100', access_token: token });
  if (Number(r?.body?.error?.code) === 190) return { error: 'reauth' };
  // Only a complete list can show that a pixel is missing.
  if (!Array.isArray(r?.body?.data) || r.body.paging?.next) return { error: 'unreadable' };
  const pixels = r.body.data.filter((p) => digits(p?.id)).map((p) => ({
    id: digits(p.id), name: p.name || 'Meta pixel', lastFiredAt: p.last_fired_time || null,
  }));
  pixels.sort((a, b) => (Date.parse(b.lastFiredAt || '') || 0) - (Date.parse(a.lastFiredAt || '') || 0));
  return { pixels };
}

/**
 * What the Ads screen shows.
 *   ready           the store's pixel is one the ad account can use
 *   not_on_account  the ad account has pixels, but not the store's
 *   no_pixel        the ad account has no pixel yet
 *   unknown         Meta did not list the ad account's pixels
 * → { status, pixelId, pixel, accountPixels, storefrontPixelId }
 */
export function trackingStatus(config, listed) {
  const pixelId = storePixelId(config);
  const storefrontPixelId = digits(config?.metaPixelId) || null;
  if (!listed || listed.error) return { status: 'unknown', pixelId, pixel: null, accountPixels: [], storefrontPixelId };
  const pixel = listed.pixels.find((p) => p.id === pixelId) || null;
  const status = pixel ? 'ready' : listed.pixels.length ? 'not_on_account' : 'no_pixel';
  return { status, pixelId, pixel, accountPixels: listed.pixels, storefrontPixelId };
}

/**
 * At connect: a pixel the store's ad account can use — the ad account the store
 * already advertises from, or the only one shared. The store's current pixel is
 * kept when it qualifies; otherwise the ad account's most recently active pixel.
 * → pixel id, or null (no single ad account, no pixel, or Meta would not say)
 */
export async function pixelForConnect({ slug, token, adAccountIds }) {
  const [prior, config] = await Promise.all([getMetaAccount(slug), getStoreConfig(slug)]);
  const picked = resolveAdAccount({ ad_account_ids: adAccountIds, selected_ad_account_id: prior?.selected_ad_account_id });
  if (!picked.adAccount) return null;
  const listed = await accountPixels(picked.adAccount, token);
  if (listed.error || !listed.pixels.length) return null;
  return (listed.pixels.find((p) => p.id === storePixelId(config)) || listed.pixels[0]).id;
}

async function createPixel(adAccount, name, token) {
  try {
    const r = await fetch(`${GRAPH}/${adAccount}/adspixels`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, access_token: token }),
    });
    const body = await r.json().catch(() => ({}));
    return r.ok && digits(body?.id) ? { id: digits(body.id) } : { error: body?.error || { message: `HTTP ${r.status}` } };
  } catch (e) {
    return { error: { message: e.message } };
  }
}

/**
 * Make the store's ads pixel one the ad account can use.
 *   pixelId given → it must be one of the ad account's pixels
 *   otherwise     → the store's pixel if the ad account can use it, else the ad
 *                   account's only pixel; with several the merchant chooses; with
 *                   none, one is created in the ad account, named after the store.
 * → { ok: true, pixel, created } | { error, accountPixels?, message? }
 */
export async function ensureOrderPixel({ adAccount, token, config, pixelId: requested }) {
  const listed = await accountPixels(adAccount, token);
  if (listed.error) return { error: listed.error === 'reauth' ? 'reauth' : 'pixels_unreadable' };
  const { pixels } = listed;

  const want = digits(requested);
  if (want) {
    const hit = pixels.find((p) => p.id === want);
    return hit ? { ok: true, pixel: hit, created: false } : { error: 'pixel_not_on_account', accountPixels: pixels };
  }
  const current = pixels.find((p) => p.id === storePixelId(config));
  if (current) return { ok: true, pixel: current, created: false };
  if (pixels.length === 1) return { ok: true, pixel: pixels[0], created: false };
  if (pixels.length > 1) return { error: 'choose_pixel', accountPixels: pixels };

  const name = `${String(config?.businessName || 'Store').trim().slice(0, 40)} · PocketLink`;
  const made = await createPixel(adAccount, name, token);
  if (made.id) return { ok: true, pixel: { id: made.id, name, lastFiredAt: null }, created: true };
  if (Number(made.error?.code) === 190) return { error: 'reauth' };
  // 6200 / 6202: the ad account already has a pixel (made elsewhere meanwhile).
  if ([6200, 6202].includes(Number(made.error?.code))) {
    const again = await accountPixels(adAccount, token);
    if (!again.error && again.pixels.length === 1) return { ok: true, pixel: again.pixels[0], created: false };
    if (!again.error && again.pixels.length > 1) return { error: 'choose_pixel', accountPixels: again.pixels };
  }
  return { error: 'pixel_create_failed', message: String(made.error?.error_user_msg || made.error?.message || '').slice(0, 300) };
}

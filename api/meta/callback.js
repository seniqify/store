// GET /api/meta/callback  — Meta redirects the seller here after they authorize
// (or cancel). Runs SERVER-SIDE ONLY: verifies the signed state, exchanges the
// auth code for a long-lived access token, identifies the seller's Business
// Portfolio (+ ad accounts and granted scopes), stores everything in the
// RLS-locked store_meta_accounts table (service role), mirrors a public-safe
// summary onto stores.config.meta (never the token), and redirects the seller
// back to Manage with a result flag. The App Secret and access token never reach
// the browser.
import {
  APP_ID, REDIRECT_URI, APP_ORIGIN,
  appSecret, serviceKey, verifyState, graphGet,
  upsertMetaAccount, getStoreConfig, patchStoreConfig,
} from './_meta.js';

// Redirect back to the store's Manage page (or home if we can't trust the slug).
function back(res, slug, params) {
  const qs   = new URLSearchParams(params).toString();
  const dest = slug ? `${APP_ORIGIN}/${slug}/manage?${qs}` : `${APP_ORIGIN}/?${qs}`;
  res.setHeader('Location', dest);
  res.status(302).end();
}

export default async function handler(req, res) {
  const q = req.query || {};
  const verified = verifyState(String(q.state || ''));
  const slug = verified?.slug || '';

  // 1) Seller cancelled or denied on Meta's screen (state is still returned, so
  //    we can route them back to the right store's Manage page).
  if (q.error) return back(res, slug, { meta: 'error', reason: 'denied' });

  // 2) Server misconfiguration — never proceed without the secrets.
  if (!appSecret() || !serviceKey()) return back(res, slug, { meta: 'error', reason: 'config' });

  // 3) Tampered / expired state → we can't trust the slug; send home.
  if (!verified) return back(res, '', { meta: 'error', reason: 'state' });

  const code = String(q.code || '');
  if (!code) return back(res, slug, { meta: 'error', reason: 'nocode' });

  try {
    // 4) code → short-lived token.
    const short = await graphGet('oauth/access_token', {
      client_id: APP_ID, redirect_uri: REDIRECT_URI, client_secret: appSecret(), code,
    });
    if (!short.ok || !short.body?.access_token) return back(res, slug, { meta: 'error', reason: 'exchange' });

    // 5) short → long-lived token.
    const long = await graphGet('oauth/access_token', {
      grant_type: 'fb_exchange_token', client_id: APP_ID, client_secret: appSecret(),
      fb_exchange_token: short.body.access_token,
    });
    const token     = long.body?.access_token || short.body.access_token;
    const expiresIn = Number(long.body?.expires_in || short.body?.expires_in || 0);
    const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null;

    // 6) Granted scopes, ad accounts, and Business Portfolio.
    const [biz, ads, perms] = await Promise.all([
      graphGet('me/businesses',  { fields: 'id,name', access_token: token }),
      graphGet('me/adaccounts',  { fields: 'id,account_id,name', access_token: token }),
      graphGet('me/permissions', { access_token: token }),
    ]);
    let business       = biz.body?.data?.[0] || null;
    const adAccountIds = Array.isArray(ads.body?.data)  ? ads.body.data.map((a) => a.id).filter(Boolean) : [];
    const scopes       = Array.isArray(perms.body?.data)
      ? perms.body.data.filter((p) => p.status === 'granted').map((p) => p.permission)
      : [];

    // From the (first) shared ad account: backfill the Business Portfolio when
    // /me/businesses is empty, and pick up the Pixel the seller shared so we can
    // auto-fill their storefront Meta Pixel ID (pixel IDs are public, not secret).
    let pixelId = null;
    const firstAd = adAccountIds[0];
    if (firstAd) {
      const [acct, pixels] = await Promise.all([
        graphGet(firstAd, { fields: 'business{id,name}', access_token: token }),
        graphGet(`${firstAd}/adspixels`, { fields: 'id,name', access_token: token }),
      ]);
      const b = acct.body?.business;
      if (!business && b?.id) business = { id: b.id, name: b.name };
      pixelId = pixels.body?.data?.[0]?.id || null;
    }

    // 7) Store server-side (RLS-locked; service role only).
    const now = new Date().toISOString();
    const stored = await upsertMetaAccount({
      store_slug: slug, provider: 'meta',
      business_id: business?.id || null, business_name: business?.name || null,
      ad_account_ids: adAccountIds, scopes,
      access_token: token, token_type: 'bearer', expires_at: expiresAt,
      status: 'connected', connected_at: now, updated_at: now,
    });
    if (!stored) return back(res, slug, { meta: 'error', reason: 'store' });

    // 8) Public-safe mirror onto the store config (NEVER the token). When the
    //    seller shared a Pixel, auto-fill the existing Meta Pixel ID field so
    //    storefront tracking turns on without them pasting it manually.
    const config = await getStoreConfig(slug);
    if (config) {
      const patch = {
        ...config,
        meta: {
          connected: true,
          businessId: business?.id || null,
          businessName: business?.name || null,
          adAccountCount: adAccountIds.length,
          pixelId: pixelId || null,
          connectedAt: now,
          expiresAt,
        },
      };
      if (pixelId) patch.metaPixelId = pixelId;   // fills the Meta Pixel ID input
      await patchStoreConfig(slug, patch);
    }

    return back(res, slug, { meta: 'connected' });
  } catch {
    return back(res, slug, { meta: 'error', reason: 'server' });
  }
}

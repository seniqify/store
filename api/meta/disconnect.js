// POST /api/meta/disconnect  — PIN-gated: revokes a store's Meta connection.
// Marks the stored record revoked and drops the token, best-effort revokes the
// app's permissions on Meta's side, and clears the public-safe flag from the
// store config. Runs server-side; tokens never reach the browser.
import {
  GRAPH_VER, serviceKey, verifyStorePin,
  getMetaAccount, updateMetaStatus, getStoreConfig, patchStoreConfig,
} from './_meta.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  try {
    if (!serviceKey()) { res.status(503).json({ error: 'Meta connection is not configured yet.' }); return; }

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const slug = String(body.slug || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 60);
    const hashedPin = String(body.hashedPin || '');
    if (!slug || !hashedPin) { res.status(400).json({ error: 'Missing store or PIN.' }); return; }

    if (!(await verifyStorePin(slug, hashedPin))) { res.status(403).json({ error: 'Incorrect PIN.' }); return; }

    // Best-effort: revoke the app's permissions on Meta (we still revoke locally).
    const acct = await getMetaAccount(slug);
    if (acct?.access_token) {
      try {
        await fetch(
          `https://graph.facebook.com/${GRAPH_VER}/me/permissions?access_token=${encodeURIComponent(acct.access_token)}`,
          { method: 'DELETE' },
        );
      } catch { /* ignore — local revoke below is what matters */ }
    }

    // Mark revoked and drop the stored token.
    await updateMetaStatus(slug, { status: 'revoked', access_token: null });

    // Clear the public-safe flag from the store config.
    const config = await getStoreConfig(slug);
    if (config) {
      const { meta, ...rest } = config;   // eslint-disable-line no-unused-vars
      await patchStoreConfig(slug, { ...rest, meta: { connected: false } });
    }

    res.status(200).json({ connected: false });
  } catch {
    res.status(200).json({ error: 'Could not disconnect. Please try again.' });
  }
}

// POST /api/meta/start  — begins the Meta (Facebook Login for Business) connect
// flow for a seller. PIN-gated: only the store owner (who holds the PIN) can mint
// a signed `state` that binds this connection to their store. Returns the Meta
// authorization URL; the client then redirects the browser to it. No secret ever
// reaches the browser. Uses the Login-for-Business `config_id` (permissions are
// defined in the Meta dashboard config), NOT raw scopes.
import { APP_ID, CONFIG_ID, REDIRECT_URI, GRAPH_VER, stateSecret, verifyStorePin, signState, slugAllowed } from './_meta.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  try {
    if (!stateSecret()) { res.status(503).json({ error: 'Meta connection is not configured yet.' }); return; }

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const slug = String(body.slug || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 60);
    const hashedPin = String(body.hashedPin || '');
    if (!slug || !hashedPin) { res.status(400).json({ error: 'Missing store or PIN.' }); return; }

    // Staging guard: on a preview deployment META_ALLOWED_SLUGS limits which
    // stores may be connected at all, so a test can never overwrite a real
    // merchant's token. Unset in production → no restriction.
    if (!slugAllowed(slug)) {
      res.status(403).json({ error: 'This environment can only connect the designated test store.' });
      return;
    }

    // Only the store owner can start a connection for this store.
    if (!(await verifyStorePin(slug, hashedPin))) {
      res.status(403).json({ error: 'Incorrect PIN.' });
      return;
    }

    const state = signState(slug);
    const url = `https://www.facebook.com/${GRAPH_VER}/dialog/oauth?` + new URLSearchParams({
      client_id:     APP_ID,
      config_id:     CONFIG_ID,      // Login for Business config → defines permissions/assets
      redirect_uri:  REDIRECT_URI,
      response_type: 'code',
      state,
    }).toString();

    res.status(200).json({ url });
  } catch {
    res.status(200).json({ error: 'Could not start the connection. Please try again.' });
  }
}

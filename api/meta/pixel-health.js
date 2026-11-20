// POST /api/meta/pixel-health — is a store's Meta Pixel inventing conversions?
//
// Two callers, two gates:
//   { slug, hashedPin }   one store, from Manage → Ads (store PIN, throttled)
//   { scope: 'all' }      every store with a pixel, from the Console. Needs the
//                         founder's Supabase session (Authorization: Bearer)
//                         and crm_team role 'admin'.
//
// Read-only. It fetches each pixel's public settings from Meta and reports any
// rule saved on it that logs a Purchase (or another conversion) by itself. See
// _pixelHealth.js for why. No Meta token is used and nothing is written.
import { SB, ANON, serviceKey, verifyStorePin, getStoreConfig } from './_meta.js';
import { checkPixels, storePixels } from './_pixelHealth.js';

const svc = () => ({ apikey: serviceKey(), Authorization: `Bearer ${serviceKey()}`, 'Content-Type': 'application/json' });

async function founder(req) {
  try {
    const auth = req.headers?.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token) return false;
    const ur = await fetch(`${SB}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } });
    if (!ur.ok) return false;
    const uid = (await ur.json())?.id;
    if (!uid) return false;
    const cr = await fetch(`${SB}/rest/v1/crm_team?user_id=eq.${encodeURIComponent(uid)}&select=role`, { headers: svc() });
    return (await cr.json().catch(() => []))[0]?.role === 'admin';
  } catch {
    return false;
  }
}

async function storesWithPixels() {
  const sel = 'slug,name:config->>businessName,metaPixelId:config->>metaPixelId,adsPixelId:config->meta->>pixelId';
  const r = await fetch(`${SB}/rest/v1/stores?select=${sel}&or=(config->>metaPixelId.not.is.null,config->meta->>pixelId.not.is.null)&order=slug`, { headers: svc() });
  if (!r.ok) return null;
  const rows = await r.json().catch(() => null);
  return Array.isArray(rows) ? rows : null;
}

const withResults = (pixels, results) => pixels.map((p) => ({ ...p, ...(results.get(p.pixelId) || { status: 'unknown', findings: [] }) }));

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'method' }); return; }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

    if (body.scope === 'all') {
      if (!(await founder(req))) { res.status(403).json({ error: 'not_founder' }); return; }
      const rows = await storesWithPixels();
      if (!rows) { res.status(200).json({ error: 'server' }); return; }
      const stores = rows.map((r) => ({ slug: r.slug, name: r.name || r.slug, pixels: storePixels({ metaPixelId: r.metaPixelId, meta: { pixelId: r.adsPixelId } }) }))
        .filter((s) => s.pixels.length);
      const results = await checkPixels(stores.flatMap((s) => s.pixels.map((p) => p.pixelId)));
      res.status(200).json({ checkedAt: new Date().toISOString(), stores: stores.map((s) => ({ ...s, pixels: withResults(s.pixels, results) })) });
      return;
    }

    const slug = String(body.slug || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 60);
    const hashedPin = String(body.hashedPin || '');
    if (!slug || !hashedPin) { res.status(400).json({ error: 'missing' }); return; }
    if (!(await verifyStorePin(slug, hashedPin))) { res.status(403).json({ error: 'pin' }); return; }
    const config = await getStoreConfig(slug);
    if (!config) { res.status(200).json({ error: 'server' }); return; }
    const pixels = storePixels(config);
    const results = await checkPixels(pixels.map((p) => p.pixelId));
    res.status(200).json({ checkedAt: new Date().toISOString(), pixels: withResults(pixels, results) });
  } catch {
    res.status(200).json({ error: 'server' });
  }
}

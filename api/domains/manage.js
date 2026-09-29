// POST /api/domains/manage  -- the owner-only custom-domain API for the later
// Manage UI (PR-E). One endpoint, action-dispatched, like payments-connect.
//
//   body: { action, slug, hashedPin, ...action fields }
//   actions:
//     status                                   -> { domain }
//     claim        { hostname }                -> PENDING group + TXT record to publish
//     verify                                   -> live TXT check, then verified
//     refresh                                  -> re-read Vercel, attach, mark ready
//     request_otp  { otpAction, hostname? }    -> code to the OWNER's WhatsApp
//     activate     { challengeId, code }       -> fresh TXT + Vercel check, then connected
//     set_primary  { hostname, challengeId, code }
//     disconnect   { challengeId?, code? }     -> pending cancels without a code
//
// Order of refusals, on purpose:
//   1. CUSTOM_DOMAINS_ENABLED off   -> feature_disabled (nothing is read, no PIN check)
//   2. server not configured        -> not_configured (no detail returned or logged)
//   3. PIN wrong / throttled        -> 403 unauthorized
// Same-origin only: no CORS headers are added, so no other site's page can call it.
import { domainsConfig, missingConfig } from './_config.js';
import { cleanSlug, cleanHashedPin, clientIp, verifyOwnerPin } from './_auth.js';
import { createDomainDb } from './_db.js';
import { createVercelClient } from './_vercel.js';
import { createDomainService } from './_service.js';

export function buildDeps(cfg, fetchImpl = globalThis.fetch) {
  return {
    config: cfg,
    fetchImpl,
    db: createDomainDb({ url: cfg.supabaseUrl, serviceKey: cfg.serviceKey, fetchImpl }),
    vercel: createVercelClient({
      token: cfg.vercelToken, projectId: cfg.vercelProjectId, teamId: cfg.vercelTeamId, fetchImpl,
    }),
  };
}

const ACTIONS = new Set(['status', 'claim', 'verify', 'refresh', 'request_otp', 'activate', 'set_primary', 'disconnect']);

/** The whole handler as a function of (request, environment) -> { status, body }. */
export async function handleManage(req, { env = process.env, fetchImpl = globalThis.fetch, deps: injected } = {}) {
  if (req.method !== 'POST') return { status: 405, body: { outcome: 'method_not_allowed' } };

  const cfg = domainsConfig(env);
  if (!cfg.enabled) return { status: 200, body: { outcome: 'feature_disabled' } };

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  } catch {
    return { status: 400, body: { outcome: 'bad_request' } };
  }
  const action = String(body.action || '');
  if (!ACTIONS.has(action)) return { status: 400, body: { outcome: 'invalid_action' } };
  const slug = cleanSlug(body.slug);
  const hashedPin = cleanHashedPin(body.hashedPin);
  if (!slug || !hashedPin) return { status: 400, body: { outcome: 'bad_request' } };

  if (missingConfig(cfg, 'database').length) return { status: 503, body: { outcome: 'not_configured' } };

  const ok = await verifyOwnerPin({ supabaseUrl: cfg.supabaseUrl, fetchImpl }, slug, hashedPin, clientIp(req));
  if (!ok) return { status: 403, body: { outcome: 'unauthorized' } };

  const svc = createDomainService(injected || buildDeps(cfg, fetchImpl));
  try {
    switch (action) {
      case 'status':      return { status: 200, body: await svc.status(slug) };
      case 'claim':       return { status: 200, body: await svc.claim(slug, body.hostname) };
      case 'verify':      return { status: 200, body: await svc.verify(slug) };
      case 'refresh':     return { status: 200, body: await svc.refresh(slug) };
      case 'request_otp': return { status: 200, body: await svc.requestOtp(slug, String(body.otpAction || ''), body.hostname) };
      case 'activate':    return { status: 200, body: await svc.activate(slug, body.challengeId, body.code) };
      case 'set_primary': return { status: 200, body: await svc.setPrimary(slug, body.hostname, body.challengeId, body.code) };
      case 'disconnect':  return { status: 200, body: await svc.disconnect(slug, body.challengeId, body.code) };
      default:            return { status: 400, body: { outcome: 'invalid_action' } };
    }
  } catch (e) {
    // Fail closed, and say nothing internal. The code is a fixed short string.
    console.error(`domains/manage ${action}: ${e?.code || 'error'}`);
    return { status: 200, body: { outcome: 'temporarily_unavailable' } };
  }
}

export default async function handler(req, res) {
  const { status, body } = await handleManage(req);
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json(body);
}

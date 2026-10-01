// POST /api/domains/manage  -- the owner-only custom-domain API for the later
// Manage UI (PR-E). One endpoint, action-dispatched, like payments-connect.
//
//   Content-Type: application/json
//   body: { action, slug, hashedPin, ...action fields }
//   actions:
//     status                                   -> { domain, vercel_verification? }
//     claim        { hostname }                -> PENDING group + TXT record to publish
//     verify                                   -> live TXT check, then verified
//     refresh                                  -> re-read Vercel, attach, mark ready,
//                                                 Vercel's own TXT challenges if needed
//     request_otp  { otpAction, hostname? }    -> code to the OWNER's WhatsApp
//     activate     { challengeId, code }       -> fresh TXT + Vercel check, then connected
//     set_primary  { hostname, challengeId, code }
//     disconnect   { challengeId?, code? }     -> pending cancels without a code
//
//   verify (its Vercel attach), refresh, activate and disconnect hold the
//   group's lease -- the one the reconciler takes -- for their Vercel work.
//   While it is held elsewhere they answer { outcome: 'busy',
//   retry_after_seconds }: nothing is called or written, and no code is spent.
//
// Order of refusals, on purpose:
//   1. CUSTOM_DOMAINS_ENABLED off   -> feature_disabled (nothing is read, no PIN check)
//   2. not application/json         -> 415
//   3. a store not listed in CUSTOM_DOMAINS_PILOT_STORES
//                                   -> feature_disabled, the same answer as 1: no
//                                      PIN check, and no database, DNS, Vercel or
//                                      WhatsApp call -- for every action
//   4. server not configured        -> not_configured (no detail returned or logged)
//   5. PIN wrong / throttled        -> 403 unauthorized
//
// WHO CAN CALL IT. Any HTTP client can reach this endpoint; it is not
// origin-restricted, and access control is the store PIN (verified per request
// through the throttled verify_store_pin), never the caller's origin. What the
// absence of CORS headers does do: a page on another origin cannot read the
// responses, and because a JSON body is required, a browser must send a CORS
// preflight for any cross-origin call -- which fails, so the call is never
// made. No cookie or ambient credential is involved, so there is nothing for a
// cross-site request to borrow.
//
// Every request runs under one execution budget (_budget.js): database, DNS and
// Vercel calls are capped at the time left, with time reserved for recording
// results.
import { domainsConfig, missingConfig } from './_config.js';
import { cleanSlug, cleanHashedPin, clientIp, verifyOwnerPin, isPilotStore } from './_auth.js';
import { createDomainDb } from './_db.js';
import { createVercelClient } from './_vercel.js';
import { createDomainService } from './_service.js';
import { createBudget } from './_budget.js';

export const REQUEST_BUDGET_MS = 50000;          // maxDuration is 60 s

/**
 * Real dependencies. The Vercel client is configured ONLY when the same check
 * the reconciler uses passes (token, prj_ project id) -- otherwise it is inert
 * and every Vercel-dependent action answers not_configured.
 */
export function buildDeps(cfg, fetchImpl = globalThis.fetch) {
  const vercelOk = missingConfig(cfg, 'vercel').length === 0;
  return {
    config: cfg,
    fetchImpl,
    db: createDomainDb({ url: cfg.supabaseUrl, serviceKey: cfg.serviceKey, fetchImpl }),
    vercel: createVercelClient({
      token: vercelOk ? cfg.vercelToken : '', projectId: vercelOk ? cfg.vercelProjectId : '',
      teamId: cfg.vercelTeamId, fetchImpl,
    }),
  };
}

/** Bind every client in `deps` to one budget. */
export function withBudget(deps, budget) {
  return { ...deps, budget, db: deps.db.withBudget(budget), vercel: deps.vercel.withBudget(budget) };
}

const ACTIONS = new Set(['status', 'claim', 'verify', 'refresh', 'request_otp', 'activate', 'set_primary', 'disconnect']);

/** The whole handler as a function of (request, environment) -> { status, body }. */
export async function handleManage(req, { env = process.env, fetchImpl = globalThis.fetch, deps: injected, budgetMs = REQUEST_BUDGET_MS } = {}) {
  if (req.method !== 'POST') return { status: 405, body: { outcome: 'method_not_allowed' } };

  const cfg = domainsConfig(env);
  if (!cfg.enabled) return { status: 200, body: { outcome: 'feature_disabled' } };

  const ctype = String(req.headers?.['content-type'] || '').toLowerCase();
  if (!ctype.startsWith('application/json') || typeof req.body !== 'object' || req.body === null) {
    return { status: 415, body: { outcome: 'json_required' } };
  }
  const body = req.body;
  const action = String(body.action || '');
  if (!ACTIONS.has(action)) return { status: 400, body: { outcome: 'invalid_action' } };
  const slug = cleanSlug(body.slug);
  const hashedPin = cleanHashedPin(body.hashedPin);
  if (!slug || !hashedPin) return { status: 400, body: { outcome: 'bad_request' } };

  // The pilot gate, for every action: only a listed store goes any further.
  if (!isPilotStore(slug, env)) return { status: 200, body: { outcome: 'feature_disabled' } };

  if (missingConfig(cfg, 'database').length) return { status: 503, body: { outcome: 'not_configured' } };

  const ok = await verifyOwnerPin({ supabaseUrl: cfg.supabaseUrl, fetchImpl }, slug, hashedPin, clientIp(req));
  if (!ok) return { status: 403, body: { outcome: 'unauthorized' } };

  const svc = createDomainService(withBudget(injected || buildDeps(cfg, fetchImpl), createBudget({ totalMs: budgetMs })));
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

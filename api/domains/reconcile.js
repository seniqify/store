// /api/domains/reconcile -- one reconciler pass (see _reconcile.js).
//
// Caller must send  Authorization: Bearer <CRON_SECRET>  -- the header Vercel
// Cron sends when CRON_SECRET is set, so the same endpoint can be scheduled
// later. NO SCHEDULE IS INSTALLED BY THIS PR: vercel.json has no cron for it.
//
// CUSTOM_DOMAINS_ENABLED off -> feature_disabled, with no database or Vercel
// call of any kind. The response is counts only.
import crypto from 'node:crypto';
import { domainsConfig, missingConfig } from './_config.js';
import { buildDeps } from './manage.js';
import { reconcile } from './_reconcile.js';

function secretMatches(header, secret) {
  if (!secret) return false;
  const got = Buffer.from(String(header || ''));
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

export async function handleReconcile(req, { env = process.env, fetchImpl = globalThis.fetch, deps: injected, now } = {}) {
  if (req.method !== 'GET' && req.method !== 'POST') return { status: 405, body: { outcome: 'method_not_allowed' } };
  const cfg = domainsConfig(env);
  if (!secretMatches(req.headers?.authorization, cfg.cronSecret)) return { status: 401, body: { outcome: 'unauthorized' } };
  if (!cfg.enabled) return { status: 200, body: { outcome: 'feature_disabled' } };
  if (missingConfig(cfg, 'database').length || missingConfig(cfg, 'vercel').length) {
    return { status: 503, body: { outcome: 'not_configured' } };
  }
  try {
    return { status: 200, body: await reconcile(injected || buildDeps(cfg, fetchImpl), now ? { now } : {}) };
  } catch (e) {
    console.error(`domains/reconcile: ${e?.code || 'error'}`);
    return { status: 200, body: { outcome: 'temporarily_unavailable' } };
  }
}

export default async function handler(req, res) {
  const { status, body } = await handleReconcile(req);
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json(body);
}

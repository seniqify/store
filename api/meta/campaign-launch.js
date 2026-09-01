// POST /api/meta/campaign-launch — Stage 2D: FOUNDER-ONLY campaign launch + control.
//
// Creates the previewed campaign on Meta and controls it. Actions:
//   create   — build (shared builder) → validate → claim (idempotency lease) →
//              create campaign→adset→creative→ad, ALL PAUSED, resume-forward.
//   activate — founder-only spend enable: set campaign+adset+ad ACTIVE.
//   pause    — set campaign PAUSED (stops spend).
//   resume   — set campaign ACTIVE (spend-enable; founder-only like activate).
//   stop     — set campaign PAUSED + mark stopped (kept, not deleted).
//   status   — read the launch ledger.
//
// AUTH: founder-only — a valid Supabase session whose user is a crm_team admin
// (Authorization: Bearer <supabase access token>). Store owners cannot launch or
// spend. SAFETY: everything is created PAUSED; activation is the only spend step;
// budgets are clamped server-side (₹5000/day · ₹25000 total · 30 days) in the
// shared builder; launch_id makes creation idempotent; a partial create resumes.
import { SB, ANON, serviceKey, getMetaAccount, getStoreConfig } from './_meta.js';
import { buildCampaign } from './_campaignBuild.js';

const GRAPH = 'https://graph.facebook.com/v25.0';
const svc = (extra = {}) => ({ apikey: serviceKey(), Authorization: `Bearer ${serviceKey()}`, 'Content-Type': 'application/json', ...extra });

// ── Founder gate: valid Supabase session + crm_team admin ──────────────────────
async function requireFounder(req) {
  try {
    const auth = req.headers?.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token) return null;
    const ur = await fetch(`${SB}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } });
    if (!ur.ok) return null;
    const uid = (await ur.json())?.id;
    if (!uid) return null;
    const cr = await fetch(`${SB}/rest/v1/crm_team?user_id=eq.${uid}&select=role`, { headers: svc() });
    const rows = await cr.json().catch(() => []);
    return rows[0]?.role === 'admin' ? { uid } : null;
  } catch { return null; }
}

// ── Supabase RPC / reads (service role) ────────────────────────────────────────
async function rpc(fn, args) {
  const r = await fetch(`${SB}/rest/v1/rpc/${fn}`, { method: 'POST', headers: svc(), body: JSON.stringify(args) });
  return r.ok ? r.json().catch(() => null) : null;
}
async function getLaunch(launchId) {
  const r = await fetch(`${SB}/rest/v1/meta_campaigns?launch_id=eq.${launchId}&select=*&limit=1`, { headers: svc() });
  if (!r.ok) return null;
  return (await r.json())[0] || null;
}
async function set(launchId, patch) { await rpc('meta_campaign_set', { p_launch_id: launchId, p_patch: patch }); }

// ── Meta Graph POST (create / update) ──────────────────────────────────────────
async function graphPost(path, params, token) {
  try {
    const r = await fetch(`${GRAPH}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...params, access_token: token }) });
    const body = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, body };
  } catch (e) { return { ok: false, status: 0, body: { error: { message: (e).message } } }; }
}

const ids = (row) => ({ campaign_id: row.campaign_id, adset_id: row.adset_id, creative_id: row.creative_id, ad_id: row.ad_id });

// ── CREATE (PAUSED, idempotent, resume-forward) ────────────────────────────────
async function doCreate(slug, launchId, input) {
  const acct = await getMetaAccount(slug);
  if (!acct || acct.status !== 'connected' || !acct.access_token) return { error: 'not_connected' };
  const adId = (acct.ad_account_ids || [])[0];
  if (!adId) return { error: 'no_ad_account' };
  const config = await getStoreConfig(slug);
  const token = acct.access_token;

  const built = await buildCampaign({ slug, adId, token, cfg: config || {} }, input);
  if (built.error) return built;                                   // reauth, etc.
  if (!built.launchReady) return { error: 'blocked', launchBlockers: built.launchBlockers, warnings: built.warnings };

  const claim = await rpc('meta_campaign_claim', { p_launch_id: launchId, p_store_slug: slug, p_config: { input, budget: built.budget, objective: built.objective.key } });
  if (claim === 'already_created') { const row = await getLaunch(launchId); return { ok: true, status: row.status, launchId, ids: ids(row), alreadyCreated: true }; }
  if (claim === 'locked') return { error: 'in_progress' };
  if (claim === 'exhausted') return { error: 'exhausted' };

  await set(launchId, { objective: built.objective.key, daily_budget: built.budget.daily, days: built.budget.days, lifetime_minor: built.budget.lifetimeMinor, currency: built.currency, spend_cap_set: built.budget.spendCapApplied, page_id: built.page.id, error: '' });

  let row = await getLaunch(launchId);
  const P = built.payloads;
  const fail = async (step, r) => { await set(launchId, { status: 'partial', error: `${step}: ${r.body?.error?.message || r.status}` }); return { error: 'partial', step, message: r.body?.error?.message || `Meta ${step} create failed`, ids: ids(await getLaunch(launchId)) }; };

  if (!row.campaign_id) {
    const r = await graphPost(`act_${adId}/campaigns`, P.campaign.body, token);
    if (!r.ok || !r.body?.id) return fail('campaign', r);
    await set(launchId, { campaign_id: r.body.id }); row.campaign_id = r.body.id;
  }
  if (!row.adset_id) {
    const r = await graphPost(`act_${adId}/adsets`, { ...P.adset.body, campaign_id: row.campaign_id }, token);
    if (!r.ok || !r.body?.id) return fail('adset', r);
    await set(launchId, { adset_id: r.body.id }); row.adset_id = r.body.id;
  }
  if (!row.creative_id) {
    const r = await graphPost(`act_${adId}/adcreatives`, P.adcreative.body, token);
    if (!r.ok || !r.body?.id) return fail('creative', r);
    await set(launchId, { creative_id: r.body.id }); row.creative_id = r.body.id;
  }
  if (!row.ad_id) {
    const r = await graphPost(`act_${adId}/ads`, { ...P.ad.body, adset_id: row.adset_id, creative: { creative_id: row.creative_id } }, token);
    if (!r.ok || !r.body?.id) return fail('ad', r);
    await set(launchId, { ad_id: r.body.id }); row.ad_id = r.body.id;
  }
  await set(launchId, { status: 'created', error: '' });
  return { ok: true, status: 'created', launchId, ids: ids(row), page: built.page, budget: built.budget, warnings: built.warnings };
}

// ── Status-flip actions ────────────────────────────────────────────────────────
async function flip(launchId, metaStatus, newStatus, founderUid) {
  const row = await getLaunch(launchId);
  if (!row) return { error: 'not_found' };
  if (!row.campaign_id) return { error: 'not_created' };
  const acct = await getMetaAccount(row.store_slug);
  const token = acct?.access_token;
  if (!token) return { error: 'not_connected' };

  const targets = [row.campaign_id, ...(metaStatus === 'ACTIVE' ? [row.adset_id, row.ad_id] : [])].filter(Boolean);
  for (const id of targets) {
    const r = await graphPost(`${id}`, { status: metaStatus }, token);
    if (!r.ok) { await set(launchId, { error: `${newStatus}: ${r.body?.error?.message || r.status}` }); return { error: `${newStatus}_failed`, message: r.body?.error?.message || 'Meta rejected the change' }; }
  }
  const patch = { status: newStatus };
  if (newStatus === 'active') { patch.activated_by = founderUid; patch.activated_at = 'now'; }
  await set(launchId, patch);
  return { ok: true, status: newStatus };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'method' }); return; }
  try {
    if (!serviceKey()) { res.status(503).json({ error: 'not_configured' }); return; }
    const founder = await requireFounder(req);
    if (!founder) { res.status(403).json({ error: 'founder_only' }); return; }

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const action = String(body.action || '');
    const launchId = String(body.launchId || '');

    if (action === 'create') {
      const slug = String(body.slug || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 60);
      if (!slug || !launchId) { res.status(400).json({ error: 'missing' }); return; }
      res.status(200).json(await doCreate(slug, launchId, { objective: body.objective, days: body.days, dailyBudget: body.dailyBudget, promote: body.promote, productId: body.productId, gender: body.gender, radiusKm: body.radiusKm, ageMin: body.ageMin, ageMax: body.ageMax, audienceStrategy: body.audienceStrategy }));
      return;
    }
    if (!launchId) { res.status(400).json({ error: 'missing' }); return; }
    if (action === 'activate') { res.status(200).json(await flip(launchId, 'ACTIVE', 'active', founder.uid)); return; }
    if (action === 'resume')   { res.status(200).json(await flip(launchId, 'ACTIVE', 'active', founder.uid)); return; }
    if (action === 'pause')    { res.status(200).json(await flip(launchId, 'PAUSED', 'paused')); return; }
    if (action === 'stop')     { res.status(200).json(await flip(launchId, 'PAUSED', 'stopped')); return; }
    if (action === 'status')   { res.status(200).json({ ok: true, launch: await getLaunch(launchId) }); return; }

    res.status(400).json({ error: 'unknown_action' });
  } catch {
    res.status(200).json({ error: 'server' });
  }
}

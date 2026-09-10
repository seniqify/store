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
import { SB, ANON, serviceKey, getMetaAccount, getStoreConfig, resolveAdAccount, getGrantedPermissions, graphGet, slugAllowed, activationBlocked } from './_meta.js';
import { buildCampaign } from './_campaignBuild.js';

// Meta permission required to create delivery objects. Checked LIVE against
// /me/permissions before any write — stored scopes are only a connect-time record.
const CREATE_PERMISSION = 'ads_management';

const GRAPH = 'https://graph.facebook.com/v25.0';
const svc = (extra = {}) => ({ apikey: serviceKey(), Authorization: `Bearer ${serviceKey()}`, 'Content-Type': 'application/json', ...extra });

// ── Authorisation: two independent sources, neither implying the other ────────
// 1. crm_team.role — PocketLink staff. 'admin' (the founder) may do everything,
//    including activation, for any store.
// 2. ads_testers — a store-scoped grant for an authorised outside tester or a
//    Meta reviewer. One row = "may create PAUSED objects for THIS one store".
//
// 'ads_tester' is deliberately NOT a crm_team role. Every CRM policy keys off
// is_crm_member(), which tests membership and not role, so a crm_team row would
// have handed a tester every merchant's orders and ALL rights on crm_leads —
// including delete. See supabase/ads-tester-access.sql. A stale crm_team row
// with that role therefore grants nothing here: it fails closed.
//
// Returns { uid, role, scopes } — scopes is the list of slugs the caller holds
// an unexpired ads_testers grant for. Each action below decides what it needs.
const CAN_CREATE_ANY = ['admin'];   // crm_team roles that may create for any store
const CAN_ACTIVATE   = ['admin'];   // only the founder may ever spend

// Which stores does this caller hold a LIVE ads_testers grant for?
//
// Expiry is enforced twice, deliberately. The RLS policy hides an expired grant
// from the tester's own session (ads-tester-access.sql), but this endpoint reads
// with the service-role key, which bypasses RLS — so the expiry must be applied
// again here or a lapsed grant would still create ads. A row whose expires_at is
// unparseable is treated as expired: unreadable is not permission.
//
// An absent ads_testers table (migration not yet applied) arrives as an error
// object rather than an array; that must not 500 the endpoint — it simply means
// nobody holds a scoped grant yet.
export function activeScopes(rows, now = Date.now()) {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((r) => {
      if (!r?.expires_at) return true;                 // no expiry set
      const t = Date.parse(r.expires_at);
      return Number.isFinite(t) && t > now;
    })
    .map((r) => String(r.store_slug || '').trim().toLowerCase())
    .filter(Boolean);
}

async function requireActor(req) {
  try {
    const auth = req.headers?.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token) return null;
    const ur = await fetch(`${SB}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } });
    if (!ur.ok) return null;
    const uid = (await ur.json())?.id;
    if (!uid) return null;

    const [cr, tr] = await Promise.all([
      fetch(`${SB}/rest/v1/crm_team?user_id=eq.${uid}&select=role`, { headers: svc() }),
      fetch(`${SB}/rest/v1/ads_testers?user_id=eq.${uid}&select=store_slug,expires_at`, { headers: svc() }),
    ]);
    const role = (await cr.json().catch(() => []))[0]?.role || null;
    const scopes = activeScopes(await tr.json().catch(() => []));

    if (!role && !scopes.length) return null;
    return { uid, role, scopes };
  } catch { return null; }
}

// May this caller CREATE paused objects for this specific store?
export function mayCreate(actor, slug) {
  if (CAN_CREATE_ANY.includes(actor.role)) return true;
  return Boolean(slug) && actor.scopes.includes(slug);
}
// Pausing and stopping only ever REDUCE delivery, so staff may do it anywhere
// and a scoped tester may do it for their own store.
export function mayReduce(actor, slug) {
  if (actor.role) return true;
  return Boolean(slug) && actor.scopes.includes(slug);
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
async function doCreate(slug, launchId, input, meta) {
  // Staging guard — a preview deployment shares production's database, so it must
  // not create against a store it was not designated for. Unset in production.
  if (!slugAllowed(slug)) return { error: 'not_allowed_in_this_environment' };
  const acct = await getMetaAccount(slug);
  if (!acct || acct.status !== 'connected' || !acct.access_token) return { error: 'not_connected' };
  // Tenant isolation: the account row is looked up BY SLUG, and the account comes
  // from the shared resolver — the merchant's persisted choice, never array order
  // and never an id supplied by the caller. If several accounts are connected and
  // none has been chosen, creation stops rather than guessing which one to spend
  // from: picking [0] is how showme paired the PocketLink Page with the Shobha IVF
  // ad account.
  const picked = resolveAdAccount(acct);
  if (picked.error) return { error: picked.error, adAccounts: picked.available };
  const adAccount = picked.adAccount;
  const config = await getStoreConfig(slug);
  const token = acct.access_token;

  // Live permission gate — before the idempotency lease, so a merchant without
  // ads_management burns no launch attempts and gets an accurate reason.
  const perms = await getGrantedPermissions(token);
  if (!perms.granted) return { error: 'permission_check_failed', message: perms.error };
  if (!perms.granted.has(CREATE_PERMISSION)) {
    return {
      error: 'missing_permission',
      permission: CREATE_PERMISSION,
      granted: [...perms.granted].sort(),
    };
  }

  const built = await buildCampaign({ slug, adId: adAccount, token, cfg: config || {} }, input);
  if (built.error) return built;                                   // reauth, etc.
  if (!built.launchReady) return { error: 'blocked', launchBlockers: built.launchBlockers, warnings: built.warnings };

  // Full recommendation/config SNAPSHOT — frozen at creation (PAUSED), before any
  // spend, so the first campaign's decision + "why" is preserved for measurement.
  const strategySource = meta?.strategy_source || 'pocketlink_reco';
  const experimentId = meta?.experiment_id || null;
  const snapshot = {
    capturedAt: new Date().toISOString(), strategySource, experimentId,
    goal: meta?.recommendation?.goal || null,
    objective: built.objective,
    audienceStrategy: input.audienceStrategy || 'auto',
    promote: built.creative?.promote || null,
    product: built.creative?.productName || null,
    location: { label: built.targeting?.label || null, radiusKm: input.radiusKm ?? null },
    age: { min: built.targeting?.ageMin ?? null, max: built.targeting?.ageMax ?? null },
    gender: built.targeting?.genderLabel || null,
    budget: built.budget,
    creative: built.creative ? { headline: built.creative.headline, primaryText: built.creative.primaryText, cta: built.creative.cta, imageUrl: built.creative.imageUrl } : null,
    destination: built.creative?.link || null,
    pageId: built.page?.id || null,
    pixelId: config?.meta?.pixelId || config?.metaPixelId || null,
    reason: meta?.recommendation?.overall || null,
    reasons: meta?.recommendation?.reasons || null,
  };

  const claim = await rpc('meta_campaign_claim', { p_launch_id: launchId, p_store_slug: slug, p_config: snapshot });
  if (claim === 'already_created') { const row = await getLaunch(launchId); return { ok: true, status: row.status, launchId, ids: ids(row), alreadyCreated: true }; }
  if (claim === 'locked') return { error: 'in_progress' };
  if (claim === 'exhausted') return { error: 'exhausted' };

  await set(launchId, { objective: built.objective.key, daily_budget: built.budget.daily, days: built.budget.days, lifetime_minor: built.budget.lifetimeMinor, currency: built.currency, spend_cap_set: built.budget.spendCapApplied, page_id: built.page.id, strategy_source: strategySource, experiment_id: experimentId, error: '' });

  let row = await getLaunch(launchId);
  const P = built.payloads;
  const fail = async (step, r) => { await set(launchId, { status: 'partial', error: `${step}: ${r.body?.error?.message || r.status}` }); return { error: 'partial', step, message: r.body?.error?.message || `Meta ${step} create failed`, ids: ids(await getLaunch(launchId)) }; };

  if (!row.campaign_id) {
    const r = await graphPost(`${adAccount}/campaigns`, P.campaign.body, token);
    if (!r.ok || !r.body?.id) return fail('campaign', r);
    await set(launchId, { campaign_id: r.body.id }); row.campaign_id = r.body.id;
  }
  if (!row.adset_id) {
    const r = await graphPost(`${adAccount}/adsets`, { ...P.adset.body, campaign_id: row.campaign_id }, token);
    if (!r.ok || !r.body?.id) return fail('adset', r);
    await set(launchId, { adset_id: r.body.id }); row.adset_id = r.body.id;
  }
  if (!row.creative_id) {
    const r = await graphPost(`${adAccount}/adcreatives`, P.adcreative.body, token);
    if (!r.ok || !r.body?.id) return fail('creative', r);
    await set(launchId, { creative_id: r.body.id }); row.creative_id = r.body.id;
  }
  if (!row.ad_id) {
    const r = await graphPost(`${adAccount}/ads`, { ...P.ad.body, adset_id: row.adset_id, creative: { creative_id: row.creative_id } }, token);
    if (!r.ok || !r.body?.id) return fail('ad', r);
    await set(launchId, { ad_id: r.body.id }); row.ad_id = r.body.id;
  }
  // Read the objects back from Meta and confirm they really are PAUSED. We never
  // claim "created paused" on the strength of the create call alone — the whole
  // safety story rests on this being true, so it is verified, not assumed.
  const verified = await verifyPaused(row, token);
  await set(launchId, { status: 'created', error: '' });
  return {
    ok: true, status: 'created', launchId, ids: ids(row),
    page: built.page, budget: built.budget, warnings: built.warnings,
    verified,
    adsManagerUrl: `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${adAccount.replace(/^act_/, '')}&selected_campaign_ids=${row.campaign_id}`,
  };
}

// Read back effective_status/status for each created object. Returns what Meta
// reports, plus allPaused so the UI can state verification honestly.
async function verifyPaused(row, token) {
  const targets = [
    ['campaign', row.campaign_id],
    ['adset',    row.adset_id],
    ['ad',       row.ad_id],
  ].filter(([, id]) => id);
  const statuses = {};
  for (const [kind, id] of targets) {
    const r = await graphGet(id, { fields: 'status,effective_status', access_token: token });
    statuses[kind] = r?.body?.error
      ? { error: r.body.error.message || 'read_failed' }
      : { status: r?.body?.status || null, effectiveStatus: r?.body?.effective_status || null };
  }
  const read = Object.values(statuses).filter((s) => !s.error);
  const allPaused = read.length === targets.length && read.every((s) => s.status === 'PAUSED');
  return { statuses, allPaused };
}

// ── Status-flip actions ────────────────────────────────────────────────────────
async function flip(launchId, metaStatus, newStatus, founderUid) {
  const row = await getLaunch(launchId);
  if (!row) return { error: 'not_found' };
  // Same guard on every status flip — including activate, the only spend step.
  if (!slugAllowed(row.store_slug)) return { error: 'not_allowed_in_this_environment' };
  // Second, independent check: even if a caller somehow reached here, a
  // paused-only environment never sets anything ACTIVE.
  if (metaStatus === 'ACTIVE' && activationBlocked()) return { error: 'activation_disabled_in_this_environment' };
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
    const actor = await requireActor(req);
    if (!actor) { res.status(403).json({ error: 'team_only' }); return; }

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const action = String(body.action || '');
    const launchId = String(body.launchId || '');

    if (action === 'create') {
      const slug = String(body.slug || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 60);
      if (!slug || !launchId) { res.status(400).json({ error: 'missing' }); return; }
      // Authorisation is per-store: a scoped tester creating for someone else's
      // store is refused here, not merely hidden in the UI.
      if (!mayCreate(actor, slug)) { res.status(403).json({ error: 'not_permitted' }); return; }
      res.status(200).json(await doCreate(slug, launchId,
        { objective: body.objective, days: body.days, dailyBudget: body.dailyBudget, promote: body.promote, productId: body.productId, gender: body.gender, radiusKm: body.radiusKm, ageMin: body.ageMin, ageMax: body.ageMax, audienceStrategy: body.audienceStrategy },
        { recommendation: body.recommendation, strategy_source: body.strategy_source, experiment_id: body.experiment_id }));
      return;
    }
    if (!launchId) { res.status(400).json({ error: 'missing' }); return; }

    // Every remaining action names an existing launch, so the store it belongs
    // to comes from the row — never from the caller. A scoped tester may act on
    // their own store's launches and no others.
    const target = await getLaunch(launchId);
    if (!target) { res.status(404).json({ error: 'unknown_launch' }); return; }
    const targetSlug = String(target.store_slug || '').toLowerCase();
    if (!mayReduce(actor, targetSlug)) { res.status(403).json({ error: 'not_permitted' }); return; }

    // Activation is the ONLY step that spends. Three independent gates, all
    // server-side: the environment must permit activation at all, the caller
    // must hold a crm_team role that may activate, and a store-scoped tester
    // never qualifies — actor.role is null for them, so CAN_ACTIVATE cannot
    // match. A paused-only environment refuses even an admin: that is the point.
    if (action === 'activate' || action === 'resume') {
      if (activationBlocked()) { res.status(403).json({ error: 'activation_disabled_in_this_environment' }); return; }
      if (!CAN_ACTIVATE.includes(actor.role)) { res.status(403).json({ error: 'not_permitted' }); return; }
      res.status(200).json(await flip(launchId, 'ACTIVE', 'active', actor.uid));
      return;
    }
    if (action === 'pause')    { res.status(200).json(await flip(launchId, 'PAUSED', 'paused')); return; }
    if (action === 'stop')     { res.status(200).json(await flip(launchId, 'PAUSED', 'stopped')); return; }
    if (action === 'status')   { res.status(200).json({ ok: true, launch: target }); return; }

    res.status(400).json({ error: 'unknown_action' });
  } catch {
    res.status(200).json({ error: 'server' });
  }
}

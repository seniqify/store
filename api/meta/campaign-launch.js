// POST /api/meta/campaign-launch — campaign creation and control.
//
// Actions:
//   create           — plan (shared builder) → claim (idempotency lease) → create
//                      campaign → ad set → creative → ad, ALL PAUSED, then read back.
//                      Engine: Meta's ads automation server when this store's
//                      connection and ad account allow it ('mcp'), otherwise the
//                      Marketing API ('graph'). The browser only ever sees
//                      mode 'automated' / 'standard'.
//   activate/resume  — enable spend. Needs a step-up (see below).
//   pause / stop     — stop spend (kept, never deleted).
//   update-budget    — daily or lifetime budget, inside the server caps. Raising the
//                      budget of a running campaign needs the same step-up.
//   update-targeting — age / gender / radius / audience strategy on the ad set.
//   upload-media     — image or video from a public https URL into the ad account.
//   errors           — delivery-blocking problems for a launch.
//   status / list    — the ledger: one launch, or this store's launches.
//
// AUTH: the store's own 4-digit Manage PIN, the same credential that opens the
// Ads dashboard, the preview and the Meta connection — because PocketLink
// sellers have no email accounts. A crm_team session is accepted as an
// alternative so staff-operated stores keep working. Activation (and raising a
// running budget) additionally requires a one-time code sent to the store's
// REGISTERED WhatsApp number.
// PRODUCTION GATE: until Meta's approval for merchant ads is confirmed, only
// pilot stores may create, activate or edit (merchantWritesAllowed). Pausing and
// stopping only reduce delivery, so they are never gated.
// SAFETY: everything is created PAUSED and read back; activation is the only
// spend step; budgets are clamped server-side (₹5000/day · ₹25000 total · 30 days);
// launch_id makes creation idempotent; a failed create is rolled back.
import { SB, ANON, serviceKey, verifyStorePin, getMetaAccount, getStoreConfig, resolveAdAccount, getGrantedPermissions, graphGet, slugAllowed, activationBlocked, normalizeAdAccountId } from './_meta.js';
import { buildCampaign } from './_campaignBuild.js';
import { openMcpSession } from './_mcp.js';
import { merchantWritesAllowed, SCOPES } from './_capabilities.js';
import { resolveConnection, logAdAction } from './_connection.js';
import {
  mcpCreateArgs, createPausedViaMcp, readStatusesViaMcp, activateViaMcp, resumeViaMcp, pauseViaMcp,
  updateBudgetViaMcp, updateTargetingViaMcp, uploadMediaViaMcp, errorsViaMcp, budgetFields,
} from './_mcpAds.js';

// Meta permission required to create delivery objects through the Marketing API.
// Checked LIVE against /me/permissions before any write — stored scopes are only
// a connect-time record.
const CREATE_PERMISSION = 'ads_management';

const GRAPH = 'https://graph.facebook.com/v25.0';
const svc = (extra = {}) => ({ apikey: serviceKey(), Authorization: `Bearer ${serviceKey()}`, 'Content-Type': 'application/json', ...extra });

// Actions that create, spend or change a live campaign. Pause / stop / reads are not here.
const WRITE_ACTIONS = ['create', 'activate', 'resume', 'update-budget', 'update-targeting', 'upload-media'];

const modeOf = (engine) => (engine === 'mcp' ? 'automated' : 'standard');
const engineOfRow = (row) => (row?.engine || row?.config?.engine || 'graph');

// ── Authorisation — merchant-first, matching how PocketLink actually works ────
//
// PocketLink sellers have no email accounts. A seller registers with a WhatsApp
// number, proves it with a one-time code, and thereafter opens /[store]/manage
// with a 4-digit PIN. So the PIN authorises campaign creation, exactly as it
// already authorises the Ads dashboard, the campaign preview and the Meta
// connection itself.
//
// The split between create and activate is about BLAST RADIUS, not ceremony:
//
//   create  — everything is made PAUSED and spends nothing. A stolen PIN yields
//             paused objects in the merchant's own ad account. Recoverable.
//   activate— the only step that moves money. A 4-digit secret is not enough,
//             so it additionally demands a fresh one-time code delivered to the
//             store's REGISTERED WhatsApp number: the same proof that resets a
//             PIN, and the strongest identity the product has.
//
// crm_team admin remains valid throughout, so staff-operated stores are
// unaffected.
const CAN_ACTIVATE = ['admin'];   // crm_team roles that may spend without an OTP

// May this caller enable spend? A crm_team admin may; a merchant may only after
// proving control of the store's registered WhatsApp number. Anything else —
// including a non-admin staff role, or a merchant who merely knows the PIN — is
// refused. `otpVerified` must be exactly true: a truthy object from a failed
// lookup is not a proof.
export function activationAllowed(staffRole, otpVerified) {
  if (CAN_ACTIVATE.includes(staffRole)) return true;
  return otpVerified === true;
}

// ── Staff session (optional) ──────────────────────────────────────────────────
async function staffRole(req) {
  try {
    const auth = req.headers?.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token) return null;
    const ur = await fetch(`${SB}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } });
    if (!ur.ok) return null;
    const uid = (await ur.json())?.id;
    if (!uid) return null;
    const cr = await fetch(`${SB}/rest/v1/crm_team?user_id=eq.${uid}&select=role`, { headers: svc() });
    const role = (await cr.json().catch(() => []))[0]?.role || null;
    return role ? { uid, role } : null;
  } catch { return null; }
}

// ── OTP step-up for the spend step ────────────────────────────────────────────
// Verifies a one-time code against the store's REGISTERED WhatsApp number — the
// number is read from the store's own config server-side and is never taken
// from the request, so a caller cannot redirect the proof to a phone they own.
// Codes are single-use: a successful check deletes them.
export function normalizePhone(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (!digits) return null;
  return digits.length > 10 ? digits.slice(-10) : digits;   // compare last 10
}

async function otpStepUp(slug, code) {
  const clean = String(code ?? '').replace(/\D/g, '');
  if (clean.length < 4) return false;

  const config = await getStoreConfig(slug);
  const want = normalizePhone(config?.whatsappNumber);
  if (!want) return false;                       // no registered number → refuse

  try {
    const r = await fetch(
      `${SB}/rest/v1/otp_codes?code=eq.${encodeURIComponent(clean)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&select=id,phone`,
      { headers: svc() },
    );
    if (!r.ok) return false;
    const rows = await r.json().catch(() => []);
    const hit = (Array.isArray(rows) ? rows : []).find((x) => normalizePhone(x.phone) === want);
    if (!hit) return false;
    await fetch(`${SB}/rest/v1/otp_codes?phone=eq.${encodeURIComponent(hit.phone)}`, { method: 'DELETE', headers: svc() });
    return true;
  } catch { return false; }
}

// ── Rollback helpers ──────────────────────────────────────────────────────────
// Meta refuses to delete a parent while a child still references it, so removal
// runs in reverse creation order: ad → creative → ad set → campaign.
// Only what THIS call created is ever passed in.
export function rollbackOrder(made) {
  return Array.isArray(made) ? [...made].reverse() : [];
}

// ── Supabase RPC / reads (service role) ────────────────────────────────────────
async function rpc(fn, args) {
  const r = await fetch(`${SB}/rest/v1/rpc/${fn}`, { method: 'POST', headers: svc(), body: JSON.stringify(args) });
  return r.ok ? r.json().catch(() => null) : null;
}
async function getLaunch(launchId) {
  const r = await fetch(`${SB}/rest/v1/meta_campaigns?launch_id=eq.${encodeURIComponent(launchId)}&select=*&limit=1`, { headers: svc() });
  if (!r.ok) return null;
  return (await r.json())[0] || null;
}
async function listLaunches(slug) {
  const r = await fetch(`${SB}/rest/v1/meta_campaigns?store_slug=eq.${encodeURIComponent(slug)}&campaign_id=not.is.null&select=*&order=created_at.desc&limit=25`, { headers: svc() });
  return r.ok ? await r.json().catch(() => []) : [];
}
async function set(launchId, patch) { await rpc('meta_campaign_set', { p_launch_id: launchId, p_patch: patch }); }

const audit = (slug, launchId, action, engine, ok, extra = {}) => logAdAction({
  store_slug: slug, launch_id: launchId || null, action, engine: engine || null, ok,
  actor: extra.actor || 'merchant', target_id: extra.targetId || null, error_code: extra.errorCode || null, detail: extra.detail || null,
});

// ── Meta Graph POST (create / update) ──────────────────────────────────────────
async function graphPost(path, params, token) {
  try {
    const r = await fetch(`${GRAPH}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...params, access_token: token }) });
    const body = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, body };
  } catch (e) { return { ok: false, status: 0, body: { error: { message: (e).message } } }; }
}

async function deleteObjects(made, token) {
  const removed = [];
  for (const { kind, id } of rollbackOrder(made)) {
    const r = await graphPost(String(id), { _method: 'DELETE' }, token);
    removed.push({ kind, id, ok: Boolean(r.ok && r.body?.success !== false) });
  }
  return removed;
}

const ids = (row) => ({ campaign_id: row.campaign_id || null, adset_id: row.adset_id || null, creative_id: row.creative_id || null, ad_id: row.ad_id || null });
const ID_KEY = { campaign: 'campaign_id', ad_set: 'adset_id', 'ad set': 'adset_id', creative: 'creative_id', ad: 'ad_id' };

// Meta's `message` is often just "Invalid parameter"; the useful detail is in
// error_user_title / error_user_msg and error_subcode. Keep all of it.
function describe(r) {
  const e = r?.body?.error || {};
  const parts = [e.message || `HTTP ${r?.status || 0}`];
  if (e.error_subcode) parts.push(`subcode ${e.error_subcode}`);
  const human = [e.error_user_title, e.error_user_msg].filter(Boolean).join(': ');
  if (human) parts.push(human);
  if (e.error_data?.blame_field_specs) parts.push(`fields ${JSON.stringify(e.error_data.blame_field_specs)}`);
  return parts.join(' · ');
}

// The ad account a launch was created in (recorded at creation), falling back to
// the store's current selection for launches made before it was recorded.
function launchAdAccount(row, acct) {
  return normalizeAdAccountId(row?.config?.adAccountId) || resolveAdAccount(acct).adAccount;
}

// ── CREATE (PAUSED, idempotent) ────────────────────────────────────────────────
async function doCreate(slug, launchId, input, meta) {
  if (!slugAllowed(slug)) return { error: 'not_allowed_in_this_environment' };
  const acct = await getMetaAccount(slug);
  if (!acct || acct.status !== 'connected' || !acct.access_token) return { error: 'not_connected' };
  // Tenant isolation: the account row is looked up BY SLUG, and the ad account
  // comes from the shared resolver — the merchant's persisted choice, never
  // array order and never an id supplied by the caller.
  const picked = resolveAdAccount(acct);
  if (picked.error) return { error: picked.error, adAccounts: picked.available };
  const adAccount = picked.adAccount;
  const config = await getStoreConfig(slug);
  const token = acct.access_token;

  // Engine and permissions, decided for THIS store and ad account.
  const conn = await resolveConnection({ slug, acct });
  if (conn.expired) return { error: 'reauth' };
  const decision = conn.decision;
  const hasWrite = conn.scopes.includes(SCOPES.write);
  if (decision.reason === 'account_unavailable') return { error: 'ad_account_unavailable' };
  if (!decision.canCreate) return { error: 'missing_permission', permission: CREATE_PERMISSION, granted: [...conn.scopes].sort() };
  let engine = decision.engine;

  const budgetType = input.budgetType === 'daily' ? 'daily' : 'lifetime';
  const built = await buildCampaign({ slug, adId: adAccount, token, cfg: config || {} }, input);
  if (built.error) return built;
  if (!built.launchReady) return { error: 'blocked', launchBlockers: built.launchBlockers, warnings: built.warnings };

  // Full recommendation/config SNAPSHOT — frozen at creation (PAUSED), before any
  // spend, so the decision + "why" is preserved for measurement.
  const strategySource = meta?.strategy_source || 'pocketlink_reco';
  const experimentId = meta?.experiment_id || null;
  const snapshot = {
    capturedAt: new Date().toISOString(), strategySource, experimentId,
    goal: meta?.recommendation?.goal || null,
    objective: built.objective,
    audienceStrategy: input.audienceStrategy || 'auto',
    promote: built.creative?.promote || null,
    product: built.creative?.productName || null,
    productId: input.productId || null,
    location: { label: built.targeting?.label || null, radiusKm: input.radiusKm ?? null },
    age: { min: built.targeting?.ageMin ?? null, max: built.targeting?.ageMax ?? null },
    gender: built.targeting?.genderLabel || null,
    budget: { ...built.budget, type: budgetType },
    creative: built.creative ? { headline: built.creative.headline, primaryText: built.creative.primaryText, cta: built.creative.cta, imageUrl: built.creative.imageUrl } : null,
    media: input.imageHash ? { imageHash: input.imageHash } : null,
    destination: built.creative?.link || null,
    pageId: built.page?.id || null,
    instagramId: config?.meta?.igId || null,
    pixelId: config?.meta?.pixelId || config?.metaPixelId || null,
    adAccountId: adAccount,
    engine,
    reason: meta?.recommendation?.overall || null,
    reasons: meta?.recommendation?.reasons || null,
  };

  const claim = await rpc('meta_campaign_claim', { p_launch_id: launchId, p_store_slug: slug, p_config: snapshot });
  if (claim === 'already_created') { const row = await getLaunch(launchId); return { ok: true, status: row.status, launchId, ids: ids(row), alreadyCreated: true, mode: modeOf(engineOfRow(row)) }; }
  if (claim === 'locked') return { error: 'in_progress' };
  if (claim === 'exhausted') return { error: 'exhausted' };

  // An automation session that cannot even open creates nothing, so switching to
  // the Marketing API at this point cannot duplicate anything.
  let session = null;
  if (engine === 'mcp') {
    session = await openMcpSession(token);
    if (session.error) {
      if (!hasWrite) {
        await set(launchId, { status: 'failed', error: `automation: ${session.error.code}` });
        await audit(slug, launchId, 'create', 'mcp', false, { errorCode: session.error.code });
        return { error: 'automation_unavailable_now', code: session.error.code };
      }
      engine = 'graph';
      session = null;
      snapshot.engine = 'graph';
      snapshot.engineFallback = 'automation_session_failed';
    }
  }

  await set(launchId, {
    objective: built.objective.key, daily_budget: built.budget.daily, days: built.budget.days, lifetime_minor: built.budget.lifetimeMinor,
    currency: built.currency, spend_cap_set: built.budget.spendCapApplied, page_id: built.page.id, strategy_source: strategySource,
    experiment_id: experimentId, error: '', engine, budget_type: budgetType, media: snapshot.media, config: snapshot,
  });

  return engine === 'mcp'
    ? createWithMcp({ slug, launchId, built, session, adAccount, token, hasWrite, budgetType, config, input })
    : createWithGraph({ slug, launchId, built, adAccount, token, budgetType });
}

async function createWithMcp({ slug, launchId, built, session, adAccount, token, hasWrite, budgetType, config, input }) {
  const args = mcpCreateArgs(built, { budgetType, igUserId: config?.meta?.igId || null, imageHash: input.imageHash || null });
  if (args.error) {
    await set(launchId, { status: 'failed', error: `plan: ${args.error}` });
    return { error: args.error === 'blocked' ? 'blocked' : 'plan_invalid', message: args.error };
  }
  const row = await getLaunch(launchId);
  const result = await createPausedViaMcp(session, args, {
    existing: ids(row || {}),
    onCreated: async (_kind, key, id) => { await set(launchId, { [key]: id }); },
    request: `Create a paused campaign "${built.payloads?.campaign?.body?.name || ''}" that the merchant approved in PocketLink.`,
  });

  if (!result.ok) {
    const message = `${result.step}: ${result.error?.code || 'meta_error'} ${result.error?.message || ''}`.trim().slice(0, 500);
    if (result.uncertain) {
      // Meta may have created the object without telling us. Never retry blindly:
      // leave everything paused, record it, and let the merchant check.
      await set(launchId, { status: 'partial', error: `${message} (unconfirmed)` });
      await audit(slug, launchId, 'create', 'mcp', false, { errorCode: 'uncertain', detail: { step: result.step, made: result.made } });
      return { error: 'uncertain', step: result.step, mode: 'automated', ids: result.ids };
    }
    // A definite failure: remove what THIS call made. Automation has no delete
    // tool for these objects, so it uses the Marketing API when permitted.
    const removed = hasWrite ? await deleteObjects(result.made, token) : [];
    const removedIds = new Set(removed.filter((x) => x.ok).map((x) => x.id));
    const leftovers = result.made.filter((m) => !removedIds.has(m.id));
    const clear = Object.fromEntries(result.made.filter((m) => removedIds.has(m.id)).map((m) => [ID_KEY[m.kind], null]));
    await set(launchId, { status: leftovers.length ? 'partial' : 'failed', error: message, ...clear });
    await audit(slug, launchId, 'create', 'mcp', false, { errorCode: result.error?.code, detail: { step: result.step, leftovers } });
    if (removed.length) await audit(slug, launchId, 'rollback', 'graph', leftovers.length === 0, { detail: { removed } });
    return {
      error: 'failed', step: result.step, code: result.error?.code || null, message: result.error?.message || '',
      mode: 'automated', cleanedUp: leftovers.length === 0, leftovers: leftovers.map((x) => `${x.kind} ${x.id}`),
    };
  }

  // Read back. If Meta reports anything running, pause the campaign immediately.
  const verified = await readStatusesViaMcp(session, adAccount, result.ids);
  if (verified.anyActive) await pauseViaMcp(session, adAccount, result.ids.campaign_id);
  await set(launchId, { status: 'created', error: '' });
  await audit(slug, launchId, 'create', 'mcp', true, { targetId: result.ids.campaign_id, detail: { ids: result.ids, notRunning: verified.notRunning } });
  return {
    ok: true, status: 'created', launchId, ids: result.ids, mode: 'automated',
    page: built.page, budget: { ...built.budget, type: budgetType }, warnings: built.warnings,
    verified: { allPaused: verified.notRunning && !verified.anyActive, statuses: verified.statuses, pausedAfterCheck: verified.anyActive },
    adsManagerUrl: `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${adAccount.replace(/^act_/, '')}&selected_campaign_ids=${result.ids.campaign_id}`,
  };
}

async function createWithGraph({ slug, launchId, built, adAccount, token, budgetType }) {
  // Live permission gate for the Marketing API path.
  const perms = await getGrantedPermissions(token);
  if (!perms.granted) return { error: 'permission_check_failed', message: perms.error };
  if (!perms.granted.has(CREATE_PERMISSION)) {
    return { error: 'missing_permission', permission: CREATE_PERMISSION, granted: [...perms.granted].sort() };
  }

  const row = await getLaunch(launchId);
  const P = built.payloads;
  const adsetBody = { ...P.adset.body };
  if (budgetType === 'daily') {
    delete adsetBody.lifetime_budget;
    adsetBody.daily_budget = Math.round(Number(built.budget.daily) * 100);
  }

  const created = [];
  const fail = async (step, r) => {
    const why = describe(r);
    const removed = await deleteObjects(created, token);
    const leftovers = removed.filter((x) => !x.ok);
    const clear = Object.fromEntries(removed.filter((x) => x.ok).map((x) => [ID_KEY[x.kind], null]));
    await set(launchId, { status: leftovers.length ? 'partial' : 'failed', error: `${step}: ${why}`, ...clear });
    await audit(slug, launchId, 'create', 'graph', false, { errorCode: 'failed', detail: { step, leftovers } });
    return { error: 'failed', step, message: why, mode: 'standard', cleanedUp: leftovers.length === 0, leftovers: leftovers.map((x) => `${x.kind} ${x.id}`) };
  };

  if (!row.campaign_id) {
    const r = await graphPost(`${adAccount}/campaigns`, P.campaign.body, token);
    if (!r.ok || !r.body?.id) return fail('campaign', r);
    created.push({ kind: 'campaign', id: r.body.id });
    await set(launchId, { campaign_id: r.body.id }); row.campaign_id = r.body.id;
  }
  if (!row.adset_id) {
    const r = await graphPost(`${adAccount}/adsets`, { ...adsetBody, campaign_id: row.campaign_id }, token);
    if (!r.ok || !r.body?.id) return fail('adset', r);
    created.push({ kind: 'ad set', id: r.body.id });
    await set(launchId, { adset_id: r.body.id }); row.adset_id = r.body.id;
  }
  if (!row.creative_id) {
    const r = await graphPost(`${adAccount}/adcreatives`, P.adcreative.body, token);
    if (!r.ok || !r.body?.id) return fail('creative', r);
    created.push({ kind: 'creative', id: r.body.id });
    await set(launchId, { creative_id: r.body.id }); row.creative_id = r.body.id;
  }
  if (!row.ad_id) {
    const r = await graphPost(`${adAccount}/ads`, { ...P.ad.body, adset_id: row.adset_id, creative: { creative_id: row.creative_id } }, token);
    if (!r.ok || !r.body?.id) return fail('ad', r);
    created.push({ kind: 'ad', id: r.body.id });
    await set(launchId, { ad_id: r.body.id }); row.ad_id = r.body.id;
  }
  // Read the objects back from Meta and confirm they really are PAUSED.
  const verified = await verifyPaused(row, token);
  await set(launchId, { status: 'created', error: '' });
  await audit(slug, launchId, 'create', 'graph', true, { targetId: row.campaign_id, detail: { ids: ids(row), allPaused: verified.allPaused } });
  return {
    ok: true, status: 'created', launchId, ids: ids(row), mode: 'standard',
    page: built.page, budget: { ...built.budget, type: budgetType }, warnings: built.warnings,
    verified,
    adsManagerUrl: `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${adAccount.replace(/^act_/, '')}&selected_campaign_ids=${row.campaign_id}`,
  };
}

// Read back effective_status/status for each created object (Marketing API).
async function verifyPaused(row, token) {
  const targets = [['campaign', row.campaign_id], ['adset', row.adset_id], ['ad', row.ad_id]].filter(([, id]) => id);
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

// ── Control: activate / resume / pause / stop ─────────────────────────────────
async function control(row, action, staffUid) {
  if (!slugAllowed(row.store_slug)) return { error: 'not_allowed_in_this_environment' };
  const spends = action === 'activate' || action === 'resume';
  if (spends && activationBlocked()) return { error: 'activation_disabled_in_this_environment' };
  if (!row.campaign_id) return { error: 'not_created' };
  const acct = await getMetaAccount(row.store_slug);
  const token = acct?.access_token;
  if (!token) return { error: 'not_connected' };
  const engine = engineOfRow(row);
  const newStatus = { activate: 'active', resume: 'active', pause: 'paused', stop: 'stopped' }[action];

  if (engine === 'mcp') {
    const session = await openMcpSession(token);
    if (session.error) return { error: 'automation_unavailable_now', code: session.error.code };
    const adAccount = launchAdAccount(row, acct);
    const request = `The merchant chose to ${action} campaign ${row.campaign_id} in PocketLink.`;
    const r = action === 'activate' ? await activateViaMcp(session, adAccount, ids(row), { request })
      : action === 'resume' ? await resumeViaMcp(session, adAccount, row.campaign_id, { request })
      : await pauseViaMcp(session, adAccount, row.campaign_id, { request });
    if (!r.ok) {
      await set(row.launch_id, { error: `${action}: ${r.error?.code || 'meta_error'} ${r.error?.message || ''}`.trim().slice(0, 500) });
      await audit(row.store_slug, row.launch_id, action, 'mcp', false, { targetId: row.campaign_id, errorCode: r.error?.code, detail: { step: r.step || null } });
      return { error: `${action}_failed`, code: r.error?.code || null, message: r.error?.message || 'Meta rejected the change', mode: 'automated' };
    }
  } else {
    const targets = [row.campaign_id, ...(spends ? [row.adset_id, row.ad_id] : [])].filter(Boolean);
    for (const id of targets) {
      const r = await graphPost(`${id}`, { status: spends ? 'ACTIVE' : 'PAUSED' }, token);
      if (!r.ok) {
        await set(row.launch_id, { error: `${action}: ${r.body?.error?.message || r.status}` });
        await audit(row.store_slug, row.launch_id, action, 'graph', false, { targetId: id, errorCode: 'meta_error' });
        return { error: `${action}_failed`, message: r.body?.error?.message || 'Meta rejected the change', mode: 'standard' };
      }
    }
  }
  const patch = { status: newStatus, error: '' };
  if (spends) { patch.activated_by = staffUid || 'merchant'; patch.activated_at = 'now'; }
  await set(row.launch_id, patch);
  await audit(row.store_slug, row.launch_id, action, engine, true, { targetId: row.campaign_id, actor: staffUid ? 'staff' : 'merchant' });
  return { ok: true, status: newStatus, mode: modeOf(engine) };
}

// ── Budget ─────────────────────────────────────────────────────────────────────
/** Does this change raise the budget? (Raising a running campaign needs a step-up.) */
export function raisesBudget(row, budgetType, amount) {
  const current = budgetType === 'daily' ? Number(row?.daily_budget || 0) : Number(row?.lifetime_minor || 0) / 100;
  return Number(amount) > current;
}

async function updateBudget(row, body, stepUp) {
  if (!slugAllowed(row.store_slug)) return { error: 'not_allowed_in_this_environment' };
  if (!row.campaign_id) return { error: 'not_created' };
  const budgetType = body.budgetType === 'daily' ? 'daily' : body.budgetType === 'lifetime' ? 'lifetime' : null;
  if (!budgetType) return { error: 'invalid_budget_type' };
  // Meta does not switch a campaign between daily and lifetime budgets.
  if (budgetType !== (row.budget_type || row.config?.budget?.type || 'lifetime')) return { error: 'budget_type_fixed' };
  const check = budgetFields({ budgetType, amount: body.amount });
  if (check.error) return { error: check.error, cap: check.cap ?? null };
  if (row.status === 'active' && raisesBudget(row, budgetType, body.amount)) {
    if (activationBlocked()) return { error: 'activation_disabled_in_this_environment' };
    if (!(await stepUp())) return { error: 'otp_required' };
  }

  const acct = await getMetaAccount(row.store_slug);
  const token = acct?.access_token;
  if (!token) return { error: 'not_connected' };
  const engine = engineOfRow(row);
  let r;
  if (engine === 'mcp') {
    const session = await openMcpSession(token);
    if (session.error) return { error: 'automation_unavailable_now', code: session.error.code };
    r = await updateBudgetViaMcp(session, launchAdAccount(row, acct), { entityType: 'campaign', entityId: row.campaign_id, budgetType, amount: body.amount }, { request: `The merchant changed the ${budgetType} budget in PocketLink.` });
  } else {
    // Marketing API launches keep their budget on the ad set.
    const g = await graphPost(`${row.adset_id}`, check.fields, token);
    r = g.ok ? { ok: true } : { ok: false, error: { code: 'meta_error', message: describe(g) } };
  }
  if (!r.ok) {
    await audit(row.store_slug, row.launch_id, 'budget', engine, false, { targetId: row.campaign_id, errorCode: r.error?.code, detail: { budgetType, amount: Number(body.amount) } });
    return { error: 'budget_failed', code: r.error?.code || null, message: r.error?.message || '', mode: modeOf(engine) };
  }
  await set(row.launch_id, budgetType === 'daily' ? { daily_budget: Math.round(Number(body.amount)) } : { lifetime_minor: Math.round(Number(body.amount) * 100) });
  await audit(row.store_slug, row.launch_id, 'budget', engine, true, { targetId: row.campaign_id, detail: { budgetType, amount: Number(body.amount), pending: Boolean(r.pending) } });
  return { ok: true, budgetType, amount: Number(body.amount), pending: Boolean(r.pending), mode: modeOf(engine) };
}

// ── Targeting ──────────────────────────────────────────────────────────────────
async function updateTargeting(row, body) {
  if (!slugAllowed(row.store_slug)) return { error: 'not_allowed_in_this_environment' };
  if (!row.adset_id) return { error: 'not_created' };
  const acct = await getMetaAccount(row.store_slug);
  const token = acct?.access_token;
  if (!token) return { error: 'not_connected' };
  const config = await getStoreConfig(row.store_slug);
  const adAccount = launchAdAccount(row, acct);

  // Same builder as creation, so the targeting rules (age floors, Advantage+ open
  // age limit, location resolution) cannot drift. Budget inputs are irrelevant.
  const built = await buildCampaign({ slug: row.store_slug, adId: adAccount, token, cfg: config || {} }, {
    objective: row.objective || row.config?.objective?.key || 'traffic', days: 1, dailyBudget: 1, promote: 'store',
    ageMin: body.ageMin, ageMax: body.ageMax, gender: body.gender, radiusKm: body.radiusKm, audienceStrategy: body.audienceStrategy,
  });
  if (built.error) return { error: built.error };
  if (!built.targeting?.resolved) return { error: 'no_location' };
  const targeting = built.payloads.adset.body.targeting;

  const engine = engineOfRow(row);
  let r;
  if (engine === 'mcp') {
    const session = await openMcpSession(token);
    if (session.error) return { error: 'automation_unavailable_now', code: session.error.code };
    r = await updateTargetingViaMcp(session, adAccount, row.adset_id, targeting, { request: 'The merchant changed who sees the ad in PocketLink.' });
  } else {
    const g = await graphPost(`${row.adset_id}`, { targeting }, token);
    r = g.ok ? { ok: true } : { ok: false, error: { code: 'meta_error', message: describe(g) } };
  }
  await audit(row.store_slug, row.launch_id, 'targeting', engine, r.ok, { targetId: row.adset_id, errorCode: r.ok ? null : r.error?.code, detail: { targeting: built.targeting } });
  if (!r.ok) return { error: 'targeting_failed', code: r.error?.code || null, message: r.error?.message || '', mode: modeOf(engine) };
  return { ok: true, targeting: built.targeting, warnings: built.warnings, pending: Boolean(r.pending), mode: modeOf(engine) };
}

// ── Media ──────────────────────────────────────────────────────────────────────
async function uploadMedia(slug, body) {
  if (!slugAllowed(slug)) return { error: 'not_allowed_in_this_environment' };
  const acct = await getMetaAccount(slug);
  if (!acct || acct.status !== 'connected' || !acct.access_token) return { error: 'not_connected' };
  const conn = await resolveConnection({ slug, acct });
  if (conn.expired) return { error: 'reauth' };
  if (conn.decision.engine !== 'mcp') {
    // The standard path attaches images by URL at creation; nothing to upload.
    return { ok: true, mode: 'standard', useUrl: true };
  }
  const session = await openMcpSession(acct.access_token);
  if (session.error) return { error: 'automation_unavailable_now', code: session.error.code };
  const r = await uploadMediaViaMcp(session, resolveAdAccount(acct).adAccount, { url: body.url, type: body.type, name: body.name }, { request: 'The merchant added an ad image or video in PocketLink.' });
  await audit(slug, null, 'upload', 'mcp', r.ok, { errorCode: r.ok ? null : r.error?.code, detail: { type: r.type || body.type || 'IMAGE' } });
  if (!r.ok) return { error: 'upload_failed', code: r.error?.code || null, mode: 'automated' };
  return { ok: true, mode: 'automated', type: r.type, imageHash: r.imageHash || null, videoId: r.videoId || null };
}

// ── Diagnostics ────────────────────────────────────────────────────────────────
async function launchErrors(row) {
  if (!row.campaign_id) return { ok: true, errors: [] };
  const acct = await getMetaAccount(row.store_slug);
  const token = acct?.access_token;
  if (!token) return { error: 'not_connected' };
  const engine = engineOfRow(row);
  if (engine === 'mcp') {
    const session = await openMcpSession(token);
    if (!session.error) {
      const r = await errorsViaMcp(session, [row.campaign_id, row.adset_id, row.ad_id].filter(Boolean));
      if (r.ok) return { ok: true, errors: r.errors, mode: 'automated' };
    }
  }
  // Marketing API view of the ad: delivery issues and review feedback.
  if (!row.ad_id) return { ok: true, errors: [], mode: modeOf(engine) };
  const g = await graphGet(row.ad_id, { fields: 'effective_status,issues_info,ad_review_feedback', access_token: token });
  if (g?.body?.error) return { error: 'errors_unavailable', message: g.body.error.message || '' };
  const issues = (Array.isArray(g.body?.issues_info) ? g.body.issues_info : []).map((i) => ({ entityId: row.ad_id, title: i.error_summary || 'Delivery issue', message: i.error_message || '' }));
  const review = g.body?.ad_review_feedback?.global
    ? Object.entries(g.body.ad_review_feedback.global).map(([title, message]) => ({ entityId: row.ad_id, title, message: String(message) }))
    : [];
  return { ok: true, errors: [...issues, ...review], effectiveStatus: g.body?.effective_status || null, mode: modeOf(engine) };
}

/** Ledger row → what the browser may see (no engine names, no raw config). */
export function publicLaunch(row) {
  return {
    launchId: row.launch_id, status: row.status, ids: ids(row), mode: modeOf(engineOfRow(row)),
    objective: row.objective || null, budgetType: row.budget_type || row.config?.budget?.type || 'lifetime',
    dailyBudget: row.daily_budget ?? null, lifetimeBudget: row.lifetime_minor != null ? Number(row.lifetime_minor) / 100 : null,
    days: row.days ?? null, currency: row.currency || null,
    product: row.config?.product || null, headline: row.config?.creative?.headline || null, imageUrl: row.config?.creative?.imageUrl || null,
    targeting: row.config ? { location: row.config.location?.label || null, age: row.config.age || null, gender: row.config.gender || null, strategy: row.config.audienceStrategy || null } : null,
    error: row.error || null, createdAt: row.created_at || null, activatedAt: row.activated_at || null,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'method' }); return; }
  try {
    if (!serviceKey()) { res.status(503).json({ error: 'not_configured' }); return; }

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const action = String(body.action || '');
    const launchId = String(body.launchId || '');
    const hashedPin = String(body.hashedPin || '');

    // A staff session is optional and resolved once. It is an ALTERNATIVE to
    // the merchant's PIN, never a requirement.
    const staff = await staffRole(req);

    // Which store is this call about? For create / list / upload the caller names
    // it; for every other action it comes from the launch row — so a caller cannot
    // act on someone else's launch by presenting a PIN they happen to know.
    let slug;
    let target = null;
    if (['create', 'list', 'upload-media'].includes(action)) {
      slug = String(body.slug || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 60);
      if (!slug || (action === 'create' && !launchId)) { res.status(400).json({ error: 'missing' }); return; }
    } else {
      if (!launchId) { res.status(400).json({ error: 'missing' }); return; }
      target = await getLaunch(launchId);
      if (!target) { res.status(404).json({ error: 'unknown_launch' }); return; }
      slug = String(target.store_slug || '').toLowerCase();
    }

    if (!staff?.role && !(await verifyStorePin(slug, hashedPin))) {
      res.status(403).json({ error: 'pin' });
      return;
    }

    // Merchant production gate: create, spend and edits stay off for non-pilot
    // stores until Meta's approval is confirmed.
    if (WRITE_ACTIONS.includes(action) && !merchantWritesAllowed(slug)) {
      res.status(403).json({ error: 'writes_disabled' });
      return;
    }

    if (action === 'create') {
      res.status(200).json(await doCreate(slug, launchId,
        { objective: body.objective, days: body.days, dailyBudget: body.dailyBudget, budgetType: body.budgetType, promote: body.promote, productId: body.productId, gender: body.gender, radiusKm: body.radiusKm, ageMin: body.ageMin, ageMax: body.ageMax, audienceStrategy: body.audienceStrategy, imageHash: body.imageHash },
        { recommendation: body.recommendation, strategy_source: body.strategy_source, experiment_id: body.experiment_id }));
      return;
    }
    if (action === 'list') { res.status(200).json({ ok: true, launches: (await listLaunches(slug)).map(publicLaunch) }); return; }
    if (action === 'upload-media') { res.status(200).json(await uploadMedia(slug, body)); return; }

    // Activation is the ONLY step that spends, so a 4-digit PIN is not enough.
    if (action === 'activate' || action === 'resume') {
      if (activationBlocked()) { res.status(403).json({ error: 'activation_disabled_in_this_environment' }); return; }
      const allowed = activationAllowed(staff?.role, await otpStepUp(slug, body.otpCode));
      if (!allowed) { res.status(403).json({ error: 'otp_required' }); return; }
      res.status(200).json(await control(target, action, staff?.uid || null));
      return;
    }
    if (action === 'pause' || action === 'stop') { res.status(200).json(await control(target, action, staff?.uid || null)); return; }
    if (action === 'update-budget') {
      const stepUp = async () => activationAllowed(staff?.role, await otpStepUp(slug, body.otpCode));
      res.status(200).json(await updateBudget(target, body, stepUp));
      return;
    }
    if (action === 'update-targeting') { res.status(200).json(await updateTargeting(target, body)); return; }
    if (action === 'errors') { res.status(200).json(await launchErrors(target)); return; }
    if (action === 'status') { res.status(200).json({ ok: true, launch: publicLaunch(target) }); return; }

    res.status(400).json({ error: 'unknown_action' });
  } catch {
    res.status(200).json({ error: 'server' });
  }
}

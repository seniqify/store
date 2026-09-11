// POST /api/meta/campaign-launch — Stage 2D: campaign launch + control.
//
// Creates the previewed campaign on Meta and controls it. Actions:
//   create   — build (shared builder) → validate → claim (idempotency lease) →
//              create campaign→adset→creative→ad, ALL PAUSED, resume-forward.
//   activate — enable spend: set campaign+adset+ad ACTIVE. Needs a step-up.
//   pause    — set campaign PAUSED (stops spend).
//   resume   — set campaign ACTIVE (spend-enable; same gate as activate).
//   stop     — set campaign PAUSED + mark stopped (kept, not deleted).
//   status   — read the launch ledger.
//
// AUTH: the store's own 4-digit Manage PIN, the same credential that opens the
// Ads dashboard, the preview and the Meta connection — because PocketLink
// sellers have no email accounts. A crm_team session is accepted as an
// alternative so staff-operated stores keep working. Activation additionally
// requires a one-time code sent to the store's REGISTERED WhatsApp number.
// SAFETY: everything is created PAUSED; activation is the only spend step;
// budgets are clamped server-side (₹5000/day · ₹25000 total · 30 days) in the
// shared builder; launch_id makes creation idempotent; a partial create resumes.
import { SB, ANON, serviceKey, verifyStorePin, getMetaAccount, getStoreConfig, resolveAdAccount, getGrantedPermissions, graphGet, slugAllowed, activationBlocked } from './_meta.js';
import { buildCampaign } from './_campaignBuild.js';

// Meta permission required to create delivery objects. Checked LIVE against
// /me/permissions before any write — stored scopes are only a connect-time record.
const CREATE_PERMISSION = 'ads_management';

const GRAPH = 'https://graph.facebook.com/v25.0';
const svc = (extra = {}) => ({ apikey: serviceKey(), Authorization: `Bearer ${serviceKey()}`, 'Content-Type': 'application/json', ...extra });

// ── Authorisation — merchant-first, matching how PocketLink actually works ────
//
// PocketLink sellers have no email accounts. A seller registers with a WhatsApp
// number, proves it with a one-time code, and thereafter opens /[store]/manage
// with a 4-digit PIN. So the PIN authorises campaign creation, exactly as it
// already authorises the Ads dashboard, the campaign preview and the Meta
// connection itself.
//
// This endpoint previously required a crm_team session. That was never a
// deliberate model for advertising — crm_team was simply the only table linking
// an auth user to any permission. The cost was that no merchant could reach the
// feature at all, which is precisely why there was no merchant journey to show
// Meta's reviewer.
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
// unaffected. Nothing here weakens an existing check; it adds the merchant path
// alongside it.
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
// A crm_team session is no longer REQUIRED for anything — it is an alternative
// to the merchant's PIN, so staff-operated stores keep working. Absent or
// invalid simply means "not staff", never an error.
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
// Codes are single-use: a successful check deletes them, exactly as the
// send-otp edge function does.
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
    // Single use — burn it whether or not the rest of the flow succeeds.
    await fetch(`${SB}/rest/v1/otp_codes?phone=eq.${encodeURIComponent(hit.phone)}`, { method: 'DELETE', headers: svc() });
    return true;
  } catch { return false; }
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

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const action = String(body.action || '');
    const launchId = String(body.launchId || '');
    const hashedPin = String(body.hashedPin || '');

    // A staff session is optional and resolved once. It is an ALTERNATIVE to
    // the merchant's PIN, never a requirement.
    const staff = await staffRole(req);

    // Which store is this call about? For create the caller names it; for every
    // other action it comes from the launch row — so a caller cannot act on
    // someone else's launch by presenting a PIN they happen to know.
    let slug;
    let target = null;
    if (action === 'create') {
      slug = String(body.slug || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 60);
      if (!slug || !launchId) { res.status(400).json({ error: 'missing' }); return; }
    } else {
      if (!launchId) { res.status(400).json({ error: 'missing' }); return; }
      target = await getLaunch(launchId);
      if (!target) { res.status(404).json({ error: 'unknown_launch' }); return; }
      slug = String(target.store_slug || '').toLowerCase();
    }

    // The merchant proves the store with the same PIN that opens Manage; staff
    // may act without one. Anyone else is refused before a single Graph call.
    if (!staff?.role && !(await verifyStorePin(slug, hashedPin))) {
      res.status(403).json({ error: 'pin' });
      return;
    }

    if (action === 'create') {
      res.status(200).json(await doCreate(slug, launchId,
        { objective: body.objective, days: body.days, dailyBudget: body.dailyBudget, promote: body.promote, productId: body.productId, gender: body.gender, radiusKm: body.radiusKm, ageMin: body.ageMin, ageMax: body.ageMax, audienceStrategy: body.audienceStrategy },
        { recommendation: body.recommendation, strategy_source: body.strategy_source, experiment_id: body.experiment_id }));
      return;
    }

    // Activation is the ONLY step that spends, so a 4-digit PIN is not enough.
    // Three independent server-side gates: the environment must permit
    // activation at all; then either a crm_team admin, or a merchant who has
    // just proved control of the store's REGISTERED WhatsApp number with a
    // one-time code. A paused-only environment refuses even an admin — that is
    // the point of it.
    if (action === 'activate' || action === 'resume') {
      if (activationBlocked()) { res.status(403).json({ error: 'activation_disabled_in_this_environment' }); return; }
      const allowed = activationAllowed(staff?.role, await otpStepUp(slug, body.otpCode));
      if (!allowed) { res.status(403).json({ error: 'otp_required' }); return; }
      res.status(200).json(await flip(launchId, 'ACTIVE', 'active', staff?.uid || null));
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

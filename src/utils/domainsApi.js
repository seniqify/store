// Owner-side client for the custom-domain API (POST /api/domains/manage, PR-C).
//
// Same-origin: Manage only ever runs on PocketLink, where the API lives. The PIN
// is hashed here exactly as every other owner action does (pinHash), and the
// server re-checks it on every call. Every answer is { outcome, ... }; this
// module turns outcomes into the card's step and into one plain sentence each.
import { hashPin } from './pinHash.js';

/** Call one action. Never throws: a network or server failure is an outcome too. */
export async function manageDomain(slug, pin, action, extra = {}, fetchImpl = globalThis.fetch) {
  try {
    const hashedPin = await hashPin(pin);
    const r = await fetchImpl('/api/domains/manage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...extra, action, slug, hashedPin }),
    });
    let body = null;
    try { body = await r.json(); } catch { /* not JSON */ }
    if (body && typeof body.outcome === 'string') return body;
    return { outcome: 'temporarily_unavailable' };
  } catch {
    return { outcome: 'network_error' };
  }
}

/**
 * Which step the card shows for a `status` answer:
 *   hidden         the feature is off for this store (or the server is not set up) -- show nothing
 *   none           no domain yet: ask for one
 *   pending        claimed: publish the TXT record, then verify
 *   verified       proved: point DNS at PocketLink (refresh shows the records)
 *   ready          DNS is right: send the WhatsApp code, then go live
 *   connected      live
 *   misconfigured  was live, DNS no longer points here
 *   disconnecting  being removed
 *   error          could not load (show a retry)
 */
export function domainStep(res) {
  const outcome = res?.outcome;
  if (outcome === 'feature_disabled' || outcome === 'not_configured' || outcome === 'unauthorized') return 'hidden';
  if (outcome !== 'ok') return 'error';
  const status = res.domain?.status;
  if (!status) return 'none';
  return ['pending', 'verified', 'ready', 'connected', 'misconfigured', 'disconnecting'].includes(status) ? status : 'none';
}

/** The hostname every shared link should use -- only while it is connected AND served. */
export function liveDomain(res) {
  return res?.outcome === 'ok' && res.serving === true && res.domain?.status === 'connected'
    ? String(res.domain.primary_host || '') || null
    : null;
}

/** The "www" name of an apex group, when there is one (for "use www as main address"). */
export function otherName(domain) {
  const rows = domain?.hostnames || [];
  return rows.find((h) => h.hostname !== domain.primary_host)?.hostname || null;
}

/**
 * The TXT record's name as most DNS panels want it (relative to the domain).
 * For an apex/www group the record is _pocketlink.<apex>, so the panel name is
 * "_pocketlink". For a subdomain group the full name is shown as is.
 */
export function txtPanelName(domain) {
  const full = domain?.txt?.name || '';
  const apex = (domain?.hostnames || []).find((h) => h.kind === 'apex')?.hostname;
  return apex && full === `_pocketlink.${apex}` ? '_pocketlink' : full;
}

const SUCCESS = new Set(['ok', 'claimed', 'already_claimed', 'verified', 'otp_sent', 'connected', 'disconnected',
  'disconnecting', 'already_primary']);

/** Plain sentences for every refusal the server can give. */
export const DOMAIN_MESSAGES = {
  invalid_hostname: 'That doesn’t look like a domain. Try something like yourbrand.com.',
  unknown_suffix: 'That domain ending isn’t recognised. Check the spelling (for example yourbrand.com or yourbrand.in).',
  reserved_hostname: 'That domain can’t be used.',
  hostname_in_use: 'This domain is already connected to another PocketLink shop.',
  hostname_releasing: 'This domain is being released. Please try again in a few minutes.',
  store_has_open_group: 'You already have a domain in progress. Finish or cancel it first.',
  store_not_found: 'We couldn’t find your shop. Please reload the page.',
  no_domain: 'There’s no domain set up yet.',
  not_pending: 'This step is already done. Reload to see where you are.',
  txt_not_found: 'We can’t see the record yet. DNS changes can take up to 30 minutes — check that you added it exactly as shown, then try again.',
  not_verified: 'Prove the domain is yours first (step 1).',
  not_ready: 'Your domain isn’t pointing to PocketLink yet. Add the records in step 2, then check again.',
  vercel_not_ready: 'Your domain isn’t pointing to PocketLink yet. Add the records in step 2, then check again.',
  vercel_unavailable: 'We couldn’t check your domain right now. Please try again in a minute.',
  busy: 'Another check is already running. Please try again in a minute.',
  otp_not_configured: 'Sending codes isn’t available right now. Please try again later.',
  owner_phone_missing: 'There’s no owner WhatsApp number on your shop, so we can’t send a code.',
  otp_send_failed: 'We couldn’t send the WhatsApp code. Please try again.',
  rate_limited: 'Too many codes. Please wait 10 minutes and try again.',
  invalid_code: 'That code is wrong or has expired. Send a new code and try again.',
  expired: 'That code has expired. Send a new code and try again.',
  not_connected: 'Your domain isn’t live yet.',
  not_apex_group: 'This option is only for a domain with a www version.',
  target_not_in_group: 'That name isn’t part of your domain.',
  hostname_not_in_group: 'That name isn’t part of your domain.',
  already_disconnecting: 'Your domain is already being disconnected.',
  group_ended: 'This domain request has ended. Start again.',
  not_active: 'This domain request has ended. Start again.',
  not_found: 'This domain request has ended. Start again.',
  lost_race: 'Another shop proved this domain first.',
  token_mismatch: 'The record doesn’t match. Copy it again exactly as shown.',
  action_not_applicable: 'That step doesn’t apply right now. Reload to see where you are.',
  not_allowed: 'That step doesn’t apply right now. Reload to see where you are.',
  vercel_settling: 'Your domain is still being set up. Please try again in a couple of minutes.',
  vercel_not_removed: 'We’re still removing your domain. Please check again in a minute.',
  not_configured: 'Own domains aren’t available right now.',
  feature_disabled: 'Own domains aren’t available for your shop yet.',
  unauthorized: 'Your PIN session has expired. Please reload and enter your PIN again.',
  invalid_action: 'Something went wrong. Please reload and try again.',
  bad_request: 'Something went wrong. Please reload and try again.',
  json_required: 'Something went wrong. Please reload and try again.',
  method_not_allowed: 'Something went wrong. Please reload and try again.',
  temporarily_unavailable: 'Something went wrong on our side. Please try again in a minute.',
  network_error: 'Couldn’t reach PocketLink. Check your internet and try again.',
};

export const FALLBACK_MESSAGE = 'Something went wrong. Please try again — or WhatsApp us and we’ll help.';

/** null for a success outcome; otherwise one plain sentence. */
export function domainMessage(outcome) {
  if (SUCCESS.has(outcome)) return null;
  return DOMAIN_MESSAGES[outcome] || FALLBACK_MESSAGE;
}

// Merchant-facing custom-domain flows (server side). Called only AFTER the
// store PIN has been verified for `slug`; the store is identified by that
// verified slug alone, and its group is always looked up here -- a group id,
// token or phone number from the browser is never accepted.
//
// Every write goes through a PR-B RPC. Every answer is a small, safe object:
// never a code, an HMAC, a Vercel token, a group id or internal audit detail.
// The TXT token IS shown to the authenticated owner -- publishing it is the
// whole point of the ownership check.
//
// Every flow that calls Vercel for the group or records what Vercel said --
// verify (its attach), refresh, activate, disconnect -- first takes the
// group's lease (PR-B.1), the same one the reconciler takes, and gives it back
// when done. While another execution holds it the answer is 'busy', returned
// BEFORE anything else happens: no Vercel call, no write, and no step-up code
// checked or spent. status (a read-only Vercel look), claim, request_otp and
// set_primary touch neither Vercel nor its recorded state, so they take none.
import { classifyHostname, normalizeHostInput, txtNameForRows } from './_parse.js';
import { proveTxtToken } from './_dns.js';
import { generateOtp, otpHash, normalizeOwnerPhone, maskPhone, sendWhatsAppOtp } from './_otp.js';
import { OPEN_STATUSES } from './_db.js';
import { missingConfig } from './_config.js';
import { syncGroup, releaseGroup } from './_steps.js';

export const STEP_UP_ACTIONS = ['activate', 'set_primary', 'disconnect'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SIX_DIGITS = /^\d{6}$/;
const TXT_STATUSES = new Set(['pending', 'verified', 'ready']);

/** What the owner may see about their domain. */
export function domainView(g) {
  if (!g) return null;
  return {
    status: g.status,
    primary_host: g.primary,
    hostnames: g.rows.map((r) => ({ hostname: r.hostname, kind: r.kind, role: r.role, vercel: r.vercel_state })),
    expires_at: g.expires_at ?? null,
    // Needed until activation (which re-checks it); never needed afterwards.
    txt: TXT_STATUSES.has(g.status) ? { type: 'TXT', name: txtNameForRows(g.rows), value: g.txt_token } : null,
  };
}

/**
 * Vercel's own ownership challenges for hostnames it has attached but not yet
 * verified -- validated (TXT, inside the merchant's own domain, printable,
 * bounded) by the Vercel client before they get here.
 */
function verificationFrom(results) {
  const out = [];
  for (const r of results) {
    if (r.vercel_state !== 'attached_unverified') continue;
    for (const c of r.verification || []) out.push({ host: r.host, type: c.type, name: c.name, value: c.value });
  }
  return out;
}

/**
 * deps: { config, db, vercel, budget?, fetchImpl?, dnsOptions?, whatsapp?, randomInt? }
 *   whatsapp({ receiver, code }) -> { sent } ; defaults to the Seniqify template
 */
export function createDomainService(deps) {
  const { config, db, vercel, randomInt } = deps;
  const dnsOptions = { ...(deps.dnsOptions || {}), budget: deps.budget || undefined };
  const whatsapp = deps.whatsapp || (({ receiver, code }) =>
    sendWhatsAppOtp({ url: config.whatsappUrl, apiKey: config.whatsappKey, receiver, code, fetchImpl: deps.fetchImpl }));

  async function openGroup(slug) {
    const groups = await db.groupsForStore(slug);
    return groups.find((g) => OPEN_STATUSES.includes(g.status)) || null;
  }
  const withView = async (slug, extra) => ({ ...extra, domain: domainView(await openGroup(slug)) });

  /**
   * Run fn(leasedDeps, group) holding the group's lease; always give it back.
   * `group` is re-read under the lease, so fn never acts on a snapshot taken
   * before another execution's changes. Returns { value }, or -- when the group
   * is held elsewhere or gone -- { refused } with the answer for the merchant,
   * in which case fn never ran.
   */
  async function underLease(g, fn) {
    const l = await db.groupLease(g.group_id, g.store_slug);
    if (l.outcome !== 'leased') {
      return { refused: l.outcome === 'busy'
        ? { outcome: 'busy', retry_after_seconds: l.retry_after_seconds ?? null }
        : { outcome: l.outcome } };
    }
    try {
      const [fresh] = await db.groupsByIds([g.group_id]);
      if (!fresh) return { refused: { outcome: 'no_domain' } };
      return { value: await fn({ ...deps, lease: l.lease_token }, fresh) };
    } finally {
      try {
        await db.leaseRelease(g.group_id, g.store_slug, l.lease_token);
      } catch { /* it lapses by itself after 120 s */ }
    }
  }
  /** A lease lost mid-flow (only if the request outlived it): nothing was written; retry. */
  const LOST = { outcome: 'busy', retry_after_seconds: null };

  return {
    async status(slug) {
      const g = await openGroup(slug);
      const out = { outcome: 'ok', domain: domainView(g) };
      const pending = g ? g.rows.filter((r) => r.vercel_state === 'attached_unverified') : [];
      if (pending.length && vercel.configured) {
        // Read-only: what Vercel needs to see to verify these hostnames.
        const results = [];
        for (const r of pending) {
          const seen = await vercel.inspect(r.hostname);
          if (seen.attached && seen.verified !== true) {
            results.push({ host: r.hostname, vercel_state: 'attached_unverified', verification: seen.verification });
          }
        }
        out.vercel_verification = verificationFrom(results);
      }
      return out;
    },

    async claim(slug, hostnameInput) {
      const c = classifyHostname(hostnameInput);
      if (!c.ok) return { outcome: c.reason };
      const r = await db.claim(slug, c.primary, c.kind);
      if (r.outcome !== 'claimed' && r.outcome !== 'already_claimed') return { outcome: r.outcome };
      return withView(slug, { outcome: r.outcome });
    },

    /** Ownership proof: a LIVE TXT lookup, then domain_mark_verified. */
    async verify(slug) {
      const g = await openGroup(slug);
      if (!g) return { outcome: 'no_domain' };
      if (g.status !== 'pending') return { outcome: 'not_pending', domain: domainView(g) };
      const proof = await proveTxtToken(txtNameForRows(g.rows), g.txt_token, dnsOptions);
      if (proof.status === 'budget_exhausted') return { outcome: 'temporarily_unavailable' };
      if (!proof.proved) return { outcome: 'txt_not_found', dns: proof.status, domain: domainView(g) };
      const r = await db.markVerified(g.group_id, slug, proof.token);
      if (r.outcome !== 'verified') return withView(slug, { outcome: r.outcome });
      let vercel_verification = [];
      if (vercel.configured) {
        // Start attaching now so the merchant sees progress; the reconciler
        // finishes whatever this does not (including when the group is busy).
        try {
          const run = await underLease(g, (ld, g2) => syncGroup(ld, g2, { attach: true }));
          if (run.value) vercel_verification = verificationFrom(run.value.results);
        } catch { /* reconciler retries */ }
      }
      return withView(slug, { outcome: 'verified', vercel_verification });
    },

    /** Re-read Vercel for every hostname; attach what is missing (pre-activation). */
    async refresh(slug) {
      const g0 = await openGroup(slug);
      if (!g0) return { outcome: 'no_domain' };
      const REFRESHABLE = ['verified', 'ready', 'connected', 'misconfigured'];
      if (!REFRESHABLE.includes(g0.status)) return { outcome: 'not_verified', domain: domainView(g0) };
      if (!vercel.configured) return { outcome: 'not_configured' };
      const run = await underLease(g0, async (ld, g) => {
        if (!REFRESHABLE.includes(g.status)) return { outcome: 'not_verified' };
        const s = await syncGroup(ld, g, { attach: g.status === 'verified' || g.status === 'ready' });
        if (s.leaseLost) return LOST;
        const dns_records = s.results
          .filter((r) => r.recommended)
          .map((r) => {
            const apex = g.rows.find((x) => x.hostname === r.host)?.kind === 'apex';
            return apex
              ? { host: r.host, type: 'A', value: r.recommended.ipv4?.[0] ?? null }
              : { host: r.host, type: 'CNAME', value: r.recommended.cname ?? null };
          });
        return {
          outcome: s.anyUnknown ? 'vercel_unavailable' : 'ok',
          dns_records,
          vercel_verification: verificationFrom(s.results),
        };
      });
      return withView(slug, run.refused || run.value);
    },

    /** Send a step-up code to the store's OWNER phone (from the store record). */
    async requestOtp(slug, action, targetInput) {
      if (!STEP_UP_ACTIONS.includes(action)) return { outcome: 'invalid_action' };
      if (missingConfig(config, 'otp').length) return { outcome: 'otp_not_configured' };
      const g = await openGroup(slug);
      if (!g) return { outcome: 'no_domain' };
      const target = action === 'set_primary' ? normalizeHostInput(targetInput) : g.primary;
      if (!target) return { outcome: 'invalid_hostname' };

      const receiver = normalizeOwnerPhone(await db.storeOwnerPhone(slug));
      if (!receiver) return { outcome: 'owner_phone_missing' };

      const code = generateOtp(randomInt);
      const r = await db.challengeCreate(slug, g.group_id, action, target,
        otpHash(config.otpSecret, { slug, action, target, code }));
      if (r.outcome !== 'created') return { outcome: r.outcome };

      const s = await whatsapp({ receiver, code });
      if (s.sent === false) return { outcome: 'otp_send_failed' };
      return { outcome: 'otp_sent', challenge_id: r.challenge_id, expires_at: r.expires_at, sent_to: maskPhone(receiver) };
    },

    /**
     * Activation. Order matters -- nothing before step 5 can spend the code:
     *   1. the group's lease (else 'busy', and nothing else happens)
     *   2. the group is ready (or verified and becomes ready now)
     *   3. Vercel re-checked for EVERY hostname: all configured
     *   4. a FRESH TXT lookup finds the exact current token
     *   5. domain_leased_activate(lease, group, slug, proved_token, challenge_id,
     *      code_hash) -- which refuses a lost lease before the code is looked at
     */
    async activate(slug, challengeId, code) {
      if (!UUID.test(String(challengeId ?? '')) || !SIX_DIGITS.test(String(code ?? ''))) {
        return { outcome: 'invalid_code' };
      }
      const g0 = await openGroup(slug);
      if (!g0) return { outcome: 'no_domain' };
      if (g0.status !== 'ready' && g0.status !== 'verified') return { outcome: 'not_ready', domain: domainView(g0) };
      if (!vercel.configured) return { outcome: 'not_configured' };

      const run = await underLease(g0, async (ld, g) => {
        if (g.status !== 'ready' && g.status !== 'verified') return withView(slug, { outcome: 'not_ready' });
        const s = await syncGroup(ld, g, { attach: false });
        if (s.leaseLost) return withView(slug, LOST);                                    // code untouched
        if (s.anyUnknown) return { outcome: 'vercel_unavailable' };
        if (!s.allConfigured) return withView(slug, { outcome: 'vercel_not_ready' });

        const proof = await proveTxtToken(txtNameForRows(g.rows), g.txt_token, dnsOptions);
        if (proof.status === 'budget_exhausted') return { outcome: 'temporarily_unavailable' };   // code untouched
        if (!proof.proved) return withView(slug, { outcome: 'txt_not_found', dns: proof.status });

        const hash = otpHash(config.otpSecret, { slug, action: 'activate', target: g.primary, code: String(code) });
        const r = await db.activate(ld.lease, g.group_id, slug, proof.token, challengeId, hash);
        return withView(slug, r.outcome === 'lease_lost' ? LOST : { outcome: r.outcome });   // lost: code untouched
      });
      return run.refused ? withView(slug, run.refused) : run.value;
    },

    async setPrimary(slug, hostnameInput, challengeId, code) {
      if (!UUID.test(String(challengeId ?? '')) || !SIX_DIGITS.test(String(code ?? ''))) {
        return { outcome: 'invalid_code' };
      }
      const target = normalizeHostInput(hostnameInput);
      if (!target) return { outcome: 'invalid_hostname' };
      const g = await openGroup(slug);
      if (!g) return { outcome: 'no_domain' };
      const hash = otpHash(config.otpSecret, { slug, action: 'set_primary', target, code: String(code) });
      const r = await db.setPrimary(g.group_id, slug, target, challengeId, hash);
      return withView(slug, { outcome: r.outcome });
    },

    /**
     * Disconnect. A pending claim cancels without a code. A proven group needs
     * a 'disconnect' code; Vercel removal then runs under fresh remove intents,
     * and the database releases the names only once removal has settled. All
     * of it under the group's lease: 'busy' spends no code.
     */
    async disconnect(slug, challengeId, code) {
      const g0 = await openGroup(slug);
      if (!g0) return { outcome: 'no_domain' };
      const codeOk = UUID.test(String(challengeId ?? '')) && SIX_DIGITS.test(String(code ?? ''));
      if (g0.status !== 'pending' && g0.status !== 'disconnecting' && !codeOk) return { outcome: 'invalid_code' };

      const run = await underLease(g0, async (ld, g) => {
        let r;
        if (g.status === 'pending') {
          r = await db.beginDisconnect(ld.lease, g.group_id, slug, 'merchant');
        } else if (g.status === 'disconnecting') {
          r = { outcome: 'disconnecting' };                              // continue the cleanup
        } else {
          if (!codeOk) return { outcome: 'invalid_code' };
          const hash = otpHash(config.otpSecret, { slug, action: 'disconnect', target: g.primary, code: String(code) });
          r = await db.beginDisconnect(ld.lease, g.group_id, slug, 'merchant', challengeId, hash);
        }
        if (r.outcome === 'lease_lost') return LOST;                     // code untouched
        if (r.outcome !== 'disconnecting' || !vercel.configured) return { outcome: r.outcome };
        const [g2] = await db.groupsByIds([g.group_id]);
        const f = g2 && g2.status === 'disconnecting' ? await releaseGroup(ld, g2) : { outcome: 'disconnecting' };
        return {
          outcome: f.outcome === 'disconnected' ? 'disconnected' : 'disconnecting',
          retry_after_seconds: f.retry_after_seconds ?? null,
        };
      });
      return withView(slug, run.refused || run.value);
    },
  };
}

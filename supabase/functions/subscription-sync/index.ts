// ===========================================================================
//  subscription-sync  --  paying stores keep their plan
//
//  Once a day (pg_cron, supabase/subscription-sync-schedule.sql) this asks
//  Razorpay about every store that records a razorpaySubscriptionId and moves
//  the store's planExpiresAt forward when Razorpay says the mandate is active.
//  It does not depend on razorpay-webhook arriving: on 2026-11-11 no store's
//  expiry had ever been moved by the webhook, and monthly payers were lapsing
//  to Free on their renewal date while still being charged.
//
//  Extend-only. The decision is shared/subscription-sync.mjs (pure, tested);
//  the write is public.extend_store_plan_from_razorpay (service_role only),
//  which re-checks the subscription id under a row lock and merges two keys.
//
//  Auth: x-sweep-secret must match public.automation_secrets 'subscription-sync'
//  (verify_jwt is FALSE: the secret is the boundary, as for cart-reminders).
//  Body: { "dry_run": true } reports without writing; { "slug": "x" } limits
//  the run to one store. The response lists slugs, statuses and dates only,
//  never phone numbers.
//
//  Deploy (multi-file): entrypoint supabase/functions/subscription-sync/index.ts
//  + shared/subscription-sync.mjs + shared/razorpay-plans.mjs.
// ===========================================================================
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { syncDecision, reportLine } from '../../../shared/subscription-sync.mjs';

const MAX_STORES = 500;
const RZP_TIMEOUT_MS = 10000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Compare two secrets without leaking how much of them matched. */
function sameSecret(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

type Fetched = { sub: Record<string, unknown> | null; error?: string };

async function fetchSubscription(id: string, auth: string): Promise<Fetched> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), RZP_TIMEOUT_MS);
  try {
    const res = await fetch(`https://api.razorpay.com/v1/subscriptions/${encodeURIComponent(id)}`, {
      headers: { Authorization: auth },
      signal: ctrl.signal,
    });
    if (res.status === 404 || res.status === 400) return { sub: null };
    if (!res.ok) return { sub: null, error: `razorpay_${res.status}` };
    return { sub: await res.json() };
  } catch (e) {
    return { sub: null, error: (e as Error).name === 'AbortError' ? 'razorpay_timeout' : 'razorpay_unreachable' };
  } finally {
    clearTimeout(timer);
  }
}

serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: cfg, error: cfgErr } = await supabase
    .from('automation_secrets').select('secret').eq('name', 'subscription-sync').maybeSingle();
  if (cfgErr) return json({ error: 'secret_unavailable' }, 500);
  if (!sameSecret(String(cfg?.secret || ''), req.headers.get('x-sweep-secret') || '')) {
    return json({ error: 'unauthorized' }, 401);
  }

  let body: { dry_run?: unknown; slug?: unknown } = {};
  try { body = await req.json(); } catch { body = {}; }
  const dryRun = body.dry_run === true;
  const onlySlug = typeof body.slug === 'string' && body.slug ? body.slug : null;

  const keyId = Deno.env.get('RAZORPAY_KEY_ID') ?? '';
  const keySecret = Deno.env.get('RAZORPAY_KEY_SECRET') ?? '';
  if (!keyId || !keySecret) return json({ error: 'razorpay_not_configured' }, 500);
  const auth = 'Basic ' + btoa(`${keyId}:${keySecret}`);

  let q = supabase
    .from('stores')
    .select('slug, config')
    .like('config->>razorpaySubscriptionId', 'sub_%')
    .order('slug')
    .limit(MAX_STORES);
  if (onlySlug) q = q.eq('slug', onlySlug);
  const { data: stores, error: storesErr } = await q;
  if (storesErr) return json({ error: 'stores_unavailable' }, 500);

  const now = Date.now();
  const lines: Record<string, unknown>[] = [];
  let extended = 0;
  let failed = 0;

  for (const store of stores ?? []) {
    const subId = String(store.config?.razorpaySubscriptionId ?? '');
    const { sub, error } = await fetchSubscription(subId, auth);
    if (error) {
      failed++;
      lines.push({ slug: store.slug, action: 'skip', reason: error });
      continue;
    }

    const decision = syncDecision(store, sub, now);
    const line: Record<string, unknown> = reportLine(store.slug, sub, decision);

    if (decision.action === 'extend' && !dryRun) {
      const { data: result, error: rpcErr } = await supabase.rpc('extend_store_plan_from_razorpay', {
        p_slug: store.slug,
        p_subscription_id: subId,
        p_plan: decision.plan,
        p_expires_at: decision.expiresAt,
      });
      if (rpcErr) {
        failed++;
        line.result = 'db_error';
      } else {
        line.result = result;
        if (result === 'extended') extended++;
      }
    }
    lines.push(line);
  }

  const summary = {
    dry_run: dryRun,
    checked: lines.length,
    would_extend: lines.filter((l) => l.action === 'extend').length,
    extended,
    failed,
  };
  console.log(`subscription-sync: ${JSON.stringify(summary)}`);
  return json({ ...summary, stores: lines });
});

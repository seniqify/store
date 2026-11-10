import { serve }        from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ship-updates — automatic WhatsApp shipping updates (Delivery -> WhatsApp).
//
// Called every 10 minutes by pg_cron (supabase/delivery-tools-schedule.sql)
// with the shared secret from public.automation_secrets ('ship-updates'), sent
// as x-sweep-secret -- the same arrangement as cart-reminders. verify_jwt is
// FALSE: the secret is the authentication.
//
// Every rule lives in SQL (supabase/delivery-tools-forward.sql):
//   ship_updates_expire_stuck  refund anything whose result never came back
//   ship_updates_due           which orders' CURRENT step has a message due
//   ship_update_claim          re-check under a lock, debit Rs 0.50, record,
//                              and return the exact receiver + values
//   ship_update_finish         record the answer; a refusal is refunded
// This function only carries each claimed message to Seniqify.
//
// Secrets (each is a template's /process URL; it IS the credential: never in
// code, never logged). A step whose template is not set is never claimed, so
// nobody pays for a message that cannot go:
//   SENIQIFY_SHIP_SHIPPED_TEMPLATE_URL    {{1}} name {{2}} shop {{3}} courier {{4}} AWB, button order/<token>
//   SENIQIFY_SHIP_OFD_TEMPLATE_URL        {{1}} name {{2}} shop {{3}} amount to pay, button order/<token>
//   SENIQIFY_SHIP_FAILED_TEMPLATE_URL     {{1}} name {{2}} shop, button order/<token>
//   SENIQIFY_SHIP_DELIVERED_TEMPLATE_URL  {{1}} name {{2}} shop, button order/<token>
//   SENIQIFY_API_KEY                      optional Bearer, as for every other send.

const MAX_PER_RUN = 150;
const TEMPLATE_ENV: Record<string, string> = {
  shipped:   'SENIQIFY_SHIP_SHIPPED_TEMPLATE_URL',
  ofd:       'SENIQIFY_SHIP_OFD_TEMPLATE_URL',
  failed:    'SENIQIFY_SHIP_FAILED_TEMPLATE_URL',
  delivered: 'SENIQIFY_SHIP_DELIVERED_TEMPLATE_URL',
};

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

serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: cfg, error: cfgErr } = await supabase
    .from('automation_secrets').select('secret').eq('name', 'ship-updates').maybeSingle();
  if (cfgErr) return json({ error: 'secret_unavailable' }, 500);
  if (!sameSecret(String(cfg?.secret || ''), req.headers.get('x-sweep-secret') || '')) {
    return json({ error: 'unauthorized' }, 401);
  }

  const templates: Record<string, string> = {};
  for (const [event, env] of Object.entries(TEMPLATE_ENV)) {
    const url = Deno.env.get(env) ?? '';
    if (url) templates[event] = url;
  }
  if (Object.keys(templates).length === 0) {
    console.error('ship-updates: no SENIQIFY_SHIP_*_TEMPLATE_URL is set — nothing sent');
    return json({ skipped: 'not_configured' });
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const apiKey = Deno.env.get('SENIQIFY_API_KEY');
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  const result = { expired: 0, due: 0, sent: 0, failed: 0, skipped: 0, reasons: {} as Record<string, number> };
  const skip = (reason: string) => { result.skipped += 1; result.reasons[reason] = (result.reasons[reason] || 0) + 1; };

  const { data: expired } = await supabase.rpc('ship_updates_expire_stuck');
  result.expired = Number(expired) || 0;

  const { data: due, error: dueErr } = await supabase.rpc('ship_updates_due', { p_limit: MAX_PER_RUN });
  if (dueErr) {
    console.error('ship-updates: could not list due messages', dueErr.message);
    return json({ error: 'due_unavailable' }, 500);
  }
  result.due = (due ?? []).length;

  for (const row of due ?? []) {
    const templateUrl = templates[row.event];
    if (!templateUrl) { skip('no_template'); continue; }

    const { data: claim, error: claimErr } = await supabase.rpc('ship_update_claim', { p_order_id: row.order_id, p_event: row.event });
    if (claimErr || !claim?.ok) { skip(claimErr ? 'claim_error' : String(claim?.reason || 'unknown')); continue; }

    // Paid for and recorded. Now send it, and record the answer either way.
    let sent = false;
    let status: number | null = null;
    let error = '';
    try {
      const r = await fetch(templateUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ receiver: claim.receiver, values: claim.values }),
      });
      status = r.status;
      sent = r.ok;
      if (!r.ok) error = (await r.text()).slice(0, 300);
    } catch (e) {
      error = String((e as Error)?.message || 'network error').slice(0, 300);
    }

    const { error: finErr } = await supabase.rpc('ship_update_finish', {
      p_message_id: claim.message_id, p_sent: sent, p_provider_status: status, p_error: error || null,
    });
    // If even this fails, ship_updates_expire_stuck refunds it on a later run.
    if (finErr) console.error('ship-updates: could not record the result', claim.message_id, finErr.message);
    if (sent) result.sent += 1;
    else {
      result.failed += 1;
      console.error(`ship-updates: provider refused ${claim.message_id} ${row.event} (${status}): ${error}`);
    }
  }

  return json(result);
});

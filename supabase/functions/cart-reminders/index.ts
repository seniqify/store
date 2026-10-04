import { serve }        from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// cart-reminders — the automatic WhatsApp cart reminder (PR 3).
//
// Called every 15 minutes by pg_cron (supabase/cart-reminders-schedule.sql)
// with the shared secret from public.automation_secrets, sent as
// x-sweep-secret — the same arrangement as status-sweep. verify_jwt is FALSE:
// the secret is the authentication.
//
// Every rule (who gets a reminder, when, and paying for it) lives in SQL:
//   cart_reminders_expire_stuck  refund anything whose result never came back
//   cart_reminders_due           who is due right now (09:00-21:00 IST only)
//   cart_reminder_claim          re-check under a lock, debit Rs 1.50, record,
//                                and return the exact receiver + values
//   cart_reminder_finish         record the answer; a refusal is refunded
// This function only carries the claimed message to Seniqify.
//
// Secrets:
//   SENIQIFY_CART_REMINDER_TEMPLATE_URL  the template's /process URL. It IS the
//                                        credential: never in code, never logged.
//   SENIQIFY_API_KEY                     optional Bearer, as for every other send.

const MAX_PER_RUN = 50;

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
    .from('automation_secrets').select('secret').eq('name', 'cart-reminders').maybeSingle();
  if (cfgErr) return json({ error: 'secret_unavailable' }, 500);
  if (!sameSecret(String(cfg?.secret || ''), req.headers.get('x-sweep-secret') || '')) {
    return json({ error: 'unauthorized' }, 401);
  }

  const templateUrl = Deno.env.get('SENIQIFY_CART_REMINDER_TEMPLATE_URL') ?? '';
  if (!templateUrl) {
    // Not set up: claim nothing, so nobody is charged for a message that cannot go.
    console.error('cart-reminders: SENIQIFY_CART_REMINDER_TEMPLATE_URL is not set — nothing sent');
    return json({ skipped: 'not_configured' });
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const apiKey = Deno.env.get('SENIQIFY_API_KEY');
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  const result = { expired: 0, due: 0, sent: 0, failed: 0, skipped: 0, reasons: {} as Record<string, number> };

  const { data: expired } = await supabase.rpc('cart_reminders_expire_stuck');
  result.expired = Number(expired) || 0;

  const { data: due, error: dueErr } = await supabase.rpc('cart_reminders_due', { p_limit: MAX_PER_RUN });
  if (dueErr) {
    console.error('cart-reminders: could not list due reminders', dueErr.message);
    return json({ error: 'due_unavailable' }, 500);
  }
  result.due = (due ?? []).length;

  for (const row of due ?? []) {
    const { data: claim, error: claimErr } = await supabase.rpc('cart_reminder_claim', { p_abandoned_id: row.abandoned_order_id });
    if (claimErr || !claim?.ok) {
      const reason = claimErr ? 'claim_error' : String(claim?.reason || 'unknown');
      result.reasons[reason] = (result.reasons[reason] || 0) + 1;
      result.skipped += 1;
      continue;
    }

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

    const { error: finErr } = await supabase.rpc('cart_reminder_finish', {
      p_reminder_id: claim.reminder_id, p_sent: sent, p_provider_status: status, p_error: error || null,
    });
    // If even this fails, cart_reminders_expire_stuck refunds it on a later run.
    if (finErr) console.error('cart-reminders: could not record the result', claim.reminder_id, finErr.message);
    if (sent) result.sent += 1;
    else {
      result.failed += 1;
      console.error(`cart-reminders: provider refused ${claim.reminder_id} (${status}): ${error}`);
    }
  }

  return json(result);
});

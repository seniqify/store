import { serve }        from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// review-asks — "Ask automatically": the review request N days after delivery
// (supabase/review-asks-auto-forward.sql; mockup 4G4RXkGPxexuUZYPDdwZeH).
//
// Called every 15 minutes by pg_cron (supabase/review-asks-schedule.sql) with the
// shared secret from public.automation_secrets, sent as x-sweep-secret — the same
// arrangement as cart-reminders. verify_jwt is FALSE: the secret is the
// authentication.
//
// Every rule (who, when, paying for it) lives in SQL:
//   review_asks_expire_stuck  refund anything whose result never came back
//   review_asks_due           who is due right now (from 11:00 IST)
//   review_ask_claim          re-check under a lock, debit 1 Coin, make the link,
//                             record, and return the parts of the message
//   review_ask_finish         record the answer; a refusal is refunded
// This function only carries the claimed message to Seniqify.
//
// Secrets:
//   SENIQIFY_REVIEW_ASK_TEMPLATE_URL     the English template's /process URL. It IS
//                                        the credential: never in code, never logged.
//                                        Not set = nothing is claimed or charged.
//   SENIQIFY_REVIEW_ASK_MR_TEMPLATE_URL  the मराठी one (optional: English until it exists).
//   SENIQIFY_API_KEY                     optional Bearer, as for every other send.
//
// Template values: {{1}} first name, {{2}} shop, {{3}} first item, and the URL
// button's value review/<token> (button URL https://www.pocketlink.store/{{1}}).

const MAX_PER_RUN = 100;

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

type Claim = { send_id: string; lang: string; receiver: string; name: string; store: string; item: string; link: string };

/** The template values; an empty part gets a fallback in the message's language. */
function templateValues(c: Claim, mr: boolean): Record<string, string> {
  const pick = (v: string, en: string, m: string) => (String(v || '').trim() || (mr ? m : en));
  return {
    '1': pick(c.name, 'there', 'ग्राहक'),
    '2': pick(c.store, 'our shop', 'आमचे दुकान'),
    '3': pick(c.item, 'order', 'ऑर्डर'),
    '4': String(c.link),
  };
}

serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: cfg, error: cfgErr } = await supabase
    .from('automation_secrets').select('secret').eq('name', 'review-asks').maybeSingle();
  if (cfgErr) return json({ error: 'secret_unavailable' }, 500);
  if (!sameSecret(String(cfg?.secret || ''), req.headers.get('x-sweep-secret') || '')) {
    return json({ error: 'unauthorized' }, 401);
  }

  const templateUrl = Deno.env.get('SENIQIFY_REVIEW_ASK_TEMPLATE_URL') ?? '';
  if (!templateUrl) {
    // Not approved yet: claim nothing, so nobody is charged for a message that cannot go.
    return json({ skipped: 'not_configured' });
  }
  const mrUrl = Deno.env.get('SENIQIFY_REVIEW_ASK_MR_TEMPLATE_URL') ?? '';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const apiKey = Deno.env.get('SENIQIFY_API_KEY');
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  const result = { expired: 0, due: 0, sent: 0, failed: 0, skipped: 0, reasons: {} as Record<string, number> };

  const { data: expired } = await supabase.rpc('review_asks_expire_stuck');
  result.expired = Number(expired) || 0;

  const { data: due, error: dueErr } = await supabase.rpc('review_asks_due', { p_limit: MAX_PER_RUN });
  if (dueErr) {
    console.error('review-asks: could not list due orders', dueErr.message);
    return json({ error: 'due_unavailable' }, 500);
  }
  result.due = (due ?? []).length;

  for (const row of due ?? []) {
    const { data: claim, error: claimErr } = await supabase.rpc('review_ask_claim', { p_order_id: row.order_id, p_source: 'auto' });
    if (claimErr || !claim?.ok) {
      const reason = claimErr ? 'claim_error' : String(claim?.reason || 'unknown');
      result.reasons[reason] = (result.reasons[reason] || 0) + 1;
      result.skipped += 1;
      continue;
    }

    // Paid for and recorded. Now send it, and record the answer either way.
    // मराठी when the shop chose it and the Marathi template exists.
    const useMr = claim.lang === 'mr' && Boolean(mrUrl);
    let sent = false;
    let status: number | null = null;
    let error = '';
    try {
      const r = await fetch(useMr ? mrUrl : templateUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ receiver: claim.receiver, values: templateValues(claim as Claim, useMr) }),
      });
      status = r.status;
      sent = r.ok;
      if (!r.ok) error = (await r.text()).slice(0, 300);
    } catch (e) {
      error = String((e as Error)?.message || 'network error').slice(0, 300);
    }

    const { error: finErr } = await supabase.rpc('review_ask_finish', {
      p_send_id: claim.send_id, p_sent: sent, p_provider_status: status, p_error: error || null, p_lang: useMr ? 'mr' : 'en',
    });
    // If even this fails, review_asks_expire_stuck refunds it on a later run.
    if (finErr) console.error('review-asks: could not record the result', claim.send_id, finErr.message);
    if (sent) result.sent += 1;
    else {
      result.failed += 1;
      console.error(`review-asks: provider refused ${claim.send_id} (${status}): ${error}`);
    }
  }

  return json(result);
});

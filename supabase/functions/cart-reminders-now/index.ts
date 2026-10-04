import { serve }        from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// cart-reminders-now — the shop presses "Send reminder" (one cart) or "Send
// reminder to all" in the Abandoned tab (supabase/messages-v2-forward.sql).
//
// Body: { slug, hashedPin, abandoned_id? }   — one cart, or every eligible one.
//
// PIN first (throttled verify_store_pin). "All" is decided HERE from
// cart_reminders_manual_candidates — the browser never lists who gets one.
// Each is claimed with p_manual = true, which re-checks under a lock (09:00-21:00
// IST, cart under 7 days old, not reminded this week, not ordered since, did not
// ask to stop, wallet pays Rs 1.50 in the same transaction), then sent exactly as
// the database built it; cart_reminder_finish records the answer and refunds a
// refusal. At most 100 per call: the screen calls again while any remain.

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const MAX_PER_CALL = 100;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const body = await req.json();
    const { slug, hashedPin } = body ?? {};
    if (!slug || !hashedPin) return json({ error: 'Missing store or PIN.' }, 400);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: pinOk, error: pinErr } = await supabase.rpc('verify_store_pin', { p_slug: slug, p_hashed_pin: hashedPin });
    if (pinErr) return json({ error: 'Could not check your PIN right now. Please try again.' });
    if (pinOk !== true) return json({ error: 'Unauthorized.' }, 403);

    const templateUrl = Deno.env.get('SENIQIFY_CART_REMINDER_TEMPLATE_URL') ?? '';
    if (!templateUrl) return json({ error: 'Reminders are not set up yet. Please contact PocketLink.' });
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const apiKey = Deno.env.get('SENIQIFY_API_KEY');
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    await supabase.rpc('cart_reminders_expire_stuck');

    let ids: string[];
    if (body.abandoned_id) {
      ids = [String(body.abandoned_id)];
    } else {
      const { data: cands, error: candErr } = await supabase.rpc('cart_reminders_manual_candidates', { p_slug: slug });
      if (candErr) return json({ error: 'Could not find the carts to remind. Please try again.' });
      ids = (cands ?? []).map((c: { abandoned_order_id: string }) => c.abandoned_order_id);
    }
    const more = ids.length > MAX_PER_CALL;
    ids = ids.slice(0, MAX_PER_CALL);

    const result = { sent: 0, failed: 0, skipped: 0, more, reasons: {} as Record<string, number> };
    for (const id of ids) {
      const { data: claim, error: claimErr } = await supabase.rpc('cart_reminder_claim', { p_abandoned_id: id, p_manual: true, p_slug: slug });
      if (claimErr || !claim?.ok) {
        const reason = claimErr ? 'claim_error' : String(claim?.reason || 'unknown');
        result.reasons[reason] = (result.reasons[reason] || 0) + 1;
        result.skipped += 1;
        // Nothing else can go once the wallet is empty or it is night.
        if (reason === 'no_balance' || reason === 'night') { result.more = false; break; }
        continue;
      }

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
      if (finErr) console.error('cart-reminders-now: could not record the result', claim.reminder_id, finErr.message);
      if (sent) result.sent += 1;
      else {
        result.failed += 1;
        console.error(`cart-reminders-now: provider refused ${claim.reminder_id} (${status}): ${error}`);
      }
    }

    return json(result);
  } catch (err) {
    console.error('cart-reminders-now error:', (err as Error).message);
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
});

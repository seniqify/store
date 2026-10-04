import { serve }        from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// send-offer — a shop sends an approved WhatsApp offer to a group of its
// customers, paid per message from its wallet (supabase/offers-forward.sql).
//
// Body: { slug, hashedPin, template_id, fields: { offer?, item?, code?, date? },
//         phones: [...] }   — at most 100 per call; the screen sends in batches.
//
// PIN first (throttled verify_store_pin). Then, per customer, offer_claim
// re-checks everything under a lock (a customer of this shop, agreed to offers
// from it, nothing from it in 3 days, wallet pays), debits Rs 1.50, records the
// send and returns the template's /process URL and the exact values; this
// function posts them and offer_finish records the answer (a refusal is
// refunded). The browser never sees a template URL and cannot pick who is
// eligible: it only proposes phone numbers.

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
    const { slug, hashedPin, template_id: templateId } = body ?? {};
    if (!slug || !hashedPin || !templateId) return json({ error: 'Missing store, PIN or message.' }, 400);
    const phones: string[] = Array.isArray(body.phones) ? [...new Set(body.phones.map((p: unknown) => String(p)))] : [];
    if (phones.length === 0) return json({ error: 'No customers to send to.' }, 400);
    if (phones.length > MAX_PER_CALL) return json({ error: `At most ${MAX_PER_CALL} customers per send.` }, 400);
    const fields = body.fields && typeof body.fields === 'object' && !Array.isArray(body.fields) ? body.fields : {};

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: pinOk, error: pinErr } = await supabase.rpc('verify_store_pin', { p_slug: slug, p_hashed_pin: hashedPin });
    if (pinErr) return json({ error: 'Could not check your PIN right now. Please try again.' });
    if (pinOk !== true) return json({ error: 'Unauthorized.' }, 403);

    await supabase.rpc('offer_sends_expire_stuck');

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const apiKey = Deno.env.get('SENIQIFY_API_KEY');
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const result = { sent: 0, failed: 0, skipped: 0, reasons: {} as Record<string, number> };
    for (const phone of phones) {
      const { data: claim, error: claimErr } = await supabase.rpc('offer_claim', {
        p_slug: slug, p_template_id: templateId, p_phone: phone, p_fields: fields,
      });
      if (claimErr || !claim?.ok) {
        const reason = claimErr ? 'claim_error' : String(claim?.reason || 'unknown');
        result.reasons[reason] = (result.reasons[reason] || 0) + 1;
        result.skipped += 1;
        // Nothing else can be sent once the wallet is empty or the message is unusable.
        if (reason === 'no_balance' || reason === 'not_approved' || reason === 'bad_field') break;
        continue;
      }

      let sent = false;
      let status: number | null = null;
      let error = '';
      try {
        const r = await fetch(String(claim.template_url), {
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

      const { error: finErr } = await supabase.rpc('offer_finish', {
        p_send_id: claim.send_id, p_sent: sent, p_provider_status: status, p_error: error || null,
      });
      if (finErr) console.error('send-offer: could not record the result', claim.send_id, finErr.message);
      if (sent) result.sent += 1;
      else {
        result.failed += 1;
        console.error(`send-offer: provider refused ${claim.send_id} (${status}): ${error}`);
      }
    }

    return json(result);
  } catch (err) {
    console.error('send-offer error:', (err as Error).message);
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
});

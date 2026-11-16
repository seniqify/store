import { serve }        from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// review-asks-now — "Ask all N on WhatsApp" in Manage → Reviews
// (supabase/review-asks-auto-forward.sql; mockup 4G4RXkGPxexuUZYPDdwZeH).
//
// Body: { slug, hashedPin, order_ids: string[], lang?: 'en' | 'mr' }
//       { slug, hashedPin, check: true }  → { ready, ready_mr }: is the template set up?
//
// PIN first (throttled verify_store_pin). Each ticked order is claimed with
// p_source 'all' and the shop's slug, which re-checks under a lock (this shop's
// order, delivered, never asked, not skipped, not reviewed, did not ask to stop,
// 09:00-21:00 IST, wallet pays 1 Coin in the same transaction), then sent exactly
// as claimed; review_ask_finish records the answer and refunds a refusal. At most
// 100 per call: the screen calls again while any remain.

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const MAX_PER_CALL = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
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

    const templateUrl = Deno.env.get('SENIQIFY_REVIEW_ASK_TEMPLATE_URL') ?? '';
    const mrUrl = Deno.env.get('SENIQIFY_REVIEW_ASK_MR_TEMPLATE_URL') ?? '';
    if (body.check) return json({ ready: Boolean(templateUrl), ready_mr: Boolean(mrUrl) });
    if (!templateUrl) {
      return json({ error: 'This starts when WhatsApp approves the review message.', not_ready: true });
    }
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const apiKey = Deno.env.get('SENIQIFY_API_KEY');
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    const lang = body.lang === 'mr' ? 'mr' : body.lang === 'en' ? 'en' : null;

    let ids = [...new Set((Array.isArray(body.order_ids) ? body.order_ids : []).map(String))].filter((x) => UUID.test(x));
    if (ids.length === 0) return json({ error: 'Tick the customers to ask.' }, 400);
    const more = ids.length > MAX_PER_CALL;
    ids = ids.slice(0, MAX_PER_CALL);

    await supabase.rpc('review_asks_expire_stuck');

    const result = { sent: 0, failed: 0, skipped: 0, more, sent_ids: [] as string[], reasons: {} as Record<string, number> };
    for (const id of ids) {
      const { data: claim, error: claimErr } = await supabase.rpc('review_ask_claim', {
        p_order_id: id, p_source: 'all', p_slug: slug, p_lang: lang,
      });
      if (claimErr || !claim?.ok) {
        const reason = claimErr ? 'claim_error' : String(claim?.reason || 'unknown');
        result.reasons[reason] = (result.reasons[reason] || 0) + 1;
        result.skipped += 1;
        // Nothing else can go once the wallet is empty or it is night.
        if (reason === 'no_balance' || reason === 'night') { result.more = false; break; }
        continue;
      }

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
      if (finErr) console.error('review-asks-now: could not record the result', claim.send_id, finErr.message);
      if (sent) { result.sent += 1; result.sent_ids.push(id); }
      else {
        result.failed += 1;
        console.error(`review-asks-now: provider refused ${claim.send_id} (${status}): ${error}`);
      }
    }

    return json(result);
  } catch (err) {
    console.error('review-asks-now error:', (err as Error).message);
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
});

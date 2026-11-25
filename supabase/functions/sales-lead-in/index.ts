// ===========================================================================
//  sales-lead-in  --  leads that arrive by themselves, into the Sales CRM
//
//    POST ?src=google   Google Ads lead form webhook. The body carries
//                       google_key; it must match the key the manager made
//                       in Lead sources (sales_settings 'lead_sources').
//    GET  ?src=meta     Meta webhook verification (hub.verify_token).
//    POST ?src=meta     Meta Page "leadgen" webhook: each lead is read from
//                       the Graph API with the Page token (sales_private
//                       'meta_page_token'); a lead that cannot be read is
//                       logged as fetch_failed. If META_APP_SECRET is set,
//                       the X-Hub-Signature-256 is checked too.
//    POST ?src=web      The "call me back" form on pocketlink.store
//                       (5 an hour per address, a honeypot field).
//
//  Everything goes through public.sales_lead_in() (service role only), which
//  skips repeats, reopens a number that comes back, queues night leads for
//  9:30 am and gives them out by the auto-assign rules.
//  Public by design: deploy with verify_jwt = false.
// ===========================================================================
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { fromGoogle, metaLeadIds, fromMetaLead, fromWebsite, sameText } from '../../../shared/sales-lead-map.mjs';

const GRAPH = `https://graph.facebook.com/${Deno.env.get('META_GRAPH_VERSION') || 'v25.0'}`;
const WEB_ORIGINS = new Set(['https://www.pocketlink.store', 'https://pocketlink.store', 'http://localhost:5173']);

const sb = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

function reply(body: unknown, status = 200, origin = '') {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Headers'] = 'content-type';
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    headers['Vary'] = 'Origin';
  }
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });
}

async function sha256Hex(text: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function hmacHex(secret: string, body: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function settings(db: ReturnType<typeof sb>) {
  const { data } = await db.from('sales_settings').select('value').eq('key', 'lead_sources').maybeSingle();
  return (data?.value || {}) as Record<string, unknown>;
}

type Lead = { externalId: string | null; name: string; phone: string; shop: string; city: string; campaign: string; form: string; isTest: boolean };
async function leadIn(db: ReturnType<typeof sb>, source: string, l: Lead, ipHash: string | null, raw: unknown) {
  const { data, error } = await db.rpc('sales_lead_in', {
    p_source: source, p_external_id: l.externalId, p_name: l.name || null, p_phone: l.phone || null, p_shop: l.shop || null,
    p_city: l.city || null, p_campaign: l.campaign || null, p_form: l.form || null, p_is_test: l.isTest, p_ip_hash: ipHash,
    p_raw: raw ?? null,
  });
  if (error) throw new Error(error.message);
  return data as { outcome: string };
}

serve(async (req: Request) => {
  const url = new URL(req.url);
  const src = url.searchParams.get('src') || '';
  const origin = req.headers.get('origin') || '';
  const webOrigin = src === 'web' && WEB_ORIGINS.has(origin) ? origin : '';
  if (req.method === 'OPTIONS') return webOrigin ? new Response('ok', { headers: { 'Access-Control-Allow-Origin': webOrigin, 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Vary': 'Origin' } }) : new Response(null, { status: 204 });

  const db = sb();
  try {
    // ── Meta: webhook verification ─────────────────────────────────────────
    if (src === 'meta' && req.method === 'GET') {
      const cfg = await settings(db);
      const token = String(cfg.meta_verify || '');
      if (url.searchParams.get('hub.mode') === 'subscribe' && token && sameText(url.searchParams.get('hub.verify_token'), token)) {
        return new Response(url.searchParams.get('hub.challenge') || '', { status: 200 });
      }
      return new Response('forbidden', { status: 403 });
    }
    if (req.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
    const text = await req.text();
    if (text.length > 100_000) return reply({ error: 'Too large' }, 413);

    // ── Google Ads lead form ───────────────────────────────────────────────
    if (src === 'google') {
      const cfg = await settings(db);
      let body: unknown = null;
      try { body = JSON.parse(text); } catch { return reply({ error: 'Bad JSON' }, 400); }
      const l = fromGoogle(body, String(cfg.google_key || ''));
      if (!l.ok) return reply({ error: 'Not accepted' }, 403);
      const r = await leadIn(db, 'google', l as Lead, null, { lead_id: (body as Record<string, unknown>).lead_id, form_id: (body as Record<string, unknown>).form_id, campaign_id: (body as Record<string, unknown>).campaign_id });
      return reply({ ok: true, outcome: r.outcome });
    }

    // ── Meta lead ads ──────────────────────────────────────────────────────
    if (src === 'meta') {
      const secret = Deno.env.get('META_APP_SECRET') || '';
      if (secret) {
        const sig = (req.headers.get('x-hub-signature-256') || '').replace(/^sha256=/, '');
        if (!sig || !sameText(sig, await hmacHex(secret, text))) return reply({ error: 'Bad signature' }, 403);
      }
      let body: unknown = null;
      try { body = JSON.parse(text); } catch { return reply({ error: 'Bad JSON' }, 400); }
      const ids = metaLeadIds(body);
      if (!ids.length) return reply({ ok: true, leads: 0 });
      const { data: tok } = await db.from('sales_private').select('value').eq('key', 'meta_page_token').maybeSingle();
      const token = tok?.value || '';
      let n = 0;
      for (const x of ids.slice(0, 50)) {
        let lead: Record<string, unknown> | null = null, why = 'no Page token: connect the Facebook Page in Lead sources';
        if (token) {
          try {
            const r = await fetch(`${GRAPH}/${encodeURIComponent(x.leadgenId)}?fields=field_data,created_time,ad_name,campaign_name,form_id,platform,is_organic&access_token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(10000) });
            const j = await r.json();
            if (r.ok && !j.error) lead = j; else why = String(j?.error?.message || `Graph ${r.status}`).slice(0, 200);
          } catch (e) { why = (e as Error).name === 'TimeoutError' ? 'Facebook did not answer in time' : 'Facebook could not be reached'; }
        }
        if (!lead) {
          await db.rpc('sales_lead_failed', { p_source: 'facebook', p_external_id: x.leadgenId, p_campaign: null, p_raw: { ...x, why } });
          continue;
        }
        const m = fromMetaLead(lead, x.leadgenId);
        await leadIn(db, m.source, m as Lead, null, { leadgen_id: x.leadgenId, form_id: x.formId, ad_id: x.adId, page_id: x.pageId, platform: lead.platform, is_organic: lead.is_organic });
        n++;
      }
      return reply({ ok: true, leads: n });
    }

    // ── The website "call me back" form ────────────────────────────────────
    if (src === 'web') {
      if (!webOrigin) return reply({ error: 'Not allowed' }, 403);
      const cfg = await settings(db);
      if (cfg.web_off === true) return reply({ error: 'Not taking requests right now.' }, 403, webOrigin);
      let body: unknown = null;
      try { body = JSON.parse(text); } catch { return reply({ error: 'Bad request' }, 400, webOrigin); }
      const l = fromWebsite(body);
      if (!l.ok) return l.silent ? reply({ ok: true }, 200, webOrigin) : reply({ error: l.why }, 400, webOrigin);
      const ip = (req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for') || '').split(',')[0].trim();
      const ipHash = ip ? (await sha256Hex(`${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}|${ip}`)).slice(0, 40) : null;
      const r = await leadIn(db, 'website', l as Lead, ipHash, null);
      if (r.outcome === 'rate_limited') return reply({ error: 'Too many requests. Please try again later.' }, 429, webOrigin);
      if (r.outcome === 'bad_phone') return reply({ error: 'Enter a 10-digit mobile number.' }, 400, webOrigin);
      return reply({ ok: true }, 200, webOrigin);
    }

    return reply({ error: 'Unknown source' }, 404);
  } catch (e) {
    console.error('sales-lead-in failed:', (e as Error).message);
    // 500 so Google / Meta retry; a repeat is skipped by the external id.
    return reply({ error: 'Could not save. Try again.' }, 500, webOrigin);
  }
});

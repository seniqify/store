import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Stage 2E-2 — scheduled measurement snapshot. Runs Supabase-side (pg_cron →
// meta_snapshot_tick → this fn), so it does NOT count toward Vercel's 12-function
// limit. For every campaign PocketLink launched (meta_campaigns), it pulls Meta's
// lifetime Insights and reconciles them against our own order/revenue truth, then
// upserts one meta_campaign_outcomes row per campaign per day (Meta metrics and
// PocketLink truth in separate columns). Read-only wrt Meta; never spends.
//
// Auth: shared secret header (x-capi-secret), same as meta-capi. Deploy --no-verify-jwt.

const GRAPH_VER = 'v25.0';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, x-capi-secret' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });
const admin = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

const PURCHASE = ['purchase', 'omni_purchase', 'offsite_conversion.fct_purchase', 'onsite_conversion.purchase'];
const ADD_TO_CART = ['add_to_cart', 'omni_add_to_cart', 'offsite_conversion.fct_add_to_cart', 'onsite_web_add_to_cart'];
const CHECKOUT = ['initiate_checkout', 'omni_initiated_checkout', 'offsite_conversion.fct_initiate_checkout', 'onsite_web_initiate_checkout'];
const PLACED = ['new', 'confirmed', 'dispatched', 'delivered'];

// deno-lint-ignore no-explicit-any
function actionVal(actions: any, types: string[]): number {
  if (!Array.isArray(actions)) return 0;
  for (const t of types) { const a = actions.find((x: any) => x.action_type === t); if (a) return Number(a.value) || 0; }
  return 0;
}
// deno-lint-ignore no-explicit-any
function shape(row: any) {
  const spend = Number(row?.spend || 0);
  return {
    spend, impressions: Number(row?.impressions || 0), reach: Number(row?.reach || 0),
    cpm: Number(row?.cpm || 0), clicks: Number(row?.clicks || 0), ctr: Number(row?.ctr || 0), cpc: Number(row?.cpc || 0),
    lpv: actionVal(row?.actions, ['landing_page_view']), atc: actionVal(row?.actions, ADD_TO_CART),
    checkout: actionVal(row?.actions, CHECKOUT), purchases: actionVal(row?.actions, PURCHASE),
    revenue: actionVal(row?.action_values, PURCHASE),
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const supabase = admin();

  // Secret gate (mirrors meta-capi).
  const { data: cfg } = await supabase.from('meta_capi_config').select('secret').limit(1).maybeSingle();
  const expected = cfg?.secret || '';
  if (!expected || req.headers.get('x-capi-secret') !== expected) return json({ error: 'unauthorized' }, 401);

  const insightFields = 'campaign_id,spend,impressions,reach,cpm,clicks,ctr,cpc,actions,action_values';
  const today = new Date().toISOString().slice(0, 10);
  const nowIso = new Date().toISOString();

  // All launched campaigns, grouped by store.
  const { data: ledger } = await supabase
    .from('meta_campaigns')
    .select('campaign_id, launch_id, store_slug, status, created_at, activated_at')
    .not('campaign_id', 'is', null);
  const byStore = new Map<string, any[]>();
  for (const L of (ledger || [])) { const a = byStore.get(L.store_slug) || []; a.push(L); byStore.set(L.store_slug, a); }

  let stores = 0, upserts = 0;
  for (const [slug, camps] of byStore) {
    const { data: acct } = await supabase.from('store_meta_accounts').select('access_token, ad_account_ids, status').eq('store_slug', slug).maybeSingle();
    if (!acct || acct.status !== 'connected' || !acct.access_token) continue;
    const adId = (acct.ad_account_ids || [])[0];
    if (!adId) continue;
    stores++;

    // Lifetime campaign insights for the whole ad account → map by campaign_id.
    const url = `https://graph.facebook.com/${GRAPH_VER}/${adId}/insights?fields=${encodeURIComponent(insightFields)}&level=campaign&date_preset=maximum&limit=200&access_token=${encodeURIComponent(acct.access_token)}`;
    let insMap = new Map<string, any>();
    try {
      const r = await fetch(url); const b = await r.json();
      for (const row of (b?.data || [])) insMap.set(row.campaign_id, row);
    } catch { /* skip this store on Meta error */ continue; }

    for (const L of camps) {
      const m = shape(insMap.get(L.campaign_id) || {});
      const since = L.activated_at || L.created_at || null;
      let orders: any[] = [];
      try {
        let q = supabase.from('orders').select('total, status').eq('store_slug', slug).limit(5000);
        if (since) q = q.gte('created_at', since);
        const { data } = await q; orders = data || [];
      } catch { orders = []; }
      const placed = orders.filter((o) => PLACED.includes(String(o.status)));
      const delivered = orders.filter((o) => o.status === 'delivered');
      const sum = (arr: any[]) => arr.reduce((s, o) => s + (Number(o.total) || 0), 0);

      const { error } = await supabase.from('meta_campaign_outcomes').upsert({
        campaign_id: L.campaign_id, store_slug: slug, launch_id: L.launch_id, snapshot_date: today,
        spend: m.spend, impressions: m.impressions, reach: m.reach, cpm: m.cpm, clicks: m.clicks, ctr: m.ctr, cpc: m.cpc,
        lpv: m.lpv, atc: m.atc, checkout: m.checkout, purchases_meta: m.purchases, revenue_meta: m.revenue,
        orders_pl: placed.length, revenue_pl: sum(placed), delivered_orders_pl: delivered.length, delivered_revenue_pl: sum(delivered),
        currency: 'INR', captured_at: nowIso,
      }, { onConflict: 'campaign_id,snapshot_date' });
      if (!error) upserts++;
    }
  }

  return json({ ok: true, stores, upserts, date: today });
});

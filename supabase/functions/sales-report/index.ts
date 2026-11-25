// ===========================================================================
//  sales-report  --  the manager's WhatsApp sales report
//
//  POST { kind: 'daily' | 'weekly' }   from pg_cron (x-sweep-secret), 7 pm
//                                      daily and Monday 9 am weekly
//  POST { kind: 'test' }               from the CRM (a manager's login):
//                                      today's numbers, to that manager only
//
//  The numbers come from public.sales_report_data(); every run is kept in
//  sales_reports (the CRM's Reports page). WhatsApp goes through the
//  Seniqify template API, like the other PocketLink messages:
//    SENIQIFY_API_KEY
//    SENIQIFY_SALES_DAILY_TEMPLATE_URL    the approved daily template
//    SENIQIFY_SALES_WEEKLY_TEMPLATE_URL   the approved weekly template
//  Until a template URL is set, the report is saved and not sent.
//  Deploy with verify_jwt = false (the cron sends no JWT).
// ===========================================================================
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { reportPeriod, dailyValues, weeklyValues } from '../../../shared/sales-report-text.mjs';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

function sameSecret(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
const p10 = (v: unknown) => { const d = String(v ?? '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : ''; };

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

  let body: { kind?: string } = {};
  try { body = await req.json(); } catch { /* empty */ }
  const kind = body.kind === 'weekly' ? 'weekly' : body.kind === 'test' ? 'test' : 'daily';

  // Who is asking: the cron (secret) or a manager (their login, test only).
  let testTo = '';
  const sweep = req.headers.get('x-sweep-secret') || '';
  if (sweep) {
    const { data: s } = await db.from('automation_secrets').select('secret').eq('name', 'sales-report').maybeSingle();
    if (!sameSecret(String(s?.secret || ''), sweep)) return json({ error: 'unauthorized' }, 401);
    if (kind === 'test') return json({ error: 'test needs a manager login' }, 400);
  } else {
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const { data: u } = await db.auth.getUser(token);
    if (!u?.user) return json({ error: 'Sign in again.' }, 401);
    const { data: me } = await db.from('sales_staff').select('role, phone, active').eq('user_id', u.user.id).maybeSingle();
    if (!me || !me.active || me.role !== 'manager') return json({ error: 'Only a manager can send a test report.' }, 403);
    if (kind !== 'test') return json({ error: 'Only a test can be sent from the CRM.' }, 400);
    testTo = p10(me.phone);
    if (!testTo) return json({ error: 'Add your mobile number in Team first.' }, 400);
  }

  const period = reportPeriod(kind === 'weekly' ? 'weekly' : 'daily');
  const { data, error } = await db.rpc('sales_report_data', { p_from: period.from, p_to: period.to });
  if (error) return json({ error: error.message }, 500);

  const { data: cfgRow } = await db.from('sales_settings').select('value').eq('key', 'reports').maybeSingle();
  const cfg = (cfgRow?.value || {}) as Record<string, unknown>;
  const weekly = kind === 'weekly';
  const off = weekly ? cfg.weekly_off === true : kind === 'daily' && cfg.daily_off === true;

  let phones: string[] = [];
  if (testTo) phones = [testTo];
  else if (Array.isArray(cfg.phones) && cfg.phones.length) phones = (cfg.phones as unknown[]).map(p10).filter(Boolean);
  else {
    const { data: m } = await db.from('sales_staff').select('phone').eq('role', 'manager').eq('active', true);
    phones = (m || []).map((x: { phone: string }) => p10(x.phone)).filter(Boolean);
  }
  phones = [...new Set(phones)].slice(0, 10);

  const url = Deno.env.get(weekly ? 'SENIQIFY_SALES_WEEKLY_TEMPLATE_URL' : 'SENIQIFY_SALES_DAILY_TEMPLATE_URL') || '';
  const apiKey = Deno.env.get('SENIQIFY_API_KEY') || '';
  const values = weekly ? weeklyValues(data) : dailyValues(data);
  const results: { to: string; ok: boolean; status: number | null; error?: string }[] = [];
  let skipped = '';
  if (off) skipped = 'turned off in Settings';
  else if (!url) skipped = 'WhatsApp template not set yet';
  else if (!phones.length) skipped = 'no manager mobile number';
  else {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    for (const to of phones) {
      try {
        const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ receiver: `91${to}`, values }), signal: AbortSignal.timeout(15000) });
        results.push({ to: `${to.slice(0, 2)}******${to.slice(-2)}`, ok: r.ok, status: r.status, error: r.ok ? undefined : (await r.text()).slice(0, 200) });
      } catch (e) {
        results.push({ to: `${to.slice(0, 2)}******${to.slice(-2)}`, ok: false, status: null, error: String((e as Error).message).slice(0, 200) });
      }
    }
  }

  const sent = { at: new Date().toISOString(), skipped: skipped || undefined, results, test: kind === 'test' || undefined };
  if (kind !== 'test') {
    const { error: insErr } = await db.from('sales_reports').insert({ kind, period_from: period.from, period_to: period.to, data, sent });
    if (insErr) return json({ error: insErr.message }, 500);
  }
  return json({ ok: true, kind, period, sent });
});

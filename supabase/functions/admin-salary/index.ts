// ===========================================================================
//  admin-salary  --  PocketLink Admin: the "salary paid" WhatsApp message
//
//  After a salary is marked paid in Admin (the DATABASE does that:
//  admin_payroll_mark_paid), this sends the person one WhatsApp message on
//  the approved template, if it is set:
//    SENIQIFY_SALARY_PAID_TEMPLATE_URL   template pocketlink_salary_paid
//      {{1}} first name   {{2}} month, e.g. "November 2026"
//      {{3}} amount, e.g. "Rs 14,167"   {{4}} "UPI" | "bank transfer" | "cash"
//    SENIQIFY_API_KEY                    as for every WhatsApp message
//  Nothing is sent (and nothing fails) while the template is not set, the
//  rule is off in Salary setup, or the person has no mobile number in the CRM.
//
//  Who may: the DATABASE decides, asked as the signed-in person
//  (admin_payroll_notify_data: Owner or Finance, 2-step, salary marked paid).
//  verify_jwt: true. Body: { action: 'notify', slipId }
//  No money moves here or anywhere in salary.
// ===========================================================================
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const METHOD: Record<string, string> = { upi: 'UPI', bank: 'bank transfer', cash: 'cash' };
const tv = (v: unknown) => String(v ?? '').replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, 60) || '-';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const authz = req.headers.get('Authorization') || '';
  if (!authz.startsWith('Bearer ')) return json({ error: 'sign in first' }, 401);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty */ }
  if (body.action !== 'notify') return json({ error: 'unknown action' }, 400);
  const slipId = String(body.slipId || '');
  if (!UUID.test(slipId)) return json({ error: 'bad salary' }, 400);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const asUser = createClient(url, anonKey, { global: { headers: { Authorization: authz } }, auth: { persistSession: false } });

  const { data: d, error } = await asUser.rpc('admin_payroll_notify_data', { p_slip: slipId });
  if (error) return json({ error: error.message }, /role|2-step|admin team/i.test(error.message) ? 403 : 400);

  const phone = String(d?.phone || '').replace(/\D/g, '').slice(-10);
  const tpl = (Deno.env.get('SENIQIFY_SALARY_PAID_TEMPLATE_URL') || '').trim();
  const apiKey = Deno.env.get('SENIQIFY_API_KEY') || '';
  let skipped = '';
  if (!d?.whatsapp_on) skipped = 'turned off in Salary setup';
  else if (d?.notified_at) skipped = 'already sent';
  else if (!tpl) skipped = 'WhatsApp template not set yet';
  else if (phone.length !== 10) skipped = 'no mobile number for them in the CRM team';
  if (skipped) return json({ ok: true, sent: false, skipped });

  const values = {
    1: tv(d.name), 2: tv(d.month), 3: `Rs ${Math.round(Number(d.net) || 0).toLocaleString('en-IN')}`, 4: METHOD[d.method] || 'bank transfer',
  };
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
  try {
    const r = await fetch(tpl, { method: 'POST', headers, body: JSON.stringify({ receiver: `91${phone}`, values }), signal: AbortSignal.timeout(15000) });
    if (!r.ok) return json({ ok: true, sent: false, skipped: `WhatsApp said ${r.status}` });
  } catch (e) {
    return json({ ok: true, sent: false, skipped: String((e as Error).message || 'no answer').slice(0, 120) });
  }
  await asUser.rpc('admin_payroll_notified', { p_slip: slipId });
  return json({ ok: true, sent: true });
});

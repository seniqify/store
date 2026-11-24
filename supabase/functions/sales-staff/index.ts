// ===========================================================================
//  sales-staff  --  a manager adds people to the Sales CRM
//
//  Creating a login needs the service role, which never reaches a browser, so
//  the CRM's Team screen calls this. The caller must be an ACTIVE manager in
//  sales_staff (checked here with the service role, never trusted from the
//  request). It only ever touches CRM people:
//    create    { email, password, name, role, phone?, area? }
//              -> a confirmed login with that password and a sales_staff row.
//                 An email that already has a login is added WITHOUT touching
//                 its password (they keep their own); one already in the CRM
//                 is refused.
//    password  { user_id, password } -> a new password for a caller or field
//              executive. Never a manager's, never your own, never a login
//              that is also in crm_team (the Console).
//  Nothing here can reach shops, orders or the Console's crm_team.
//
//  Deploy with verify_jwt = true.
// ===========================================================================
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const ROLES = ['manager', 'caller', 'field'];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

const clean = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
const phone10 = (v: unknown) => { const d = String(v ?? '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : ''; };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Who is asking: the JWT the platform already verified.
  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const { data: who, error: whoErr } = await admin.auth.getUser(jwt);
  if (whoErr || !who?.user) return json({ error: 'Please sign in again.' }, 401);
  const { data: me } = await admin.from('sales_staff').select('role, active').eq('user_id', who.user.id).maybeSingle();
  if (!me || !me.active || me.role !== 'manager') return json({ error: 'Only a manager can do this.' }, 403);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return json({ error: 'Bad request' }, 400); }

  if (body.action === 'create') {
    const email = clean(body.email, 120).toLowerCase();
    const password = String(body.password ?? '');
    const name = clean(body.name, 80);
    const role = clean(body.role, 10);
    if (!EMAIL.test(email)) return json({ error: 'Enter a real email address.' });
    if (password.length < 8) return json({ error: 'The password needs at least 8 characters.' });
    if (!name) return json({ error: 'Enter their name.' });
    if (!ROLES.includes(role)) return json({ error: 'Pick a role.' });

    let userId = '';
    let existing = false;
    const created =await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.data?.user) {
      userId = created.data.user.id;
    } else {
      // Already has a login (for example someone from the old Hub): find it.
      for (let page = 1; page <= 20 && !userId; page++) {
        const { data } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
        const hit = data?.users?.find((u) => (u.email || '').toLowerCase() === email);
        if (hit) userId = hit.id;
        if (!data?.users?.length || data.users.length < 1000) break;
      }
      if (!userId) return json({ error: created.error?.message || 'Could not create the login.' });
      const { data: already } = await admin.from('sales_staff').select('user_id').eq('user_id', userId).maybeSingle();
      if (already) return json({ error: 'This email is already in the CRM.' });
      // An existing login keeps ITS OWN password: changing it here would let a
      // manager take over any account (the Console's included) by "adding" it.
      existing = true;
    }

    const { error } = await admin.from('sales_staff').insert({
      user_id: userId, name, email, role,
      phone: phone10(body.phone) || null,
      area: clean(body.area, 120) || null,
    });
    if (error) return json({ error: 'Could not add them. Try again.' }, 500);
    return json({ ok: true, user_id: userId, existing });
  }

  if (body.action === 'password') {
    const userId = clean(body.user_id, 64);
    const password = String(body.password ?? '');
    if (password.length < 8) return json({ error: 'The password needs at least 8 characters.' });
    if (userId === who.user.id) return json({ error: 'Change your own password from your account menu.' });
    const { data: person } = await admin.from('sales_staff').select('user_id, role').eq('user_id', userId).maybeSingle();
    if (!person) return json({ error: 'Not a CRM person.' }, 404);
    // Never a manager's, and never a login that also opens the Console.
    if (person.role === 'manager') return json({ error: 'A manager changes their own password.' }, 403);
    const { data: consoleLogin } = await admin.from('crm_team').select('user_id').eq('user_id', userId).maybeSingle();
    if (consoleLogin) return json({ error: 'This login is also used elsewhere. Ask them to change it themselves.' }, 403);
    const { error } = await admin.auth.admin.updateUserById(userId, { password });
    if (error) return json({ error: 'Could not change the password.' }, 500);
    return json({ ok: true });
  }

  return json({ error: 'Unknown action' }, 400);
});

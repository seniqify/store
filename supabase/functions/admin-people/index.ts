// ===========================================================================
//  admin-people  --  PocketLink Admin: logins for the admin team
//
//  What needs the service role (creating a login, a new password, removing a
//  lost phone's 2-step) happens here. Who may do it is decided by the
//  DATABASE, asked as the signed-in person (their own JWT): admin_me (on the
//  team, passed 2-step), admin_can('people'), admin_may_manage(target), and
//  admin_team_save / admin_note write the audit log as that person.
//
//  verify_jwt: true. Body: { action: 'add', email, name, role, reason }
//                         | { action: 'password', userId, reason }
//                         | { action: 'reset_2step', userId, reason }   (Owner only)
//  A new or reset password is returned once, to show to the admin.
// ===========================================================================
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLES = ['owner', 'admin', 'support', 'finance', 'viewer'];

/** 12 characters, no look-alikes (0/O, 1/l/I). */
function tempPassword(): string {
  const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const authz = req.headers.get('Authorization') || '';
  if (!authz.startsWith('Bearer ')) return json({ error: 'sign in first' }, 401);

  const url = Deno.env.get('SUPABASE_URL')!;
  const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authz } }, auth: { persistSession: false },
  });
  const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

  const { data: me } = await asUser.rpc('admin_me');
  if (!me || !me.mfa) return json({ error: 'Admin team with 2-step sign-in only.' }, 403);
  const { data: canPeople } = await asUser.rpc('admin_can', { p_what: 'people' });
  if (canPeople !== true) return json({ error: 'Your role cannot manage people.' }, 403);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty */ }
  const reason = String(body.reason ?? '').trim().slice(0, 300);

  // A person on the admin team whom this admin may manage (never themselves).
  async function target(userId: string) {
    if (!/^[0-9a-f-]{36}$/.test(userId)) return { error: 'Unknown person.' };
    const { data: row } = await service.from('admin_team').select('user_id, email, name').eq('user_id', userId).maybeSingle();
    if (!row) return { error: 'Not on the admin team.' };
    const { data: may } = await asUser.rpc('admin_may_manage', { p_user: userId });
    if (may !== true) return { error: 'You cannot change this person.' };
    return { row };
  }

  if (body.action === 'add') {
    const email = String(body.email ?? '').trim().toLowerCase().slice(0, 160);
    const name = String(body.name ?? '').trim().slice(0, 80);
    const role = String(body.role ?? '');
    if (!EMAIL.test(email)) return json({ error: 'Enter a real email address.' }, 400);
    if (!name) return json({ error: 'Enter their name.' }, 400);
    if (!ROLES.includes(role)) return json({ error: 'Pick a role.' }, 400);

    let userId = '';
    for (let page = 1; page <= 20 && !userId; page++) {
      const { data, error } = await service.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) return json({ error: 'Could not look up logins.' }, 500);
      const hit = data.users.find((u) => (u.email || '').toLowerCase() === email);
      if (hit) userId = hit.id;
      if (data.users.length < 1000) break;
    }
    let temp: string | null = null;
    if (!userId) {
      temp = tempPassword();
      const { data, error } = await service.auth.admin.createUser({ email, password: temp, email_confirm: true });
      if (error || !data.user) return json({ error: 'Could not create the login.' }, 500);
      userId = data.user.id;
    }
    const { error } = await asUser.rpc('admin_team_save', { p_user: userId, p_name: name, p_role: role, p_active: true, p_reason: reason || 'added' });
    if (error) {
      if (temp) await service.auth.admin.deleteUser(userId);   // a login made here for nothing goes again
      return json({ error: error.message }, 400);
    }
    return json({ ok: true, created: Boolean(temp), tempPassword: temp });
  }

  if (body.action === 'password' || body.action === 'reset_2step') {
    if (reason.length < 3) return json({ error: 'Write a reason.' }, 400);
    const t = await target(String(body.userId ?? ''));
    if ('error' in t) return json({ error: t.error }, 403);
    if (body.action === 'password') {
      const temp = tempPassword();
      const { error } = await service.auth.admin.updateUserById(t.row.user_id, { password: temp });
      if (error) return json({ error: 'Could not set the password.' }, 500);
      await asUser.rpc('admin_note', { p_need: 'people', p_action: 'password', p_kind: 'person', p_target: t.row.email || t.row.name, p_after: null, p_reason: reason });
      return json({ ok: true, tempPassword: temp });
    }
    if (me.role !== 'owner') return json({ error: 'Only the Owner can reset 2-step sign-in.' }, 403);
    const { data: f, error } = await service.auth.admin.mfa.listFactors({ userId: t.row.user_id });
    if (error) return json({ error: 'Could not read their 2-step.' }, 500);
    let removed = 0;
    for (const factor of f?.factors || []) {
      const { error: e } = await service.auth.admin.mfa.deleteFactor({ id: factor.id, userId: t.row.user_id });
      if (!e) removed++;
    }
    await asUser.rpc('admin_note', { p_need: 'people', p_action: 'reset_2step', p_kind: 'person', p_target: t.row.email || t.row.name, p_after: { removed }, p_reason: reason });
    return json({ ok: true, removed });
  }

  return json({ error: 'Unknown action.' }, 400);
});

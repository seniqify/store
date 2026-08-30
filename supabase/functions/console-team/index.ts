import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ── PocketLink Console — team access management (founder only) ─────────────────
// Verifies the caller is a crm_team admin, then adds / removes / re-roles team
// members. Adding by email finds the existing auth user or creates one (returns
// a one-time temp password to share). Guards against removing yourself or the
// last admin. All via the service role — never exposed to the browser.

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const token = (req.headers.get('Authorization') || '').replace('Bearer ', '').trim();
    if (!token) return json({ error: 'unauthorized' }, 401);

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData?.user) return json({ error: 'unauthorized' }, 401);
    const meId = userData.user.id;

    const { data: meRow } = await admin.from('crm_team').select('role').eq('user_id', meId).maybeSingle();
    if (!meRow || meRow.role !== 'admin') return json({ error: 'not_founder' }, 403);

    const { action, email, name, role, userId } = await req.json();

    // ── add (create-or-find the auth user, then upsert the crm_team row) ──
    if (action === 'add') {
      const e = String(email || '').trim().toLowerCase();
      if (!e || !e.includes('@')) return json({ error: 'bad_email', message: 'Enter a valid email.' });
      const r = role === 'admin' ? 'admin' : 'sales';

      const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      let target = (list?.users || []).find((u) => (u.email || '').toLowerCase() === e) || null;
      let created = false, tempPassword: string | null = null;
      if (!target) {
        tempPassword = `PL-${Math.random().toString(36).slice(2, 9)}${Math.floor(Math.random() * 90 + 10)}`;
        const { data: cu, error: ce } = await admin.auth.admin.createUser({ email: e, password: tempPassword, email_confirm: true });
        if (ce || !cu?.user) return json({ error: 'create_failed', message: ce?.message || 'Could not create the account.' });
        target = cu.user; created = true;
      }
      const finalName = (name || '').trim() || e.split('@')[0];
      const { error: ue } = await admin.from('crm_team').upsert({ user_id: target.id, name: finalName, role: r }, { onConflict: 'user_id' });
      if (ue) return json({ error: 'db', message: ue.message });
      return json({ ok: true, created, tempPassword, member: { user_id: target.id, name: finalName, role: r, email: e } });
    }

    // ── remove (guard self + last admin) ──
    if (action === 'remove') {
      if (!userId) return json({ error: 'missing', message: 'No member specified.' });
      if (userId === meId) return json({ error: 'self', message: 'You can’t remove yourself.' });
      const { data: victim } = await admin.from('crm_team').select('role').eq('user_id', userId).maybeSingle();
      if (victim?.role === 'admin') {
        const { count } = await admin.from('crm_team').select('user_id', { count: 'exact', head: true }).eq('role', 'admin');
        if ((count || 0) <= 1) return json({ error: 'last_admin', message: 'Can’t remove the last admin.' });
      }
      const { error: de } = await admin.from('crm_team').delete().eq('user_id', userId);
      if (de) return json({ error: 'db', message: de.message });
      return json({ ok: true, removed: userId });
    }

    // ── reset password (set a new one-time password to share) ──
    if (action === 'reset') {
      if (!userId) return json({ error: 'missing', message: 'No member specified.' });
      const newPass = `PL-${Math.random().toString(36).slice(2, 9)}${Math.floor(Math.random() * 90 + 10)}`;
      const { data: u, error } = await admin.auth.admin.updateUserById(userId, { password: newPass });
      if (error) return json({ error: 'reset_failed', message: error.message });
      return json({ ok: true, tempPassword: newPass, email: u?.user?.email || null });
    }

    // ── change role ──
    if (action === 'role') {
      if (!userId) return json({ error: 'missing', message: 'No member specified.' });
      const r = role === 'admin' ? 'admin' : 'sales';
      const { error } = await admin.from('crm_team').update({ role: r }).eq('user_id', userId);
      if (error) return json({ error: 'db', message: error.message });
      return json({ ok: true });
    }

    return json({ error: 'unknown_action' });
  } catch (e) {
    return json({ error: 'server', message: String((e as Error)?.message || e) });
  }
});

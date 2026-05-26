/**
 * send-otp — Supabase Edge Function
 *
 * Handles two actions:
 *   { action: "send",   phone: "919876543210" }
 *   { action: "verify", phone: "919876543210", code: "123456" }
 *
 * Provider: MSG91 WhatsApp OTP
 *
 * Required secrets (set via: npx supabase secrets set KEY=value):
 *   MSG91_AUTH_KEY      — your MSG91 API auth key
 *   MSG91_TEMPLATE_ID   — approved WhatsApp OTP template ID
 *
 * Deploy:
 *   npx supabase functions deploy send-otp
 */

import { serve }        from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

serve(async (req: Request) => {
  // Preflight
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const { action, phone, code } = await req.json();

    if (!phone) return json({ error: 'phone is required' }, 400);

    // ── Supabase client (service role — bypasses RLS) ──────────────────────
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // ── SEND ──────────────────────────────────────────────────────────────
    if (action === 'send') {
      // Generate 6-digit OTP
      const otp       = String(Math.floor(100000 + Math.random() * 900000));
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

      // Delete any previous OTPs for this phone
      await supabase.from('otp_codes').delete().eq('phone', phone);

      // Store new OTP
      const { error: insertErr } = await supabase
        .from('otp_codes')
        .insert({ phone, code: otp, expires_at: expiresAt });

      if (insertErr) throw new Error(insertErr.message);

      // ── Send via MSG91 WhatsApp OTP API ─────────────────────────────────
      const authKey    = Deno.env.get('MSG91_AUTH_KEY');
      const templateId = Deno.env.get('MSG91_TEMPLATE_ID');

      if (!authKey || !templateId) {
        // DEV MODE: log OTP to console when secrets not configured
        console.log(`[DEV] OTP for ${phone}: ${otp}`);
        return json({ success: true, dev: true });
      }

      const msg91Res = await fetch('https://api.msg91.com/api/v5/otp', {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          'authkey':       authKey,
        },
        body: JSON.stringify({
          template_id: templateId,
          mobile:      phone,   // full number e.g. "919876543210"
          otp,
        }),
      });

      const msg91 = await msg91Res.json();

      if (msg91.type !== 'success') {
        console.error('MSG91 error:', msg91);
        throw new Error('Failed to send WhatsApp OTP. Please try again.');
      }

      return json({ success: true });
    }

    // ── VERIFY ────────────────────────────────────────────────────────────
    if (action === 'verify') {
      if (!code) return json({ error: 'code is required' }, 400);

      const { data, error: fetchErr } = await supabase
        .from('otp_codes')
        .select('*')
        .eq('phone', phone)
        .eq('code',  code)
        .gt('expires_at', new Date().toISOString())
        .maybeSingle();

      if (fetchErr) throw new Error(fetchErr.message);

      if (!data) {
        // Increment attempts for rate-limiting (best-effort)
        await supabase.rpc('increment_otp_attempts', { p_phone: phone })
          .catch(() => null);

        return json({ error: 'Invalid or expired OTP. Please try again.' }, 400);
      }

      // Valid — delete the used OTP
      await supabase.from('otp_codes').delete().eq('phone', phone);

      return json({ success: true });
    }

    return json({ error: 'Unknown action' }, 400);

  } catch (err) {
    console.error('send-otp error:', err);
    return json({ error: (err as Error).message ?? 'Internal error' }, 500);
  }
});

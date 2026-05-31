import { serve }        from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SENIQIFY_URL = 'https://adminapis.backendprod.com/lms_campaign/api/whatsapp/template/9x3izwha06/process';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const { action, phone, code } = await req.json();
    if (!phone) return json({ error: 'phone is required' }, 400);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // ── SEND ─────────────────────────────────────────────────────────────────
    if (action === 'send') {
      const otp       = String(Math.floor(100000 + Math.random() * 900000));
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min

      // Replace any previous OTP for this phone
      await supabase.from('otp_codes').delete().eq('phone', phone);
      const { error: insertErr } = await supabase
        .from('otp_codes')
        .insert({ phone, code: otp, expires_at: expiresAt });

      if (insertErr) throw new Error(insertErr.message);

      // ── Seniqify WhatsApp API ────────────────────────────────────────────
      const apiKey   = Deno.env.get('SENIQIFY_API_KEY');
      const receiver = String(phone).replace(/\D/g, ''); // e.g. 919876543210

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

      const waRes  = await fetch(SENIQIFY_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({ receiver, values: { '1': otp } }),
      });
      const waBody = await waRes.text();

      if (!waRes.ok) {
        throw new Error(`Seniqify ${waRes.status}: ${waBody}`);
      }

      return json({ success: true });
    }

    // ── VERIFY ───────────────────────────────────────────────────────────────
    if (action === 'verify') {
      if (!code) return json({ error: 'code is required' }, 400);

      const { data, error: fetchErr } = await supabase
        .from('otp_codes')
        .select('*')
        .eq('phone', phone)
        .eq('code',  String(code))
        .gt('expires_at', new Date().toISOString())
        .maybeSingle();

      if (fetchErr) throw new Error(fetchErr.message);

      if (!data) {
        return json({ error: 'Invalid or expired OTP. Please try again.' }, 400);
      }

      // One-time use — delete after successful verify
      await supabase.from('otp_codes').delete().eq('phone', phone);
      return json({ success: true });
    }

    return json({ error: 'Unknown action' }, 400);

  } catch (err) {
    console.error('send-otp error:', err);
    return json({ error: (err as Error).message ?? 'Internal error' }, 500);
  }
});

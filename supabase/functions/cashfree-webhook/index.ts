import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { crypto } from 'https://deno.land/std@0.168.0/crypto/mod.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-signature, x-webhook-timestamp',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const rawBody   = await req.text();
    const timestamp = req.headers.get('x-webhook-timestamp') ?? '';
    const signature = req.headers.get('x-webhook-signature') ?? '';
    const secret    = Deno.env.get('CASHFREE_SECRET_KEY') ?? '';

    // ── Verify Cashfree signature ────────────────────────────────────────────
    const signedPayload = timestamp + rawBody;
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const sigBytes  = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedPayload));
    const computed  = btoa(String.fromCharCode(...new Uint8Array(sigBytes)));

    if (computed !== signature) {
      return new Response('Invalid signature', { status: 401 });
    }

    // ── Parse event ──────────────────────────────────────────────────────────
    const event = JSON.parse(rawBody);
    const paymentStatus = event?.data?.payment?.payment_status;
    const orderId       = event?.data?.order?.order_id as string | undefined;

    if (paymentStatus !== 'SUCCESS' || !orderId) {
      // Non-success events — acknowledge but do nothing
      return new Response('ok', { status: 200 });
    }

    // ── Extract plan from order_id (format: PL_STARTER_timestamp) ────────────
    const match = orderId.match(/^PL_([A-Z]+)_/);
    const plan  = match ? match[1].toLowerCase() : null;

    if (!plan) {
      return new Response('Unknown order format', { status: 200 });
    }

    // ── Mark payment as verified in Supabase ─────────────────────────────────
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    await supabase.from('payments').upsert({
      order_id:  orderId,
      plan,
      status:    'paid',
      paid_at:   new Date().toISOString(),
    });

    return new Response('ok', { status: 200 });
  } catch (err) {
    console.error('Webhook error:', err);
    // Always return 200 to Cashfree so it stops retrying on our errors
    return new Response('ok', { status: 200 });
  }
});

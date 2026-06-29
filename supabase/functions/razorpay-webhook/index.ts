import { serve }        from 'https://deno.land/std@0.168.0/http/server.ts';
import { crypto }       from 'https://deno.land/std@0.168.0/crypto/mod.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GRACE_MS = 3 * 86400 * 1000; // 3-day cushion so a slightly-late charge never downgrades a store

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  try {
    const raw       = await req.text();
    const signature = req.headers.get('x-razorpay-signature') ?? '';
    const secret    = Deno.env.get('RAZORPAY_WEBHOOK_SECRET');
    if (!secret) throw new Error('Webhook secret not configured');

    // Verify the webhook came from Razorpay
    const expected = await hmacHex(secret, raw);
    if (expected !== signature) return new Response('Invalid signature', { status: 401 });

    const event = JSON.parse(raw);
    const type  = event.event as string;
    const sub   = event.payload?.subscription?.entity;
    if (!sub) return new Response('ok', { status: 200 }); // not a subscription event we handle

    const plan       = sub.notes?.plan ?? null;
    const phone      = sub.notes?.phone ?? null;
    const currentEnd = sub.current_end ? sub.current_end * 1000 : Date.now();
    if (!phone) return new Response('ok', { status: 200 });

    // Decide the new expiry based on the event
    const period     = sub.notes?.period ?? 'monthly';
    const fallbackMs = (period === 'yearly' ? 368 : 33) * 86400000;
    let planExpiresAt: string | null = null;
    let active = false; // true for paid/active events (vs. a stop event)
    if (type === 'subscription.charged' || type === 'subscription.activated') {
      // Paid / now active → entitled until the next charge (+grace). On a fresh
      // activation current_end may not be set yet, so fall back to one cycle.
      const baseEnd = sub.current_end ? sub.current_end * 1000 : (Date.now() + fallbackMs);
      planExpiresAt = new Date(baseEnd + GRACE_MS).toISOString();
      active = true;
    } else if (
      type === 'subscription.cancelled' ||
      type === 'subscription.completed' ||
      type === 'subscription.halted' ||
      type === 'subscription.paused'
    ) {
      // Stops renewing → stays active until the end of the cycle already paid for
      planExpiresAt = new Date(currentEnd).toISOString();
    } else {
      return new Response('ok', { status: 200 }); // authenticated/pending — nothing to do
    }

    // Update the store for this phone number (service-role bypasses RLS)
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const last10 = String(phone).replace(/\D/g, '').slice(-10);
    const { data: rows } = await supabase
      .from('stores')
      .select('slug, config')
      .filter('config->>whatsappNumber', 'ilike', `%${last10}`)
      .limit(1);

    const store = rows?.[0];
    if (store) {
      const newConfig = {
        ...store.config,
        plan:                  plan ?? store.config.plan,
        planExpiresAt,
        razorpaySubscriptionId: sub.id,
      };
      await supabase
        .from('stores')
        .update({ config: newConfig, updated_at: new Date().toISOString() })
        .eq('slug', store.slug);
    } else if (active && plan) {
      // No store yet → a first-time subscriber who paid but hasn't built their
      // store (or whose browser failed after paying). Record the paid plan by
      // phone so onboarding applies it automatically — no double payment, no
      // manual coupon needed. Mirrors the client's savePendingSignup.
      await supabase
        .from('pending_signups')
        .upsert(
          { phone: last10, plan, plan_expires_at: planExpiresAt, subscription_id: sub.id },
          { onConflict: 'phone' },
        );
    }

    return new Response('ok', { status: 200 });
  } catch (err) {
    // Always 200 so Razorpay doesn't hammer retries on our parsing bugs; log for debugging
    console.error('razorpay-webhook error:', (err as Error).message);
    return new Response('ok', { status: 200 });
  }
});

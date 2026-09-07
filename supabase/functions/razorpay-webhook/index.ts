import { serve }        from 'https://deno.land/std@0.168.0/http/server.ts';
import { crypto }       from 'https://deno.land/std@0.168.0/crypto/mod.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GRACE_MS = 3 * 86400 * 1000; // 3-day cushion so a slightly-late charge never downgrades a store

// Reverse of create-razorpay-subscription's PLAN_IDS: plan_id -> plan + period.
//
// A subscription created through PocketLink's checkout carries notes
// {plan, period, phone}. One created by hand in the Razorpay dashboard (a
// renewal link sent to a customer, say) carries NO notes at all — which used to
// make this webhook exit silently and drop a real payment on the floor. The
// plan_id is always present on the subscription entity, so it can stand in.
//
// Keep in sync with create-razorpay-subscription/index.ts.
const PLAN_BY_ID: Record<string, { plan: string; period: string }> = {
  // Current plan — ₹1,099/mo · ₹9,999/yr
  plan_TX4Yj0ktnJ9Ic3: { plan: 'premium', period: 'monthly' },
  plan_TX4a4orxglrlrC: { plan: 'premium', period: 'yearly'  },
  // Retired but permanent — existing mandates keep renewing on these.
  plan_T534Tj7pKAPhOP: { plan: 'starter',  period: 'monthly' },
  plan_T534TvGMXAl18M: { plan: 'starter',  period: 'yearly'  },
  plan_Szqmme5MgX3kcg: { plan: 'pro',      period: 'monthly' },
  plan_SzqmmuDV66K4lm: { plan: 'pro',      period: 'yearly'  },
  plan_T8tUVJDyKVHUqA: { plan: 'business', period: 'monthly' },
  plan_T8tUVTmHtEauYl: { plan: 'business', period: 'yearly'  },
  plan_T8tUVd3OJkD8m8: { plan: 'premium',  period: 'monthly' },
  plan_T8tUVnFLUkTGYl: { plan: 'premium',  period: 'yearly'  },
  // premium_plus is recorded as 'premium' — only the debited amount differed.
  plan_SzqmnPq8JoWcSc: { plan: 'premium',  period: 'monthly' },
  plan_SzqmnZ9M5keufj: { plan: 'premium',  period: 'yearly'  },
};

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
    const pay   = event.payload?.payment?.entity;
    if (!sub) {
      console.log(`razorpay-webhook: ignored ${type} (no subscription entity)`);
      return new Response('ok', { status: 200 });
    }

    // ── Identify the customer ────────────────────────────────────────────────
    // Prefer the notes our own checkout writes; fall back to the phone on the
    // payment entity, which Razorpay includes on subscription.charged. Without
    // this fallback a dashboard-created subscription is unattributable.
    const phone = sub.notes?.phone ?? pay?.contact ?? null;
    const fromNotes = Boolean(sub.notes?.phone);

    // Same idea for the plan: notes first, then the plan_id it is billing on.
    const mapped     = PLAN_BY_ID[String(sub.plan_id ?? '')] ?? null;
    const plan       = sub.notes?.plan ?? mapped?.plan ?? null;
    const period     = sub.notes?.period ?? mapped?.period ?? 'monthly';
    const currentEnd = sub.current_end ? sub.current_end * 1000 : Date.now();

    if (!phone) {
      // Nothing to match on. Log loudly — a real payment may have just been
      // dropped, and silence here is how that goes unnoticed for weeks.
      console.error(
        `razorpay-webhook: UNATTRIBUTABLE ${type} sub=${sub.id} plan_id=${sub.plan_id} ` +
        `— no notes.phone and no payment.contact. Payment may need manual provisioning.`,
      );
      return new Response('ok', { status: 200 });
    }

    // Decide the new expiry based on the event
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
      console.log(`razorpay-webhook: no-op event ${type} sub=${sub.id}`);
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
      console.log(
        `razorpay-webhook: ${type} → ${store.slug} plan=${plan} until=${planExpiresAt} ` +
        `(phone from ${fromNotes ? 'notes' : 'payment.contact'})`,
      );
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
      console.log(`razorpay-webhook: ${type} → no store for ${last10}, parked in pending_signups`);
    } else {
      console.error(
        `razorpay-webhook: ${type} sub=${sub.id} phone=${last10} matched NO store and ` +
        `could not be parked (active=${active} plan=${plan}). Needs manual provisioning.`,
      );
    }

    return new Response('ok', { status: 200 });
  } catch (err) {
    // Always 200 so Razorpay doesn't hammer retries on our parsing bugs; log for debugging
    console.error('razorpay-webhook error:', (err as Error).message);
    return new Response('ok', { status: 200 });
  }
});

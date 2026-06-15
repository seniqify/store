import { supabase } from '../lib/supabase';
import { hashPin }  from './pinHash';

/** Fetch a store config from DB by slug. Returns null if not found. */
export async function fetchStore(slug) {
  const { data, error } = await supabase
    .from('stores')
    .select('config')
    .eq('slug', slug)
    .single();

  if (error || !data) return null;
  // plan is stored inside config JSONB; default to 'free' if absent
  return { ...data.config, plan: data.config?.plan ?? 'free' };
}

/** Save a brand-new store to DB. Hashes PIN before storing. Throws on error. */
export async function createStore(config, pin, ownerPhone = null) {
  // Block duplicate stores for the same WhatsApp number
  const last10 = String(config.whatsappNumber || '').replace(/\D/g, '').slice(-10);
  if (last10) {
    const { data: existing } = await supabase
      .from('stores')
      .select('slug')
      .filter('config->>whatsappNumber', 'ilike', `%${last10}`)
      .limit(1);
    if (existing?.length) {
      throw new Error(
        `A store already exists for this WhatsApp number. Visit /${existing[0].slug} to manage it.`
      );
    }
  }

  const hashedPin = await hashPin(pin);
  // Honour the chosen plan + trial expiry (was previously forced to 'free',
  // which dropped paid plans). Defaults keep brand-new free stores unchanged.
  const configToSave = {
    ...config,
    plan:          config.plan ?? 'free',
    planExpiresAt: config.planExpiresAt ?? null,
    ownerPhone,
  };
  const { error } = await supabase
    .from('stores')
    .insert({
      slug:   config.slug,
      config: configToSave,
      pin:    hashedPin,
    });

  if (error) throw new Error(error.message);
}

/**
 * Update an existing store's config. PIN-checked server-side via the
 * update_store_config RPC (the table no longer allows public UPDATE). The RPC
 * preserves the server-managed plan/billing fields, so this can't self-upgrade.
 */
export async function updateStore(slug, config, pin) {
  const hashed = await hashPin(pin);
  const { data, error } = await supabase.rpc('update_store_config', {
    p_slug: slug, p_hashed_pin: hashed, p_config: config,
  });
  if (error) throw new Error(error.message);
  if (data === false) throw new Error('Could not save — please re-enter your PIN and try again.');
}

/**
 * Upgrade / renew an existing store's plan (after a paid purchase or coupon).
 * Merges the new plan + optional trial expiry into the stored config — used so
 * renewals upgrade the existing page instead of creating a new one.
 * Pass `subscriptionId` to record the Razorpay auto-debit subscription.
 */
export async function upgradePlan(slug, plan, planExpiresAt = null, subscriptionId = null) {
  // Touches only plan/billing fields server-side (upgrade_store_plan RPC) — it
  // can't overwrite the rest of the store, even without a PIN.
  const { error } = await supabase.rpc('upgrade_store_plan', {
    p_slug: slug, p_plan: plan, p_expires: planExpiresAt, p_sub_id: subscriptionId,
  });
  if (error) throw new Error(error.message);
}

/**
 * Verify PIN via Supabase RPC (server-side comparison — PIN never sent raw).
 * Falls back to direct query if RPC function isn't deployed yet.
 */
export async function verifyPin(slug, pin) {
  const hashedPin = await hashPin(pin);

  // Use the secure RPC function (security definer bypasses column restrictions)
  const { data, error } = await supabase.rpc('verify_store_pin', {
    p_slug:       slug,
    p_hashed_pin: hashedPin,
  });

  if (error) {
    // Fallback: direct compare (works if RPC function not yet created)
    const { data: row } = await supabase
      .from('stores')
      .select('pin')
      .eq('slug', slug)
      .single();
    return row?.pin === hashedPin;
  }

  return Boolean(data);
}

/**
 * Reset PIN after proving control of the store's WhatsApp number via a one-time
 * OTP (sent through otpService). The RPC verifies, server-side, that the OTP is
 * valid + unexpired AND that the number matches the store — so knowing the
 * (public) number alone is no longer enough to take over a store.
 * Throws if the OTP/number is invalid.
 */
export async function resetPin(slug, newPin, whatsappNumber, code) {
  const hashedPin = await hashPin(newPin);
  const { data, error } = await supabase.rpc('reset_store_pin', {
    p_slug: slug, p_whatsapp: whatsappNumber, p_code: String(code || ''), p_new_hashed_pin: hashedPin,
  });
  if (error) throw new Error(error.message);
  if (data === false) throw new Error('Incorrect or expired OTP. Please try again.');
}

/**
 * Permanently delete a store after PIN is verified.
 * Caller must verify PIN first via verifyPin(); this just does the DELETE.
 */
export async function deleteStore(slug) {
  const { error } = await supabase
    .from('stores')
    .delete()
    .eq('slug', slug);

  if (error) throw new Error(error.message);
}

/** Check if a store exists for a given phone number. Returns slug or null. */
export async function findStoreByPhone(phone) {
  const last10 = String(phone).replace(/\D/g, '').slice(-10);
  if (!last10) return null;
  const { data } = await supabase
    .from('stores')
    .select('slug')
    .filter('config->>whatsappNumber', 'ilike', `%${last10}`)
    .limit(1);
  return data?.[0]?.slug ?? null;
}

/**
 * Read-only: list all stores for the public marketplace/discovery page.
 * Returns an array of card-shaped config objects, each with its `slug`.
 * Selects ONLY the fields the marketplace card needs — never the heavy
 * `products` array — so the payload stays small as the store count grows.
 * Writes nothing — safe for anonymous/public use. Only named stores are returned.
 */
export async function listStores() {
  // Preferred source: the `marketplace_listing` view, which adds a `search_text`
  // column (store name + category + tagline + product names) so the marketplace
  // can match an item search — not just the store name. If the view isn't
  // present yet (migration not run), fall back to the base table so the
  // marketplace still works (just without product-level search).
  const viewCols =
    'slug, created_at, businessName, tagline, category, businessType, city, state, area, ' +
    'address, logo, logoEmoji, coverImage, whatsappNumber, theme, hours, search_text';
  const viaView = await supabase.from('marketplace_listing').select(viewCols).limit(500);
  if (!viaView.error && viaView.data) {
    return viaView.data.filter((c) => c && c.businessName);
  }

  const { data, error } = await supabase
    .from('stores')
    .select(`slug, created_at,
      businessName:config->>businessName, tagline:config->>tagline,
      category:config->>category, businessType:config->>businessType,
      city:config->>city, state:config->>state, area:config->>area,
      address:config->>address, logo:config->>logo, logoEmoji:config->>logoEmoji,
      coverImage:config->>coverImage, whatsappNumber:config->>whatsappNumber,
      theme:config->theme, hours:config->hours`)
    .limit(500);

  if (error || !data) return [];
  return data.filter((c) => c && c.businessName);
}

// ── Pending signups ────────────────────────────────────────────────────────
// A customer can pay BEFORE building their store (pay → onboarding). If they
// leave mid-onboarding, the payment must not be lost: we record it by phone so
// a returning, OTP-verified user resumes onboarding instead of paying again.

/** Record a paid-but-not-yet-built signup, keyed by phone (last 10 digits). */
export async function savePendingSignup(phone, plan, planExpiresAt = null, subscriptionId = null) {
  const last10 = String(phone).replace(/\D/g, '').slice(-10);
  if (!last10) return;
  await supabase.from('pending_signups').upsert(
    { phone: last10, plan, plan_expires_at: planExpiresAt, subscription_id: subscriptionId },
    { onConflict: 'phone' },
  );
}

/** Look up a pending paid signup. Returns { plan, planExpiresAt, subscriptionId } or null. */
export async function getPendingSignup(phone) {
  const last10 = String(phone).replace(/\D/g, '').slice(-10);
  if (!last10) return null;
  const { data } = await supabase
    .from('pending_signups')
    .select('plan, plan_expires_at, subscription_id')
    .eq('phone', last10)
    .maybeSingle();
  if (!data) return null;
  return { plan: data.plan, planExpiresAt: data.plan_expires_at, subscriptionId: data.subscription_id };
}

/** Clear a pending signup once the store is actually created. */
export async function clearPendingSignup(phone) {
  const last10 = String(phone).replace(/\D/g, '').slice(-10);
  if (!last10) return;
  await supabase.from('pending_signups').delete().eq('phone', last10);
}

/** Check if a slug already exists in DB. */
export async function slugExists(slug) {
  const { data } = await supabase
    .from('stores')
    .select('slug')
    .eq('slug', slug)
    .maybeSingle();

  return Boolean(data);
}

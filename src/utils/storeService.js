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
  const configToSave = { ...config, plan: 'free', ownerPhone };
  const { error } = await supabase
    .from('stores')
    .insert({
      slug:   config.slug,
      config: configToSave,
      pin:    hashedPin,
    });

  if (error) throw new Error(error.message);
}

/** Update an existing store's config after PIN is verified. */
export async function updateStore(slug, config) {
  const { error } = await supabase
    .from('stores')
    .update({ config, updated_at: new Date().toISOString() })
    .eq('slug', slug);

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
 * Reset PIN after verifying ownership via WhatsApp number.
 * The store's whatsappNumber (stored in config) is the identity proof.
 * Throws if the number doesn't match.
 */
export async function resetPin(slug, newPin, whatsappNumber) {
  // Fetch the public config to verify ownership
  const config = await fetchStore(slug);
  if (!config) throw new Error('Store not found.');

  // Normalise both to last 10 digits for comparison
  const storedDigits = String(config.whatsappNumber || '').replace(/\D/g, '').slice(-10);
  const inputDigits  = String(whatsappNumber).replace(/\D/g, '').slice(-10);

  if (!storedDigits || storedDigits !== inputDigits) {
    throw new Error('WhatsApp number does not match this store. Please try again.');
  }

  const hashedPin = await hashPin(newPin);
  const { error } = await supabase
    .from('stores')
    .update({ pin: hashedPin, updated_at: new Date().toISOString() })
    .eq('slug', slug);

  if (error) throw new Error(error.message);
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

/** Check if a slug already exists in DB. */
export async function slugExists(slug) {
  const { data } = await supabase
    .from('stores')
    .select('slug')
    .eq('slug', slug)
    .maybeSingle();

  return Boolean(data);
}

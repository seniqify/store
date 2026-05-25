import { supabase } from '../lib/supabase';

/** Fetch a store config from DB by slug. Returns null if not found. */
export async function fetchStore(slug) {
  const { data, error } = await supabase
    .from('stores')
    .select('config')
    .eq('slug', slug)
    .single();

  if (error || !data) return null;
  return data.config;
}

/** Save a brand-new store to DB. Throws on error. */
export async function createStore(config, pin) {
  const { error } = await supabase
    .from('stores')
    .insert({ slug: config.slug, config, pin: String(pin) });

  if (error) throw new Error(error.message);
}

/** Update an existing store after PIN is verified. */
export async function updateStore(slug, config) {
  const { error } = await supabase
    .from('stores')
    .update({ config, updated_at: new Date().toISOString() })
    .eq('slug', slug);

  if (error) throw new Error(error.message);
}

/** Returns true if PIN matches, false otherwise. */
export async function verifyPin(slug, pin) {
  const { data, error } = await supabase
    .from('stores')
    .select('pin')
    .eq('slug', slug)
    .single();

  if (error || !data) return false;
  return data.pin === String(pin);
}

/** Check if a slug already exists in DB. */
export async function slugExists(slug) {
  const { data } = await supabase
    .from('stores')
    .select('slug')
    .eq('slug', slug)
    .single();

  return Boolean(data);
}

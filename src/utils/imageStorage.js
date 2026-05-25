/**
 * imageStorage — uploads product images to Supabase Storage.
 * Falls back to base64 if upload fails (so onboarding never breaks).
 *
 * Bucket: product-images (must be created in Supabase → Storage → New bucket,
 * set to Public, no size limit needed beyond your plan).
 */
import { supabase } from '../lib/supabase';

const BUCKET = 'product-images';

/**
 * Upload a base64 data URL to Supabase Storage.
 * Returns the public URL of the uploaded image.
 */
export async function uploadProductImage(base64DataUrl, slug) {
  // Convert base64 → Blob
  const res  = await fetch(base64DataUrl);
  const blob = await res.blob();

  const ext  = blob.type.includes('jpeg') ? 'jpg' : 'png';
  const path = `${slug}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, { contentType: blob.type, upsert: false });

  if (error) throw new Error(`Image upload failed: ${error.message}`);

  const { data: urlData } = supabase.storage
    .from(BUCKET)
    .getPublicUrl(data.path);

  return urlData.publicUrl;
}

/** Returns true if the value is a base64 data URL (not yet uploaded). */
export function isBase64Image(value) {
  return typeof value === 'string' && value.startsWith('data:');
}

/**
 * Upload all base64 product images for a config.
 * Returns updated products array with Storage URLs.
 * Keeps original value on any per-image failure.
 */
export async function uploadConfigImages(products, slug) {
  return Promise.all(
    (products || []).map(async (product) => {
      if (!isBase64Image(product.image)) return product;
      try {
        const url = await uploadProductImage(product.image, slug);
        return { ...product, image: url };
      } catch (err) {
        console.warn(`Image upload skipped for "${product.name}":`, err.message);
        return product; // fallback: keep base64 (works but large)
      }
    })
  );
}

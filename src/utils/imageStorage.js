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
 * Upload a single base64 image (logo or cover) to Supabase Storage.
 * Returns the public URL, or the original value if it's already a URL.
 */
export async function uploadSingleImage(base64DataUrl, slug, name = 'image') {
  if (!isBase64Image(base64DataUrl)) return base64DataUrl;
  try {
    const res  = await fetch(base64DataUrl);
    const blob = await res.blob();
    const ext  = blob.type.includes('jpeg') ? 'jpg' : 'png';
    const path = `${slug}/${name}-${Date.now()}.${ext}`;
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .upload(path, blob, { contentType: blob.type, upsert: true });
    if (error) throw error;
    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(data.path);
    return urlData.publicUrl;
  } catch (err) {
    console.warn(`${name} upload skipped:`, err.message);
    return base64DataUrl;
  }
}

/**
 * Upload all base64 product images for a config — both the main product image
 * and any per-variant option images (e.g. a photo for each colour).
 * Returns updated products array with Storage URLs.
 * Keeps original value on any per-image failure.
 */
export async function uploadConfigImages(products, slug) {
  return Promise.all(
    (products || []).map(async (product) => {
      let next = product;

      // Main product image
      if (isBase64Image(product.image)) {
        try {
          next = { ...next, image: await uploadProductImage(product.image, slug) };
        } catch (err) {
          console.warn(`Image upload skipped for "${product.name}":`, err.message);
        }
      }

      // Per-variant option images (only touch options that hold a fresh base64)
      const opts = product.variants?.options;
      if (Array.isArray(opts) && opts.some((o) => isBase64Image(o?.image))) {
        const uploaded = await Promise.all(
          opts.map(async (o) => {
            if (!isBase64Image(o?.image)) return o;
            try {
              return { ...o, image: await uploadProductImage(o.image, slug) };
            } catch (err) {
              console.warn(`Variant image upload skipped for "${product.name} · ${o.name}":`, err.message);
              return o; // fallback: keep base64
            }
          })
        );
        next = { ...next, variants: { ...product.variants, options: uploaded } };
      }

      return next;
    })
  );
}

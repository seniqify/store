// Browser-side photo shrinking before upload to Supabase Storage.
//
// WHY THIS FILE EXISTS
//
// Merchants upload HD phone photos and the storefront showed them blurry. An
// audit of every stored product image (569, across 36 stores, 2026-09-13) found
// three causes, all on this side of the upload:
//
//   1. Size caps below what the storefront displays. The product page shows the
//      photo in a square up to 512 CSS px wide; on a 3x phone that is ~1170
//      device pixels, on a 2x laptop ~1024. Photos were capped at 800px — and
//      variant photos at 400px. Every one of the 62 variant photos measured
//      400px, and because the first variant is preselected, that 400px image is
//      the FIRST thing shown on the grid and the full-width detail page.
//   2. One-step downscaling. A 4000px camera photo was drawn straight to 800px
//      in a single drawImage, with the browser's default smoothing quality
//      ('low' in Chromium). A 5x jump skips most source pixels, which reads as
//      soft and jagged at once.
//   3. JPEG quality 0.82, applied on top of both.
//
// Legacy uploads cannot be repaired here: 268 main product photos were stored
// at 400px before July and the originals never left the merchant's phone.
// Those need re-uploading; the Manage uploader now flags them.

/** Longest side for product, gallery and variant photos. */
export const PRODUCT_MAX_DIM = 1200;

/** Logos render at ~64–96 CSS px; 800 is already generous. */
export const LOGO_MAX_DIM = 800;

/**
 * JPEG quality. 0.85 rather than the old 0.82: the blur came from resolution
 * and resampling, not compression, so this is a small, cheap step up — not a
 * doubling of file size for invisible gain.
 */
export const JPEG_QUALITY = 0.85;

/**
 * The size to encode at: never larger than the source (upscaling adds bytes and
 * no detail), and never larger than maxDim on the longest side.
 */
export function targetSize(width, height, maxDim) {
  const w = Math.floor(Number(width)), h = Math.floor(Number(height));
  if (!(w > 0 && h > 0)) return { width: 0, height: 0 };
  if (w <= maxDim && h <= maxDim) return { width: w, height: h };
  const r = Math.min(maxDim / w, maxDim / h);
  return { width: Math.max(1, Math.round(w * r)), height: Math.max(1, Math.round(h * r)) };
}

/**
 * The intermediate sizes to draw through. Halve while the result stays at or
 * above the target, then finish at the target exactly. Each draw is then a
 * reduction of at most 2x, which bilinear smoothing resolves cleanly; one large
 * jump samples too few source pixels and aliases.
 */
export function downscaleSteps(width, height, targetW, targetH) {
  const steps = [];
  let w = width, h = height;
  while (Math.floor(w / 2) >= targetW && Math.floor(h / 2) >= targetH) {
    w = Math.floor(w / 2);
    h = Math.floor(h / 2);
    steps.push({ width: w, height: h });
  }
  const last = steps[steps.length - 1];
  if (!last || last.width !== targetW || last.height !== targetH) {
    steps.push({ width: targetW, height: targetH });
  }
  return steps;
}

/**
 * Read an image File and resolve a JPEG data URL, shrunk to maxDim with
 * stepwise high-quality smoothing. Rejects for anything that is not a decodable
 * image, so callers can simply ignore the failure as before.
 */
export function compressImageFile(file, { maxDim = PRODUCT_MAX_DIM, quality = JPEG_QUALITY } = {}) {
  return new Promise((resolve, reject) => {
    if (!file || !String(file.type || '').startsWith('image/')) {
      reject(new Error('not an image'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('could not read file'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('could not decode image'));
      img.onload = () => {
        const sw = img.naturalWidth, sh = img.naturalHeight;
        const { width: tw, height: th } = targetSize(sw, sh, maxDim);
        if (!tw || !th) { reject(new Error('image has no size')); return; }

        const steps = downscaleSteps(sw, sh, tw, th);
        let source = img;
        steps.forEach((step, i) => {
          const canvas = document.createElement('canvas');
          canvas.width = step.width;
          canvas.height = step.height;
          const ctx = canvas.getContext('2d');
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          // JPEG has no alpha: transparent pixels would encode as BLACK. Paint
          // the final canvas white first so a cut-out product on a transparent
          // PNG lands on white, the way a merchant expects.
          if (i === steps.length - 1) {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, step.width, step.height);
          }
          ctx.drawImage(source, 0, 0, step.width, step.height);
          source = canvas;
        });
        resolve(source.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

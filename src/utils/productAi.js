/**
 * AI Auto-fill — ask the Product Intelligence Engine to suggest a category,
 * a priced variant axis and descriptive attributes from a product name (+image).
 * Owner-side; the endpoint gates to paid plans. Never throws.
 */
export async function suggestProductDetails({ slug, name, image, categories }) {
  try {
    const r = await fetch('/api/product-ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, name, image, categories }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || data?.error) return { error: data?.error || `http_${r.status}` };
    return data;
  } catch {
    return { error: 'failed' };
  }
}

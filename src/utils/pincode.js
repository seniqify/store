// Client-side pincode → location lookup via /api/pincode. Caches per-pin.
const cache = new Map();

export async function lookupPincode(pin) {
  const p = String(pin).replace(/\D/g, '').slice(0, 6);
  if (p.length !== 6) return null;
  if (cache.has(p)) return cache.get(p);
  try {
    const r = await fetch(`/api/pincode?pin=${p}`);
    const data = r.ok ? await r.json() : null;
    cache.set(p, data);
    return data;
  } catch {
    return null;
  }
}

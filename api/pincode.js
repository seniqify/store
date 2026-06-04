// Resolve a 6-digit Indian pincode → { city, state, areas[] }.
// Backed by the free India Post pincode API; cached hard since pincodes are static.
export default async function handler(req, res) {
  try {
    const url = new URL(req.url, 'http://x');
    const pin = (url.searchParams.get('pin') || '').replace(/\D/g, '').slice(0, 6);
    if (pin.length !== 6) {
      res.status(400).json({ error: 'Enter a valid 6-digit pincode' });
      return;
    }

    const r = await fetch(`https://api.postalpincode.in/pincode/${pin}`);
    const data = await r.json();
    const entry = Array.isArray(data) ? data[0] : null;
    const offices = entry && entry.Status === 'Success' ? entry.PostOffice : null;

    if (!offices || !offices.length) {
      res.setHeader('Cache-Control', 's-maxage=3600');
      res.status(404).json({ error: 'Pincode not found' });
      return;
    }

    const state = offices[0].State || '';
    const city  = offices[0].District || '';
    const areas = [...new Set(offices.map((o) => o.Name).filter(Boolean))];

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 's-maxage=2592000, stale-while-revalidate=2592000'); // 30 days
    res.status(200).json({ pincode: pin, city, state, areas });
  } catch {
    res.status(502).json({ error: 'Lookup failed — please enter city & state manually' });
  }
}

// AI Auto-fill — PocketLink's Product Intelligence Engine.
//
// Given a product name (and optional image), returns a best-fit category, a
// priced variant axis (the attribute that changes price), and descriptive
// attributes — as GUARANTEED-valid JSON via a forced tool schema. Owner-side,
// gated to paid plans. Never invents prices, descriptions or marketing copy.
//
// Requires ANTHROPIC_API_KEY.
import Anthropic from '@anthropic-ai/sdk';

const SB   = 'https://uoyqbexemoheipwrtkcz.supabase.co';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVveXFiZXhlbW9oZWlwd3J0a2N6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2OTYzMTksImV4cCI6MjA5NTI3MjMxOX0.LWkT6EUVGuUIUE38XYGcfmn8DgAKMz3JC20bxuTCcx0';
const MODEL = 'claude-haiku-4-5';

async function loadStore(slug) {
  try {
    const r = await fetch(`${SB}/rest/v1/stores?slug=eq.${slug}&select=config&limit=1`, {
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
    });
    if (!r.ok) return null;
    return (await r.json())[0]?.config || null;
  } catch { return null; }
}

// Any active paid plan may use auto-fill (not lapsed free).
function isPaid(config) {
  const plan = config?.plan;
  if (!plan || plan === 'free') return false;
  const exp = config?.planExpiresAt;
  return exp ? new Date(exp).getTime() > Date.now() : true;
}

// Turn a data: URL or http(s) URL into an Anthropic image block. null if unusable.
function imageBlock(image) {
  try {
    const s = String(image || '');
    if (s.startsWith('data:image/')) {
      const m = s.match(/^data:(image\/[a-z+]+);base64,(.+)$/i);
      if (!m) return null;
      return { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } };
    }
    if (/^https?:\/\//i.test(s)) return { type: 'image', source: { type: 'url', url: s } };
    return null;
  } catch { return null; }
}

const TOOL = {
  name: 'suggest_product',
  description: 'Classify a retail product and propose its category, priced variant axis and descriptive attributes.',
  input_schema: {
    type: 'object',
    properties: {
      category:        { type: 'string', description: 'Single best-fit category. Prefer one from the allowed list.' },
      is_new_category: { type: 'boolean', description: 'true if "category" is NOT from the allowed list.' },
      confidence:      { type: 'number', description: '0-100 confidence in the classification.' },
      variant: {
        type: ['object', 'null'],
        description: 'The ONE attribute that changes price (Weight/Size/Quantity/Pack). null if the product has no price-varying option.',
        properties: {
          label:   { type: 'string' },
          options: { type: 'array', items: { type: 'string' } },
        },
      },
      attributes: {
        type: 'array',
        description: '2-5 other practical buyer-facing attributes (e.g. Egg Type, Flavour, Colour, Material). Select options only.',
        items: {
          type: 'object',
          properties: {
            key:     { type: 'string' },
            label:   { type: 'string' },
            options: { type: 'array', items: { type: 'string' } },
          },
          required: ['key', 'label', 'options'],
        },
      },
    },
    required: ['category', 'confidence', 'attributes'],
  },
};

function systemPrompt(categories) {
  const list = (categories || []).filter(Boolean);
  return [
    'You are PocketLink\'s Product Intelligence Engine for Indian small businesses.',
    'Given a product name (and image, if provided), classify it and propose structured fields a small shop can fill quickly.',
    list.length
      ? `Choose "category" from this allowed list when one fits: ${list.join(', ')}. If none fit reasonably, return a short new category name and set is_new_category=true.`
      : 'Return a short, sensible category name and set is_new_category=true.',
    'Put the SINGLE price-varying attribute (Weight, Size, Quantity, Pack) in "variant" with practical options; if there is none, set variant to null.',
    'Put all OTHER practical buyer-facing attributes in "attributes" (2-5 of them), each with a short list of select options.',
    'Keep everything practical and India-relevant. Use select options, never free text. NEVER invent prices, descriptions or marketing text.',
  ].join('\n');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) { res.status(503).json({ error: 'Auto-fill is not configured yet.' }); return; }

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const slug = String(body.slug || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 60);
    const name = String(body.name || '').trim().slice(0, 120);
    const categories = Array.isArray(body.categories) ? body.categories.map((c) => String(c).slice(0, 40)).slice(0, 40) : [];
    if (!slug || !name) { res.status(400).json({ error: 'Missing product name.' }); return; }

    const config = await loadStore(slug);
    if (!config)        { res.status(404).json({ error: 'Store not found.' }); return; }
    if (!isPaid(config)) { res.status(403).json({ error: 'AI Auto-fill is available on paid plans.' }); return; }

    const content = [{ type: 'text', text: `Product name: ${name}` }];
    const img = imageBlock(body.image);
    if (img) content.push(img);

    const anthropic = new Anthropic({ apiKey });
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 700,
      system: systemPrompt(categories),
      tools: [TOOL],
      tool_choice: { type: 'tool', name: 'suggest_product' },
      messages: [{ role: 'user', content }],
    });

    const block = (response.content || []).find((b) => b.type === 'tool_use');
    const out = block?.input;
    if (!out || !out.category) { res.status(200).json({ error: 'no_suggestion' }); return; }

    // Normalise to a predictable shape for the client.
    res.status(200).json({
      category:      String(out.category || '').slice(0, 40),
      isNewCategory: Boolean(out.is_new_category),
      confidence:    Math.max(0, Math.min(100, Number(out.confidence) || 0)),
      variant: out.variant && Array.isArray(out.variant.options) && out.variant.options.length
        ? { label: String(out.variant.label || '').slice(0, 30), options: out.variant.options.map((o) => String(o).slice(0, 30)).slice(0, 8) }
        : null,
      attributes: Array.isArray(out.attributes)
        ? out.attributes
            .filter((a) => a && a.label && Array.isArray(a.options) && a.options.length)
            .slice(0, 6)
            .map((a) => ({
              key:     String(a.key || a.label).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30),
              label:   String(a.label).slice(0, 30),
              options: a.options.map((o) => String(o).slice(0, 30)).slice(0, 10),
            }))
        : [],
    });
  } catch {
    res.status(200).json({ error: 'busy' });
  }
}

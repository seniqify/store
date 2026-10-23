// Snap the bill: read a shop bill or receipt photo for Hisaab's Add expense.
//
// The owner photographs a bill; this returns what to pre-fill - the total, the
// date, who it was paid to, and what it was for - and the owner checks it and
// saves. Nothing is saved here and the photo is not stored: it goes to the
// model once and is gone.
//
// Owner-only: the store PIN is checked first (verify_store_pin, throttled per
// IP and per store), then the plan. Requires ANTHROPIC_API_KEY.
import Anthropic from '@anthropic-ai/sdk';
import { SB, ANON } from './meta/_meta.js';
import { cleanSlug, cleanHashedPin, clientIp, verifyOwnerPin } from './domains/_auth.js';

const MODEL = 'claude-opus-5-5';
const CATEGORIES = ['transport', 'packing', 'rent', 'salary', 'ads', 'raw_material', 'other'];
const MAX_IMAGE_CHARS = 6_000_000;   // a data URL; the app sends ~300 KB

async function loadStore(slug) {
  try {
    const r = await fetch(`${SB}/rest/v1/stores?slug=eq.${slug}&select=config&limit=1`, {
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
    });
    if (!r.ok) return null;
    return (await r.json())[0]?.config || null;
  } catch { return null; }
}

// Any active paid plan, as for AI Auto-fill.
function isPaid(config) {
  const plan = config?.plan;
  if (!plan || plan === 'free') return false;
  const exp = config?.planExpiresAt;
  return exp ? new Date(exp).getTime() > Date.now() : true;
}

function imageBlock(image) {
  const m = String(image || '').match(/^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/);
  return m ? { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } } : null;
}

// The shape the model must answer in. No nulls: 0 / '' mean "could not read".
const SCHEMA = {
  type: 'object',
  properties: {
    readable: { type: 'boolean', description: 'false if this is not a bill or receipt, or the total cannot be read' },
    amount:   { type: 'number', description: 'The grand total paid, in rupees. 0 if it cannot be read.' },
    date:     { type: 'string', description: 'The bill date as YYYY-MM-DD, or "" if there is none.' },
    vendor:   { type: 'string', description: 'Who was paid: the shop or company name on the bill, short. "" if none.' },
    category: { type: 'string', enum: CATEGORIES, description: 'What the money was spent on.' },
  },
  required: ['readable', 'amount', 'date', 'vendor', 'category'],
  additionalProperties: false,
};

const SYSTEM = [
  'You read bills and receipts for small Indian shops so the owner can record an expense.',
  'Return the grand total actually paid (after tax and discounts), in rupees, the bill date, and the name of whoever was paid.',
  'Dates on Indian bills are day first: 05/10/26 is 5 October 2026.',
  'category: transport (courier, tempo, fuel, travel), packing (boxes, tape, bags, labels), rent, salary (wages, staff),',
  'ads (Instagram, Facebook, Google, printing of pamphlets), raw_material (stock, ingredients, material to make products), other.',
  'If the photo is not a bill or the total is unreadable, set readable to false.',
].join('\n');

function todayIst() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'method' }); return; }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const slug = cleanSlug(body.slug);
    const hashedPin = cleanHashedPin(body.hashedPin);
    const image = String(body.image || '');
    if (!slug || !hashedPin || !image || image.length > MAX_IMAGE_CHARS) { res.status(400).json({ error: 'bad_request' }); return; }
    const img = imageBlock(image);
    if (!img) { res.status(400).json({ error: 'bad_image' }); return; }

    if (!(await verifyOwnerPin({ supabaseUrl: SB }, slug, hashedPin, clientIp(req)))) {
      res.status(403).json({ error: 'pin' });
      return;
    }
    const config = await loadStore(slug);
    if (!config) { res.status(404).json({ error: 'store' }); return; }
    if (!isPaid(config)) { res.status(403).json({ error: 'plan' }); return; }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) { res.status(503).json({ error: 'not_configured' }); return; }

    const anthropic = new Anthropic({ apiKey });
    const response = await anthropic.beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: [img, { type: 'text', text: `Read this bill. Today is ${todayIst()}.` }] }],
    });
    if (response.stop_reason === 'refusal') { res.status(200).json({ error: 'unreadable' }); return; }

    const text = (response.content || []).find((b) => b.type === 'text')?.text;
    let out;
    try { out = JSON.parse(text || ''); } catch { out = null; }
    if (!out || out.readable !== true) { res.status(200).json({ error: 'unreadable' }); return; }

    const amount = Number(out.amount);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(out.date)) && out.date >= '2020-01-01' && out.date <= todayIst() ? out.date : null;
    res.status(200).json({
      amount: Number.isFinite(amount) && amount > 0 && amount <= 10000000 ? Math.round(amount * 100) / 100 : null,
      date,
      vendor: String(out.vendor || '').trim().slice(0, 60) || null,
      category: CATEGORIES.includes(out.category) ? out.category : 'other',
    });
  } catch {
    res.status(200).json({ error: 'busy' });
  }
}

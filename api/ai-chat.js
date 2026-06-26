// AI Business Assistant — answers a store's customers from its own catalogue.
//
// Premium-only feature: one grounded Q&A call to Claude per customer question.
// The store's products/hours/policies are loaded server-side and pinned into the
// system prompt so the model can only answer from real data. No tools, no agent.
//
// Requires the ANTHROPIC_API_KEY environment variable to be set in Vercel.
import Anthropic from '@anthropic-ai/sdk';

const SB   = 'https://uoyqbexemoheipwrtkcz.supabase.co';
const ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVveXFiZXhlbW9oZWlwd3J0a2N6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2OTYzMTksImV4cCI6MjA5NTI3MjMxOX0.LWkT6EUVGuUIUE38XYGcfmn8DgAKMz3JC20bxuTCcx0';

// Customer-facing store assistant. Haiku 4.5 — fast and ~5× cheaper than Opus,
// and plenty capable for grounded catalogue Q&A. Swap to 'claude-opus-4-8' if
// you ever want maximum answer quality at higher cost.
const MODEL = 'claude-haiku-4-5';

async function loadStore(slug) {
  try {
    const r = await fetch(`${SB}/rest/v1/stores?slug=eq.${slug}&select=config&limit=1`, {
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
    });
    if (!r.ok) return null;
    const rows = await r.json();
    return rows[0]?.config || null;
  } catch {
    return null;
  }
}

// A store is entitled to the AI assistant only on an active Premium plan.
function aiEnabled(config) {
  if (config?.plan !== 'premium') return false;
  const exp = config?.planExpiresAt;
  return exp ? new Date(exp).getTime() > Date.now() : false;
}

function priceLabel(p) {
  if (Array.isArray(p.variants) && p.variants.length) {
    const parts = p.variants
      .filter((v) => v && (v.price != null))
      .map((v) => `${v.label || v.name || 'option'} ₹${v.price}`);
    if (parts.length) return parts.join(', ');
  }
  if (p.price != null) return `₹${p.price}${p.unit ? `/${p.unit}` : ''}`;
  return 'price on request';
}

function buildSystem(config) {
  const name = config.businessName || 'this shop';
  const L = [];
  L.push(`You are the friendly virtual assistant for "${name}", a shop that takes orders over WhatsApp.`);
  if (config.tagline)     L.push(`Tagline: ${config.tagline}`);
  if (config.description) L.push(`About the shop: ${config.description}`);

  // Optional operational details, only if the owner filled them in.
  for (const f of config.features || []) {
    if (f?.title) L.push(`• ${f.title}${f.desc ? `: ${f.desc}` : ''}`);
  }
  if (config.cart?.freeShippingAbove) L.push(`Free delivery on orders above ₹${config.cart.freeShippingAbove}.`);

  const products = (config.products || []).slice(0, 200).map((p) => {
    const cat   = p.category ? ` [${p.category}]` : '';
    const stock = p.inStock === false ? ' (OUT OF STOCK)' : '';
    const desc  = p.description ? ` — ${String(p.description).slice(0, 160)}` : '';
    return `- ${p.name}${cat}: ${priceLabel(p)}${stock}${desc}`;
  });

  L.push(`\nCATALOGUE (${products.length} item${products.length === 1 ? '' : 's'}):`);
  L.push(products.length ? products.join('\n') : '(no products listed yet)');

  L.push(`\nHOW TO HELP:
- Answer ONLY from the information above. If something isn't listed (a price, an item, delivery area, timing, custom requests), say you're not sure and invite them to tap "Order on WhatsApp" to ask the shop directly.
- Never invent products, prices, discounts, stock or delivery promises.
- Be warm and brief — 1 to 3 sentences. Use ₹ for prices and at most one emoji.
- When the customer is ready to buy, encourage them to add items to the cart or tap "Order on WhatsApp".
- Reply in the customer's language — English, Hindi and Hinglish are all common.`);

  return L.join('\n');
}

// ── AI Insights capture ──────────────────────────────────────────────────────
// Classify the customer's intent from the question (cheap heuristics; refined by
// the insights LLM pass later). Stored per search so the dashboard stays fast.
function classifyIntent(q, config) {
  const s = String(q || '').toLowerCase();
  if (/(under|below|less than|cheaper|cheap|budget|affordable|₹|rs\.?\s*\d|price|cost|expensive)/.test(s)) return 'budget';
  if (/(deliver|delivery|shipping|courier|charge|cod|cash on|how long|when will)/.test(s)) return 'delivery';
  if (/(do you have|in stock|available|stock|sell|carry|got any)/.test(s)) return 'availability';
  const cats = [...new Set((config.products || []).map((p) => String(p.category || '').toLowerCase()).filter(Boolean))];
  if (cats.some((c) => c && s.includes(c))) return 'category';
  return 'feature';
}

// Does the question map to something we actually stock? false ⇒ a "missed
// opportunity" (customer wanted something not in the catalogue).
function productMatched(q, config) {
  const s = String(q || '').toLowerCase();
  const tokens = new Set(s.split(/\W+/).filter((w) => w.length >= 3));
  for (const p of config.products || []) {
    const name = String(p.name || '').toLowerCase();
    if (name && (s.includes(name) || name.split(/\W+/).some((w) => w.length >= 3 && tokens.has(w)))) return true;
    if (p.category && s.includes(String(p.category).toLowerCase())) return true;
  }
  return false;
}

// Best-effort: record a search for the AI Insights dashboard. Never throws.
async function logSearch(row) {
  try {
    await fetch(`${SB}/rest/v1/ai_searches`, {
      method: 'POST',
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(row),
    });
  } catch { /* logging must never affect the customer's answer */ }
}

// Keep only clean, alternating-ish text turns, capped, starting from a user turn.
function sanitize(messages) {
  const out = [];
  for (const m of messages.slice(-12)) {
    const role = m?.role === 'assistant' ? 'assistant' : 'user';
    const content = String(m?.content || '').trim().slice(0, 1000);
    if (content) out.push({ role, content });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      res.status(503).json({ error: 'The assistant is not configured yet.' });
      return;
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const slug = String(body.slug || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 60);
    const messages = sanitize(Array.isArray(body.messages) ? body.messages : []);

    if (!slug || messages.length === 0) {
      res.status(400).json({ error: 'Missing question.' });
      return;
    }

    const config = await loadStore(slug);
    if (!config)          { res.status(404).json({ error: 'Store not found.' }); return; }
    if (!aiEnabled(config)) { res.status(403).json({ error: 'The assistant is not enabled for this store.' }); return; }

    const anthropic = new Anthropic({ apiKey });
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 600,
      system: buildSystem(config),
      messages,
    });

    const reply = (response.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();

    // ── AI Insights: log this search (best-effort, before responding) ──
    const question = [...messages].reverse().find((m) => m.role === 'user')?.content || '';
    if (question) {
      const unsure = /\b(not sure|don.?t have|isn.?t listed|can.?t find|couldn.?t|unable|not available|don.?t carry|no info)\b/i.test(reply);
      await logSearch({
        store_slug: slug,
        question:   question.slice(0, 300),
        reply:      reply.slice(0, 600),
        answered:   reply.length > 0 && !unsure,
        matched:    productMatched(question, config),
        intent:     classifyIntent(question, config),
      });
    }

    res.status(200).json({
      reply: reply || "Sorry, I couldn't answer that — please tap “Order on WhatsApp” to ask the shop.",
    });
  } catch (err) {
    // Never surface internals; the widget shows a graceful fallback.
    res.status(200).json({ error: 'busy', reply: '' });
  }
}

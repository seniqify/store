// AI Insights — turns a store's AI-search summary into actionable advice.
//
// Premium-only. The dashboard computes the aggregates client-side (from the
// owner's own PIN-gated data) and POSTs a compact summary here; this endpoint
// asks Claude for a short list of concrete, sales-focused recommendations.
//
// Requires ANTHROPIC_API_KEY (same key as /api/ai-chat).
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

function aiEnabled(config) {
  if (config?.plan !== 'premium') return false;
  const exp = config?.planExpiresAt;
  return exp ? new Date(exp).getTime() > Date.now() : false;
}

function fmtList(arr, render) {
  return (arr || []).slice(0, 12).map(render).filter(Boolean).join('\n') || '(none)';
}

function buildPrompt(config, s) {
  const name = config.businessName || 'this shop';
  const productCount = (config.products || []).length;
  const L = [];
  L.push(`You are a sharp retail growth analyst helping the owner of "${name}", a small Indian business that sells over WhatsApp (currently ${productCount} products listed).`);
  L.push(`Below is a summary of what customers asked the shop's AI assistant in the ${s.period || 'recent period'} — ${s.total || 0} searches in total.`);
  L.push('');
  L.push(`MOST SEARCHED:\n${fmtList(s.topSearches, (x) => `- "${x.term}" ×${x.count}`)}`);
  L.push('');
  L.push(`SEARCHED BUT NOT IN CATALOGUE (missed sales):\n${fmtList(s.notFound, (x) => `- "${x.term}" ×${x.count}`)}`);
  L.push('');
  L.push(`COMMON QUESTIONS THE AI COULD NOT ANSWER:\n${fmtList(s.unanswered, (x) => `- "${x}"`)}`);
  L.push('');
  L.push(`CUSTOMER INTENT MIX:\n${fmtList(s.intents, (x) => `- ${x.label}: ${x.count}`)}`);
  L.push('');
  L.push(`Give 3 to 6 specific, actionable recommendations to help this owner sell more. Rules:
- Each recommendation is ONE short sentence, concrete, and references the real numbers above (e.g. "Customers searched 'Creatine' 18 times but you don't sell it — consider adding it.").
- Prioritise: products to add (things searched but not stocked), pricing gaps (lots of budget searches), and info to add to the store (e.g. delivery charges if asked often).
- Plain, friendly language a shopkeeper understands. No jargon. Use ₹ for money.
- Searches may be in English, Hindi, Marathi or Hinglish — write the advice in simple English, but keep the customer's original search words in quotes.
- Return ONLY a JSON array of strings, nothing else. Example: ["...", "..."]`);
  return L.join('\n');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) { res.status(503).json({ error: 'Insights are not configured yet.' }); return; }

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const slug = String(body.slug || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 60);
    const summary = body.summary || {};
    if (!slug) { res.status(400).json({ error: 'Missing store.' }); return; }
    if (!(summary.total > 0)) { res.status(200).json({ recommendations: [] }); return; }

    const config = await loadStore(slug);
    if (!config)            { res.status(404).json({ error: 'Store not found.' }); return; }
    if (!aiEnabled(config)) { res.status(403).json({ error: 'AI Insights is a Premium feature.' }); return; }

    const anthropic = new Anthropic({ apiKey });
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 600,
      system: 'You are a concise retail growth analyst. You only ever reply with a JSON array of short recommendation strings.',
      messages: [{ role: 'user', content: buildPrompt(config, summary) }],
    });

    const text = (response.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    let recommendations = [];
    try {
      const match = text.match(/\[[\s\S]*\]/);
      recommendations = JSON.parse(match ? match[0] : text);
    } catch {
      recommendations = text.split('\n').map((l) => l.replace(/^[-*\d.\s]+/, '').trim()).filter(Boolean);
    }
    if (!Array.isArray(recommendations)) recommendations = [];

    res.status(200).json({ recommendations: recommendations.slice(0, 6) });
  } catch {
    res.status(200).json({ error: 'busy', recommendations: [] });
  }
}

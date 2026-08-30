import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ── PocketLink Console assistant ──────────────────────────────────────────────
// Founder-only ops copilot. Verifies the caller is a crm_team admin, then asks
// Claude to answer questions about the stores and PROPOSE (never execute) any
// change. Writes are applied by the client via the admin-gated
// console_update_store RPC only after the founder approves — the model never
// touches the database. Needs the ANTHROPIC_API_KEY secret to be set.

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

const SYSTEM = `You are the PocketLink Console assistant — a careful operations copilot for the founder of PocketLink, a WhatsApp storefront SaaS. You help manage stores, plans, renewals and cash billing.

You are given a JSON snapshot of every store. Answer the founder's question concisely and specifically, using ONLY that data. Never invent stores, numbers, dates or facts. Plan keys: "free" = Free, "business" = Growth, "premium" = Pro.

If the founder asks you to CHANGE something (set/renew a plan, log a cash payment, switch a store's light/dark theme), do NOT say you did it — you cannot. Propose it as a structured action the founder will approve with one tap.

Reply with ONE JSON object and nothing else:
{"reply": "<concise answer, or what you're proposing>", "action": <null OR an action object>}

Action shapes (use these exactly; slug must exist in the data):
- Set or renew a plan: {"type":"set_plan","slug":"<slug>","plan":"free|business|premium","term":"1y|1m|none","amount":<number or null>,"method":"cash|upi|bank|other|null","summary":"<one line>"}
- Switch storefront theme: {"type":"set_theme","slug":"<slug>","mode":"light|dark","summary":"<one line>"}

Only propose an action the founder clearly asked for; otherwise action is null. Keep reply under 90 words. Output ONLY the JSON object.`;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    // ── founder gate ──
    const token = (req.headers.get('Authorization') || '').replace('Bearer ', '').trim();
    if (!token) return json({ error: 'unauthorized' }, 401);

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData?.user) return json({ error: 'unauthorized' }, 401);

    const { data: teamRow } = await admin
      .from('crm_team').select('role').eq('user_id', userData.user.id).maybeSingle();
    if (!teamRow || teamRow.role !== 'admin') return json({ error: 'not_founder' }, 403);

    // ── config check ──
    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) {
      return json({ error: 'not_configured',
        message: 'Add the ANTHROPIC_API_KEY secret in Supabase to activate the assistant.' });
    }

    const { question, context } = await req.json();
    if (!question || !String(question).trim()) return json({ reply: 'Ask me anything about your stores.', action: null });

    const stores = Array.isArray(context?.stores) ? context.stores.slice(0, 300) : [];
    const userMsg = `STORES (JSON):\n${JSON.stringify(stores)}\n\nFOUNDER'S QUESTION:\n${String(question).slice(0, 2000)}`;

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: Deno.env.get('ASSISTANT_MODEL') || 'claude-sonnet-5',
        max_tokens: 1024,
        system: SYSTEM,
        messages: [{ role: 'user', content: userMsg }],
      }),
    });
    if (!resp.ok) {
      const t = await resp.text();
      return json({ error: 'llm_error', message: t.slice(0, 400) });
    }
    const data = await resp.json();
    // claude-sonnet-5 can prepend a "thinking" block, so take the text block —
    // not content[0], which may be the thinking (it has no .text) → empty reply.
    const text = ((data?.content || []).find((c: { type?: string }) => c.type === 'text') as { text?: string } | undefined)?.text?.trim() || '';

    // Tolerant parse — the model should return {reply, action}, but fall back to
    // the raw text as the reply if it doesn't.
    let out: { reply: string; action: unknown } = { reply: text, action: null };
    const m = text.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        const p = JSON.parse(m[0]);
        out = { reply: typeof p.reply === 'string' ? p.reply : text, action: p.action ?? null };
      } catch { /* keep raw text as reply */ }
    }
    return json(out);
  } catch (e) {
    return json({ error: 'server', message: String((e as Error)?.message || e) });
  }
});

// Recommendation engine — Stage 2E-1. The "brain" that turns a seller's few
// BUSINESS decisions into the technical Meta configuration + a plain-language plan
// with a reason for every choice. Runs server-side, deterministic given its inputs
// (one read-only RPC for the best-seller), so a preview equals the launch. It makes
// NO Meta writes and never spends — it only decides what to build; the shared
// _campaignBuild turns `input` into the actual (PAUSED) payloads.
import { SB, ANON } from './_meta.js';

// Business goal → technical objective (+ seller-facing copy). No Meta terms leak to
// Simple mode. `retarget` waits for 2E-3 (needs a website Custom Audience), so it's
// defined but not yet available.
export const GOALS = {
  orders:   { key: 'orders',   title: 'Get more orders',              blurb: 'Reach people likely to buy',        objective: 'sales',     available: true },
  visitors: { key: 'visitors', title: 'Get more store visitors',      blurb: 'Send more people to your store',     objective: 'traffic',   available: true },
  retarget: { key: 'retarget', title: 'Bring back interested people', blurb: 'Re-reach recent visitors',           objective: 'sales',     available: false, soon: 'Coming soon — switches on once your store has enough visitors to re-reach.' },
  promote:  { key: 'promote',  title: 'Promote my business',          blurb: 'Get seen by more people nearby',     objective: 'awareness', available: true },
};

const RECO_DAILY = { orders: 300, traffic: 200, sales: 300, visitors: 200, awareness: 150 };
const norm = (s) => String(s || '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
const inStock = (p) => p == null || p.stock === undefined || p.stock === '' || Number(p.stock) > 0;

// Read-only: best-selling product NAME via the existing SECURITY-DEFINER RPC (safe,
// counts only). Null when there are no sales yet.
async function bestSellerName(slug) {
  try {
    const r = await fetch(`${SB}/rest/v1/rpc/get_product_sales`, {
      method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_slug: slug }),
    });
    if (!r.ok) return null;
    const rows = await r.json().catch(() => []);
    if (!Array.isArray(rows) || !rows.length) return null;
    rows.sort((a, b) => (Number(b.sold) || 0) - (Number(a.sold) || 0));
    return (Number(rows[0]?.sold) || 0) > 0 ? rows[0].name : null;
  } catch { return null; }
}

// Pick the product to advertise for "Recommended": best-seller → an in-stock priced
// product → any in-stock → first. (Margin-ranking comes in 2E-5 with real data.)
function pickRecommendedProduct(cfg, bestName) {
  const products = Array.isArray(cfg.products) ? cfg.products : [];
  if (!products.length) return null;
  if (bestName) {
    const hit = products.find((p) => p.name === bestName) || products.find((p) => norm(p.name) === norm(bestName));
    if (hit) return { product: hit, basis: 'bestseller' };
  }
  const priced = products.filter(inStock).filter((p) => Number(p.price) > 0);
  if (priced.length) return { product: priced[0], basis: 'available' };
  return { product: products.find(inStock) || products[0], basis: 'firstproduct' };
}

// recommend — the single decision point. Returns { input, recommendation, resolved }.
// `input`/`resolved` are the technical config for _campaignBuild (identical); the
// client sends `resolved` back verbatim at launch so preview == launch exactly.
export async function recommend({ slug, cfg, biz }) {
  const g = GOALS[String(biz.goal || 'orders')] || GOALS.orders;
  const city = String(cfg.city || '').trim();

  // What to promote.
  let promote = 'store', product = null, basis = 'store';
  if (biz.promote === 'product' && biz.productId) {
    promote = 'product';
    product = (cfg.products || []).find((p) => String(p.id) === String(biz.productId)) || null;
    basis = 'chosen';
  } else if (biz.promote === 'store') {
    promote = 'store';
  } else {
    const pick = pickRecommendedProduct(cfg, await bestSellerName(slug));
    if (pick?.product) { promote = 'product'; product = pick.product; basis = pick.basis; }
  }

  // Audience: default is Advantage+ ("let PocketLink find buyers").
  const audienceStrategy = biz.audienceMode === 'manual' ? 'manual' : 'auto';

  // Budget.
  const recoDaily = RECO_DAILY[g.objective] || 250;
  const budgetMode = (biz.budgetMode === 'custom' || biz.budgetMode === 'preset') ? biz.budgetMode : 'recommended';
  const dailyBudget = budgetMode === 'recommended' ? recoDaily : Math.max(1, Math.floor(Number(biz.dailyBudget) || recoDaily));
  const days = Math.max(1, Math.floor(Number(biz.days) || 7));

  // Technical config for the shared builder.
  const input = {
    objective: g.objective, promote, productId: product?.id ?? '',
    dailyBudget, days, audienceStrategy,
    radiusKm: biz.radiusKm ?? 25, ageMin: biz.ageMin ?? 18, ageMax: biz.ageMax ?? 65, gender: biz.gender ?? 'all',
  };

  // Seller-facing plan + reasons (honest — no performance claims).
  const promoting = promote === 'product'
    ? { type: 'product', name: product?.name || 'your product', id: product?.id ?? '' }
    : { type: 'store', name: cfg.businessName || 'your whole store' };
  const outcomeWord = g.objective === 'sales' ? 'orders' : g.objective === 'traffic' ? 'visits' : 'reach';

  const reasons = {
    goal: `You chose “${g.title}”, so PocketLink set Meta to ${g.objective === 'sales' ? 'find people most likely to order' : g.objective === 'traffic' ? 'send more visitors to your store' : 'show your business to more people nearby'}.`,
    promoting: promote === 'product'
      ? (basis === 'bestseller' ? `${promoting.name} is your best-seller — the strongest thing to advertise right now.`
        : basis === 'chosen' ? `You picked ${promoting.name}.` : `${promoting.name} is a good product to start with.`)
      : 'Advertising your whole store shows the range of what you offer.',
    audience: audienceStrategy === 'auto'
      ? `Rather than guessing interests, PocketLink lets Meta’s AI find the right people${city ? ` around ${city}` : ''}, guided by your store’s real activity. You still control area, age and gender.`
      : 'You’re targeting a specific audience you set.',
    optimization: g.objective === 'sales'
      ? 'Set to optimise for orders using your live sales signal, so budget goes to people likely to buy.'
      : g.objective === 'traffic' ? 'Set to bring visitors to your store at the lowest cost per visit.'
      : 'Set to reach as many nearby people as possible.',
    creative: `The ad is built from your ${promote === 'product' ? 'product photo and details' : 'store'} with a clear “Order on WhatsApp” button.`,
    budget: budgetMode === 'recommended'
      ? `₹${dailyBudget}/day is a sensible starting budget for this goal — enough for Meta to learn without overspending. Change it anytime.`
      : `You set ₹${dailyBudget}/day.`,
  };

  const overall = `You want to “${g.title.toLowerCase()}”. PocketLink is ${promote === 'product' ? `promoting ${promoting.name}` : 'promoting your store'}${city ? ` near ${city}` : ''}, letting Meta’s AI find the right people, and optimising for ${outcomeWord} — on a ₹${dailyBudget}/day budget you control. Nothing runs until you review it here, and nothing spends until it’s activated.`;

  return {
    input,
    resolved: input,
    recommendation: {
      goal: { key: g.key, title: g.title, objective: g.objective },
      promoting, audienceStrategy,
      budget: { daily: dailyBudget, days, mode: budgetMode },
      reasons, overall,
    },
  };
}

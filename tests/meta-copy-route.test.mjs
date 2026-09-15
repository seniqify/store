// The 'ad-copy' and preview actions end to end: Supabase, Graph and the Claude API
// are faked at globalThis.fetch. No network, no model call, no Meta write.
import test from 'node:test';
import assert from 'node:assert/strict';
import previewHandler from '../api/meta/campaign-preview.js';

const realFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = realFetch; delete process.env.ANTHROPIC_API_KEY; });

const CONFIG = {
  businessName: 'Royal Foods', city: 'Solapur', state: 'Maharashtra', tagline: 'Authentic masala', plan: 'growth',
  meta: { connected: true, pageId: '111222333', pageName: 'Royal Foods & Masale' },
  products: [{ id: 'p1', name: 'Bajar Amti 90 g Per Packet', price: '270', unit: '90g', image: 'https://cdn.example/amti.jpg', images: ['https://cdn.example/amti-back.jpg'], variants: { options: [{ name: '3 x Packet', price: 270, mrp: 330 }] } }],
};
const ACCT = { store_slug: 'royalfoodsmasale', status: 'connected', access_token: 'STORE-TOKEN', ad_account_ids: ['act_1896623077683652'], selected_ad_account_id: 'act_1896623077683652', scopes: ['ads_read'] };

function world({ config = CONFIG, modelReply = null } = {}) {
  const log = { anthropic: [] };
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
    if (u.includes('api.anthropic.com')) {
      const headers = init.headers instanceof Headers ? Object.fromEntries(init.headers.entries()) : { ...(init.headers || {}) };
      log.anthropic.push({ url: u, headers, body: JSON.parse(init.body) });
      return json(modelReply);
    }
    if (u.includes('/rpc/verify_store_pin')) return json(true);
    if (u.includes('/rest/v1/store_meta_accounts')) return json([ACCT]);
    if (u.includes('/rest/v1/stores')) return json([{ config }]);
    if (u.includes('/rpc/get_product_sales')) return json([]);
    if (u.includes('/search?')) return json({ data: [{ key: '1010461', name: 'Solapur', region: 'Maharashtra' }] });
    if (u.includes('111222333')) return json({ id: '111222333', name: 'Royal Foods & Masale' });
    if (u.includes('act_')) return json({ currency: 'INR', name: 'Royal Foods', min_daily_budget: 9615, account_status: 1, timezone_name: 'Asia/Kolkata' });
    return json({ data: [] });
  };
  return log;
}

async function post(body) {
  const r = { statusCode: 200, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  await previewHandler({ method: 'POST', body: { slug: 'royalfoodsmasale', hashedPin: 'h', ...body } }, r);
  return r;
}

const MODEL_REPLY = {
  id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5', stop_reason: 'end_turn',
  content: [{ type: 'text', text: JSON.stringify({
    variants: [
      { headline: 'Real Solapur Bajar Amti', primaryText: 'Pack of 3 for ₹270, ground in small batches.', description: 'Save 18% today', cta: 'SHOP_NOW', angle: 'Value' },
      { headline: 'Now only ₹99', primaryText: 'A price the store never set.', description: '', cta: 'SHOP_NOW', angle: 'Wrong' },
    ],
    audience: { ageMin: 25, ageMax: 60, gender: 'all', why: 'Home cooks buy masalas.' },
    notes: '',
  }) }],
  usage: { input_tokens: 10, output_tokens: 10 },
};

test('ad-copy calls Claude Opus 5 with structured output and a refusal fallback, and screens the reply', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  const log = world({ modelReply: MODEL_REPLY });
  const r = await post({ action: 'ad-copy', productId: 'p1' });
  assert.equal(r.body.error, undefined, JSON.stringify(r.body));
  assert.equal(r.body.variants.length, 1, 'the invented-price variant was dropped');
  assert.equal(r.body.variants[0].headline, 'Real Solapur Bajar Amti');
  const call = log.anthropic[0];
  assert.equal(call.body.model, 'claude-opus-5');
  assert.equal(call.body.output_config.format.type, 'json_schema');
  assert.deepEqual(call.body.fallbacks, [{ model: 'claude-opus-4-8' }]);
  assert.match(call.headers['anthropic-beta'] || '', /server-side-fallback-2026-06-01/);
});

test('ad-copy needs a paid plan and a real product, and never needs Meta', async () => {
  process.env.ANTHROPIC_API_KEY = 'test-key';
  let log = world({ config: { ...CONFIG, plan: 'free' }, modelReply: MODEL_REPLY });
  assert.equal((await post({ action: 'ad-copy', productId: 'p1' })).body.error, 'paid_plan_required');
  assert.equal(log.anthropic.length, 0);
  log = world({ modelReply: MODEL_REPLY });
  assert.equal((await post({ action: 'ad-copy', productId: 'nope' })).body.error, 'no_product');
  assert.equal(log.anthropic.length, 0);
});

test('ad-copy without an API key says so instead of failing', async () => {
  world({ modelReply: MODEL_REPLY });
  assert.equal((await post({ action: 'ad-copy', productId: 'p1' })).body.error, 'copy_not_configured');
});

test('preview echoes the screened words, the accepted photo and the budget type for the launch', async () => {
  world();
  const r = await post({
    goal: 'visitors', promote: 'product', productId: 'p1', budgetMode: 'custom', dailyBudget: 200, days: 7, budgetType: 'daily',
    copy: { headline: 'Real Solapur Bajar Amti https://spam.example', primaryText: 'Pack of 3 for ₹270, ground in small batches.', description: 'Save 18% today', cta: 'ORDER_NOW' },
    imageUrl: 'https://cdn.example/amti-back.jpg',
  });
  assert.equal(r.body.error, undefined, JSON.stringify(r.body));
  assert.equal(r.body.resolved.budgetType, 'daily');
  assert.equal(r.body.resolved.copy.headline, 'Real Solapur Bajar Amti', 'the link was screened out');
  assert.equal(r.body.resolved.copy.cta, 'ORDER_NOW');
  assert.equal(r.body.resolved.imageUrl, 'https://cdn.example/amti-back.jpg');
  assert.equal(r.body.payloads.adcreative.body.object_story_spec.link_data.picture, 'https://cdn.example/amti-back.jpg');
});

test('preview never echoes a photo that is not the store\'s', async () => {
  world();
  const r = await post({ goal: 'visitors', promote: 'product', productId: 'p1', imageUrl: 'https://evil.example/x.jpg' });
  assert.equal(r.body.resolved.imageUrl, null);
  assert.equal(r.body.resolved.copy, null);
});

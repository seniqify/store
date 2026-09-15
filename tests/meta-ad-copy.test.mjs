// AI ad copy: the request shape, and the screening that every suggestion and
// every merchant edit goes through. The model is a fake client — no API call.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COPY_MODEL, COPY_SCHEMA, LIMITS, CTA_ALLOWED, copyFacts, pricesAreTrue, claimsAreTrue, cleanCopy, cleanAudience,
  buildCopyRequest, generateAdCopy,
} from '../api/meta/_adCopy.js';

const CFG = { businessName: 'Royal Foods & Spices', city: 'Solapur', tagline: 'Home-style masalas', cart: {} };
const PRODUCT = { id: 'p1', name: 'Bajar Amti 90 g Per Packet', price: '270', unit: '90g', description: 'Traditional Solapur blend', variants: { options: [{ name: '3 x Packet', price: 270, mrp: 330 }, { name: '6 x Packet', price: 510 }] } };
const FACTS = copyFacts(CFG, PRODUCT, { packLabel: 'Pack of 3 × 90 g' });

// ── facts ────────────────────────────────────────────────────────────────────
test('facts carry the store\'s real prices and the discount they imply', () => {
  assert.deepEqual(FACTS.allowedPrices.sort((a, b) => a - b), [270, 330, 510]);
  assert.equal(FACTS.discountPercent, 18);
  assert.equal(FACTS.product.pack, 'Pack of 3 × 90 g');
  assert.equal(FACTS.freeDelivery, false);
  const noMrp = copyFacts(CFG, { name: 'Chai', price: 120 });
  assert.deepEqual([noMrp.product.mrp, noMrp.discountPercent], [null, null]);
});

// ── screening ────────────────────────────────────────────────────────────────
test('prices must be the store\'s own', () => {
  assert.equal(pricesAreTrue('Only ₹270 for a pack of 3', FACTS.allowedPrices), true);
  assert.equal(pricesAreTrue('Now Rs. 199!', FACTS.allowedPrices), false);
  assert.equal(pricesAreTrue('INR 1,510 value', FACTS.allowedPrices), false);
  assert.equal(pricesAreTrue('Fresh every week', FACTS.allowedPrices), true);
});

test('discount and delivery claims need backing in the store data', () => {
  assert.equal(claimsAreTrue('Save 18% today', FACTS), true);
  assert.equal(claimsAreTrue('Save 50% today', FACTS), false);
  assert.equal(claimsAreTrue('Big sale on masalas', { discountPercent: null }), false);
  assert.equal(claimsAreTrue('Free home delivery in Solapur', FACTS), false);
  assert.equal(claimsAreTrue('Free home delivery in Solapur', { ...FACTS, freeDelivery: true }), true);
});

test('copy is trimmed to Meta-friendly lengths and stripped of links, phones and hashtags', () => {
  const c = cleanCopy({
    headline: 'Authentic Solapur Bajar Amti, freshly ground for your kitchen',
    primaryText: 'Order at www.royalfoods.in or call 9876543210 #masala Taste the real Solapur flavour in every meal you cook at home with our family recipe.',
    description: 'Pack of 3 packets, ground fresh',
    cta: 'ORDER_NOW', angle: 'Authentic taste',
  }, FACTS);
  assert.ok(c.headline.length <= LIMITS.headline, c.headline);
  assert.ok(c.primaryText.length <= LIMITS.primaryText, c.primaryText);
  assert.ok(c.description.length <= LIMITS.description, c.description);
  assert.equal(/www\.|9876543210|#masala/.test(`${c.headline} ${c.primaryText}`), false);
  assert.equal(c.cta, 'ORDER_NOW');
  assert.equal(/\s$/.test(c.headline), false, 'cut at a word boundary');
});

test('an unknown button, or empty words, are not accepted', () => {
  assert.equal(cleanCopy({ headline: 'Fresh masala', primaryText: 'Ground every week in Solapur.', description: '', cta: 'CALL_NOW' }, FACTS).cta, 'SHOP_NOW');
  assert.equal(cleanCopy({ headline: '', primaryText: 'Ground every week in Solapur.' }, FACTS), null);
  assert.equal(cleanCopy({ headline: 'Fresh', primaryText: 'Hi' }, FACTS), null);
  assert.equal(cleanCopy(null, FACTS), null);
  assert.deepEqual([...CTA_ALLOWED], ['SHOP_NOW', 'ORDER_NOW', 'BUY_NOW', 'LEARN_MORE']);
});

test('a variant with an invented price or offer is dropped entirely', () => {
  assert.equal(cleanCopy({ headline: 'Masala at ₹99', primaryText: 'Grab it before it is gone.', description: '' }, FACTS), null);
  assert.equal(cleanCopy({ headline: 'Flat 40% off', primaryText: 'Grab it before it is gone.', description: '' }, FACTS), null);
});

test('audience suggestions stay inside Meta\'s bounds', () => {
  assert.deepEqual(cleanAudience({ ageMin: 12, ageMax: 99, gender: 'kids', why: 'Everyone cooks' }), { ageMin: 18, ageMax: 65, gender: 'all', why: 'Everyone cooks' });
  assert.deepEqual(cleanAudience({ ageMin: 40, ageMax: 30, gender: 'women' }).ageMax, 40);
  assert.deepEqual(cleanAudience(undefined), { ageMin: 18, ageMax: 65, gender: 'all', why: '' });
});

// ── request ──────────────────────────────────────────────────────────────────
test('the request uses the current model, schema-guaranteed JSON, low effort and a refusal fallback', () => {
  const r = buildCopyRequest(FACTS);
  assert.equal(r.model, COPY_MODEL);
  assert.equal(r.model, 'claude-opus-5');
  assert.deepEqual(r.output_config.format, { type: 'json_schema', schema: COPY_SCHEMA });
  assert.equal(r.output_config.effort, 'low');
  assert.deepEqual(r.betas, ['server-side-fallback-2026-06-01']);
  assert.deepEqual(r.fallbacks, [{ model: 'claude-opus-4-8' }]);
  assert.equal('thinking' in r, false, 'thinking stays at the model default');
  assert.equal('tool_choice' in r, false);
  const sent = JSON.parse(r.messages[0].content.split('\n\n')[1]);
  assert.equal('allowedPrices' in sent, false, 'screening data is not sent to the model');
  assert.equal(sent.product.price, 270);
});

test('the schema is closed at every level (required for structured outputs)', () => {
  const walk = (node) => {
    if (node?.type === 'object') {
      assert.equal(node.additionalProperties, false);
      assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort());
      Object.values(node.properties).forEach(walk);
    }
    if (node?.type === 'array') walk(node.items);
  };
  walk(COPY_SCHEMA);
});

// ── generation with a fake client ────────────────────────────────────────────
function fakeClient(reply) {
  const calls = [];
  return {
    calls,
    beta: { messages: { create: async (body, opts) => { calls.push({ body, opts }); if (reply instanceof Error) throw reply; return reply; } } },
  };
}
const textReply = (data) => ({ stop_reason: 'end_turn', model: 'claude-opus-5', content: [{ type: 'text', text: JSON.stringify(data) }] });

test('good suggestions come back screened, with the timeout and no retries', async () => {
  const client = fakeClient(textReply({
    variants: [
      { headline: 'Real Solapur Bajar Amti', primaryText: 'Pack of 3 for ₹270. Ground in small batches, the way home kitchens like it.', description: 'Save 18% today', cta: 'SHOP_NOW', angle: 'Value' },
      { headline: 'Masala at ₹99', primaryText: 'An invented price that must be dropped.', description: '', cta: 'SHOP_NOW', angle: 'Wrong' },
      { headline: 'Taste of home', primaryText: 'The amti your family remembers, made fresh in Solapur.', description: 'Fresh every week', cta: 'ORDER_NOW', angle: 'Taste' },
    ],
    audience: { ageMin: 25, ageMax: 60, gender: 'all', why: 'Home cooks buy masalas.' },
    notes: 'Add the shelf life to the product to strengthen the ad.',
  }));
  const out = await generateAdCopy({ client, facts: FACTS });
  assert.equal(out.variants.length, 2);
  assert.deepEqual(out.variants.map((v) => v.angle), ['Value', 'Taste']);
  assert.deepEqual(out.audience, { ageMin: 25, ageMax: 60, gender: 'all', why: 'Home cooks buy masalas.' });
  assert.deepEqual(client.calls[0].opts, { timeout: 25000, maxRetries: 0 });
});

test('a refusal, bad JSON, nothing usable, or an API failure each return a clear error', async () => {
  assert.deepEqual(await generateAdCopy({ client: fakeClient({ stop_reason: 'refusal', content: [] }), facts: FACTS }), { error: 'declined' });
  assert.deepEqual(await generateAdCopy({ client: fakeClient({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'not json' }] }), facts: FACTS }), { error: 'no_suggestion' });
  assert.deepEqual(await generateAdCopy({ client: fakeClient(textReply({ variants: [{ headline: 'x', primaryText: 'y' }], audience: {}, notes: '' })), facts: FACTS }), { error: 'no_suggestion' });
  assert.deepEqual(await generateAdCopy({ client: fakeClient(new Error('overloaded')), facts: FACTS }), { error: 'busy' });
});

// Shadowfax labels (founder, 2026-11-15): developer.shadowfax.in documents
// POST /client/generate_label/ (Forward Logistics -> Label and POD), which the
// older API file did not have. One AWB per call, a PDF link in data.label_url,
// only before pickup. Same `Authorization: Token <api_token>` as booking/tracking.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const OPS = read('supabase/functions/shipping-ops/index.ts');
const ORDERS = read('src/components/manage/OrdersTab.jsx');

test('shipping-ops asks Shadowfax for the label PDF, with the token it already uses', () => {
  const sfx = OPS.slice(OPS.indexOf('// ── Shadowfax ops'), OPS.indexOf("const headers = { Authorization: `Token ${token}` };"));
  assert.match(sfx, /fetch\(`\$\{sBase\}\/client\/generate_label\/`, \{\n\s+method: 'POST',/);
  assert.match(sfx, /headers: \{ Authorization: `Token \$\{token\}`, 'Content-Type': 'application\/json' \}/);
  assert.match(sfx, /body: JSON\.stringify\(\{ awb_number: String\(awb\)\.trim\(\), file_type: 'pdf' \}\)/);
  // Only an https link goes back to the browser, which opens it.
  assert.match(sfx, /typeof ld\?\.data\?\.label_url === 'string' && \/\^https:\\\/\\\/\/\.test\(ld\.data\.label_url\)/);
  assert.match(sfx, /if \(lr\.ok && link\) return json\(\{ labelUrl: link \}\);/);
  assert.match(sfx, /if \(lr\.status === 400\) return json\(\{ error: 'Shadowfax gives the label only before pickup\./);
  assert.ok(!/doesn’t need a printed label/.test(OPS), 'the old refusal is gone');
  // Delhivery's label is untouched.
  assert.match(OPS, /\/api\/p\/packing_slip\?wbns=\$\{awb\}&pdf=true&pdf_size=4R/);
});

test('the order card offers Label for Shadowfax only while the parcel waits for pickup', () => {
  assert.match(ORDERS, /\{\(!ship\.isSfx \|\| prog\.bucket === 'pickup'\) && \(\n\s+<button type="button" disabled=\{!!ship\.busy\} onClick=\{ship\.label\}/);
  assert.match(ORDERS, /\{classifyBucket\(\{ shipment_status: status \}\) === 'pickup' && \(\n\s+<button disabled=\{!!busy\} onClick=\{label\}/);
  assert.ok(!/The pickup rider carries the label\./.test(ORDERS));
});

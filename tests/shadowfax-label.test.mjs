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
  assert.match(sfx, /if \(lr\.ok && link\) \{/);
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

test('the Shadowfax label opens in the PDF viewer to print, like Delhivery, instead of downloading', () => {
  const sfx = OPS.slice(OPS.indexOf('// ── Shadowfax ops'), OPS.indexOf("const headers = { Authorization: `Token ${token}` };"));
  assert.match(OPS, /import \{ encode as encodeBase64 \} from 'https:\/\/deno\.land\/std@0\.168\.0\/encoding\/base64\.ts';/);
  assert.match(sfx, /storage\\\.googleapis\\\.com\|amazonaws\\\.com\|shadowfax\\\.in/, 'only from Shadowfax or its storage');
  assert.match(sfx, /buf\.length <= 3_000_000 && String\.fromCharCode\(buf\[0\], buf\[1\], buf\[2\], buf\[3\]\) === '%PDF'/, 'only a real PDF');
  assert.match(sfx, /return json\(\{ labelUrl: link, labelPdf: encodeBase64\(ab as ArrayBuffer\) \}\);/);
  assert.match(sfx, /return json\(\{ labelUrl: link \}\);/, 'falls back to the link');
  assert.match(ORDERS, /if \(r\.labelPdf\) openPdfTab\(r\.labelPdf, /);
  assert.match(ORDERS, /else if \(r\.labelUrl\) window\.open\(r\.labelUrl, '_blank', 'noopener'\);/, 'Delhivery unchanged');
  const util = read('src/utils/openPdf.js');
  assert.match(util, /new Blob\(\[base64ToBytes\(b64\)\], \{ type: 'application\/pdf' \}\)/);
  assert.match(util, /const tab = window\.open\(url, '_blank'\);/);
  assert.match(util, /a\.download = filename;/, 'a blocked tab still gets the PDF');
});

test('base64ToBytes gives the exact bytes back', async () => {
  const { base64ToBytes } = await import('../src/utils/openPdf.js');
  assert.deepEqual([...base64ToBytes(Buffer.from('%PDF-1.4').toString('base64'))], [...Buffer.from('%PDF-1.4')]);
  assert.equal(base64ToBytes('').length, 0);
});

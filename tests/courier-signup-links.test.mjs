// Settings → Shipping: Connect sends the seller to the courier's own page to
// register (or log in) and get an API token, and opens the form here so they
// can paste it when they come back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
const SHIP = read('src/components/manage/ShippingConnect.jsx');

test('each courier carries its official sign-up page', () => {
  assert.match(SHIP, /delhivery: \{[^}]*signup: 'https:\/\/one\.delhivery\.com\/v2\/register' \}/);
  assert.match(SHIP, /shadowfax: \{[^}]*signup: 'https:\/\/shadowfax360\.in\/login' \}/);
});

test('Connect opens that page in a new tab and the form here', () => {
  const connect = SHIP.slice(SHIP.lastIndexOf('<a href={COURIERS[courier].signup}'), SHIP.lastIndexOf('Connect\n'));
  assert.match(connect, /target="_blank" rel="noopener noreferrer"/, 'a new tab, with no opener');
  assert.match(connect, /onClick=\{\(\) => \{ resetForm\(\); setOpen\(courier\); setErr\(''\); \}\}/, 'and the token form opens');
});

test('the form says what to do, with a link back to the courier', () => {
  assert.match(SHIP, /Register or log in on \{COURIERS\[courier\]\.name\}/);
  assert.match(SHIP, /open \{COURIERS\[courier\]\.name\} →<\/a>/);
  assert.match(SHIP, /Copy your API token from your \{COURIERS\[courier\]\.name\} dashboard\./);
  // Every link off to a courier opens without handing it this window.
  const links = SHIP.match(/<a href=\{COURIERS\[courier\]\.signup\}[^>]*>/g) || [];
  assert.equal(links.length, 2);
  for (const a of links) assert.match(a, /target="_blank" rel="noopener noreferrer"/);
});

// Every server function that acts for a seller must check the store PIN through
// verify_store_pin, the throttled check, never by comparing stores.pin itself:
// a direct comparison lets anyone guess a 4-digit PIN without limit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const fnDir = `${root}supabase/functions/`;

function sourceFiles() {
  const out = [];
  for (const name of readdirSync(fnDir)) {
    const path = `${fnDir}${name}/index.ts`;
    if (existsSync(path)) out.push([name, readFileSync(path, 'utf8')]);
  }
  for (const walk of ['api']) {
    const stack = [`${root}${walk}`];
    while (stack.length) {
      const dir = stack.pop();
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = `${dir}/${entry.name}`;
        if (entry.isDirectory()) stack.push(p);
        else if (/\.(js|ts)$/.test(entry.name)) out.push([p.slice(root.length), readFileSync(p, 'utf8')]);
      }
    }
  }
  return out;
}

test('no server code compares the store PIN hash itself', () => {
  const offenders = sourceFiles()
    .filter(([, src]) => /\.pin\s*[!=]==|select\(\s*'[^']*\bpin\b[^']*'\s*\)/.test(src))
    .map(([name]) => name);
  assert.deepEqual(offenders, []);
});

test('the six seller functions go through verify_store_pin before acting', () => {
  for (const name of ['payments-connect', 'send-campaign', 'shipping-book', 'shipping-connect', 'shipping-ops', 'shipping-sync', 'payments-link']) {
    const src = readFileSync(`${fnDir}${name}/index.ts`, 'utf8');
    assert.match(src, /supabase\.rpc\('verify_store_pin', \{ p_slug: slug, p_hashed_pin: (hashedPin|hashedPin) \}\)/, name);
    assert.match(src, /if \(pinOk !== true\) return /, name);
  }
});

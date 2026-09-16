// SQL files are applied by copy-paste into the Supabase editor. On Windows a
// clipboard copy can mis-read UTF-8 (Windows PowerShell 5.1 reads files as ANSI),
// turning '••••' into 'â€¢â€¢â€¢â€¢'. In a comment that is harmless; in code it
// silently changes what production returns. So: no non-ASCII outside comments
// in anything that changes the database. Display-only labels in read-only
// checks are allowed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (p) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8');

const CHANGES_THE_DATABASE = [
  'supabase/pin-bypass-closure-forward.sql',
  'supabase/pin-bypass-closure-ROLLBACK-EMERGENCY.sql',
  'supabase/pin-whatsapp-mask-fix.sql',
  'supabase/reviews-verified-forward.sql',
  'supabase/reviews-verified-rollback.sql',
  'supabase/payments-tracking.sql',
  'supabase/payments-tracking-rollback.sql',
  'supabase/payments-automation.sql',
  'supabase/payments-automation-rollback.sql',
  'supabase/payments-automation-schedule.sql',
  'supabase/meta-ads-mcp-forward.sql',
  'supabase/meta-ads-mcp-rollback.sql',
  'supabase/security-phase-1-forward.sql',
  'supabase/security-phase-1-ROLLBACK.sql',
  'supabase/orders-authenticated-insert-forward.sql',
  'supabase/orders-authenticated-insert-ROLLBACK.sql',
  'supabase/orders-authenticated-insert-PROOF.sql',
  'supabase/order-integrity-phase2-forward.sql',
  'supabase/order-integrity-phase2-ROLLBACK.sql',
  'supabase/security-phase-3a-forward.sql',
  'supabase/security-phase-3a-ROLLBACK.sql',
];

for (const file of CHANGES_THE_DATABASE) {
  test(`${file}: code is plain ASCII (comments may not be)`, () => {
    const offending = read(file).split(/\r?\n/)
      .map((line, i) => [i + 1, line.replace(/--.*$/, '')])
      .filter(([, code]) => /[^\x00-\x7F]/.test(code))
      .map(([n, code]) => `${n}: ${code.trim()}`);
    assert.deepEqual(offending, []);
  });
}

test('the WhatsApp key mask is built from chr(8226), never pasted bullets', () => {
  for (const file of ['supabase/pin-bypass-closure-forward.sql',
                      'supabase/pin-bypass-closure-ROLLBACK-EMERGENCY.sql',
                      'supabase/pin-whatsapp-mask-fix.sql']) {
    assert.match(read(file), /repeat\(chr\(8226\), 4\) \|\| right\(w\.api_key, 4\)/, file);
  }
});

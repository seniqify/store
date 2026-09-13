# Closing the PIN-throttle bypasses

**Status: prepared, reviewed, NOT applied.** Branch `pin-throttle-bypass-fix`.

## What is wrong

`verify_store_pin` is throttled and has been live for some time — 10 failures
per IP per store per 15 minutes, 50 store-wide. **Eleven other functions never
call it.** They compare the hash themselves and count nothing:

```sql
exists (select 1 from public.stores s
         where s.slug = p_slug and s.pin = p_hashed_pin)
```

A PIN is four digits. `hashPin()` is `SHA-256('snq1_' || pin)` with a constant
salt shipped in browser JS, so all 10,000 valid hashes are computed once,
offline, and work against every store on the platform.

`get_store_orders` is the cheapest way in: anon-executable, unlimited, and the
call that confirms a guess returns 500 rows of customer names, phone numbers and
delivery addresses in the same response. `update_store_config` returns a plain
boolean — true only on a correct PIN.

**`reset_store_pin` is worse and needs no PIN at all.** It takes the store slug
(the storefront URL), the store's WhatsApp number (printed on every storefront)
and a six-digit OTP — 900,000 values, ten-minute window, no attempt limit — and
then *sets* the PIN. Full takeover plus merchant lockout, from public
information. The attacker can trigger a fresh OTP whenever the window closes.

## Files

| file | safe on production | what it does |
|---|---|---|
| `supabase/pin-bypass-closure-verify.sql` | **yes** — one SELECT, read-only | 16 checks; all FAIL before, all PASS after |
| `supabase/pin-bypass-closure-forward.sql` | no — this is the change | replaces 13 functions, adds `pin_attempts.kind` |
| `supabase/pin-attempt-throttle.sql` | **do not run** | historical record; re-running reverts the fix |
| `tests/pin-sql-safety.test.mjs` | n/a | 19 checks on the SQL itself; `npm test` |

## Order of operations

1. **Baseline.** Run `pin-bypass-closure-verify.sql`. Everything reads FAIL.
   That is the current state of production; keep the output.

2. **Capture the rollback.** This migration deliberately ships no rollback file,
   because reverting means restoring the bypasses. Run the query in the forward
   file's header and save the result — those 13 function definitions *are* the
   rollback.

3. **Apply** `pin-bypass-closure-forward.sql`. One transaction, idempotent.

4. **Verify.** Run `pin-bypass-closure-verify.sql` again. Every row PASS except
   the ones labelled `(info)`.

5. **Smoke-test a real store's Manage dashboard.** This matters more than usual:
   four functions changed language from `sql` to `plpgsql`.
   - orders list loads
   - the new-order badge still ticks (watch this one — `new_orders_since` polls
     every 15 s and its one-row-of-zeros shape on a refused PIN is preserved
     deliberately, because `useNewOrders` reads `data[0]`)
   - settings save
   - a review hides and unhides
   - WhatsApp settings load with the masked key

6. **Deploy the edge function.** `supabase/functions/send-otp/index.ts` now draws
   the OTP from `crypto.getRandomValues` with rejection sampling instead of
   `Math.random()`. Independent of the SQL — deploy whenever.

## Three judgement calls to be aware of

**`verify_store_pin` records failures only now.** The limit never counted
successes, and the clear-on-success `DELETE` wiped the history anyway — but it
does lose the "seller signed in at 14:32" audit line. Made because
`new_orders_since` polls every 15 seconds per open dashboard, which would be
~4 writes/minute/seller forever.

**`search_path = public, pg_temp`, not `public`.** PostgreSQL searches the
session's temp schema **first, ahead of `pg_catalog`, whenever `pg_temp` is not
named explicitly**. Seven of these carried `SET search_path TO 'public'`, which
is weaker than it looks. `verify_store_pin` was already correct.

> This also applies to the order-integrity migration on the other branch, which
> pins `search_path = pg_catalog` on my recommendation. Everything in those
> functions is schema-qualified so nothing unqualified can be shadowed, but the
> reasoning I gave at the time was wrong and it should be revisited before that
> migration is applied.

**A pre-existing NULL bug was fixed in passing.** `NULL not in ('approved',
'hidden')` evaluates to NULL, the `IF` does not fire, and `set_review_status`
fell through to `set status = NULL`. One added clause, in a function already
being rewritten.

## Not fixed here

- **The PIN is still four digits and still hashed client-side** with a constant
  global salt. The hash is password-equivalent, travels in every request body,
  and one rainbow table covers every store. Throttling makes it impractical to
  guess; it does not make the credential strong.
- **`delete_review` is still a hard `DELETE`** with no tombstone. Retiring
  merchant hard-delete belongs to the verified-review redesign.
- **Blocks B through F** of the review audit were never run. Block A found all
  of the above; B onwards cover the `reviews` table's own RLS and grants.

## Related, on hold

`order-integrity-commit-2` — the attested-order migration. Committed, unapplied,
nothing deployed. Its next step is the read-only production inspection
(`supabase/order-integrity-inspect-PRODUCTION.sql`), whose `P5.2` and `P6.1` rows
decide whether it can be applied at all. It loses nothing by waiting.

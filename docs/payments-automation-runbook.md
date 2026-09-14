# Automatic payment status — runbook

COD becomes **collected** when the courier (or the seller's own delivery) marks
it delivered, and **returned** when it comes back. Online payments confirm with
Razorpay by themselves. Nobody marks anything; a sweep runs every 30 minutes.

## Order matters

1. **Apply** `supabase/payments-automation.sql`. It also brings existing orders
   up to date once (about 58 delivered COD → collected, about 16 returned, on
   2026-09-15), leaving their times empty so old money is not counted as today.
2. **Verify** with `supabase/payments-automation-verify.sql` (read-only). All
   rows PASS except `(info)`. U2.1 tests the status reader against the real
   courier texts, returned before delivered.
3. **Deploy edge functions** (Management API):
   - `status-sweep` — new, **verify_jwt false** (called by the database; the
     secret in `automation_secrets` guards it)
   - `shipping-sync`, `shipping-ops` — Delhivery returns keep "RTO"; "Out For
     Delivery" is no longer treated as finished
   - `payments-link` — `reconcile` action for checkout payments
   - PIN-gate fixes: `payments-connect`, `send-campaign`, `shipping-book`,
     `shipping-connect` (and the two above)
   Keep `verify_jwt: true` on all of these except `status-sweep`.
4. **Schedule** with `supabase/payments-automation-schedule.sql`.
5. **Deploy the website** (push to `main`).

## What changes for sellers

- Payments tab: no "Mark collected". Opening it refreshes couriers and Razorpay.
  Tiles: Received, COD still to collect, COD collected (automatic), Returned.
- Needs attention: payment not completed, payment link not paid, delivery
  problem (not contactable, pending…). Nothing to mark.
- Orders: delivered COD shows Paid on its own; returned COD shows "↩ Returned";
  orders the courier delivered move to Delivered.
- A seller can still correct a payment by hand; the next refresh does not undo
  it (the rule acts only when the courier outcome changes).

## Check it worked

- `payments-automation-verify.sql` U4.2 shows `pocketlink-status-sweep · */30 * * * *`.
- Supabase → Edge Functions → status-sweep → Logs: a run every 30 minutes
  returning `{ ok: true, courierUpdates, linksPaid, checkoutsPaid }`.

## Undo

`supabase/payments-automation-rollback.sql` stops the schedule and removes the
trigger. Values already set (collected / returned, times) are kept.

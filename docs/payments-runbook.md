# Payments section — runbook

Adds **Manage → Payments** (money received per day, COD to collect, needs
attention) and **payment links** that turn a COD order into a prepaid one.

## Order matters

The server functions write new order columns, so the database goes first.

1. **Apply** `supabase/payments-tracking.sql` in the Supabase SQL editor.
   Expect "Success. No rows returned".
2. **Verify** with `supabase/payments-tracking-verify.sql` (read-only). Every
   row PASS except `(info)`.
3. **Deploy edge functions** (Management API, `verify_jwt: true`):
   - `payments-link` (new)
   - `payments-verify` (now records `paid_at` / `paid_via`)
4. **Deploy the website** (push to `main`).

Deploying step 3 before step 1 would break marking online payments paid.

## What the seller sees

- Payments tab: Today / 7 days / 30 days, received online vs COD, COD still
  to collect, daily table, recent payments with how and when they were paid.
- Needs attention:
  - **Payment not completed** → Send payment link, Chat
  - **Payment link sent** → Check payment, Resend link
  - **Delivered, COD not collected** → Mark collected
- Orders → More → **Send payment link** for unpaid, unshipped orders.

## How a link payment is confirmed

The customer pays on Razorpay and is sent back to their order page, which asks
the server to check. The Payments tab also checks open links whenever it opens.
An order becomes paid only when Razorpay reports the link **paid**, for that
order (`notes.order_row_id`) and its exact total. It then switches to
`payment_method = 'online'` so the courier does not collect cash.

Links are refused for orders already booked with a courier (AWB), because the
shipment was booked as COD.

## Test (Sankalp, live Razorpay)

1. Place a COD order for ₹199.
2. Manage → Orders → More → Send payment link. WhatsApp opens with the link.
3. Pay it. You land on the order page, which shows Paid.
4. Manage → Payments: the order is under "Payments received today" as
   "Paid by payment link"; the Orders card shows Paid and ONLINE.
5. Refund from the Razorpay dashboard.

## Undo

`supabase/payments-tracking-rollback.sql` restores the old `set_order_paid`.
Columns are kept (they hold real data). Redeploy the previous site if needed.

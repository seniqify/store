# Security hardening, phase 1 — runbook

**Status: prepared, NOT applied, NOT deployed.** Branch `security-phase-1`.

Three things change: WhatsApp template URLs stop living in this (public)
repository, the OTP endpoint gets a rate limit, and an order can no longer be
*created* claiming it was paid.

---

## Do this first — five Supabase secrets

The edge function no longer falls back to a hardcoded Seniqify `/process` URL.
A Seniqify `/process` URL **is** the credential: anyone holding one can send
WhatsApp messages as PocketLink. Three of them sat in this repository's source,
and the secrets that would have overridden them were never set.

Set all five in **Supabase → Project settings → Edge Functions → Secrets**
*before* deploying `send-otp`:

| Secret | Used for | If it is missing after deploy |
|---|---|---|
| `SENIQIFY_TEMPLATE_URL` | the OTP code | **`send` returns 503 — nobody can register or reset a PIN** |
| `SENIQIFY_WELCOME_TEMPLATE_URL` | welcome message after registration | `welcome` returns 503; registration itself still works |
| `SENIQIFY_ORDER_CONFIRM_TEMPLATE_URL` | COD "Confirm my order" | COD buyers get the plain thank-you instead; orders unaffected |
| `SENIQIFY_ORDER_SELLER_TEMPLATE_URL` | seller new-order alert | already set — leave it |
| `SENIQIFY_ORDER_CUSTOMER_TEMPLATE_URL` | buyer thank-you | already set — leave it |

The values are the same URLs the code used until now; take them from the
previous version of `supabase/functions/send-otp/index.ts` in git history.

**Then rotate them at Seniqify.** Git history keeps the old URLs, so moving
them into secrets stops the next leak, not this one — the three templates need
to be re-issued. That is a Seniqify-side action, and it is yours to make.

`SENIQIFY_API_KEY` stays optional and is still unset. If Seniqify can put these
templates behind a key, set it — then the URL alone stops being enough.

---

## Order of operations

1. **Secrets** — all five above. Nothing else works without them.

2. **Baseline** — run `supabase/security-phase-1-verify.sql` (read-only, one
   SELECT). Every row reads FAIL except the `(info)` rows. Keep the output.

3. **Apply the SQL** — `supabase/security-phase-1-forward.sql`, one transaction,
   idempotent. Supabase Dashboard → SQL Editor → paste → Run.

4. **Verify** — run the verify file again. Every row PASS except `(info)`.

5. **Deploy the edge function** — `send-otp` only:
   `supabase functions deploy send-otp --no-verify-jwt`
   (it is deployed with `--no-verify-jwt` today; keep that, or the storefront
   and the signup screen stop reaching it).

   Deploy it **after** the SQL: the function treats a missing `otp_guard` as
   "refuse", so deploying it first would stop OTPs until the SQL lands.

6. **Deploy the site** — merging the PR to `main` is enough (Vercel). It carries
   only two small client changes: the PIN check no longer falls back to a
   browser-side comparison, and a placeholder no longer prints a template URL.

7. **Smoke-test, in this order:**
   - register a store on `/start` — the code arrives, and a wrong code is refused
   - ask for four codes in a row for the same number — the fourth is refused
     with "Too many code requests" (that is the limit working)
   - place a COD order on a real store — seller alert, buyer confirm message,
     order visible in Manage with status "new"
   - place an online order end to end — it shows **paid** afterwards (that flip
     comes from `payments-verify`, which this change does not touch)
   - open Manage with the right PIN, then a wrong one

---

## What behaves differently afterwards

**An order can never be born "paid".** `paid`, `paid_at`, `paid_via`,
`payment_ref` and `payment_provider` are forced to their unpaid values on every
INSERT, whatever role does it, and `status` is clamped to `new` or `abandoned`.
Payment is recorded by UPDATE after Razorpay confirms it — `payments-verify`,
the Razorpay webhook and the reconcile tools are untouched, so the normal online
flow is unchanged.

One case does change. If a customer's own insert is blocked (ad-blocker, privacy
browser, stale build) **and** their online payment succeeds, the safety-net row
now lands *unpaid, with no payment reference*, where before it was taken at its
word. The seller sees it in the Payments tab as an order to reconcile, and
Razorpay carries the order id in its notes, so the money is findable — but it is
one manual step that did not exist before. The proper fix is for the safety net
to ask Razorpay before writing "paid"; that is phase 2, because it means
touching the payment path.

**The OTP endpoint refuses floods.** Per phone: 3 codes per 15 minutes, 10 per
day. Per address: 15 per hour. Guesses: 5 per phone per 15 minutes, 30 per
address per hour. A correct code gives that phone's guesses back. The counters
live in `public.pin_attempts` — the same ledger the PIN throttle uses — under
their own `kind` values, so an OTP flood cannot lock anyone out of PIN entry.
Phone numbers are stored as a SHA-256 hash, not in the clear.

The limits hold under parallel requests, which is the case that matters: each
decision takes transaction-scoped advisory locks on both the phone and the
address budget (always in ascending key order, so they cannot deadlock), and
writes its row inside that same transaction. A guess is spent when it is
allowed, not reported after it fails — otherwise requests fired together would
all pass the check before any of them was counted.

**A failed PIN check is a refusal.** `verifyPin` no longer falls back to reading
`stores.pin` and comparing in the browser.

**`anon` and `authenticated` lose DELETE and TRUNCATE** on `stores` and
`orders`. Nothing uses them. Note that "Delete my store" in Manage has been
silently doing nothing for some time (RLS blocks it); after this it fails
loudly instead. Fixing that button is not part of this change.

---

## If something breaks

`supabase/security-phase-1-ROLLBACK.sql` drops the insert guard and the OTP
guard. **Redeploy the previous `send-otp` along with it** — the new one treats a
missing `otp_guard` as a refusal, so rolling back the SQL alone stops OTPs.

The rollback deliberately does **not** re-grant DELETE and TRUNCATE.

---

## Not fixed here

Phase 1 is deliberately narrow. The remaining items from the security review —
merchant authentication, order pricing, and what a store's public record exposes
— are tracked outside this repository, with the founder, and are scheduled as
phase 2. They are not listed here: this repository is public.

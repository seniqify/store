# Verified-purchase reviews — runbook

Replaces the open review form with reviews that can only come from a delivered
order. Database: `supabase/reviews-verified-forward.sql`. Website: branch
`verified-reviews`.

## What changes for people

| Who | Before | After |
|---|---|---|
| Anyone | Could post unlimited reviews to any store, pre-approved | Can't post at all without a link |
| Customer | — | Gets a WhatsApp link from the seller after delivery, rates each item, can edit later |
| Seller | Could hide or permanently delete any review | Can reply publicly, or report a review with a reason. Can't hide or delete |
| PocketLink (Console → Reviews) | — | Keeps or removes reported reviews. Removing needs a reason |
| Shoppers | Store-wide stars | Stars per product on the product page, plus store total; every review marked Verified purchase |

The existing reviews (41 on 12 Sept, across 8 stores) become hidden: none of
them is tied to an order. Sellers still see them in Manage → Reviews under
"older reviews not shown". Ratings restart from zero.

## Still open

`orders` still accepts anonymous inserts. A seller who creates a fake order,
marks it delivered and messages themselves can still post one "verified"
review per fake order item. The migration refuses orders placed from the
store's own WhatsApp or owner number and audits every link, but only the
order-integrity work closes this fully.

## Steps

All SQL runs in Supabase → SQL Editor. Paste the whole file, Run.

1. **Inspect (read-only).** Run `supabase/reviews-inspect.sql`, send the result.
   Check: I10 = `extensions`, I13 all `false` and `pin_attempts.kind=true`,
   I7 all `0`, I11 at least `1`.
2. **Know the undo.** `supabase/reviews-verified-rollback.sql`. It reopens the
   fake-review hole; use only if something is actually broken.
3. **Apply.** Run `supabase/reviews-verified-forward.sql`. Expect
   "Success. No rows returned". One transaction: an error changes nothing.
4. **Verify (read-only).** Run `supabase/reviews-verified-verify.sql`. Every
   row PASS except `(info)`. Also re-run `pin-bypass-closure-verify.sql`: it
   should still be all PASS (it now expects 8 PIN functions).
5. **Deploy the website straight after step 3.** Until it is live, the old
   Reviews tab shows nothing and old review forms fail.
6. **Smoke test.**
   - Store page: Reviews section shows "No reviews yet", no form.
   - Manage → Orders: a delivered order shows **Ask for a review**; tapping it
     opens WhatsApp with the link.
   - Open the link on a phone: rate an item, post. Tap Edit, change it, save.
   - Store page and that product's page show the review, Verified purchase.
   - Manage → Reviews: reply; then report it with a reason.
   - Console → Reviews: the report is listed; Keep it.

## Undo

1. Run `supabase/reviews-verified-rollback.sql`.
2. Redeploy the previous website build (`main` before the merge).
3. New reviews are kept in `product_reviews_preserved` and friends.

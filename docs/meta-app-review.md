# Meta App Review — resubmission kit

Result of the 2026-09-01 submission (reviewed 2026-09-01 17:05 IST):

- **Approved**: `pages_show_list`, `business_management`, `ads_read`,
  `pages_read_engagement`, `public_profile`
- **Rejected**: `ads_management`, Marketing API Access Tier

These are two unrelated rejections. Treat them as two separate tracks and
**submit them separately** — bundling means one failure sinks both again.

---

## Track 1 — Marketing API Access Tier

> "Our records do not show a sufficient number of Ads API calls in the last 15
> days by this application."

Not a screencast problem. Meta wants evidence of a working integration:
roughly **500 Marketing API calls over a rolling 15-day window** (~35/day).

**`ads_read` is already approved**, so reporting calls count and we can build
this volume today without `ads_management`. `api/meta/ads.js` already makes
exactly these calls — production simply runs old code that almost nobody
reaches.

**Do not** loop calls in a script to inflate the counter. Meta inspects the
pattern; a synthetic burst from one IP with no corresponding UI activity reads
as gaming and invites a harder rejection.

Re-request this only once the 15-day window genuinely qualifies.

---

## Track 2 — `ads_management`

> "We have determined that your apps' use case is allowed, however, the
> submitted screencast fails to demonstrate the end-to-end experience."

Read the first clause: **the use case is approved.** Meta is not questioning
what PocketLink does. They rejected the recording.

Their item 5 is almost certainly the root cause:

> "If your app is a server-to-server app OR your app is using system user token
> to access Meta API, please indicate it in your next submission so that we're
> aware that frontend Meta login authentication flow is not visible."

PocketLink's Login for Business configuration issues **system-user tokens**. The
previous screencast therefore could not show a conventional frontend consent
flow, the reviewer expected one, and rejected on items 1–2. That single
undeclared fact likely cost the whole submission.

---

## Submission notes — paste into the App Review form

> **What PocketLink does**
>
> PocketLink is a storefront builder for small Indian retailers. A shop owner
> creates a product catalogue, shares one link, and customers order through
> WhatsApp. Sellers are typically single-owner shops in tier-2 and tier-3 cities
> with no marketing team and no agency.
>
> **Why we need `ads_management`**
>
> Sellers want to advertise the products already in their PocketLink catalogue,
> but Meta Ads Manager is far beyond what they can operate. PocketLink builds
> the campaign for them from data they already maintain — product name, photo,
> price, their city — and shows the complete plan in plain language before
> anything is created. The seller reviews it, and PocketLink creates the
> campaign, ad set, creative and ad on their own ad account via the Marketing
> API. Every object is created PAUSED. Nothing ever spends without a separate,
> explicit action by the seller.
>
> **Authentication — please note (re: your item 5)**
>
> PocketLink uses **Facebook Login for Business** with a configuration that
> issues a **system-user token**. The seller's consent is captured in the Login
> for Business dialog shown in the screencast at [TIMESTAMP]; all subsequent
> Marketing API calls are **server-to-server** from our backend using that
> token. There is therefore no per-call frontend Meta login, and none will be
> visible after the initial consent step. We are flagging this explicitly as
> your feedback requested.
>
> **Test credentials**
>
> - URL: https://www.pocketlink.store/showme/manage
> - Store PIN: 2580
>
> PocketLink sellers do not use email accounts. A seller registers with their
> WhatsApp number, verifies it by one-time code, and thereafter opens their
> dashboard with a 4-digit PIN. The PIN above is the complete credential — it is
> the same gate a real seller uses every day.
>
> **Safety**
>
> Campaigns, ad sets and ads are created with `status: PAUSED`, and we read the
> status back from the Graph API to confirm before reporting success. Activation
> is a separate, separately-authorised action and is disabled entirely in this
> environment for the duration of your review.

Fill the remaining bracketed placeholder (the screencast timestamp) before
submitting. Do not claim anything
about the Sales / `OUTCOME_SALES` objective — it has never been validated
end-to-end. The recording covers the **Traffic** objective only.

---

## Screencast shot list

Meta's five requirements, mapped to shots. English UI, captions throughout,
narrate what each button does.

| # | Shot | Covers |
|---|------|--------|
| 1 | Seller opens `/showme/manage` and enters their 4-digit PIN | 3 |
| 2 | Settings → **Connect Meta** | 1 |
| 3 | Login for Business dialog — **hold on the permissions screen long enough to read**, then Continue | 1, 2 |
| 4 | Back in PocketLink: choose Facebook Page, choose ad account | 3 |
| 5 | Ads tab → Create campaign → **Get more store visitors** (Traffic) | 3 |
| 6 | The plan screen — narrate goal, audience, budget, destination | 3, 4 |
| 7 | Click create. Show the PAUSED confirmation and the returned IDs | 3 |
| 8 | **Cut to Meta Ads Manager showing that campaign, status PAUSED** | 3 |
| 9 | Back to the Ads tab showing live reporting | 3 |

Shot 8 is what "end-to-end" means to them: proof the API call had a real
effect. The previous submission's most likely gap after item 5.

**`/console` must never appear in the recording.** It is the internal founder
console. A reviewer who sees a staff sign-in anywhere in this flow will read the
feature as staff-only — the same finding we were just rejected for. The entire
recording lives inside `/showme/manage`, reached by PIN, exactly as a real
seller reaches it.

**No email sign-in appears either.** PocketLink sellers have no email accounts:
they register with a WhatsApp number, verify by one-time code, and open Manage
with a 4-digit PIN. Introducing an email login for the ads flow would put a
concept in front of the reviewer that exists nowhere else in the product, and
would look exactly like the staff path we must avoid showing.

Caption over shot 3: *"The seller grants PocketLink access to their ad account.
This issues a system-user token; all later calls are server-to-server."*

---

## Pre-flight checklist

- [ ] Production runs the repaired code (the `act_act_` fix — creation was
      impossible before it)
- [ ] `META_PAUSED_ONLY=true` set on Production for the review window, so
      `activationBlocked()` refuses activation server-side even for an admin
- [ ] Campaign creation is authorised by the **store PIN**, not a `crm_team`
      session — otherwise there is no merchant path to film
- [ ] `stores.pin` confirmed **not** readable by `anon` (see the security note
      below) — this must be settled before the PIN authorises ad creation
- [ ] Attempt throttling on `verify_store_pin`
- [ ] Activation requires a fresh WhatsApp OTP to the store's registered number,
      and is disabled outright during the review window
- [ ] Recording is on `pocketlink.store`, never a preview URL — a reviewer has
      no Vercel account and would hit Deployment Protection
- [ ] Sales objective absent from the recording and the notes

---

---

## How merchants actually authenticate — and what authorises a Meta write

There is no email login anywhere in PocketLink. A seller registers with their
WhatsApp number, proves it with a one-time code, fills in the store form, and
from then on opens `/[store]/manage` with a 4-digit PIN.

Campaign creation must therefore be authorised by that same PIN. Until now it
was gated on `crm_team` — internal staff — purely because that was the only
table linking a Supabase auth user to any permission. That is why no merchant
path existed to record, and it is the root of the "not aligned with use case"
rejection.

The split that keeps this safe is blast radius, not ceremony:

| Action | Gate | Worst case if the PIN leaks |
|--------|------|------------------------------|
| Create campaign (PAUSED) | store PIN — same as the Ads dashboard, preview and Meta connect | paused objects in the merchant's own ad account; no money moves |
| **Activate** (the only step that spends) | fresh WhatsApp OTP to the store's registered number | blocked — the attacker would need the seller's phone |

**Security prerequisites, because a 4-digit PIN is weak.** It is SHA-256 with a
static salt (`snq1_`), ~10,000 possibilities, and there is no attempt throttle
anywhere in the codebase. Before the PIN authorises ad creation:

1. Confirm `stores.pin` is not readable by `anon`. `src/utils/storeService.js`
   falls back to selecting the column directly, and `stores` carries a public
   read policy — if the column is not revoked, every PIN hash is world-readable
   and trivially cracked:

   ```sql
   select grantee, privilege_type
   from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'stores'
     and column_name = 'pin';
   ```
   Any row naming `anon` or `public` is a live vulnerability, independent of all
   Meta work.

2. Add attempt throttling to `verify_store_pin`.

## Sequence

| When | Action |
|------|--------|
| Day 0 | Merge to production. Set `META_PAUSED_ONLY=true`. Ads API calls begin accruing. |
| Day 1–3 | Ship merchant identity. Record the screencast. |
| Day 3–4 | Resubmit **`ads_management` only**, with the system-user-token declaration. |
| Day 15+ | Re-request the **Marketing API Access Tier** once volume genuinely qualifies. |

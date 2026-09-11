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
> - Ads account sign-in: pockelink@gmail.com / [PASSWORD]
>
> The PIN opens the seller dashboard. Creating a campaign additionally requires
> the account sign-in above, because that action can lead to spending.
>
> **Safety**
>
> Campaigns, ad sets and ads are created with `status: PAUSED`, and we read the
> status back from the Graph API to confirm before reporting success. Activation
> is a separate, separately-authorised action and is disabled entirely in this
> environment for the duration of your review.

The reviewer account is **`pockelink@gmail.com`** — that spelling is deliberate
(no `t`), it is the real address, do not "correct" it. Verified on 2026-09-10 to
hold no `crm_team` row, so it exercises the merchant path rather than the staff
path. Using a `crm_team` account here would repeat the exact "not aligned with
use case" finding.

Fill the two remaining bracketed placeholders before submitting. Do not claim anything
about the Sales / `OUTCOME_SALES` objective — it has never been validated
end-to-end. The recording covers the **Traffic** objective only.

---

## Screencast shot list

Meta's five requirements, mapped to shots. English UI, captions throughout,
narrate what each button does.

| # | Shot | Covers |
|---|------|--------|
| 1 | Seller signs in to PocketLink and opens their store dashboard | 3 |
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

**Shot 1 must not route through `/console`.** That page is the internal founder
console: signing in there as the tester lands on a "Founder access only" screen,
because the account correctly holds no `crm_team` row. A reviewer watching a
seller get rejected by a staff console would read the flow as staff-only — the
same finding we were just rejected for. The sign-in has to appear inside the
seller's own dashboard, framed as "creating ads needs an account because money
is involved". That is a prerequisite for filming, not a nicety.

Caption over shot 3: *"The seller grants PocketLink access to their ad account.
This issues a system-user token; all later calls are server-to-server."*

---

## Pre-flight checklist

- [ ] Production runs the repaired code (the `act_act_` fix — creation was
      impossible before it)
- [ ] `META_PAUSED_ONLY=true` set on Production for the review window, so
      `activationBlocked()` refuses activation server-side even for an admin
- [ ] A real merchant identity exists so shot 1 is a seller, not staff — the
      reviewer must see the merchant path, not the `crm_team` path
- [ ] Tester account is **not** in `crm_team` (that would demonstrate the wrong
      flow and repeat the "not aligned with use case" finding)
- [ ] Recording is on `pocketlink.store`, never a preview URL — a reviewer has
      no Vercel account and would hit Deployment Protection
- [ ] Sales objective absent from the recording and the notes

---

## Sequence

| When | Action |
|------|--------|
| Day 0 | Merge to production. Set `META_PAUSED_ONLY=true`. Ads API calls begin accruing. |
| Day 1–3 | Ship merchant identity. Record the screencast. |
| Day 3–4 | Resubmit **`ads_management` only**, with the system-user-token declaration. |
| Day 15+ | Re-request the **Marketing API Access Tier** once volume genuinely qualifies. |

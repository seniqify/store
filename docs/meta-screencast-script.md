# Meta App Review screencast — narration script

Target length **2:30–3:30**. English throughout. Captions on every shot — Meta's
Screen Recording Guide asks for them explicitly, and the last submission was
rejected partly on presentation.

Record on **production**: `https://www.pocketlink.store`. Never a preview URL —
a reviewer has no Vercel account and would hit Deployment Protection.

**Objective: Traffic only.** Pick "Get more store visitors" every time. The
"Get more orders" path is the Sales objective and has never been validated
end-to-end; showing it risks a second rejection on something we cannot vouch
for.

---

## Before you record

### 1. The connection has to be re-granted, and that carries a risk

Shots 2–3 show a seller granting Meta access. `showme` is already connected, so
there is nothing to film unless you disconnect first.

The risk: `ads_management` was **rejected**, so it is only available because the
app is in Development mode, where app admins receive every permission. If a
reconnect fails to re-grant it, campaign creation stops working.

**Do a rehearsal run first — do not film it:**

1. Manage → Settings → **Disconnect** Meta
2. Manage → Settings → **Connect Meta**, complete the dialog
3. Choose the Facebook Page, then ad account `act_962613363265198`
4. Ads tab → Create campaign → **Get more store visitors** → plan screen

If the green button reads **"Create paused campaign in Meta"**, the permission
survived and you are safe to film. If anything errors, **stop and report it** —
do not record a broken flow.

Then disconnect once more so the real take starts clean.

### 2. Check the rest

- [ ] `META_PAUSED_ONLY=true` on Production — activation is refused server-side,
      so nothing can spend even by accident
- [ ] Signed out of `/console` in this browser. If the Ads tab sees a `crm_team`
      admin session it renders the staff control, and a reviewer seeing a staff
      path is the exact finding we were rejected for
- [ ] Phone or desktop both fine — the flow is confirmed working on both
- [ ] Screen recorder set to English system language, notifications silenced

---

## Shot 1 — the seller opens their shop (0:00–0:20)

Show `pocketlink.store/showme/manage`, then the PIN screen. Type **2580**.

> "This is PocketLink. Small shops in India use it to sell over WhatsApp. This
> is a real seller's dashboard — they open it with a four-digit PIN. There is no
> email account; sellers register with their WhatsApp number."

**Caption:** `Seller signs in to their PocketLink dashboard`

Linger a beat on the dashboard so the reviewer sees a real store — products,
orders, a working business.

## Shot 2 — starting the connection (0:20–0:35)

Settings tab → **Connect Meta**.

> "To advertise, the seller connects their own Facebook account. PocketLink
> never asks for a password — this hands off to Meta."

**Caption:** `Seller chooses to connect their Meta account`

## Shot 3 — consent (0:35–1:05) ← *the shot that was missing*

The Facebook Login for Business dialog. **Hold on the permissions screen long
enough to read every line** — four or five seconds minimum. Then Continue.

> "Meta asks the seller to confirm which business assets PocketLink may use, and
> which permissions to grant. The seller approves this themselves. PocketLink
> receives a system-user token from this step, and every later call to the
> Marketing API is made server-to-server from our backend."

**Caption:** `The seller grants access. This issues a system-user token — all
later Marketing API calls are server-to-server.`

This caption is the whole point. Meta's feedback asked apps using system-user
tokens to say so, because the frontend login is otherwise not visible. Note the
timestamp where this caption appears — it goes into the submission notes.

## Shot 4 — choosing the assets (1:05–1:25)

Back in PocketLink: pick the Facebook Page, then the ad account
`act_962613363265198`.

> "The seller picks which Facebook Page to advertise from and which ad account
> to use. PocketLink validates both against what Meta actually granted, so a
> store can never point at an account it was not given."

**Caption:** `Seller selects their Page and ad account`

## Shot 5 — starting a campaign (1:25–1:40)

Ads tab → **Create campaign** → **Get more store visitors**.

> "Shop owners here have no marketing team, and Ads Manager is far beyond what
> they can operate. So PocketLink asks a plain question: what do you want? This
> seller wants more people visiting their shop."

**Caption:** `Goal in plain language — not Meta terminology`

## Shot 6 — the plan (1:40–2:15)

Scroll the plan screen slowly. Pause on the product card, the audience row, the
budget row.

> "PocketLink builds the whole campaign from what the shop already has — the
> product, its photo, its price, the seller's city. Every choice is explained in
> the seller's own language: who it reaches, what it optimises for, what it
> costs. Nothing has been sent to Meta yet."

**Caption:** `PocketLink builds the campaign from the seller's own catalogue`

Optionally tap **Advanced controls** open for a second to show the detail is
available, then close it.

## Shot 7 — creating it (2:15–2:35)

Tap **Create paused campaign in Meta**. Wait for the result.

> "When the seller approves, PocketLink creates the campaign, ad set, creative
> and ad through the Marketing API. Everything is created paused. PocketLink
> then reads the status back from Meta to confirm nothing is live, and shows the
> real object IDs."

**Caption:** `Campaign, ad set, creative and ad created — all PAUSED`

Hold on the returned IDs long enough to read them.

## Shot 8 — proof in Meta (2:35–2:55) ← *the other missing shot*

Cut to **Meta Ads Manager**, same ad account. Show the campaign that just
appeared, with status **Paused**.

> "Here is that campaign in the seller's own Meta Ads Manager, created by
> PocketLink moments ago, paused and not spending."

**Caption:** `The same campaign in Meta Ads Manager — status Paused`

This is what "end-to-end" means to a reviewer: proof the API call had a real
effect. Do not skip it.

## Shot 9 — reporting (2:55–3:15)

Back to the PocketLink Ads tab.

> "Performance comes straight back from Meta into the seller's dashboard —
> spend, reach, clicks — next to the orders PocketLink already knows about. The
> shop owner never has to open Ads Manager."

**Caption:** `Results reported back in the seller's dashboard`

---

## After recording

- [ ] Watch it once as though you were the reviewer. Is the consent screen
      readable? Is the Ads Manager shot unmistakable?
- [ ] Every caption legible at the size Meta plays it
- [ ] No `/console`, no staff screens, no email login anywhere in frame
- [ ] No "Get more orders" / Sales objective anywhere in frame
- [ ] Note the timestamp of the shot 3 caption
- [ ] Leave the created campaign **paused** in the account. A reviewer may look.

## Then submit

Use the submission notes in [meta-app-review.md](meta-app-review.md). Fill in
the shot 3 timestamp where the system-user-token paragraph refers to it.

**Submit `ads_management` only.** The Marketing API Access Tier is a separate
request that needs ~500 Marketing API calls over 15 days — bundling them means
one failure sinks both again, which is what happened last time.

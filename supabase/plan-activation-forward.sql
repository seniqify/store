-- ===========================================================================
--  Phase 3C, PR 2  --  SERVER-AUTHORITATIVE ENTITLEMENT WRITER
--
--  Adds two evidence columns to the ledger and the one function that is allowed
--  to grant an entitlement and project it into stores.config -- atomically, in
--  a single transaction, from values the server derived.
--
--  THIS PR DOES NOT CUT OVER.
--    * upgrade_store_plan is NOT modified and NOT re-granted. It stays
--      SECURITY DEFINER with EXECUTE to anon, exactly as it is in production
--      today, so the live signup path keeps working until PR 3/PR 4.
--    * THE BILLING BYPASS IS STILL OPEN. Anyone can still call
--      upgrade_store_plan and set any store to any plan. This PR builds the
--      replacement authority. It does not remove the old one.
--    * pending_signups is untouched. A paid signup with no store yet still
--      goes down the existing path -- apply_plan_entitlement writes nothing
--      and reports store_not_found.
--    * razorpay-webhook behaviour is unchanged. It is the obvious second
--      caller of this function and the idempotency identity was designed so
--      that it and the browser path collapse to one row, but switching it
--      changes every renewal in production and gets its own PR.
--
--  RUN: Supabase Dashboard -> SQL Editor -> paste -> Run. Idempotent.
--  VERIFY (before AND after): supabase/plan-activation-verify.sql
--  UNDO: supabase/plan-activation-ROLLBACK.sql
--
--  ---------------------------------------------------------------------------
--  DANGEROUS DEFAULTS IN THIS PROJECT -- read before editing section 3
--
--  Default privileges in schema public grant, on EVERY newly created object:
--
--    type=r (tables)    anon=arwdDxtm  authenticated=arwdDxtm
--    type=f (FUNCTIONS) anon=X         authenticated=X
--
--  So a new function here is EXECUTE-granted to anon the moment it is created.
--  That is not a hypothetical: it is exactly how upgrade_store_plan came to be
--  anon-callable, which is the vulnerability this whole phase exists to close.
--  The REVOKE in section 3 is load-bearing and runs in the same transaction as
--  the CREATE, so the function is never briefly callable by a browser.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Two evidence columns
--
-- Column rule, same as PR 1: a column ships in the PR that first writes it.
--
--   razorpay_payment_id  The specific captured charge that produced this grant.
--                        Needed to reconcile a disputed entitlement against
--                        Razorpay, and to answer "which payment paid for this".
--                        Nullable: the webhook's subscription.activated event
--                        carries no payment entity, and that path is a valid
--                        future writer.
--
--   razorpay_plan_id     The Razorpay plan the mandate bills against. This is
--                        the AMOUNT evidence: plan_id determines what was
--                        actually debited, and it is the only input this
--                        writer uses to decide which PocketLink plan was
--                        bought. Recording it makes every grant auditable
--                        against the money that moved.
--
-- source_reference is still NOT added: subscription id, payment id and plan id
-- are the references this writer has, and a generic catch-all column would
-- just be somewhere unvalidated data accumulates. No metadata column either.
-- ---------------------------------------------------------------------------
alter table public.plan_entitlements add column if not exists razorpay_payment_id text;
alter table public.plan_entitlements add column if not exists razorpay_plan_id    text;

comment on column public.plan_entitlements.razorpay_payment_id is
  'The captured Razorpay payment that produced this grant, when one is known.';
comment on column public.plan_entitlements.razorpay_plan_id is
  'The Razorpay plan_id the mandate bills against - the amount evidence behind the granted plan.';

-- A Razorpay-sourced grant must carry the evidence that justifies it. The 36
-- migration_backfill rows are unaffected: they are not a razorpay source.
do $add_checks$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.plan_entitlements'::regclass
                    and conname = 'plan_entitlements_subscription_evidence') then
    alter table public.plan_entitlements
      add constraint plan_entitlements_subscription_evidence check (
        source <> 'razorpay_subscription'
        or (razorpay_subscription_id is not null and razorpay_plan_id is not null)
      );
  end if;
end;
$add_checks$;

-- ---------------------------------------------------------------------------
-- 2. The writer
--
-- SECURITY INVOKER, on purpose. service_role already holds INSERT/SELECT on
-- plan_entitlements and SELECT/UPDATE on stores, and it bypasses RLS, so
-- DEFINER would buy nothing and would turn a leaked EXECUTE grant into a
-- privilege escalation. This matches create_order_secure from phase 2.
--
-- search_path is pinned with pg_temp last so no temporary relation can shadow
-- public.stores or public.plan_entitlements mid-transaction.
--
-- IT ACCEPTS NO BROWSER CLAIMS. Every argument is a value the caller derived
-- from a Razorpay entity it fetched itself. In particular there is no
-- p_store_slug: the store is resolved IN HERE, from the owner phone recorded
-- on the subscription, under the same lock that guards the projection.
--
-- Returns jsonb rather than raising, so the caller can distinguish
-- "not applicable" (no store yet) from "refused" without parsing an error.
-- ---------------------------------------------------------------------------
create or replace function public.apply_plan_entitlement(
  p_owner_phone_last10 text,
  p_plan               text,
  p_source             text,
  p_starts_at          timestamptz,
  p_expires_at         timestamptz,
  p_subscription_id    text,
  p_payment_id         text,
  p_razorpay_plan_id   text,
  p_idempotency_key    text,
  p_verified_at        timestamptz
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = public, pg_temp
as $function$
declare
  v_slug        text;
  v_matches     integer;
  v_cfg         jsonb;
  v_created     boolean := false;
  v_enriched    boolean := false;
  v_conflict    text[];
  v_existing    public.plan_entitlements%rowtype;
  v_cur_expiry  timestamptz;
  v_new_expiry  timestamptz;
  v_projected   boolean := false;
begin
  -- -- input sanity. These are server-derived, so a failure here is a bug in
  -- -- the caller, not a hostile request -- but the ledger is not the place to
  -- -- find that out.
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    return jsonb_build_object('ok', false, 'reason', 'idempotency_key_required');
  end if;
  if p_plan is null or p_source is null or p_verified_at is null then
    return jsonb_build_object('ok', false, 'reason', 'incomplete_grant');
  end if;
  if p_owner_phone_last10 is null or length(p_owner_phone_last10) <> 10 then
    return jsonb_build_object('ok', false, 'reason', 'owner_unresolved');
  end if;

  -- -- 1. resolve the store, and LOCK it.
  -- --
  -- -- The lock is taken before the ledger insert so that every caller takes
  -- -- the same locks in the same order (store, then ledger) and two concurrent
  -- -- activations cannot deadlock against each other.
  -- --
  -- -- Ambiguity is refused rather than resolved arbitrarily. The webhook picks
  -- -- the first match with limit 1; production currently has zero duplicate
  -- -- WhatsApp numbers, and if that ever changes, silently granting to one of
  -- -- them is worse than refusing and being told about it.
  select count(*) into v_matches
    from public.stores s
   where right(regexp_replace(coalesce(s.config->>'whatsappNumber', ''), '\D', '', 'g'), 10)
         = p_owner_phone_last10;

  if v_matches = 0 then
    -- Not an error: this is the "paid before building the store" case, which
    -- the existing pending_signups path still handles. Nothing is written.
    return jsonb_build_object('ok', true, 'activated', false, 'reason', 'store_not_found');
  end if;

  if v_matches > 1 then
    return jsonb_build_object('ok', false, 'reason', 'owner_ambiguous');
  end if;

  select s.slug, s.config into v_slug, v_cfg
    from public.stores s
   where right(regexp_replace(coalesce(s.config->>'whatsappNumber', ''), '\D', '', 'g'), 10)
         = p_owner_phone_last10
   for update;

  -- -- 2. claim the cycle. One row per subscription per billing cycle.
  insert into public.plan_entitlements (
    store_slug, plan, source, status, starts_at, expires_at,
    razorpay_subscription_id, razorpay_payment_id, razorpay_plan_id,
    idempotency_key, verified_at
  )
  values (
    v_slug, p_plan, p_source, 'active', p_starts_at, p_expires_at,
    p_subscription_id, p_payment_id, p_razorpay_plan_id,
    p_idempotency_key, p_verified_at
  )
  on conflict (idempotency_key) do nothing;

  get diagnostics v_matches = row_count;
  v_created := v_matches = 1;

  -- -- 3. a replay must agree with the WHOLE authoritative grant, not part of it.
  -- --
  -- -- If the key is already present this is a retry: the same request twice,
  -- -- or the webhook and the browser racing for one charge. That must be a
  -- -- no-op. But a reused key carrying a DIFFERENT grant is a contradiction,
  -- -- and projecting either version would be guessing.
  -- --
  -- -- EVERY security-relevant field is compared, because the projection below
  -- -- uses the INCOMING values: comparing only some of them would let a retry
  -- -- skip the insert and still move stores.config to a different expiry.
  -- --
  -- --   store_slug, plan, source          who and what
  -- --   razorpay_subscription_id          which mandate
  -- --   razorpay_plan_id                  which price -- the amount evidence
  -- --   starts_at, expires_at             the window being granted
  -- --
  -- -- verified_at is deliberately NOT compared. It records when a server
  -- -- checked the proof, not what was granted, and it legitimately differs
  -- -- between the first write and a later retry.
  -- --
  -- -- razorpay_payment_id has its own rule, because the two future writers for
  -- -- one cycle do not both know it:
  -- --
  -- --   stored     incoming    outcome
  -- --   ---------  ----------  ---------------------------------------------
  -- --   X          X           compatible
  -- --   X          NULL        compatible, the stored id is KEPT (the webhook
  -- --                          replaying subscription.activated after the
  -- --                          browser already recorded the charge)
  -- --   NULL       X           compatible, and ENRICHED in place (the webhook
  -- --                          claimed the cycle first, the browser now
  -- --                          supplies the charge it was paid by)
  -- --   X          Y  (X<>Y)   CONFLICT - two different payments cannot have
  -- --                          paid for the same cycle
  -- --
  -- -- Enrichment is safe because the payment id is audit evidence only: it
  -- -- feeds no decision here -- plan, window and store all come from the
  -- -- subscription entity. It is strictly one-way, NULL -> value, so it can
  -- -- never rewrite authority and concurrent enrichment converges.
  if not v_created then
    select * into v_existing
      from public.plan_entitlements
     where idempotency_key = p_idempotency_key
     for update;

    v_conflict := array_remove(array[
      case when v_existing.store_slug               is distinct from v_slug              then 'store_slug'               end,
      case when v_existing.plan                     is distinct from p_plan              then 'plan'                     end,
      case when v_existing.source                   is distinct from p_source            then 'source'                   end,
      case when v_existing.razorpay_subscription_id is distinct from p_subscription_id   then 'razorpay_subscription_id' end,
      case when v_existing.razorpay_plan_id         is distinct from p_razorpay_plan_id  then 'razorpay_plan_id'         end,
      case when v_existing.starts_at                is distinct from p_starts_at         then 'starts_at'                end,
      case when v_existing.expires_at               is distinct from p_expires_at        then 'expires_at'               end,
      case when v_existing.razorpay_payment_id is not null and p_payment_id is not null
            and v_existing.razorpay_payment_id <> p_payment_id                           then 'razorpay_payment_id'     end
    ], null);

    if array_length(v_conflict, 1) > 0 then
      -- Nothing is written. stores.config is NOT touched, and the stored
      -- entitlement is left exactly as it was.
      return jsonb_build_object(
        'ok', false,
        'reason', 'idempotency_conflict',
        'conflict_on', to_jsonb(v_conflict),
        'store_slug', v_existing.store_slug);
    end if;

    if v_existing.razorpay_payment_id is null and p_payment_id is not null then
      update public.plan_entitlements
         set razorpay_payment_id = p_payment_id,
             updated_at = now()
       where idempotency_key = p_idempotency_key
         and razorpay_payment_id is null;
      v_enriched := true;
    end if;
  end if;

  -- -- 4. project into stores.config, the application's read model.
  -- --
  -- -- Same transaction, same lock, so the ledger and the projection can never
  -- -- disagree: either both land or neither does.
  -- --
  -- -- The projection NEVER REDUCES an entitlement:
  -- --   * a store with no planExpiresAt is entitled indefinitely under
  -- --     effectivePlan(), so its expiry is left alone rather than replaced
  -- --     with a dated one
  -- --   * otherwise the expiry only ever moves forward, so an out-of-order
  -- --     replay of an older cycle cannot shorten a paid term
  -- -- plan and razorpaySubscriptionId are set from the verified grant.
  v_cur_expiry := case
    when jsonb_typeof(v_cfg->'planExpiresAt') = 'string' and v_cfg->>'planExpiresAt' <> ''
    then (v_cfg->>'planExpiresAt')::timestamptz
  end;

  if coalesce(v_cfg->>'plan', 'free') <> 'free' and v_cur_expiry is null then
    v_new_expiry := null;                       -- already indefinite: leave it
  elsif v_cur_expiry is null then
    v_new_expiry := p_expires_at;               -- free store being activated
  else
    v_new_expiry := greatest(v_cur_expiry, p_expires_at);
  end if;

  update public.stores s
     set config = s.config || jsonb_build_object(
                    'plan', to_jsonb(p_plan),
                    'planExpiresAt', case when v_new_expiry is null
                                          then s.config->'planExpiresAt'
                                          else to_jsonb(to_char(v_new_expiry at time zone 'UTC',
                                                'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) end,
                    'razorpaySubscriptionId', case when p_subscription_id is null
                                                   then s.config->'razorpaySubscriptionId'
                                                   else to_jsonb(p_subscription_id) end
                  ),
         updated_at = now()
   where s.slug = v_slug;

  get diagnostics v_matches = row_count;
  v_projected := v_matches = 1;

  return jsonb_build_object(
    'ok',         true,
    'activated',  true,
    'created',    v_created,
    'enriched',   v_enriched,
    'store_slug', v_slug,
    'plan',       p_plan,
    'expires_at', v_new_expiry,
    'projected',  v_projected
  );
end;
$function$;

comment on function public.apply_plan_entitlement(text, text, text, timestamptz, timestamptz,
                                                  text, text, text, text, timestamptz) is
  'Phase 3C PR 2 - the only server-authoritative entitlement writer. service_role only. Accepts no browser claims: the store is resolved here and the projection is atomic with the ledger write.';

-- ---------------------------------------------------------------------------
-- 3. Who may call it  (read the header before changing this)
--
-- The schema default grants EXECUTE on every new function to anon and
-- authenticated. Without this REVOKE the browser could call the entitlement
-- writer directly -- which would be a worse hole than the one this phase is
-- closing, because it would come with a verified_at timestamp attached.
-- ---------------------------------------------------------------------------
revoke all on function public.apply_plan_entitlement(text, text, text, timestamptz, timestamptz,
                                                     text, text, text, text, timestamptz)
  from public, anon, authenticated;

grant execute on function public.apply_plan_entitlement(text, text, text, timestamptz, timestamptz,
                                                        text, text, text, text, timestamptz)
  to service_role;

commit;

-- ===========================================================================
--  AFTER RUNNING
--
--  Re-run supabase/plan-activation-verify.sql and compare with the baseline.
--  Required:
--    * B1 stores plan fingerprint IDENTICAL -- this migration writes no store
--    * B2/B3 upgrade_store_plan source and grants IDENTICAL, anon still there
--    * B6 pending_signups IDENTICAL
--    * L1 the 36 migration_backfill rows unchanged, still 36, still unverified
--    * W1..W4 the writer exists, is INVOKER, is pinned, and anon and
--      authenticated cannot execute it
--
--  Nothing to deploy for the SQL. The plan-activate edge function is deployed
--  separately and is called by nothing until PR 3.
-- ===========================================================================

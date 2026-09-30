-- ===========================================================================
--  Custom merchant domains -- PR-B.1  --  UNDO
--
--  Returns the database to exactly the reviewed PR-B state:
--    * drops the seven domain_leased_* gateways, domain_reconcile_lease,
--      domain_group_lease, domain_group_lease_release, the internal lease
--      check, the three constants and the store_domain_reconcile table;
--    * grants service_role EXECUTE on the seven PR-B functions again -- the
--      same grant lines as supabase/custom-domains-forward.sql, section 7.
--  PR-B.1 never replaced or altered a PR-B function, table, trigger, index or
--  constraint, so there is nothing else to restore.
--
--  ONLY AFTER the PR-C code that calls these functions has been reverted:
--  without them, every custom-domain write fails (safely -- it fails closed,
--  changing nothing -- but merchants and the reconciler stop working).
--
--  Refuses while any lease is still live (a request or a pass may be
--  mid-work); wait two minutes and re-run.
--
--  RUN: Supabase SQL Editor, paste all, Run. One transaction; idempotent.
-- ===========================================================================

begin;

set local lock_timeout = '5s';

do $preflight$
declare
  v_live integer := 0;
begin
  if to_regclass('public.store_domain_reconcile') is not null then
    execute 'select count(*) from public.store_domain_reconcile where lease_until > now()' into v_live;
    if v_live > 0 then
      raise exception 'refusing to run: % lease(s) still live; wait two minutes and re-run', v_live;
    end if;
  end if;
end
$preflight$;

drop function if exists public.domain_leased_vercel_intent(uuid, uuid, text, text, text);
drop function if exists public.domain_leased_vercel_observe(uuid, uuid, text, text, boolean, boolean, boolean, text);
drop function if exists public.domain_leased_mark_ready(uuid, uuid, text);
drop function if exists public.domain_leased_activate(uuid, uuid, text, text, uuid, text);
drop function if exists public.domain_leased_begin_disconnect(uuid, uuid, text, text, uuid, text);
drop function if exists public.domain_leased_finish_disconnect(uuid, uuid, text);
drop function if exists public.domain_leased_health_update(uuid, uuid, text, boolean, text);
drop function if exists public.domain_reconcile_lease(integer);
drop function if exists public.domain_group_lease(uuid, text);
drop function if exists public.domain_group_lease_release(uuid, text, uuid);
drop function if exists public.store_domain_lease_refusal(uuid, text, uuid);
drop table if exists public.store_domain_reconcile;
drop function if exists public.store_domain_health_interval();
drop function if exists public.store_domain_lease_seconds();
drop function if exists public.store_domain_lease_batch_max();

-- PR-B's grants, verbatim (custom-domains-forward.sql, section 7).
grant execute on function public.domain_vercel_intent(uuid, text, text, text)          to service_role;
grant execute on function public.domain_vercel_observe(uuid, text, text, boolean, boolean, boolean, text)
  to service_role;
grant execute on function public.domain_mark_ready(uuid, text)                         to service_role;
grant execute on function public.domain_activate(uuid, text, text, uuid, text)         to service_role;
grant execute on function public.domain_begin_disconnect(uuid, text, text, uuid, text) to service_role;
grant execute on function public.domain_finish_disconnect(uuid, text)                  to service_role;
grant execute on function public.domain_health_update(uuid, text, boolean, text)       to service_role;

commit;

-- Next: supabase/custom-domains-lease-verify.sql -- P1 PASS, P2 PASS, L rows N/A;
-- and supabase/custom-domains-verify.sql -- V10 PASS again.

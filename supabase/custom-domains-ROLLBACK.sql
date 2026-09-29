-- ===========================================================================
--  Custom merchant domains -- PR-B  --  UNDO
--
--  Drops the three tables and the 24 functions PR-B created. Nothing else.
--  public.stores is not touched: dropping store_domains / challenges / events
--  removes the internal FK triggers their REFERENCES added, which is the only
--  trace PR-B left on it.
--
--  CLEAN WHILE NOTHING USES IT, which is the state PR-B leaves the product
--  in: no code calls any of these functions, so dropping them changes no
--  behaviour.
--
--  IT STOPS BEING A CLEAN UNDO ONCE PR-C / PR-D ARE LIVE:
--   * the tables then hold claims, TXT tokens and the audit trail, and this
--     script DESTROYS them;
--   * with PR-D's routing deployed, dropping resolve_store_host makes every
--     custom domain fail closed (the "not connected" page). pocketlink.store
--     itself keeps working -- it never depended on any of this.
--  So after PR-C: redeploy the previous site/functions FIRST, confirm, and
--  only then remove the guard below on purpose.
--
--  The guard refuses while any row exists in any of the three tables. That is
--  evidence, not proof, that the feature is in use -- the operator instruction
--  above is the real control.
--
--  RUN: Supabase Dashboard -> SQL Editor -> paste all -> Run. Idempotent.
-- ===========================================================================

begin;

set local lock_timeout = '5s';

do $preflight$
declare
  v_rows bigint := 0;
  v_n    bigint;
begin
  if to_regclass('public.store_domains') is not null then
    execute 'select count(*) from public.store_domains' into v_n;
    v_rows := v_rows + v_n;
  end if;
  if to_regclass('public.store_domain_challenges') is not null then
    execute 'select count(*) from public.store_domain_challenges' into v_n;
    v_rows := v_rows + v_n;
  end if;
  if to_regclass('public.store_domain_events') is not null then
    execute 'select count(*) from public.store_domain_events' into v_n;
    v_rows := v_rows + v_n;
  end if;
  if v_rows > 0 then
    raise exception
      'refusing to run: % custom-domain row(s) exist, so PR-C is (or was) live. Redeploy the previous code first; dropping these tables destroys claims, tokens and the audit trail.',
      v_rows;
  end if;
end
$preflight$;

-- RPCs first (nothing depends on them).
drop function if exists public.resolve_store_host(text);
drop function if exists public.store_primary_host(text);
drop function if exists public.domain_claim(text, text, text);
drop function if exists public.domain_mark_verified(uuid, text, text);
drop function if exists public.domain_vercel_intent(uuid, text, text, text);
drop function if exists public.domain_vercel_observe(uuid, text, text, boolean, boolean, boolean, text);
drop function if exists public.domain_mark_ready(uuid, text);
drop function if exists public.domain_challenge_create(text, uuid, text, text, text);
drop function if exists public.domain_activate(uuid, text, text, uuid, text);
drop function if exists public.domain_set_primary(uuid, text, text, uuid, text);
drop function if exists public.domain_begin_disconnect(uuid, text, text, uuid, text);
drop function if exists public.domain_finish_disconnect(uuid, text);
drop function if exists public.domain_expire_stale(integer);
drop function if exists public.domain_health_update(uuid, text, boolean, text);
drop function if exists public.domain_event_append(uuid, text, text, text, jsonb);
drop function if exists public.store_domain_consume_challenge(uuid, text, uuid, text, text, text);
drop function if exists public.store_domain_expire_if_stale(uuid);
drop function if exists public.store_domain_vercel_clear(uuid);
drop function if exists public.store_domain_log(uuid, text, text, text, jsonb);

-- Tables (their triggers, indexes, constraints and FK triggers go with them).
drop table if exists public.store_domain_events;
drop table if exists public.store_domain_challenges;
drop table if exists public.store_domains;

-- Last: the helpers the tables' CHECKs and triggers used.
drop function if exists public.store_domains_guard_update();
drop function if exists public.store_domains_check_group();
drop function if exists public.store_domain_events_append_only();
drop function if exists public.store_domain_hostname_problem(text);
drop function if exists public.store_domain_normalize(text);

commit;

-- ═══════════════════════════════════════════════════════════════════════════
--  Close the PIN-throttle bypasses — VERIFICATION
--
--  READ-ONLY. One single SELECT statement. No create, insert, update, delete,
--  grant, revoke, drop, alter, set role or temporary table. No transaction.
--  Safe to run on production before and after applying the migration.
--
--  Run it BEFORE applying too. The rows this migration changes (V1, V2.2, V3,
--  V4.1, V4.2, V4.4, V4.5) then read FAIL or CHECK — that is the current state
--  of production, and the point of running it. A few already read PASS before:
--  V2.1, V2.3, V4.3 (the ledger is locked) and V5.2 (still SECURITY DEFINER).
--
--  Every row must read PASS after applying, except the rows labelled (info).
-- ═══════════════════════════════════════════════════════════════════════════

with gated as (
  -- The eleven PIN-gated functions, plus reset_store_pin which is gated by OTP.
  -- provolatile is the one-byte "char" type; text || "char" is ambiguous, so
  -- cast it here once and every later use is plain text.
  select p.oid, p.proname::text as proname, p.prosrc, p.provolatile::text as provolatile, p.prosecdef,
         coalesce(array_to_string(p.proconfig, ', '), '') as cfg
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('delete_review','get_store_ai_searches','get_store_orders',
                       'get_store_reviews','get_store_whatsapp','new_orders_since',
                       'set_order_paid','set_review_status','set_store_whatsapp',
                       'update_order_status','update_store_config')
),
verifier as (
  select p.oid, p.prosrc, p.provolatile::text as provolatile,
         coalesce(array_to_string(p.proconfig, ', '), '') as cfg
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'verify_store_pin'
),
resetter as (
  select p.oid, p.prosrc,
         coalesce(array_to_string(p.proconfig, ', '), '') as cfg
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'reset_store_pin'
)

-- ── V1  every gated function now goes through the throttle ──────────────────
select 'V1' as grp, 'V1.1 all eleven delegate to verify_store_pin' as check_name,
  case when (select count(*) from gated) <> 11
       then 'CHECK - found ' || (select count(*) from gated)::text || ' of 11, not the expected set'
       when not exists (select 1 from gated where prosrc not ilike '%verify_store_pin%')
       then 'PASS'
       else 'FAIL - still inline: ' ||
            (select string_agg(proname, ', ' order by proname)
               from gated where prosrc not ilike '%verify_store_pin%') end as result
union all
select 'V1', 'V1.2 no inline stores.pin comparison survives',
  case when not exists (
         select 1 from gated
          where prosrc ilike '%s.pin = p_hashed_pin%'
             or prosrc ilike '%pin = p_hashed_pin%')
       then 'PASS'
       else 'FAIL - still comparing the hash directly: ' ||
            (select string_agg(proname, ', ' order by proname) from gated
              where prosrc ilike '%pin = p_hashed_pin%') end
union all
select 'V1', 'V1.3 reset_store_pin throttles its OTP',
  coalesce((select case when prosrc ilike '%pin_attempts%' and prosrc ilike '%''otp''%'
                        then 'PASS' else 'FAIL - the OTP is still unlimited' end
              from resetter), 'FAIL - function not found')

-- ── V2  the check runs once, not per row ────────────────────────────────────
union all
select 'V2', 'V2.1 no gated function is still LANGUAGE sql with the check in a WHERE',
  -- A VOLATILE function in a row filter cannot be hoisted: get_store_orders
  -- would have recorded one attempt per row returned.
  case when not exists (
         select 1 from gated g
          where g.prosrc ilike '%and public.verify_store_pin%'
             or g.prosrc ilike '%and verify_store_pin%')
       then 'PASS' else 'FAIL - the call is inside a WHERE clause: ' ||
            (select string_agg(proname, ', ' order by proname) from gated
              where prosrc ilike '%and%verify_store_pin%') end
union all
select 'V2', 'V2.2 nothing that calls the verifier is still STABLE or IMMUTABLE',
  case when not exists (select 1 from gated where provolatile <> 'v')
       then 'PASS'
       else 'FAIL - cannot write an attempt row: ' ||
            (select string_agg(proname || ' (' || provolatile || ')', ', ' order by proname)
               from gated where provolatile <> 'v') end
union all
select 'V2', 'V2.3 verify_store_pin is still VOLATILE',
  coalesce((select case when provolatile = 'v' then 'PASS'
                        else 'FAIL - ' || provolatile || ', it cannot record anything' end
              from verifier), 'FAIL - function not found')

-- ── V3  search_path, with pg_temp named last ────────────────────────────────
union all
select 'V3', 'V3.1 every gated function pins search_path with pg_temp last',
  -- PostgreSQL searches the session temp schema FIRST, ahead of pg_catalog,
  -- whenever pg_temp is not named explicitly. `SET search_path TO 'public'`
  -- alone therefore leaves temp objects shadowing everything unqualified.
  case when not exists (select 1 from gated where cfg <> 'search_path=public, pg_temp')
       then 'PASS'
       else 'FAIL - ' || (select string_agg(proname || ' [' ||
                                 coalesce(nullif(cfg, ''), 'not pinned') || ']',
                                 '; ' order by proname)
                            from gated where cfg <> 'search_path=public, pg_temp') end
union all
select 'V3', 'V3.2 verify_store_pin and reset_store_pin pin it too',
  case when (select cfg from verifier) = 'search_path=public, pg_temp'
        and (select cfg from resetter) = 'search_path=public, pg_temp'
       then 'PASS'
       else 'FAIL - verifier [' || coalesce((select nullif(cfg,'') from verifier), 'not pinned') ||
            '] resetter [' || coalesce((select nullif(cfg,'') from resetter), 'not pinned') || ']' end

-- ── V4  the ledger ──────────────────────────────────────────────────────────
union all
select 'V4', 'V4.1 pin_attempts.kind exists',
  coalesce((select 'PASS - default ' || coalesce(column_default, 'none')
              from information_schema.columns
             where table_schema = 'public' and table_name = 'pin_attempts'
               and column_name = 'kind'),
           'FAIL - column missing, PIN and OTP share one budget')
union all
select 'V4', 'V4.2 kind is constrained to pin/otp',
  case when exists (select 1 from pg_constraint
                     where conrelid = 'public.pin_attempts'::regclass
                       and conname = 'pin_attempts_kind_known')
       then 'PASS' else 'FAIL' end
union all
select 'V4', 'V4.3 no client role can reach the ledger',
  case when not exists (
         select 1
           from unnest(array['anon','authenticated']) as r(role),
                unnest(array['select','insert','update','delete']) as v(verb)
          where has_table_privilege(r.role, 'public.pin_attempts', v.verb))
       then 'PASS' else 'FAIL - a client role can read or write the attempt ledger' end
union all
select 'V4', 'V4.4 verify_store_pin records failures only',
  coalesce((select case when prosrc ilike '%values (p_slug, v_ip, false, ''pin'')%'
                         and prosrc not ilike '%values (p_slug, v_ip, v_ok%'
                        then 'PASS - no write on the 15-second poll path'
                        else 'CHECK - it still writes a row on success' end
              from verifier), 'FAIL - function not found')
union all
select 'V4', 'V4.5 a correct PIN does not wipe failed attempts',
  -- new_orders_since polls every 15 seconds. A clear-on-success there would
  -- reset an attacker's count four times a minute while the seller is online.
  coalesce((select case when prosrc ilike '%delete from public.pin_attempts%not success%'
                        then 'FAIL - a correct PIN still clears the failure count'
                        else 'PASS' end
              from verifier), 'FAIL - function not found')

-- ── V5  nothing about access changed ────────────────────────────────────────
-- These MUST stay YES. PocketLink merchants have no login: the Manage dashboard
-- runs as anon and the PIN is the gate. Revoking here would break every seller.
union all
select 'V5', 'V5.1 (info) anon can still execute all eleven, as it must',
  (select string_agg(proname || '=' ||
            case when has_function_privilege('anon', oid, 'execute') then 'yes' else 'NO' end,
            ', ' order by proname) from gated)
union all
select 'V5', 'V5.2 every gated function is still SECURITY DEFINER',
  case when not exists (select 1 from gated where not prosecdef)
       then 'PASS' else 'FAIL - one became invoker and will fail at runtime' end

-- ── V6  what the ledger currently holds ─────────────────────────────────────
union all
select 'V6', 'V6.1 (info) failures in the last 15 minutes, by kind',
  -- to_jsonb(p)->>'kind', never a bare `kind`: that column only exists AFTER the
  -- migration, and naming it directly would abort the baseline run with
  -- "column kind does not exist" before a single row came back.
  coalesce((select string_agg(k || ': ' || n::text, ', ' order by k)
              from (select coalesce(to_jsonb(p) ->> 'kind', 'pin (no kind column yet)') as k,
                           count(*) as n
                      from public.pin_attempts p
                     where not p.success and p.attempted_at > now() - interval '15 minutes'
                     group by 1) s), 'none')
union all
select 'V6', 'V6.2 (info) total rows in the ledger',
  (select count(*)::text from public.pin_attempts)
union all
select 'V6', 'V6.3 (info) stores with any failed attempt in the last 24 hours',
  coalesce((select string_agg(slug || ' x' || n::text, ', ' order by n desc)
              from (select slug, count(*) as n from public.pin_attempts
                     where not success and attempted_at > now() - interval '24 hours'
                     group by slug order by count(*) desc limit 10) s),
           'none - no one is currently guessing')

order by grp, check_name;

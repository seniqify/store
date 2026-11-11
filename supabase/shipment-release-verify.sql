-- Verifier for shipment-release-forward.sql. READ-ONLY: one SELECT.
-- After the forward: every C row PASS (I rows are information).

select 'C1' as grp, 'C1 release_unsent_attempt exists, SECURITY DEFINER, search_path public, pg_temp' as check_name,
  case when exists (select 1 from pg_proc p
                     where p.oid = to_regprocedure('public.release_unsent_attempt(text,uuid,bigint,timestamptz,text)')
                       and p.prosecdef
                       and array_to_string(p.proconfig, ',') = 'search_path=public, pg_temp')
       then 'PASS' else 'FAIL' end as result
union all
select 'C2', 'C2 only the service role can call it (not the browser)',
  case when to_regprocedure('public.release_unsent_attempt(text,uuid,bigint,timestamptz,text)') is not null
        and not has_function_privilege('anon', 'public.release_unsent_attempt(text,uuid,bigint,timestamptz,text)', 'EXECUTE')
        and not has_function_privilege('authenticated', 'public.release_unsent_attempt(text,uuid,bigint,timestamptz,text)', 'EXECUTE')
        and has_function_privilege('service_role', 'public.release_unsent_attempt(text,uuid,bigint,timestamptz,text)', 'EXECUTE')
       then 'PASS' else 'FAIL' end
union all
select 'C3', 'C3 it locks the order row, matches claimed_at exactly and waits 10 quiet minutes',
  case when (select count(*) from pg_proc p
              where p.oid = to_regprocedure('public.release_unsent_attempt(text,uuid,bigint,timestamptz,text)')
                and p.prosrc like '%for update;%'
                and p.prosrc like '%a.claimed_at <> p_claimed_at%'
                and p.prosrc like '%interval ''10 minutes''%') = 1
       then 'PASS' else 'FAIL' end
union all
select 'C4', 'C4 read_open_attempt exists and only the service role can call it',
  case when to_regprocedure('public.read_open_attempt(text,uuid,bigint)') is not null
        and not has_function_privilege('anon', 'public.read_open_attempt(text,uuid,bigint)', 'EXECUTE')
        and not has_function_privilege('authenticated', 'public.read_open_attempt(text,uuid,bigint)', 'EXECUTE')
        and has_function_privilege('service_role', 'public.read_open_attempt(text,uuid,bigint)', 'EXECUTE')
       then 'PASS' else 'FAIL' end
union all
select 'I1', 'I1 orders locked right now by an unconfirmed booking (open, no AWB): Shadowfax / Delhivery',
  (select count(*) from public.shipment_attempts where end_reason is null and awb is null and courier = 'shadowfax')::text
  || ' / ' ||
  (select count(*) from public.shipment_attempts where end_reason is null and awb is null and courier = 'delhivery')::text;

-- Verifier for shipment-resume-forward.sql. READ-ONLY: one SELECT.
-- After the forward: every C row PASS (I rows are information).

select 'C1' as grp, 'C1 resume_shipment_attempt exists, SECURITY DEFINER, search_path public, pg_temp' as check_name,
  case when exists (select 1 from pg_proc p
                     where p.oid = to_regprocedure('public.resume_shipment_attempt(text,uuid,text)')
                       and p.prosecdef
                       and array_to_string(p.proconfig, ',') = 'search_path=public, pg_temp')
       then 'PASS' else 'FAIL' end as result
union all
select 'C2', 'C2 only the service role can call it (not the browser)',
  case when to_regprocedure('public.resume_shipment_attempt(text,uuid,text)') is not null
        and not has_function_privilege('anon', 'public.resume_shipment_attempt(text,uuid,text)', 'EXECUTE')
        and not has_function_privilege('authenticated', 'public.resume_shipment_attempt(text,uuid,text)', 'EXECUTE')
        and has_function_privilege('service_role', 'public.resume_shipment_attempt(text,uuid,text)', 'EXECUTE')
       then 'PASS' else 'FAIL' end
union all
select 'C3', 'C3 it locks the order row and waits 2 quiet minutes',
  case when (select count(*) from pg_proc p
              where p.oid = to_regprocedure('public.resume_shipment_attempt(text,uuid,text)')
                and p.prosrc like '%for update;%'
                and p.prosrc like '%interval ''2 minutes''%') = 1
       then 'PASS' else 'FAIL' end
union all
select 'I1', 'I1 orders locked right now by an unconfirmed booking (open, no AWB): Shadowfax / Delhivery',
  (select count(*) from public.shipment_attempts where end_reason is null and awb is null and courier = 'shadowfax')::text
  || ' / ' ||
  (select count(*) from public.shipment_attempts where end_reason is null and awb is null and courier = 'delhivery')::text;

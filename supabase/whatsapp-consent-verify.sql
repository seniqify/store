-- Verifier for whatsapp-consent-forward.sql. READ-ONLY: one SELECT.
-- After the forward: every C row PASS (I rows are information).

with latest as (
  select distinct on (store_slug, phone) store_slug, phone, granted
    from public.whatsapp_consents
   order by store_slug, phone, id desc
)
select 'C1' as grp, 'C1 whatsapp_consents exists with row level security on' as check_name,
  case when (select relrowsecurity from pg_class where oid = to_regclass('public.whatsapp_consents'))
       then 'PASS' else 'FAIL' end as result
union all
select 'C2', 'C2 the browser roles cannot read or write the table directly',
  case when not exists (
         select 1 from unnest(array['anon', 'authenticated']) r, unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p
          where has_table_privilege(r, 'public.whatsapp_consents', p))
       then 'PASS' else 'FAIL' end
union all
select 'C3', 'C3 the checkout can record a choice (anon EXECUTE on record_whatsapp_consent)',
  case when has_function_privilege('anon', 'public.record_whatsapp_consent(text,text,boolean,text)', 'EXECUTE')
       then 'PASS' else 'FAIL' end
union all
select 'C4', 'C4 only the server can ask whether a customer agreed (whatsapp_consent_granted is service_role only)',
  case when not has_function_privilege('anon', 'public.whatsapp_consent_granted(text,text)', 'EXECUTE')
        and not has_function_privilege('authenticated', 'public.whatsapp_consent_granted(text,text)', 'EXECUTE')
        and has_function_privilege('service_role', 'public.whatsapp_consent_granted(text,text)', 'EXECUTE')
       then 'PASS' else 'FAIL' end
union all
select 'C5', 'C5 both functions are SECURITY DEFINER with search_path public, pg_temp',
  case when (select count(*) from pg_proc p
              where p.oid in (to_regprocedure('public.record_whatsapp_consent(text,text,boolean,text)'),
                              to_regprocedure('public.whatsapp_consent_granted(text,text)'))
                and p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=public, pg_temp') = 2
       then 'PASS' else 'FAIL' end
union all
select 'I1', 'I1 customers who have agreed now / said no now / shops with any agreement',
  (select count(*) from latest where granted)::text || ' / ' ||
  (select count(*) from latest where not granted)::text || ' / ' ||
  (select count(distinct store_slug) from latest where granted)::text;

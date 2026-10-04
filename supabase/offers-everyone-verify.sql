-- Verifier for offers-everyone-forward.sql. READ-ONLY: one SELECT.
-- After the forward: every C row PASS (I rows are information).

with replaced(sig, new) as (
  values ('public.offer_audience(text,text,uuid,text[],jsonb)', '6de2710c9f26bb3fc87e66712c589ec2'),
         ('public.offer_claim(text,uuid,text,jsonb)',           '3b9ec7bace212a5f9315641c7d46a465'),
         ('public.seller_record_optout(text,text,text)',        '711db68335f6d4535a760d5c1a9d9198')
),
customers as (
  select distinct o.store_slug, o.customer_phone as phone
    from public.orders o
   where o.customer_phone ~ '^[6-9][0-9]{9}$'
)
select 'C1' as grp, 'C1 the three functions are the new versions' as check_name,
  case when (select count(*) from replaced r join pg_proc p on p.oid = to_regprocedure(r.sig)
              where md5(replace(p.prosrc, chr(13), '')) = r.new) = 3
       then 'PASS' else 'FAIL' end as result
union all
select 'C2', 'C2 offers check "asked to stop", not "ticked the box"',
  case when (select count(*) from pg_proc p
              where p.oid in (to_regprocedure('public.offer_audience(text,text,uuid,text[],jsonb)'),
                              to_regprocedure('public.offer_claim(text,uuid,text,jsonb)'),
                              to_regprocedure('public.seller_record_optout(text,text,text)'))
                and p.prosrc like '%whatsapp_opted_out(p_slug, %'
                and p.prosrc not like '%whatsapp_consent_granted%') = 3
       then 'PASS' else 'FAIL' end
union all
select 'C3', 'C3 still SECURITY DEFINER with search_path public, pg_temp',
  case when (select count(*) from replaced r join pg_proc p on p.oid = to_regprocedure(r.sig)
              where p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=public, pg_temp') = 3
       then 'PASS' else 'FAIL' end
union all
select 'C4', 'C4 the browser can check who gets it and record a stop, but cannot send',
  case when has_function_privilege('anon', 'public.offer_audience(text,text,uuid,text[],jsonb)', 'EXECUTE')
        and has_function_privilege('anon', 'public.seller_record_optout(text,text,text)', 'EXECUTE')
        and not has_function_privilege('anon', 'public.offer_claim(text,uuid,text,jsonb)', 'EXECUTE')
        and not has_function_privilege('authenticated', 'public.offer_claim(text,uuid,text,jsonb)', 'EXECUTE')
        and has_function_privilege('service_role', 'public.offer_claim(text,uuid,text,jsonb)', 'EXECUTE')
       then 'PASS' else 'FAIL' end
union all
select 'I1', 'I1 customers (shop + number) who can get offers: before (ticked the box) / now (did not ask to stop)',
  (select count(*) from customers c where public.whatsapp_consent_granted(c.store_slug, c.phone))::text || ' / ' ||
  (select count(*) from customers c where not public.whatsapp_opted_out(c.store_slug, c.phone))::text;

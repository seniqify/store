-- ===========================================================================
--  PocketLink India Post sheet  --  VERIFY (read-only). Every row should say PASS.
-- ===========================================================================
with f as (
  select p.oid, p.proname, p.proconfig, p.prosrc
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('indiapost_barcode_ok', 'indiapost_mark_shipped', 'indiapost_set_state')
)
select 'I1 three India Post functions, search_path pinned' as check_name,
       case when (select count(*) from f) = 3
             and not exists (select 1 from f where proconfig is null or not (proconfig::text like '%search_path=public, pg_temp%'))
            then 'PASS' else 'FAIL' end as result
union all
select 'I2 marking and setting a state check the owner PIN',
       case when not exists (select 1 from f where proname <> 'indiapost_barcode_ok' and prosrc not like '%verify_store_pin(p_slug, p_hashed_pin)%')
            then 'PASS' else 'FAIL' end
union all
select 'I3 the shop app may call the two actions; the barcode check stays inside',
       case when has_function_privilege('anon', (select oid from f where proname = 'indiapost_mark_shipped'), 'execute')
             and has_function_privilege('anon', (select oid from f where proname = 'indiapost_set_state'), 'execute')
             and not has_function_privilege('anon', (select oid from f where proname = 'indiapost_barcode_ok'), 'execute')
            then 'PASS' else 'FAIL' end
union all
select 'I4 the check digit: real barcodes pass, a wrong digit fails',
       case when public.indiapost_barcode_ok('EM744010014IN') and public.indiapost_barcode_ok('em744010028in')
             and not public.indiapost_barcode_ok('EM744010015IN') and not public.indiapost_barcode_ok('EM74401001IN')
            then 'PASS' else 'FAIL' end
union all
select 'I5 the shipped WhatsApp message names India Post; still service_role only',
       case when (select p.prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'ship_update_claim')
                 like '%when ''indiapost'' then ''India Post Speed Post''%'
             and not has_function_privilege('anon', 'public.ship_update_claim(uuid, text)', 'execute')
             and not has_function_privilege('authenticated', 'public.ship_update_claim(uuid, text)', 'execute')
            then 'PASS' else 'FAIL' end;

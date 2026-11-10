-- Verifier for whatsapp-coins-forward.sql. READ-ONLY: one SELECT.
-- After the forward: every C row PASS.

with server_only(sig) as (
  values ('public.order_message_free_limit()'),
         ('public.order_message_claim(uuid,text)'),
         ('public.order_message_finish(uuid,boolean,text)'),
         ('public.order_messages_expire_stuck()'),
         ('public.wallet_credit_topup(text,text,integer)')
)
select 'C1' as grp, 'C1 order_messages exists with row level security, closed to the browser' as check_name,
  case when exists (select 1 from pg_class c where c.oid = to_regclass('public.order_messages') and c.relrowsecurity)
        and not exists (select 1 from unnest(array['anon', 'authenticated']) r, unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p
                         where has_table_privilege(r, 'public.order_messages', p))
       then 'PASS' else 'FAIL' end as result
union all
select 'C2', 'C2 claim, finish, expire and the top-up credit are service_role only',
  case when (select count(*) from server_only where to_regprocedure(sig) is not null) = 5
        and not exists (select 1 from server_only, unnest(array['anon', 'authenticated']) r
                         where has_function_privilege(r, to_regprocedure(sig), 'EXECUTE'))
       then 'PASS' else 'FAIL' end
union all
select 'C3', 'C3 the usage read is PIN-checked and callable from the browser',
  case when has_function_privilege('anon', to_regprocedure('public.get_order_message_usage(text,text)'), 'EXECUTE')
        and (select p.prosrc ilike '%not public.verify_store_pin(p_slug, p_hashed_pin)%' from pg_proc p
              where p.oid = to_regprocedure('public.get_order_message_usage(text,text)'))
       then 'PASS' else 'FAIL' end
union all
select 'C4', 'C4 500 free a month',
  case when public.order_message_free_limit() = 500 then 'PASS' else 'FAIL' end
union all
select 'C5', 'C5 the top-up credit adds the bonus',
  case when (select p.prosrc ilike '%coalesce(v_topup.bonus_paise, 0)%' from pg_proc p
              where p.oid = to_regprocedure('public.wallet_credit_topup(text,text,integer)'))
        and exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'wallet_topups' and column_name = 'bonus_paise')
       then 'PASS' else 'FAIL' end
union all
select 'C6', 'C6 orders.confirm_msg exists',
  case when exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'orders' and column_name = 'confirm_msg')
       then 'PASS' else 'FAIL' end;

-- Verifier for cart-reminders-forward.sql. READ-ONLY: one SELECT.
-- After the forward: every C row PASS (I rows are information).

with server_only(sig) as (
  values ('public.cart_reminder_param(text,integer,text)'),
         ('public.cart_reminders_due(integer,timestamp with time zone)'),
         ('public.cart_reminder_claim(uuid)'),
         ('public.cart_reminder_finish(uuid,boolean,integer,text)'),
         ('public.cart_reminders_expire_stuck()')
),
browser(sig) as (
  values ('public.get_cart_reminder(text)'),
         ('public.set_cart_reminders(text,text,boolean)'),
         ('public.get_cart_reminder_summary(text,text)')
),
tabs(t) as (values ('public.store_message_settings'), ('public.cart_reminders'))
select 'C1' as grp, 'C1 both tables exist with row level security on' as check_name,
  case when (select count(*) from tabs join pg_class c on c.oid = to_regclass(tabs.t) where c.relrowsecurity) = 2
       then 'PASS' else 'FAIL' end as result
union all
select 'C2', 'C2 the browser roles cannot touch either table',
  case when (select count(*) from tabs where to_regclass(tabs.t) is not null) = 2
        and not exists (select 1 from tabs, unnest(array['anon', 'authenticated']) r, unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p
                         where has_table_privilege(r, tabs.t, p))
       then 'PASS' else 'FAIL' end
union all
select 'C3', 'C3 the sweep functions (list, claim, finish, expire, param) are service_role only',
  case when (select count(*) from server_only where to_regprocedure(sig) is not null) = 5
        and not exists (select 1 from server_only, unnest(array['anon', 'authenticated']) r
                         where has_function_privilege(r, to_regprocedure(sig), 'EXECUTE'))
        and not exists (select 1 from server_only, pg_proc p, aclexplode(p.proacl) x
                         where p.oid = to_regprocedure(server_only.sig) and x.grantee = 0)
       then 'PASS' else 'FAIL' end
union all
select 'C4', 'C4 the link, the switch and the summary are callable from the browser',
  case when (select count(*) from browser where has_function_privilege('anon', to_regprocedure(sig), 'EXECUTE')) = 3
       then 'PASS' else 'FAIL' end
union all
select 'C5', 'C5 every definer function pins search_path public, pg_temp',
  case when (select count(*) from pg_proc p
              where p.oid in (select to_regprocedure(sig) from server_only where sig <> 'public.cart_reminder_param(text,integer,text)'
                              union all select to_regprocedure(sig) from browser)
                and p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=public, pg_temp') = 7
       then 'PASS' else 'FAIL' end
union all
select 'C6', 'C6 the switch and the summary check the PIN before anything else',
  case when (select count(*) from pg_proc p
              where p.oid in (to_regprocedure('public.set_cart_reminders(text,text,boolean)'),
                              to_regprocedure('public.get_cart_reminder_summary(text,text)'))
                and p.prosrc ilike '%not public.verify_store_pin(p_slug, p_hashed_pin)%') = 2
       then 'PASS' else 'FAIL' end
union all
select 'C7', 'C7 the sweep secret exists',
  case when exists (select 1 from public.automation_secrets where name = 'cart-reminders' and length(secret) >= 32)
       then 'PASS' else 'FAIL' end
union all
select 'C8', 'C8 no reminder is stuck in sending for more than an hour',
  case when not exists (select 1 from public.cart_reminders where status = 'sending' and created_at < now() - interval '1 hour')
       then 'PASS' else 'FAIL' end
union all
select 'I1', 'I1 shops with reminders on / sent / failed / clicked (all time)',
  (select count(*) from public.store_message_settings where cart_reminders)::text || ' / ' ||
  (select count(*) from public.cart_reminders where status = 'sent')::text || ' / ' ||
  (select count(*) from public.cart_reminders where status = 'failed')::text || ' / ' ||
  (select count(*) from public.cart_reminders where clicked_at is not null)::text
union all
select 'I2', 'I2 a store whose slug is "cart" (would clash with the reminder link)',
  coalesce((select slug from public.stores where slug = 'cart'), 'none');

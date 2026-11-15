-- ===========================================================================
-- VERIFY supabase/cart-reminder-lang-forward.sql — read only. Every row PASS.
-- ===========================================================================
select 'L1 store_message_settings.cart_reminder_lang, default en' as check,
       case when exists (select 1 from information_schema.columns
                          where table_schema = 'public' and table_name = 'store_message_settings'
                            and column_name = 'cart_reminder_lang' and is_nullable = 'NO'
                            and column_default like '%''en''%')
            then 'PASS' else 'FAIL' end as result
union all
select 'L2 cart_reminders.lang, default en',
       case when exists (select 1 from information_schema.columns
                          where table_schema = 'public' and table_name = 'cart_reminders'
                            and column_name = 'lang' and is_nullable = 'NO'
                            and column_default like '%''en''%')
            then 'PASS' else 'FAIL' end
union all
select 'L3 both languages limited to en / mr',
       case when (select count(*) from pg_constraint
                   where conname in ('store_message_settings_cart_reminder_lang_check', 'cart_reminders_lang_check')) = 2
            then 'PASS' else 'FAIL' end
union all
select 'L4 cart_reminder_claim is the new version',
       case when (select md5(replace(prosrc, chr(13), '')) from pg_proc
                   where oid = to_regprocedure('public.cart_reminder_claim(uuid,boolean,timestamptz,text)')) = 'b60b545976e5bd6aa52f559ebdbb6477'
            then 'PASS' else 'FAIL' end
union all
select 'L5 cart_reminder_statuses is the new version',
       case when (select md5(replace(prosrc, chr(13), '')) from pg_proc
                   where oid = to_regprocedure('public.cart_reminder_statuses(text,text)')) = '4a8a629bfc63e45a1a9fb2a9747ba605'
            then 'PASS' else 'FAIL' end
union all
select 'L6 get_cart_reminder_summary is the new version',
       case when (select md5(replace(prosrc, chr(13), '')) from pg_proc
                   where oid = to_regprocedure('public.get_cart_reminder_summary(text,text)')) = 'db1d37da599f931e7874e9e1c57c5d27'
            then 'PASS' else 'FAIL' end
union all
select 'L7 set_cart_reminder_lang: the browser may call it (PIN checked inside)',
       case when to_regprocedure('public.set_cart_reminder_lang(text,text,text)') is not null
             and has_function_privilege('anon', 'public.set_cart_reminder_lang(text,text,text)', 'execute')
            then 'PASS' else 'FAIL' end
union all
select 'L8 cart_reminder_mark_lang: the sender only',
       case when to_regprocedure('public.cart_reminder_mark_lang(uuid,text)') is not null
             and not has_function_privilege('anon', 'public.cart_reminder_mark_lang(uuid,text)', 'execute')
             and not has_function_privilege('authenticated', 'public.cart_reminder_mark_lang(uuid,text)', 'execute')
             and has_function_privilege('service_role', 'public.cart_reminder_mark_lang(uuid,text)', 'execute')
            then 'PASS' else 'FAIL' end
union all
select 'L9 the claim still only for the sender',
       case when not has_function_privilege('anon', 'public.cart_reminder_claim(uuid,boolean,timestamptz,text)', 'execute')
            then 'PASS' else 'FAIL' end;

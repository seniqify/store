-- ===========================================================================
-- VERIFY supabase/review-asks-auto-forward.sql - read only. Every row PASS.
-- ===========================================================================
select 'B1 the shop settings columns, with their defaults' as check,
       case when (select count(*) from information_schema.columns
                   where table_schema = 'public' and table_name = 'store_message_settings'
                     and column_name in ('review_ask_auto', 'review_ask_days', 'review_ask_lang',
                                         'review_ask_couriers', 'review_ask_manual', 'review_ask_since')) = 6
             and (select count(*) from pg_constraint
                   where conname in ('store_message_settings_review_ask_days_check',
                                     'store_message_settings_review_ask_lang_check')) = 2
            then 'PASS' else 'FAIL' end as result
union all
select 'B2 review_ask_sends: row level security on, closed to the browser',
       case when exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                          where n.nspname = 'public' and c.relname = 'review_ask_sends' and c.relrowsecurity)
             and not has_table_privilege('anon', 'public.review_ask_sends', 'select')
             and not has_table_privilege('authenticated', 'public.review_ask_sends', 'select')
            then 'PASS' else 'FAIL' end
union all
select 'B3 one live send per order',
       case when exists (select 1 from pg_indexes
                          where schemaname = 'public' and indexname = 'review_ask_sends_one_live_per_order')
            then 'PASS' else 'FAIL' end
union all
select 'B4 the sweep has its own secret',
       case when exists (select 1 from public.automation_secrets where name = 'review-asks' and length(secret) >= 32)
            then 'PASS' else 'FAIL' end
union all
select 'B5 the sending functions are service_role only',
       case when (select bool_and(not has_function_privilege('anon', f, 'execute')
                                  and not has_function_privilege('authenticated', f, 'execute')
                                  and has_function_privilege('service_role', f, 'execute'))
                    from unnest(array['public.review_asks_due(integer,timestamptz)',
                                      'public.review_ask_claim(uuid,text,text,text)',
                                      'public.review_ask_finish(uuid,boolean,integer,text,text)',
                                      'public.review_asks_expire_stuck()',
                                      'public.review_ask_fresh(uuid)',
                                      'public.review_ask_price_paise()']) as f)
            then 'PASS' else 'FAIL' end
union all
select 'B6 the shop switch and its read: browser may call them, PIN checked inside',
       case when has_function_privilege('anon', 'public.set_review_ask_auto(text,text,boolean,integer,text,boolean,boolean)', 'execute')
             and has_function_privilege('anon', 'public.get_review_ask_auto(text,text)', 'execute')
             and (select bool_and(prosrc like '%verify_store_pin(p_slug, p_hashed_pin)%') from pg_proc
                   where oid in (to_regprocedure('public.set_review_ask_auto(text,text,boolean,integer,text,boolean,boolean)'),
                                 to_regprocedure('public.get_review_ask_auto(text,text)')))
            then 'PASS' else 'FAIL' end
union all
select 'B7 get_review_asks is the new version (with source), still PIN-checked, browser may call it',
       case when (select md5(replace(prosrc, chr(13), '')) from pg_proc
                   where oid = to_regprocedure('public.get_review_asks(text,text)')) = '5abaac44b3ffa781b774cf7e68e63767'
             and has_function_privilege('anon', 'public.get_review_asks(text,text)', 'execute')
            then 'PASS' else 'FAIL' end
union all
select 'B8 one message costs 1 Coin (50 paise)',
       case when public.review_ask_price_paise() = 50 then 'PASS' else 'FAIL' end
union all
select 'B9 the claim debits the wallet and makes the link the same way as issue_review_invite',
       case when (select prosrc like '%wallet_debit(a.store_slug, public.review_ask_price_paise()%'
                     and prosrc like '%extensions.gen_random_bytes(24)%'
                     and prosrc like '%whatsapp_opted_out(a.store_slug, a.customer_phone)%'
                    from pg_proc where oid = to_regprocedure('public.review_ask_claim(uuid,text,text,text)'))
            then 'PASS' else 'FAIL' end
union all
select 'B10 a refused message is refunded and its link removed',
       case when (select prosrc like '%wallet_refund(r.debit_ref%'
                     and prosrc like '%delete from public.review_invites i where i.token_hash = r.token_hash%'
                    from pg_proc where oid = to_regprocedure('public.review_ask_finish(uuid,boolean,integer,text,text)'))
            then 'PASS' else 'FAIL' end;

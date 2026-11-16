-- ===========================================================================
-- VERIFY supabase/review-asks-forward.sql - read only. Every row PASS.
-- ===========================================================================
select 'A1 review_ask_skips exists with row level security on' as check,
       case when exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                          where n.nspname = 'public' and c.relname = 'review_ask_skips' and c.relrowsecurity)
            then 'PASS' else 'FAIL' end as result
union all
select 'A2 the browser cannot read or write review_ask_skips directly',
       case when to_regclass('public.review_ask_skips') is not null
             and not has_table_privilege('anon', 'public.review_ask_skips', 'select')
             and not has_table_privilege('anon', 'public.review_ask_skips', 'insert')
             and not has_table_privilege('authenticated', 'public.review_ask_skips', 'select')
             and not has_table_privilege('authenticated', 'public.review_ask_skips', 'delete')
            then 'PASS' else 'FAIL' end
union all
select 'A3 get_review_asks: the browser may call it, PIN checked inside',
       case when to_regprocedure('public.get_review_asks(text,text)') is not null
             and has_function_privilege('anon', 'public.get_review_asks(text,text)', 'execute')
             and (select prosecdef and prosrc like '%verify_store_pin(p_slug, p_hashed_pin)%'
                    from pg_proc where oid = to_regprocedure('public.get_review_asks(text,text)'))
            then 'PASS' else 'FAIL' end
union all
select 'A4 set_review_ask_skip: the browser may call it, PIN checked inside',
       case when to_regprocedure('public.set_review_ask_skip(text,text,uuid,boolean)') is not null
             and has_function_privilege('anon', 'public.set_review_ask_skip(text,text,uuid,boolean)', 'execute')
             and (select prosecdef and prosrc like '%verify_store_pin(p_slug, p_hashed_pin)%'
                    from pg_proc where oid = to_regprocedure('public.set_review_ask_skip(text,text,uuid,boolean)'))
            then 'PASS' else 'FAIL' end
union all
select 'A5 both functions pin their search_path',
       case when (select count(*) from pg_proc
                   where oid in (to_regprocedure('public.get_review_asks(text,text)'),
                                 to_regprocedure('public.set_review_ask_skip(text,text,uuid,boolean)'))
                     and array_to_string(proconfig, ',') like '%search_path=public, pg_temp%') = 2
            then 'PASS' else 'FAIL' end;

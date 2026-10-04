-- Verifier for offers-forward.sql. READ-ONLY: one SELECT.
-- After the forward: every C row PASS (I rows are information).

with shop_fns(sig) as (
  values ('public.list_message_templates(text,text)'),
         ('public.request_message_template(text,text,text,text)'),
         ('public.offer_audience(text,text,uuid,text[],jsonb)'),
         ('public.seller_record_optout(text,text,text)')
),
server_fns(sig) as (
  values ('public.offer_claim(text,uuid,text,jsonb)'),
         ('public.offer_finish(uuid,boolean,integer,text)'),
         ('public.offer_sends_expire_stuck()'),
         ('public.offer_value_map(text)'),
         ('public.offer_field_ok(text)')
),
admin_fns(sig) as (
  values ('public.admin_list_message_templates()'),
         ('public.admin_decide_message_template(uuid,text,text,text)'),
         ('public.admin_create_ready_template(text,text,text)')
),
tabs(t) as (values ('public.message_templates'), ('public.offer_sends'))
select 'C1' as grp, 'C1 both tables exist with row level security on, closed to the browser' as check_name,
  case when (select count(*) from tabs join pg_class c on c.oid = to_regclass(tabs.t) where c.relrowsecurity) = 2
        and not exists (select 1 from tabs, unnest(array['anon', 'authenticated']) r, unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) p
                         where has_table_privilege(r, tabs.t, p))
       then 'PASS' else 'FAIL' end as result
union all
select 'C2', 'C2 shops can list, request, preview and record an opt-out (anon, PIN-checked)',
  case when (select count(*) from shop_fns where has_function_privilege('anon', to_regprocedure(sig), 'EXECUTE')) = 4
        and (select count(*) from shop_fns join pg_proc p on p.oid = to_regprocedure(shop_fns.sig)
              where p.prosrc ilike '%not public.verify_store_pin(p_slug, p_hashed_pin)%') = 4
       then 'PASS' else 'FAIL' end
union all
select 'C3', 'C3 the sender functions are service_role only',
  case when (select count(*) from server_fns where to_regprocedure(sig) is not null) = 5
        and not exists (select 1 from server_fns, unnest(array['anon', 'authenticated']) r
                         where has_function_privilege(r, to_regprocedure(sig), 'EXECUTE'))
       then 'PASS' else 'FAIL' end
union all
select 'C4', 'C4 the Console functions are signed-in only and check crm_team admin',
  case when (select count(*) from admin_fns join pg_proc p on p.oid = to_regprocedure(admin_fns.sig)
              where p.prosrc ilike '%crm_team%role = ''admin''%') = 3
        and not exists (select 1 from admin_fns where has_function_privilege('anon', to_regprocedure(sig), 'EXECUTE'))
       then 'PASS' else 'FAIL' end
union all
select 'C5', 'C5 no shop-facing function returns a template URL',
  case when not exists (select 1 from shop_fns join pg_proc p on p.oid = to_regprocedure(shop_fns.sig)
                         where p.prosrc ilike '%template_url%')
       then 'PASS' else 'FAIL' end
union all
select 'C6', 'C6 no offer is stuck in sending for more than an hour',
  case when not exists (select 1 from public.offer_sends where status = 'sending' and created_at < now() - interval '1 hour')
       then 'PASS' else 'FAIL' end
union all
select 'I1', 'I1 ready-made approved / shop requests waiting / shop messages approved / offers sent',
  (select count(*) from public.message_templates where store_slug is null and status = 'approved')::text || ' / ' ||
  (select count(*) from public.message_templates where store_slug is not null and status = 'requested')::text || ' / ' ||
  (select count(*) from public.message_templates where store_slug is not null and status = 'approved')::text || ' / ' ||
  (select count(*) from public.offer_sends where status = 'sent')::text;

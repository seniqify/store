-- Verifier for messages-v2-forward.sql. READ-ONLY: one SELECT.
-- After the forward: every C row PASS (I rows are information).

with replaced(sig, v2) as (
  values ('public.cart_reminders_due(integer,timestamp with time zone)', 'f0cc5503820aaaa0cd6291e3efdc4223'),
         ('public.cart_reminder_claim(uuid,boolean,timestamp with time zone,text)', '2016c9c5d0a592c0626df562eeee2e94'),
         ('public.get_cart_reminder_summary(text,text)',                   '7f14829b0e262265ad8897f4479ccf02'),
         ('public.offer_claim(text,uuid,text,jsonb)',                      'e26ad9fa1fad1bf4e5cb46c286b17ca0')
),
server_only(sig) as (
  values ('public.whatsapp_opted_out(text,text)'),
         ('public.cart_reminders_due(integer,timestamp with time zone)'),
         ('public.cart_reminder_claim(uuid,boolean,timestamp with time zone,text)'),
         ('public.cart_reminders_manual_candidates(text)'),
         ('public.offer_claim(text,uuid,text,jsonb)')
),
browser(sig) as (
  values ('public.cart_reminder_preview(text,text)'),
         ('public.cart_reminder_statuses(text,text)'),
         ('public.get_cart_reminder_summary(text,text)'),
         ('public.get_offer_link(text)'),
         ('public.get_offer_summary(text,text)'),
         ('public.attribute_message_order(text,text,uuid)')
),
cols(t, c) as (
  values ('cart_reminders', 'source'), ('cart_reminders', 'ordered_order_id'), ('cart_reminders', 'ordered_at'),
         ('cart_reminders', 'ordered_total'), ('offer_sends', 'token'), ('offer_sends', 'clicked_at'),
         ('offer_sends', 'ordered_order_id'), ('offer_sends', 'ordered_at'), ('offer_sends', 'ordered_total')
)
select 'C1' as grp, 'C1 the four replaced functions are the v2 versions, and the one-argument claim is gone' as check_name,
  case when (select count(*) from replaced r join pg_proc p on p.oid = to_regprocedure(r.sig)
              where md5(replace(p.prosrc, chr(13), '')) = r.v2) = 4
        and to_regprocedure('public.cart_reminder_claim(uuid)') is null
       then 'PASS' else 'FAIL' end as result
union all
select 'C2', 'C2 every v2 function is SECURITY DEFINER with search_path public, pg_temp',
  case when (select count(*) from (select sig from server_only union select sig from browser) f
              join pg_proc p on p.oid = to_regprocedure(f.sig)
              where p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=public, pg_temp') = 11
       then 'PASS' else 'FAIL' end
union all
select 'C3', 'C3 claim, candidates, opt-out and the sweep list are service_role only',
  case when not exists (select 1 from server_only, unnest(array['anon', 'authenticated']) r
                         where has_function_privilege(r, to_regprocedure(sig), 'EXECUTE'))
        and has_function_privilege('service_role', 'public.cart_reminder_claim(uuid,boolean,timestamp with time zone,text)', 'EXECUTE')
       then 'PASS' else 'FAIL' end
union all
select 'C4', 'C4 the preview, statuses, summaries, offer link and order tagging are callable from the browser',
  case when (select count(*) from browser where has_function_privilege('anon', to_regprocedure(sig), 'EXECUTE')) = 6
       then 'PASS' else 'FAIL' end
union all
select 'C5', 'C5 the shop-facing reads check the PIN first',
  case when (select count(*) from pg_proc p
              where p.oid in (to_regprocedure('public.cart_reminder_preview(text,text)'),
                              to_regprocedure('public.cart_reminder_statuses(text,text)'),
                              to_regprocedure('public.get_cart_reminder_summary(text,text)'),
                              to_regprocedure('public.get_offer_summary(text,text)'))
                and p.prosrc ilike '%if not public.verify_store_pin(p_slug, p_hashed_pin) then%return null;%') = 4
       then 'PASS' else 'FAIL' end
union all
select 'C6', 'C6 the new columns exist',
  case when (select count(*) from cols join information_schema.columns ic
              on ic.table_schema = 'public' and ic.table_name = cols.t and ic.column_name = cols.c) = 9
       then 'PASS' else 'FAIL' end
union all
select 'I1', 'I1 reminders sent automatically / by hand / orders tagged to a reminder link / to an offer link',
  (select count(*) from public.cart_reminders where status = 'sent' and source = 'auto')::text || ' / ' ||
  (select count(*) from public.cart_reminders where status = 'sent' and source = 'manual')::text || ' / ' ||
  (select count(*) from public.cart_reminders where ordered_order_id is not null)::text || ' / ' ||
  (select count(*) from public.offer_sends where ordered_order_id is not null)::text;

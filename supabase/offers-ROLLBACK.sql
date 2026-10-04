-- ===========================================================================
--  WhatsApp offers  --  UNDO
--
--  Drops the offers functions and both tables. REFUSES if any offer was ever
--  sent (the shops paid for them; their wallet ledger points at them) or any
--  message template exists (shops' requests and the founder's approved
--  templates, with their Seniqify links). Export first, on purpose.
--
--  REVERT THE APP AND UNDEPLOY send-offer FIRST.
--  RUN: Supabase Dashboard -> SQL Editor -> paste -> Run. Idempotent.
-- ===========================================================================

begin;

do $guard$
declare
  v_rows bigint := 0;
begin
  if to_regclass('public.offer_sends') is not null then
    execute 'select count(*) from public.offer_sends' into v_rows;
    if v_rows > 0 then
      raise exception 'REFUSED - offer_sends holds % offers the shops paid for. Export them first.', v_rows;
    end if;
  end if;
  if to_regclass('public.message_templates') is not null then
    execute 'select count(*) from public.message_templates' into v_rows;
    if v_rows > 0 then
      raise exception 'REFUSED - message_templates holds % templates or requests. Export them first.', v_rows;
    end if;
  end if;
end;
$guard$;

drop function if exists public.admin_create_ready_template(text, text, text);
drop function if exists public.admin_decide_message_template(uuid, text, text, text);
drop function if exists public.admin_list_message_templates();
drop function if exists public.seller_record_optout(text, text, text);
drop function if exists public.offer_sends_expire_stuck();
drop function if exists public.offer_finish(uuid, boolean, integer, text);
drop function if exists public.offer_claim(text, uuid, text, jsonb);
drop function if exists public.offer_audience(text, text, uuid, text[], jsonb);
drop function if exists public.request_message_template(text, text, text, text);
drop function if exists public.list_message_templates(text, text);
drop function if exists public.offer_field_ok(text);
drop function if exists public.offer_value_map(text);

drop table if exists public.offer_sends;
drop table if exists public.message_templates;

commit;

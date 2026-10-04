-- ===========================================================================
--  WhatsApp consent at checkout  --  UNDO
--
--  Drops record_whatsapp_consent, whatsapp_consent_granted and the
--  whatsapp_consents table.
--
--  REFUSES once any consent is recorded: those rows are the evidence of who
--  agreed to marketing messages, and when. Export them first, on purpose.
--
--  REVERT THE APP FIRST (the checkout calls record_whatsapp_consent; without it
--  the call fails quietly, which is harmless, but pointless).
--
--  RUN: Supabase Dashboard -> SQL Editor -> paste -> Run. Idempotent.
-- ===========================================================================

begin;

do $guard$
declare
  v_rows bigint := 0;
begin
  if to_regclass('public.whatsapp_consents') is not null then
    execute 'select count(*) from public.whatsapp_consents' into v_rows;
    if v_rows > 0 then
      raise exception 'REFUSED - whatsapp_consents holds % consent records. Export them before removing the table.', v_rows;
    end if;
  end if;
end;
$guard$;

drop function if exists public.whatsapp_consent_granted(text, text);
drop function if exists public.record_whatsapp_consent(text, text, boolean, text);
drop table if exists public.whatsapp_consents;

commit;

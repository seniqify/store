-- ===========================================================================
--  Repair: WhatsApp API key mask shows garbled characters
--
--  pin-bypass-closure-forward.sql masks the key as four bullet characters.
--  It was pasted into the SQL editor through a clipboard copy that mis-read
--  the file's UTF-8, so the bullets may have been stored as garbage text.
--
--  Same function, same signature, same PIN throttle. The only change: the
--  bullets are built with chr(8226), so this file is plain ASCII and no copy
--  can garble it. Safe to run whether or not the mask is broken.
--
--  CHECK (read-only), before and after:
--    select strpos(prosrc, repeat(chr(8226), 4)) > 0 as mask_ok
--      from pg_proc where proname = 'get_store_whatsapp';
-- ===========================================================================

create or replace function public.get_store_whatsapp(p_slug text, p_hashed_pin text)
returns table(configured boolean, template_url text, api_key_masked text, var_templates jsonb)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
begin
  if not public.verify_store_pin(p_slug, p_hashed_pin) then
    raise exception 'unauthorized';
  end if;

  return query
    select
      (w.template_url is not null and w.template_url <> '') as configured,
      coalesce(w.template_url, '') as template_url,
      case when w.api_key is null or w.api_key = '' then ''
           else repeat(chr(8226), 4) || right(w.api_key, 4) end as api_key_masked,
      coalesce(w.var_templates, '["{name}"]'::jsonb) as var_templates
    from public.store_whatsapp w
    where w.store_slug = p_slug;
end;
$function$;

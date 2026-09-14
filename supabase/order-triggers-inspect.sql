-- ===========================================================================
--  Triggers on public.orders -- READ-ONLY INSPECTION
--
--  One single SELECT. Writes nothing. Safe on production.
--
--  Why: trg_decrement_stock and trg_meta_capi are not in the repository. The
--  secure order writer (create_order_secure) runs as service_role, so before
--  checkout switches to it we need each trigger's exact definition, whether its
--  function is SECURITY DEFINER, its owner, and whether service_role may run it.
-- ===========================================================================

select t.tgname::text                                   as trigger_name,
       pg_get_triggerdef(t.oid)                          as definition,
       p.proname::text                                   as function_name,
       case when p.prosecdef then 'definer' else 'invoker' end as security,
       coalesce(array_to_string(p.proconfig, ', '), 'unpinned') as config,
       pg_get_userbyid(p.proowner)::text                 as owner,
       case when has_function_privilege('service_role', p.oid, 'execute')
            then 'yes' else 'no' end                     as service_role_can_run,
       p.prosrc                                          as body
  from pg_trigger t
  join pg_proc p on p.oid = t.tgfoid
 where t.tgrelid = 'public.orders'::regclass
   and not t.tgisinternal
 order by 1;
